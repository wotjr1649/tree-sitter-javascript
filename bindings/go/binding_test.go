package tree_sitter_javascript_test

import (
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
