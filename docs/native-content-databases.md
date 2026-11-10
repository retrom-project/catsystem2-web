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

These expose 85 operations per ABI. The independent `365..` index/flag model
is described in [native-databases.md](native-databases.md).

## Resources and observable state

Resources use the existing JS `database` category. KCDB contains a compressed
schema and fixed-width rows. Raw text bytes retain their encodings. The general
reader zero-initializes numeric fields up to four bytes and returns zero for
wider fields. Byte reads copy the declared width and return it.

Selection tables retain the first registered name and the first duplicate table
ID. Selecting a table copies its nineteen values into the mutable work list.
The recovered missing-slot helper appends those slots' indexes. `30F` reports
the table-ID count. Moves and consumption preserve their high-bit markers.
The implementation lives in [selection-table.mjs](../src/native/selection-table.mjs).

Question keys use CP932-aware uppercase basenames. The tree preserves reverse
insertion traversal. Configuration loading and active-pool rebuilding remain
separate operations. Byte-space tokens include literal quote bytes. Genre lists,
member/partner sets, counters, output padding and null behavior follow the
recovered operations. `307` reports a nonempty partner set, while `308` returns
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

Mission `334` selector 9 requires a nonempty character set. The original empty
set path reads an uninitialized tree-sentinel word. Private oracle observations
are retained locally. JS raises an explicit error at this undefined boundary.

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

Pure JS World tests export through `341/343/F5`, open the CSS in a fresh World
through `F7/344`, and import both progress formats. They reject EXE loading.
The existing private World cases continue to cover mixed-runtime integration.

## Differential evidence

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
