// Command replay judges the oracle's verdicts against this grammar through the tree-sitter API.
//
//	replay [-oracle DIR] [-tree]
//	replay -dump OUT.jsonl [-hash] [-root DIR] [INPUT...]
//
// The second form writes every input's tree as JSONL (see dump.go and oracle/README.md); exit 2 on any failure.
// Exit codes: 0 every gated case is consistent; 1 a result differs (listed); 2 the inputs are inconsistent
// (hash mismatch, verdicts made from other cases, another runner or other tool versions, a case that does not fit its
// verdict, a malformed record, an empty case set) or nothing could be judged. See oracle/README.md.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_javascript "github.com/wotjr1649/tree-sitter-javascript/bindings/go"
)

type verdictFile struct {
	Meta struct {
		Format       int    `json:"format"`
		Encoding     string `json:"encoding"`
		CasesSHA256  string `json:"cases_sha256"`
		RunnerSHA256 string `json:"runner_sha256"`
		Tools        map[string]struct {
			Package   string `json:"package"`
			Version   string `json:"version"`
			Integrity string `json:"integrity"`
		} `json:"tools"`
	} `json:"meta"`
	Results []struct {
		ID         string `json:"id"`
		SHA256     string `json:"sha256"`
		SourceType string `json:"sourceType"`
		Verdict    string `json:"verdict"`
		Babel      struct {
			Class string `json:"class"`
		} `json:"babel"`
		Oxc struct {
			Class string `json:"class"`
		} `json:"oxc"`
	} `json:"results"`
}

// pinnedTools are exactly the two tools of the consensus: verdicts.json `meta.tools` key and npm package.
var pinnedTools = []struct{ key, pkg string }{{"babel", "@babel/parser"}, {"oxc", "oxc-parser"}}

type manifest struct {
	Dependencies map[string]string `json:"dependencies"`
}

// consensus is the verdict two tool classes give: the common class, or disagree.
func consensus(babel, oxc string) string {
	if babel == oxc {
		return babel
	}
	return "disagree"
}

func validClass(c string) bool { return c == "accept" || c == "syntax" || c == "early" }

type lockFile struct {
	Packages map[string]struct {
		Version      string            `json:"version"`
		Integrity    string            `json:"integrity"`
		Dependencies map[string]string `json:"dependencies"`
	} `json:"packages"`
}

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// load reads and cross-checks every input; the returned problems mean exit 2.
func load(dir string) (cases []Case, verdicts map[string]string, problems []string, err error) {
	casesBytes, err := os.ReadFile(filepath.Join(dir, "cases.jsonl"))
	if err != nil {
		return nil, nil, nil, err
	}
	var vf verdictFile
	if err = readJSON(filepath.Join(dir, "verdicts.json"), &vf); err != nil {
		return nil, nil, nil, err
	}
	var lock lockFile
	if err = readJSON(filepath.Join(dir, "package-lock.json"), &lock); err != nil {
		return nil, nil, nil, err
	}
	var pkgJSON manifest
	if err = readJSON(filepath.Join(dir, "package.json"), &pkgJSON); err != nil {
		return nil, nil, nil, err
	}
	runner, err := os.ReadFile(filepath.Join(dir, "run.mjs"))
	if err != nil {
		return nil, nil, nil, err
	}
	bad := func(f string, a ...any) { problems = append(problems, fmt.Sprintf(f, a...)) }

	if vf.Meta.Format != 1 || vf.Meta.Encoding != "utf-8" {
		bad("verdicts.json: unsupported format %d / encoding %q", vf.Meta.Format, vf.Meta.Encoding)
	}
	if vf.Meta.CasesSHA256 != sum(casesBytes) {
		bad("verdicts.json was made from other cases (cases_sha256 %s, cases.jsonl %s)", vf.Meta.CasesSHA256, sum(casesBytes))
	}
	if vf.Meta.RunnerSHA256 != sum(runner) {
		bad("verdicts.json was made by another runner (runner_sha256 %s, run.mjs %s)", vf.Meta.RunnerSHA256, sum(runner))
	}
	// Exactly the two pinned tools, each equal in verdicts.json, package.json (an exact pin) and package-lock.json.
	if len(vf.Meta.Tools) != len(pinnedTools) {
		bad("verdicts.json must list exactly the tools babel and oxc, it lists %d", len(vf.Meta.Tools))
	}
	for _, p := range pinnedTools {
		t, ok := vf.Meta.Tools[p.key]
		if !ok || t.Package != p.pkg {
			bad("verdicts.json: tool %s must be %s, found %q", p.key, p.pkg, t.Package)
			continue
		}
		e := lock.Packages["node_modules/"+p.pkg]
		pin := pkgJSON.Dependencies[p.pkg]
		if t.Version == "" || t.Integrity == "" || e.Version != t.Version || e.Integrity != t.Integrity || pin != t.Version {
			bad("tool %s drifted: verdicts have %s %s %s, package-lock.json has %q %q, package.json pins %q",
				p.key, p.pkg, t.Version, t.Integrity, e.Version, e.Integrity, pin)
		}
	}

	verdicts = map[string]string{}
	byID := map[string]int{}
	for i, r := range vf.Results {
		if _, dup := byID[r.ID]; dup {
			bad("verdicts.json: duplicate id %s", r.ID)
		}
		byID[r.ID] = i
	}
	// One record per line, read to the end: a line that is not exactly one JSON object is an error.
	seen := map[string]bool{}
	for n, line := range bytes.Split(casesBytes, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		if line[0] != '{' {
			return nil, nil, nil, fmt.Errorf("cases.jsonl line %d is not a JSON object", n+1)
		}
		dec := json.NewDecoder(bytes.NewReader(line))
		dec.DisallowUnknownFields()
		var c Case
		if err := dec.Decode(&c); err != nil {
			return nil, nil, nil, fmt.Errorf("cases.jsonl line %d: %w", n+1, err)
		}
		if _, err := dec.Token(); err != io.EOF {
			return nil, nil, nil, fmt.Errorf("cases.jsonl line %d: more than one JSON value", n+1)
		}
		if c.SourceType == "" {
			c.SourceType = "module"
		}
		if c.SourceType != "module" && c.SourceType != "script" {
			bad("%s: sourceType must be module or script, found %q", c.ID, c.SourceType)
		}
		if seen[c.ID] || c.ID == "" {
			bad("cases.jsonl: empty or duplicate id %q", c.ID)
		}
		seen[c.ID] = true
		if c.SHA256 != sum([]byte(c.Source)) {
			bad("%s: sha256 does not match source", c.ID)
		}
		i, ok := byID[c.ID]
		switch {
		case !ok:
			bad("%s: no verdict", c.ID)
		case vf.Results[i].SHA256 != c.SHA256 || vf.Results[i].SourceType != c.SourceType:
			bad("%s: verdict made from other bytes or another sourceType", c.ID)
		}
		v := ""
		if ok {
			r := vf.Results[i]
			v = r.Verdict
			if !validClass(r.Babel.Class) || !validClass(r.Oxc.Class) {
				bad("%s: unknown tool class (babel %q, oxc %q)", c.ID, r.Babel.Class, r.Oxc.Class)
			} else if want := consensus(r.Babel.Class, r.Oxc.Class); v != want {
				bad("%s: verdict %q, but babel %s and oxc %s give %s", c.ID, v, r.Babel.Class, r.Oxc.Class, want)
			}
		}
		verdicts[c.ID] = v
		for _, e := range c.Expect {
			if _, _, _, err := parseExpect(e); err != nil {
				bad("%s: %v", c.ID, err)
			}
		}
		switch v {
		case "accept", "syntax", "early", "disagree":
		default:
			if ok {
				bad("%s: unknown verdict %q", c.ID, v)
			}
		}
		if len(c.Expect) > 0 && v != "accept" {
			bad("%s: expect only fits an accept verdict (verdict %s)", c.ID, v)
		}
		if (c.ErrorAt != nil) != (v == "syntax") && ok {
			bad("%s: errorAt is required for, and only fits, a syntax verdict (verdict %s)", c.ID, v)
		}
		if c.ErrorAt != nil && (*c.ErrorAt < 0 || *c.ErrorAt > len(c.Source)) {
			bad("%s: errorAt %d is outside the source (%d bytes)", c.ID, *c.ErrorAt, len(c.Source))
		}
		if (v == "early" || v == "disagree") && c.Reason == "" {
			bad("%s: a %s case needs a reason", c.ID, v)
		}
		cases = append(cases, c)
	}
	if len(cases) == 0 {
		bad("cases.jsonl has no cases: nothing to judge")
	}
	for id := range byID {
		if !seen[id] {
			bad("verdicts.json has %s, which cases.jsonl does not", id)
		}
	}
	sort.Strings(problems)
	return cases, verdicts, problems, nil
}

func main() { os.Exit(run()) }

func runDump(to, root string, patterns []string, hashTrees bool) error {
	if len(patterns) == 0 {
		patterns = defaultInputs
	}
	inputs, err := loadInputs(root, patterns)
	if err != nil {
		return err
	}
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(tree_sitter.NewLanguage(tree_sitter_javascript.Language())); err != nil {
		return err
	}
	w := os.Stdout
	if to != "-" {
		if w, err = os.Create(to); err != nil {
			return err
		}
	}
	if err := dump(parser, inputs, w, hashTrees); err != nil {
		w.Close()
		return err
	}
	fmt.Fprintf(os.Stderr, "dumped %d inputs\n", len(inputs))
	return w.Close()
}

func run() int {
	dir := flag.String("oracle", "..", "the oracle directory (cases.jsonl, verdicts.json, run.mjs, package-lock.json)")
	showTree := flag.Bool("tree", false, "print every case's tree with byte ranges (for writing expect entries)")
	dumpTo := flag.String("dump", "", "write the tree of every input as JSONL to this file (- for stdout) instead of judging")
	hashTrees := flag.Bool("hash", false, "write the SHA-256 of each tree in the dump")
	root := flag.String("root", "../..", "the repository root, for -dump inputs")
	flag.Parse()

	if *dumpTo != "" {
		if err := runDump(*dumpTo, *root, flag.Args(), *hashTrees); err != nil {
			fmt.Fprintln(os.Stderr, "replay:", err)
			return 2
		}
		return 0
	}

	cases, verdicts, problems, err := load(*dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "replay:", err)
		return 2
	}
	if len(problems) > 0 {
		fmt.Println("INCONSISTENT INPUTS:")
		for _, p := range problems {
			fmt.Println("  " + p)
		}
		return 2
	}

	lang := tree_sitter.NewLanguage(tree_sitter_javascript.Language())
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(lang); err != nil {
		fmt.Fprintln(os.Stderr, "replay: cannot load the grammar:", err)
		return 2
	}

	var differ []string
	tally := map[string]int{}
	for _, c := range cases {
		src := []byte(c.Source)
		tree := parser.Parse(src, nil)
		if tree == nil {
			fmt.Fprintf(os.Stderr, "replay: %s: parse returned no tree\n", c.ID)
			return 2
		}
		nodes := flatten(tree.RootNode())
		r := analyze(nodes, tree.RootNode().HasError(), src)
		tree.Close()

		v := verdicts[c.ID]
		diffs := check(c, v, nodes, r)
		status := "ok"
		switch {
		case len(diffs) > 0:
			status = "DIFF"
			for _, d := range diffs {
				differ = append(differ, c.ID+": "+d)
			}
		case v == "early" || v == "disagree":
			status = "info" // recorded, excluded from every gate
		}
		tally[v+" "+status]++
		fmt.Printf("%-4s %-8s %s  %s\n", status, v, c.ID, r)
		if *showTree {
			for _, n := range nodes {
				fmt.Printf("     %*s%s %d-%d\n", 2*n.depth, "", n.kind, n.start, n.end)
			}
		}
	}

	keys := make([]string, 0, len(tally))
	for k := range tally {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Printf("\n%d cases:", len(cases))
	for _, k := range keys {
		fmt.Printf(" [%s %d]", k, tally[k])
	}
	fmt.Println()
	if len(differ) > 0 {
		fmt.Println("\nRESULTS DIFFER:")
		for _, d := range differ {
			fmt.Println("  " + d)
		}
		return 1
	}
	return 0
}
