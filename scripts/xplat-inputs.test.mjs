import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('Discovery rejects a nonempty selection whose per-source counts differ from the pins', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'xplat-inputs-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const source = 'let a = 1;\n';
  const sha256 = createHash('sha256').update(source).digest('hex');
  const accepted = { script: { c: 'accept' } };
  const records = ['test262', 'babel-jsx', 'npm'].map((set) => {
    writeFileSync(join(dir, set), source);
    return JSON.stringify({ id: set, set, sha256, truth: 'valid', b: accepted, o: accepted });
  });
  const oracle = join(dir, 'oracle.jsonl');
  writeFileSync(oracle, records.join('\n') + '\n');
  const script = fileURLToPath(new URL('xplat-inputs.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, dir, oracle, join(dir, 'discovery.jsonl')], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const { xplat_valid_counts: expected } = JSON.parse(
    readFileSync(new URL('../oracle/discover/manifest.json', import.meta.url), 'utf8'),
  );
  for (const set of ['test262', 'babel-jsx', 'npm']) {
    assert.ok(result.stderr.includes(`${set}: expected ${expected[set]}, got 1`), result.stderr);
  }
});
