# SDK standard-slot review and random streams

The approved plan originally listed 28 unnamed SDK domain-3 slots. Phase 2 had
already named the two interpolation/rounding entries; this review starts with 26.
The frozen SDK contains FES/PTCL headers and compiled KCS examples, but no header
for these main-table declarations. FES/PTCL IDs are separate ABIs and are not used
to infer main IDs. The names below are descriptive recovered semantics, rather
than claims about an unavailable original declaration spelling.

Each table target and parameter/control body was inspected in the SDK executable
with the reviewed SHA-256. Simple entries were also exercised through authored
normal GCALLs; the game table was not used as evidence for SDK identity. The ABI
contains the names/signatures; these EXE targets remain documentation/test evidence.

| SDK ID | Semantic                             | Words | Control | Original handler | Validation                              |
| ------ | ------------------------------------ | ----- | ------- | ---------------- | --------------------------------------- |
| `1`    | `debug.print`                        | 1     | 2       | `51C010`         | original window sink and KCS World      |
| `6`    | `word.identity`                      | 1     | 1       | `51B320`         | independent GCALL                       |
| `9`    | `application.exit`                   | 1     | 2       | `51B570`         | original window callback and KCS World  |
| `A`    | `clipboard.copy`                     | 1     | 2       | `51B360`         | original CF_TEXT and KCS browser host   |
| `B`    | `clock.localDate`                    | 7     | 2       | `51B9E0`         | original time fields and VM alias order |
| `1B`   | `memory.allocate`                    | 1     | 1       | `5232D0`         | original heap and VM address mapping    |
| `1C`   | `memory.free`                        | 1     | 1       | `5230A0`         | original heap and VM compaction         |
| `1E`   | `file.read`                          | 4     | 1       | `523050`         | body confirmed; normal fixture pending  |
| `1F`   | `file.write`                         | 4     | 1       | `5230C0`         | body confirmed; normal fixture pending  |
| `21`   | `random.integer`                     | 0     | 1       | `523360`         | independent GCALL                       |
| `22`   | `random.float`                       | 0     | 1       | `523030`         | independent GCALL                       |
| `23`   | `memory.copy`                        | 3     | 2       | `5232F0`         | independent GCALL                       |
| `24`   | `memory.fill`                        | 3     | 2       | `523330`         | independent GCALL                       |
| `25`   | `number.formatThousands`             | 3     | 2       | `5231A0`         | independent GCALL                       |
| `26`   | `string.copyUntilSeparator`          | 4     | 1       | `5233E0`         | independent GCALL                       |
| `27`   | `string.copyFormattedUntilSeparator` | 4     | 1       | `5234C0`         | independent GCALL                       |
| `28`   | `string.isDoubleByte`                | 1     | 1       | `522CB0`         | independent GCALL                       |
| `29`   | `list.split`                         | 3     | 2       | `523600`         | independent GCALL                       |
| `2A`   | `list.select`                        | 3     | 1       | `523110`         | independent GCALL                       |
| `2B`   | `list.splitGroups`                   | 3     | 2       | `5235B0`         | independent GCALL                       |
| `2C`   | `list.join`                          | 4     | 2       | `522EA0`         | independent GCALL                       |
| `2D`   | `string.replace`                     | 4     | 2       | `523380`         | independent GCALL                       |
| `2F`   | `string.characterLength`             | 1     | 1       | `522E00`         | independent GCALL                       |
| `30`   | `string.formattedCharacterLength`    | 1     | 1       | `522E50`         | independent GCALL                       |
| `31`   | `string.findAtCharacterBoundary`     | 2     | 1       | `523B40`         | independent GCALL                       |
| `41`   | `task.yield`                         | 0     | 4       | `51BED0`         | independent GCALL                       |

`memory.copy/fill` retain VM pointer translation and byte width, number formatting
uses signed integers, and CP932 helpers preserve byte boundaries. Split/select/join,
group parsing, replacement and yield controls were compared exactly. The SDK
formatter's exact authored output plus its one NUL byte is checked separately;
only that byte span is private scratch, and raw PE write evidence is retained.
All remaining PE bytes, VM regions, result-write behavior, handles and task state
compare exactly. Public golden cases run without a private executable.

Main1 formats a CP932 guest string and sends the result to an enabled and
attached native debug receiver as message 0x401. The second formatter has a
500-byte output limit. An isolated formatted percent and a terminal run keep
the original literal output. The browser sends that byte-bounded text to its
existing diagnostics. A CRT conversion with no guest variadic operands stays
literal there. The GCALL uses control 2 without writing the result.

The remaining file read and write signatures have independent receiver review
scope.

On the fixed SDK build, Main9 posts WM_CLOSE for a nonzero selector and 0x433
for zero. Its application callback uses the language table to translate the
embedded default caption and template. Accepting the dialog or posting 0x433
deactivates the display and posts 0x410. That message sends original filtered
Script event 160 before the close sequence. Main10 formats one CP932 argument,
converts each literal backslash-n byte pair to CRLF, and writes CF_TEXT. The
browser adapter projects those formatted bytes to text under the platform's
clipboard rules. Both calls return control 2 with the result left unwritten.

Main11 writes the seven 16-bit OS clock fields as unsigned words in the
original order, which determines the final value if output pointers alias.
Main27 appends a zeroed block to the original memory list. An empty block
returns the all-ones sentinel. Main28 only releases an exact mapped block
start. The remaining blocks retain their bytes and their virtual addresses
compact to follow the live preceding regions. Original Main140, 142 and 549
share one operand-free body that returns control 1 without writing a result.
Their VM calls retain the normal initial result sentinel at every tested width.

## Independent MT19937 checks

The JS implementation in [`random.mjs`](../src/ppi/random.mjs) remains unchanged.
It uses the original 69069 initializer with two updates per state word, not the
later 1812433253 initializer. Integer and real calls consume separate streams.

`random-cases.mjs` drives main `21/22` and generic `27/28` in both ABIs. JS starts
with its own seeded ParticleRandom. The oracle executes the original seed functions
in its own PE RAM; no NativeRandomMemory binding joins the two sides. Every result
word, all 624 state words plus the index in each stream, VM writes, controls,
handles and task state compare exactly. Normal seeds 0, 4357 and FFFFFFFF,
independent stream seeds, last-word/twist and unseeded-sentinel checkpoints are
covered with bounded sequences. Endpoint fixtures author a raw MT input word
whose tempering yields zero or FFFFFFFF, then execute the complete native wrapper.
Float conversion is f32(uint32 / 4294967295), with inclusive 0 and 1 endpoints;
there is no ULP tolerance. The regular corpus has 56 inputs and 144 GCALLs.

The process-backed `random-memory.mjs` binding remains an explicit phase-10
exception because unmigrated EXE code still consumes those streams. Its original
shared-state tests remain useful oracle evidence, separate from these independently
seeded comparisons and their public exact golden fixtures.

The fixed 2.6.1.74 SDK also gives FES `rand` and `randtbl` the integer stream
used by Main33. `rand` reads three operands in order and writes the lower
bound plus one unsigned remainder. `randtbl` reads four operands in order,
initializes the destination range starting with the third operand, and makes
1,001 pairs of draws to swap bank entries. The fourth operand is evaluated
once. The commands leave the real stream untouched. The original bank ignores
out-of-range writes, returns zero for out-of-range reads, and marks attempted
writes dirty. Missing operands avoid writes and random draws. The project keeps
the integer division trap and signed table initialization overflow outside of
the supported range.

The independent native probe ran both original FES common handlers and the
following Main33 on five distinct seeds. It compared the next result and
integer stream state with ordinary Core MT. The production regression uses FES
and KCS together and asserts their target writes and the next native draw.
See [the fixed-build VM tests](../tests/native-engine74-abi.test.mjs).
