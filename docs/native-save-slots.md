# Native save slots

The eleven FES save commands use JS-owned global-file containers and the existing per-game IndexedDB file storage. System KCS binds the typed container through `1C3` and FES exposes `_SAVEOBJ_`. `datasave` serializes that container directly, with its CSS tag and ordered entries. Missing or zero object arguments preserve the files. There is no remaining global-file projection for these commands. [Implementation](../src/native/save-slots.mjs).

With an empty context, both native handlers form a drive-rooted filename
such as `\save0001.dat`. The Win32 boundary resolves it at the mounted
game's virtual drive root regardless of the current directory. Both native
save scans and CSS writes are exercised with this context; they use the same
per-game store as relative paths.

| FES command     | Original behavior                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `datasave`      | Write the supplied global-file object to `save%04d.dat`.                                                                               |
| `saveexist`     | Write missing/present/version-mismatch status to a global variable; optional unsigned tag range.                                       |
| `savedelete`    | Delete the slot file through the original file helper.                                                                                 |
| `savecopy`      | Check the source, delete an existing destination, then copy.                                                                           |
| `saveexchg`     | Move a lone file, or use temporary copies and the original recovery sequence when both exist.                                          |
| `newsave`       | Scan the inclusive slot range by last-write FILETIME. Equal dates retain the first scanned slot; an empty range writes `-1`.           |
| `sortsave`      | Sort an inclusive range with the original comparator and sort routine. A range containing fewer than two slots preserves destinations. |
| `sortsave2`     | Sort the explicit slot list with the same original routine.                                                                            |
| `saveapend_str` | Replace the first matching entry with a parameter string, then write while retaining the file's modification time.                     |
| `saveget_str`   | Copy a found entry into the live numbered string bank. Missing files/entries preserve the previous value.                              |
| `saveget_date`  | Read local calendar fields from a CSS file's last-write time. Missing files preserve output variables; `-1` destinations are skipped.  |

The string annotation retains the original `strlen + 4` stored size. JS initializes the three originally unwritten tail bytes to zero. Differential comparisons exclude only these undefined values and preserve the terminator, declared size and every defined entry byte. The original empty-payload writer also reads eight bytes beyond its 16-byte allocation. Its reader ignores this tail when the declared payload size is zero, so comparisons retain that header and file size while excluding the undefined tail. Nonempty CSS files compare exactly after accounting for the annotation tail.

The reviewed common command tables contain no `dataload` handler. System KCS
loads the CSS container with `0xF7`, then restores its variable, string, history,
motion, image and other entries through their respective native interfaces.
The generic browser save store does not implement this protocol.

Static call-site evidence in both frozen `sscript.kcs` files establishes
container preparation, `0x1C3` binding and `0xF5`/`0xF7` file access. Original
helper execution, adapter differential checks and full system-client tests are
separate evidence levels; none alone establishes complete save-screen or
whole-title acceptance.

Embedded hosts can pass `gameSave: null` to `CatSystem2.initialize` to track
committed native saves. To open a selected version, pass its native file list
with the original creation, access and modification times and file attributes.
The core validates the CSS files before starting the guest and opens the
selected slots in a launch-local view. The normal game Load menu reads that
view. Its writes remain in that view for the host to synchronize, and local
account slots stay available to fresh launches. The read-only
`importedGameSaveRevision` is the selected view's revision before the guest
starts. The host uses this value to acknowledge the import so that any saves
written during startup count as new progress. Fresh launches return `null` for
this property.

`gameSaveStatus()` reports whether the game has committed a loadable slot.
The status reports `busy` from the first read or serialization of a slot
change until that operation finishes. Hosts can export once the slot and
index files settle.
`exportGameSave()` returns the slot files and their associated `savegen.dat`
indexes while a slot is present. A save list can contain up to 4096 files and
64 MiB of file bytes. CSS records are validated before the guest loads them.
Each file can expand to 64 MiB and contain up to 262,144 CSS records. Together
the files can expand to 256 MiB. Embedded hosts persist the returned file list
in their own save transport. The standalone browser continues to offer
`.cs2save` checkpoints through its existing controls.

`scripts/verify-native-save-slots.mjs` compares the JS implementation against independently executed original handlers, CSS and filesystem helpers. The default bounded sequences cover all eleven commands and exchange/copy/delete failure steps in both ABIs. `CATSYSTEM2_EXTENDED=1` enables the larger sample. File metadata, complete ordered entries, global/string writes and file-operation sequencing are compared after every operation. Tokenization, numeric evaluation and bank access are explicit fixture boundaries.

The existing system-client tests bind a container through `1C3`, execute FES `datasave` and restore variable/string entries through `F7`/`FA`/`FD` in a new World. Public browser acceptance additionally writes CSS and a World checkpoint to IndexedDB, reloads the document, reopens storage and restores both CSS banks and a scene-local checkpoint through normal dispatch. Node cannot cover document replacement or browser transactions. [Differential](../tests/differential/native-save-persistence.test.mjs), [browser acceptance](../tests/browser/public.spec.mjs).

## SDK 2.6.1.23 data containers

The loaded Script regression in [sdk23-global-css-data.test.mjs](../tests/sdk23-global-css-data.test.mjs)
covers Main238/240/242–248/250/252–254 with two nonempty containers,
caller variable and CP932 string banks, nested bytes, duplicate IDs and new
file readers. Entry writes append; reads retain the first matching ID. Changing
the source memory and releasing the source container leave the saved copies
intact. Caller-relative output spans preserve their surrounding bytes. Four
independent cold restores retain live containers and subsequent VM consumption.

The original producer uses intact native bodies and the qualified CRT,
FileServer, ApplicationRoot and typed Script. Its controlled OS memory-file
port records copied writes; this proves the CSS writer/reader format and owner
lifecycle, not physical Windows disk storage or platform GAME_SAVE transport.
Comparisons exclude the ignored process pointer in nested raw headers and the
string serializer's eight unwritten trailing bytes. The original lookup scans
allocated capacity; this corpus uses present records and does not establish
defined results for absent IDs in an uninitialized tail.

Main241 stores an HG2 image entry; Main251 decodes it into a separate,
Script-owned bitmap. A normal four-stage case covers authored asymmetric
RGB24/RGBA32 resources, source mutation/disposal, a CSS writer and fresh reader,
container disposal, subsequent bitmap mutation and explicit release. The ordinal
loader already expands RGB24 before Main241. A separate raw-byte HG2 RGB24 entry
therefore exercises Main251's own conversion: the resulting bitmap has four-byte
pixels with opaque alpha. This conversion is shared across the five supported
builds; the SDK23 execution and the other builds' wrapper/conversion-body evidence
are separate qualifications. No version capability flag is needed.

[sdk23-global-css-images.test.mjs](../tests/sdk23-global-css-images.test.mjs)
checks all image pixels and defined geometry, six independent cold continuations
and the other four builds' current VM bridge. Compressed HG2 representations can
differ while decoding identically. These cases do not establish arbitrary image
formats, GPU presentation or additional CSS task-tree layouts.

## SDK63 Scene and CSS owner consumers

The SDK63 Scene/CSS consumer fixture runs real parsed writer and reader Scripts
under independently initialized owners. Normal variables, backup/restore and
expressions, copied byte records, numbered strings, nested containers and Scene
history reach the native CSS stream and a fresh reader. Source buffers and
owners are replaced or released before later consumers run. The restored
history filename loads the changed CST resource, while captured strings retain
their earlier bytes.

This build uses the existing 40-byte history records and 72-byte string pairs.
Raw-data transfer is qualified for allocations returned by the owning API;
arbitrary physical pointers and borrowed Scene trees remain outside this group.
No time value is inferred from an uninitialized CSS record.

Seen-name query strips the filename extension. The raw seen-alias operation
matches its source key as given: `owned.cst` misses a stored `owned`, while
`owned` to `alias` is observed by the later `ALIAS.cst` query. The source file
owner can be released before that alias, clear and final Scene disposal.

The original full writer prefix and its observer failure are retained separately
from the minimal normal writer/independent-reader completion. Current tests also
consume the actual native CSS bytes and preserve live owners across checkpoints.
This qualifies the finite typed data/virtual-file contract, without changing
GAME_SAVE layout, enabling physical trees, or claiming full Application startup.

The SDK63 records consumer group adds an authored CGL and real CST text as
producers for CG registration and a nonempty display log. The existing six-DWORD
log-block layout is retained. A new CG/log owner reads the native CSS after the
original owners are cleared or released; replacing CGL/CST sources does not
replace saved registration keys or speaker data. A later parsed Scene can append
new text, then log clear is observed by a subsequent speaker read.

Fixed-record stack copying uses two fully initialized eight-byte records before
pop/copy and source disposal. CSS stores the popped byte spans; the independent
reader reconstructs and consumes their LIFO order after releasing the file.
Unused or uninitialized capacity is not generalized. Existing SDK63 cursor and
gallery/name/variant groups are reused within their previously recorded typed
owner, finite-capacity and resource-layout boundaries, without replaying them.
