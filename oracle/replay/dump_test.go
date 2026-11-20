package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_javascript "github.com/wotjr1649/tree-sitter-javascript/bindings/go"
)

func TestSplitCorpus(t *testing.T) {
	for _, c := range []struct{ name, text string }{
		// The CLI's own cases (test_parse_test_content_simple, ..._with_dashes_in_source_code).
		{"simple", "===============\nThe first test\n===============\n\na b c\n\n---\n\n(a\n    (b c))\n\n" +
			"================\nThe second test\n================\nd\n---\n(d)"},
		{"dashes", "==================\nCode with dashes\n==================\nabc\n---\ndefg\n----\nhijkl\n-------\n\n(a (b))\n\n" +
			"=========================\nCode ending with dashes\n=========================\nabc\n-----------\n-------------------\n\n(c (d))"},
		{"crlf", "===\r\nTrailing\r\n===\r\n\r\nx\r\n\r\n---\r\n(program)\r\n"},
		{"attributes", "===\nWith error\n:error\n:platform(nowhere)\n===\nx\n---\n(ERROR)\n===\nTwo\nlines\n===\ny\n---\n(program)\n"},
		{"suffix", "===s\nSuffixed\n===s\n===\nx\n---\n---s\n(program)\n"},
		{"repeats", strings.Repeat("===\nRepeat\n===\nx\n---\n(program)\n", 2) + "===\nRepeat#2\n===\ny\n---\n(program)\n"},
	} {
		got, err := splitCorpus("c.txt", c.text)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
		}
		want := map[string][]input{
			"simple":     {{"c.txt#The first test", "\na b c\n"}, {"c.txt#The second test", "d"}},
			"dashes":     {{"c.txt#Code with dashes", "abc\n---\ndefg\n----\nhijkl"}, {"c.txt#Code ending with dashes", "abc\n-----------"}},
			"crlf":       {{"c.txt#Trailing", "\r\nx\r\n"}},
			"attributes": {{"c.txt#With error", "x"}, {"c.txt#Two\nlines", "y"}},
			"suffix":     {{"c.txt#Suffixed", "===\nx\n---"}},
			"repeats":    {{"c.txt#Repeat", "x"}, {"c.txt#Repeat#2", "x"}, {"c.txt#Repeat#2#2", "y"}},
		}[c.name]
		if !slices.Equal(got, want) {
			t.Errorf("%s: got %q, want %q", c.name, got, want)
		}
	}
	for text, msg := range map[string]string{
		"===\nMissing divider\n===\nx\n": `c.txt: test "Missing divider" has no --- divider`,
		"x\n---\n(program)\n":            "c.txt: no corpus tests",
		"===\nT\n===\n\xff\n---\n":       "c.txt: not UTF-8",
	} {
		if _, err := splitCorpus("c.txt", text); err == nil || err.Error() != msg {
			t.Errorf("%q: got error %v, want %s", text, err, msg)
		}
	}
}

// TestSplitCorpusSource checks a real corpus case against the source the CLI feeds the parser (CLI 0.27.2 rules:
// the bytes up to the divider without its one preceding line ending; sha256 computed independently).
func TestSplitCorpusSource(t *testing.T) {
	got, err := loadInputs("../..", []string{"test/corpus/destructuring.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if got[0].ID != "test/corpus/destructuring.txt#Object destructuring assignments" ||
		sum([]byte(got[0].Source)) != "552cdf1ac6d9d7f335d0c1bdd83f5aac5308068231330fad89eef247f4c201bc" {
		t.Errorf("got %q", got[0])
	}
}

func dumpOne(t *testing.T, src string, hashTrees bool) dumpRecord {
	t.Helper()
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(tree_sitter.NewLanguage(tree_sitter_javascript.Language())); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := dump(parser, []input{{"x", src}}, &out, hashTrees); err != nil {
		t.Fatal(err)
	}
	var r dumpRecord
	if err := json.Unmarshal(out.Bytes(), &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestDumpTree(t *testing.T) {
	r := dumpOne(t, "a = 1", false)
	want := `(program@0:5(expression_statement@0:5(assignment_expression@0:5(left:identifier@0:1)("="@2:3)(right:number@4:5))))`
	if r.Tree != want || r.Error || r.Errors != 0 || r.Missing != 0 {
		t.Errorf("got %+v, want tree %s", r, want)
	}
	if r.SHA256 != sum([]byte("a = 1")) {
		t.Errorf("sha256 %s", r.SHA256)
	}
	bad := dumpOne(t, "if (a) {", false)
	if !bad.Error || bad.Missing == 0 || !strings.Contains(bad.Tree, `(MISSING "}"@8:8)`) {
		t.Errorf("want a MISSING node, got %+v", bad)
	}
	bad.Tree = sum([]byte(bad.Tree))
	if got := dumpOne(t, "if (a) {", true); got != bad {
		t.Errorf("hashed dump: got %+v, want %+v", got, bad)
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
	write("set.jsonl", `{"id":"k","source":"z","sha256":"ignored"}`+"\n"+`{"id":"e","source":""}`+"\n")
	got, err := loadInputs(dir, []string{"test/corpus/*.txt", "examples/*", "set.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	want := []input{{"test/corpus/a.txt#T", "x"}, {"examples/e.js", "y"}, {"k", "z"}, {"e", ""}}
	if !slices.Equal(got, want) {
		t.Errorf("got %q", got)
	}
	write("bad.jsonl", `{"id":"a","source":"x"}`+"\n\n"+`{"id":"b","soruce":"x"}`+"\n")
	write("null.jsonl", `{"id":"n","source":null}`+"\n")
	for f, msg := range map[string]string{"bad.jsonl": "bad.jsonl line 3: no string source", "null.jsonl": "null.jsonl line 1: no string source"} {
		if _, err := loadInputs(dir, []string{f}); err == nil || !strings.HasSuffix(err.Error(), msg) {
			t.Errorf("%s: got error %v, want %s", f, err, msg)
		}
	}
	write("test/corpus/none.txt", "no tests\n")
	if _, err := loadInputs(dir, []string{"test/corpus/none.txt"}); err == nil || err.Error() != "test/corpus/none.txt: no corpus tests" {
		t.Errorf("a corpus file without tests: got error %v", err)
	}
	if _, err := loadInputs(dir, []string{"set.jsonl", "set.jsonl"}); err == nil {
		t.Error("a duplicate id must be refused")
	}
	if _, err := loadInputs(dir, []string{"nothing/*"}); err == nil {
		t.Error("a pattern that matches nothing must be refused")
	}
}
