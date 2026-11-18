import XCTest
import SwiftTreeSitter
import TreeSitterJavaScript

final class TreeSitterJavaScriptTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_javascript())
        // setLanguage rejects a parser whose ABI the runtime does not support.
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading JavaScript grammar")

        let tree = parser.parse("const x = 1;")
        XCTAssertEqual(tree?.rootNode?.nodeType, "program")
        XCTAssertEqual(tree?.rootNode?.hasError, false)
    }
}
