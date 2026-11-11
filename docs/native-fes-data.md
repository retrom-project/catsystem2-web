# Native FES data objects

STRTABLE (34) owns its row IDs and raw byte cells in JavaScript. FILELIST (35)
owns its basename-indexed entries and uses the shared JS/VFS enumeration
service. Neither data object's constructor, parser, map or query executes the
original engine. Neither has a renderer. Other generic FES commands can still
lazily request a common base prefix until the phase-7 common-object migration;
that prefix contains no data table or map. Original addresses below identify
only the independent test oracle.

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

FILELIST's definition callback is an independently recovered no-op.
`make path patterns...` enumerates mounted loose files and persistent native
files through the same JavaScript search implementation as the transitional
Win32 host. It includes directory entries, keys by lowercase basename in the
ABI's byte/code-unit order, preserves spelling and the first full path for a
duplicate name, and accumulates entries across calls. Whole-group `make` is an
original no-op; an explicitly selected member, or a scalar object, enumerates.
No explicit pattern supplies `*.*`. `get count` writes the number of entries.
`get fullpath` returns the stored path; every other selector returns basename.
Invalid indices report failure and preserve the destination string. Native
string/variable bank defaults and dirty behavior remain separate from FES's
strict expression-index interface.

Both ABI files declare FILELIST pattern and key encodings. The reviewed game
engine misinterprets narrow pattern bytes as UTF16LE, so `*.txt` still becomes
`⸪硴t` and finds no authored txt file. The SDK uses the narrow pattern normally.
JS reads only the current token bytes and pads through a complete UTF16 NUL.
It deliberately does not read undefined trailing native stack/heap bytes.

This is the sole intentional FILELIST difference: the original game sequence
`make folder *.txt` followed by `make folder/subdir *` could expose the previous
stack tail and search for `*硴t`, retaining count 3. Without the previous filter,
the original searches for `*` and reaches 4. The approved deterministic JS path
always searches for `*` and reaches 4, independent of history. This is not a
claim of bit-for-bit equivalence with undefined native memory. Existing oracle
FindFirstFileA/W observations and raw buffers distinguish this original defect
from VFS/path/Win32 bridge behavior; no path, length or game-name special case is
used. Normal defined outputs and version-specific conversion remain intact.

`tests/fes-string-table.test.mjs` exercises JS STRTABLE without an EXE, checks
the independent two-profile original output fixture, preserves failed outputs,
and restores raw rows into a fresh player without re-reading them.
`tests/native-fes-data.test.mjs` runs both ABI World integrations without an
EXE, using authored TAB tables and a virtual directory tree.
`tests/fes-file-list.test.mjs` checks input histories/order/repetition, current
pattern bytes, first-name ownership, default outputs, group selection and fresh
player restore without another enumeration. It covers signed row IDs, quoting,
non-ASCII and raw-byte results, missing lookups, native search patterns,
case-preserving paths, accumulating maps and continuation after restoration in
a fresh World. The surrounding FES lexer/expression boundaries use the shared
FES adapter. These tests establish the exercised contracts; all invalid-input
combinations and complete game UI acceptance remain outside this evidence.

Raw executable content and traces remain in ignored local storage. The public
fixtures contain authored data only.
