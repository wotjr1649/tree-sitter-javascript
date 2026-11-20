// Materialize the discovery inputs classified as valid, with the same bytes and strict prefix collect judged.
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { classify } from '../oracle/discover/classify.mjs';
import { readVerified } from '../oracle/discover/inputs.mjs';

const [data, oracle, output, inputList] = process.argv.slice(2);
if (!output) throw new Error('usage: xplat-inputs.mjs DATA ORACLE.jsonl OUTPUT.jsonl [INPUT-IDS.jsonl]');
const { xplat_valid_counts: expected } = JSON.parse(
  readFileSync(new URL('../oracle/discover/manifest.json', import.meta.url), 'utf8'),
);
readVerified(fileURLToPath(new URL('../oracle/n-of-m/inputs.jsonl', import.meta.url)),
  '3c1bf98e6fba2bb12a8d9cb27dbf351dc95eaf12fa173214f3c0b6fa73e6abaf');

const counts = { test262: 0, 'babel-jsx': 0, npm: 0 };
const ids = new Set();
function* sources() {
  // JSON.stringify leaves U+2028 and U+2029 in diagnostics, but only LF separates records.
  const lines = readFileSync(oracle, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    const rec = JSON.parse(line);
    if (rec.skip || classify(rec, { clean: true }).truth !== 'valid') continue;
    if (!Object.hasOwn(counts, rec.set)) throw new Error(`discovery: unexpected input set ${rec.set}`);
    if (ids.has(rec.id)) throw new Error(`discovery: duplicate input ID ${rec.id}`);
    const source = (rec.prefix ?? '') + readVerified(join(data, rec.id), rec.sha256);
    counts[rec.set]++;
    ids.add(rec.id);
    yield JSON.stringify({ id: rec.id, source }) + '\n';
  }
  const drift = Object.keys(counts)
    .filter((set) => counts[set] !== expected?.[set])
    .map((set) => `${set}: expected ${expected?.[set]}, got ${counts[set]}`);
  if (drift.length) throw new Error(`discovery: ${drift.join('; ')}`);
}

await pipeline(Readable.from(sources()), createWriteStream(output));
if (inputList) writeFileSync(inputList, [...ids].map((id) => JSON.stringify({ id }) + '\n').join(''));
console.log('discovery valid inputs:', counts);
