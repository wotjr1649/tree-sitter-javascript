import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { measure, table } from './parser-cost.mjs';

const parserC = Buffer.from(`#define LANGUAGE_VERSION 15
#define STATE_COUNT 5
#define LARGE_STATE_COUNT 2
#define SYMBOL_COUNT 7
#define ALIAS_COUNT 1
#define TOKEN_COUNT 4
#define FIELD_COUNT 3
static const uint16_t ts_small_parse_table[] = {
  [0] = 2,
    ACTIONS(5), 2,
      sym_a,
      sym_b,
    STATE(3), 1,
      sym_c,
  [8] = 1,
    ACTIONS(1), 1,
      sym_d,
};

static const TSParseActionEntry ts_parse_actions[] = {
  [0] = {.entry = {.count = 0, .reusable = false}},
  [1] = {.entry = {.count = 1, .reusable = false}}, RECOVER(),
  [3] = {.entry = {.count = 2, .reusable = true}}, REDUCE(sym_program, 0, 0, 0), SHIFT(4),
};
`);

test('measure reads the defines and the table sizes', () => {
  assert.deepEqual(measure(parserC), {
    parser_c_bytes: parserC.length,
    state_count: 5,
    large_state_count: 2,
    symbol_count: 7,
    alias_count: 1,
    token_count: 4,
    field_count: 3,
    parse_table_entries: 14,
    small_parse_table_entries: 12,
    small_parse_table_map_entries: 3,
    parse_action_entries: 6,
  });
});

test('measure refuses a file without a define', () => {
  assert.throws(() => measure(Buffer.from('#define STATE_COUNT 1\n')), /LARGE_STATE_COUNT/);
});

const sizes = (c) => {
  const m = measure(Buffer.from(c));
  return [m.small_parse_table_entries, m.parse_action_entries];
};
const edit = (from, to) => {
  assert.ok(parserC.toString().includes(from));
  return parserC.toString().replace(from, to);
};

test('formatting does not change the table sizes', () => {
  assert.deepEqual(sizes(edit('sym_d,\n};', 'sym_d\n};')), [12, 6]); // no trailing comma
  assert.deepEqual(sizes(edit('[3] = {.entry = {.count', '[3]  =  { .entry  = { .count')), [12, 6]);
  assert.deepEqual(sizes(edit('sym_d,\n};', 'sym_d,\n  };')), [12, 6]); // indented closer
  assert.deepEqual(sizes(edit('ts_small_parse_table[] = {', 'ts_small_parse_table [ ] =\n{')), [12, 6]);
});

test('designators and counts are read as C integer literals', () => {
  assert.deepEqual(sizes(edit('[8] = 1,', '[010] = 1,')), [12, 6]); // octal 8
  assert.deepEqual(sizes(edit('[8] = 1,', '[0x8u] = 1,')), [12, 6]);
  assert.deepEqual(sizes(edit('[3] = {.entry = {.count = 2', '[03UL] = {.entry = {.count = 0x2')), [12, 6]);
  assert.equal(measure(Buffer.from(edit('#define STATE_COUNT 5', '#define STATE_COUNT 05'))).state_count, 5);
  for (const bad of ['[08] = 1,', '[8x] = 1,', '[0b1000] = 1,', '[8uu] = 1,']) {
    assert.throws(() => measure(Buffer.from(edit('[8] = 1,', bad))), /is not a C integer literal/, bad);
  }
});

test('an initializer without its end or with unexpected entries is refused', () => {
  assert.throws(() => measure(Buffer.from(edit('sym_d,\n};', 'sym_d,\n}'))), /does not end with \};/);
  assert.throws(() => measure(Buffer.from(edit('sym_d,\n};', 'sym_d,\n'))), /ts_small_parse_table: the initializer has no end/);
  assert.throws(() => measure(Buffer.from(parserC.toString().split('ts_parse_actions')[0] + 'ts_parse_actions[] = {\n  [0] = {.entry')), /no end/);
  assert.throws(() => measure(Buffer.from(edit('sym_c,', 'sym_c,,'))), /unexpected entry/);
  assert.throws(() => measure(Buffer.from(edit(' SHIFT(4),', ''))), /fewer actions/);
  assert.throws(() => measure(Buffer.from(edit('RECOVER(),', 'RECOVER(), RECOVER(),'))), /count does not match/);
});

test('the command exits 2 when it cannot measure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parser-cost-'));
  writeFileSync(join(dir, 'parser.c'), edit('sym_d,\n};', 'sym_d,\n'));
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('parser-cost.mjs', import.meta.url)), '--parser', join(dir, 'parser.c')], { encoding: 'utf8' });
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ts_small_parse_table: the initializer has no end/);
});

test('table shows baseline, current and the relative change', () => {
  const t = table({ label: 'v1', metrics: { state_count: 200, alias_count: 0 } }, { state_count: 210, alias_count: 1, token_count: 4 });
  assert.match(t, /\| state_count \| 200 \| 210 \| 5\.00 % \|/);
  assert.match(t, /\| alias_count \| 0 \| 1 \| 1 \|/);
  assert.match(t, /\| token_count \| - \| 4 \| new \|/);
  assert.match(t, /baseline v1/);
});
