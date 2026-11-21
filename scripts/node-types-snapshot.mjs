// Snapshot of src/node-types.json, the grammar's public contract (AGENTS.md).
//
// One tab-separated line per fact, sorted: `kind <kind>`, `field <parent> <field> <type>`,
// `child <parent> <type>`, `subtype <supertype> <type>`,
// `multiple <parent> <field|children>`, and `required <parent> <field|children>`.
// Named kinds are bare, anonymous kinds are JSON-quoted (`"="`), so `this` and `"this"` differ.
// Flags are recorded when true. In flag lines, `"children"` names a field and `children` names unnamed children.
//
// Usage: node scripts/node-types-snapshot.mjs [--update] [--node-types FILE] [--snapshot FILE]
//   check (default): exit 1 on a removed kind, field, field type, child type or subtype, a lost `multiple` flag,
//   or a previously optional field or children becoming required. Other changes are notices.
//   --update rewrites the snapshot. Regenerate older snapshots from their baseline JSON to include flags.
//   Exit 2: unreadable input.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const name = (t) => (t.named ? t.type : JSON.stringify(t.type));

function addFlags(lines, parent, target, info) {
  if (info.multiple) lines.add(`multiple\t${parent}\t${target}`);
  if (info.required) lines.add(`required\t${parent}\t${target}`);
}

export function snapshot(nodeTypes) {
  const lines = new Set();
  for (const n of nodeTypes) {
    const parent = name(n);
    lines.add(`kind\t${parent}`);
    for (const [field, info] of Object.entries(n.fields ?? {})) {
      for (const t of info.types) lines.add(`field\t${parent}\t${field}\t${name(t)}`);
      addFlags(lines, parent, field === 'children' ? '"children"' : field, info);
    }
    if (n.children) {
      for (const t of n.children.types) lines.add(`child\t${parent}\t${name(t)}`);
      addFlags(lines, parent, 'children', n.children);
    }
    for (const t of n.subtypes ?? []) lines.add(`subtype\t${parent}\t${name(t)}`);
  }
  return [...lines].sort();
}

// Compares snapshot lines; `failures` are the breaking changes, `notes` everything else that changed.
export function compare(before, after) {
  const now = new Set(after);
  const fields = new Set(after.filter((l) => l.startsWith('field\t')).map((l) => l.split('\t').slice(0, 3).join('\t')));
  const failures = [];
  const notes = [];
  for (const l of before) {
    if (now.has(l)) continue;
    const [cat, a, b, c] = l.split('\t');
    if (cat === 'kind') failures.push(`removed kind ${a}`);
    else if (cat === 'subtype') failures.push(`removed subtype ${b} of ${a}`);
    else if (cat === 'child') failures.push(`removed child type ${b} of ${a}`);
    else if (cat === 'multiple') failures.push(`removed multiple ${a} ${b}`);
    else if (cat === 'required') notes.push(`removed required ${a} ${b}`);
    else if (fields.has(`field\t${a}\t${b}`)) failures.push(`removed type ${c} of field ${a}.${b}`);
    else if (!failures.includes(`removed field ${a}.${b}`)) failures.push(`removed field ${a}.${b}`);
  }
  const old = new Set(before);
  for (const l of after) {
    if (old.has(l)) continue;
    const message = `added ${l.replaceAll('\t', ' ')}`;
    const [cat, parent, target] = l.split('\t');
    if (cat === 'required') {
      const field = target === '"children"' ? 'children' : target;
      const prefix = target === 'children' ? `child\t${parent}\t` : `field\t${parent}\t${field}\t`;
      if (before.some((line) => line.startsWith(prefix))) {
        failures.push(message);
        continue;
      }
    }
    notes.push(message);
  }
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
  console.log(`${snapshotPath}: ${failures.length} breaking change(s), ${notes.length} other change(s)`);
  if (failures.length)
    console.error('Review changes to the node-types contract before updating the snapshot. Removing or renaming a node kind, field or supertype subtype needs a major release.');
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
