# Native contracts and evidence

The authoritative public catalog is [src/native/catalog.mjs](../src/native/catalog.mjs).
`nativeCatalog(profile, table)` returns every slot, including reserved handlers,
constant-zero handlers and unresolved contracts. Descriptive names are project
names; the main compiler's original symbol table has not been recovered.

The frozen inputs and hashes are recorded in [references.json](../references.json).
SDK 4.01 contains engine **2.6.1.74**; the prepared NEKOPARA Vol. 3 engine is
**2.6.1.76**. SDK package version and engine ABI version are separate identifiers.

Cold startup executes each original executable resource block, including its
identity comparison against startup settings and its copy into the live
settings. The original resource objects are released before returning through
the original function epilogue. The SDK runs the check before loading game
defaults; the game runs it after reading setup preferences. The following
desktop registration and device checks stay outside this block; the browser
still mounts prepared archives.
The original platform prelude also constructs the system information record
(SDK `49FBE0`, game `5C3460`) before file-server and Settings startup. The
version, DirectX, CPU, memory and OEM branches run in the original code. Their
Windows imports describe the virtual 32-bit Windows 7 SP1 environment, the
Direct3D 9 adapter and its guest memory budget. The record and its DLL export
bindings survive a fresh process. The original destructor clears the singleton
on close. Both frozen WinMain functions supply the `0x7F` survey mask.
The Windows boundaries follow the
[version structure](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/ns-wdm-_osversioninfoexw)
and [memory status structure](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex).

SDK `47F380` and game `5AFE20` read the virtual DirectX version from
`DxDiag_SystemInfo` through the original COM vtables and the three OLE
Automation imports by ordinal. The browser provider supplies two `VT_UI4`
properties and the version letter as a length-prefixed
[BSTR](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/automat/bstr).
Each original release path balances the nested COM initialization and frees
the provider, containers and string. World startup also runs the original
DirectX/D3DX gate (SDK `546940`, game `66F600`). Tests verify the original
`9.0c` record and repeat the full query after restoring into a fresh process
without leaking guest allocations. The virtual adapter exposes Direct3D 9;
the original DLL-version fallback and the optional Direct3D 11 probe remain
outside this path.

OEM discovery uses the original A/W profile-string calls and searches the
virtual Windows directory, `system`, then `system32`. Manufacturer and model
are resolved independently and remain empty when no OEM file is mounted.
Tests give both engines a manufacturer in the second directory and a model
in the third; the SDK reads CP932 and the game reads UTF-16. The mounted
[profile-string API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getprivateprofilestringw)
also preserves case-insensitive section/key lookup and quoted values.

The CPU survey (SDK `4A1AE0`, game `5C4EE0`) runs the original `CPUID`
checks, reads the original system information structure and performs its
quarter-second calibration. The browser advances a virtual 2 GHz TSC and
the performance counter together during calibration, then uses the normal
frame clock. Tests check the recorded vendor, family, feature words and
calculated speed, and confirm normal counter behavior after fresh restore.

After preferences and the DirectX gate, World startup executes the original
desktop probe (SDK `4A2750`, game `5C5B10`). The
[screen metrics](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getsystemmetrics)
come from the virtual screen; the original code acquires a GDI desktop DC,
reads its 32-bit color depth and releases it. The static WinMain block
(SDK `CB2440`, game `BAFA80`) retains the dimensions as WORDs. The input
device and startup use the same metrics. Tests verify the original calls and
packed dimensions after a fresh restore.

WinMain next constructs its `CoreSystem2` window class. SDK `5C0040` and
game `70ED40` write the original 48-byte
[WNDCLASSEX record](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-wndclassexw)
and call the corresponding ANSI or Unicode registration. The virtual desktop
assigns a process-local atom and preserves the original window procedure,
embedded icon, arrow cursor and stock brush. Duplicate registration follows
the original Windows error contract. Both profiles restore the same class
and release it independently. The browser still owns the display window;
the external icon-file and CreateWindowEx paths remain separate.

The SDK `5BF330/5BF3C0` and game `70DF70/70E000` menu owners run their
original constructor and [LoadMenu](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-loadmenuw)
wrapper after class registration. The static WinMain block retains the menu
owner and selects resource 104 or 105 from the original author-mode word.
The virtual USER32 reads each embedded standard RT_MENU tree, including
submenus, command IDs, separators and UTF-16 labels. The original destructor
frees the owner and recursively releases the handles. Both profiles check
the normal and author resources, reload and fresh-process ownership.
The original localization walkers (SDK `47EE90`, game `5AC260`) visit
each menu recursively through
[MENUITEMINFO](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-menuiteminfow).
They use the original language tree to select a translation, an intentionally
empty label, or the resource's fallback. Tests cover both code pages and
nested labels. The WinMain settings checks then remove disabled manual,
message-window reset and, in the game profile, social commands through
[DeleteMenu](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-deletemenu).
The game also executes WinMain `52C72F..52CCFE` with its original
language vector, using the original strings and USER32 item mutations.
It fills the UI, primary and secondary language groups, with accelerators
and checked selections, or removes the submenu for one language.
The original menu object retains the address of the WinMain startup block.
The game menu command receiver maps the three ten-ID ranges to language
indexes, including an out-of-range secondary selection for OFF. Menu
commands and private Script messages share the browser language tables,
with the original extra option reload only on private message 46F. Changes
run the original checkmark pass `530EC0..53100D` against the live native
menu. Rebuilding the localized menu labels on a UI language change is a
separate operation.

WinMain then allocates the original 116-byte `kcWindow` owner (SDK `5BF430`,
game `70E080`). It initializes the callback list and critical section and
retains an unnamed, automatic-reset event in both of the original fields.
The fresh-process tests restore a signaled event and consume it independently.
The original destructors release the event and the list before the menu and
class owners close.

The original window wrappers (SDK `5BF870`, game `70E4C0`) also run
against the virtual desktop during application startup. They use the
original Settings for client size and menu visibility. The normal style
centers the main window, and the menu path creates a second hidden
window through the original
[CreateWindowEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createwindowexw)
imports. An authored probe in the pinned Wine host supplies the window-frame
sizes and callback order for the reviewed styles. The original WndProc
sees the same creation messages, and the destructor detaches the shared
menu before destroying the windows. The tests verify those handles after
an independent process restore. SDK `5BFAB0` and game `70E740` attach
the native input device to the same `kcWindow` object. Its callback list,
input state and window handles belong to each restored process. The browser
presents the view. The SDK
`5BFD80` and game `70EA60` caption setters send the original
[WM_SETTEXT](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settext)
through the WndProc. The game resolves its initial caption through its
native language tree, and the browser displays the resulting window title,
including after a fresh restore.

Startup loads accelerator resource 101 through the original SDK setter.
The game executes WinMain `52CDCB..52CFED`, copying the four embedded
entries and appending the original language keys and secondary-language
off command when applicable. The virtual USER32 keeps the two record
layouts distinct: eight bytes in the PE resource and six in x86
[ACCEL](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-accel).
Tests cover missing language keys, independent restore and release of the
dynamic table. The pinned Wine probe also verifies the copy's untouched
padding and capacity boundary. The ANSI and Unicode
[`TranslateAccelerator`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-translateacceleratora)
imports now match virtual and character messages and synchronously send the
original application menu notifications and command. The pinned Wine probe
checks exact modifiers, nested or disabled items, capture and minimization.
The standalone browser checks the current accelerator table to decide
whether to cancel the browser's default action. It posts the original
virtual key and captures the modifiers and character with the message.
The original loop translates the queued key. Its `WM_CHAR` path resolves
the game's Shift+N secondary-language OFF entry.

The virtual USER32 thread now owns posted messages for windows and the
thread itself. The pinned Wine probe checks nonremoving reads, child-window
and message-range filtering, removal when a window is destroyed, and
quit-code delivery through the 28-byte x86 `MSG` record.
[`PeekMessage`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-peekmessagew)
and [`GetMessage`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmessagew)
share that queue. `DispatchMessage` normally invokes the registered window
procedure and returns its result. A settled checkpoint preserves pending
posts, queued key data and the last received message. Modeless dialogs and
system-menu keyboard handling require further coverage.

[`MsgWaitForMultipleObjects`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-msgwaitformultipleobjects)
waits on the same synchronization handles as the kernel and on the queue's
newly posted messages. Wine probes verify handle priority, automatic-reset
consumption, and the separate changes observed by filtered and unfiltered
peeks. The changed queue flags survive a settled checkpoint.

Browser frames execute the original `kcWindow` message loops at SDK
`5BFB00` and game `70E7E0`. Both run the original event callback when its
handle is signaled and return the posted exit code on `WM_QUIT`. Browser
services for the application window can issue their own engine calls. The
loop yields at its original epilogue before invoking those services, then
resumes at the next message check. Fixed-binary tests verify event priority,
dispatch to a secondary window, already queued posts and the exit code.

PE32 gives the initial x86 thread a mapped TEB addressed by `FS`. Its self
pointer, exception chain, client IDs and stack bounds are readable by guest
instructions. The Win32 last-error functions and TLS APIs use the same
memory as direct guest access, including the static TLS vector used by PPI
DLLs. The TEB persists in the native memory checkpoint.
[Thread Environment Block](https://learn.microsoft.com/en-us/windows/win32/api/winternl/ns-winternl-teb).

The Win32 scheduler runs `CreateThread` entries in the same PE32 address
space on separate stacks with their own TEBs. The browser schedules workers
after a native call or while the initial thread is waiting. A blocked worker
keeps the instruction pointer and its original import frame. Event, semaphore,
mutex and thread waits use the same handle namespace, and critical sections
track the owning thread. `ExitThread` or a normal entry return releases the
stack and TLS and signals the thread object until its last handle is closed.
Tests exercise suspend-at-creation, wait-all, mutex abandonment, and a fresh
restore of a worker blocked in its original x86 wait.
[CreateThread](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createthread),
[WaitForMultipleObjects](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitformultipleobjects).

COM initialization depth and apartment mode belong to the calling thread.
`CoInitialize` selects STA. `CoInitializeEx` also supports MTA, and a later
incompatible call returns `RPC_E_CHANGED_MODE`. The apartment records survive
a fresh restore with their live thread environments.
[CoInitializeEx](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-coinitializeex).

The ANSI and Unicode `GetWindowText` imports send `WM_GETTEXT` to the
registered window procedure. Caption reads preserve the terminator, return
the copied length in the caller's encoding and keep CP932 pairs together
at the buffer boundary. A worker reading the startup window enters its
procedure on the initial thread's stack and TEB, then resumes the worker.
[GetWindowTextW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw).

The original frame timers query WinMM capabilities and acquire and release
a 1 ms period. Period requests are counted per guest process and survive a
checkpoint. The virtual millisecond clock supplies the reported resolution.
The supported period range and invalid-argument results match the Wine 8
reference. [Multimedia timers](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/).

Window and thread timers use the same clock as the emulated engine.
Retrieval generates a due `WM_TIMER` after checking for matching queued
messages. A nonremoving peek leaves the generated message available even
after cancellation, while a timer cancelled before retrieval cannot
generate a new message. Both fixed engines wake their original loops for
timer input and dispatch the guest `TIMERPROC`. The active timers and any
already generated messages survive a settled checkpoint. [SetTimer](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-settimer), [KillTimer and generated messages](https://devblogs.microsoft.com/oldnewthing/20141205-00/?p=43463).

The original WinMain window preludes (SDK `43EBD9`, game `52D031`) create
the named `CoreSystem2ConfigEvent`, register the application callback with
the native window hook list and construct the original 24-byte IME owner.
The reviewed Script menu messages now enter the registered callback through
the original WndProc. The browser routes the remaining application window
services. The default IMM context shares open status and position across the
virtual thread's windows. The two engine destructors restore and release
that state, and the native hook is removed before destroying the window.
Fixed-binary tests cover event, hook and IME ownership after a fresh restore.

The WinMain prelude also posts `0x40B` through its original USER32 import.
The registered application callback creates the native display-mode owner,
selects the configured or desktop dimensions and posts `0x40C`. The registered
`0x40C` callback reads the original sound configuration and constructs
`CsSound` with the live Settings flags. Its original CRT thread waits on the
native device events. The SDK initializes 32 channel owners and the game
initializes 64. The callback returns through its original epilogue after
audio setup, and the World continues with browser graphics and the Script task.
On close, the `CsSound` destructor signals and joins the worker, closes its
handles and releases the channel owners.
Tests restore the queued `0x40B` in a fresh process and compare both display
dimension branches, message order and destructor ownership.

The WinMain block also owns the original instance mutex. SDK `635D60`
and game `79D1F0` construct it from the active Settings, and their original
destructors close it. The virtual Windows instance uses the
[CreateMutex contract](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createmutexw):
opening a duplicate name returns its own handle and sets
`ERROR_ALREADY_EXISTS`. Mutexes belong to each emulated process, so loading
another World cannot lock out the current one. Tests cover the original
constructor and destructor, repeated acquisition on the virtual Win32
thread, shared handles and fresh restore.

The original display capability constructor runs in application startup mode
before the instance mutex and desktop probe. It enumerates the virtual D3D9
adapter and records the browser audio endpoint through the original
DirectSound callback. Creating the rendering view reuses that capability
record. Both frozen builds restore the record and its sound list before any
view device exists, without repeating the enumeration.

The Unicode startup error path uses the game's original language tree. The
game selects its UI catalogue from the saved Settings and parses the mounted
UTF-8 file in the original code. The browser caches the end of that immutable
buffer so the line loader does not scan it again for each line. Against the
unmodified x86 loader, the English fixture matched every lookup across 934
unique keys, including fallback results.

| Main table      | Slots | Recovered declarations | Original no-op | Original constant zero | Unresolved declarations |
| --------------- | ----: | ---------------------: | -------------: | ---------------------: | ----------------------: |
| SDK / 2.6.1.74  | 1,009 |                    694 |             82 |                     19 |                     214 |
| Game / 2.6.1.76 | 1,055 |                    917 |             58 |                     17 |                      63 |

Both generic/MOT tables contain 45 recovered declarations. The separate PTCL
tables contain 44 slots for version 1 and 51 for version 2; their declarations
come from the SDK particle headers and [PPI contracts](../src/ppi/contracts.mjs).
See [particle compatibility](ppi-compatibility.md) for their implementation status.

Main `24E..251` runs the original Script XML file open, parse, query and
release wrappers on both engines. The original file reader resolves mounted
resources and owns the temporary stream. The document and its node vector
live in the same process as the VM; the browser handle retains their pointer
across a fresh World without reading the file again. String queries write
the original Shift_JIS or UTF-8 bytes and one NUL. Missing nodes leave the
string destination intact and use the caller's integer default. Null handles
skip formatting and preserve those same fallbacks. The authored World test
covers both profiles, raw output bytes, invalid input and independent release.

The paired `36B` integer-unpacking interface executes both original wrappers
and VM translators. Signed halves, aliased/overlapping destinations, all VM
storage classes and fresh live backing have 15,464 differential checks plus
separate World coverage; see [scalar and word contracts](native-scalar-math.md).

The five variable primitives `D1..D5` have 309 full original calls and
13,946 comparisons per fixed profile, including the constructor guard, zero
capacity, unsigned get/set bounds, dirty state and context word. The original
expression wrapper accepts VM address zero, data, shared and allocated blocks;
an unmapped expression address produces a zero result. The evaluator still
requires mapped variable references: the original interpreter can access
unchecked indices inside the expression. See
[the differential runner](../scripts/verify-native-variable-primitives.mjs).

Main `D0` executes both original [task dump wrappers](native-task-dump.md).
The SDK writes its CSS task tree through the original receiver. The game
receiver completes its message without a file write.

The SDK's [original JavaScript task](native-javascript.md) receives `3CE`,
`3CF`, `3D0` and `3EE` through their original wrappers. The corresponding
slots in the fixed game executable are original no-ops.

Main `2BD/2BE` and `3DC/3DD` execute the original
[Plane movie wrappers](native-movies.md) for VMR9 and the Texture Renderer.
Each pair loads into the Plane and borrows its movie identity without
transferring ownership. The two pinned engines render the decoded result and
resume it in a fresh browser instance.

Main `C4/C5/C6/C7/C8/C9/CA/CB` execute the original
[area effect wrappers](native-area-effects.md). The original Wipe2 receiver
and Wipe1/Fade source replacement render and continue after restore. Raster
retains its original drawing callback; Hydro leaves the update unhandled. `C7`
copies and sends the matrix packet, which Raster and SimplePlane ignore. Other
`C4` receiver types still require implementation and verification.

Main `110..113`, `1AA` and `1AB` execute both original particle control
wrappers. They send start, stop, active query, 128-byte register block,
opacity or attachment messages to the calling Top's task namespace. The
active query returns zero if no task writes its output. The original
particle receivers store signed opacity values at or above 255 as 256,
and graph ID zero as -1. The live VM payload and task state are checked
against both original receivers.

Main `10F` and `2B5` run the original PTCL and PPI load wrappers. The guest
formatter and VM translator build the original particle packet, including the
32 registers and float priority. PTCL scripts and textures use the native
archive namespace; PPI modules use the physical library resolver. The fixed
filenames in this packet each have a 128-byte destination.

The five [RECT interfaces](native-rectangles.md) `D6..DA` execute the original
wrappers and VM translators with 40,612 comparisons across both engines.
Independent platform probes cover 748 USER32 cases; bitmap unions preserve the
raw image dimensions, signed overflow, VM aliases and fresh live backing.

The original [ANM existence query](native-image-file.md) `1AE` preserves its
`anmtable.csv` fallback and real IFile lifecycle. Both engines have 16,789
comparisons each, including original formatting, candidate order and complete
view/heap state. A fresh World rebuilds the same native ordered map.

The original [composite bitmap factory](native-image-composite.md) `1CC` uses
the full native parser and composition helpers. Its returned wrapper is
explicitly owned and is not inserted into the Script's automatic bitmap list.
The two profiles have 28,004 comparisons, with separate shared-alias, explicit
release, fresh-World and actual GPU pixel checks.

Main `1D4` and `281` run the original [bitmap rotation and alpha operations](native-bitmap-memory.md)
on owned bitmaps and live borrowed render sources. Rotation updates the original
dimensions, anchors and attribute payloads. Alpha uses unsigned percentage
arithmetic and only writes the alpha bytes of a 32-bit source.

The [render-source array](native-render-sources.md) pair `2BF/2C0` executes
both original wrappers on live VM storage. The two record layouts keep
original bitmap and retained-data pointers, including Draw's independent
reference and the last release after restoration. The [retained Draw bindings](native-draw-commands.md)
`2C3/2C4` pass the raw pointer through both original wrappers and preserve
the manager's reference on insertion, in-place update, and both destruction paths.
The original `2C2` wrapper writes the retained source's nine geometry words
through the live VM translator, with the same null and empty cases after restore.
The original `2C5` wrapper returns a borrowed raw frame pointer, including
the game's native prefetch readiness check and the same pointer after restore.

Main `1B1` uses both original [tiled SimplePlane](native-tile-plane.md)
wrappers and receivers. The browser tests compare the rendered child tiles,
the native model identities and the lifecycle across restoration.

Main `2E3/2E4` use both original [view geometry queries](native-view-geometry.md).
The wrappers preserve writes to overlapping destinations and all configured
position modes, with live KCS calls in Chromium before and after restoration.

These declaration counts do **not** measure completed emulator behavior. A
recovered wrapper can still depend on an unfinished task, graphics, input, file
or audio service. Unknown declarations and missing services remain explicit
errors. An observed argument count describes a compiled call site, not the
complete function prototype.

The game's [Unicode output bridge](native-unicode-output.md) also executes
0x40F/410 from the original image, retaining its UTF-8 conversion and CRT
semantics with explicit browser clipboard and diagnostic-window services.

Formatted file output `237` executes the original SDK `51BEE0` and game
`6508C0` wrappers against the per-game file store. Only the line argument uses
the VM formatter; the filename is literal. The original file helper seeks to
the last existing byte, then writes the formatted CP932 bytes and CRLF. A
two-profile KCS test covers creation, this overwrite on a second write after
restoration, read-only failure, and handle closure.

Module version query `1BC` executes the SDK `51B8F0` and game `6502A0`
wrappers and their complete version-string parsers. Both read the actual main
image name and localized `FileVersion` resource through
[Win32 version imports](native-windows-platform.md). Four original DWORD
writes preserve their order even when the VM destinations alias. A KCS
program covers the actual wrappers, live VM addresses and aliased output in a
fresh World on both fixed executables.

The [matrix/vector family](native-vector-matrix.md) executes all nine original
0x15E..166 wrappers and arithmetic helpers. Two-profile evidence includes
12,196 comparisons across VM regions, overlapping operands and native global
matrix restoration.

The retained image-data/animation wrappers 0x26E..271 execute their original
packet construction and share the Draw task. Both profiles have 1,100 complete
wrapper calls and 6,050 comparisons each; the SDK World test additionally checks
original ANM control, pixels and fresh restoration.

[Persistent bitmap memory and operations](native-bitmap-memory.md) use stable
original bitmap/wrapper identities, reference counts and a single guest pixel
backing. Seventeen game slots and sixteen SDK slots have 15,624 differential comparisons, with
separate strong/borrowed alias, Canvas, and fresh-World checks.

The thirty [screen-effect wrappers](native-effect-commands.md) have 72,096
transport comparisons across both engines. Their mask inputs share persistent
bitmap identities; actual task construction, independent mask clones and fresh
restoration have separate World coverage. The four
[screen-capture interfaces](native-screen-capture.md) retain the original view
recording state, GPU readback and BMP output, including recording counter wrap
and Script ownership.

The six [configuration queries](native-configuration-queries.md) execute their
original formatters, legacy sound classifiers and INT lookup. Both profiles
have 28,580 comparisons each. Guest archive and sound-tree records project the
same host configuration; the raw 24D Settings words retain their original
identity without a guessed higher-level meaning. The seven
[image transfer/attribute interfaces](native-image-commands.md) have 13,860
comparisons plus separate visible VRAM and restored-GPU coverage.

The seven [original bitmap factory interfaces](native-bitmap-factories.md) now
share complete native image wrappers and each Script's automatic list. Their
two-profile full-heap comparison has 4,898 checks, alongside real World loading,
cloning, fresh restoration and cleanup. The eighteen
[scalar math interfaces](native-scalar-math.md) also execute the original x87/SIMD
thread, with 28,524 comparisons across both builds and preserved rounding state.

The four [registry interfaces](native-registry.md) execute the original A/W
wrapper families with 112,788 comparisons. The browser's private HKCU hive uses
separate platform persistence; 914 isolated Wine API cases and 81,152 NT CP932
conversion inputs validate that boundary independently. Shared Win32 NLS
coverage is stated separately. Four additional
[plane and input interfaces](native-input-commands.md) have 3,686
comparisons plus independent-Top and fresh-World device coverage.

## Native call ABI

The second GCALL operand specifies the argument byte count. The VM first
subtracts those bytes from SP. A native's C return value is a control code:

| Code | Result and scheduling                                    |
| ---: | -------------------------------------------------------- |
|    0 | Suspend without a word result                            |
|    1 | Push the result word and continue                        |
|    2 | Continue without a result                                |
|    3 | Push the result word and suspend                         |
|    4 | Suspend without a result                                 |
|    5 | Restore the argument area and GCALL PC, then retry later |

Result words may contain integers, float bits, VM addresses or opaque handles.
GCALL itself does not assign those types. Code 1/3 requires an explicit word in
the host reply. The original GCALL initializes its result to `0xCCCCCCCC`; known
unwritten-return handlers preserve that word and its diagnostic. Other control
codes must not fabricate a result. Native argument reads can extend past
the bytecode's argument count into still-mapped stack memory. The SDK's 0x13B
callers provide one word although the wrapper reads a second frame word;
`machine.nativeArgument(index)` preserves that read instead of supplying zero.

VM address zero is a valid data address. Optional pointers become null only when
the original VM address conversion cannot map them. Opaque browser handles are
separate from guest pointers and use typed resource codecs for checkpoints.

## Implemented service families

The following modules implement their explicitly recovered contracts. Their
runtime integration and system-script acceptance are separate from module tests.

| Module                                                                                            | Contracts and boundaries                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [standard](../src/native/standard.mjs)                                                            | CP932 byte/string functions, parsing, memory, scalar math and explicit service bridges in 0x00..0x41. Clipboard, logging, file, random, clock and exit behavior require the corresponding service. Environment-dependent slots are dispatched separately.                                                            |
| [Script tasks](../src/native/script-task.mjs), [scene memory](../src/native/scene-memory.mjs)     | Script loading, execution gates, live message deque, debug/dump queries and distinct shared reader/history objects. [Contracts and explicit debugger boundaries](native-script-tasks.md).                                                                                                                            |
| [movies](../src/native/movie.mjs)                                                                 | Eleven native wrappers, original lifecycle/repeat/volume/position/rectangle/mode behavior and browser decoder sessions. DirectShow and browser GPU/media timing remain platform boundaries.                                                                                                                          |
| [bank](../src/native/bank.mjs), [expression](../src/native/expression.mjs)                        | 0xD1..0xD5, 0x261/262 and 0x292/293 share one variable bank and its registered 512-word private contexts. Expressions preserve eager logical evaluation, reference resolution and native assignment rules. Backup/restore copies `capacity` **bytes**, including partial words.                                      |
| [string bank](../src/native/string-bank.mjs)                                                      | 0x114..0x116 preserve stored bytes, existence results, exact `$str` scanning and terminators.                                                                                                                                                                                                                        |
| [system language tables](../src/native/global-strings.mjs)                                        | The SDK's single CP932 table and the game's ordered UTF16 tables retain their different file loading, prefix, duplicate and reload rules. They are independent of FES numbered strings and named word dictionaries. See [language contracts](native-global-strings.md).                                              |
| [configuration](../src/native/config.mjs)                                                         | Original four block layouts, startup/default/preferences fields, derived old-style volumes, author mode and variable capacity. Window configuration is getter-only in 0x167/168; additional FONT/KEY/SCREEN fields use the profile-specific shared configuration model.                                              |
| [sound configuration](../src/native/sound-config.mjs), [sound math](../src/native/sound-math.mjs) | SOUNDGROUP/MASTER/PART, immediate child inheritance, preferences, getters, filename/type/key selection and settings state; signed integer mixing, DirectSound attenuation and the 22,050 Hz loop-position special case.                                                                                              |
| [FES sound configuration](../src/native/fes-sound-config.mjs)                                     | `getsndconfex`/`setsndconfex` use the same native sound tree and configuration blocks. All 15 get and 18 set keys, profile-specific token parsing, selectors, resets and dirty/volume updates have original-engine differential coverage.                                                                            |
| [name table](../src/native/nametable.mjs)                                                         | All eight 0x279..280 wrappers use one original table, with profile-specific aliases, original filename matching/substitution and complete resource ownership. See [contracts and evidence](native-name-tables.md).                                                                                                   |
| [persistence](../src/native/persistence.mjs)                                                      | Ordered CSS entries, duplicate IDs, first-match reads, nested raw containers, variable/string data, timestamps and explicit storage services. This does not imply completion of object/camera/animation serialization.                                                                                               |
| [FES save slots](../src/native/save-slots.mjs)                                                    | All eleven original slot handlers use the system KCS global-file object, CSS disk files and shared storage. Versions, inclusive ranges, original sorting, file dates, annotation and exchange recovery have two-profile differential and fresh-World bank-restore tests. See [save contracts](native-save-slots.md). |
| [scene data](../src/native/scene-data.mjs), [history codec](../src/native/scene-history.mjs)      | Reader initialization (0xDB), explicit/implicit CST resources, block/line queries, raw/UTF-8/localized text, seen/path history, numbered-string snapshots and original history save records. System KCS remains responsible for interpreting commands.                                                               |
| [history windows](../src/native/history-cursor.mjs)                                               | All six 0x17B..180 interfaces share the live scene-data history, rotating independent readers, raw text/command extraction and handle lifetime. See [history-window contracts](native-history-cursors.md).                                                                                                           |
| [binary gallery tables](../src/native/gallery-tables.mjs)                                         | All twelve 0x195..1A0 interfaces use the original variant/name parsers, selector composition, query and release helpers in the shared process. See [table contracts](native-gallery-tables.md).                                                                                                                      |
| [tile-rules contexts](../src/native/tile-game.mjs)                                                | All 44 0x1D6..201 interfaces execute the original shared rule model, separate context vectors/event caches, initialization and cleanup. [Contracts and differential scope](native-tile-game.md).                                                                                                                     |
| [character names](../src/native/character-names.mjs)                                              | 0x252..255 parse name/group RGB assignments, comments, whitespace, partial headers, duplicate keys and direct/name-based lookups. Existing empty files create valid tables; missing queries preserve caller buffers.                                                                                                 |
| [dictionary](../src/native/dictionary.mjs)                                                        | Both 0x375..37D and 0x37E..386 expose ordered CP932 string-to-word maps, aligned raw export/import and indexed keys. Import merges without replacing existing keys and preserves caller padding bytes.                                                                                                               |
| [ordered maps](../src/native/ordered-map.mjs)                                                     | 0x2A3..2A8 share the same dictionary object and codec with 0x203/375/37E, including cross-family construction and destruction, default lookup, removal and reverse lookup. [Contracts and two-profile evidence](native-ordered-map.md).                                                                              |
| [compiled databases](../src/native/database.mjs)                                                  | Seven interfaces execute the original KCDB parser, index-name map, per-record flags, modification state and raw PE export/import. [Contracts and CSS/fresh-World evidence](native-databases.md).                                                                                                                     |
| [scene checkpoints](../src/native/scene-checkpoint.mjs)                                           | 0x3DF/3E0/3E2 use the original XML selector and shared variable/string banks for chained compressed path checkpoints. Signed position comparison and early-scene fallback retain their original rules. [Contracts and evidence](native-scene-checkpoints.md).                                                        |
| [task bridge](../src/native/task.mjs)                                                             | Task construction, destruction, messages, cross-task memory and kind/child/parent/existence queries. Root kind/parent queries retain the original unwritten/null boundaries as explicit diagnostics.                                                                                                                 |
| [engine messages](../src/native/engine-message.mjs)                                               | Base/Top routing, native task namespaces, untouched output words, shared data, original registration maps and recursive dumps. See [protocol and lifecycle contracts](native-engine-messages.md).                                                                                                                    |
| [input tasks and devices](../src/native/input.mjs)                                                | Main 0x90..9A, 0x11D/11E, 0x18B/18C and 0x191/193/194, independent Top task state, shared original physical device, region routing, text/cursor services and touch gestures. See [input contracts and evidence](native-input.md).                                                                                    |
| [resource preloading](../src/native/resource-cache.mjs)                                           | All five 0x1B2..1B6 interfaces share the ordered preload queue, immutable loaded bytes, separate lifetime/priority, signed thresholds and checkpoint state. File decoding and scheduling use explicit platform services.                                                                                             |
| [fixed-record stacks](../src/native/record-stack.mjs)                                             | All six 0x35F..364 interfaces: capacity growth before rejected pushes, signed count checks, complete-capacity copy, popped-tail preservation and typed handle restore.                                                                                                                                               |
| [image-data resources](../src/native/data-buffer.mjs)                                             | Shared 20-byte descriptors, separate heap references, borrowed memory, native image decoders and 0x16C/16D/16E/170/177/1AF. [Ownership and differential evidence](native-data-buffers.md).                                                                                                                           |
| [image persistence](../src/native/image-persistence.mjs)                                          | 0xF1 stores HG2 images in global entries; 0xFB reads the original automatically detected image encoding. Handles share the image subsystem's ownership and checkpoint model.                                                                                                                                         |
| [matrix bridge](../src/native/matrix.mjs)                                                         | 0xCC..CF call the original matrix helpers and share their process-global current matrix/stack. Both mapped guest matrices and native null-pointer global operations have differential evidence.                                                                                                                      |
| [text task bridge](../src/native/text-task.mjs)                                                   | 0x263..26D/2B7/374 transport configuration, formatted text, page/speed and image-font messages. Wrapper transport is verified independently of native font rendering; image-data resources share their ownership model with 0x26C. The full text command matrix remains a separate acceptance boundary.              |

The four [compiled content database families](native-content-databases.md)
cover 85 interfaces in 0x2E6..340, excluding the unrelated 0x311..316 slots.
Question/configuration pools, name selection, general KCDB columns and mission
conditions retain separate owners in the shared original-engine process. Their
complete wrappers have 20,734 comparisons per profile, including original
serializers and all reviewed condition-switch codes. Both canonical random
streams are bound directly to original globals, so native selection and browser
KCS/MOT/PTCL callers share live state through checkpoints and WASM growth.

[Argument decoding](native-arguments.md) covers 0x21B/21C with 8,596 comparisons
and 2,149 operations per profile. Expression-array decoding uses the current
variable-bank context; token offsets preserve original byte and space rules.

[Resource names and comma fields](native-resource-selection.md) cover 0x256/388
with 970 complete wrappers, 276 selector-helper calls and 7,332 comparisons per
profile. Raw base bytes, signed selector-leading bytes, exact `@` inheritance,
overlap and destination padding retain their original behavior.

[Image collections](native-image-owners.md) cover all 28 main wrappers in
0x2C6..2E1. Each profile has 754 complete original wrapper calls and 5,596
comparisons covering CPU image processing, attributes, ANM composition and
Script-owned reference lifetimes. Standalone checks keep device initialization,
VRAM presentation and task routing as explicit platform boundaries; they do not
establish final rendered-pixel equivalence.

[Section/key tables](native-section-tables.md) cover all three 0x2AB/2AC/2AD
interfaces, with 23,245 comparisons per profile. Repeated keys, source order,
original narrow bytes and preserved output-on-miss behavior remain distinct
from the other table and string-bank formats. Calendar 0x312 separately retains
the original signed weekday arithmetic, including nonstandard input dates and
CVTTSD2SI overflow, with 9,960 comparisons per profile.

[Task command envelopes](native-task-commands.md) add 0x28B/28D/28E/28F and
exercise existing draw 0x291, with 625 complete calls and 2,500 comparisons per
profile. Target zero, missing targets, two-profile message numbering and raw
formatted bytes use the caller's real Top namespace and existing receivers.

The game-only [record queues](native-record-queues.md) add five recovered
declarations, backed by 1,680 original wrapper operations and 5,040 comparisons.
The [E-mote bridge](emote-compatibility.md) contributes 37 independently reviewed
game-wrapper declarations and full original DLL integration. Their conservative
catalog names identify original task message numbers or global commands where
an original symbolic name is unavailable. Actual GCALL argument lengths remain
separate from words read through the native argument pointer. The SDK retains
its independently established reserved/zero behavior for these slot numbers.

The ordered-map wrappers have 4,000 original-engine comparisons per profile,
including 1,889 operations each across the four constructor families. The compiled
database wrappers add 3,089 comparisons per profile. Scene checkpoints have
7,965 comparisons and 260 complete wrapper calls per profile; those checks
compare restored state and interoperability rather than claiming identical
compressed bytes for uninitialized original string padding.

[Configuration fields](../src/native/config-fields.mjs) retain CP932 font/key names and
36-byte key records for SDK 2.6.1.74, versus UTF-16 names and 40-byte records for
2.6.1.76. Font candidates are selected through the host's installed-font service;
missing availability information does not make every candidate valid. Font weight
shares a word with the third `font.shadow` entry. Startup supports eight mapping
families; saved key preferences update only enabled rows and preserve touch maps.
The game build's continuous language list stops at the first zero code. Its UI,
main and subtitle indices, system-language match and saved-index fallback remain
one live state. Dynamic language selection is absent from the fixed SDK build;
its separate fixed `language.txt` system translation table remains supported.
Screen startup chooses a supported size by desktop aspect, format and refresh
rate; saved fullscreen settings require an exact format/rate mode. The display
service supplies actual browser capability data, separately from this parser.

[Configuration memory](../src/native/config-memory.mjs) maps those same arrays
into the shared original-engine process. Settings is an interior pointer into
one Engine allocation: +528 in the SDK and +1,048 in the game build. Font/key
bytes, configuration blocks, system-voice flags, variable ranges and scalar
fields synchronize in both directions. The language vector contains UTF-16
strings and accelerator records; its startup language identities remain in the
canonical configuration. Unknown Engine fields are preserved. `screen.fullscreen`
(WINDOW/fullscreen) and `screen.fullSize` (FULL_SCREEN/full_size) have distinct
addresses and meanings. Main 0x2E5 uses the former as its condition.

Texture startup configuration retains tile size, grid dimensions, eight
four-word regions and the two depth-dependent Y offsets. The constructor uses
256-square tiles, an unassigned zero grid, all-ones region sentinels and zero
Y offsets; game-specific startup values replace those fields. The shared memory
codec preserves the same 152-byte block across native and browser services.
Device-capability adjustment and rendered texture paging require their own
graphics evidence. `APP/title` likewise remains one live configuration string,
with profile-specific raw encoding and storage.

Main 4 returns `timeGetTime` milliseconds through the explicit clock service.
Main 5 returns the task's effective clock minus accumulated paused frames, and
main 7 returns its frame rate. Variable-range native 0x316 retains eight local
and eight global start/count pairs, including unassigned 0xFFFFFFFF sentinels.
System-voice reads/writes preserve adjacent mapped words; random selection uses
one shared integer draw only when at least one of the 48 flags is enabled.

[Native sound tasks](../src/native/sound.mjs) implement the original load/play,
release/pause/stop, group allocation, linked crossfade banks, per-task loop tables,
PLV/tag resources, level queries, fades, pan/position and task checkpoints. The
SDK uses 32 hardware banks with 120-byte controls; the game uses 64 banks with
140-byte controls and additional level/crossfade branches. Device banks are
shared while each task retains its own control data. [FES sound objects](../src/native/fes-sound.mjs)
use those same tasks and banks, including SOUND/SNDTABLE selection, queued loads,
volume mixing, source-address effects, zero-initialized KX2 state and real motion
scripts. Tables preserve enabled rows, selection order and the original 2,000-draw
shuffle. Original type filters precede user SUBCOMMAND lookup. Browser device
acceptance remains separate from these control/state comparisons. Original wrappers with uninitialized return
words (including 0x24C) report an explicit error instead of inventing zero.

The older configuration blocks and the soundconf tree are independent state.
0x3AA reports whether the configured soundconf file was opened; it does not report
parse success and is not a profile constant. Sound selection is parent-first:
filename lookup uses a nonempty `head` prefix, type lookup compares `type`, and
key lookup compares the lowercased node key. ID-path missing values differ between
the two fixed builds and remain profile-specific.

FES sound configuration accepts `volume`, `play`, `sysplay`, `mute` and
`voicebgm`, each with plain, `_id` and `_type` forms; setters also accept the
three `reset` forms. `voicebgm` selects the tree's `voicevol` field. Plain
selectors remain strings, including numeric-looking names; only `_id` evaluates
the remaining expressions. Exact lowercase `master` is special for volume,
play, mute and reset, but not sysplay or voicebgm. Getter type lookup folds the
query case; setters compare type names exactly. Reset restores five fields and
preserves skipvol. An unknown getter preserves its output variable. Known
plain/type setters missing their selector return early; unknown setter fields
still mark the shared configuration dirty and derive its older volume block.
No synthetic configuration value is supplied by the FES host.

The sound facade preserves original token boundaries: parentheses retain whole
expressions, including spaces. The game lexer also handles quotes and its
temporary token list's NUL boundaries; SDK quotes remain ordinary bytes.
Numbered-string expansion is a single pass, including signed/hex indices.
Destination/value expressions execute once, before field validation. The facade
owns no copy of the configuration and continues to use its restored backing.

The root startup `SOUNDCONFIG` leaf supplies the resource and user-preference
filename, which defaults to empty. The x86 readers at SDK `5C5EF0` and game
`7150B0` load the mounted XML and then read the optional same-named preference
file from the virtual user directory. Configuration queries keep the original
map and recursive record allocations and synchronize the six mutable values.
Saving settings writes `setup.xml` and recursively saves
volume/play/sysplay/voicevol/skipvol/mute to the separate sound document. The
writer preserves native insertion order, CRLF indentation and profile encoding.
A missing mute preference uses the sysplay default. A malformed resource sets
the native file-existence flag and leaves numeric record initialization undefined.

Both original engines resolve `DirectSoundCreate8` through ordinal 11. The
virtual playback device exposes the primary `IDirectSoundBuffer` used by the
SDK `4AA3F0` and game `5CD370` initializers. Both routines set 44,100 Hz,
16-bit stereo PCM after selecting priority mode. The cooperative level,
format and COM references survive a fresh restore. This boundary covers
primary PCM negotiation and the native startup worker. Gameplay audio
continues through the browser sound task and Web Audio. [DirectSoundCreate8](<https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee416762(v=vs.85)>),
[SetFormat](<https://learn.microsoft.com/en-us/previous-versions/windows/desktop/mt708936(v=vs.85)>).

DirectSound percent 50 maps to -1,000 hundredths of a decibel, not a linear gain
of 0.5. Loop positions are passed as signed 64-bit sample-frame positions; native
playback halves start and nonnegative end at 22,050 Hz and leaves other rates
unchanged. Updating loop positions during playback uses the original separate
path without that halving rule. The original end-to-byte conversion multiplies
by channel count and bytes per sample. [Sound values](../src/native/sound-values.mjs)
also preserve channel attenuation, 3D pan coordinates, codec-specific query units
and legacy archive/head classification. Native PCM levels average absolute
successive-frame differences; they do not measure RMS amplitude.

The scene reader queries **block and line within block**. A negative block in a
type query returns block count; a negative line returns that block's line count.
Text queries use the reader's current coordinates for negative arguments. CSTL
language prefixes come from startup configuration. Translation lookup uses block
ordinal; only the first text line in a block emits the joined translated text.
0x40D/40E preserve UTF-8 output bytes instead of encoding them back to CP932.

History exports use a zero header followed by 48-byte records and 72-byte string
snapshots. The original 40-byte imported layout is also supported. Duplicate
snapshot keys retain order and first-match reads. Imported unused byte tails are
preserved; new web records initialize unused bytes to zero. The original seen
history importer reads extra data from the companion path buffer. A null or
unmapped source is an explicit error, rather than a corrected invented save file.

## Verification

Resource preloading preserves the distinction between mutable lifetime and
the priority captured at insertion. Duplicate names reset only lifetime.
Start sorts priority as signed ascending, with stable equal-priority order.
Age decrements lifetime, drops records whose resulting sign bit is set, then
decrements surviving priorities and progress with 32-bit wrapping. INT_MIN
therefore wraps to INT_MAX and survives. Completion compares a signed threshold
with signed progress. The original worker marks missing files loaded, advances
progress at lifetime group boundaries and writes INT_MAX when it reaches the
list end. `scripts/verify-native-resource-cache.mjs` reproduces these state
transitions through the two pinned engines.

Authored contract tests cover the implemented native-family modules and their
runtime integration. Input task/device coverage is listed separately in
[its contract](native-input.md).
Private oracles map the pinned PE image into a freestanding x86 executable and
call the original recovered functions. Their inputs, binaries, IDA databases and
raw outputs stay under ignored `.local/` storage. No game assets or decompiler
bodies are included in public tests or documentation.

| Private differential scope           | Successful comparisons | Limits                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard functions                   |                    410 | 51 additional authored cases could not run through CRT/TLS dependencies; they are not counted as passed.                                                                                                                                                                        |
| TSV parser                           |                     15 | Parser executed directly; surrounding browser I/O is covered separately.                                                                                                                                                                                                        |
| Configuration                        |                    242 | Constructors, field readers, mixing and complete block copies; authored XML lookup callbacks do not verify XML syntax parsing.                                                                                                                                                  |
| Text/key/setup fields                |                    642 | Both original constructors and field readers, complete font/key/system-voice bytes; XML/font registry/host text callbacks are explicit.                                                                                                                                         |
| Configuration ranges                 |                    120 | Both original 0x316 wrappers and VM pointer conversion, including aliased output addresses and invalid unsigned indices.                                                                                                                                                        |
| Configuration scalar/voice wrappers  |                  1,088 | Both builds' getters, fullscreen/multi-window condition and system-voice read/write/random selection. Full Engine bytes, result/control and RNG draw count; RNG words are authored inputs.                                                                                      |
| Shared configuration memory          |                    326 | Codec push, both original FES field dispatchers and codec pull; complete observed byte projection. Host parser, expressions, variable/string banks and queued events are boundaries.                                                                                            |
| Registry wrappers                    |                112,788 | Two profiles, 9,398 complete wrappers/56,394 checks each. ADVAPI32 is separately checked against 914 pinned Wine cases; NT CP932 against 81,152 conversion inputs. Shared name-conversion NLS remains an explicit boundary.                                                     |
| Plane and input wrappers             |                  3,686 | Two profiles, 388 calls/1,843 comparisons each, plus separate Graph rectangle, bitmap-mask/device ownership and fresh-World coverage.                                                                                                                                           |
| Language prefixes/updates            |                     60 | Original game-only 0x40C/41D wrappers, fallback indices, single terminators, dirty marker and PostMessageW packets. Windows text conversion is a host boundary.                                                                                                                 |
| Global language tables               |                  8,040 | SDK 3,928 and game 4,112 comparisons of original file loaders, parsers, complete maps and prefix lookup; game also covers original filename helpers. CRT, file I/O and Win32 NLS are explicit boundaries.                                                                       |
| Frozen game language resources       |                  1,855 | Additional native i386 ELF execution compares both complete language maps (934 Chinese/921 English entries) and every corresponding lookup; no proprietary table text is distributed.                                                                                           |
| Texture startup configuration        |                    322 | Both constructor field regions and complete startup TEXTURE field-reading regions, all 152 bytes. Entry/exit frames, XML field lookup and sprintf are explicit boundaries.                                                                                                      |
| Texture caps/layout/upload           |                  3,048 | Both profiles, 1,524 each: original capability adjustment, power-of-two allocation layout and complete scalar/MMX ARGB4444 uploads. Device rendering acceptance remains separate.                                                                                               |
| Mesh coordinates                     |                  1,220 | Both profiles, 610 each, original graph coordinate transforms/vertex layout and 0x157/158/159 wrappers. This does not establish browser rasterization equivalence.                                                                                                              |
| Display mode selection               |                  1,120 | Both original startup normalization and setup exact checks; authored mode tables, no function stubs reached.                                                                                                                                                                    |
| Variable bank                        |                     32 | Complete state and byte copies, including odd capacities.                                                                                                                                                                                                                       |
| Variable-bank contexts               |                    852 | Both builds, 426 original constructor/map/accessor/expression and 292/293-wrapper comparisons each. Every registered context's 512 words, names, selection and global dirty state are compared. World lifecycle integration has separate tests.                                 |
| Integer expressions                  |                    698 | Result, dirty flag, global and private words. A float-token CRT probe failed and is not counted.                                                                                                                                                                                |
| String expansion                     |                    144 | Original scanner/parser/copies; tree lookup supplies authored entries.                                                                                                                                                                                                          |
| CSS container                        |                    100 | Random append/remove sequences; raw process-pointer word normalized.                                                                                                                                                                                                            |
| Global-file wrappers                 |                  2,596 | Both profiles, 1,298 each: actual create/write/remove/clear/clone/release wrappers and complete payload/capacity/tag bytes. Clear preserves tag and resets capacity; clone preserves used content and capacity.                                                                 |
| Sound tree                           |                  2,880 | 1,440 per build; original mixing/selectors/ID getters against authored record trees, not XML parser coverage.                                                                                                                                                                   |
| FES sound configuration              |                  5,616 | 2,808 per build: 2,661 full get/set/tree/epilogue cases and 147 original lexer cases. Token expansion, numeric expressions and global-bank writes are explicit boundaries of the dispatch probe; the raw lexer is executed separately.                                          |
| Base/Top engine messages             |                  2,775 | Game 1,387 and SDK 1,388: original constructors, maps, routing, factory, dumps, unregister and frame sweeps. INPUT/SOUND device construction calls the original Base constructor; real device behavior is a separate boundary.                                                  |
| Sound attenuation                    |                  2,089 | Original log10 and float operation order; only DirectSound SetVolume is intercepted.                                                                                                                                                                                            |
| Sound pan/spatial values             |                  1,057 | Original pan/coordinate/decoder scalar paths; device calls intercepted where necessary.                                                                                                                                                                                         |
| Legacy sound classification          |                    186 | 93 per build; original filename/directory/head classification, no function stubs.                                                                                                                                                                                               |
| Legacy sound group classification    |                    186 | Both original group classifiers retain the separate raw-byte basename scan and CP932 directory scan. No function stubs.                                                                                                                                                         |
| PCM level arithmetic                 |                    270 | Original scalar/SSE2 paths with authored 8/16-bit mono/stereo PCM; no function stubs.                                                                                                                                                                                           |
| Native sound task                    |                  1,384 | 816 game + 568 SDK comparisons, complete controls/device state/message packets; device I/O, clocks, base task and allocation callbacks supplied by the harness.                                                                                                                 |
| FES sound frame updates              |                  1,080 | Both original updates with complete object bytes and native task packets; configuration/category queries, task transport and clocks are explicit boundaries.                                                                                                                    |
| FES sound command handlers           |                  2,856 | Every game/SDK object command handler with both sound types, selected/whole-group contexts and multiple argument counts. Another 24 original NULL faults match explicit diagnostics and are not counted as successful executions.                                               |
| FES sound tables                     |                    896 | Both original selection, repeat, reverse and shuffle algorithms with complete record/order/object bytes; authored RNG words supply the host boundary.                                                                                                                           |
| Shared FES motion builders           |                  2,560 | Both original arc/pend/blend builders through their motion-add boundary, with complete register words, filenames, group and delay. Curve execution is covered separately.                                                                                                       |
| Sound preference documents           |                     65 | Both full original writers and recursive readers, including signed values, nested/duplicate paths and native XML serialization. SDK non-ASCII tag parsing remains unresolved pending its CRT locale environment; that reader case is excluded.                                  |
| Character name tables                |                  8,712 | Both original constructors, comment/line/header parsers, first-insertion maps and name/group lookups. Only allocation/free/copy/clear are supplied.                                                                                                                             |
| Ordered dictionaries                 |                  3,296 | Both sets of nine original main wrappers in both builds, complete keys/words/padding/merge/enumeration behavior; allocation, formatting and pointer conversion are explicit boundaries.                                                                                         |
| Task clocks/queries and FES bridge   |                  2,336 | Both original task-clock/query wrappers and FES notification/local/sleep/named-word packaging; undefined root queries remain diagnostics.                                                                                                                                       |
| Main matrix bridge                   |                  1,924 | Both original wrappers and matrix helpers, complete guest/global matrix bytes and fresh process restore.                                                                                                                                                                        |
| Main text bridge                     |                    416 | Both profiles' thirteen original wrappers, control/result words and complete formatted message packets. Font rendering and image-data resource creation are separate dependencies.                                                                                              |
| Legacy text/draw tail wrappers       |                    144 | Both profiles, 72 calls each: original 187/1C8/1D0 wrappers, pointer payloads, control/word output and messages 119/120/300 with SDK normalization. Full task/render acceptance remains separate.                                                                               |
| FES main bridge                      |                    704 | Both profiles' 22 original wrappers, including dynamic object initialization, private-context copies, named values and image-data assignment. This does not replace FES handler/lifecycle evidence.                                                                             |
| Input task and physical callbacks    |                  3,874 | Both profiles, 1,937 each: original constructor, messages, region ordering, key queries, routing/frame code, physical callbacks, all 15 main wrappers and canvas alpha masks. Window, renderer, transport and dialog thread are explicit boundaries.                            |
| Input controls                       |                  5,796 | Both profiles, 2,898 each: original 0x191/193/194 wrappers, source, cursor/key-gate messages and output preservation. Actual cursor drawing is a separate acceptance item.                                                                                                      |
| Resource preload queue               |                  1,206 | Both profiles, 603 each: all five original main wrappers plus original queue/list sort/age/threshold/worker, complete order/state/bytes and progress at each I/O boundary. Formatting, category lookup, mounted files and OS mutex/events are explicit boundaries.              |
| Fixed-record stacks                  |                  1,672 | Both builds, 836 complete original-wrapper comparisons each: result/control, descriptor fields, every initialized capacity byte, caller VM bytes and heap release. Unspecified new tail bytes are explicitly authored inputs.                                                   |
| Image-data ownership and consumers   |                  1,678 | Both builds: 303 allocation/load/release cases and 536 original bitmap/metadata wrapper, font-transfer and authored-pixel comparisons each. KCS formatting, VM translation, mounted files and platform services are explicit boundaries.                                        |
| Raw engine heap and CSS bridge       |                  7,184 | Both profiles, 3,592 each: actual 0x341..344 wrappers, hidden heap references, copied CSS bytes, output preservation, NULL/missing resources and zero-sized allocations. Raw PE addresses remain separate from VM addresses and handles.                                        |
| Native image codecs                  |                  4,768 | Both profiles' HG2/BMP/KCF/KCLZ paths, including codec bytes and complete crop/transparent-image conversion. Main F1/FB wrapper bodies are separately recovered statically.                                                                                                     |
| CST reader                           |                    307 | Original type, raw text, message count and block count; complete destination buffers. No function stubs.                                                                                                                                                                        |
| History export                       |                    220 | Original serializer, both lists, extra-data options and complete buffers; only memcpy is replaced.                                                                                                                                                                              |
| History import                       |                    220 | Original importer including companion-buffer extra data; complete records and raw tails, with allocation/copy host callbacks.                                                                                                                                                   |
| Scene-history windows                |                 35,430 | Both profiles, 17,715 comparisons over 4,369 wrapper operations each: all six interfaces, original history/CST readers, complete initialized reader/slot/VM bytes and destruction. Three unwritten reader words before first load are explicitly excluded.                      |
| Binary gallery tables                |                 53,230 | Both profiles, 26,615 comparisons over 3,800 operations each: complete original wrappers versus the native adapter, all parsed bytes/refs, VM canaries, filenames, diagnostics and settled heap deltas. Formatting/handles and mounted I/O are explicit boundaries.             |
| Built-in tile rules                  |                219,216 | Both profiles, 109,608 comparisons over 6,082 complete wrappers each: all 44 interfaces, shared global/context/vector state, two/four-player event sequences, VM buffers, heap ownership and destruction. Authored clients exercise 47 events, not every rule/hand combination. |
| Script event/attachment protocol     |                  1,448 | Both original receivers and actual KCS continuations; queue insertion is an explicit capture boundary.                                                                                                                                                                          |
| Script lifecycle                     |                  6,256 | Both original constructors, file loads, frames, real queues, dumps and failed/same-name replacement loads. Eight uninitialized source queries per profile are excluded. See [Script evidence](native-script-tasks.md).                                                          |
| Script notification transport        |                    256 | Both original 23A/B/C wrappers through complete upward and packet routing to Top/Script/Base; output-word preservation and nullable raw pointer dereference.                                                                                                                    |
| KCS debug symbols                    |                  3,732 | Both original 66–68 opcodes, CALL/RETURN function/scope containers and Script descriptor queries. Container initialization is authored; 34 undefined frame reads per build are excluded.                                                                                        |
| GCALL sentinel results               |                  1,332 | Both complete original GCALL handlers, preceding real identity writes, actual 8C/8E/225 wrappers, full VM memory/frame and diagnostic counts. Only the logger is intercepted.                                                                                                   |
| VM allocation/translation            |                 14,292 | Both profiles, 7,146 comparisons each: 252 complete 1B/1C/ED operations and 600 original inverse-address cases per build; zero-sized nodes, shared aliases, complete block bytes, list count and hidden heap references. VM initialization is authored.                         |
| Native byte formatting               |                 15,256 | Both complete original 876EA0/8A6510 formatters and CRT sprintf, 7,628 per profile: flags/width/precision, floats, L/G/H, recursive strings and raw UTF8/CP932/invalid bytes. No formatter or CRT substitution.                                                                 |
| Configured script replacement        |                  1,188 | Both actual 3EA wrappers/helper, raw keys/values, ordering, aliases and caller canaries. XML-to-map loading is measured separately below.                                                                                                                                       |
| Script replacement startup loop      |                     66 | Both original XML-to-map loading loops, 33 per profile, including the game UTF8 versus SDK CP932 raw source bytes.                                                                                                                                                              |
| Plain-text extraction                |                    624 | Both original 188 wrappers and parser/extractor, 208 per profile, plus 208 game-only UTF8 419 comparisons. Font rasterization is not inferred from text extraction.                                                                                                             |
| UTF8 truncation and CP932-key search |                  1,392 | Game-only 415/416/41B wrappers and original permissive byte walker through the live VM-memory bridge. This is not a claim of standard UTF8 validation.                                                                                                                          |
| MOT checkpoint serializer            |                  1,536 | Both original serializers and 13C capacity reuse, 768 per profile, including record byte layouts and retained tails/padding.                                                                                                                                                    |
| Space-group token selection          |                  1,944 | Both original 207 wrappers and group parser, nested/literal groups, aliasing, unsigned indices and complete caller buffers.                                                                                                                                                     |
| Native movie lifecycle               |                 11,688 | Both profiles, 5,844 each: original eleven wrappers, constructor/play/stop/repeat/volume/position/rectangle/mode/destructor. DirectShow/window/device interfaces are explicit boundaries; browser media acceptance is separate.                                                 |
| Steam native bridge                  |                    434 | Game-only complete 411..414 original handlers, argument/control/output and Steam service calls. Browser transport/service and persistence are explicit platform boundaries.                                                                                                     |
| Window broadcasts                    |                    267 | Original game 5AEDC0/530200/530EB0 and main41E notification packets, including their window transport boundary.                                                                                                                                                                 |
| Motion checkpoint wrappers           |                  6,214 | Both profiles, 3,107 each: 183/184 wrappers, original CSS/copy/release; MOT restore is an explicit boundary and is not a serializer-equivalence claim.                                                                                                                          |
| Generic/MOT numbers                  |                  2,160 | 45 slots × 24 cases × 2 builds; return/control and complete guest memory. Stage rendering acceptance is separate.                                                                                                                                                               |

The inventory script is read-only and verifies pinned hashes before inspecting
tables:

```sh
node scripts/native-audit.mjs --fixture-root /path/to/fixture --corpus --output .local/native-audit/inventory.json
```

Full original function semantics, SDK coverage, native object messages, fonts and
text layout, complete native window/menu interaction, browser sound output,
system-script initialization and all game modes still require their own evidence.
The overall implementation remains in progress while any necessary contract or
acceptance item remains unresolved; see [completion requirements](completion.md).
