# Native FES task protocol

`createNativeFESTask` owns one FES interpreter, its private variable context,
string-bank reference, retained surface, display state and image-data cache.
KCS calls use task messages through the World's Top-scoped router. They do not
call a menu selected by a game filename. The complete original task handler is
still being audited; this document distinguishes the implemented message
contracts from the remaining controls and parser work.

CGL-backed `loadlist` and `loadlist2` keep the original selected filename bytes.
The parser records each variant CString offset and length into the same owned
`CGGallery.listBytes` resource already retained for its explicit original
consumer. Selection runs once; a separate query copies only that selected span
into an owned plain `Uint8Array`. CP932 aliases that decode to the same string
remain distinct at this boundary. Snapshots retain that single list-byte
authority and numeric span metadata; fresh restoration neither reopens the CGL
nor repeats selection. Explicit JavaScript-authored gallery strings retain their
existing CP932 encoding boundary. This leaf supplies bytes to the normal image
setter; Game image SOURCE/CURRENT and configuration-event consumption belong to
their separate closure.

The reviewed task handlers are game `62C480` and SDK `503930`. The World's
internal message numbers use the game convention. SDK FES messages starting at
raw 326 correspond to game 331; SDK bank queries 174/175 correspond to game
176/177. The lower common task messages keep their independently recovered
numbers.

| Canonical messages | Behavior and limits                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3                  | Set the private `_EXITCODE_` to -1 and send sound-bank message 210 before the base destruction request; actual resource release remains deferred.                                                                                                     |
| 9, 10, 64, 65      | Use the receiving FES's native button/low-button mapping and its Top's input task. Original scroll/slider tasks own their separate button children.                                                                                                   |
| 19                 | Run ABI-defined image callbacks/notification, then saved-entry/current-key conditional defaults; the supported domain is described below.                                                                                                             |
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

The configuration event uses the registered ABI's
`fes.configurationMessage` stages. The reviewed Game receiver visits the current
object-key map first, calls each live image configuration callback, notifies
`MES_CHANGECONFIG`, then traverses its saved resource FIFO. The reviewed SDK
receiver enters that FIFO directly, with neither the live-map stage nor that
notification. This event does not select a private variable context by itself.
World preference-persistence dirty remains a separate flag.

The event captures its current player/runtime/owner only on the call stack.
After notification and each awaited sound callback, it checks the same player,
closed runtime, and releasing/removed owner before continuing the FIFO. The sound
185 callback checks that same call's predicate after its query and before new
pending-play writes. Already issued queries and pre-close dirty writes are not
rolled back. A failed in-flight request is canceled only after that owner loses
liveness; live request failures still propagate. No predicate, cancellation
state, queue or continuation is added to the checkpoint.

The Game live-map callback applies to IMAGE, BUTTON, PANEL, SAVEPANEL, BGTABLE,
BGTABLE2, CHTABLE, CHTABLE2, CHTABLE3 and IMGWND. Other recovered constructible
families have a proven empty callback; NUMIMG has no object. The map uses its
original current key order, independently of the resource FIFO and lifetime
handle order. Each image owns narrow `fileSourceBytes` (SOURCE) and `fileBytes`
(CURRENT), once each. The existing BGTABLE/BGTABLE2 CURRENT bytes remain the same
authority. Its `file` string is a non-enumerable CP932-derived view.

A FILE definition or admitted `load` argument performs its existing bank/SCRIPT
expansion once and writes original narrow bytes to SOURCE. A CGL selection uses
the already selected exact bytes. No target-class encoding is applied. The
callback starts CURRENT from saved SOURCE, replaces `%LANG%` with the selected UI
prefix (or valid default), then replaces `%LANG_M%` with the main prefix (or valid
default). A missing selected/default row leaves that marker unchanged. Only the
Settings wide prefix crosses its defined CP932 conversion boundary. A table
selector writes CURRENT alone; a configuration event never reselects a table,
re-expands FILE, or reads the source resource again. Checkpoints save these two
semantic fields once and restore without replay.

The image comparison supports the verified normal C-locale initialization and
creation flow of this frozen Game ABI. It folds each original ASCII byte A..Z,
including bytes inside CP932 sequences, and sets image-changed only when that
comparison differs. It still updates CURRENT for a case-only change and never
clears an earlier change request. Normal JS startup/FES APIs have no locale
mutation/import path and do not borrow an unknown native CRT flag. Non-C or
unverified locale consumers remain unsupported and require their own reviewed
route before entering this callback; this is not a general CRT locale model.
Overlong filename/prefix results beyond the defined 256-byte CString fields
remain explicit unsafe-boundary diagnostics.

The FIFO dispatches by each entry's saved raw type, then resolves its current
name/index. Missing current objects are skipped; duplicate entries retain their
order. SOUND/SNDTABLE use their existing common sound service. STRING,
NVSTRING, and Game STRING8 mark their current text configuration dirty and
independently refresh only the enabled fixed-pitch, face, weight and shadow
defaults. The face copies the current Settings CString in its native encoding:
SDK narrow bytes or Game UTF16 units, without a CP932 round trip for Game.
Callback copying preserves destination padding and diagnoses unterminated or
oversized faces. Font index, wipe, proportional, dimensions, colors and text
history are preserved.

STRING/STRING8 keep these default flags in their existing layout state.
NVSTRING keeps its four known flags once in the existing nativeTextState;
constructor/full reset enable them, and recovered setters retain their original
flag/dirty rules. In particular NV weight enables its default only for -1 and
does not itself set dirty. This event preserves NV's proportional values from
the separate constructor/reset contract. Existing null-writer guards, known
cursor handling and independently retained old D5 child pixels remain in force.

Saved non-text/non-sound entries have a proven FIFO default no-op even when the
current key names text. Same concrete type/ABI rebinding and SOUND/SNDTABLE
rebinding use their recovered callback. Other cross-layout fixed callbacks
remain explicit unrecovered diagnostics rather than dispatching by current type
or copying unknown layouts. The STRING-to-CIMAGE case crosses its target's
defined allocation before any default flag can guard it. These unsafe or
unrecovered rebindings remain outside the supported event domain.

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

The `font`, `fontind` and applicable `fontind_sub` layout wrappers preserve the
complete executing raw tail, including literal bank/SCRIPT syntax and prepared
spacing. Only an absent tail reads the current Settings font block from the
World's sole `configuration.fields.data`; `fontcom.default` has a different
owner. SDK setters copy narrow face bytes, while both Game STRING setters use
the original fixed-CP932 conversion to their wide face fields, including
STRING8. Game NV retains its two old faces and updates the indices; SDK NV
copies both faces. LOG `fontind` visits main rows, and the Game-only
`fontind_sub` visits LOGSTRING8 secondary rows. These gates, actual D5 packets,
owned bytes and fresh restoration are covered without an EXE constructor.
The FES task's separate message19 conditional-default refresh over saved
resource-entry types remains an independent phase-7 consumer gap.

FES NV construction and full reset copy the current Settings proportional DWORD
into both existing embedded text configurations. The field remains in those
canonical configuration bytes and is copied without Boolean normalization.
This FES boundary does not change the generic D5 NV packet defaults. A fresh
World restores the saved value without replaying construction or reset against
different current Settings.

FES motion admission preserves the original failed-resource return. On a cache
miss, an absent or zero-length MOT file returns0 before creating a VM or motion
record. The object snapshot and command effects that precede loading still
occur: for example, `blend` has already set alpha and `pos` has already set its
coordinates. A failed request retains the existing records, next handle, last
frame, delay and random state; it is not cached, so a later request can load a
newly available file. Existing successful cache entries remain usable without
reopening their files. Both builtin commands and authored SUBCOMMANDs use this
same admission boundary. Nonempty malformed KCS and I/O errors remain explicit;
required script loads outside this FES boundary keep their existing contract.
Default World tests cover both frozen ABIs, delayed real KCS execution and fresh
restoration of empty and active MOT targets. Actual StageRenderer pixels after
missing `pColor`/`pPos` match the equivalent explicitly defined object and remain
identical after fresh restoration. No builtin MOT or missing-resource stub is
synthesized.

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

## Object noact/setact references

The ordinary default runtime installs these two commands only on the object route.
A real multi-object index -1 returns before fetching its optional operand; a
singleton omission has already normalized to0. Otherwise parameter2 (the first
operand after the verb) is fetched/expanded once and numerically evaluated before
current lookup. A present empty C-string evaluates0 at this command's reviewed
numeric-helper boundary; the generic expression API is unchanged. Missing and
non-BUTTON targets then return0 without a record; disabled raw6 still queues.

The existing pending-record FIFO stores an owned narrow name/index reference,
with the collection's existing31-byte name domain and no new encoding or
truncation. The original record has name32 plus index4; overflow beyond that
existing domain is not reproduced. noact copies the default reference at drain;
an empty queued name clears it, including index0. setact refreshes mouse, sends
canonical Input93/flags1 for the nonempty old name, dispatches current UNFOCUS,
copies the queued active reference, then sends Input93 and current FOCUS for the
nonempty new name. It does not deduplicate, warp, assign Graph activity or add a
flush. Missing current event objects skip only their label. Event-produced records
stay in the same FIFO. Input routing and its actual immediate children retain
their existing unhandled-control/unwritten-output rules. The frozen original
queue IDs are Game7/11 versus SDK10/14; the JS FIFO uses semantic operations.

Default and active references each have one current semantic pair and one existing
snapshot owner: the instance defaultButton and Input.state.focus respectively.
Player.focused is a current-lookup view, and restore does not overwrite the active
pair to initialize that view. Existing UI consumers use these same values. Tick
clears an active name/index only when current lookup finds raw6 and it is disabled;
missing or rebound nonraw6 references remain stored. This cleanup adds no event.

Mouse queries and active-reference consumption use call-stack-only player/root/
runtime/owner liveness checks around their real awaits. After owner cancellation,
no later query, reference copy or focus leg runs; an already issued query is not
rolled back and live failures still propagate. No continuation state or second
queue is checkpointed. A non-NULL empty active reference preserves its supplied
index and differs from the separate NULL/resetactive branch. Empty-reference
consumer tests inject a typed FIFO value; they do not claim that an authored
source command has produced it. BUTTON attach/navigation and the other input
frontends remain separate incomplete work.

BUTTON `attach` stores one current owned narrow-byte name/index reference on raw6.
The pure constructor initializes it to NULL; same-key first-wins declarations
retain it. Image `copy` clones bitmap content, not the BUTTON tail. A collection
checkpoint saves this semantic reference once and fresh construction restores it
without parsing the command or choosing its target again. An absent operand,
empty original name or unclosed index clears it; malformed numeric expressions
still fail. A nonempty source name that expands empty in the reference reader
remains a non-NULL empty reference with its supplied index. The whole wrapper
reads its optional argument once, visits increasing holder indices, stops at the
first hole and skips unrelated types. Raw23's separate attachment protocol remains
explicitly unsupported at this entry; the particle service's other operations do
not authorize that original target/NULL branch.

For an existing enabled current BUTTON, the default World input route now uses
the original directional reader: same-block searches preserve the first matching
cell (including disabled-cell masking), lower-before-upper cross scans, and the
original horizontal `(cross,y)` argument slots. Attachment is attempted once
between local search and linked-block continuation. Raw13/14/15 controls use their
current orientation and inclusive bounds, step by exactly signed int32 +/-1 and
call the existing setter with notify1. SCROLL's value getter consumes its pending
flag even when an axis/bound prevents a new value. Target enable is not a gate.
The control-changed result is distinct from finding a new button: it retains the
active reference, skips the direction event and Input138, then traverses the
existing resources. Linked blocks select the first key-ordered enabled BUTTON
with strictly smaller float32 squared XY distance, starting at exactly100000000.
An empty cyclic link chain and undefined block reads remain explicit diagnostics.

A found button is copied into the existing active reference before event11..14,
then the caller uses the actual owning Top Input's canonical138, w1/flags0. Both
frozen ABIs write `_PUSH_UP_`, `_PUSH_DOWN_`, `_PUSH_LEFT_`, `_PUSH_RIGHT_` through
this event helper; their complete two-level tables dispatch neither default nor
object labels for these four events. In particular `PUSH_*` is not an extra FES
label callback or a FOCUS/UNFOCUS pair. The current `nativeEvent` field authority
is reused. Earlier research wording suggesting a direction label was incorrect;
the proposed config_open-in-direction-label close test is inapplicable and is not
behavior coverage. Stack liveness is checked after actual awaits before Input138
and further work; no continuation is saved. Native Input owns cursor warping and
region activity, rather than direct pointer/Graph assignments in the reader.

The shared cursor-point query adds a direct PLANE/CPLANE parent's current pos2
minus its local base even when the BUTTON is locked. In that branch the local
term is the captured XY, with the original float32 addition before truncation.
This parent offset does not depend on the separate PL reference/property gate.
The image getpos2 query and retained image driver keep their distinct formulas.

The ordinary direction caller also restores its initial selection. Only an
absent current map object triggers another actual Top Input125 query into two
initially zero words, followed by the resource FIFO mouse-hit helper. This query
still occurs if the earlier outside-window152 gate set FES mouse variables to
INT_MIN. The helper ignores Input regions, priority, display and enable. It visits
saved raw6 entries in allocation order, resolves their initial ordinary object
identity, and tests its virtual integer position plus raw width/height using
signed int32 addition and right/bottom-exclusive rectangles. The helper's
SetRectEmpty prolog does not query a host cursor. TYPE0 accepts a rectangle hit;
nonzero TYPE accepts only a nonzero packed-color alpha byte. The current object
wrapper supplies this bitmap, with an auxiliary bitmap taking precedence. Pixel
queries retain bitmap offsets and physical bottom-up rows. RGB24 packed color
has alpha0 even though the separate alpha-only query would return255. A NULL
wrapper accepts; a wrapper with a NULL bitmap buffer is an explicit native unsafe
boundary; a real bitmap without sampled pixels returns color0. Typed-consumer
coverage of NULL/empty wrappers does not establish a normal FES source producer.

Only a raw6 resource entry saves `initialHandle`, copied from the actual allocated
ordinary object's existing semantic handle before any allocation await. This is
a weak identity in the collection's existing non-reusing graph, owned once by
the existing entry checkpoint. Current-key resource driving and this initial
identity are separate: deleting and recreating the same key does not rebind the
mouse helper. A structurally valid stale handle restores unchanged, without
registration or resource replay; an actual helper read of that deleted identity
diagnoses the native freed-object domain. Missing-key resource cleanup discards
the entry normally. There is no second object, geometry copy or handle registry.

No-hit fallback accepts a default only when its current map object is raw6 and
its DWORD enable is nonzero, as do the frozen Game758140 and SDK5F62D0 probes.
Display and priority are not gates; collection lookup already excludes deleted
map objects. This differs from noact's admission of disabled targets and the
mouse helper's unfiltered first hit. A valid default is copied directly, skipping
navigation from its cell, then uses the existing direction-variable/Input138
leg. A missing or disabled default after no hit propagates without changing the
active reference. Existing disabled or non-BUTTON current objects skip the mouse
helper; if no valid default exists they consume the direction without a new
reference, direction variable, Input138 or propagation. An enabled current button
whose reader finds nothing retains its reference and propagates. The attached-
control changed result keeps its separate behavior above. Actual125 and pixels
awaits preserve the same player/root/runtime/owner checks: close cancels further
writes and routing, including in-flight rejection, while live failures propagate.

The frozen normal `resetactive` frontend reads no operands and enqueues the
existing active-reference operation with a NULL payload, then returns0. Extra
operands therefore cause no parameter-getter, bank/SCRIPT or numeric side effects,
and this return does not itself flush the queue. Game uses private record11 and
SDK14; these remain semantic queue operations rather than raw Task messages.

The NULL consumer shares setact's mouse refresh and old-name Input93/UNFOCUS
order above. It then clears the single active reference, including its implicit
zero index, and sends actual Top Input canonical145, w0/l1/flags1. This is SDK
raw143. The already-owned Input service clears region activity, sets its previous
XY cache to-1 and forces cursor processing. A non-NULL empty name/index7 instead
copies that exact pair and sends neither a new-name93/FOCUS nor145; it remains
distinct through a fresh checkpoint. Noact/default state is unaffected. Repeated
NULL records still execute145, with no deduplication or new lookup/type/enable
gate. Already issued145 effects survive an owner-close cancellation; pending
work after a real UNFOCUS Host wait or145 await stops under the existing same-
player/root/runtime/owner checks. Live errors still propagate.

Each native -3 request is consumed before awaiting its existing private FIFO
drain. While that drain waits for config_open, a second ordinary notification's
JavaScript async pause with native return0 cannot borrow the first request. Its
new records stay pending until a genuine native -3 or the existing frame drain
consumes them. The actual task tick,337 notification and Game19 configuration
notification paths preserve this distinction; SDK19 retains its separate ABI
behavior. Existing notification continuations remain on their call stacks, with
no added queue, state copy or persistent continuation. A genuine new -3 can still
consume nonplatform work inside the event; a global drain mutex would break that
behavior. An issued flush request remains consumed on live failure, while
unconsumed records remain owned by the existing FIFO. Owner cancellation stops
subsequent work and live errors still propagate.

A second modal platform action while one is in flight remains an explicit
rejection at the existing single-action/single-dialog Host boundary. This does
not establish arbitrary original-engine modal concurrency, add a window queue,
or turn that rejection into success. The resetactive registry row remains
partial with this scope recorded. The manual signature text `reset_frame` is
preserved as a manual/frozen mismatch, without adding a new alias.

Normal `react` is parameterless in both frozen versions and ignores additional
operands without a bank, SCRIPT or numeric getter. It appends a `react` operation
to the same private FIFO and returns native -3, so preceding return0 records are
consumed before it. The operation stores no captured reference or duplicate state.
At dequeue, only a nonempty current active name admits work; it does not probe
current type, enable, DISPLAY or the default reference. NULL and a non-NULL empty
name/index7 both skip work while preserving their distinct existing values.

The admitted consumer updates mouse, sends canonical93 to its owning Top Input
with flags1, w0 and l1, then reads the current active name/index for FOCUS. Game's
literal93 and SDK's literal91 retain their existing ABI translation. This does
not write either active/default reference, issue UNFOCUS or warp, deduplicate
repeated calls, or directly mutate a Graph region. The current reference is read
after both real asynchronous query boundaries; a second legitimate caller may
change it while a query waits. The existing same-player/root/runtime/owner guards
cancel subsequent work or a canceled rejection after owner close, while live
errors propagate. A settled fresh World restores the one existing reference and
FIFO without replaying completed FOCUS. The normal `react` row is implemented for
these frozen profiles; its parameterless manual signature is unchanged.

Normal `lockactive` reads optional operand1 through the same byte-first bank and
SCRIPT getter exactly once. Missing or expanded-empty means0; other operands are
ignored. The int32 result is queued on the existing FIFO and returns native -3.
The only new owner field is `FESInput.state.activeLock`, initialized to0 and saved
once by the existing input checkpoint. Its full signed word is retained rather
than replaced by a boolean. Current checkpoint format changes in place.

Its real reader is canonical64 hover from Graph7/8, reached by NativeInput hover
and tick. Graph forwards its native task ID; the FES route resolves that ID to
the World task before searching saved raw6 resource entries in original order.
The helper borrows the first matching entry's stored name/index and buttonTaskID,
without using a current-key button projection or another identity registry.
The matched path zeroes the36-byte active reference to empty-name/index0 before
either callback. Enter assigns that entry reference and fires FOCUS even with a
nonzero lock. Leave fires the entry target's UNFOCUS, then reads the latest lock:
a nonzero word preserves the current post-callback pair; zero clears the name,
writes active.index=-1, and invalidates the existing pressed reference. This can
preserve a pair rebound by the callback, but does not promise retention of the
pre-zero pair. An unknown button ID bypasses the matched zero/callback: nonzero
lock retains the old pair, while zero clears to empty/index-1. The pressed null
value represents the original invalid-index sentinel; the native release reader
ignores its old name when index is-1. General press/release policy is unchanged.

These hover writes retain NULL, empty/index0 and empty/index-1 as their existing
semantic values and do not call resetactive/Input145, UNFOCUS a different old
reference or warp. Mouse refresh precedes the saved-entry lookup; the resources
are traversed after the callback and post-lock decision. Real UNFOCUS Host waits
may admit an existing nonmodal -3 request changing lock/reference before the
post-await read. Same-player/root/runtime/record guards cancel later work or a
canceled rejection after owner close; live errors propagate. A fresh settled
World retains the scalar/pair without replaying callbacks. Source and tests use
the current existing queue and reference authorities without a second flag,
reference registry, modal queue or versioned checkpoint reader.

This bounded leaf does not complete automove, other keyboard/input frontends
or the raw23 attachment protocol. The direct JS-source input API retains its
separate path.

Message337 captures its current player/root and task identity for the call. After
notification, resource synchronization and input synchronization each settle, it
checks that same owner/runtime is still live before starting the next operation.
Closing or replacing that owner ends the call with its original unwritten result;
already completed effects remain. Live errors still propagate. This adds no
queue, persistent continuation or scheduler state and preserves executorEntry.
