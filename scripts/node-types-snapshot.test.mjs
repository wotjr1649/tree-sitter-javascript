import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, snapshot } from './node-types-snapshot.mjs';

const types = [
  { type: 'expression', named: true, subtypes: [{ type: 'identifier', named: true }, { type: 'call', named: true }] },
  {
    type: 'call',
    named: true,
    fields: {
      function: { multiple: false, required: true, types: [{ type: 'identifier', named: true }] },
      arguments: { multiple: false, required: true, types: [{ type: 'args', named: true }, { type: '(', named: false }] },
    },
  },
  { type: 'identifier', named: true },
  { type: 'this', named: true },
  { type: 'this', named: false },
];

test('snapshot is sorted and tells named from anonymous kinds', () => {
  const s = snapshot(types);
  assert.deepEqual(s, [...s].sort());
  assert.ok(s.includes('kind\tthis') && s.includes('kind\t"this"'));
  assert.ok(s.includes('field\tcall\targuments\t"("'));
  assert.ok(s.includes('subtype\texpression\tcall'));
});

test('identical snapshots compare clean', () => {
  assert.deepEqual(compare(snapshot(types), snapshot(types)), { failures: [], notes: [] });
});

test('a renamed field fails, an added kind is only a note', () => {
  const next = structuredClone(types);
  next[1].fields.callee = next[1].fields.function;
  delete next[1].fields.function;
  next.push({ type: 'spread', named: true });
  const { failures, notes } = compare(snapshot(types), snapshot(next));
  assert.deepEqual(failures, ['removed field call.function']);
  assert.ok(notes.includes('added kind spread'));
  assert.ok(notes.includes('added field call callee identifier'));
});

test('a removed field type, kind, anonymous kind and subtype all fail', () => {
  const next = structuredClone(types);
  next[1].fields.arguments.types.pop();
  next[0].subtypes.pop();
  next.splice(4, 1);
  next.splice(2, 1);
  const { failures, notes } = compare(snapshot(types), snapshot(next));
  assert.deepEqual(failures.sort(), [
    'removed kind "this"',
    'removed kind identifier',
    'removed subtype call of expression',
    'removed type "(" of field call.arguments',
  ]);
  assert.deepEqual(notes, []);
});
