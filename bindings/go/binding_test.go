package tree_sitter_javascript_test

import (
	"strings"
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_javascript "github.com/wotjr1649/tree-sitter-javascript/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_javascript.Language())
	if language == nil {
		t.Fatal("Error loading JavaScript grammar")
	}

	// SetLanguage rejects a parser whose ABI the runtime does not support.
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(language); err != nil {
		t.Fatalf("Error setting JavaScript language: %v", err)
	}

	tree := parser.Parse([]byte("const x = 1;"), nil)
	defer tree.Close()
	root := tree.RootNode()
	if root.Kind() != "program" || root.HasError() {
		t.Errorf("Unexpected parse of a small program: %s", root.ToSexp())
	}
}

func TestIncompleteMethodNameAfterEdit(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_javascript.Language())
	const prefix = "class C {"
	const comment = "/* comment\n*/"
	for _, head := range []string{"*m", "async m", "async *m"} {
		t.Run(head, func(t *testing.T) {
			parser := tree_sitter.NewParser()
			defer parser.Close()
			if err := parser.SetLanguage(language); err != nil {
				t.Fatal(err)
			}
			suffix := "\n" + head + "(\n}"
			plain := []byte(prefix + suffix)
			withComment := []byte(prefix + comment + suffix)
			start := tree_sitter.Point{Column: uint(len(prefix))}
			end := tree_sitter.Point{Row: 1, Column: 2}
			insert := tree_sitter.InputEdit{
				StartByte: uint(len(prefix)), OldEndByte: uint(len(prefix)), NewEndByte: uint(len(prefix + comment)),
				StartPosition: start, OldEndPosition: start, NewEndPosition: end,
			}
			remove := tree_sitter.InputEdit{
				StartByte: insert.StartByte, OldEndByte: insert.NewEndByte, NewEndByte: insert.OldEndByte,
				StartPosition: start, OldEndPosition: end, NewEndPosition: start,
			}

			initial := parser.Parse(plain, nil)
			defer initial.Close()
			initial.Edit(&insert)
			edited := parser.Parse(withComment, initial)
			defer edited.Close()

			check := func(tree *tree_sitter.Tree, source []byte, nameStart uint) {
				t.Helper()
				root := tree.RootNode()
				node := root.NamedDescendantForByteRange(nameStart, nameStart+1)
				if node == nil || node.Kind() != "property_identifier" || node.StartByte() != nameStart ||
					node.EndByte() != nameStart+1 || node.Parent() == nil || !node.Parent().IsError() {
					t.Fatalf("missing ERROR property identifier for %q: %s", source, root.ToSexp())
				}
				cursor := node.Parent().Walk()
				defer cursor.Close()
				if cursor.GotoFirstChildForByte(uint32(nameStart)) == nil || cursor.FieldName() != "name" {
					t.Fatalf("missing ERROR name field for %q: %s", source, root.ToSexp())
				}
				fresh := parser.Parse(source, nil)
				defer fresh.Close()
				if got, want := root.ToSexp(), fresh.RootNode().ToSexp(); got != want {
					t.Errorf("incremental tree: %s\nfresh tree: %s", got, want)
				}
			}
			check(edited, withComment, uint(len(prefix+comment+"\n"+head)-1))

			edited.Edit(&remove)
			restored := parser.Parse(plain, edited)
			defer restored.Close()
			check(restored, plain, uint(len(prefix+"\n"+head)-1))
		})
	}
}

// After `return`, `break`, `continue` and a label a line terminator ends the statement, and so does the start of the
// next included range (host code, such as a template's markup, between two ranges): the second range then starts a
// statement of its own, whatever its first token is.
func TestRestrictedStatementEndsAtIncludedRange(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_javascript.Language())
	cases := []struct{ left, right, kind string }{
		{"function f(){return ", "0}", "number"},
		{"function f(){return\r", "(0)}", "parenthesized_expression"},
		{"function f(){return\r", "[0]}", "array"},
		{"function f(){return\n", "(0)}", "parenthesized_expression"},
		{"function f(){return ", "(0)}", "parenthesized_expression"},
		{"a:for(;;){break\r", "[0]}", "array"},
		{"a:for(;;){continue a\r", "+a}", "unary_expression"},
		{"a:for(;;){continue a\n", "+a}", "unary_expression"},
	}
	for _, c := range cases {
		gap := "<html>"
		source := []byte(c.left + gap + c.right)
		start, end := uint(len(c.left)+len(gap)), uint(len(source))
		parser := tree_sitter.NewParser()
		if err := parser.SetLanguage(language); err != nil {
			t.Fatal(err)
		}
		if err := parser.SetIncludedRanges([]tree_sitter.Range{
			{StartByte: 0, EndByte: uint(len(c.left)), EndPoint: tree_sitter.Point{Column: uint(len(c.left))}},
			{StartByte: start, EndByte: end, StartPoint: tree_sitter.Point{Column: start}, EndPoint: tree_sitter.Point{Column: end}},
		}); err != nil {
			t.Fatal(err)
		}
		tree := parser.Parse(source, nil)
		node := tree.RootNode().NamedDescendantForByteRange(start, start+1)
		if tree.RootNode().HasError() || node == nil || node.Kind() != c.kind || node.StartByte() != start ||
			node.Parent().Kind() != "expression_statement" {
			t.Errorf("%q | %q: %s", c.left, c.right, tree.RootNode().ToSexp())
		}
		tree.Close()
		parser.Close()
	}
}

func TestConciseArrowContinuesAcrossIncludedRanges(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_javascript.Language())
	const excluded = "<excluded>\n"
	cases := []struct{ left, gap, right string }{
		{"function f(){ g(async()=>x", excluded, " + await y, await / 2); }"},
		{"function f(){ g(async()=>x", excluded, " (await y), await / 2); }"},
		{"function f(){ g(async()=>x", excluded, " ? await y : await z, await / 2); }"},
		{"async function f(){ g(()=>x", excluded, " + await(y), await y); }"},
		{"var f = () => a", "", "\n--> c\n+ b"},
		{"var f = () => a", excluded, "\n--> c\n+ b"},
		{"x = x => a", "", "\n--> c\n,b"},
		{"x = x => a\n", "", "--> c\n,b"},
	}
	for _, c := range cases {
		t.Run(c.right, func(t *testing.T) {
			parser := tree_sitter.NewParser()
			defer parser.Close()
			if err := parser.SetLanguage(language); err != nil {
				t.Fatal(err)
			}
			joined := parser.Parse([]byte(c.left+c.right), nil)
			defer joined.Close()
			start := uint(len(c.left) + len(c.gap))
			source := c.left + c.gap + c.right
			point := func(offset uint) tree_sitter.Point {
				prefix := source[:offset]
				return tree_sitter.Point{
					Row:    uint(strings.Count(prefix, "\n")),
					Column: uint(len(prefix) - strings.LastIndexByte(prefix, '\n') - 1),
				}
			}
			if err := parser.SetIncludedRanges([]tree_sitter.Range{
				{EndByte: uint(len(c.left)), EndPoint: point(uint(len(c.left)))},
				{StartByte: start, EndByte: uint(len(source)), StartPoint: point(start), EndPoint: point(uint(len(source)))},
			}); err != nil {
				t.Fatal(err)
			}
			ranged := parser.Parse([]byte(source), nil)
			defer ranged.Close()
			want, got := joined.RootNode(), ranged.RootNode()
			if want.HasError() || got.HasError() || got.ToSexp() != want.ToSexp() {
				t.Errorf("ranged: %s\njoined: %s", got.ToSexp(), want.ToSexp())
			}
		})
	}
}
