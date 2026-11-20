#include "tree_sitter/parser.h"

#include <stdio.h>
#include <wctype.h>

enum TokenType {
    AUTOMATIC_SEMICOLON,
    TEMPLATE_CHARS,
    TERNARY_QMARK,
    HTML_COMMENT,
    LOGICAL_OR,
    ESCAPE_SEQUENCE,
    REGEX_PATTERN,
    JSX_TEXT,
    // Never returned: only their validity is read (see grammar.js).
    BINDING_END,
    KEYWORD_CONTINUES,
    RESTRICTED_KEYWORD, // Never returned: only its validity is read (see grammar.js).
};

void *tree_sitter_javascript_external_scanner_create() { return NULL; }

void tree_sitter_javascript_external_scanner_destroy(void *p) {}

unsigned tree_sitter_javascript_external_scanner_serialize(void *payload, char *buffer) { return 0; }

void tree_sitter_javascript_external_scanner_deserialize(void *p, const char *b, unsigned n) {}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static bool scan_template_chars(TSLexer *lexer) {
    lexer->result_symbol = TEMPLATE_CHARS;
    for (bool has_content = false;; has_content = true) {
        lexer->mark_end(lexer);
        // The end of the input, not a U+0000 in the template (both have lookahead 0).
        if (lexer->eof(lexer)) {
            return false;
        }
        switch (lexer->lookahead) {
            case '`':
                return has_content;
            case '$':
                advance(lexer);
                if (lexer->lookahead == '{') {
                    return has_content;
                }
                break;
            case '\\':
                return has_content;
            default:
                advance(lexer);
        }
    }
}

typedef enum {
    REJECT,     // Semicolon is illegal, ie a syntax error occurred
    NO_NEWLINE, // Unclear if semicolon will be legal, continue
    ACCEPT,     // Semicolon is legal, assuming a comment was encountered
} WhitespaceResult;

/**
 * @param consume If false, only consume enough to check if comment indicates semicolon-legality
 */
static WhitespaceResult scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_comment, bool consume) {
    bool saw_block_newline = false;

    for (;;) {
        while (iswspace(lexer->lookahead)) {
            skip(lexer);
        }

        if (lexer->lookahead == '/') {
            skip(lexer);

            if (lexer->lookahead == '/') {
                skip(lexer);
                while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 &&
                       lexer->lookahead != 0x2029) {
                    skip(lexer);
                }
                *scanned_comment = true;
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                while (lexer->lookahead != 0) {
                    if (lexer->lookahead == '*') {
                        skip(lexer);
                        if (lexer->lookahead == '/') {
                            skip(lexer);
                            *scanned_comment = true;

                            if (lexer->lookahead != '/' && !consume) {
                                return saw_block_newline ? ACCEPT : NO_NEWLINE;
                            }

                            break;
                        }
                    } else if (lexer->lookahead == '\n' || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
                        saw_block_newline = true;
                        skip(lexer);
                    } else {
                        skip(lexer);
                    }
                }
            } else {
                return REJECT;
            }
        } else {
            return ACCEPT;
        }
    }
}

// White space and line terminators as the grammar's `extras` regex has them (extras_character_set_1 in parser.c).
// Explicit, not iswspace: that differs between C runtimes.
static bool is_extra_space(int32_t c) {
    return (c >= '\t' && c <= '\r') || c == ' ' || c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200b) ||
           c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x2060 || c == 0x3000 || c == 0xfeff;
}

// The next character of an identifier name: ASCII letters and digits, `_`, `$`, `\` (an escape), and any other
// non-ASCII character that is not white space. ASCII comparisons, not isw*: those differ between C runtimes.
static bool is_identifier_part(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$' ||
           c == '\\' || (c > 0x7f && !is_extra_space(c));
}

// After a line terminator: does the token that starts at the lookahead get a semicolon inserted before it?
static bool semicolon_before_next_token(TSLexer *lexer, const bool *valid_symbols) {
    switch (lexer->lookahead) {
        // A class field or a declaration's bindings cannot go on with these (`a<LF>*b() {}`, `c<LF>[x] = 1`,
        // `let a<LF><a/>`), unlike an expression, `return`, or a member prefix (`get<LF>[x]() {}`, `static<LF>*g() {}`;
        // `async<LF>*g() {}` stays one method, as it parses today). shortcut: `get<LF>*g() {}` and `set<LF>*g() {}`
        // (a field, then a generator) stay errors: telling get/set from static/async costs a marker of +1.8 % parser.c.
        case '*':
        case '[':
            return valid_symbols[BINDING_END] && !valid_symbols[LOGICAL_OR] && !valid_symbols[KEYWORD_CONTINUES];
        case '<':
            return valid_symbols[BINDING_END] && !valid_symbols[LOGICAL_OR];

        case '`':
        case ',':
        case ':':
        case ';':
        case '%':
        case '>':
        case '=':
        case '(':
        case '?':
        case '^':
        case '|':
        case '&':
        case '/':
            return false;

        // Insert a semicolon before decimals literals but not otherwise.
        case '.':
            skip(lexer);
            return iswdigit(lexer->lookahead);

        // Insert a semicolon before `--` and `++`, but not before binary `+` or `-`.
        case '+':
            skip(lexer);
            return lexer->lookahead == '+';
        case '-':
            skip(lexer);
            return lexer->lookahead == '-';

        // Don't insert a semicolon before `!=`, but do insert one before a unary `!`.
        case '!':
            skip(lexer);
            return lexer->lookahead != '=';

        // Don't insert a semicolon before `in` or `instanceof`, but do insert one
        // before an identifier.
        case 'i':
            skip(lexer);

            if (lexer->lookahead != 'n') {
                return true;
            }
            skip(lexer);

            if (!is_identifier_part(lexer->lookahead)) {
                return false;
            }

            for (unsigned i = 0; i < 8; i++) {
                if (lexer->lookahead != "stanceof"[i]) {
                    return true;
                }
                skip(lexer);
            }

            if (!is_identifier_part(lexer->lookahead)) {
                return false;
            }
            break;

        default:
            break;
    }

    return true;
}

static bool scan_automatic_semicolon(TSLexer *lexer, const bool *valid_symbols, bool *scanned_comment) {
    bool comment_condition = !valid_symbols[LOGICAL_OR];
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    for (;;) {
        if (lexer->lookahead == 0) {
            return true;
        }

        if (lexer->lookahead == '/') {
            WhitespaceResult result = scan_whitespace_and_comments(lexer, scanned_comment, false);
            if (result == REJECT) {
                return false;
            }

            if (result == ACCEPT && comment_condition && lexer->lookahead != ',' && lexer->lookahead != '=') {
                return true;
            }
        }

        if (lexer->lookahead == '}') {
            return true;
        }

        if (lexer->is_at_included_range_start(lexer)) {
            return true;
        }

        if (lexer->lookahead == '\n' || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
            break;
        }

        if (!iswspace(lexer->lookahead)) {
            return false;
        }

        skip(lexer);
    }

    skip(lexer);

    if (scan_whitespace_and_comments(lexer, scanned_comment, true) == REJECT) {
        return false;
    }

    // After a comment the next call decides, as before: where the comment holds a line break the base scanner
    // takes the semicolon after it (`let x<LF>/*<LF>*//*<LF>*/[b]`), so the declaration keeps its comment.
    if (*scanned_comment && (lexer->lookahead == '*' || lexer->lookahead == '[' || lexer->lookahead == '<')) {
        return false;
    }

    return semicolon_before_next_token(lexer, valid_symbols);
}

// After `return`, `break`, `continue` and a label (ECMA-262 12.9.1, no LineTerminator here): a line terminator ends the
// statement whatever follows it, unless it is an explicit `;`. A lone CR is a line terminator, and so is one in a block
// comment. The statement also ends at an included range start, a `}` and the end of the input.
static bool scan_restricted_semicolon(TSLexer *lexer) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    bool newline = false;
    for (;;) {
        int32_t c = lexer->lookahead;
        if (c == 0 || c == '}' || lexer->is_at_included_range_start(lexer)) {
            return true;
        }

        if (c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029) {
            newline = true;
            skip(lexer);
        } else if (iswspace(c)) {
            skip(lexer);
        } else if (c != '/') {
            return newline && c != ';';
        } else {
            skip(lexer);
            if (lexer->lookahead == '/') {
                while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
                       lexer->lookahead != 0x2028 && lexer->lookahead != 0x2029) {
                    skip(lexer);
                }
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                while (lexer->lookahead != 0) {
                    c = lexer->lookahead;
                    skip(lexer);
                    if (c == '*' && lexer->lookahead == '/') {
                        skip(lexer);
                        break;
                    }
                    if (c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029) {
                        newline = true;
                    }
                }
            } else {
                return newline; // A regular expression, or a division
            }
        }
    }
}

static bool scan_ternary_qmark(TSLexer *lexer) {
    for (;;) {
        if (!iswspace(lexer->lookahead)) {
            break;
        }
        skip(lexer);
    }

    if (lexer->lookahead == '?') {
        advance(lexer);

        if (lexer->lookahead == '?') {
            return false;
        }

        lexer->mark_end(lexer);
        lexer->result_symbol = TERNARY_QMARK;

        if (lexer->lookahead == '.') {
            advance(lexer);
            if (iswdigit(lexer->lookahead)) {
                return true;
            }
            return false;
        }
        return true;
    }
    return false;
}

static bool scan_html_comment(TSLexer *lexer) {
    while (iswspace(lexer->lookahead) || lexer->lookahead == 0x2028 || lexer->lookahead == 0x2029) {
        skip(lexer);
    }

    const char *comment_start = "<!--";
    const char *comment_end = "-->";

    if (lexer->lookahead == '<') {
        for (unsigned i = 0; i < 4; i++) {
            if (lexer->lookahead != comment_start[i]) {
                return false;
            }
            advance(lexer);
        }
    } else if (lexer->lookahead == '-') {
        for (unsigned i = 0; i < 3; i++) {
            if (lexer->lookahead != comment_end[i]) {
                return false;
            }
            advance(lexer);
        }
    } else {
        return false;
    }

    while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 &&
           lexer->lookahead != 0x2029) {
        advance(lexer);
    }

    lexer->result_symbol = HTML_COMMENT;
    lexer->mark_end(lexer);

    return true;
}

// After an `&`: is what follows the rest of an HTML character reference
// (`&amp;`, `&#38;`, `&#x26;`), as the grammar's html_character_reference
// token defines it? Consumes the name or number either way.
// ASCII comparisons, not isw*: those match non-ASCII digits on some C runtimes.
static bool scan_character_reference_tail(TSLexer *lexer) {
    unsigned length = 0;
    if (lexer->lookahead == '#') {
        advance(lexer);
        if (lexer->lookahead == 'x' || lexer->lookahead == 'X') {
            advance(lexer);
            while (length < 6 && ((lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
                                  (lexer->lookahead >= 'a' && lexer->lookahead <= 'f') ||
                                  (lexer->lookahead >= 'A' && lexer->lookahead <= 'F'))) {
                advance(lexer);
                length++;
            }
        } else {
            while (length < 5 && lexer->lookahead >= '0' && lexer->lookahead <= '9') {
                advance(lexer);
                length++;
            }
        }
    } else {
        while (length < 30 && ((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
                               (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z'))) {
            advance(lexer);
            length++;
        }
    }
    return length > 0 && lexer->lookahead == ';';
}

static bool scan_jsx_text(TSLexer *lexer) {
    // saw_text will be true if we see any non-whitespace content, or any whitespace content that is not a newline and
    // does not immediately follow a newline.
    bool saw_text = false;
    // at_newline will be true if we are currently at a newline, or if we are at whitespace that is not a newline but
    // immediately follows a newline.
    bool at_newline = false;

    lexer->result_symbol = JSX_TEXT;

    while (lexer->lookahead != 0 && lexer->lookahead != '<' && lexer->lookahead != '>' && lexer->lookahead != '{' &&
           lexer->lookahead != '}') {
        if (lexer->lookahead == '&') {
            // A character reference is its own token: the text ends before it.
            // A bare ampersand (`Shipping & Handling`) is text.
            lexer->mark_end(lexer);
            advance(lexer);
            if (scan_character_reference_tail(lexer)) {
                return saw_text;
            }
            saw_text = true;
            at_newline = false;
            continue;
        }
        bool is_wspace = iswspace(lexer->lookahead);
        if (lexer->lookahead == '\n') {
            at_newline = true;
        } else {
            // If at_newline is already true, and we see some whitespace, then it must stay true.
            // Otherwise, it should be false.
            //
            // See the table below to determine the logic for computing `saw_text`.
            //
            // |------------------------------------|
            // | at_newline | is_wspace | saw_text  |
            // |------------|-----------|-----------|
            // | false (0)  | false (0) | true  (1) |
            // | false (0)  | true  (1) | true  (1) |
            // | true  (1)  | false (0) | true  (1) |
            // | true  (1)  | true  (1) | false (0) |
            // |------------------------------------|

            at_newline &= is_wspace;
            if (!at_newline) {
                saw_text = true;
            }
        }

        advance(lexer);
    }

    lexer->mark_end(lexer);
    return saw_text;
}

bool tree_sitter_javascript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_template_chars(lexer);
    }

    if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer)) {
        return true;
    }

    if (valid_symbols[AUTOMATIC_SEMICOLON]) {
        bool scanned_comment = false;
        bool ret = valid_symbols[RESTRICTED_KEYWORD]
                       ? scan_restricted_semicolon(lexer)
                       : scan_automatic_semicolon(lexer, valid_symbols, &scanned_comment);
        if (!ret && !scanned_comment && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        return ret;
    }

    if (valid_symbols[TERNARY_QMARK]) {
        return scan_ternary_qmark(lexer);
    }

    if (valid_symbols[HTML_COMMENT] && !valid_symbols[LOGICAL_OR] && !valid_symbols[ESCAPE_SEQUENCE] &&
        !valid_symbols[REGEX_PATTERN]) {
        return scan_html_comment(lexer);
    }

    return false;
}
