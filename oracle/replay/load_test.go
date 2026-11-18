package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

var oracleFiles = []string{"cases.jsonl", "verdicts.json", "run.mjs", "package-lock.json", "package.json"}

// oracleCopy is a mutable copy of the committed oracle inputs.
type oracleCopy struct {
	files    map[string]string
	verdicts map[string]any // decoded verdicts.json, written back by write
}

func (o *oracleCopy) meta() map[string]any  { return o.verdicts["meta"].(map[string]any) }
func (o *oracleCopy) tools() map[string]any { return o.meta()["tools"].(map[string]any) }
func (o *oracleCopy) results() []any        { return o.verdicts["results"].([]any) }
func (o *oracleCopy) result(id string) map[string]any {
	for _, r := range o.results() {
		if r.(map[string]any)["id"] == id {
			return r.(map[string]any)
		}
	}
	panic("no result " + id)
}

// editCase rewrites the record of one case in cases.jsonl.
func (o *oracleCopy) editCase(id string, edit func(map[string]any)) {
	lines := strings.Split(strings.TrimSuffix(o.files["cases.jsonl"], "\n"), "\n")
	for i, l := range lines {
		var m map[string]any
		if err := json.Unmarshal([]byte(l), &m); err != nil {
			panic(err)
		}
		if m["id"] == id {
			edit(m)
			b, _ := json.Marshal(m)
			lines[i] = string(b)
			o.files["cases.jsonl"] = strings.Join(lines, "\n") + "\n"
			return
		}
	}
	panic("no case " + id)
}

// load copies the oracle, applies mutate, keeps cases_sha256 equal to the (possibly changed) cases.jsonl so that only the
// intended inconsistency is left, and runs load on the copy.
func loadMutated(t *testing.T, mutate func(o *oracleCopy)) ([]Case, []string, error) {
	t.Helper()
	o := &oracleCopy{files: map[string]string{}}
	for _, f := range oracleFiles {
		b, err := os.ReadFile(filepath.Join("..", f))
		if err != nil {
			t.Fatal(err)
		}
		o.files[f] = string(b)
	}
	if err := json.Unmarshal([]byte(o.files["verdicts.json"]), &o.verdicts); err != nil {
		t.Fatal(err)
	}
	mutate(o)
	o.meta()["cases_sha256"] = sum([]byte(o.files["cases.jsonl"]))
	vb, _ := json.Marshal(o.verdicts)
	o.files["verdicts.json"] = string(vb)
	dir := t.TempDir()
	for f, text := range o.files {
		if err := os.WriteFile(filepath.Join(dir, f), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cases, _, problems, err := load(dir)
	return cases, problems, err
}

func TestLoadAcceptsTheCommittedOracle(t *testing.T) {
	cases, p, err := loadMutated(t, func(*oracleCopy) {})
	if err != nil || len(p) != 0 || len(cases) == 0 {
		t.Fatalf("the committed oracle must be consistent: %d cases, %v, %v", len(cases), p, err)
	}
}

// TestLoadRefusesInconsistentInputs breaks one thing at a time; every one must be refused (exit 2).
func TestLoadRefusesInconsistentInputs(t *testing.T) {
	jsonl := func(o *oracleCopy, s string) { o.files["cases.jsonl"] = s }
	broken := map[string]func(o *oracleCopy){
		"a case's source changed (sha256 mismatch)": func(o *oracleCopy) {
			o.files["cases.jsonl"] = strings.Replace(o.files["cases.jsonl"], `"source":"a?.delete(b)"`, `"source":"a?.delete(c)"`, 1)
		},
		"another runner": func(o *oracleCopy) { o.files["run.mjs"] += "// changed\n" },
		"lockfile version drift": func(o *oracleCopy) {
			o.files["package-lock.json"] = strings.Replace(o.files["package-lock.json"],
				"\"node_modules/oxc-parser\": {\n      \"version\": \"0.159.0\"", "\"node_modules/oxc-parser\": {\n      \"version\": \"0.159.1\"", 1)
		},
		"package.json pin differs from meta and lockfile": func(o *oracleCopy) {
			o.files["package.json"] = strings.Replace(o.files["package.json"], `"oxc-parser": "0.159.0"`, `"oxc-parser": "0.159.1"`, 1)
		},
		"package.json range instead of an exact pin": func(o *oracleCopy) {
			o.files["package.json"] = strings.Replace(o.files["package.json"], `"@babel/parser": "8.1.2"`, `"@babel/parser": "^8.1.2"`, 1)
		},
		"a tool missing from meta": func(o *oracleCopy) { delete(o.tools(), "oxc") },
		"an unknown tool in meta": func(o *oracleCopy) {
			o.tools()["acorn"] = o.tools()["oxc"]
		},
		"a tool's package renamed in meta": func(o *oracleCopy) {
			o.tools()["oxc"].(map[string]any)["package"] = "acorn"
		},
		"a consensus verdict that its sub-results do not give": func(o *oracleCopy) {
			// j2/reject-no-name is syntax in both tools; relabel it disagree and make the case fit that label
			o.result("j2/reject-no-name")["verdict"] = "disagree"
			o.editCase("j2/reject-no-name", func(m map[string]any) {
				delete(m, "errorAt")
				m["reason"] = "x"
			})
		},
		"an unknown class in a sub-result": func(o *oracleCopy) {
			o.result("j2/reject-no-name")["babel"].(map[string]any)["class"] = "bogus"
		},
		"trailing bytes after the JSONL": func(o *oracleCopy) { jsonl(o, o.files["cases.jsonl"]+"]\n") },
		"a record that is not an object": func(o *oracleCopy) { jsonl(o, o.files["cases.jsonl"]+"null\n") },
		"two records on one line": func(o *oracleCopy) {
			lines := strings.SplitN(o.files["cases.jsonl"], "\n", 2)
			jsonl(o, lines[0]+lines[0]+"\n"+lines[1])
		},
		"an invalid sourceType": func(o *oracleCopy) {
			o.editCase("j2/optchain-delete-call", func(m map[string]any) { m["sourceType"] = "bogus" })
			o.result("j2/optchain-delete-call")["sourceType"] = "bogus"
		},
		"an empty case set": func(o *oracleCopy) {
			jsonl(o, "")
			o.verdicts["results"] = []any{}
		},
	}
	for name, mutate := range broken {
		if _, p, err := loadMutated(t, mutate); err == nil && len(p) == 0 {
			t.Errorf("%s: want an error or inconsistent-input problems, got none", name)
		}
	}
}

// TestRunnerRefusesMalformedCases runs the real run.mjs on bad case files: exit 2, nothing written.
func TestRunnerRefusesMalformedCases(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	good, err := os.ReadFile("../cases.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	bad := map[string]string{
		"a null record":         string(good) + "null\n",
		"an array record":       string(good) + "[1]\n",
		"an empty case set":     "",
		"a blank-only file":     "\n\n",
		"an invalid sourceType": `{"id":"x","sha256":"` + sum([]byte("a")) + `","source":"a","sourceType":"bogus"}` + "\n",
	}
	for name, content := range bad {
		dir := t.TempDir()
		cases, out := filepath.Join(dir, "cases.jsonl"), filepath.Join(dir, "verdicts.json")
		if err := os.WriteFile(cases, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(node, "../run.mjs", "--cases", cases, "--out", out)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		err := cmd.Run()
		ee, ok := err.(*exec.ExitError)
		if !ok || ee.ExitCode() != 2 {
			t.Errorf("%s: want exit 2, got %v (stderr: %s)", name, err, stderr.String())
		}
		if _, statErr := os.Stat(out); statErr == nil {
			t.Errorf("%s: a verdict file was written", name)
		}
	}
}
