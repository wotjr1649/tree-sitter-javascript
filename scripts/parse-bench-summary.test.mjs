import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const summary = fileURLToPath(new URL('./parse-bench-summary.mjs', import.meta.url));

test('Callgrind table reports errors and only fails above the supplied budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parse-bench-test-'));
  try {
    const write = (name, text) => writeFileSync(join(dir, name), text + '\n');
    write('refs.tsv', 'v1.0.0\td6501de\nv3.1.0\t12956e2');
    for (const set of ['default', 'n-of-m', 'npm']) {
      write(set + '.bin.jsonl', '{"id":"test","bytes":5}');
      for (const mode of ['fresh', 'incremental']) {
        for (const [i, ir] of [100, 115].entries()) {
          const file = i + '-' + set + '-' + mode;
          write(file + '.callgrind', 'events: Ir\nsummary: ' + ir);
          write(file + '.tally', '1 5 ' + i);
          write(file + '.time', '4096 0.01');
        }
      }
    }

    const run = (threshold) => spawnSync(process.execPath, [summary, dir, threshold], {
      encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: join(dir, 'summary.md') },
    });
    const report = run('');
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /v3\.1\.0 \(12956e2\) \| 1 \| 1 \| 115 \| 115\.00%/);
    assert.match(report.stdout, /Report only/);
    assert.equal(readFileSync(join(dir, 'summary.md'), 'utf8').trim(), report.stdout.trim());
    assert.equal(run('15').status, 0);
    assert.equal(run('14.99').status, 1);
    const rows = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    assert.equal(rows.length, 12);
    assert.deepEqual(rows.filter((row) => row.overBudget).map((row) => row.ref), Array(6).fill('v3.1.0'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
