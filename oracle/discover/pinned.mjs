// Pinned inputs: the checkout of a pinned git commit must hold exactly the commit's blobs: a CRLF conversion (core.autocrlf, an eol
// attribute) changes the bytes the tools judge. `git hash-object --no-filters` hashes the working-tree bytes as they are.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

// The paths under `paths` (relative to `repo`) whose working-tree bytes differ from the blob of `commit`, or that are
// missing. An empty list means the checkout is the commit.
export function checkoutDiffers(repo, commit, paths) {
  const git = (a, input) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", input, maxBuffer: 1 << 29, stdio: ["pipe", "pipe", "inherit"] });
  const blobs = [];
  for (const e of git(["ls-tree", "-r", "-z", commit, "--", ...paths]).split("\0")) {
    const m = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/.exec(e);
    if (m) blobs.push([m[2], m[1]]);
  }
  if (blobs.some(([p]) => /[\r\n]/.test(p))) throw new Error("a path with a line break cannot be checked");
  const present = blobs.filter(([p]) => existsSync(join(repo, p)));
  const oids = present.length ? git(["hash-object", "--no-filters", "--stdin-paths"], present.map(([p]) => p).join("\n") + "\n").split("\n") : [];
  const have = new Map(present.map(([p], i) => [p, oids[i]]));
  return blobs.filter(([p, oid]) => have.get(p) !== oid).map(([p]) => p);
}

// Extracts the tarball `tgz` into `dir` only when its hashes are `want` ({sha256, integrity}; null: take it as it is, for
// --pin). A previous extraction is always removed first, so one is never reused and a mismatch leaves none; the files go to
// `dir.partial` and are renamed, so a `dir` that exists is complete. Returns {ok, sha256, integrity} of the tarball.
export function extractVerified(tgz, dir, want) {
  const buf = readFileSync(tgz);
  const got = { sha256: createHash("sha256").update(buf).digest("hex"), integrity: "sha512-" + createHash("sha512").update(buf).digest("base64") };
  for (const d of [dir, `${dir}.partial`]) rmSync(d, { recursive: true, force: true });
  if (want && (want.sha256 !== got.sha256 || want.integrity !== got.integrity)) return { ok: false, ...got };
  mkdirSync(`${dir}.partial`, { recursive: true });
  execFileSync("tar", ["-xzf", relative(`${dir}.partial`, tgz).replaceAll("\\", "/")], { cwd: `${dir}.partial` }); // relative name: GNU tar reads `D:` as a host
  renameSync(`${dir}.partial`, dir);
  return { ok: true, ...got };
}
