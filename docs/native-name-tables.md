# Name tables and filename rules

The JS model owns raw-byte rows, rule fields and aliases. Typed `nametable`
handles and parsed data are included in World snapshots, independently of
source resources. The ABI capability `nameTableAliases` enables game aliases.
The implementation lives in [nametable.mjs](../src/native/nametable.mjs).

| ID  | Operation                                     | Arguments                                    | Control               |
| --- | --------------------------------------------- | -------------------------------------------- | --------------------- |
| 279 | Load formatted FES-category TSV resource      | filename                                     | 1, handle or zero     |
| 27A | Destroy the table and its nested records      | table                                        | 2                     |
| 27B | Find primary name or supported alias          | table, formatted name                        | 1, signed index or −1 |
| 27C | Query numeric row ID                          | table, signed row                            | 1, ID or −1           |
| 27D | Copy primary name                             | table, signed row, VM destination            | 1, success            |
| 27E | Copy filename pattern or replacement template | table, signed row, field, VM destination     | 1, success            |
| 27F | Match a filename prefix against a row pattern | table, signed row, VM source                 | 1, match              |
| 280 | Apply the row's filename replacement template | table, signed row, VM source, VM destination | 1                     |

The byte parser retains TSV quoting, numeric IDs, CP932 and invalid bytes.
Game aliases start at column five and return the first matching row. SDK searches
primary names. Empty/missing files return zero. A nonempty header-only file owns
an empty table. Filename matching truncates to the pattern length, splits stem
and extension, and preserves case-sensitive `?` and early-return `*` behavior.
Replacement retains `%f/%n/%s/%c/%r`, unknown-percent handling, live source/output
aliasing and the signed-byte comma scan recovered from the original helper.
Nulls and misses preserve each operation's early return and output canaries.

Both ABI operation sequences compare the JS registration against the actual EXE
table, with later queries and complete VM observations. Pure World tests cover
fresh restore and independent release. The detailed older verifier remains an
oracle-only tool using `oracle/nametable.mjs`.

Run `node --test tests/native-nametable.test.mjs` and, with private images,
`node --test tests/differential/native-data-tables.test.mjs`.
