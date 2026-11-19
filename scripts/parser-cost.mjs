// Generated-parser cost of src/parser.c against a committed release baseline (test/parser-cost-baseline.json).
// Report only: it prints a markdown table (also to $GITHUB_STEP_SUMMARY) and never fails on growth.
//
// Usage: node scripts/parser-cost.mjs [--parser FILE] [--baseline FILE] [--update LABEL]
//   --update LABEL writes the measured values as the new baseline, labelled with the release (e.g. "v1.0.0 d6501de").
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFINES = ['STATE_COUNT', 'LARGE_STATE_COUNT', 'SYMBOL_COUNT', 'ALIAS_COUNT', 'TOKEN_COUNT', 'FIELD_COUNT'];

function body(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`parser.c has no ${decl}`);
  return src.slice(start + decl.length, src.indexOf('\n};', start));
}

// parserC is the file's bytes (a Buffer), so the size does not depend on decoding.
export function measure(parserC) {
  const src = parserC.toString('latin1');
  const cost = { parser_c_bytes: parserC.length };
  for (const d of DEFINES) {
    const m = src.match(new RegExp(`^#define ${d} (\\d+)$`, 'm'));
    if (!m) throw new Error(`parser.c has no #define ${d}`);
    cost[d.toLowerCase()] = Number(m[1]);
  }
  cost.parse_table_entries = cost.large_state_count * cost.symbol_count;
  // Every uint16 of the small table is followed by a comma, and the table holds no other comma.
  cost.small_parse_table_entries = (body(src, 'ts_small_parse_table[] = {').match(/,/g) ?? []).length;
  cost.small_parse_table_map_entries = cost.state_count - cost.large_state_count;
  // The last header `[i] = {.entry = {.count = c` is followed by its c actions.
  const heads = [...body(src, 'ts_parse_actions[] = {').matchAll(/\[(\d+)\] = \{\.entry = \{\.count = (\d+)/g)];
  if (!heads.length) throw new Error('parser.c has no parse actions');
  const [, i, c] = heads.at(-1);
  cost.parse_action_entries = Number(i) + 1 + Number(c);
  return cost;
}

export function table(baseline, current) {
  const rows = Object.keys(current).map((k) => {
    const b = baseline.metrics[k];
    const change = b === undefined ? 'new' : b === 0 ? `${current[k] - b}` : `${(((current[k] - b) / b) * 100).toFixed(2)} %`;
    return `| ${k} | ${b ?? '-'} | ${current[k]} | ${change} |`;
  });
  return [
    `### Generated parser cost (baseline ${baseline.label})`,
    '',
    '| metric | baseline | current | change |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

function main(argv) {
  const opt = (flag, def) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : def);
  const current = measure(readFileSync(opt('--parser', 'src/parser.c')));
  const baselinePath = opt('--baseline', 'test/parser-cost-baseline.json');
  const label = opt('--update');
  if (label) {
    writeFileSync(baselinePath, JSON.stringify({ label, metrics: current }, null, 2) + '\n');
    console.log(`wrote ${baselinePath}`);
    return 0;
  }
  const summary = table(JSON.parse(readFileSync(baselinePath, 'utf8')), current);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`parser-cost: ${e.message}`);
    process.exitCode = 2;
  }
}
