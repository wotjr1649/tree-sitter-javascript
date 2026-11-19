import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff, readDump, report } from './tree-diff.mjs';

const rec = (id, tree, errors = 0, sha256 = id) => JSON.stringify({ id, sha256, error: errors > 0, errors, missing: 0, tree });

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
  assert.throws(() => diff(readDump(rec('a', '(p)')), readDump(rec('a', '(p)', 0, 'other'))), /source differs/);
  assert.throws(() => readDump([rec('a', '(p)'), rec('a', '(p)')].join('\n')), /duplicate id a/);
});
