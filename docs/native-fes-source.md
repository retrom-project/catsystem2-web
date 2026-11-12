# FES source boundaries

`src/fes/source.mjs` owns source processing in the default `parseProgram` and
`FESPlayer` pipeline. `src/fes/tokens.mjs` supplies the raw parameter helper,
shared with the sound-configuration adapter. `readFES` returns the current
`{ bytes, text, prepared }` decoder contract. `bytes` owns the exact uncompressed
body up to its first NUL, including any BOM or undecodable narrow bytes. `text`
is a derived diagnostic view; decoding it must not choose or rewrite execution
bytes. The prepared flag keeps compressed source from being prepared again.

The default player parses `bytes`. Program source bodies, prepared lines,
parameter tokens and registered macro values retain their own byte arrays.
JavaScript-authored source strings use UTF8 at the single source boundary.
Includes carry their own bytes and prepared flag, so a CP932 header can insert
its macro bytes into a UTF8 body without either being re-encoded. Human-readable
views are derived when needed; codec guesses never select execution bytes.

Neither ABI strips a BOM. A leading UTF8 BOM hides that first `#` header from
the byte scanner; later ordinary headers remain discoverable. CR/LF/NUL and
literal ASCII spaces retain their distinct roles. Invalid bytes stay opaque
through source processing. Macro lexing protects the original CP932-pair ranges
before treating an identifier or an escaped quote as syntax. It does not use a
Unicode case fold or replacement characters to rewrite its input.

The original engine uses four distinct operations:

1. Plain files receive quote-blind comment deletion, TAB and repeated-ASCII-space
   cleanup, literal-parenthesis space removal and mechanical inline-if/else
   expansion. Both CR and LF terminate lines; NUL terminates source. Block
   comments preserve line separation while deleting their contents. The `if(`
   spacing insertion is a single textual replacement, not a syntax parser.
2. Section indexing appends repeated headers. DEFINE and OBJECT use raw token
   lookup; they do not run the source macro dictionary over those rows. Macro
   registration reads only name and token 1. A missing value does not register a
   macro; a present token expanded to empty bytes does. Name and value each run
   their original bank/SCRIPT expansion once at registration.
3. Each runtime block read copies its stored line and applies macros once.
   Replacements are whole identifier tokens, case-sensitive and nonrecursive.
   Quoted identifiers remain literals. Replacement text is not lexed again.
4. Parameter consumers split the resulting line with the native raw helper and
   then expand string-bank/language values. Text consumers such as str, apend
   and name instead take the tail after two literal ASCII spaces and preserve
   quotes. Their bank and SCRIPT expansion happens once before the selected
   object loop. STRING and NVSTRING interpret the copied bytes as narrow text;
   STRING8 interprets them as UTF8. A target class does not re-encode that tail.
   Missing str/name tails clear their admitted targets without expansion;
   missing apend tails return without changing them. These operations cannot be
   replaced by split/unquote/join.

The compressed `FES\0` loader skips plain-source normalization and include
expansion, then indexes its stored lines. The decoder/player retains that
distinction without a format generation, version rejection or component gate.

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

OBJECT records retain their original prepared header and row, alongside raw
parameter tokens. Different positions retain different bytes even when their
decoded views are identical. Runtime text commands receive the literal tail
rather than rejoining those tokens. The source arena preserves the stored
instruction and its separately allocated executing copies. Copy identity and
conditional offsets use actual bytes; conditional dispatch preserves trailing
tail bytes. Object-name allocations keep their separate CP932 ABI. Restoring
validates copy contents and bounds, and retains macro values and copy/name
addresses without reading sources or replaying registration.

The source-byte tests cover BOM, invalid/dual-valid bytes, CP932-pair lexing,
mixed-codec includes, group holes, once-only expansion and pending fresh World
restoration through the default coordinator with EXE construction disabled.
Two public browser cases verify real StageRenderer text pixels and exact fresh
frame restoration. An ignored decode-only audit additionally checks38 real
source bodies against independent zlib extraction, including nonASCII tokens
from UTF8-only, CP932-only and dual-valid resources. This does not claim a full
game run or arbitrary native buffer-overflow equivalence.

Explicit pointer-consumer fixtures live under `oracle/`; their native command
adapter accepts exact executing bytes. Its direct authored string adapter is
separate evidence and cannot justify encoding a normal source by target type.

Other whole-command gates and aggregation, input queues, tone tables and
remaining official-object work are separate phase-7 requirements. This source
closure does not credit those contracts or the unfinished EFK subsystem.
