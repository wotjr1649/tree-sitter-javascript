import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { npmInputs } from '../oracle/discover/inputs.mjs';

const [data, manifestPath, output] = process.argv.slice(2);
if (!output) throw new Error('usage: parse-bench-inputs.mjs DATA MANIFEST OUTPUT.jsonl');
const { packages } = JSON.parse(readFileSync(manifestPath, 'utf8'));
const picked = [];
for (const pkg of packages) {
  // Bound the work per package. Path hashes sample across directory layouts without a random seed.
  const ranked = [...npmInputs(data, [pkg])]
    .filter(({ abs }) => statSync(abs).size <= 256 * 1024)
    .map((file) => ({ ...file, rank: createHash('sha256').update(file.rel).digest('hex') }))
    .sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let count = 0;
  for (const { abs, rel: id } of ranked) {
    const bytes = readFileSync(abs);
    let source;
    try {
      source = decoder.decode(bytes);
    } catch (error) {
      if (error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
      continue;
    }
    picked.push({ id, source });
    if (++count === 16) break;
  }
  if (!count) throw new Error('no eligible npm sources in ' + pkg.name);
  console.log(pkg.name + '@' + pkg.version, count);
}
writeFileSync(output, picked.map((input) => JSON.stringify(input) + '\n').join(''));
