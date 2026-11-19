// Node-kind/field snapshot of src/node-types.json, the grammar's public contract (AGENTS.md).
//
// One tab-separated line per fact, sorted: `kind <kind>`, `field <parent> <field> <type>`, `subtype <supertype> <type>`.
// Named kinds are bare, anonymous kinds are JSON-quoted (`"="`), so `this` and `"this"` differ.
//
// Usage: node scripts/node-types-snapshot.mjs [--update] [--node-types FILE] [--snapshot FILE]
//   check (default): exit 1 when a kind, a field or a field type of the snapshot is gone (a rename is a removal);
//   additions and removed subtypes are reported only. --update rewrites the snapshot. Exit 2: unreadable input.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const name = (t) => (t.named ? t.type : JSON.stringify(t.type));

export function snapshot(nodeTypes) {
  const lines = new Set();
  for (const n of nodeTypes) {
    lines.add(`kind\t${name(n)}`);
    for (const [field, info] of Object.entries(n.fields ?? {}))
      for (const t of info.types) lines.add(`field\t${name(n)}\t${field}\t${name(t)}`);
    for (const t of n.subtypes ?? []) lines.add(`subtype\t${name(n)}\t${name(t)}`);
  }
  return [...lines].sort();
}

// Compares snapshot lines; `failures` are the breaking removals, `notes` everything else that changed.
export function compare(before, after) {
  const now = new Set(after);
  const fields = new Set(after.filter((l) => l.startsWith('field\t')).map((l) => l.split('\t').slice(0, 3).join('\t')));
  const failures = [];
  const notes = [];
  for (const l of before) {
    if (now.has(l)) continue;
    const [cat, a, b, c] = l.split('\t');
    if (cat === 'kind') failures.push(`removed kind ${a}`);
    else if (cat === 'subtype') notes.push(`removed subtype ${b} of ${a}`);
    else if (fields.has(`field\t${a}\t${b}`)) failures.push(`removed type ${c} of field ${a}.${b}`);
    else if (!failures.includes(`removed field ${a}.${b}`)) failures.push(`removed field ${a}.${b}`);
  }
  const old = new Set(before);
  for (const l of after) if (!old.has(l)) notes.push(`added ${l.replaceAll('\t', ' ')}`);
  return { failures, notes };
}

function main(argv) {
  const opt = (flag, def) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : def);
  const nodeTypesPath = opt('--node-types', 'src/node-types.json');
  const snapshotPath = opt('--snapshot', 'test/node-types-snapshot.txt');
  const current = snapshot(JSON.parse(readFileSync(nodeTypesPath, 'utf8')));
  if (argv.includes('--update')) {
    writeFileSync(snapshotPath, current.join('\n') + '\n');
    console.log(`wrote ${current.length} lines to ${snapshotPath}`);
    return 0;
  }
  const committed = readFileSync(snapshotPath, 'utf8').split('\n').filter(Boolean);
  const { failures, notes } = compare(committed, current);
  for (const n of notes) console.log(`::notice::${n}`);
  for (const f of failures) console.log(`::error::${f}`);
  console.log(`${snapshotPath}: ${failures.length} breaking removal(s), ${notes.length} other change(s)`);
  if (failures.length)
    console.error('A node kind or field is a public contract: removing or renaming one needs a major release.');
  return failures.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`node-types-snapshot: ${e.message}`);
    process.exitCode = 2;
  }
}
