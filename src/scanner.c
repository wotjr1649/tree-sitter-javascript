#include "tree_sitter/parser.h"

#include <stdio.h>

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
    DECLARATION_END,
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

// White space and line terminators as the grammar's `extras` regex has them (extras_character_set_1 in parser.c).
// Explicit, not iswspace: that differs between C runtimes (C locale, glibc, Windows UCRT).
static bool is_extra_space(int32_t c) {
    return (c >= '\t' && c <= '\r') || c == ' ' || c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200b) ||
           c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x2060 || c == 0x3000 || c == 0xfeff;
}

// Blank in a JSX text line: ASCII white space only (the C locale's iswspace). Any other character is text, as in Babel,
// which trims only spaces and tabs: U+00A0, U+3000, U+200B, U+FEFF and the others are content, not layout.
static bool is_jsx_space(int32_t c) { return (c >= '\t' && c <= '\r') || c == ' '; }

// ASCII, not iswdigit: that matches non-ASCII digits on some C runtimes.
static bool is_digit(int32_t c) { return c >= '0' && c <= '9'; }

typedef enum {
    ASI_NEXT_TOKEN,
    ASI_SLASH,
    ASI_END,
} ASILookahead;

typedef struct {
    bool newline;
    bool comment;
    bool leading_non_cr_break;
    bool break_after_comment;
    bool non_cr_break_after_comment;
    bool can_defer_binding;
    bool line_comment;
    bool ends_at_block_comment;
} ASITrivia;

static bool is_line_terminator(int32_t c) {
    return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029;
}

// A line terminator inside a block comment counts as a line terminator between tokens (ECMA-262 12.4).
static ASILookahead scan_asi_trivia(TSLexer *lexer, ASITrivia *trivia) {
    for (;;) {
        int32_t c = lexer->lookahead;
        if (lexer->eof(lexer) || lexer->is_at_included_range_start(lexer)) {
            return ASI_END;
        }
        if (is_extra_space(c)) {
            trivia->ends_at_block_comment = false;
            if (is_line_terminator(c)) {
                trivia->newline = true;
                trivia->break_after_comment |= trivia->comment;
                // Keep the old comment attachment where CR counted only for declaration termination.
                trivia->leading_non_cr_break |= !trivia->comment && c != '\r';
                trivia->non_cr_break_after_comment |= trivia->comment && c != '\r';
            }
            skip(lexer);
        } else if (c != '/') {
            return ASI_NEXT_TOKEN;
        } else {
            skip(lexer);
            if (lexer->lookahead == '/') {
                trivia->line_comment = true;
                skip(lexer);
                while (!lexer->eof(lexer) && !is_line_terminator(lexer->lookahead)) {
                    skip(lexer);
                }
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                bool block_newline = false;
                while (!lexer->eof(lexer)) {
                    c = lexer->lookahead;
                    skip(lexer);
                    if (c == '*' && lexer->lookahead == '/') {
                        skip(lexer);
                        break;
                    }
                    if (is_line_terminator(c)) {
                        block_newline = true;
                        trivia->non_cr_break_after_comment |= trivia->comment && c != '\r';
                    }
                }
                if (!trivia->comment) {
                    trivia->can_defer_binding = !block_newline && lexer->lookahead != '/';
                }
                trivia->ends_at_block_comment = true;
                trivia->newline |= block_newline;
                trivia->break_after_comment |= trivia->comment && block_newline;
            } else {
                return ASI_SLASH;
            }
            trivia->comment = true;
        }
    }
}

// The next character of an identifier name: ASCII letters and digits, `_`, `$`, `\` (an escape), and any other
// non-ASCII character that is not white space. ASCII comparisons, not isw*: those differ between C runtimes.
static bool is_identifier_part(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$' ||
           c == '\\' || (c > 0x7f && !is_extra_space(c));
}

// After a line terminator: does the token that starts at the lookahead get a semicolon inserted before it?
static bool semicolon_before_next_token(TSLexer *lexer, const bool *valid_symbols, bool declaration_end, bool defer_binding) {
    bool binding_end = valid_symbols[BINDING_END] || declaration_end;
    switch (lexer->lookahead) {
        // A class field or a declaration's bindings cannot go on with these (`a<LF>*b() {}`, `c<LF>[x] = 1`,
        // `let a<LF><a/>`), unlike an expression, `return`, or a member prefix (`get<LF>[x]() {}`, `static<LF>*g() {}`;
        // `async<LF>*g() {}` stays one method, as it parses today). shortcut: `get<LF>*g() {}` and `set<LF>*g() {}`
        // (a field, then a generator) stay errors: telling get/set from static/async costs a marker of +1.8 % parser.c.
        case '*':
        case '[':
            return binding_end && !defer_binding && !valid_symbols[LOGICAL_OR] && !valid_symbols[KEYWORD_CONTINUES];
        case '<':
            return binding_end && !defer_binding && !valid_symbols[LOGICAL_OR];

        case '(':
        case '`':
            return declaration_end && !defer_binding;
        case ',':
        case ':':
        case ';':
        case '%':
        case '>':
        case '=':
        case '?':
        case '^':
        case '|':
        case '&':
        case '/':
            return false;

        // Insert a semicolon before decimals literals but not otherwise.
        case '.':
            skip(lexer);
            return is_digit(lexer->lookahead);

        // A bare declaration ends before a unary sign, an expression can continue with a binary sign.
        case '+':
            skip(lexer);
            return lexer->lookahead == '+' || (declaration_end && !defer_binding);
        case '-':
            skip(lexer);
            return lexer->lookahead == '-' || (declaration_end && !defer_binding);

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
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    ASITrivia trivia = {0};
    ASILookahead next = scan_asi_trivia(lexer, &trivia);
    *scanned_comment = trivia.comment;
    bool restricted = valid_symbols[RESTRICTED_KEYWORD];
    if (next == ASI_END) {
        // A trailing comment can be lexed as an extra before the ordinary EOF insertion.
        bool defer_eof = !restricted && valid_symbols[LOGICAL_OR] && !trivia.leading_non_cr_break &&
                         (trivia.line_comment || trivia.ends_at_block_comment);
        return !defer_eof || !lexer->eof(lexer);
    }
    if (next == ASI_NEXT_TOKEN && lexer->lookahead == '}') {
        return true;
    }
    if (!trivia.newline) {
        return false;
    }

    // After return, break and continue, a line terminator ends the statement unless a ';' follows.
    if (restricted) {
        return next == ASI_SLASH || lexer->lookahead != ';';
    }

    // Let the lexer keep a comment with the preceding expression when the next scan can still see the break.
    if (valid_symbols[LOGICAL_OR] && trivia.break_after_comment && !trivia.leading_non_cr_break) {
        return false;
    }
    bool declaration_end = valid_symbols[DECLARATION_END] && !valid_symbols[LOGICAL_OR];
    bool defer_binding = trivia.non_cr_break_after_comment && (trivia.leading_non_cr_break || trivia.can_defer_binding);
    if (next == ASI_SLASH) {
        return declaration_end && !defer_binding;
    }
    return semicolon_before_next_token(lexer, valid_symbols, declaration_end, defer_binding);
}

static bool scan_ternary_qmark(TSLexer *lexer) {
    for (;;) {
        if (!is_extra_space(lexer->lookahead)) {
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
            if (is_digit(lexer->lookahead)) {
                return true;
            }
            return false;
        }
        return true;
    }
    return false;
}

static bool scan_html_comment(TSLexer *lexer) {
    while (is_extra_space(lexer->lookahead)) {
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

    while (!lexer->eof(lexer) && !is_line_terminator(lexer->lookahead)) {
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

    while (!lexer->eof(lexer) && lexer->lookahead != '<' && lexer->lookahead != '>' && lexer->lookahead != '{' &&
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
        bool is_wspace = is_jsx_space(lexer->lookahead);
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
