// Fetches the discovery inputs into DATA (default build/discovery/data), pinned by manifest.json.
//   node fetch.mjs [--data DIR] [--pin]
// test262: `git clone` + checkout of the pinned commit. Packages: `npm pack name@version --ignore-scripts` (a registry
// download, no lifecycle script runs), then `tar -x` into its own directory. Nothing downloaded is ever executed.
// With --pin the tarball hashes are written to manifest.json; without it a mismatch is an error (exit 2).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const data = resolve(flag("--data", join(here, "../../build/discovery/data")));
const pin = args.includes("--pin");
const manifestPath = join(here, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const run = (cmd, a, opt = {}) => execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" && cmd === "npm", ...opt });
const safe = (name) => name.replace(/^@/, "").replace("/", "__");

// ---- test262 -------------------------------------------------------------------------------------------------------
const t262 = join(data, "test262");
if (!existsSync(t262)) {
  mkdirSync(data, { recursive: true });
  run("git", ["clone", "--quiet", "--no-checkout", manifest.test262.repo, t262]);
  run("git", ["-C", t262, "fetch", "--quiet", "--depth", "1", "origin", manifest.test262.commit]);
  run("git", ["-C", t262, "checkout", "--quiet", manifest.test262.commit]);
}
const head = run("git", ["-C", t262, "rev-parse", "HEAD"]).trim();
if (head !== manifest.test262.commit) { console.error(`test262 is at ${head}, manifest pins ${manifest.test262.commit}`); process.exit(2); }
console.log(`test262 ${head}`);

// ---- Babel's JSX fixtures (sparse checkout of one directory at the pinned commit) -----------------------------------
const bj = manifest.babel_jsx;
const babelDir = join(data, "babel-fixtures");
if (!existsSync(babelDir)) {
  run("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", bj.repo, babelDir]);
  run("git", ["-C", babelDir, "sparse-checkout", "set", bj.path]);
  run("git", ["-C", babelDir, "checkout", "--quiet", bj.commit]);
}
const bhead = run("git", ["-C", babelDir, "rev-parse", "HEAD"]).trim();
if (bhead !== bj.commit) { console.error(`babel-fixtures is at ${bhead}, manifest pins ${bj.commit}`); process.exit(2); }
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
  const buf = readFileSync(tgz);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const sha512 = "sha512-" + createHash("sha512").update(buf).digest("base64");
  if (pin) { p.sha256 = sha256; p.integrity = sha512; }
  else if (p.sha256 !== sha256 || p.integrity !== sha512) { console.error(`${p.name}@${p.version}: tarball hash differs from the manifest`); bad++; }
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); run("tar", ["-xzf", relative(dir, tgz).replaceAll("\\", "/")], { cwd: dir }); } // relative name: GNU tar reads `D:` as a host
  console.log(`${p.name}@${p.version} ${sha256.slice(0, 12)}`);
}
if (pin) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
process.exit(bad ? 2 : 0);
