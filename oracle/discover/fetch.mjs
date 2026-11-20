// Fetches the discovery inputs into DATA (default build/discovery/data), pinned by manifest.json.
//   node fetch.mjs [--data DIR] [--pin]
// test262: `git clone` + checkout of the pinned commit. Packages: `npm pack name@version --ignore-scripts` (a registry
// download, no lifecycle script runs), then `tar -x` into its own directory. Nothing downloaded is ever executed.
// With --pin the tarball hashes are written to manifest.json; without it a mismatch is an error (exit 2): an archive whose
// sha256 or sha512 differs is never extracted, a stale extraction of it is removed, and every run extracts a verified
// tarball afresh. The git checkouts are made with core.autocrlf=false and every run checks that their files are byte for
// byte the blobs of the pinned commit and holds no other file under the pinned paths (an existing checkout with CRLF files
// or an extra file is an error: delete it and fetch again).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutDiffers, extractVerified } from "./pinned.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const data = resolve(flag("--data", join(here, "../../build/discovery/data")));
const pin = args.includes("--pin");
const manifestPath = join(here, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const run = (cmd, a, opt = {}) => execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" && cmd === "npm", ...opt });
const safe = (name) => name.replace(/^@/, "").replace("/", "__");
function checkBytes(repo, commit, paths, label) {
  const diff = checkoutDiffers(repo, commit, paths);
  if (!diff.length) return;
  console.error(`${label}: ${diff.length} files differ from the blobs of ${commit} or are not in its tree (first: ${diff.slice(0, 3).join(", ")}); delete ${repo} and fetch again`);
  process.exit(2);
}

// ---- test262 -------------------------------------------------------------------------------------------------------
const t262 = join(data, "test262");
if (!existsSync(t262)) {
  mkdirSync(data, { recursive: true });
  run("git", ["clone", "--quiet", "--no-checkout", "-c", "core.autocrlf=false", manifest.test262.repo, t262]);
  run("git", ["-C", t262, "fetch", "--quiet", "--depth", "1", "origin", manifest.test262.commit]);
  run("git", ["-C", t262, "checkout", "--quiet", manifest.test262.commit]);
}
const head = run("git", ["-C", t262, "rev-parse", "HEAD"]).trim();
if (head !== manifest.test262.commit) { console.error(`test262 is at ${head}, manifest pins ${manifest.test262.commit}`); process.exit(2); }
checkBytes(t262, head, ["features.txt", ...manifest.test262.roots], "test262");
console.log(`test262 ${head}`);

// ---- Babel's JSX fixtures (sparse checkout of one directory at the pinned commit) -----------------------------------
const bj = manifest.babel_jsx;
const babelDir = join(data, "babel-fixtures");
if (!existsSync(babelDir)) {
  run("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", "-c", "core.autocrlf=false", bj.repo, babelDir]);
  run("git", ["-C", babelDir, "sparse-checkout", "set", bj.path]);
  run("git", ["-C", babelDir, "checkout", "--quiet", bj.commit]);
}
const bhead = run("git", ["-C", babelDir, "rev-parse", "HEAD"]).trim();
if (bhead !== bj.commit) { console.error(`babel-fixtures is at ${bhead}, manifest pins ${bj.commit}`); process.exit(2); }
checkBytes(babelDir, bhead, [bj.path], "babel-fixtures");
console.log(`babel jsx fixtures ${bhead}`);

// ---- packages ------------------------------------------------------------------------------------------------------
let bad = 0;
for (const p of manifest.packages) {
  const dir = join(data, "pkgs", `${safe(p.name)}-${p.version}`);
  const tgzDir = join(data, "tarballs");
  mkdirSync(tgzDir, { recursive: true });
  const tgz = join(tgzDir, `${safe(p.name)}-${p.version}.tgz`);
  if (!existsSync(tgz)) {
    run("npm", ["pack", `${p.name}@${p.version}`, "--ignore-scripts", "--pack-destination", tgzDir]);
    // npm names the file `name-version.tgz`, with `scope-name-version.tgz` for a scoped package
    run("node", ["-e", `require('fs').renameSync(${JSON.stringify(join(tgzDir, `${p.name.replace(/^@/, "").replace("/", "-")}-${p.version}.tgz`))}, ${JSON.stringify(tgz)})`]);
  }
  const r = extractVerified(tgz, dir, pin ? null : p);
  if (pin) { p.sha256 = r.sha256; p.integrity = r.integrity; }
  else if (!r.ok) { console.error(`${p.name}@${p.version}: tarball hash differs from the manifest, not extracted`); bad++; continue; }
  console.log(`${p.name}@${p.version} ${r.sha256.slice(0, 12)}`);
}
if (pin) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
process.exit(bad ? 2 : 0);
