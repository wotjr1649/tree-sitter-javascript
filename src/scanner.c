#include "tree_sitter/parser.h"

#include <stdio.h>
#include <stdlib.h>
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
    FUNCTION_START,
    ARROW_START,
    ASYNC_ARROW_START,
    ASYNC_ARROW_EXPRESSION_START,
    STATIC_BLOCK_START,
    FUNCTION_END,
    AWAIT,
    YIELD,
    ASYNC_FUNCTION,
    ASYNC_METHOD,
    GENERATOR_STAR_FUNCTION,
    GENERATOR_STAR_METHOD,
    FUNCTION_PARAMS,
    METHOD_PARAMS,
};

// Whether `await` and `yield` are keywords depends on the enclosing function, which the parser tells the scanner with
// zero-width tokens at the start and the end of every function body. The scanner keeps one byte per open function:
// how `await` reads there and whether `yield` is a keyword.
enum AwaitMode {
    AWAIT_IDENTIFIER, // a function that is not async
    AWAIT_KEYWORD,    // an async function or a class static block, or after an async arrow function's expression body
    AWAIT_TOP,        // the top level: a keyword as in a module, except before a `/`, which divides
};

#define YIELD_BIT 4
// shortcut: a function nested more than 960 deep reads the context of the 960th; raise this when real code needs it
// (the state, 3 bytes + the entries + the depth, must fit the 1024-byte serialization buffer).
#define MAX_FUNCTION_DEPTH 960

// A function or method that is async or a generator says so before its parameters, and a function in the parameters must
// not take that for itself: the scanner keeps one entry for each function whose parameters are open, and for each method
// with `async` or `*` (a signature without a body leaves its entry behind: the oldest entries are dropped).
#define MAX_ENTRIES 32
#define ENTRY_ASYNC 1
#define ENTRY_GENERATOR 2
#define ENTRY_FRESH 4  // noted by `async` or `*`, not yet claimed by the marker after `function`
#define ENTRY_METHOD 8 // noted by a method's `async` or `*`

typedef struct {
    uint16_t overflow; // function bodies opened beyond MAX_FUNCTION_DEPTH
    uint16_t depth;
    unsigned char entry_count;
    unsigned char entries[MAX_ENTRIES];
    unsigned char frames[MAX_FUNCTION_DEPTH]; // frames[0] is the top level
} Scanner;

static void scanner_reset(Scanner *scanner) {
    scanner->overflow = 0;
    scanner->depth = 1;
    scanner->entry_count = 0;
    scanner->frames[0] = AWAIT_TOP;
}

void *tree_sitter_javascript_external_scanner_create() {
    Scanner *scanner = malloc(sizeof(Scanner));
    scanner_reset(scanner);
    return scanner;
}

void tree_sitter_javascript_external_scanner_destroy(void *p) { free(p); }

unsigned tree_sitter_javascript_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = payload;
    buffer[0] = (char)(scanner->overflow & 0xff);
    buffer[1] = (char)(scanner->overflow >> 8);
    buffer[2] = (char)scanner->entry_count;
    memcpy(buffer + 3, scanner->entries, scanner->entry_count);
    memcpy(buffer + 3 + scanner->entry_count, scanner->frames, scanner->depth);
    return 3u + scanner->entry_count + scanner->depth;
}

void tree_sitter_javascript_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = payload;
    if (length < 4) {
        scanner_reset(scanner);
        return;
    }
    unsigned entry_count = (unsigned char)buffer[2];
    if (entry_count > MAX_ENTRIES || length < 4 + entry_count || length - 3 - entry_count > MAX_FUNCTION_DEPTH) {
        scanner_reset(scanner);
        return;
    }
    scanner->overflow = (uint16_t)((unsigned char)buffer[0] | ((unsigned char)buffer[1] << 8));
    scanner->entry_count = (unsigned char)entry_count;
    memcpy(scanner->entries, buffer + 3, entry_count);
    scanner->depth = (uint16_t)(length - 3 - entry_count);
    memcpy(scanner->frames, buffer + 3 + entry_count, scanner->depth);
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static bool scan_template_chars(TSLexer *lexer) {
    lexer->result_symbol = TEMPLATE_CHARS;
    for (bool has_content = false;; has_content = true) {
        lexer->mark_end(lexer);
        switch (lexer->lookahead) {
            case '`':
                return has_content;
            case '\0':
                return false;
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

// `at_token` is set when the semicolon is refused because a token follows, on the same line or the next, with the
// lexer at that token's first character.
static bool scan_automatic_semicolon(TSLexer *lexer, bool comment_condition, bool *scanned_comment, bool *at_token) {
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
            *at_token = true;
            return false;
        }

        skip(lexer);
    }

    skip(lexer);

    if (scan_whitespace_and_comments(lexer, scanned_comment, true) == REJECT) {
        return false;
    }

    switch (lexer->lookahead) {
        case '`':
        case ',':
        case ':':
        case ';':
        case '*':
        case '%':
        case '>':
        case '<':
        case '=':
        case '[':
        case '(':
        case '?':
        case '^':
        case '|':
        case '&':
        case '/':
            *at_token = true;
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

            if (!iswalpha(lexer->lookahead)) {
                return false;
            }

            for (unsigned i = 0; i < 8; i++) {
                if (lexer->lookahead != "stanceof"[i]) {
                    return true;
                }
                skip(lexer);
            }

            if (!iswalpha(lexer->lookahead)) {
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

// Characters the grammar's identifier token takes after its first one, as far as `await` and `yield` can end there.
static bool is_identifier_part(int32_t c) {
    if (c < 0x80) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '$' ||
               c == '\\';
    }
    return !(c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200B) || c == 0x2028 || c == 0x2029 || c == 0x202F ||
             c == 0x205F || c == 0x2060 || c == 0x3000 || c == 0xFEFF);
}

// The word at the lexer, not followed by more identifier characters. Marks the end of the token after it.
static bool scan_word(TSLexer *lexer, const char *word) {
    for (; *word; word++) {
        if (lexer->lookahead != *word) {
            return false;
        }
        advance(lexer);
    }
    lexer->mark_end(lexer);
    return !is_identifier_part(lexer->lookahead);
}

static void push_function(Scanner *scanner, unsigned char frame) {
    if (scanner->depth < MAX_FUNCTION_DEPTH) {
        scanner->frames[scanner->depth++] = frame;
    } else if (scanner->overflow < UINT16_MAX) {
        scanner->overflow++;
    }
}

static void pop_function(Scanner *scanner) {
    if (scanner->overflow > 0) {
        scanner->overflow--;
    } else if (scanner->depth > 1) {
        scanner->depth--;
    }
}

typedef enum {
    FOLLOWED_BY_NOTHING,     // `await` has no operand: `)`, `,`, `;`, `=`, `.`, an operator word, the end
    FOLLOWED_BY_PUNCTUATION, // a character that starts an operand but could also continue an expression (`(`, `[`, `-`)
    FOLLOWED_BY_SLASH,       // a `/` that closes no regular expression on its line: a division
    FOLLOWED_BY_REGEX,       // a regular expression operand
    FOLLOWED_BY_WORD,        // an identifier, keyword, number or string: only an operand can start so
} AwaitFollower;

// What comes after `await`, which the lexer has just passed (the token is marked).
static AwaitFollower scan_await_follower(TSLexer *lexer) {
    // `advance`, not `skip`: skipping would move the start of the `await` token behind it.
    for (;;) {
        while (iswspace(lexer->lookahead)) {
            advance(lexer);
        }
        if (lexer->lookahead != '/') {
            break;
        }
        advance(lexer);
        if (lexer->lookahead == '/') {
            while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != 0x2028 &&
                   lexer->lookahead != 0x2029) {
                advance(lexer);
            }
        } else if (lexer->lookahead == '*') {
            advance(lexer);
            while (lexer->lookahead != 0) {
                bool star = lexer->lookahead == '*';
                advance(lexer);
                if (star && lexer->lookahead == '/') {
                    advance(lexer);
                    break;
                }
            }
        } else {
            // A regular expression ends with a `/` on the same line, outside a class; `await / 2;` has none.
            bool in_class = false;
            while (lexer->lookahead != 0 && lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
                   lexer->lookahead != 0x2028 && lexer->lookahead != 0x2029) {
                int32_t ch = lexer->lookahead;
                advance(lexer);
                if (ch == '\\') {
                    if (lexer->lookahead == 0 || lexer->lookahead == '\n' || lexer->lookahead == '\r') {
                        break;
                    }
                    advance(lexer);
                } else if (ch == '[') {
                    in_class = true;
                } else if (ch == ']') {
                    in_class = false;
                } else if (ch == '/' && !in_class) {
                    return FOLLOWED_BY_REGEX;
                }
            }
            return FOLLOWED_BY_SLASH;
        }
    }
    int32_t c = lexer->lookahead;
    if ((c >= '0' && c <= '9') || c == '"' || c == '\'') {
        return FOLLOWED_BY_WORD;
    }
    if (is_identifier_part(c)) {
        // Words that follow an identifier: `await in x`, `await of y`.
        char word[12];
        unsigned length = 0;
        while (length < sizeof(word) - 1 && is_identifier_part(lexer->lookahead) && lexer->lookahead < 0x80) {
            word[length++] = (char)lexer->lookahead;
            advance(lexer);
        }
        word[length] = 0;
        if (is_identifier_part(lexer->lookahead)) {
            return FOLLOWED_BY_WORD;
        }
        static const char *const operator_words[] = {"in", "instanceof", "of", "as", "satisfies"};
        for (unsigned i = 0; i < sizeof(operator_words) / sizeof(operator_words[0]); i++) {
            if (strcmp(word, operator_words[i]) == 0) {
                return FOLLOWED_BY_NOTHING;
            }
        }
        return FOLLOWED_BY_WORD;
    }
    switch (c) {
        case '(':
            // `await()` calls the function of that name: empty parentheses are no operand.
            advance(lexer);
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                advance(lexer);
            }
            return lexer->lookahead == ')' ? FOLLOWED_BY_NOTHING : FOLLOWED_BY_PUNCTUATION;
        case '[': case '{': case '`': case '+': case '-': case '!': case '~': case '<':
            return FOLLOWED_BY_PUNCTUATION;
        default:
            return FOLLOWED_BY_NOTHING;
    }
}

// `await` and `yield` where the parser can read them as keywords. The lexer is at the start of a token, possibly
// after white space, and nothing has been marked: a keyword ends after the word.
static bool scan_async_rest(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols);

// White space and block comments after `async`, up to the next token on the line (`advance`: the token before is marked).
static void advance_over_same_line_trivia(TSLexer *lexer) {
    for (;;) {
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(lexer);
        }
        if (lexer->lookahead != '/') {
            return;
        }
        advance(lexer);
        if (lexer->lookahead != '*') {
            return; // a line comment or a `/`: no name follows
        }
        advance(lexer);
        while (lexer->lookahead != 0) {
            bool star = lexer->lookahead == '*';
            advance(lexer);
            if (star && lexer->lookahead == '/') {
                advance(lexer);
                break;
            }
        }
    }
}

static bool scan_keyword(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    unsigned char frame = scanner->frames[scanner->depth - 1];
    if (lexer->lookahead == 'a' && (valid_symbols[AWAIT] || valid_symbols[ASYNC_FUNCTION] || valid_symbols[ASYNC_METHOD])) {
        advance(lexer);
        if (lexer->lookahead == 's') {
            return (valid_symbols[ASYNC_FUNCTION] || valid_symbols[ASYNC_METHOD]) && scan_async_rest(scanner, lexer, valid_symbols);
        }
        unsigned char mode = frame & 3;
        // A function that is not async reads `await` as the identifier the lexer finds.
        if (!valid_symbols[AWAIT] || mode == AWAIT_IDENTIFIER || !scan_word(lexer, "wait")) {
            return false;
        }
        // The keyword where an operand follows. Without one `await` is a name (`function g(await) {}` inside an
        // async function reaches here), which the lexer reads. At the top level, which may be a script, a `/` after
        // `await` divides.
        AwaitFollower follower = scan_await_follower(lexer);
        if (follower == FOLLOWED_BY_NOTHING || (follower == FOLLOWED_BY_SLASH && mode == AWAIT_TOP)) {
            return false;
        }
        lexer->result_symbol = AWAIT;
        return true;
    } else if (lexer->lookahead == 'y' && valid_symbols[YIELD] && (frame & YIELD_BIT) && scan_word(lexer, "yield")) {
        lexer->result_symbol = YIELD;
        return true;
    }
    return false;
}

typedef enum {
    NOT_CONTEXT,     // nothing of the context was found; the lexer only passed white space
    CONTEXT_TOKEN,   // a token was found
    CONTEXT_REFUSED, // no token; the lexer has passed a comment, so nothing else can scan from here
} ContextResult;

static void push_entry(Scanner *scanner, unsigned char entry) {
    if (scanner->entry_count == MAX_ENTRIES) {
        memmove(scanner->entries, scanner->entries + 1, MAX_ENTRIES - 1);
        scanner->entry_count--;
    }
    scanner->entries[scanner->entry_count++] = entry;
}

// The context of a function or method whose body starts: its entry, the top one, or a plain one. A function's entry is what
// its `_function_params` claimed or pushed, a method's what its `async` or `*` noted and `_method_params` claimed, or
// `_method_params` pushed inside the parameters of another function. A method outside such parameters has none.
static void open_function(Scanner *scanner) {
    unsigned char entry = 0;
    if (scanner->entry_count > 0) {
        entry = scanner->entries[--scanner->entry_count];
    }
    push_function(scanner, (unsigned char)(((entry & ENTRY_ASYNC) ? AWAIT_KEYWORD : AWAIT_IDENTIFIER) |
                                           ((entry & ENTRY_GENERATOR) ? YIELD_BIT : 0)));
}

// The zero-width markers before a function's body. They are emitted only where a `{` follows: an arrow function's
// body may be an expression, and the marker of an async arrow function's expression body takes the place of the
// others there. A class static block's marker comes after its `{`.
static ContextResult scan_function_start(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[STATIC_BLOCK_START]) {
        push_function(scanner, AWAIT_KEYWORD);
        lexer->mark_end(lexer);
        lexer->result_symbol = STATIC_BLOCK_START;
        return CONTEXT_TOKEN;
    }
    if (!(valid_symbols[FUNCTION_START] || valid_symbols[ARROW_START] || valid_symbols[ASYNC_ARROW_START] ||
          valid_symbols[ASYNC_ARROW_EXPRESSION_START])) {
        return NOT_CONTEXT;
    }

    lexer->mark_end(lexer);
    bool scanned_comment = false;
    bool block = scan_whitespace_and_comments(lexer, &scanned_comment, true) != REJECT && lexer->lookahead == '{';
    if (block) {
        if (valid_symbols[FUNCTION_START]) {
            open_function(scanner);
            lexer->result_symbol = FUNCTION_START;
        } else if (valid_symbols[ARROW_START]) {
            push_function(scanner, AWAIT_IDENTIFIER);
            lexer->result_symbol = ARROW_START;
        } else if (valid_symbols[ASYNC_ARROW_START]) {
            push_function(scanner, AWAIT_KEYWORD);
            lexer->result_symbol = ASYNC_ARROW_START;
        } else {
            return CONTEXT_REFUSED;
        }
        return CONTEXT_TOKEN;
    }
    if (valid_symbols[ASYNC_ARROW_EXPRESSION_START]) {
        // The expression body has no end the scanner can see: `await` stays a keyword in the rest of the function
        // that holds the arrow (or of the top level), where it is a plain identifier only before an operator.
        unsigned char *frame = &scanner->frames[scanner->depth - 1];
        *frame = (unsigned char)((*frame & ~3) | AWAIT_KEYWORD);
        lexer->result_symbol = ASYNC_ARROW_EXPRESSION_START;
        return CONTEXT_TOKEN;
    }
    return CONTEXT_REFUSED;
}

// `await` and `yield`.
static ContextResult scan_context(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    while (iswspace(lexer->lookahead)) {
        skip(lexer);
    }

    if (scan_keyword(scanner, lexer, valid_symbols)) {
        return CONTEXT_TOKEN;
    }
    return NOT_CONTEXT;
}

// `async` before `function`, or before a method's name. `async` alone is an identifier, a method or a field name, so the
// keyword is returned only where `function` (or a name or `*`) follows it on the same line. The lexer is after the `a`.
static bool scan_async_rest(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    bool function = valid_symbols[ASYNC_FUNCTION];
    if (!scan_word(lexer, "sync")) {
        return false;
    }
    advance_over_same_line_trivia(lexer);
    bool follows;
    if (function) {
        const char *word = "function";
        for (; *word; word++) {
            if (lexer->lookahead != *word) {
                return false;
            }
            advance(lexer);
        }
        follows = !is_identifier_part(lexer->lookahead);
    } else {
        int32_t c = lexer->lookahead;
        follows = is_identifier_part(c) || c == '"' || c == '\'' || c == '[' || c == '#' || c == '*';
    }
    if (!follows) {
        return false;
    }
    push_entry(scanner, (unsigned char)(ENTRY_ASYNC | ENTRY_FRESH | (function ? 0 : ENTRY_METHOD)));
    lexer->result_symbol = function ? ASYNC_FUNCTION : ASYNC_METHOD;
    return true;
}

// The `*` of a generator function or method.
static bool scan_generator_star(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    bool function = valid_symbols[GENERATOR_STAR_FUNCTION];
    if (!function && !valid_symbols[GENERATOR_STAR_METHOD]) {
        return false;
    }
    while (iswspace(lexer->lookahead)) {
        skip(lexer);
    }
    if (lexer->lookahead != '*') {
        return false;
    }
    advance(lexer);
    lexer->mark_end(lexer);
    unsigned char owner = function ? 0 : ENTRY_METHOD;
    unsigned char *top = scanner->entry_count > 0 ? &scanner->entries[scanner->entry_count - 1] : NULL;
    if (top != NULL && (*top & ENTRY_FRESH) && (*top & ENTRY_METHOD) == owner) {
        *top |= ENTRY_GENERATOR;
    } else {
        push_entry(scanner, (unsigned char)(ENTRY_GENERATOR | ENTRY_FRESH | owner));
    }
    lexer->result_symbol = function ? GENERATOR_STAR_FUNCTION : GENERATOR_STAR_METHOD;
    return true;
}

// The marker right after `function` or its `*`: it claims the entry that `async` and `*` noted, or pushes a plain one.
static bool scan_function_params(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    if (!valid_symbols[FUNCTION_PARAMS]) {
        return false;
    }
    lexer->mark_end(lexer);
    if (valid_symbols[GENERATOR_STAR_FUNCTION]) {
        // Right after `function`: a comment may hide the `*`; the lexer reads it and the scanner is asked again.
        while (iswspace(lexer->lookahead)) {
            skip(lexer);
        }
        if (lexer->lookahead == '/') {
            return false;
        }
    }
    unsigned char *top = scanner->entry_count > 0 ? &scanner->entries[scanner->entry_count - 1] : NULL;
    if (top != NULL && (*top & ENTRY_FRESH) && !(*top & ENTRY_METHOD)) {
        *top &= (unsigned char)~ENTRY_FRESH;
    } else {
        push_entry(scanner, 0);
    }
    lexer->result_symbol = FUNCTION_PARAMS;
    return true;
}

// The marker before the parameters of a method, where `(` or `<` follows its name. Only inside the parameters of another
// function, or after a method's `async` or `*` (some entry is open): a method elsewhere needs none, and where the
// parser could also read a block (`{ f(x); }`) the marker is not wanted.
static bool scan_method_params(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    if (!valid_symbols[METHOD_PARAMS] || scanner->entry_count == 0) {
        return false;
    }
    lexer->mark_end(lexer);
    while (iswspace(lexer->lookahead)) {
        skip(lexer);
    }
    if (lexer->lookahead != '(' && lexer->lookahead != '<') {
        return false;
    }
    unsigned char *top = &scanner->entries[scanner->entry_count - 1];
    if ((*top & ENTRY_FRESH) && (*top & ENTRY_METHOD)) {
        *top &= (unsigned char)~ENTRY_FRESH;
    } else {
        push_entry(scanner, 0);
    }
    lexer->result_symbol = METHOD_PARAMS;
    return true;
}

#define CONTEXT_SYMBOLS_VALID(valid_symbols) \
    (valid_symbols[AWAIT] || valid_symbols[YIELD] || valid_symbols[ASYNC_FUNCTION] || valid_symbols[ASYNC_METHOD])

bool tree_sitter_javascript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = payload;
    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            // Error recovery: every token is valid.
            return false;
        }
        return scan_template_chars(lexer);
    }

    if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer)) {
        return true;
    }

    if (valid_symbols[FUNCTION_END]) {
        // After the `}` of a function body.
        pop_function(scanner);
        lexer->mark_end(lexer);
        lexer->result_symbol = FUNCTION_END;
        return true;
    }

    ContextResult start = scan_function_start(scanner, lexer, valid_symbols);
    if (start != NOT_CONTEXT) {
        return start == CONTEXT_TOKEN;
    }

    if (!valid_symbols[AUTOMATIC_SEMICOLON] &&
        (scan_generator_star(scanner, lexer, valid_symbols) || scan_function_params(scanner, lexer, valid_symbols) ||
         scan_method_params(scanner, lexer, valid_symbols))) {
        return true;
    }

    if (valid_symbols[AUTOMATIC_SEMICOLON]) {
        bool scanned_comment = false;
        bool at_token = false;
        bool ret = scan_automatic_semicolon(lexer, !valid_symbols[LOGICAL_OR], &scanned_comment, &at_token);
        if (!ret && !scanned_comment && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        // After a function declaration, a class or a block, `await` or `yield` can follow on the same line, and a class
        // member `async` can be followed by its name.
        if (!ret && at_token && !scanned_comment &&
            (scan_generator_star(scanner, lexer, valid_symbols) || scan_method_params(scanner, lexer, valid_symbols) ||
             scan_keyword(scanner, lexer, valid_symbols))) {
            return true;
        }
        return ret;
    }

    if (valid_symbols[TERNARY_QMARK]) {
        // After a `yield` without an operand an operator can follow, and so can the `yield` of a nested expression.
        if (CONTEXT_SYMBOLS_VALID(valid_symbols) && scan_context(scanner, lexer, valid_symbols) == CONTEXT_TOKEN) {
            return true;
        }
        return scan_ternary_qmark(lexer);
    }

    if (CONTEXT_SYMBOLS_VALID(valid_symbols)) {
        ContextResult result = scan_context(scanner, lexer, valid_symbols);
        if (result == CONTEXT_TOKEN) {
            return true;
        }
        if (result == CONTEXT_REFUSED) {
            return false;
        }
    }

    if (valid_symbols[HTML_COMMENT] && !valid_symbols[LOGICAL_OR] && !valid_symbols[ESCAPE_SEQUENCE] &&
        !valid_symbols[REGEX_PATTERN]) {
        return scan_html_comment(lexer);
    }

    return false;
}
