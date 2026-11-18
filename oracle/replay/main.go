// Command replay judges the oracle's verdicts against this grammar through the tree-sitter API.
//
//	go run . [-oracle DIR] [-tree]
//
// Exit codes: 0 every gated case is consistent; 1 a result differs (listed); 2 the inputs are inconsistent
// (hash mismatch, verdicts made from other cases, another runner or other tool versions, a case that does not fit its
// verdict) or nothing could be judged. See oracle/README.md.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
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
	} `json:"results"`
}

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
	if len(vf.Meta.Tools) == 0 {
		bad("verdicts.json lists no tools")
	}
	for name, t := range vf.Meta.Tools {
		e := lock.Packages["node_modules/"+t.Package]
		if e.Version != t.Version || e.Integrity != t.Integrity || t.Integrity == "" || lock.Packages[""].Dependencies[t.Package] != t.Version {
			bad("tool %s drifted: verdicts have %s %s %s, package-lock.json has %q %q, package.json pins %q",
				name, t.Package, t.Version, t.Integrity, e.Version, e.Integrity, lock.Packages[""].Dependencies[t.Package])
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
	dec := json.NewDecoder(bytes.NewReader(casesBytes))
	dec.DisallowUnknownFields()
	seen := map[string]bool{}
	for n := 1; dec.More(); n++ {
		var c Case
		if err := dec.Decode(&c); err != nil {
			return nil, nil, nil, fmt.Errorf("cases.jsonl record %d: %w", n, err)
		}
		if c.SourceType == "" {
			c.SourceType = "module"
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
			v = vf.Results[i].Verdict
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
	for id := range byID {
		if !seen[id] {
			bad("verdicts.json has %s, which cases.jsonl does not", id)
		}
	}
	sort.Strings(problems)
	return cases, verdicts, problems, nil
}

func main() { os.Exit(run()) }

func run() int {
	dir := flag.String("oracle", "..", "the oracle directory (cases.jsonl, verdicts.json, run.mjs, package-lock.json)")
	showTree := flag.Bool("tree", false, "print every case's tree with byte ranges (for writing expect entries)")
	flag.Parse()

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
