const assert = require("node:assert");
const { test } = require("node:test");

const Parser = require("tree-sitter");

test("can load grammar", () => {
  const parser = new Parser();
  // setLanguage rejects a parser whose ABI the runtime does not support.
  assert.doesNotThrow(() => parser.setLanguage(require(".")));

  const tree = parser.parse("const x = 1;");
  assert.strictEqual(tree.rootNode.type, "program");
  assert.strictEqual(tree.rootNode.hasError, false);
});
