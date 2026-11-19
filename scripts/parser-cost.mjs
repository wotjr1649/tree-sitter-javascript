// Generated-parser cost of src/parser.c against the last release (test/parser-cost-baseline.json; each release PR
// moves it with --update, like test/node-types-snapshot.txt).
// Report only: it prints a markdown table (also to $GITHUB_STEP_SUMMARY) and never fails on growth.
//
// Usage: node scripts/parser-cost.mjs [--parser FILE] [--baseline FILE] [--update LABEL]
//   --update LABEL writes the measured values as the new baseline, labelled with the release (e.g. "v1.0.0 d6501de").
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFINES = ['STATE_COUNT', 'LARGE_STATE_COUNT', 'SYMBOL_COUNT', 'ALIAS_COUNT', 'TOKEN_COUNT', 'FIELD_COUNT'];

// elements returns the top-level elements of the initializer `name[] = { ... };`: the text between its braces, found
// by nesting depth, split at the commas outside () and {}. It throws when the end is not a `};`.
function elements(src, name) {
  const decls = [...src.matchAll(new RegExp(`\\b${name}\\s*\\[\\s*\\]\\s*=\\s*\\{`, 'g'))];
  if (decls.length !== 1) throw new Error(`parser.c has ${decls.length} ${name}[] initializers, want 1`);
  const out = [];
  let depth = 0;
  let start = decls[0].index + decls[0][0].length;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || (ch === '}' && depth > 0)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(src.slice(start, i).trim());
      start = i + 1;
    } else if (ch === '}') {
      if (!/^\s*;/.test(src.slice(i + 1, i + 64))) throw new Error(`${name}: the initializer does not end with };`);
      const last = src.slice(start, i).trim();
      if (last) out.push(last);
      return out;
    }
  }
  throw new Error(`${name}: the initializer has no end`);
}

// count is the array length C gives the elements: `[i] = v` sets the position to i. Every value must match value.
function count(name, list, value) {
  let pos = 0;
  let len = 0;
  for (const e of list) {
    const m = e.match(/^(?:\[\s*(\d+)\s*\]\s*=\s*)?([^]*)$/);
    if (!value.test(m[2])) throw new Error(`${name}: unexpected entry ${JSON.stringify(e.slice(0, 80))}`);
    if (m[1] !== undefined) pos = Number(m[1]);
    len = Math.max(len, ++pos);
  }
  return len;
}

// parserC is the file's bytes (a Buffer), so the size does not depend on decoding.
export function measure(parserC) {
  const src = parserC.toString('latin1');
  const cost = { parser_c_bytes: parserC.length };
  for (const d of DEFINES) {
    const m = src.match(new RegExp(`^#define\\s+${d}\\s+(\\d+)\\s*$`, 'm'));
    if (!m) throw new Error(`parser.c has no #define ${d}`);
    cost[d.toLowerCase()] = Number(m[1]);
  }
  cost.parse_table_entries = cost.large_state_count * cost.symbol_count;
  // uint16 values: numbers, symbols and macros such as ACTIONS(5).
  const small = elements(src, 'ts_small_parse_table');
  cost.small_parse_table_entries = count('ts_small_parse_table', small, /^\w+(\(\s*\d+\s*\))?$/);
  cost.small_parse_table_map_entries = cost.state_count - cost.large_state_count;
  // Headers `{.entry = {.count = c, ...}}`, each followed by its c actions such as SHIFT(4) or REDUCE(sym, 0, 0, 0).
  const actions = elements(src, 'ts_parse_actions');
  cost.parse_action_entries = count('ts_parse_actions', actions, /^(\{\s*\.entry\s*=\s*\{[^{}]*\}\s*\}|\w+\([^()]*\))$/);
  let due = 0;
  for (const e of actions) {
    const c = e.match(/\.count\s*=\s*(\d+)/);
    if (c ? due !== 0 : due-- === 0) throw new Error(`ts_parse_actions: a header's action count does not match near ${e.slice(0, 80)}`);
    if (c) due = Number(c[1]);
  }
  if (due !== 0) throw new Error('ts_parse_actions: the last header has fewer actions than its count');
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
