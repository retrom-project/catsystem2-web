# Compiled database resources and flags

The seven main natives `365/366/367/368/369/36D/36E` operate on the engine's
compiled `KCDB` resources. [The adapter](../src/native/database.mjs) executes
the complete original wrappers, parser, ordered index map, string helpers and
destructor from each fixed engine. The mounted `database` resource category and
shared file service are the explicit resource boundary.

A resource contains a zlib-compressed column schema and fixed-width records.
The reviewed fields are `ID`, `TITLE_S`, `TITLE`, `IND1` through `IND24`, and
`INDEX`. Index names pass through the original byte normalizer and ordered map.
These are compiled tables; a TSV reader or a numeric flag array would lose their
lookup and ownership behavior. The three formatted constructor options remain
conservatively named A/B/C because their full presentation meaning has not been
established independently.

| ID  | Arguments including owner | Control | Behavior                                                             |
| --- | ------------------------: | ------: | -------------------------------------------------------------------- |
| 365 |                         4 |       1 | Load formatted filename and three formatted options; return an owner |
| 366 |                         1 |       2 | Release owner, records, index map and strings                        |
| 367 |                         3 |       2 | Set bit on the record selected by a formatted index name             |
| 368 |                         2 |       1 | Return flag-export byte count; optionally write to a raw PE pointer  |
| 369 |                         2 |       1 | Import flags from a raw PE pointer                                   |
| 36D |                         1 |       1 | Return owner modification word                                       |
| 36E |                         1 |       2 | Clear only the owner modification word                               |

## State and serialization

Each record retains three flag words. Setting a previously absent bit updates
both its current and newly set masks. A record whose old mask was zero also
gets its first-use word. Either transition marks the owner modified. The x86
bit shift uses the low five bits of the bit index. Repeating an existing bit
after clearing the owner modification word leaves the owner clean; a missing
index name changes nothing. `36E` does not clear record flags.

Export is a count DWORD followed by 268-byte records in original index-map order:
a 256-byte NUL-terminated index name and the three flag DWORDs. The original
writer clears each output record before copying the name. A null destination
only queries `4 + count * 268`. Import normalizes source names in place, replaces
all three flag words for known records, ignores unknown names and lets later
duplicate input records win. It does not mark the owner modified.

Both export and import take process pointers, **not KCS virtual addresses**.
They interoperate with raw heap natives `341..344` and CSS global-file entries.
Import with a null source returns zero for a live owner; a nonnull source returns
one. With a null owner, `368/369` return control 1 without writing their result,
preserving the VM's `CCCCCCCC` result sentinel. Other null-owner operations retain
their original zero or void behavior. Missing, empty and bad-magic resources
still leave a valid empty owner after `365`.

An opaque `database` handle stores only the original 80-byte owner pointer. All
records, strings, flags and heap references stay in the one shared engine
process. A fresh-World checkpoint restores this same identity and process state.
Explicit release runs the original wrapper; World cleanup destroys remaining
owners. No parallel JavaScript database is maintained.

## Evidence

`scripts/verify-native-database.mjs` compares **502 complete wrapper calls and
3,089 observations per profile**, **6,178 comparisons** total. Both sides execute
the original compiled-resource parser and helpers. The checks include all seven
interfaces, complete VM memory and canaries, original allocation/string/map
state, formatted options, duplicate/empty/long/CP932 fields, raw export/import,
in-place source normalization, adjacent GCALL argument words and null-result
sentinels. The fixture tables are authored for these tests and contain no game
assets.

Four optional engine-backed integration tests cover both profiles. They verify
flag and modification transitions, real `341/368/343/F5` export to a CSS file,
fresh-World `F7/344/369` import, checkpoint identity, independent mutation and
release. The images are supplied locally through the same frozen-image test
environment variables as the other native families.

Malformed buffers that exceed the original unchecked record-field capacities
are not claimed as defined behavior. This family supplies the compiled records
and persistent flags used by database-style displays; complete gallery,
recollection, FES display and browser presentation acceptance remain separate
work.
