import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [directory, threshold = ''] = process.argv.slice(2);
if (!directory) throw new Error('usage: parse-bench-summary.mjs ARTIFACTS [MAX_INCREASE_PCT]');
if (threshold && !/^[0-9]+(?:\.[0-9]+)?$/.test(threshold)) {
  throw new Error('threshold must be a nonnegative percentage');
}

const [integer, fraction = ''] = (threshold || '0').split('.');
const max = BigInt(integer + fraction);
const scale = 100n * 10n ** BigInt(fraction.length);

const read = (name) => readFileSync(join(directory, name), 'utf8').trim();
const refs = read('refs.tsv').split('\n').map((line) => line.split('\t'));
if (refs[0][0] !== 'v1.0.0') throw new Error('missing v1.0.0 baseline');
const rows = [];
for (const set of ['default', 'n-of-m', 'npm']) {
  const inputs = read(set + '.bin.jsonl').split('\n').map((line) => JSON.parse(line));
  const inputBytes = inputs.reduce((sum, input) => sum + input.bytes, 0);
  for (const mode of ['fresh', 'incremental']) {
    let baseline;
    for (const [i, [ref, commit]] of refs.entries()) {
      const file = i + '-' + set + '-' + mode;
      const profile = read(file + '.callgrind');
      const instructions = Number(/^summary: ([0-9]+)$/m.exec(profile)?.[1]);
      if (!/^events: Ir$/m.test(profile) || !Number.isSafeInteger(instructions) || instructions <= 0) {
        throw new Error(file + ': missing or invalid Callgrind Ir');
      }
      const [files, bytes, errors] = read(file + '.tally').split(' ').map(Number);
      const [rssKiB, seconds] = read(file + '.time').split(' ').map(Number);
      if (files !== inputs.length || bytes !== inputBytes || !Number.isInteger(errors) || errors < 0 ||
          errors > files || !Number.isInteger(rssKiB) || rssKiB <= 0 || !Number.isFinite(seconds) || seconds < 0) {
        throw new Error(file + ': invalid benchmark tally');
      }
      baseline ??= instructions;
      const percent = 100 * instructions / baseline;
      const overBudget = threshold !== '' && BigInt(instructions - baseline) * scale > BigInt(baseline) * max;
      rows.push({ set, mode, ref, commit, instructions, percent, files, bytes, errors, rssKiB, seconds, overBudget });
    }
  }
}
writeFileSync(join(directory, 'results.json'), JSON.stringify(rows, null, 2) + '\n');
const table = [
  '## Parse instruction counts',
  '',
  'Callgrind Ir, paired on one Linux runner. v1.0.0 is 100% for each input set and parse mode.',
  'All inputs contribute, including trees with ERROR or MISSING nodes. RSS is the native process peak.',
  '',
  '| Input set | Mode | Ref | Files | Error trees | Instructions | v1.0.0 | Peak RSS (KiB) |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map((r) => '| ' + [
    r.set, r.mode, r.ref + ' (' + r.commit.slice(0, 7) + ')', r.files, r.errors, r.instructions,
    r.percent.toFixed(2) + '%' + (r.overBudget ? ' **over budget**' : ''), r.rssKiB,
  ].join(' | ') + ' |'),
  '',
  threshold ? 'Maximum allowed increase per row: ' + threshold + '%.' : 'Report only. No instruction budget configured.',
  '',
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
if (rows.some((r) => r.overBudget)) process.exitCode = 1;
