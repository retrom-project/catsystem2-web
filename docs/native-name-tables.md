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

## Fixed SDK 4.01 name pairs

Main289 through 293 own a zeroed allocation with 40-byte rows. Each row holds
a 32-byte CP932 C string and two unsigned DWORDs. The length uses the low
DWORD of the product of the three counts and the row size. Main290 releases
the caller's opaque handle. Main291 appends at the first row whose first byte
is zero. An empty name leaves that row available for the next append.

Main292 scans in insertion order and compares bytes with ASCII case folding.
A folded byte can be the trailing byte of a CP932 character. The native
test compares both spellings and verifies the first matching row. Main293
matches the two words exactly and copies the first matching name and its NUL.
The two lookups return a written Boolean with control 1 for a present
array. A miss leaves the guest outputs alone. A null handle returns
control 2 without a result. The browser guards lookups that would cross the
allocated rows and formatted names that would overrun the 32-byte field.
Original physical allocation and byte probes and ordinary World GCALLs
cover the author-visible behavior and cold handle ownership.
