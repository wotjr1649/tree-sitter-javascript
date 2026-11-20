// Compares two tree dumps of `oracle/replay -dump` (base, then head) input by input, matched by id.
//
// Classes: same (equal tree and flags), changed-clean (both without ERROR/MISSING, tree differs), clean-to-error, error-to-clean,
// error-changed (both with errors, tree differs), and only-base / only-head for ids in one dump. An input whose source
// differs between the dumps (sha256) is refused: the dumps must come from the same inputs.
//
// Usage: node scripts/tree-diff.mjs BASE.jsonl HEAD.jsonl [--trees] [--check] [--inputs=INPUTS.jsonl]
//   --trees includes tree values; --check requires nonempty, identical dumps (exit 1 on differences).
//   --inputs checks each dump against the selected IDs (exit 1 on differences). Exit 2 on bad input.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CLASSES = ['same', 'changed-clean', 'clean-to-error', 'error-to-clean', 'error-changed', 'only-base', 'only-head'];

const count = (n) => Number.isInteger(n) && n >= 0;

// readDump reads every record of a dump; a record without a valid field the comparison uses is refused.
export function readDump(text, name = 'dump') {
  const out = new Map();
  text.split('\n').forEach((line, n) => {
    if (!line.trim()) return;
    const where = `${name} line ${n + 1}`;
    let r;
    try {
      r = JSON.parse(line);
    } catch (e) {
      throw new Error(`${where}: ${e.message}`);
    }
    const ok =
      r !== null && typeof r.id === 'string' && r.id !== '' && typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256) && typeof r.tree === 'string' &&
      typeof r.error === 'boolean' && count(r.errors) && count(r.missing);
    if (!ok) throw new Error(`${where}: not a tree dump record (id, 64-hex sha256, tree, error, errors, missing): ${line.slice(0, 80)}`);
    if (out.has(r.id)) throw new Error(`${where}: duplicate id ${r.id}`);
    out.set(r.id, r);
  });
  return out;
}

const bad = (r) => r.error || r.errors > 0 || r.missing > 0;

export function classify(b, h) {
  if (!h) return 'only-base';
  if (!b) return 'only-head';
  if (b.sha256 !== h.sha256) throw new Error(`${b.id}: the source differs between the dumps`);
  if (b.tree === h.tree && b.error === h.error && b.errors === h.errors && b.missing === h.missing) return 'same';
  if (bad(b)) return bad(h) ? 'error-changed' : 'error-to-clean';
  return bad(h) ? 'clean-to-error' : 'changed-clean';
}

export function diff(base, head) {
  const groups = Object.fromEntries(CLASSES.map((c) => [c, []]));
  for (const id of new Set([...base.keys(), ...head.keys()])) groups[classify(base.get(id), head.get(id))].push(id);
  return groups;
}

export function report(groups, base, head, trees) {
  const lines = ['| class | inputs |', '| --- | ---: |', ...CLASSES.map((c) => `| ${c} | ${groups[c].length} |`)];
  for (const c of CLASSES.slice(1)) {
    if (!groups[c].length) continue;
    lines.push('', `### ${c}`, '');
    for (const id of groups[c]) {
      lines.push(`- \`${id}\``);
      if (trees) {
        if (base.has(id)) lines.push(`  - base: \`${base.get(id).tree}\``);
        if (head.has(id)) lines.push(`  - head: \`${head.get(id).tree}\``);
      }
    }
  }
  return lines.join('\n');
}

function readInputIDs(file) {
  const ids = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const id = JSON.parse(line)?.id;
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new Error(`${file}: invalid or duplicate input ID ${JSON.stringify(id)}`);
    }
    ids.add(id);
  }
  if (!ids.size) throw new Error(`${file}: empty input list`);
  return ids;
}

function checkInputs(file, dump, ids) {
  const missing = [...ids].filter((id) => !dump.has(id));
  const extra = [...dump.keys()].filter((id) => !ids.has(id));
  if (!missing.length && !extra.length) return true;

  const details = [`expected ${ids.size} inputs, got ${dump.size}`];
  if (missing.length) details.push(`missing ${JSON.stringify(missing)}`);
  if (extra.length) details.push(`unexpected ${JSON.stringify(extra)}`);
  console.log(`${file}: ${details.join('; ')}`);
  return false;
}

function main(argv) {
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length !== 2) throw new Error('usage: tree-diff.mjs BASE.jsonl HEAD.jsonl [--trees] [--check] [--inputs=INPUTS.jsonl]');
  const [base, head] = files.map((f) => readDump(readFileSync(f, 'utf8'), f));
  const inputs = argv.find((a) => a.startsWith('--inputs='));
  if (inputs !== undefined) {
    const ids = readInputIDs(inputs.slice('--inputs='.length));
    const baseMatches = checkInputs(files[0], base, ids);
    const headMatches = checkInputs(files[1], head, ids);
    if (!baseMatches || !headMatches) return 1;
  }
  const check = argv.includes('--check');
  if (check && (!base.size || !head.size)) throw new Error('cannot check an empty dump');
  const groups = diff(base, head);
  console.log(report(groups, base, head, argv.includes('--trees')));
  if (check && CLASSES.slice(1).some((c) => groups[c].length)) return 1;
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`tree-diff: ${e.message}`);
    process.exitCode = 2;
  }
}
