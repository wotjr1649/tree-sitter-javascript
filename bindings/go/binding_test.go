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
