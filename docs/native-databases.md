# Compiled database resources and flags

The seven operations own compiled KCDB records and flag state in JS. Resources
use the existing `database` category. The implementation lives in
[database.mjs](../src/native/database.mjs), using the shared JS compiled-table parser.

| ID  | Arguments including owner | Control | Behavior                                                              |
| --- | ------------------------: | ------: | --------------------------------------------------------------------- |
| 365 |                         4 |       1 | Load formatted filename and three formatted options; return an owner  |
| 366 |                         1 |       2 | Release owner, records, index map and strings                         |
| 367 |                         3 |       2 | Set bit on the record selected by a formatted index name              |
| 368 |                         2 |       1 | Return flag-export byte count; optionally write to a raw data pointer |
| 369 |                         2 |       1 | Import flags from a raw data pointer                                  |
| 36D |                         1 |       1 | Return owner modification word                                        |
| 36E |                         1 |       2 | Clear only the owner modification word                                |

KCDB contains a zlib-compressed schema and fixed-width rows. Index fields retain
raw bytes and the recovered kana normalization. A duplicate index keeps the first
record. Setting a new bit updates current/new masks and the first-use word, then
marks the owner modified. Bit indexes wrap modulo 32. Clearing the modification
word preserves flags. Repeating an existing bit leaves a clean owner unchanged.

Export writes a count DWORD followed by byte-sorted 268-byte records, each with
a 256-byte NUL-terminated name and three flag words. A null destination returns
the size. Import normalizes input names in place, ignores unknown names and lets
later duplicates win. It preserves the owner's modification word. During the
raw-data pipeline, export/import use the canonical JS raw-memory store.
The records, flags and data bytes are snapshotted together. Raw pointers are independent
of KCS VM addresses. A null owner preserves the original result sentinel for
`368/369`. Empty, missing and invalid resources leave a valid empty owner.

Both ABI differential sequences cover all seven operations, flag transitions,
raw import/export canaries, normalization, duplicates and nulls. World tests
exercise CSS/raw heap roundtrips and independent restored mutation. The old
wrapper and detailed verifier are preserved under `oracle/database.mjs`.

Run `node --test tests/native-database.test.mjs` and, with private images,
`node --test tests/differential/native-database.test.mjs`.
