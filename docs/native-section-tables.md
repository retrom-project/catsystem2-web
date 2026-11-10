# Section/key text tables

Main `2AB/2AC/2AD` own a JS section map and source-order byte records.
Handles and parsed data are included in World snapshots. The implementation
lives in [section-table.mjs](../src/native/section-table.mjs).

| ID  | Arguments                                                               | Control and result                     |
| --- | ----------------------------------------------------------------------- | -------------------------------------- |
| 2AB | Formatted filename                                                      | 1, new table handle or zero            |
| 2AC | Table handle                                                            | 2, release table and all owned records |
| 2AD | Table, formatted section, formatted key, signed ordinal, VM destination | 1, copied-value boolean                |

Sections include their leading `#`. Section/key comparisons preserve case and
raw bytes. Repeated sections append, repeated keys retain source order, and signed
ordinals select an occurrence. Line processing removes C-style and line comments,
replaces tabs, collapses spaces and trims the line before splitting key/value.
The existing JS resource layer reads files. Missing files return zero, while
empty files own valid empty tables. Missing rows or unmapped destinations preserve
caller bytes. VM address zero is mapped. Snapshots retain imported bytes after
source changes and restore independent release ownership.

Both ABI differential sequences compare the normal JS dispatcher with actual
native-table execution, covering all three operations, repeats, comments, output
aliases, nulls and empty/missing files. `oracle/section-table.mjs` preserves the
older wrapper and detailed verification tool.

Run `node --test tests/native-section-table.test.mjs` and, with private images,
`node --test tests/differential/native-data-tables.test.mjs`.
