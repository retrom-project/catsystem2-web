# Compiled content database objects

All four families own their state in JS. The shared `content-database` handle
retains its family and model, including independent World snapshot restoration.
The installers are composed in [content-databases.mjs](../src/native/content-databases.mjs).

| Family                 | IDs                | State                                                        |
| ---------------------- | ------------------ | ------------------------------------------------------------ |
| Question/configuration | 2E6..30A           | Grouped questions, options, pools, member flags and counters |
| Name selection         | 30B..310, 33D..340 | Registration, nineteen-column tables and consumed work lists |
| General KCDB           | 317..31A           | Raw schema and fixed-width fields                            |
| Mission/conditions     | 31B..33C           | Progress, conditions, selection and twenty character records |

These expose 85 table entries per ABI, including the two empty original
`301/302` operations. In the four builds after `.23`, those wrappers still read
and resolve their optional owner before calling an empty member and returning
control 2. The fixed `.23` uses an operand-ignoring wrapper stub instead. These
two entries are original stub behavior, separate from 83 effective operations.
The independent `365..` index/flag model is described in
[native-databases.md](native-databases.md).

## Resources and observable state

Resources use the existing JS `database` category. KCDB contains a compressed
schema and fixed-width rows. Raw text bytes retain their encodings. The general
reader zero-initializes numeric fields up to four bytes and returns zero for
wider fields. Byte reads copy the declared width and return it. Decompression
uses the file's declared unsigned size as its output bound and requires an exact
match. There is no separate 256 MiB KCDB limit. The decoder first validates the
compressed source span and reserves exactly the declared output length. Output
storage exhaustion remains diagnostic: all five own originals fault when that
output allocation returns NULL. The local streaming decoder writes chunks into
that fixed buffer without collecting and concatenating a second output copy.
Corrupt input, output overflow, short output and inflater-internal allocation
failure return a load failure, matching the original zlib failure branch. Partial
output never publishes a table. These resource stages also flow through Question,
Mission and Selection GCALLs; failed loads can retry and successful state retains
its ordinary cold ownership. Controlled small failures prove these branches;
large valid-file and whole-OS exhaustion behavior is not claimed.

Selection tables retain the first registered name and the first duplicate table
ID. Selecting a table copies its nineteen values into the mutable work list.
The fixed `.74/.76` builds append missing slots' indexes without advancing
either MT stream. The fixed `.23/.63/.67` builds shuffle missing slots at indexes
two and above with 1,000 pairs of shared integer RNG draws, marks the source
and relocates its value into the first shuffled hole. With no hole, 33F
marks the source while 340 preserves it; the same distinction applies to
negative source values. 30F reports the table-ID count. Moves retain their
high-bit markers.
The implementation lives in [selection-table.mjs](../src/native/selection-table.mjs).

Question keys use CP932-aware uppercase basenames. The tree preserves reverse
insertion traversal. Configuration loading and active-pool rebuilding remain
separate operations. Byte-space tokens include literal quote bytes. Genre lists,
member/partner sets, counters, output padding and null behavior follow the
recovered operations. Configuration ranges retain their endpoints and match
only the occupied question keys; overlapping ranges preserve numeric key order
without materializing absent genres. The fixed .23 first-group placeholder
continues through following literals. `307` reports a nonempty partner set, while `308` returns
the selected question ID and copies its database key. Record sorting preserves
observable ties through the recovered insertion, partition and heap algorithms.
Selection consumes the canonical integer MT stream. The implementation lives in
[question-table.mjs](../src/native/question-table.mjs).

Mission availability retains signed level limits, dependencies, type gates and
condition codes 0, 1, 2, 3, 10, 11, 20, 21, 30, 40 and 41. Character statistics
have six words each. Completion, availability, selection, elapsed updates and
resets remain separate operations. Selection retains place/priority conflicts
in signed table-ID order. The recovered fourth question-table field overlaps
the PT word array, including its query result. The implementation lives in
[mission-table.mjs](../src/native/mission-table.mjs).

Mission 334 selector 9 requires a nonempty character set in the fixed .23
build: its checked native iterator rejects an empty set, and JS protects that
boundary. The separately reviewed modern builds read an uninitialized sentinel
payload in this case and continue; JS writes zero for that unspecified word.
Private observations remain scoped to each executable fingerprint.

## Raw data, CSS and snapshots

Raw heap `341..344`, database flags, question/mission progress and dictionary
export/import share the canonical JS raw-memory store. Snapshots save that store
once. The separate PE image/font projections are registered for later consumer
migration. The raw implementation lives in [heap-data.mjs](../src/native/heap-data.mjs).

Question export has a 12-byte header and 88-byte records. Each record has a
64-byte file key, question ID and five progress words. Export preserves caller
bytes after the key's NUL. Mission export has a 36-byte header, 24-byte progress
records, twenty indexed 28-byte character records and a final total word.
Imports preserve existing resource models and update their progress. A failed
raw CSS output releases its allocation before propagating the write error.

All five fixed builds return zero from `341` and `344` when their native raw
allocation fails; `344` leaves the caller's output length unchanged. The JS
allocator maps only its validated allocation-failure type to that result. Invalid
sizes, invalid addresses and unrelated errors remain diagnostic. Small bounded
exhaustion tests cover retry, release and cold ownership without large buffers.
Explicitly written zero-byte CSS records have a nonzero owned output. Unwritten
record zero is separately protected for the three legacy builds; its modern
behavior remains unproved.

Pure JS World tests export through `341/343/F5`, open the CSS in a fresh World
through `F7/344`, and import both progress formats. They reject EXE loading.
The existing private World cases continue to cover mixed-runtime integration.

## Differential evidence

The modern database evidence pairs 535 own-build wrapper calls per executable
with production KCS GCALL execution, including all 85 database entries. The
authored GCALL caller frame is excluded from comparison with the direct native
wrapper bridge. Complete data/shared/block bytes, raw ranges, owners and both MT
states remain compared. The older 2,117-call original facade audit is retained as
original-engine evidence; it is separate from this JS comparison. Cold tests
cover Question, Mission, Selection and KCDB owners, CSS progress and independent
resources. The three actual modern works declare absent `qdb.int`/`qdb` resource
roots, so these database inputs are authored legal fixtures.

Both ABI sequence tests execute normal JS dispatch and the actual EXE native
table independently. They compare control, result, VM writes and canaries, raw
serialization and later queries. Question sequences also compare both complete
MT states, including a 45-row ordering case. Mission sequences cover every
condition code, selection, completion, statistics, aliases and both progress
imports. Raw heap/CSS/dictionary sequences compare data across distinct address
spaces using symbolic pointer normalization.

The full original facade remains in `oracle/content-databases.mjs`. The older
`verify-native-content-databases.mjs` preserves its detailed original-wrapper
measurements. Authored resources contain no game database assets.

Run `node --test tests/native-content-tables-js.test.mjs` for pure JS lifecycle
and CSS coverage. With private images, run
`node --test tests/differential/native-{content-tables,question-table,mission-table,raw-data}.test.mjs`.

## Authored legacy Question consumers

The exact `.63/.67` builds now have a normal nonempty resource bridge through
original CRT/Settings/FileServer category mounts and an actual factory-created,
file-loaded Script. Each final program executes 25 GCALLs, including an integer
expression and branch driven by the question result. The 12/88-byte progress
writer is consumed by a second independent owner before normal release. Four
current GameFiles/Script controls compare the defined VM outputs and preserve
those owners through independent cold restoration with an empty resource archive.
This supplements the older modern database evidence; it does not upgrade its
historical host qualification or declare all Question inputs proved. The legacy
Question allocation is 740 bytes versus 620 in the modern builds, so this bridge
compares typed results and written string spans, not a shared physical heap layout.
Run `node --test tests/native-authored-question-consumers.test.mjs` for this group.

The matching Mission/Selection/compiled group uses 50 loaded Script calls in
`.63` and a smaller 31-call `.67` context bridge. Mission progress is written
into owned raw bytes and imported by a distinct resource owner. Selected row
metadata and compiled fields feed a Script expression and branch. The single
missing Selection slot exercises the existing legacy redistribution rule and
exactly 2,000 actual integer draws; the complete resulting MT state is paired.
Modern controls retain their separately established append-without-RNG rule.
Two successive current cold restores per profile preserve remaining owners after
source removal, independent mutation and normal releases. This does not qualify
all condition codes, arbitrary files or unspecified raw export padding.
Run `node --test tests/native-authored-mission-selection-consumers.test.mjs`.
