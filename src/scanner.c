#include "tree_sitter/parser.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
    CONTEXT_IDENTIFIER,
    ENTER_PLAIN,
    ENTER_AWAIT,
    ENTER_YIELD,
    ENTER_BOTH,
    ENTER_PLAIN_EXPRESSION,
    ENTER_ASYNC_ARROW,
    ENTER_STATIC_BLOCK,
    ENTER_ORDINARY_METHOD,
    LEAVE_CONTEXT,
    LEAVE_CONCISE_BODY,
    YIELD_OPERAND,
    YIELD_LINE_TERMINATOR,
};

enum Context {
    AWAIT_CONTEXT = 1,
    YIELD_CONTEXT = 2,
};

// Four scope kinds fit in two bits.
// shortcut: excess scopes use the base lexer until they close; use parser states if deeper nesting needs full context.
enum {
    SCOPE_HEADER_SIZE = 6,
    SCOPE_BYTES = TREE_SITTER_SERIALIZATION_BUFFER_SIZE - SCOPE_HEADER_SIZE,
};

typedef struct {
    uint32_t overflow;
    uint16_t depth;
    uint8_t flags[SCOPE_BYTES];
} Scanner;

void *tree_sitter_javascript_external_scanner_create(void) { return calloc(1, sizeof(Scanner)); }

void tree_sitter_javascript_external_scanner_destroy(void *payload) { free(payload); }

unsigned tree_sitter_javascript_external_scanner_serialize(void *payload, char *buffer) {
    const Scanner *scanner = payload;
    if (!scanner->depth) return 0;

    unsigned length = (scanner->depth + 3) / 4;
    memcpy(buffer, &scanner->overflow, sizeof(scanner->overflow));
    memcpy(buffer + sizeof(scanner->overflow), &scanner->depth, sizeof(scanner->depth));
    memcpy(buffer + SCOPE_HEADER_SIZE, scanner->flags, length);
    unsigned used_bits = (scanner->depth % 4) * 2;
    if (used_bits) buffer[SCOPE_HEADER_SIZE + length - 1] &= (1u << used_bits) - 1;
    return SCOPE_HEADER_SIZE + length;
}

void tree_sitter_javascript_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = payload;
    scanner->depth = 0;
    scanner->overflow = 0;
    if (length < SCOPE_HEADER_SIZE) return;

    uint16_t depth;
    memcpy(&depth, buffer + sizeof(scanner->overflow), sizeof(depth));
    if (depth > SCOPE_BYTES * 4 || length != SCOPE_HEADER_SIZE + (depth + 3u) / 4) return;

    scanner->depth = depth;
    memcpy(&scanner->overflow, buffer, sizeof(scanner->overflow));
    memcpy(scanner->flags, buffer + SCOPE_HEADER_SIZE, length - SCOPE_HEADER_SIZE);
}

static void enter_context(Scanner *scanner, unsigned flags) {
    if (scanner->depth == SCOPE_BYTES * 4) {
        scanner->overflow++;
        return;
    }
    unsigned index = scanner->depth++;
    unsigned shift = (index % 4) * 2;
    scanner->flags[index / 4] = (scanner->flags[index / 4] & ~(3u << shift)) | (flags << shift);
}

static unsigned context_flags(const Scanner *scanner) {
    if (scanner->overflow) return AWAIT_CONTEXT | YIELD_CONTEXT;
    if (!scanner->depth) return AWAIT_CONTEXT;
    unsigned index = scanner->depth - 1;
    return (scanner->flags[index / 4] >> ((index % 4) * 2)) & 3u;
}

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
    REJECT,     // A slash that does not start a comment
    NO_NEWLINE, // Unclear if semicolon will be legal, continue
    ACCEPT,     // Semicolon is legal, assuming a comment was encountered
} WhitespaceResult;

static bool is_asi_line_terminator(int32_t c, bool declaration_end) {
    return c == '\n' || c == 0x2028 || c == 0x2029 || (declaration_end && c == '\r');
}

/**
 * @param consume If false, only consume enough to check if comment indicates semicolon-legality
 * @param break_after_comment If not NULL: set when a line terminator follows a comment of this scan, in white space or
 *        inside a later block comment (the next call then sees it and decides)
 * @param declaration_newline If not NULL: record line terminators, including CR.
 */
static WhitespaceResult scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_comment, bool consume,
                                                     bool *break_after_comment, bool *declaration_newline) {
    bool saw_block_newline = false;
    bool seen_comment = false;

    for (;;) {
        while (is_extra_space(lexer->lookahead)) {
            if (is_asi_line_terminator(lexer->lookahead, declaration_newline != NULL)) {
                if (seen_comment && break_after_comment) *break_after_comment = true;
                if (declaration_newline) *declaration_newline = true;
            }
            skip(lexer);
        }

        if (lexer->lookahead == '/') {
            skip(lexer);

            if (lexer->lookahead == '/') {
                skip(lexer);
                while (!lexer->eof(lexer) && !is_asi_line_terminator(lexer->lookahead, declaration_newline != NULL)) {
                    skip(lexer);
                }
                *scanned_comment = true;
                seen_comment = true;
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                while (!lexer->eof(lexer)) {
                    if (lexer->lookahead == '*') {
                        skip(lexer);
                        if (lexer->lookahead == '/') {
                            skip(lexer);
                            *scanned_comment = true;
                            seen_comment = true;

                            if (lexer->lookahead != '/' && !consume) {
                                return saw_block_newline ? ACCEPT : NO_NEWLINE;
                            }

                            break;
                        }
                    } else if (is_asi_line_terminator(lexer->lookahead, declaration_newline != NULL)) {
                        // A CR alone takes the next-token check instead of the legacy comment shortcut.
                        saw_block_newline |= lexer->lookahead != '\r';
                        if (declaration_newline) *declaration_newline = true;
                        if (seen_comment && break_after_comment) {
                            *break_after_comment = true;
                        }
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

// The next character of an identifier name: ASCII letters and digits, `_`, `$`, `\` (an escape), and any other
// non-ASCII character that is not white space. ASCII comparisons, not isw*: those differ between C runtimes.
static bool is_identifier_part(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$' ||
           c == '\\' || (c > 0x7f && !is_extra_space(c));
}

// After a line terminator: does the token that starts at the lookahead get a semicolon inserted before it?
static bool semicolon_before_next_token(TSLexer *lexer, const bool *valid_symbols, bool declaration_end,
                                        bool defer_declaration) {
    bool binding_end = valid_symbols[BINDING_END] || declaration_end;
    switch (lexer->lookahead) {
        // A class field or a declaration's bindings cannot go on with these (`a<LF>*b() {}`, `c<LF>[x] = 1`,
        // `let a<LF><a/>`), unlike an expression, `return`, or a member prefix (`get<LF>[x]() {}`, `static<LF>*g() {}`;
        // `async<LF>*g() {}` stays one method, as it parses today). shortcut: `get<LF>*g() {}` and `set<LF>*g() {}`
        // (a field, then a generator) stay errors: telling get/set from static/async costs a marker of +1.8 % parser.c.
        case '*':
        case '[':
            return binding_end && !valid_symbols[LOGICAL_OR] && !valid_symbols[KEYWORD_CONTINUES];
        case '<':
            return binding_end && !valid_symbols[LOGICAL_OR];

        case '(':
        case '`':
            return declaration_end && !defer_declaration;
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
            return lexer->lookahead == '+' || (declaration_end && !defer_declaration);
        case '-':
            skip(lexer);
            return lexer->lookahead == '-' || (declaration_end && !defer_declaration);

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

static bool scan_automatic_semicolon(TSLexer *lexer, const bool *valid_symbols, bool *scanned_comment,
                                     bool *at_next_token) {
    bool comment_condition = !valid_symbols[LOGICAL_OR];
    bool declaration_end = valid_symbols[DECLARATION_END] && comment_condition;
    bool declaration_break = false;
    bool *declaration_newline = declaration_end ? &declaration_break : NULL;
    bool comment_before_break = false;
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    for (;;) {
        if (lexer->eof(lexer)) {
            return true;
        }

        if (lexer->lookahead == '/') {
            WhitespaceResult result = scan_whitespace_and_comments(
                lexer, scanned_comment, false, NULL, declaration_newline);
            if (result == REJECT) {
                return declaration_break;
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

        if (is_asi_line_terminator(lexer->lookahead, false)) {
            comment_before_break = *scanned_comment;
            skip(lexer);
            break;
        }

        // Keep the early comment check after a bare CR so it can end the declaration before the comment.
        if (declaration_end && lexer->lookahead == '\r') {
            declaration_break = true;
        }

        if (!is_extra_space(lexer->lookahead)) {
            if (!declaration_break) {
                *at_next_token = true;
                return false;
            }
            break;
        }

        skip(lexer);
    }

    bool break_after_comment = false;
    // Once a break is known, keep the existing comment attachment and explicit-semicolon decisions.
    WhitespaceResult result = scan_whitespace_and_comments(lexer, scanned_comment, true, &break_after_comment, NULL);
    bool defer = *scanned_comment && (comment_before_break || break_after_comment);
    if (result == REJECT) {
        return declaration_end && !defer;
    }

    // After a comment the next call decides, as before: where the comment holds a line break the base scanner
    // takes the semicolon after it (`let x<LF>/*<LF>*//*<LF>*/[b]`), so the declaration keeps its comment. Only where
    // that call will still see a line terminator (a comment came before the break, or one follows the first comment).
    // Otherwise the break scanned here is the only one and decides now (`let x<LF>/**/[y]`, `let x<LF>U+FEFF/**/[y]`).
    if (defer && (lexer->lookahead == '*' || lexer->lookahead == '[' || lexer->lookahead == '<')) {
        return false;
    }

    *at_next_token = lexer->lookahead == ',' || lexer->lookahead == ':' || lexer->lookahead == ';' ||
                     lexer->lookahead == ')' || lexer->lookahead == ']' || lexer->lookahead == '}';
    return semicolon_before_next_token(lexer, valid_symbols, declaration_end, defer);
}

// After `return`, `break`, `continue` and a label (ECMA-262 12.9.1, no LineTerminator here): a line terminator ends the
// statement whatever follows it, unless it is an explicit `;`. A lone CR is a line terminator, and so is one in a block
// comment. The statement also ends at an included range start, a `}` and the end of the input.
static bool scan_restricted_semicolon(TSLexer *lexer, bool *at_next_token) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);

    bool newline = false;
    bool scanned_comment = false;
    for (;;) {
        int32_t c = lexer->lookahead;
        if (lexer->eof(lexer) || c == '}' || lexer->is_at_included_range_start(lexer)) {
            return true;
        }

        if (c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029) {
            newline = true;
            skip(lexer);
        } else if (is_extra_space(c)) {
            skip(lexer);
        } else if (c != '/') {
            *at_next_token = !newline && !scanned_comment;
            return newline && c != ';';
        } else {
            skip(lexer);
            scanned_comment = true;
            if (lexer->lookahead == '/') {
                while (!lexer->eof(lexer) && lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
                       lexer->lookahead != 0x2028 && lexer->lookahead != 0x2029) {
                    skip(lexer);
                }
            } else if (lexer->lookahead == '*') {
                skip(lexer);
                while (!lexer->eof(lexer)) {
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

// A line break before an operand or '*' cannot be skipped, even where ASI is unavailable.
static bool scan_yield_operand(TSLexer *lexer, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    bool comment = false;
    bool newline = false;
    WhitespaceResult result = scan_whitespace_and_comments(lexer, &comment, true, NULL, &newline);
    int32_t next = lexer->lookahead;
    if (result != REJECT) {
        if (next == ';' || next == ',' || next == ':' || next == ')' || next == ']') {
            return false;
        }
        if (lexer->eof(lexer) || next == '}') {
            lexer->result_symbol = AUTOMATIC_SEMICOLON;
            return valid_symbols[AUTOMATIC_SEMICOLON];
        }
    }
    if (newline) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            lexer->result_symbol = AUTOMATIC_SEMICOLON;
            return true;
        }
        lexer->result_symbol = YIELD_LINE_TERMINATOR;
        return valid_symbols[YIELD_LINE_TERMINATOR];
    }
    lexer->result_symbol = YIELD_OPERAND;
    return true;
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

static bool scan_context_identifier(const Scanner *scanner, TSLexer *lexer) {
    unsigned flags = context_flags(scanner);
    const char *word = NULL;
    if (lexer->lookahead == 'a' && !(flags & AWAIT_CONTEXT)) {
        word = "await";
    } else if (lexer->lookahead == 'y' && !(flags & YIELD_CONTEXT)) {
        word = "yield";
    }
    if (!word) return false;
    for (; *word; word++) {
        if (lexer->lookahead != *word) return false;
        advance(lexer);
    }
    if (is_identifier_part(lexer->lookahead)) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = CONTEXT_IDENTIFIER;
    return true;
}

static bool leave_context(Scanner *scanner, TSLexer *lexer, enum TokenType symbol) {
    if (scanner->overflow) scanner->overflow--;
    else if (scanner->depth) scanner->depth--;
    lexer->result_symbol = symbol;
    return true;
}

static bool at_concise_body_end(TSLexer *lexer) {
    switch (lexer->lookahead) {
        case ',':
        case ':':
        case ';':
        case ')':
        case ']':
        case '}':
            return true;
        default:
            return lexer->eof(lexer);
    }
}

bool tree_sitter_javascript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = payload;
    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_template_chars(lexer);
    }

    if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer)) {
        return true;
    }

    if (valid_symbols[LEAVE_CONTEXT]) {
        lexer->mark_end(lexer);
        return leave_context(scanner, lexer, LEAVE_CONTEXT);
    }

    if (valid_symbols[ENTER_PLAIN_EXPRESSION] || valid_symbols[ENTER_ASYNC_ARROW] || valid_symbols[ENTER_ORDINARY_METHOD]) {
        unsigned token = valid_symbols[ENTER_ASYNC_ARROW] ? ENTER_ASYNC_ARROW :
                         valid_symbols[ENTER_ORDINARY_METHOD] ? ENTER_ORDINARY_METHOD : ENTER_PLAIN_EXPRESSION;
        lexer->mark_end(lexer);
        enter_context(scanner, token == ENTER_ASYNC_ARROW ? AWAIT_CONTEXT : 0);
        lexer->result_symbol = token;
        return true;
    }

    if (valid_symbols[YIELD_OPERAND]) {
        return scan_yield_operand(lexer, valid_symbols);
    }

    if (valid_symbols[LEAVE_CONCISE_BODY]) {
        // Look through trivia without extending the body or treating a new included range as a line break.
        lexer->mark_end(lexer);
        bool scanned_comment = false;
        bool newline = false;
        if (scan_whitespace_and_comments(lexer, &scanned_comment, true, NULL, &newline) == REJECT) return false;
        bool ternary = lexer->lookahead == '?';
        if (at_concise_body_end(lexer) ||
            (newline && semicolon_before_next_token(lexer, valid_symbols, false, false))) {
            return leave_context(scanner, lexer, LEAVE_CONCISE_BODY);
        }
        if (scanned_comment) return false;
        if (ternary && valid_symbols[TERNARY_QMARK]) return scan_ternary_qmark(lexer);
        if (newline) return false;
    } else if (valid_symbols[AUTOMATIC_SEMICOLON]) {
        bool scanned_comment = false;
        bool at_next_token = false;
        bool ret = valid_symbols[RESTRICTED_KEYWORD]
                       ? scan_restricted_semicolon(lexer, &at_next_token)
                       : scan_automatic_semicolon(lexer, valid_symbols, &scanned_comment, &at_next_token);
        if (ret) return true;
        if (!scanned_comment && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        if (!at_next_token || scanned_comment) return false;
    } else {
        lexer->mark_end(lexer);
    }

    if (valid_symbols[ENTER_STATIC_BLOCK] || valid_symbols[ENTER_PLAIN] || valid_symbols[ENTER_AWAIT] ||
        valid_symbols[ENTER_YIELD] || valid_symbols[ENTER_BOTH]) {
        while (is_extra_space(lexer->lookahead)) skip(lexer);
        unsigned token = ENTER_PLAIN_EXPRESSION;
        if (valid_symbols[ENTER_STATIC_BLOCK] && lexer->lookahead == '{') {
            token = ENTER_STATIC_BLOCK;
        } else if (lexer->lookahead == '(') {
            for (token = ENTER_PLAIN; token < ENTER_PLAIN_EXPRESSION && !valid_symbols[token]; token++) {}
        }

        if (token != ENTER_PLAIN_EXPRESSION) {
            enter_context(scanner, token == ENTER_STATIC_BLOCK ? AWAIT_CONTEXT : token - ENTER_PLAIN);
            lexer->result_symbol = token;
            return true;
        }
    }

    if (valid_symbols[CONTEXT_IDENTIFIER]) {
        while (is_extra_space(lexer->lookahead)) skip(lexer);
        if (lexer->lookahead == 'a' || lexer->lookahead == 'y') {
            return scan_context_identifier(scanner, lexer);
        }
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
