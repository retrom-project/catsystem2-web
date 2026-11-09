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

`scripts/verify-native-format.mjs` executes the complete original formatter,
pointer translator and actual CRT `sprintf`, with **7,628 comparisons per
profile**. It compares every output and canary byte for numeric fields,
recursive strings, the three address domains, UTF-8, CP932 and invalid bytes.

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
