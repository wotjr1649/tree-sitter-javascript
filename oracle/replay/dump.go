package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
)

// input is one source to dump.
type input struct {
	ID, Source string
}

// dumpRecord is one line of a tree dump (-dump): the full tree, its error flags and the source hash.
type dumpRecord struct {
	ID      string `json:"id"`
	SHA256  string `json:"sha256"`
	Error   bool   `json:"error"` // the root has_error
	Errors  int    `json:"errors"`
	Missing int    `json:"missing"`
	Tree    string `json:"tree"`
}

// defaultInputs are the dump's input sets, relative to the repository root.
var defaultInputs = []string{"test/corpus/*.txt", "examples/*", "test/highlight/*", "test/tags/*", "oracle/cases.jsonl"}

// delimiter reports whether line (with its line ending) is 3 or more c followed by a suffix, as the CLI's
// parse_delimiter_line: n is the run of c, suffix the rest without the line ending.
func delimiter(line string, c byte) (n int, suffix string, ok bool) {
	for n < len(line) && line[n] == c {
		n++
	}
	return n, strings.TrimRight(line[n:], "\r\n"), n >= 3
}

// corpusHeader parses the header (`===`, name lines, attribute lines such as `:error`, `===`) at lines[start] as the
// CLI's parse_header: it returns the test name and the index of the first body line, or ok false if there is none.
func corpusHeader(lines []string, suffix string, start int) (name string, body int, ok bool) {
	if _, s, ok := delimiter(lines[start], '='); !ok || s != suffix {
		return "", 0, false
	}
	var b strings.Builder
	marker := false
	i := start + 1
	for ; i < len(lines); i++ {
		if _, s, ok := delimiter(lines[i], '='); ok && s == suffix {
			break
		}
		t := strings.TrimSpace(lines[i])
		if t == "" && !marker {
			return "", 0, false
		}
		switch head, _, _ := strings.Cut(t, "("); head {
		case ":skip", ":fail-fast", ":error", ":cst":
			marker = true
		case ":platform", ":language":
			marker = marker || strings.HasPrefix(t, head+"(") && strings.HasSuffix(t, ")")
		default:
			if !marker {
				b.WriteString(lines[i])
			}
		}
	}
	if i >= len(lines) {
		return "", 0, false
	}
	return strings.TrimRightFunc(b.String(), unicode.IsSpace), i + 1, true
}

// splitCorpus returns the inputs of a tree-sitter corpus file by the rules of tree-sitter CLI 0.27.2
// (crates/cli/src/test.rs, parse_test_content): each test's source is the bytes between its header and its longest
// `---` divider (the last one of that length), without the one line ending before the divider; delimiters carry the
// suffix of the file's first suffixed `===` line. Ids are `<name>#<test name>`, numbered `#2`, `#3`... while taken.
// A file without tests, a test without a divider or a file that is not UTF-8 is an error.
func splitCorpus(name, text string) ([]input, error) {
	if !utf8.ValidString(text) {
		return nil, fmt.Errorf("%s: not UTF-8", name)
	}
	lines := strings.SplitAfter(text, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	suffix := ""
	for _, l := range lines {
		if _, s, ok := delimiter(l, '='); ok && s != "" {
			suffix = s
			break
		}
	}
	var out []input
	used := map[string]bool{}
	add := func(title string, body []string) error {
		div, best := -1, 0
		for j, l := range body {
			if n, s, ok := delimiter(l, '-'); ok && s == suffix && n+len(s) >= best {
				div, best = j, n+len(s)
			}
		}
		if div < 0 {
			return fmt.Errorf("%s: test %q has no --- divider", name, title)
		}
		id := name + "#" + title
		for n := 2; used[id]; n++ {
			id = name + "#" + title + "#" + strconv.Itoa(n)
		}
		used[id] = true
		src := strings.TrimSuffix(strings.TrimSuffix(strings.Join(body[:div], ""), "\n"), "\r")
		out = append(out, input{ID: id, Source: src})
		return nil
	}
	title, body := "", -1
	for i := 0; i < len(lines); {
		t, b, ok := corpusHeader(lines, suffix, i)
		if !ok {
			i++
			continue
		}
		if body >= 0 {
			if err := add(title, lines[body:i]); err != nil {
				return nil, err
			}
		}
		title, body, i = t, b, b
	}
	if body < 0 {
		return nil, fmt.Errorf("%s: no corpus tests", name)
	}
	if err := add(title, lines[body:]); err != nil {
		return nil, err
	}
	return out, nil
}

// readJSONL reads records with an `id` and a string `source` (may be empty); other fields are ignored.
func readJSONL(path string) ([]input, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var out []input
	for n, line := range bytes.Split(b, []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var r struct {
			ID     string  `json:"id"`
			Source *string `json:"source"`
		}
		if err := json.Unmarshal(line, &r); err != nil {
			return nil, fmt.Errorf("%s line %d: %w", path, n+1, err)
		}
		if r.ID == "" {
			return nil, fmt.Errorf("%s line %d: no id", path, n+1)
		}
		if r.Source == nil {
			return nil, fmt.Errorf("%s line %d: no string source", path, n+1)
		}
		out = append(out, input{ID: r.ID, Source: *r.Source})
	}
	return out, nil
}

// loadInputs expands the patterns (relative to root unless absolute): `*.jsonl` files are `{id, source}` records,
// `.txt` files under test/corpus are corpus files, any other file is one input named by its path.
func loadInputs(root string, patterns []string) ([]input, error) {
	var out []input
	ids := map[string]bool{}
	for _, p := range patterns {
		if !filepath.IsAbs(p) {
			p = filepath.Join(root, p)
		}
		files, err := filepath.Glob(p)
		if err != nil {
			return nil, err
		}
		if len(files) == 0 {
			return nil, fmt.Errorf("%s matches no file", p)
		}
		sort.Strings(files)
		for _, f := range files {
			if st, err := os.Stat(f); err != nil || st.IsDir() {
				continue
			}
			name := f
			if rel, err := filepath.Rel(root, f); err == nil && !strings.HasPrefix(rel, "..") {
				name = filepath.ToSlash(rel)
			}
			var got []input
			switch {
			case strings.HasSuffix(f, ".jsonl"):
				got, err = readJSONL(f)
			case strings.HasSuffix(f, ".txt") && strings.Contains(name, "corpus/"):
				var b []byte
				if b, err = os.ReadFile(f); err == nil {
					got, err = splitCorpus(name, string(b))
				}
			default:
				var b []byte
				b, err = os.ReadFile(f)
				got = []input{{ID: name, Source: string(b)}}
			}
			if err != nil {
				return nil, err
			}
			for _, in := range got {
				if ids[in.ID] {
					return nil, fmt.Errorf("%s: duplicate input id %q", name, in.ID)
				}
				ids[in.ID] = true
				out = append(out, in)
			}
		}
	}
	return out, nil
}

// treeString writes the tree as an s-expression of every node, named and anonymous: `(field:kind@start:end ...)`,
// anonymous kinds quoted, MISSING nodes prefixed with `MISSING `, UTF-8 byte offsets.
func treeString(root *tree_sitter.Node) (tree string, errors, missing int) {
	var b strings.Builder
	cursor := root.Walk()
	defer cursor.Close()
	var visit func()
	visit = func() {
		n := cursor.Node()
		if n.IsError() {
			errors++
		}
		b.WriteByte('(')
		if f := cursor.FieldName(); f != "" {
			b.WriteString(f + ":")
		}
		if n.IsMissing() {
			missing++
			b.WriteString("MISSING ")
		}
		if n.IsNamed() {
			b.WriteString(n.Kind())
		} else {
			b.WriteString(strconv.Quote(n.Kind()))
		}
		fmt.Fprintf(&b, "@%d:%d", n.StartByte(), n.EndByte())
		if cursor.GotoFirstChild() {
			for {
				visit()
				if !cursor.GotoNextSibling() {
					break
				}
			}
			cursor.GotoParent()
		}
		b.WriteByte(')')
	}
	visit()
	return b.String(), errors, missing
}

// dump parses every input and writes one dumpRecord per line.
func dump(parser *tree_sitter.Parser, inputs []input, w io.Writer) error {
	bw := bufio.NewWriter(w)
	enc := json.NewEncoder(bw)
	enc.SetEscapeHTML(false)
	for _, in := range inputs {
		src := []byte(in.Source)
		t := parser.Parse(src, nil)
		if t == nil {
			return fmt.Errorf("%s: parse returned no tree", in.ID)
		}
		r := dumpRecord{ID: in.ID, SHA256: sum(src), Error: t.RootNode().HasError()}
		r.Tree, r.Errors, r.Missing = treeString(t.RootNode())
		t.Close()
		if err := enc.Encode(r); err != nil {
			return err
		}
	}
	return bw.Flush()
}
