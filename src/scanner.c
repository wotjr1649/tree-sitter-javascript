#include "tree_sitter/parser.h"

#include <stdio.h>
#include <string.h>
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
    BLOCK_NEWLINE, // Like ACCEPT, from block comments holding LF, LS or PS and no line comment (consume false only)
    BLOCK_CR,   // Like NO_NEWLINE, but the block comments held a lone CR (consume false only; see the caller)
} WhitespaceResult;

static inline bool is_line_terminator(int32_t c) { return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029; }

/**
 * @param consume If false, only consume enough to check if comment indicates semicolon-legality
 * @param line_comment_lf If not NULL, set when a line comment ends at LF, CR LF, LS or PS (not a lone CR or the end)
 */
static WhitespaceResult scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_comment, bool consume,
                                                     bool *line_comment_lf) {
    bool saw_block_newline = false;
    bool saw_block_cr = false;
    bool saw_line_comment = false;

    for (;;) {
        while (iswspace(lexer->lookahead)) {
            skip(lexer);
        }

        if (lexer->lookahead == '/') {
            skip(lexer);

            if (lexer->lookahead == '/') {
                skip(lexer);
                // Ends at a lone CR too, as the comment token does.
                while (lexer->lookahead != 0 && !is_line_terminator(lexer->lookahead)) {
                    skip(lexer);
                }
                bool cr = lexer->lookahead == '\r';
                if (cr) {
                    skip(lexer); // white space, as the loop above would skip it
                }
                if (line_comment_lf && (lexer->lookahead == '\n' || (!cr && is_line_terminator(lexer->lookahead)))) {
                    *line_comment_lf = true;
                }
                *scanned_comment = true;
                saw_line_comment = true;
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                while (lexer->lookahead != 0) {
                    if (lexer->lookahead == '*') {
                        skip(lexer);
                        if (lexer->lookahead == '/') {
                            skip(lexer);
                            *scanned_comment = true;

                            if (lexer->lookahead != '/' && !consume) {
                                if (saw_block_newline) {
                                    return saw_line_comment ? ACCEPT : BLOCK_NEWLINE;
                                }
                                return saw_block_cr && !saw_line_comment ? BLOCK_CR : NO_NEWLINE;
                            }

                            break;
                        }
                    } else if (lexer->lookahead == '\r') {
                        saw_block_cr = true;
                        skip(lexer);
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
// Explicit, not iswspace: that differs between C runtimes and misses U+FEFF on some.
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

static bool semicolon_before_next_token(TSLexer *lexer, const bool *valid_symbols);

// After an expression and a weak line terminator (see scan_automatic_semicolon): as after a line break, except for
// what parses without one today. `async` has no _keyword_continues marker (it would cost 3.5 % of parser.c), and
// `async /*<LF>*/ function f() {}` and `async /*<LF>*/ x => x` parse as one function; `a /*<LF>*/ ++<LF>b` as
// `a++; b` and `0 /*<LF>*/ --> c` as `(0--) > c`. shortcut: so `++`, `--` and `-->` get no semicolon here.
static bool semicolon_after_weak_newline(TSLexer *lexer, const bool *valid_symbols) {
    int32_t c = lexer->lookahead;
    if (c == '+' || c == '-') {
        return false;
    }
    if ((c >= '0' && c <= '9') || !is_identifier_part(c)) {
        return semicolon_before_next_token(lexer, valid_symbols);
    }
    char word[11];
    unsigned length = 0;
    while (is_identifier_part(lexer->lookahead)) {
        if (length < sizeof word - 1) {
            word[length] = lexer->lookahead < 0x80 ? (char)lexer->lookahead : '?';
        }
        length++;
        skip(lexer);
    }
    word[length < sizeof word ? length : 0] = 0; // a longer word matches none below
    if (strcmp(word, "in") == 0 || strcmp(word, "instanceof") == 0 || strcmp(word, "function") == 0) {
        return false;
    }
    // Skip white space and block comments, so `async /*<LF>*/ x /*c*/ => x` stays one arrow function as without the
    // `/*c*/`. shortcut: both parse as one async arrow, Babel and oxc read `async; x => x`; changing that is v3.0.0.
    for (;;) {
        while (is_extra_space(lexer->lookahead) && !is_line_terminator(lexer->lookahead)) {
            skip(lexer);
        }
        if (lexer->lookahead != '/') {
            break;
        }
        skip(lexer);
        if (lexer->lookahead != '*') {
            return true;
        }
        skip(lexer);
        for (int32_t previous = 0; previous != '*' || lexer->lookahead != '/'; skip(lexer)) {
            if (lexer->eof(lexer)) {
                return true;
            }
            previous = lexer->lookahead;
        }
        skip(lexer);
    }
    if (lexer->lookahead == '=') {
        skip(lexer);
        return lexer->lookahead != '>';
    }
    return true;
}

static bool scan_automatic_semicolon(TSLexer *lexer, const bool *valid_symbols, bool *scanned_comment) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    bool comment_condition = !valid_symbols[LOGICAL_OR];
    // Line terminators that this scanner did not count before J7: a lone CR, and one inside a block comment
    // (ECMA-262 12.4: such a comment counts as a line terminator). They count only where `||` is valid, that is after
    // an expression, and not after a keyword that may go on: elsewhere they would change trees that parse today
    // (`return<CR>1`, `return /*<CR>*/ 1`, `let<CR>x = 1`, `using /*<LF>*/ x = 1`).
    bool weak_newline = false;
    bool lone_cr = false;
    // A line comment ended at a line terminator: the next call decides there, as before. After a lone CR only one
    // ended at LF, CR LF, LS or PS defers (`a<CR>// c<LF>b`), not one ended at a lone CR (`}<CR>// c<CR><CR>f()`).
    bool line_comment = false;
    bool line_comment_lf = false;

    for (;;) {
        if (lexer->lookahead == 0) {
            return true;
        }

        if (lexer->lookahead == '/') {
            WhitespaceResult result = scan_whitespace_and_comments(lexer, scanned_comment, false, &line_comment_lf);
            if (result == REJECT) {
                return false;
            }

            if ((result == ACCEPT || result == BLOCK_NEWLINE) && comment_condition && lexer->lookahead != ',' &&
                lexer->lookahead != '=') {
                return true;
            }
            weak_newline |= result == BLOCK_NEWLINE || result == BLOCK_CR;
            line_comment |= result == ACCEPT;
        }

        if (lexer->lookahead == '}') {
            return true;
        }

        if (lexer->is_at_included_range_start(lexer)) {
            return true;
        }

        if (lexer->lookahead == '\r') {
            skip(lexer);
            if (lexer->lookahead == '\n') {
                break; // CR LF: the skip below takes the LF
            }
            // White space here, as before; a weak line terminator for the token after it (`a<CR>b`), decided below
            // like a block comment's, so comments and the end of the input after it go as before (`a<CR>/*c*/`).
            lone_cr |= !comment_condition && !valid_symbols[KEYWORD_CONTINUES];
            continue;
        }

        if (is_line_terminator(lexer->lookahead)) {
            break;
        }

        if (!iswspace(lexer->lookahead)) {
            // The token after a weak line terminator, on its line, is decided as after a line break (`a /*<LF>*/ b`,
            // `a<CR>b`); not after a line comment or at the end of the input (`a<CR>// c<LF>b`, `a /*<LF>*/`: the next
            // call decides there, as before, so the comment stays in the statement).
            return !comment_condition && ((weak_newline && !line_comment) || (lone_cr && !line_comment_lf)) &&
                   !valid_symbols[KEYWORD_CONTINUES] && !lexer->eof(lexer) &&
                   semicolon_after_weak_newline(lexer, valid_symbols);
        }

        skip(lexer);
    }

    skip(lexer);

    if (scan_whitespace_and_comments(lexer, scanned_comment, true, NULL) == REJECT) {
        return false;
    }

    return semicolon_before_next_token(lexer, valid_symbols);
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
        bool ret = scan_automatic_semicolon(lexer, valid_symbols, &scanned_comment);
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
