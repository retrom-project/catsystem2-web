# FES background tone tables

`fes-tone-table.mjs` provides the byte parser, exact file/group queries and
per-object replacement lifecycle for BGTABLE/raw16 and BGTABLE2/raw17 in both
frozen engine profiles. The default FES factory, command consumers and FILE
checkpoint integration are not connected yet; a standalone service test does
not complete those entry paths.

The service stores two current maps: group key to three uint32 values, and file
key to group key. Both use first insertion wins. Keys are exact C-string bytes,
with ASCII lowercasing that skips valid original CP932 pairs. There is no
Unicode case folding, wildcard, basename or extension matching. Query workspaces
and retained resource filenames own independent plain Uint8Array copies,
including when a caller supplies a Node Buffer.

The byte body ends at its first NUL. The parser removes line/block comments,
deletes TAB and ASCII space, and retains a BOM as ordinary bytes. A header
changes the current group and updates each numeric component only when its
delimiter is present; incomplete later components inherit their prior values.
Values follow the native integer-prefix and uint32 wrapping rules. A filename
before any header belongs to `__UNKNOWN__` with values100/100/100. Headers alone
do not insert groups.

A low-level query returns null on a miss. The raw-object getter boundary uses
100/100/100 as its default. Replacement releases the old table before opening
the new resource. Missing resource returns0 with no owner; a successfully read
empty file creates an empty owner and returns1. Open flags0x13 use the existing
search mode3; this is not a category19 or a new filename-extension rule. These
tables are query data, independent of explicit image `toneRGB` and bitmap tint.

Current maps are structured-cloneable state. Restoration should assign them
without opening source files, reparsing, or replaying commands. Queries return
copies of values. The JS service explicitly rejects keys/components outside the
original defined511-byte C-string region; this safety boundary does not emulate
native overflow, allocation failure, abnormal reads or reentrant replacement.

The public authored fixture in `tests/fixtures/fes-tone-table.json` records exact
file/group query outcomes from complete original constructor/parser/query/
destructor calls for both frozen profiles. Inputs and outputs are public
authored bytes; no original code, private resources, addresses or memory truth
are shipped in the fixture. The original binary identities are:

| Profile                       | SHA256                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| SDK4.01 / engine2.6.1.74      | `0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f` |
| NEKOPARAvol3 / engine2.6.1.76 | `ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0` |

`tests/fes-tone-table.test.mjs` checks these exact results and byte ownership,
clear-before-read, empty/missing resources and source-independent state copies.
Original abnormal resource reads and memory errors remain outside this contract.
