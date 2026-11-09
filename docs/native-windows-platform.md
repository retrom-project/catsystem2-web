# Native Windows platform boundaries

The browser owns the Windows services used by the fixed SDK 4.01 and NEKOPARA Vol.3 engine images. Original engine handlers and their parsers still execute in the shared PE process. Platform adapters project browser files, storage quota, clipboard and time into the original import ABI.

The shared [multibyte input converter](native-multibyte.md) retains the
reference CP932/UTF8, capacity, flag and error contracts for native engine
and plugin calls.

The original display-capability and complete view constructors now run before
an actual mounted executable enters its task loop. They create the original
view, view3D, graph manager, D3D core, render-target resources and GDI bitmap.
Their pointer identities and ownership stay in the one engine process. E-mote
shares that same D3D device. Public SDK World tests verify these original
objects, their full destructor path, real bitmap RAM and independent fresh
restoration. Browser acceptance exercises the game build with its actual GPU.

Explicit host DLL providers expose actual guest function addresses through
`LoadLibraryA/W`, `LoadLibraryExA/W`, `GetModuleHandle`, `GetProcAddress` and
`FreeLibrary`. DLL names are case insensitive; export names are case sensitive,
and ordinal lookup is supported. Unknown modules/exports return the Windows
failure codes. Module identities, exports and reference counts are part of a
process checkpoint; restoration requires the same registered provider. The
original MSVC delay loader uses this service for D3D9 and DirectSound enumeration.
Public tests call the exported guest functions and restore a fresh kernel.

Fresh-process restore identifies a host export by its registered trap name,
argument count and return convention. It adopts the restored guest addresses
after verifying those bindings, so unrelated trap allocation order does not
change a module's identity. Missing providers and changed export signatures
remain restoration errors; aliases retain their shared target and reference
counts.

`CreateDIBSection`, `GetObjectA/W` and bitmap `DeleteObject` use the existing GDI
handle owner. DIB pixels are actual allocated guest RAM with the original
DWORD-aligned stride, orientation and bit masks. Headers 40, 108 and 124 and
depths 1, 4, 8, 16, 24 and 32 are covered. Query, partial-structure, terminator,
canary and failure behavior comes from an authored pinned-Wine probe with
56 cases and 1,232 `GetObject` calls. Fresh-process tests verify pixel pointers,
memory growth, independent ownership and release. File-backed DIB sections
remain an explicit unsupported platform operation.

Bitmap selection, compatible DCs, solid brushes, `FillRect`, `BitBlt` and
`StretchBlt` operate on that same guest RAM. Window DC readback uses the actual
presented browser canvas. Selected bitmaps retain Windows' deferred deletion:
deletion succeeds while selected, and the allocation is destroyed on unselect.
The authored pinned-Wine blit probe checks 144 cases with complete pixels,
returns and error values: 24/32-bit destinations, signed row orientation,
clipping, negative extents, eight raster operations and BLACKONWHITE/
COLORONCOLOR scaling. Fresh-process tests cover selected objects and pending
deletion. Both native engines exercise this service through their original GDI
screenshot and BMP recording branches in Chromium. HALFTONE scaling and pixel
operations on 1/4/8/16-bit DIBs remain explicit unsupported operations; allocating
and describing these DIB depths is covered independently above.

The KCS millisecond clock truncates fractional platform milliseconds and wraps
to the original unsigned DWORD. Independent calls to both complete original
clock wrappers verify the imported `timeGetTime` word and untouched caller
canaries. The [World system clock](native-clock.md) now supplies this word,
`GetTickCount`, QPC and UTC FILETIME to both the engine and its particle DLLs.
Its exact virtual increments and saved UTC origin survive fresh restore while
the native task frame clock remains separate.

`USER32.wsprintfA/W` uses cdecl; `wvsprintfA/W` takes a stdcall `va_list` pointer. The implementation preserves raw CP932 format bytes, UTF-16 units, null strings, zero character writes, integer signedness, two-DWORD `I64` arguments, pointer width, padding and the original 1024-unit return convention. Hex prefixes have USER32's separate width accounting. ANSI conversion uses the engine's CP932 code page.

`scripts/native-wsprintf-oracle.py` builds an authored Win32 harness and executes the actual USER32 exports in the pinned private Wine image. Its 371 cases record all 4096 output bytes, including terminators and untouched canaries. The public fixture contains authored inputs and SHA-256 digests; both cdecl and `va_list` adapters must match every digest. Cross-code-page fixtures use ASCII because the pinned Wine environment's ANSI code page differs from the game. Public tests separately exercise CP932 literals and cross-width Japanese strings. No Wine implementation source is embedded in the product.

The invalid combination of `#` with decimal formatting reads uninitialized stack bytes in the reference USER32 implementation. It is rejected explicitly rather than assigning those bytes a fabricated deterministic value. These checks establish the adapter's tested import contract, not implementation of all Windows APIs.

References: [Microsoft wsprintfW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-wsprintfw), [Wine 8.0 USER32 reference](https://gitlab.winehq.org/wine/wine/-/blob/wine-8.0/dlls/user32/wsprintf.c).

File mutation and metadata share one native storage namespace. Writable overlays retain creation/access/modification times and attributes; copy preserves modification time, move preserves metadata, and the source deletion and target write share one IndexedDB transaction. Mounted game files remain available after an overlay moves or is removed. Public Chromium tests explicitly abort a move transaction and reopen the database to verify both rollback and namespace isolation.

The reviewed `CreateFile`, read/write/close, copy/move/delete, attributes, directory, search and quota boundaries use real provider outcomes. Open file and search handles have independent lifetimes; in-flight file bytes, pending explicit times, directory state, search cursors and error mode survive process checkpoints. Storage quota comes from `navigator.storage.estimate`; an unavailable provider returns a platform failure without fabricated capacity.

`scripts/native-file-pattern-oracle.py` runs 72 authored `FindFirstFileA/W` searches against pinned Wine. Both the shared pattern helper and the public import tests reproduce long-name and explicitly supplied short-name matches, return fields, terminators, canaries, end-of-search and released-handle failures. The virtual mount does not fabricate host filesystem 8.3 aliases. The `update??.INT` scan matches exactly two suffix characters in this fixed reference; `update.INT` and `update1.INT` are excluded. Search results have a deterministic order in the virtual namespace; callers must not assume host filesystem enumeration order. These are scoped service contracts rather than a claim to reproduce every Windows filesystem or OS revision. See [Microsoft FindFirstFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findfirstfilew).

The `VERSION.dll` imports copy the mounted PE's actual version resource into
caller memory. `VerQueryValueW` returns a pointer into that buffer for the
fixed info, translation array or localized string. The ANSI form converts
only text and returns a pointer into the same buffer's reserved space using
the [Windows CP932 conversion](native-widechar.md). Module handle zero
resolves the main image's actual mounted filename.

A pinned Japanese Wine probe compared 32 calls over both reference EXEs:
size queries, full and truncated copies, root/translation/text lookups and
missing names. The 115,124 bytes of return values, pointer offsets, error
words and whole output buffers matched. Public tests cover the same buffer
ownership, case matching, and CP932 text with an authored resource. The mount
supports the PE version resource; it does not merge Windows MUI files or
load 16-bit NE resources.
[Microsoft version buffer reference](https://learn.microsoft.com/en-us/windows/win32/api/winver/nf-winver-getfileversioninfow),
[version queries](https://learn.microsoft.com/en-us/windows/win32/api/winver/nf-winver-verqueryvaluew),
[Wine 8.0 version API](https://github.com/wine-mirror/wine/blob/wine-8.0/dlls/kernelbase/version.c).
