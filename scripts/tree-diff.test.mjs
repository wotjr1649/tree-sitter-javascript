import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diff, readDump, report } from './tree-diff.mjs';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const rec = (id, tree, errors = 0, sha256 = hash(id)) => JSON.stringify({ id, sha256, error: errors > 0, errors, missing: 0, tree });

const base = readDump(
  [rec('a', '(p)'), rec('b', '(p (x))'), rec('c', '(p)'), rec('d', '(ERROR)', 1), rec('e', '(ERROR)', 1), rec('f', '(ERROR)', 1), rec('g', '(p)')].join('\n'),
);
const head = readDump(
  [rec('a', '(p)'), rec('b', '(p (y))'), rec('c', '(ERROR)', 1), rec('d', '(p)'), rec('e', '(ERROR (x))', 1), rec('f', '(ERROR)', 1), rec('h', '(p)')].join('\n'),
);

test('diff sorts every input into one class', () => {
  assert.deepEqual(diff(base, head), {
    same: ['a', 'f'],
    'changed-clean': ['b'],
    'clean-to-error': ['c'],
    'error-to-clean': ['d'],
    'error-changed': ['e'],
    'only-base': ['g'],
    'only-head': ['h'],
  });
});

test('a dump compared with itself is all same', () => {
  const g = diff(base, base);
  assert.equal(g.same.length, base.size);
  assert.match(report(g, base, base, false), /\| changed-clean \| 0 \|/);
});

test('report lists changed ids and, with trees, both trees', () => {
  const r = report(diff(base, head), base, head, true);
  assert.match(r, /\| same \| 2 \|/);
  assert.match(r, /### changed-clean\n\n- `b`\n  - base: `\(p \(x\)\)`\n  - head: `\(p \(y\)\)`/);
});

test('different sources and duplicate ids are refused', () => {
  assert.throws(() => diff(readDump(rec('a', '(p)')), readDump(rec('a', '(p)', 0, hash('other')))), /source differs/);
  assert.throws(() => readDump([rec('a', '(p)'), rec('a', '(p)')].join('\n')), /line 2: duplicate id a/);
});

test('a record without a valid id, sha256, tree or error flags is refused', () => {
  const good = JSON.parse(rec('a', '(p)'));
  const cases = [{ id: undefined }, { id: '' }, { sha256: undefined }, { sha256: 'a'.repeat(63) }, { sha256: 'A'.repeat(64) },
    { tree: undefined }, { error: undefined }, { error: 0 }, { errors: undefined }, { missing: -1 }];
  for (const c of cases) {
    assert.throws(() => readDump(JSON.stringify({ ...good, ...c }), 'x.jsonl'), /x.jsonl line 1: not a tree dump record/, JSON.stringify(c));
  }
  assert.throws(() => readDump('null'), /not a tree dump record/);
  assert.throws(() => readDump('{', 'x.jsonl'), /x.jsonl line 1: /);
});

test('the command exits 2 on records without a sha256', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-diff-'));
  const f = join(dir, 'd.jsonl');
  writeFileSync(f, '{"id":"a","tree":"(program@0:1)"}\n');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('tree-diff.mjs', import.meta.url)), f, f], { encoding: 'utf8' });
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /line 1: not a tree dump record/);
});
