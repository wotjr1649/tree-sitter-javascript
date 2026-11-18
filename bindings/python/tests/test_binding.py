from unittest import TestCase

import tree_sitter, tree_sitter_javascript


class TestLanguage(TestCase):
    def test_can_load_grammar(self):
        try:
            language = tree_sitter.Language(tree_sitter_javascript.language())
        except Exception:
            self.fail("Error loading JavaScript grammar")

        # Setting the language rejects a parser whose ABI the runtime does not support.
        parser = tree_sitter.Parser(language)
        tree = parser.parse(b"const x = 1;")
        self.assertEqual(tree.root_node.type, "program")
        self.assertFalse(tree.root_node.has_error)
