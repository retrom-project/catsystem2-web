# Native string processing

KCS strings and formatter output are byte sequences. They are not implicitly
CP932 text: the game profile also passes UTF-8 through these buffers. Text
consumers select their encoding. `NativeRuntime.services.formatBytes` keeps
original bytes; a caller supplying only a custom text formatter explicitly
uses the existing CP932 text-service contract.

`formatNativeAt` resolves global, local and shared references, recursive
strings, integer and floating fields, flags, width and precision. String
precision counts bytes and may end inside an encoded character. The pinned
CRTs preserve zero for `%#.0o` and consume `%F` without an output field.
Unsupported CRT conversions and nonfinite or very large float spellings are
diagnosed; they remain gaps, not successfully formatted values.

Both text and byte formatters accumulate each decimal selector digit as a
wrapping unsigned 32-bit word; an empty index selects zero. Global selectors
use that word, local selectors add the current frame base, and shared selectors
set its high bit. Long decimal indices therefore select the same VM bytes
without losing precision through a whole-number JavaScript conversion.

The existing `scripts/verify-native-format.mjs` report records **7,628
comparisons per profile** through the complete original formatter, pointer
translator and CRT. Its finite cases compare every output and canary byte for
numeric fields, recursive strings, the three address domains, UTF-8, CP932 and
invalid bytes. This selector correction adds public JS regressions; it does not
rerun that native matrix, establish unrestricted CRT behavior, or admit native450.

The SDK63 scalar group now admits Main18/20/22/26/37/39/40/48 after
32 calls through its own unchanged executable and real CRT, resource owner,
Script and parsed VM. The same normal cases run independently in SDK67.
`native-legacy-cp932-runtime` checks exact result/control words, every guest
write and eight fresh World continuations per build. Inputs include short
CP932 formatted text, finite decimal and D-exponent prefixes, signed grouping,
two-byte token termination and character classification. This does not establish
large scratch output, nonfinite parsing or overlapping destinations. These
functions own no Task or renderer and introduce no task-message or file layout.

## Basic string operations

Both pinned engines implement main `0D..18`: raw and formatted copy,
append, byte length and comparison, and CP932 byte/character truncation.
Copy and append write two NUL bytes and return a VM address. Raw append copies
the terminating byte in the same forward DWORD and byte sequence as the
original, then finds the new end. When the source and destination overlap,
later reads can see bytes just written. An overlapping raw copy that overwrites
its unread terminator has no defined completed result and receives a diagnostic.

Raw comparisons reverse the arguments. Formatted comparisons use the given
order and two scratch strings 1,024 bytes apart; the second can replace the
first's suffix. Case-sensitive results subtract signed bytes; the original
case-insensitive path folds ASCII letters and subtracts unsigned bytes.
`verify-native-basic-strings.mjs` compares both complete original wrappers,
formatter and translator against the VM primitives. It checks return words and
all data, stack, shared and extension bytes, including valid overlapping
destinations, raw CP932 boundaries and recursive formatted references.

Main `19` accepts an optional sign followed by a wrapping decimal or
hexadecimal prefix; a decimal point after the digits rejects that integer.
`1A` uses the original CRT decimal syntax with ASCII whitespace and either
`E` or `D` exponents. Text spellings of infinity do not parse; overflow of a
valid decimal can still return an infinite float. `2E` applies its unsigned
base only to a mapped string ending in `%` with a valid integer prefix. It
rounds the multiply and divide to binary32, then uses the original signed
truncation. It writes one NUL and leaves later bytes in place.

The combined runner compares **4,332 results and memory regions over 1,083
calls per profile**. Numeric cases include malformed prefixes, formatted
operands, rounding, unsigned bases, and mapped-zero and unmapped addresses.

## Startup SCRIPT replacement

Main `0x3EA(destination, formattedSource)` copies a formatted source, then
applies the engine's `SCRIPT/replace` map in ascending unsigned byte-key
order. Numbered startup entries are contiguous `r00`, `r01`, and so on; both
`find` and `rep` must exist. The first duplicate key wins. Empty replacement
values are valid. Replacement output is not recursively searched in that
same pass, but later keys see the prior pass's output.

The XML loader preserves UTF-8 bytes in game 2.6.1.76 and CP932 bytes in SDK
2.6.1.74. Immutable rules come from startup input when a fresh World is
constructed. They are independent of mutable user preferences.

Each pass writes a two-byte NUL after its replacement prefix, then appends
the remaining source with one terminating NUL. Consequently bytes after the
final terminator depend on prior contents. The implementation preserves this
behavior, including overlapping source/destination and an empty map's plain
copy. An empty find string with nonempty source does not terminate in the
original engine and receives an explicit diagnostic.

`verify-native-script-replacement.mjs` runs the complete original main wrapper
and helper: **594 comparisons per profile**. Formatter and VM translation
are declared boundaries. `verify-native-script-replacement-startup.mjs`
independently executes the original XML parser/import and complete insertion
loop: **33 comparisons per profile**, including duplicate fields, gaps,
missing/empty values, whitespace/entities and 105 contiguous entries. Public
tests exercise byte encodings, insertion order, duplicate keys and canaries.

## Plain-text extraction

Main `0x188(destination, formattedSource)` constructs the original rich-text
parser in its default state, sets and parses the source, extracts visible
character bytes and destroys the temporary parser. It returns output byte
length; an unmapped destination returns zero. VM address zero is valid.
Control records, ruby metadata and escape handling are decided by the same
original parser used by text rendering, rather than a separate regular
expression replacement. Game-only `0x419` uses the corresponding UTF-8
parser and extraction path, with the same destination and result contract.

`verify-native-text-plain.mjs` compares the complete original wrapper with
the shared-process adapter: **208 SDK comparisons and 416 game comparisons**,
including both game parsers. It covers
CP932, UTF-8 and invalid bytes, controls/escape/ruby spellings, aliases,
mapped-zero/unmapped output, long/empty text and every output/canary byte.
Windows text measurement is a declared browser platform boundary; this
test establishes string output, not Windows font pixel identity. Optional
public tests also restore a fresh process and exercise temporary lifetimes.

## Game UTF-8 primitives

The game adds `0x415` (truncate at a byte boundary strictly below the supplied
limit), `0x416` (truncate after the supplied character count), and `0x41B`
(find a CP932 key in a UTF-8 byte string). Both truncators write two NUL bytes
and return their byte offset. Search converts the key to UTF-8, visits original
character boundaries, and returns byte length when absent. Keys longer than
4,000 bytes take the original empty-key conversion branch.

These three handlers dispatch by the operations present in the ABI and execute
synchronously in JavaScript, without an EXE or transitional capability. The byte
walker counts lead bits, leaves the final continuation unchecked, and preserves
its negative steps for malformed inputs when the resulting VM access is mapped.
Search stops at nonpositive steps. No modern Unicode validity rule substitutes
for these legacy byte operations. A two-byte NUL write and unsigned byte-limit
comparison remain exact.

CP932 conversion uses the fixed Microsoft table and existing measured Windows
mapping exceptions in [`cp932.mjs`](../src/native/cp932.mjs); see
[table provenance](../third_party/cp932/README.md). It does not depend on browser
Shift_JIS decoding. Already migrated generic string APIs remain unchanged.

`tests/fixtures/utf8-cases.mjs` has authored independent GCALL comparisons including
malformed bytes, supplementary text, CP932 extensions, missing/empty keys and the
4,000-byte branch. Every VM byte and result compares exactly. Original handlers
and NLS boundaries run privately; public golden cases run without an EXE. Original
facades and extensive CPU-only verifier evidence remain under `oracle/utf8.mjs`
and `scripts/verify-native-utf8.mjs`. Out-of-mapping accesses and original undefined
conversion-buffer overflows are not defined text acceptance cases.

Private binaries, native memory and raw reports remain in ignored storage.

## Owned name pairs

SDK63 Main289–293 use the shared name-pair owner after 26 normal GCALLs in
each exact SDK63/67 executable. Its real reference heap allocates zeroed
40-byte rows: a 32-byte terminated name and two raw words. Short CP932 format
expansion precedes insertion; ASCII byte folding returns the first name match,
and the first matching word pair returns its original name. Misses leave output
bytes untouched. Duplicate rows, a separate owner and actual normal releases
are checked through parsed Script VMs, then seven independent current World
continuations per build. The internal owner codec preserves the row bytes;
no Task message or native GAME_SAVE format changes. Longer names, full tables,
allocation overflow and capacity extremes remain protected or unverified.

## Formatted ordered dictionaries

SDK63 Main677–680 share the existing Main675/676 dictionary owner after an
independent own-build group: 19 target calls and seven dependency/bootstrap
calls, repeated in SDK67's own executable. Keys retain CP932 byte identity and
byte ordering; insertion replaces a raw DWORD, removal uses the formatted key,
and lookup preserves a caller fallback. The first matching value returns its
byte-ordered key, including the NUL; a miss preserves the output span. Two live
owners and their actual CRT destruction are separate from RefBuffer release.
The original full text remains unchanged. Real KCS callers and six fresh World
continuations per build cover these results without altering native GAME_SAVE.
Large scratch keys, foreign owners and resource extremes remain unverified.
The retained first-attempt release-observer failure does not qualify lifecycle.

SDK63's Main40 and formatted Main48 use the same broad byte-pair classifier as
its raw character count: lead bytes 81–FE and trail bytes 40–FE. SDK67 keeps its
standard range. The complete own classifier bodies establish this difference;
four separately labeled live Script VM results, each repeated after independent
cold restoration, use valid CP932 F040 without claiming
a native dynamic capture of that private-use character. An additional eight
normal original calls per build cover IBM duplicate characters (encoded EE/ED),
minimum signed integer grouping and both separator escapes. S1 totals remain
40 target calls per build; no other build's character policy changes.

SDK23's fixed `9f3a5ad0…` bridge also runs the real loaded Script/Main wrappers
through the qualified CRT, FileServer and controller Root. The G1 fixture in
`sdk23-string-data.test.mjs` compares raw/formatted copy and append, byte/character
length and truncation, both comparison orders, finite float formatting, token
limits, CP932 boundary search, defined self-append, and later consumers of the
written bytes. It checks complete destination spans, both NUL bytes and canaries,
then resumes an independently serialized World at each intermediate phase.
This supplements the existing broader formatter vectors with the actual SDK23
VM/caller context; it does not qualify arbitrary printf conversions or locale
behavior. All 24 target calls matched without a production change.
