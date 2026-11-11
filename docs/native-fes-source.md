# FES source boundaries

`src/fes/source.mjs` is an independently verified source-processing model.
`src/fes/tokens.mjs` is the existing raw parameter helper, factored out of the
sound-configuration adapter without changing its behavior. The source model is
not yet the default `parseProgram`/`FESPlayer` pipeline. The compatibility registry
therefore keeps the affected source contracts partial until that integration.

The original engine uses four distinct operations:

1. Plain files receive quote-blind comment deletion, TAB and repeated-ASCII-space
   cleanup, literal-parenthesis space removal and mechanical inline-if/else
   expansion. Both CR and LF terminate lines; NUL terminates source. Block
   comments preserve line separation while deleting their contents. The `if(`
   spacing insertion is a single textual replacement, not a syntax parser.
2. Section indexing appends repeated headers. DEFINE and OBJECT use raw token
   lookup; they do not run the source macro dictionary over those rows. Macro
   registration reads only name and token 1.
3. Each runtime block read copies its stored line and applies macros once.
   Replacements are whole identifier tokens, case-sensitive and nonrecursive.
   Quoted identifiers remain literals. Replacement text is not lexed again.
4. Parameter consumers split the resulting line with the native raw helper and
   then expand string-bank/language values. Text consumers such as str, apend
   and name instead take the tail after two literal ASCII spaces and preserve
   quotes. These operations cannot be replaced by split/unquote/join.

The compressed `FES\0` loader skips plain-source normalization and include
expansion, then indexes its stored lines. The decoder/player must retain that
distinction when adopting the model. It does not require a new format generation,
version rejection or component loading gate.

## Registered version differences

The raw helper retains the existing ABI quote flag: 76 recognizes ordinary
double quotes, including its observed double-NUL indexed-token truncation;
74 does not. Parenthesis grouping and `(:...)` are separate behaviors. Raw TAB
is not a separator; plain-source cleanup converts it before token lookup.

Macro lexical scanning recognizes string and character literals independently
of that raw-parameter quote flag. The per-version `fes.macroLiterals` data selects
the observed emission:

| ABI | Strings                                                                             | Character literals                                                         |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 74  | Reconstruct with surrounding quotes, removing only the escape before a double quote | Wrap the original character lexeme in one additional pair of single quotes |
| 76  | Retain raw lexeme                                                                   | Retain raw lexeme                                                          |

Both preserve the tested decimal, hexadecimal, signed-zero, floating and
exponent spellings. Other backslashes retain their spelling. With no macro
dictionary, the original method leaves the line untouched. No profile-prefix
branch or unregistered engine was introduced.

## Evidence and remaining integration

The public fixture retains 21 authored original normalization observations and
16 direct original macro-method outputs. The preprocessing/section rules also
have ten complete relocation-normalized function comparisons, 1,443 instructions
per engine. This is bounded evidence for the listed rules, not a claim that the
whole loader or arbitrary malformed control flow has been compared. Existing
sound-configuration tests retain their independent 147 raw-token cases per ABI.

Remaining work is to adopt the prepared/plain distinction, preserve processed
OBJECT rows and execution tails, move macro use to each block read, and update
source-address/checkpoint records around those exact executing copies. The old
parse-time recursive macro pass is still a known production gap at this commit.
