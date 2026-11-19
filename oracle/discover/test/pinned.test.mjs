import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutDiffers, extractVerified } from "../pinned.mjs";
import { readVerified } from "../inputs.mjs";
import { babel, oxc } from "../tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "discover-test-"));
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" });

test("a checkout whose bytes are not the commit's blobs is reported (CRLF conversion, edit, missing file)", () => {
  const d = tmp();
  try {
    const src = join(d, "src");
    mkdirSync(join(src, "t"), { recursive: true });
    writeFileSync(join(src, "t", "a.js"), "a\nb\n");
    writeFileSync(join(src, "t", "b.js"), "c\n");
    git(src, "init", "-q");
    git(src, "-c", "core.autocrlf=false", "add", ".");
    git(src, "commit", "-q", "-m", "x");
    const head = git(src, "rev-parse", "HEAD").trim();
    assert.deepEqual(checkoutDiffers(src, head, ["t"]), []);
    // a clone that converts line endings, as a Windows checkout with core.autocrlf=true does
    git(d, "clone", "-q", "-c", "core.autocrlf=true", "-c", "core.eol=crlf", src, join(d, "crlf"));
    assert.deepEqual(checkoutDiffers(join(d, "crlf"), head, ["t"]).sort(), ["t/a.js", "t/b.js"]);
    git(d, "clone", "-q", "-c", "core.autocrlf=false", src, join(d, "raw"));
    assert.deepEqual(checkoutDiffers(join(d, "raw"), head, ["t"]), []);
    writeFileSync(join(d, "raw", "t", "b.js"), "d\n");
    rmSync(join(d, "raw", "t", "a.js"));
    assert.deepEqual(checkoutDiffers(join(d, "raw"), head, ["t"]).sort(), ["t/a.js", "t/b.js"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("a tarball with other hashes is not extracted and leaves no extraction; a verified one is extracted afresh", () => {
  const d = tmp();
  try {
    mkdirSync(join(d, "package"));
    writeFileSync(join(d, "package", "a.js"), "a;\n");
    execFileSync("tar", ["-czf", "x.tgz", "package"], { cwd: d });
    const buf = readFileSync(join(d, "x.tgz"));
    const want = { sha256: createHash("sha256").update(buf).digest("hex"), integrity: "sha512-" + createHash("sha512").update(buf).digest("base64") };
    const dir = join(d, "pkgs", "x-1");
    const stale = () => {
      mkdirSync(join(dir, "package"), { recursive: true });
      writeFileSync(join(dir, "package", "stale.js"), "x\n");
    };
    for (const bad of [{ ...want, sha256: "0".repeat(64) }, { ...want, integrity: "sha512-AAAA" }]) {
      stale();
      const r = extractVerified(join(d, "x.tgz"), dir, bad);
      assert.equal(r.ok, false);
      assert.equal(existsSync(dir), false, "no extraction is left or reused");
      assert.equal(existsSync(`${dir}.partial`), false);
    }
    stale();
    const r = extractVerified(join(d, "x.tgz"), dir, want);
    assert.deepEqual([r.ok, r.sha256], [true, want.sha256]);
    assert.equal(readFileSync(join(dir, "package", "a.js"), "utf8"), "a;\n");
    assert.equal(existsSync(join(dir, "package", "stale.js")), false, "the old extraction is replaced, not reused");
    assert.equal(extractVerified(join(d, "x.tgz"), dir, null).ok, true, "--pin takes the tarball as it is");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("readVerified returns the text of the collected bytes and refuses anything else", () => {
  const d = tmp();
  try {
    const f = join(d, "a.js");
    writeFileSync(f, "a\n");
    const sum = createHash("sha256").update("a\n").digest("hex");
    assert.equal(readVerified(f, sum), "a\n");
    writeFileSync(f, "a\r\n"); // what a CRLF conversion would make of it
    assert.throws(() => readVerified(f, sum), /differs from the collected/);
    assert.throws(() => readVerified(join(d, "missing.js"), sum), /ENOENT/);
    assert.throws(() => readVerified(f, undefined), /no sha256 recorded/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("structure.mjs refuses a fractional or out-of-range --workers and a bad --max-bytes before doing anything", () => {
  for (const a of [["--workers", "1.5"], ["--workers", "4"], ["--workers", "0"], ["--max-bytes", "1.5"], ["--max-bytes", "x"]]) {
    const r = spawnSync(process.execPath, [join(here, "../structure.mjs"), ...a], { encoding: "utf8" });
    assert.notEqual(r.status, 0, a.join(" "));
    assert.match(r.stderr, /--workers must be|--max-bytes must be/, a.join(" "));
  }
});

test("tools.mjs gives the verdicts of oracle/run.mjs (the copy has not drifted)", () => {
  const d = tmp();
  try {
    const cases = [["a;", "script"], ["let a; let a;", "script"], ["a b", "script"], ["<a/>", "module"], ["x = é😀 +", "script"], ["await 1;", "module"], ["with (a) b;", "module"], ["a /* é */ ) 2", "script"]];
    const line = ([source, sourceType], i) => JSON.stringify({ id: `c${i}`, sha256: createHash("sha256").update(source, "utf8").digest("hex"), source, sourceType });
    writeFileSync(join(d, "cases.jsonl"), cases.map(line).join("\n") + "\n");
    execFileSync(process.execPath, [join(here, "../../run.mjs"), "--cases", join(d, "cases.jsonl"), "--out", join(d, "v.json")], { encoding: "utf8" });
    const { results } = JSON.parse(readFileSync(join(d, "v.json"), "utf8"));
    cases.forEach(([src, type], i) => {
      const r = results[i];
      const b = babel(src, type);
      const o = oxc(src, type);
      const what = JSON.stringify(src);
      assert.equal(b.c, r.babel.class, `babel class of ${what}`);
      assert.equal(o.c, r.oxc.class, `oxc class of ${what}`);
      if (b.c !== "accept") assert.equal(b.at, r.babel.errors[0].at, `babel position of ${what}`);
      if (o.c !== "accept") assert.equal(o.at, (o.c === "syntax" ? r.oxc.errors : r.oxc.errorsWithSemantic)[0].at, `oxc position of ${what}`);
    });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
