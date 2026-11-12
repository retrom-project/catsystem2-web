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

A resource entry resolves its current byte key on every pass. An earlier STRING
entry can therefore visit a newly declared CIMAGE with a NULL entry wrapper.
Both frozen CIMAGE drivers leave that argument untouched when initialization,
dirty rendering and display-delta gates are all zero. The default coordinator
preserves this reachable no-op, including the independently owned old text child
and its visible pixels through a fresh World. Setting SIZE activates the original
wrapper dereference; that NULL boundary remains an explicit error. The driver
does not substitute the new CIMAGE's current wrapper, discard the old entry or
delete its text child. Other cross-family driver branches keep their separate
argument and ownership requirements.

The default JavaScript coordinator evaluates `getdiv` over its entire selected
range. It skips missing slots and non-NV objects, retains the last live NVSTRING
division, and writes private local0 exactly once; an empty NV subset writes0.
The handler does not expand or evaluate argument tokens. Complete frozen SDK
`6119C0` and game `777950` bodies establish this shared raw29 gate and aggregate
behavior. `tests/fes-text-log-driver.test.mjs` exercises real multi-element mixed
groups, interior and trailing holes, explicit indexes, and a fresh World without
source reads or EXE construction. Other text whole-command gates remain separate
phase-7 work.

The text controller also owns the complete `clear`, `apendmark`, `skip`, `reset`,
`isdraw`, `isdrawmark`, `insert`, `linecnt` and `endpos` selection wrappers. The
first six skip holes; `insert` and `linecnt` stop at the first missing slot.
`endpos` skips holes after reading each optional output index once. `linecnt`
reads its required output index once even when only inapplicable types are
selected. Repeated expression text at two parameter positions remains two
reads. Status queries write local0 for each admitted text object and leave it
unchanged when none are admitted. Their frozen class gates stay distinct:
`insert` only changes NVSTRING, `linecnt` excludes NVSTRING, and `reset` also
visits LOG's generated text subset. Both frozen handler sets and the real
default World mixed groups, pending D5 clears, canonical LOG child aliases and
fresh restore are covered. `draw`, `layout` and remaining whole handlers retain
their separate audit requirements.

The `layout prof` and `layout d_prof` wrappers read the category expression once
and retain the entire raw tail of the actual executing command after four ASCII
space delimiters. The complete frozen getters `766590`/`602210` return the rest
of that line; they do not return one token or expand string-bank/SCRIPT syntax.
Subsequent text, internal spaces and trailing bytes remain in the profile. Normal
FES preprocessing still applies before execution; prepared FES bodies retain their
already prepared bytes. Both wrappers skip holes and preserve their separate class
gates: `d_prof` admits STRING/STRING8; `prof` also visits LOG's original main-child
subset. NVSTRING remains inapplicable. Pending profiles own only `{index, bytes}`;
repeated commands append those complete tails once and keep the last category.
Checkpoints retain the current pending bytes without expansion replay. FES drivers
and D5 message16 pass exact bytes to `profileEncoded`, including CP932, UTF8 and
dual-valid input shared across different text classes. The existing explicit
JavaScript `writer.profile(category, text)` is a Unicode API with its writer's
encoding; FES does not use it. Direct JavaScript-authored FES source/layout strings
follow the UTF8 source convention. Other layout text arguments and complete
whole-handler coverage remain separate phase-7 work.

Repeated declarations through message338 keep the resource-request FIFO's
multiplicity and the current object's first flag. After the first driver pass,
a newly allocated STRING/NVSTRING/STRING8 child can therefore have a null writer
while the independently owned old child keeps its real writer, graph and pixels.
The FES driver sends configuration, fonts, profiles, shift, speed and queries
through the D5 receiver so that each original null guard remains effective.
Remaining queries, NV section and NV redraw require an initialized writer and
report that boundary explicitly. SDK74 does not emit the game's category-clear
operation19; its existing ABI capability gates that driver branch without
forwarding an unsupported text operation to Graph.

The original cursor receiver can leave both caller outputs unwritten for a null
writer. The JavaScript driver records an `endKnown` flag in the existing text
state and checkpoint. Only a complete actual writer query sets it true. Each
invocation also tracks explicitly initialized temporary cursor components:
plain/UTF8 SIZE2 writes height/width, NV SIZE2 writes width/height, POS2 writes
Y/X, and the last font mapping writes only X=selector for plain/UTF8 or both
character/selector for NV. A real cursor query overrides these producers. If
other producers supply a complete pair, that current pair becomes `end` and
clears `endKnown`. A query that writes nothing with no other producer may reuse
the cached end only when it is known from an actual writer query. Partial outputs
or an unknown cached end are diagnostics; constructor zeros never imply a known
cursor. This narrow rule replaces the original unwritten-local domain and is
not a bit-exact promise for uninitialized stack bytes. There is no second writer
history; the two-word cursor workspace is reused and is not checkpoint authority.

`tests/fes-string-redeclare.test.mjs` covers real default kind34 loading, actual
message338 redeclaration, owned old/new text children, D5 pixels, current-output
producers and fresh World restoration without EXE construction or source replay.
The focused public text cases also compare actual StageRenderer pixels before
and after redeclaration and after fresh restoration. The separate layout text
argument and whole-command audit requirements above remain open.

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
