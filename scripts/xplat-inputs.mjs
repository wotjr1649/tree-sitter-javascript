// Materialize the discovery inputs classified as valid, with the same bytes and strict prefix collect judged.
import { createWriteStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { classify } from '../oracle/discover/classify.mjs';
import { readVerified } from '../oracle/discover/inputs.mjs';

const [data, oracle, output] = process.argv.slice(2);
if (!output) throw new Error('usage: xplat-inputs.mjs DATA ORACLE.jsonl OUTPUT.jsonl');
readVerified(fileURLToPath(new URL('../oracle/n-of-m/inputs.jsonl', import.meta.url)),
  '3c1bf98e6fba2bb12a8d9cb27dbf351dc95eaf12fa173214f3c0b6fa73e6abaf');

const counts = { test262: 0, 'babel-jsx': 0, npm: 0 };
function* sources() {
  // JSON.stringify leaves U+2028 and U+2029 in diagnostics, but only LF separates records.
  const lines = readFileSync(oracle, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    const rec = JSON.parse(line);
    if (rec.skip || classify(rec, { clean: true }).truth !== 'valid') continue;
    const source = (rec.prefix ?? '') + readVerified(join(data, rec.id), rec.sha256);
    counts[rec.set]++;
    yield JSON.stringify({ id: rec.id, source }) + '\n';
  }
  if (Object.values(counts).some((n) => n === 0)) {
    throw new Error(`discovery: expected valid inputs from every set, got ${JSON.stringify(counts)}`);
  }
}

await pipeline(Readable.from(sources()), createWriteStream(output));
console.log('discovery valid inputs:', counts);
