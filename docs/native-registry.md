# Native registry interfaces

The four original main-table wrappers run inside the shared engine process.
The SDK uses ANSI registry APIs; the game build converts its formatted names
from CP932 and calls their Unicode counterparts. The executable, formatter,
VM translator and wrapper control flow remain mounted inputs.

| ID   | Arguments                                                         | Result                                                 | Game handler | SDK handler |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------ | ------------ | ----------- |
| `C0` | formatted software path, formatted value name                     | successful query, `0/1`                                | `65A880`     | `529270`    |
| `C1` | formatted path, formatted name, VM destination, capacity in bytes | copied/required byte length on success, otherwise zero | `65A9E0`     | `5293A0`    |
| `C2` | formatted path, formatted name, raw DWORD                         | successful write, `0/1`                                | `65AB40`     | `5294D0`    |
| `C3` | formatted path, formatted name, VM byte string                    | successful write, `0/1`                                | `65ACA0`     | `529600`    |

All four return control code `1`. Paths are relative to
`HKEY_CURRENT_USER\Software`. `C0` overwrites a successfully read DWORD with
`1`, including a stored value of zero. `C1` reads any stored type without a
type filter. A destination that the original VM translator resolves to NULL
performs a length query. Short destinations keep their existing bytes.

`C3` reads its data with narrow `strlen` and does not format it. In the game
build those same narrow bytes are passed to `RegSetValueExW` as `REG_SZ`;
they are not re-encoded as UTF16. Odd byte counts and the adjacent terminator
therefore matter. The SDK's ANSI write converts that data through NT CP932.
The platform retains measured termination behavior instead of normalizing
the payload. Microsoft documents that registry string data need not arrive
terminated and that query lengths are measured in bytes.
[RegQueryValueExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regqueryvalueexw)
describes the corresponding query contract;
[RegSetValueExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regsetvalueexw)
describes the typed write boundary.

## Browser platform state

`NativeRegistry` owns one case-insensitive HKCU tree and explicit open-key
capabilities. Key creation creates missing ancestors; slash and `..` remain
literal key-name characters. Leading backslashes fail. Access masks govern
query and set operations, and closed handles fail instead of aliasing another
key. The browser exposes an empty, read-only HKLM tree, retaining the optional
D3DX tuning lookup's ordinary missing-key fallback. This is the browser's
registry environment, not an import of the user's Windows registry. Key
creation and disposition semantics follow the measured API boundary and
[RegCreateKeyExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regcreatekeyexw).

The feature factory awaits `readPlatform('windows-hkcu')` before returning.
Successful key/value mutations await `writePlatform` in the same per-game
platform namespace. Storage errors propagate; an unsuccessful flush remains
dirty for retry. Hive data are invisible to native file enumeration and slot
files. Open capabilities survive a checkpoint; the ordinary persistent hive
contains keys and values only. During restore the completed platform load is
replaced synchronously by the saved hive, so a late read cannot overwrite it.

The registry ANSI boundary uses a measured NT CP932 codec. It preserves lone
lead-byte handling, private-use mappings, default characters and best-fit
encoding. Eight decoding differences and 461 encoding differences supplement
the host's existing codec; no Windows or Wine code or data file is bundled.
The game's earlier name conversion uses the shared
[`MultiByteToWideChar(932, 1)` platform service](native-multibyte.md), which has
its own independent Win32 import comparisons. The registry RTL codec and this
import have distinct invalid-input behavior; neither replaces the rest of NLS.

## Verification

`verify-native-registry.mjs` executes **9,398 complete original wrappers and
56,394 comparisons per profile**, or **112,788 comparisons** across both fixed
executables. It verifies frozen table entries, control/results, all VM memory
regions, hive contents and key closure. Cases include DWORD zero/high bits,
raw CP932/UTF8/invalid bytes, odd string lengths, aliased outputs, unsigned
capacities, missing keys and adjacent words beyond the supplied GCALL array.
ADVAPI32 and the common Windows environment remain explicit host boundaries.

`native-registry-oracle.py` separately calls the pinned, isolated Wine API
with ACP932: **884** full-buffer A/W data cases and **30** path, permission,
disposition and closed-handle cases. It also executes **81,152** RTL conversion
inputs: every single byte, every CP932 lead/trail pair and every UTF16 unit.
The public tests recompute the complete conversion-output digest. Locale
construction uses the supplied glibc locale sources; the harness rejects an
ACP other than 932. The oracle's permissive odd-length/terminator behavior is
an observed Wine/NT boundary, not a new portable registry-string guarantee;
[Wine's registry implementation](https://github.com/wine-mirror/wine/blob/wine-8.0/dlls/kernelbase/registry.c)
also identifies those compatibility paths.

Seven public tests cover those platform cases, storage failure/retry, both
original wrapper families, a fresh engine process, and a full SDK World
checkpoint followed by a cold World using the persisted hive. The test
storage adapter uses the same `readPlatform`/`writePlatform` interface as
the browser's separately tested IndexedDB platform store. Raw reports and
decompiler output remain under ignored local storage.
