/* Compile the scanner outside the generated parser optimization pragmas. */
#if __has_include("../../src/scanner.c")
#include "../../src/scanner.c"
#endif
