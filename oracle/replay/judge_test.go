package main

import (
	"strings"
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_javascript "github.com/wotjr1649/tree-sitter-javascript/bindings/go"
)

func parse(t *testing.T, src string) ([]node, Report) {
	t.Helper()
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(tree_sitter.NewLanguage(tree_sitter_javascript.Language())); err != nil {
		t.Fatal(err)
	}
	tree := parser.Parse([]byte(src), nil)
	defer tree.Close()
	nodes := flatten(tree.RootNode())
	return nodes, analyze(nodes, tree.RootNode().HasError(), []byte(src))
}

func TestCleanTreeAndExpect(t *testing.T) {
	src := "a?.delete(b)"
	nodes, r := parse(t, src)
	if !r.Clean() {
		t.Fatalf("want a clean tree, got %s", r)
	}
	if got := deepest(nodes, 3, 9); got != "property_identifier" {
		t.Errorf("deepest(3,9) = %q", got)
	}
	ok := Case{Source: src, Expect: []string{"3-9:property_identifier"}}
	if d := check(ok, "accept", nodes, r); len(d) != 0 {
		t.Errorf("unexpected differences: %v", d)
	}
	flipped := Case{Source: src, Expect: []string{"3-9:identifier"}}
	if d := check(flipped, "accept", nodes, r); len(d) != 1 {
		t.Errorf("a flipped expectation must differ, got %v", d)
	}
}

func TestAcceptedAndErrorIsRefused(t *testing.T) {
	nodes, r := parse(t, "a?.;")
	if !r.HasError() {
		t.Fatalf("want an error tree, got %s", r)
	}
	d := check(Case{Source: "a?.;"}, "accept", nodes, r)
	if len(d) != 1 || !strings.Contains(d[0], "accepted by the oracle but the tree has an error") {
		t.Errorf("an accepted case with an error tree must differ, got %v", d)
	}
}

func TestSyntaxPosition(t *testing.T) {
	src := "a?.;"
	nodes, r := parse(t, src)
	at := func(n int) []string { return check(Case{Source: src, ErrorAt: &n}, "syntax", nodes, r) }
	if d := at(3); len(d) != 0 { // ERROR [1,3) ends where the offending token starts
		t.Errorf("errorAt 3 should hold: %v", d)
	}
	if d := at(0); len(d) != 1 { // before the ERROR node
		t.Errorf("errorAt 0 should not hold")
	}
	// a clean tree for a syntax verdict differs
	cn, cr := parse(t, "a?.b;")
	n := 3
	if d := check(Case{Source: "a?.b;", ErrorAt: &n}, "syntax", cn, cr); len(d) != 1 {
		t.Errorf("a clean tree for a syntax verdict must differ: %v", d)
	}
}

func TestErrorAtAcrossWhitespace(t *testing.T) {
	// ERROR ends at 9 ("using ="), the oracle names the next token at 10: only whitespace in between.
	src := []byte("{ using = ; }")
	nodes := []node{{kind: "ERROR", start: 2, end: 9, err: true, leaf: true}}
	if !errorAtHolds(nodes, src, 10) {
		t.Error("whitespace between the ERROR end and the offset must be tolerated")
	}
	if errorAtHolds(nodes, []byte("{ using =x; }"), 10) {
		t.Error("a non-whitespace byte between the ERROR end and the offset must not be tolerated")
	}
}

func TestCoverageAndZeroWidth(t *testing.T) {
	src := []byte("a  ;")
	leaf := func(k string, s, e int) node { return node{kind: k, start: s, end: e, depth: 1, leaf: true} }
	root := node{kind: "program", start: 0, end: 4}
	if r := analyze([]node{root, leaf("identifier", 0, 1), leaf(";", 3, 4)}, false, src); !r.Clean() {
		t.Errorf("whitespace gaps are covered: %s", r)
	}
	if r := analyze([]node{root, leaf("identifier", 0, 1)}, false, src); r.FirstUncovered != 3 || r.Clean() {
		t.Errorf("the uncovered ';' must be found: %+v", r)
	}
	zero := leaf("x", 1, 1)
	if r := analyze([]node{root, leaf("identifier", 0, 1), zero, leaf(";", 3, 4)}, false, src); r.ZeroWidth != 1 || r.Clean() {
		t.Errorf("a zero-width node must be reported: %+v", r)
	}
	miss := leaf(")", 1, 1)
	miss.missing = true
	if r := analyze([]node{root, leaf("identifier", 0, 1), miss, leaf(";", 3, 4)}, true, src); r.Missing != 1 || r.ZeroWidth != 0 || !r.HasError() {
		t.Errorf("a MISSING node counts once, as missing: %+v", r)
	}
}

func TestEarlyAndDisagreeDoNotGate(t *testing.T) {
	nodes, r := parse(t, "a?.;")
	for _, v := range []string{"early", "disagree"} {
		if d := check(Case{Source: "a?.;", Reason: "x"}, v, nodes, r); len(d) != 0 {
			t.Errorf("%s must not gate: %v", v, d)
		}
	}
}

func TestParseExpect(t *testing.T) {
	for _, bad := range []string{"", "3-9", "9-3:x", "a-b:x", "3-9:", "-1-4:x"} {
		if _, _, _, err := parseExpect(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	if s, e, k, err := parseExpect("3-9:property_identifier"); err != nil || s != 3 || e != 9 || k != "property_identifier" {
		t.Errorf("parseExpect: %d %d %q %v", s, e, k, err)
	}
}

func TestWhitespaceOnlyInputIsFaithful(t *testing.T) {
	for _, src := range []string{"", " ", " \n\t\n"} {
		if _, r := parse(t, src); !r.Clean() {
			t.Errorf("%q: want a clean tree, got %s", src, r)
		}
	}
}
