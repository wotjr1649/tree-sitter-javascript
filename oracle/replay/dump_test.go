package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_javascript "github.com/wotjr1649/tree-sitter-javascript/bindings/go"
)

func TestSplitCorpus(t *testing.T) {
	text := "==========\nFirst\n==========\n\na = 1;\n---\n\n(program)\n\n" +
		"==========\nFirst\n==========\n\nx\n----\ny\n---\n(program)\n"
	got := splitCorpus("c.txt", text)
	want := []input{{"c.txt#First", "\na = 1;"}, {"c.txt#First#2", "\nx\n----\ny"}}
	if len(got) != len(want) {
		t.Fatalf("got %d inputs: %q", len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("input %d = %q, want %q", i, got[i], want[i])
		}
	}
}

func dumpOne(t *testing.T, src string) dumpRecord {
	t.Helper()
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(tree_sitter.NewLanguage(tree_sitter_javascript.Language())); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := dump(parser, []input{{"x", src}}, &out); err != nil {
		t.Fatal(err)
	}
	var r dumpRecord
	if err := json.Unmarshal(out.Bytes(), &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestDumpTree(t *testing.T) {
	r := dumpOne(t, "a = 1")
	want := `(program@0:5(expression_statement@0:5(assignment_expression@0:5(left:identifier@0:1)("="@2:3)(right:number@4:5))))`
	if r.Tree != want || r.Error || r.Errors != 0 || r.Missing != 0 {
		t.Errorf("got %+v, want tree %s", r, want)
	}
	if r.SHA256 != sum([]byte("a = 1")) {
		t.Errorf("sha256 %s", r.SHA256)
	}
	bad := dumpOne(t, "if (a) {")
	if !bad.Error || bad.Missing == 0 || !strings.Contains(bad.Tree, `(MISSING "}"@8:8)`) {
		t.Errorf("want a MISSING node, got %+v", bad)
	}
}

func TestLoadInputs(t *testing.T) {
	dir := t.TempDir()
	write := func(name, s string) {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("test/corpus/a.txt", "===\nT\n===\nx\n---\n(program)\n")
	write("examples/e.js", "y")
	write("set.jsonl", `{"id":"k","source":"z","sha256":"ignored"}`+"\n")
	got, err := loadInputs(dir, []string{"test/corpus/*.txt", "examples/*", "set.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	want := []input{{"test/corpus/a.txt#T", "x"}, {"examples/e.js", "y"}, {"k", "z"}}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Errorf("got %q", got)
	}
	if _, err := loadInputs(dir, []string{"set.jsonl", "set.jsonl"}); err == nil {
		t.Error("a duplicate id must be refused")
	}
	if _, err := loadInputs(dir, []string{"nothing/*"}); err == nil {
		t.Error("a pattern that matches nothing must be refused")
	}
}
