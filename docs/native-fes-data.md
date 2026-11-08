# Native FES data objects

STRTABLE (34) and FILELIST (35) execute their original constructors, definition
callbacks, built-in command handlers and destructors in the World's shared
engine process. These classes have a 44-byte common base and an 8-byte map
wrapper. They have no drawing child or per-frame driver. Their map nodes and
strings are saved once with the process memory, rather than copied into a
second JavaScript table.

| Object   | Game constructor / definition | SDK constructor / definition |
| -------- | ----------------------------- | ---------------------------- |
| STRTABLE | `764620` / `769440`           | `6002E0` / `605630`          |
| FILELIST | `765530` / `769460`           | `6011F0` / `605650`          |

STRTABLE's `FILE` definition resolves the config category and runs the original
mounted IFile reader and table parser. The parser is invoked in TAB mode. The
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

`tests/native-fes-data.test.mjs` runs both mounted engines with authored TAB
tables and a virtual directory tree. It covers signed row IDs, quoting,
non-ASCII and raw-byte results, missing lookups, native search patterns,
case-preserving paths, accumulating maps and continuation after restoration in
a fresh World. The surrounding FES lexer/expression boundaries use the shared
FES adapter. These tests establish the exercised contracts; all invalid-input
combinations and complete game UI acceptance remain outside this evidence.

Raw executable content and traces remain in ignored local storage. The public
fixtures contain authored data only.
