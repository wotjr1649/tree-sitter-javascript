// Command tsparse parses discovery inputs with this grammar through the tree-sitter API (the same grammar and the same
// faithfulness rule as oracle/replay: an input is clean when the tree has no ERROR, no MISSING and no zero-width node,
// and its leaves cover every byte that is not a gap character).
//
//	tsparse -in oracle.jsonl -data DIR -out ts.jsonl [-workers 3]   batch: one result per non-skipped record
//	tsparse -serve                                                 reads {"s":"source"} lines, answers {"e":..,"at":..}
//
// Offsets are UTF-8 bytes of the file (a `prefix` of the record is parsed but not counted). See README.md.
// A file that cannot be read, or whose sha256 is not the record's, is not parsed: its result has `bad` set, and the exit code is 3.
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_javascript "github.com/wotjr1649/tree-sitter-javascript/bindings/go"
)

const parseTimeout = 60 * time.Second

type record struct {
	ID     string `json:"id"`
	Skip   string `json:"skip"`
	Prefix string `json:"prefix"`
	Sha256 string `json:"sha256"` // of the file bytes, as collect.mjs judged them
}

// Result is one parse. Err means an ERROR or MISSING node or has_error; Clean is the stricter faithful-tree rule.
type Result struct {
	ID      string `json:"id"`
	N       int    `json:"n"`
	Clean   bool   `json:"clean"`
	Err     bool   `json:"err"`
	Timeout bool   `json:"timeout,omitempty"`
	Bad     string `json:"bad,omitempty"`     // "read-error" or "hash-mismatch": not the input collect judged, nothing was parsed
	Errors  int    `json:"errors,omitempty"`  // ERROR nodes
	Missing int    `json:"missing,omitempty"` // MISSING nodes
	Zero    int    `json:"zero,omitempty"`    // zero-width nodes other than MISSING
	Uncov   int    `json:"uncov"`             // first byte covered by no leaf, -1 when none
	Kind    string `json:"kind,omitempty"`    // first problem node kind
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Row     int    `json:"row"` // 0-based, of the first problem node
	Col     int    `json:"col"`
	Parent  string `json:"parent,omitempty"`
	Txt     string `json:"txt,omitempty"` // up to 48 bytes of the first problem node
	US      int64  `json:"us"`
}

func isGap(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF || r == 0x200B || r == 0x2060 }

type scan struct {
	src                   []byte
	pos, uncov            int
	errors, missing, zero int
	found                 bool
	firstKind             string
	firstStart, firstEnd  int
	firstRow, firstCol    int
	firstParent, firstTxt string
}

func (s *scan) gap(to int) int {
	for i := s.pos; i < to; {
		r, size := utf8.DecodeRune(s.src[i:])
		if r == utf8.RuneError && size <= 1 || !isGap(r) {
			return i
		}
		i += size
	}
	return -1
}

func (s *scan) problem(n *tree_sitter.Node) {
	if s.found {
		return
	}
	s.found = true
	s.firstKind = n.Kind()
	s.firstStart, s.firstEnd = int(n.StartByte()), int(n.EndByte())
	p := n.StartPosition()
	s.firstRow, s.firstCol = int(p.Row), int(p.Column)
	if par := n.Parent(); par != nil {
		s.firstParent = par.Kind()
	}
	e := s.firstEnd
	if e-s.firstStart > 48 {
		e = s.firstStart + 48
	}
	s.firstTxt = string(s.src[s.firstStart:e])
}

func (s *scan) walk(n *tree_sitter.Node, depth int) {
	switch {
	case n.IsError():
		s.errors++
		s.problem(n)
	case n.IsMissing():
		s.missing++
		s.problem(n)
	case n.StartByte() == n.EndByte() && depth > 0:
		s.zero++
		s.problem(n)
	}
	cc := n.ChildCount()
	if cc == 0 {
		st, en := int(n.StartByte()), int(n.EndByte())
		if n.IsMissing() || st == en {
			return
		}
		if s.uncov < 0 {
			if st < s.pos {
				s.uncov = st
			} else if i := s.gap(st); i >= 0 {
				s.uncov = i
			}
		}
		s.pos = en
		return
	}
	for i := uint(0); i < cc; i++ {
		s.walk(n.Child(i), depth+1)
	}
}

// parseTree parses src within parseTimeout; nil means the time ran out.
func parseTree(p *tree_sitter.Parser, src []byte) *tree_sitter.Tree {
	deadline := time.Now().Add(parseTimeout)
	tree := p.ParseWithOptions(func(off int, _ tree_sitter.Point) []byte {
		if off >= len(src) {
			return nil
		}
		return src[off:]
	}, nil, &tree_sitter.ParseOptions{ProgressCallback: func(tree_sitter.ParseState) bool { return time.Now().After(deadline) }})
	p.Reset()
	return tree
}

func parseOne(p *tree_sitter.Parser, src []byte, prefix int) Result {
	t0 := time.Now()
	tree := parseTree(p, src)
	if tree == nil {
		return Result{N: len(src) - prefix, Timeout: true, Err: true, Uncov: -1, US: time.Since(t0).Microseconds()}
	}
	defer tree.Close()
	return judge(tree, src, prefix, t0)
}

// judge applies the faithfulness rule to a parsed tree.
func judge(tree *tree_sitter.Tree, src []byte, prefix int, t0 time.Time) Result {
	root := tree.RootNode()
	s := &scan{src: src, uncov: -1}
	s.walk(root, 0)
	if s.uncov < 0 {
		s.uncov = s.gap(len(src))
	}
	sub := func(x int) int {
		if x < prefix {
			return 0
		}
		return x - prefix
	}
	r := Result{
		N: len(src) - prefix, Errors: s.errors, Missing: s.missing, Zero: s.zero, Uncov: s.uncov,
		Err:  root.HasError() || s.errors > 0 || s.missing > 0,
		Kind: s.firstKind, Start: sub(s.firstStart), End: sub(s.firstEnd), Row: s.firstRow, Col: s.firstCol,
		Parent: s.firstParent, Txt: s.firstTxt, US: time.Since(t0).Microseconds(),
	}
	if prefix > 0 && s.firstRow > 0 {
		r.Row-- // the prefix is one line
	}
	if r.Uncov >= 0 {
		r.Uncov = sub(r.Uncov)
	}
	r.Clean = !r.Err && s.zero == 0 && s.uncov < 0
	return r
}

func newParser() *tree_sitter.Parser {
	p := tree_sitter.NewParser()
	if err := p.SetLanguage(tree_sitter.NewLanguage(tree_sitter_javascript.Language())); err != nil {
		fmt.Fprintln(os.Stderr, "tsparse: cannot load the grammar:", err)
		os.Exit(2)
	}
	return p
}

// dump lists the named nodes whose kind id is wanted (all non-extra nodes when want is empty; extras such as comments only when wanted) as flat quintuples
// kind id, start byte, end byte, index of the nearest dumped ancestor (-1 for none), field id (0 for none), in document order.
func dump(tree *tree_sitter.Tree, want map[uint16]bool) []int {
	cur := tree.Walk()
	defer cur.Close()
	out := []int{}
	stack := []int{-1} // nearest dumped ancestor per depth
	for {
		n := cur.Node()
		parent := stack[len(stack)-1]
		me := parent
		if n.IsNamed() && (len(want) == 0 && !n.IsExtra() || len(want) > 0 && want[n.KindId()]) {
			me = len(out) / 5
			out = append(out, int(n.KindId()), int(n.StartByte()), int(n.EndByte()), parent, int(cur.FieldId()))
		}
		if cur.GotoFirstChild() {
			stack = append(stack, me)
			continue
		}
		for !cur.GotoNextSibling() {
			if !cur.GotoParent() {
				return out
			}
			stack = stack[:len(stack)-1]
		}
	}
}

func serve() int {
	p := newParser()
	lang := tree_sitter.NewLanguage(tree_sitter_javascript.Language())
	var want map[uint16]bool
	out := bufio.NewWriter(os.Stdout)
	dec := json.NewDecoder(bufio.NewReaderSize(os.Stdin, 1<<20))
	for {
		var req struct {
			S string `json:"s"`
			T bool   `json:"t"` // also return the S-expression
			// {"kinds":true} answers the kind and field id tables; {"want":[ids]} limits later dumps to those kinds;
			// {"s":..,"x":true} answers {"n":[kind,start,end,parent,field,...],"c":clean,"e":error} (see dump) instead of the verdict.
			Kinds bool  `json:"kinds"`
			Want  []int `json:"want"`
			X     bool  `json:"x"`
		}
		if err := dec.Decode(&req); err != nil {
			return 0
		}
		if req.Kinds {
			names := make([]string, lang.NodeKindCount())
			for i := range names {
				names[i] = lang.NodeKindForId(uint16(i))
			}
			fields := make([]string, lang.FieldCount()+1)
			for i := 1; i < len(fields); i++ {
				fields[i] = lang.FieldNameForId(uint16(i))
			}
			b, _ := json.Marshal(map[string][]string{"kinds": names, "fields": fields})
			fmt.Fprintf(out, "%s\n", b)
			out.Flush()
			continue
		}
		if req.Want != nil {
			want = map[uint16]bool{}
			for _, id := range req.Want {
				want[uint16(id)] = true
			}
			fmt.Fprintln(out, "{}")
			out.Flush()
			continue
		}
		if req.X {
			src := []byte(req.S)
			t := parseTree(p, src)
			nodes := []int{}
			clean, hasErr := false, true // a timeout is not clean
			if t != nil {
				r := judge(t, src, 0, time.Now())
				clean, hasErr = r.Clean, r.Err
				nodes = dump(t, want)
				t.Close()
			}
			b, _ := json.Marshal(nodes)
			fmt.Fprintf(out, "{\"n\":%s,\"c\":%t,\"e\":%t}\n", b, clean, hasErr)
			out.Flush()
			continue
		}
		r := parseOne(p, []byte(req.S), 0)
		tree := ""
		if req.T {
			if t := p.Parse([]byte(req.S), nil); t != nil {
				tree = t.RootNode().ToSexp()
				t.Close()
			}
		}
		fmt.Fprintf(out, "{\"e\":%t,\"c\":%t,\"at\":%d,\"k\":%q,\"p\":%q,\"t\":%q}\n", r.Err, r.Clean, r.Start, r.Kind, r.Parent, tree)
		out.Flush()
	}
}

func main() {
	inPath := flag.String("in", "", "oracle.jsonl from collect.mjs")
	data := flag.String("data", "", "data directory the record ids are relative to")
	outPath := flag.String("out", "", "ts.jsonl")
	workers := flag.Int("workers", 3, "parallel parsers (at most 3)")
	doServe := flag.Bool("serve", false, "answer JSON lines {\"s\":source} on stdin")
	flag.Parse()
	if *doServe {
		os.Exit(serve())
	}
	if *workers < 1 || *workers > 3 {
		fmt.Fprintln(os.Stderr, "tsparse: -workers must be 1..3 (RESOURCES.md)")
		os.Exit(2)
	}
	f, err := os.Open(*inPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "tsparse:", err)
		os.Exit(2)
	}
	var recs []record
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<26)
	for sc.Scan() {
		var r record
		if err := json.Unmarshal(sc.Bytes(), &r); err != nil {
			fmt.Fprintln(os.Stderr, "tsparse:", err)
			os.Exit(2)
		}
		if r.Skip == "" {
			recs = append(recs, r)
		}
	}
	f.Close()

	results := make([]Result, len(recs))
	var wg sync.WaitGroup
	next := make(chan int)
	var mu sync.Mutex
	done := 0
	t0 := time.Now()
	for w := 0; w < *workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p := newParser()
			defer p.Close()
			for i := range next {
				rec := recs[i]
				b, err := os.ReadFile(filepath.Join(*data, filepath.FromSlash(rec.ID)))
				if err != nil {
					results[i] = Result{ID: rec.ID, Uncov: -1, Bad: "read-error", Txt: err.Error()}
					continue
				}
				if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != rec.Sha256 {
					results[i] = Result{ID: rec.ID, Uncov: -1, Bad: "hash-mismatch", Txt: "sha256 differs from the collected " + rec.Sha256}
					continue
				}
				src := append([]byte(rec.Prefix), b...)
				results[i] = parseOne(p, src, len(rec.Prefix))
				results[i].ID = rec.ID
				mu.Lock()
				done++
				if done%10000 == 0 {
					fmt.Fprintf(os.Stderr, "%d parsed, %.0f s\n", done, time.Since(t0).Seconds())
				}
				mu.Unlock()
			}
		}()
	}
	for i := range recs {
		next <- i
	}
	close(next)
	wg.Wait()

	o, err := os.Create(*outPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "tsparse:", err)
		os.Exit(2)
	}
	w := bufio.NewWriterSize(o, 1<<20)
	enc := json.NewEncoder(w)
	nerr, nbad := 0, 0
	for _, r := range results {
		if r.Err {
			nerr++
		}
		if r.Bad != "" {
			nbad++
		}
		enc.Encode(r)
	}
	w.Flush()
	o.Close()
	fmt.Printf("tsparse: %d parsed, %d with error, %d unreadable or changed, %.0f s\n", len(results), nerr, nbad, time.Since(t0).Seconds())
	if nbad > 0 {
		os.Exit(3) // the results are written, but a changed input is no parser result: analyze.mjs sets it apart
	}
}
