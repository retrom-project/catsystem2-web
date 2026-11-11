# Native FES data objects

STRTABLE (34) owns its row IDs and raw byte cells in JavaScript. The original
constructor, reader and getter are retained only as test oracle evidence.
FILELIST (35) still executes its original search/map object while its narrow/wide
pattern boundary is audited in phase 7. Neither object has a drawing child or a
per-frame renderer. A remaining generic FES command can lazily request only the
common base prefix; that phase-7 prefix never contains a STRTABLE map or cells.

| Object   | Game constructor / definition | SDK constructor / definition |
| -------- | ----------------------------- | ---------------------------- |
| STRTABLE | `764620` / `769440`           | `6002E0` / `605630`          |
| FILELIST | `765530` / `769460`           | `6011F0` / `605650`          |

STRTABLE's `FILE` definition resolves the config category and parses bytes in TAB
mode in JavaScript. Reapplying FILE clears the previous rows, including on a
missing resource. The
first field is the signed numeric row ID; subsequent fields are strings, with
the original quote handling. `get row column stringBank statusGlobal` writes a
string and success flag only for an existing cell. Missing rows or columns
write failure and retain the previous destination string. Returned bytes enter
the same native string bank directly, preserving CP932, raw UTF-8 and invalid
byte sequences without a text decode/encode round trip.

FILELIST's definition callback is an original no-op. `make path patterns...`
runs the original directory expansion and Win32 search loop over the shared
mounted/persistent file service. With no explicit patterns, the original
handler supplies `*.*`. The map includes directory entries, compares filenames
using lowercase keys, preserves their original spelling in results and retains
existing entries when another `make` adds files. `get count`, `get name` and
`get fullpath` run the original indexed map traversal. An invalid index reports
failure and leaves the destination string unchanged.

The pinned game has a wide/narrow mismatch in FILELIST's multi-character search
patterns: its original path concatenator receives narrow pattern bytes as
UTF-16. For example, `*.txt` reaches FindFirstFileW as the byte-pair
reinterpretation of that string. The pinned SDK builds the expected narrow
pattern and calls FindFirstFileA. The runtime preserves these original paths;
it does not correct one profile by borrowing the other's implementation.

`tests/fes-string-table.test.mjs` exercises JS STRTABLE without an EXE, checks
the independent two-profile original output fixture, preserves failed outputs,
and restores raw rows into a fresh player without re-reading them.
`tests/native-fes-data.test.mjs` additionally runs both mounted World integrations
with authored TAB tables and a virtual directory tree. It covers signed row IDs, quoting,
non-ASCII and raw-byte results, missing lookups, native search patterns,
case-preserving paths, accumulating maps and continuation after restoration in
a fresh World. The surrounding FES lexer/expression boundaries use the shared
FES adapter. These tests establish the exercised contracts; all invalid-input
combinations and complete game UI acceptance remain outside this evidence.

Raw executable content and traces remain in ignored local storage. The public
fixtures contain authored data only.
