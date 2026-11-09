# Native FES task protocol

`createNativeFESTask` owns one FES interpreter, its private variable context,
string-bank reference, retained surface, display state and image-data cache.
KCS calls use task messages through the World's Top-scoped router. They do not
call a menu selected by a game filename. The complete original task handler is
still being audited; this document distinguishes the implemented message
contracts from the remaining controls and parser work.

The reviewed task handlers are game `62C480` and SDK `503930`. The World's
internal message numbers use the game convention. SDK FES messages starting at
raw 326 correspond to game 331; SDK bank queries 174/175 correspond to game
176/177. The lower common task messages keep their independently recovered
numbers.

| Canonical messages | Behavior and limits                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3                  | Set the private `_EXITCODE_` to -1 and send sound-bank message 210 before the base destruction request; actual resource release remains deferred.                                                                                                     |
| 9, 10, 64, 65      | Use the receiving FES's native button/low-button mapping and its Top's input task. Original scroll/slider tasks own their separate button children.                                                                                                   |
| 19                 | Run original object configuration callbacks, notify `MES_CHANGECONFIG`, update sound configuration state and invalidate original text fonts.                                                                                                          |
| 25, 26             | Read/write the inherited CP932 context name through sender memory; leave the result word untouched.                                                                                                                                                   |
| 27, 28             | Original scroll/slider child tasks update the matching value, execute SCRL_P and deliver FOCUS/UNFOCUS.                                                                                                                                               |
| 176, 177           | Write the inherited global/string-bank handle through `lParam`; leave the result word untouched.                                                                                                                                                      |
| 331, 332           | Initialize the interpreter and load its source. An empty or absent file sets task exit code -2 while retaining the initialized private context. Other parser failures remain explicit.                                                                |
| 333, 334           | Force a FES update and bind its retained rendering surface through the task graph. Surface IDs are resolved in the sender's Top.                                                                                                                      |
| 335, 336           | Select an existing label and set `_SAVEOBJ_`. Only label selection writes a result word.                                                                                                                                                              |
| 337                | Execute an immediate notification, synchronize objects, and honor `force_redraw` when awake.                                                                                                                                                          |
| 338, 339           | Dynamic object declarations and `#OBJECT` rows. Replacing live groups and some definition columns still need original parser coverage.                                                                                                                |
| 340, 341           | Select this FES's private context before scalar access. Indices outside unsigned 0..511 read zero and ignore writes.                                                                                                                                  |
| 342                | Retain the raw sleep value, issue sleep/wake notifications and suppress this FES's logic while asleep. The original raw receiver reports unhandled and leaves the output word untouched.                                                              |
| 343, 344           | Query/export 2048 bytes or import a partial prefix; import can select `_LOAD_`. These original helpers use the bank's currently selected context and do not select the receiving FES. A missing selected context is a diagnostic for a nonempty copy. |
| 345                | Select the receiving FES and set its private named word at index zero.                                                                                                                                                                                |
| 346, 347           | Copy all 512 private words between the caller and FES contexts. Do not copy names, change selection or create an absent context.                                                                                                                      |
| 348, 349           | Read/clear the interpreter's `result` word.                                                                                                                                                                                                           |
| 350                | Insert image data in this FES's filename cache; retain the shared 20-byte data-buffer descriptor only for a new key.                                                                                                                                  |
| 351, 352           | Read/write the interpreter's own CP932 string-to-word dictionary, distinct from private variable names and the string bank.                                                                                                                           |

The `result` script command stores a signed 32-bit expression and yields through
the native -3 processing path. Private context contents and names live once in
`NativeVariableBank`; the FES checkpoint records their identity. The per-FES
image cache stores original data-buffer pointers into the one shared process
checkpoint. Original image-font data and retained CPU images consume that same
cache. Closing an interpreter unregisters its private context before releasing
its objects; closing its task then releases cached descriptors, followed by
base/child disposal. Initialization also queries and retains the Top's sound
receiver ID (game 35, SDK 33). Sound disposal routes to that saved ID even when
the Top has already released its sound task; queries still require a written
output word.

KCS `289` asks the FES task for a transfer size, then sends the same message
with a buffer and stores the count and bytes actually returned in a CSS entry.
`28A` sends the first stored entry with its exact byte count. A missing entry
returns zero; a present entry sends the import message even when it is empty.
The FES task copies only the supplied prefix of the selected private bank
and selects `_LOAD_` after a nonempty transfer when that label exists. Entries
are read from the logical save records; unused native heap capacity can retain
bytes from a previous allocation and does not belong to the CSS payload.

The original script task parent-attachment hook determines string-bank
inheritance. A FES-owned KCS task remains a real child task; FES text does not
substitute a hardcoded configuration, gallery or story handler.

The native Draw binding keeps a task ID and the last drawing rectangle and
offset. A Draw owned by a finishing script can disappear before its FES
finishes its current frame. Drivers retain the original ID for task routing;
the missing receiver has no live surface. Both profiles exercise this order
and restore a checkpoint taken between those two task lifetimes.

Source loading and object frame execution are separate phases. The original
game `628D60` and SDK `500390` allocate empty bitmap wrappers and the eagerly
owned button, scroll, slider and text children. They leave PLANE, CPLANE and
M2PLANE task creation to the later frame drivers. Source loading does not run
those drivers or decode header images. The first task update executes `START`
before object synchronization, so commands such as IMGWND `size` can initialize
the dimensions used by its first resource decode. Rendering consumes retained
task output and does not execute FES logic or object drivers again.

`verify-native-fes-initialization.mjs` independently runs both original
allocation functions with authored enumeration and task-factory boundaries.
It checks 27 game and 24 SDK object types, empty wrappers, the exact eager child
types and ID fields, and absence of frame-driver calls. Production tests cover
the load-before-first-frame state, an image window with a header filename and
`START` sizing, and repeated rendering without additional driver or image loads.

`scripts/verify-native-fes-task.mjs` executes 24 FES main
wrappers against each frozen PE: 362 authored cases per profile. It compares
control codes, output words and complete task transport packets. The probe
supplies only formatting, category resolution and task transport boundaries;
for CSS transfers it also compares the native global-file payload byte for
byte. It confirms the
native `0x278` quirk: both profiles expand `argv[1]` twice and do not read the
row argument. The independent SDK context-name field is +452, versus game
+712.

`tests/native-fes-task.test.mjs` covers failed loads, initialized locals without
a source, sleep gates, result access, context-copy selection, partial imports
and fresh-world restore using authored inputs. `tests/native-fes-input.test.mjs`
covers button mappings and retained sleep behavior. Original scroll/slider execution is covered separately in
[native-fes-controls.md](native-fes-controls.md). All dynamic definition columns,
raw handler differential coverage and complete UI flows remain required before
claiming complete FES compatibility.

Primary references are the official [object definitions](https://cs2.suki.jp/manual/fes/code/h_object.html).
Original executable captures and trace data stay in ignored local storage.
