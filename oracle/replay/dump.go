package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
)

// input is one source to dump.
type input struct {
	ID     string `json:"id"`
	Source string `json:"source"`
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

var (
	headerLine  = regexp.MustCompile(`^={3,}\s*$`)
	dividerLine = regexp.MustCompile(`^-{3,}\s*$`)
)

// splitCorpus returns the inputs of a tree-sitter corpus file: the text between each test's header and its last
// `---` divider, without the trailing line breaks. Ids are `<name>#<test name>`, numbered when a name repeats.
// shortcut: no header suffixes or `:skip`-style attributes (this corpus has none); handle them if the corpus gains some.
func splitCorpus(name, text string) []input {
	var out []input
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	seen := map[string]int{}
	for i := 0; i < len(lines); {
		if !headerLine.MatchString(lines[i]) {
			i++
			continue
		}
		j := i + 1
		for j < len(lines) && !headerLine.MatchString(lines[j]) {
			j++
		}
		title := strings.TrimSpace(strings.Join(lines[i+1:min(j, len(lines))], " "))
		k := j + 1
		for k < len(lines) && !headerLine.MatchString(lines[k]) {
			k++
		}
		if j >= len(lines) {
			break
		}
		body := lines[j+1 : k]
		div := -1
		for n, l := range body {
			if dividerLine.MatchString(l) {
				div = n
			}
		}
		if div >= 0 {
			id := name + "#" + title
			if seen[id]++; seen[id] > 1 {
				id += "#" + strconv.Itoa(seen[id])
			}
			out = append(out, input{ID: id, Source: strings.TrimRight(strings.Join(body[:div], "\n"), "\n")})
		}
		i = k
	}
	return out
}

// readJSONL reads records with `id` and `source`; other fields are ignored.
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
		var in input
		if err := json.Unmarshal(line, &in); err != nil {
			return nil, fmt.Errorf("%s line %d: %w", path, n+1, err)
		}
		if in.ID == "" {
			return nil, fmt.Errorf("%s line %d: no id", path, n+1)
		}
		out = append(out, in)
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
				b, err = os.ReadFile(f)
				got = splitCorpus(name, string(b))
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
					return nil, fmt.Errorf("duplicate input id %q", in.ID)
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
		h := sha256.Sum256(src)
		r := dumpRecord{ID: in.ID, SHA256: hex.EncodeToString(h[:]), Error: t.RootNode().HasError()}
		r.Tree, r.Errors, r.Missing = treeString(t.RootNode())
		t.Close()
		if err := enc.Encode(r); err != nil {
			return err
		}
	}
	return bw.Flush()
}
