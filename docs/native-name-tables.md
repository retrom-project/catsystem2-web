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

## SDK23 loaded resource consumer bridge

For fixed SDK23 `9f3a5ad0…`, `sdk23-name-resources.test.mjs` N1 uses the
qualified CRT/FileServer/controller Root and a normal Settings FES category.
Two real Main633 owners parse a finite two-row CP932 table. Primary-name, numeric,
field and filename-rule outputs feed later GCALL arguments; the substituted
filename loads an actual Scene whose two text blocks are consumed after the first
table and then both tables are destroyed. Source/query strings are overwritten
without changing the parsed owner. SDK23 does not enable fifth-column aliases;
its normal alias miss is distinct from canonical-name success.

The original constructor frees its temporary resource buffer after building its
owned 100-byte rows (numeric ID and three 32-byte fields). The bridge checks the
complete VM outputs and canaries through normal release, plus five independent
serialized World continuations. It qualifies the authored finite table and
replacement forms; it does not add arbitrary parser, locale or format support.
All 18 target calls matched without a production or ABI change.

N2 adds the matching normal SDK23 allocator/loaded-VM context bridge for
Main289–293. Two real three-row allocations receive copied filenames and word
pairs with a spare empty row. A folded-name lookup and reverse lookup select an
actual Scene file and block; source strings are overwritten, the first pair
owner is released, and the second selects a different Scene. Both pair owners
then retire before the independently parsed Scene is consumed again. Complete
live allocation bytes and VM destination/canary spans match the original,
including five independent current cold continuations.

The existing broader legacy-name-pairs evidence retains its scoped heap/CRT
qualification. Its out-of-allocation witnesses are not repeated or promoted by
this normal bridge. Main290 uses the typed name-pairs owner; the separate
833/834 raw-allocation domain keeps its existing ownership guards. The new
11-target/32-GCALL sequence requires no production, layout or ABI change.

## Modern loaded resource consumers

Exact `0e1dde51…` (74) and plain `ee6bf5cb…` (76) use real Settings XML
initialization and the FileServer `fes` category to load two independent,
nonempty authored tables. Canonical names, numeric IDs, fields, wildcard matching
and replacement filenames feed parsed Script arguments and actual Scene text.
The original 74 parser owns 100-byte fixed records and searches primary names;
76 owns larger string/vector records and also searches fifth-column aliases.
The finite alias miss in 74 and success in 76 are compared separately.

The same original programs allocate two normal two-row name-pair owners, append
short filenames, perform folded and reverse lookups, then use the returned words
to select different Scene blocks. Source strings are overwritten; one owner and
then both owners are released before subsequent consumers. A new table reader
sees the replaced resource's ID while the existing owner retains the old ID.
Complete VM outputs and canary spans match both originals, including ten
independent current checkpoint continuations across this and the XML/tone group.
`native-modern-xml-tone-name.test.mjs` preserves those consumer programs.

This qualifies the existing common name-pair implementation for plain 76 and
replaces its old unsupported migration decision; it adds no new record format
or layout. The historical zero-call static survey remains unchanged. Resource
reads use the qualified loose-file backend and finite Settings prefix. Full
Engine teardown, KIF rebind's unqualified 64-bit seek leaf, physical Windows
storage, arbitrary TSV grammar and the wrapped 638e executable remain outside
this proof.

## SDK63 parsed resource consumer bridge

`tests/native-sdk63-xml-name-resources.test.mjs` binds all eight table operations
to exact `c8d4d709…`, normal Settings `fes` selection and the original `.tbl`
extension. Two nonempty owners supply canonical names, row IDs, fields, wildcard
matches and replacement filenames to the same actual Script/Scene consumer.
The native constructor owns 100-byte records and frees its temporary resource
buffer. Fifth-column aliases remain disabled.

The authored table includes a 31-byte CP932 primary name, a 32-byte primary name
that the parser skips, and a longer filename field that it clamps to 31 bytes.
Original return codes, copied names/fields, NUL bytes and destination canaries
match current behavior. After source/query overwrite and first-owner release,
the other owner still returns ID 7. A normal source remount and independent
reader return ID 8. Both old owners and the new reader retire before continued
consumption of the previously selected Scene. The combined XML/name program has
39 target and 73 total GCALLs, with eight independent current cold continuations.
No production algorithm, ABI registration or parser layout changed.
