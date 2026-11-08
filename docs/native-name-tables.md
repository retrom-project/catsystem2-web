# Name tables and filename rules

[The name-table adapter](../src/native/nametable.mjs) executes all eight original
main wrappers `0x279..280`. A typed `nametable` handle identifies one original
four-byte owner. Its record vector, strings and alias lists live in the shared
engine process. The former JavaScript row model has been removed; restoring a
World restores original pointers and memory, without reopening its source file.

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

The original TSV parser controls quoting, line breaks, accepted numeric rows,
field widths and byte encodings. Primary names and rule fields retain their
original bytes. The game engine also reads aliases from the fifth column onward;
SDK 2.6.1.74 searches primary names only. Duplicate game aliases return the first
matching row. These differences must not be flattened into one common alias map.
An existing nonempty header-only file produces a valid table with no rows;
missing and zero-length files return zero.

`27F` first copies the input into its 256-byte local buffer and inserts a NUL at
the pattern's byte length. Its original comparator then separately compares the
stem and extension, case sensitively, with `?` and early-return `*` rules. It is
not a general operating-system wildcard search. `280` executes the original
`%f`, `%n`, `%s`, `%c` and `%r` substitution helper, unknown-percent handling and
comma-tail scan. That helper includes signed-byte and position-dependent behavior;
ordinary string formatting is not an equivalent replacement.

Null tables retain each wrapper's own early return. Query misses preserve caller
buffers where the original does. VM address zero remains valid. Missing argument
words, including release handles, are read from the adjacent mapped GCALL area.
Invalid pointers, invalid match/replacement row indexes and local-buffer overflow
remain original undefined/error boundaries; they do not become fabricated misses.

`scripts/verify-native-name-tables.mjs` executes **1,307 complete wrappers and
7,842 comparisons per profile**, **15,684 comparisons total**. It compares the
full VM memory, shared and extension regions, control/result words and every live
original allocation. Authored inputs cover quotes, line breaks, duplicate aliases,
empty/missing/header-only files, CP932, raw UTF-8 and invalid byte sequences,
match/replacement directives, source/output aliasing, four destination domains,
query misses and adjacent GCALL arguments. No parser, matcher or substitution
helper is replaced. Mounted-file and ordinary CRT/OS services are the explicit
host boundaries.

Four optional original-engine tests check parser/query behavior, profile alias
differences, filename substitution, resource release and independent fresh-process
restoration. A full SDK World test checks runtime registration, live VM bytes,
output canaries and restored table lifetime. These tests do not establish final
text-rendering pixels.
