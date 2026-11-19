import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('table shows baseline, current and the relative change', () => {
  const t = table({ label: 'v1', metrics: { state_count: 200, alias_count: 0 } }, { state_count: 210, alias_count: 1, token_count: 4 });
  assert.match(t, /\| state_count \| 200 \| 210 \| 5\.00 % \|/);
  assert.match(t, /\| alias_count \| 0 \| 1 \| 1 \|/);
  assert.match(t, /\| token_count \| - \| 4 \| new \|/);
  assert.match(t, /baseline v1/);
});
