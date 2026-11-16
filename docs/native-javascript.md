# Native SDK JavaScript

The ordinary SDK kind 55 owner executes a finite JavaScript subset using a
tokenizer, compiler and data-only instruction interpreter. It does not pass
source to `eval`, `Function`, an embedded V8 or another JavaScript engine.
KCS creates the real task with `42`, links its calling Script banks and drawing target with `3CE`, and
loads through the `javascript` resource category with `3CF`. Link and load
retain control 2 with no VM output. Link creates the actual kind 6 base
image-plane child named `js base button`; it is not a second Input owner.
The link then sends the actual rectangle/ancestor-depth packet and enables
that child's region through its existing typed Input owner. Both messages keep
transport flags 1; the rectangle's sixth word is separate Input metadata.

The normal interpreter supports function and `var` declarations, lexical function
expressions and closures, parameters, return, assignment, increment,
arithmetic, strict equality, conditional blocks and calls. Structural tokens
are distinguished from quoted strings, including keyword and delimiter text.
Function declarations directly in a program or function body are hoisted;
block and conditional function declarations fail with a source span rather
than applying unreviewed Annex B semantics. Finite Image/Plane/Sound methods, the explicit debug sink and motion queries are
described below. `cfExit` from a running callback accepts an
integer first argument or no argument (code zero). It updates the exit code and
clears running, then returns `undefined` normally: the current JavaScript call
continues, while subsequent logic frames do not call `GameLoop` again.
`GameLoop` receives the task's actual logic frame. Loaded/running state follows
successful program execution and its exit completion, rather than writable
emulations of process fields. Unsupported syntax and host imports fail with
the source filename and span. Relinking, reloading, missing-source behavior,
arbitrary guest-scheduled host waits remain outside this finite implementation.
`3EE` retains the option's complete unsigned DWORD in the real kind55 owner;
its constructor default is zero. The normal route sends raw `20C` (canonical526)
with the real Script sender, w zero, raw l and transport flags zero, without an
output word. This retained field is not reinterpreted as a Boolean or running flag.
`3D0` formats the function name and copies the calling KCS Script's selected live
CP932 strings into one guest string array; absent indices become empty strings,
and a nonpositive signed count produces an empty array. A loaded owner accepts
that explicit call even after `cfExit` stopped future GameLoop callbacks. Only
nonnegative integer indexing and readonly `length` on these arrays are supported;
general JavaScript arrays and arbitrary object properties remain unsupported.
The ordinary adapter passes these pure arguments directly to its data interpreter,
without emulating the original V8 envelope's physical pointers. All four commands
resolve a zero target from the real parent task's nativeID, not the caller's WorldID
or an assumed Root zero. Link/load/call retain their explicit kind55 owner domain;
option writes use the existing message router, including missing targets.
Supported host methods do not imply general V8 or complete SDK
API coverage; the official tutorial retains its separate integration gate.

Checkpoints retain the program, lexical cells and closure references as data.
Fresh restore does not execute JavaScript source/callbacks, reload selector images,
or borrow the old World's mutable cells. Required immutable audio/MOT preloads are
accounted separately by their existing owners. Snapshots require a completed callback; an
instruction-budget pause is not a finished frame. Close discards this task's
VM and links while Base destruction releases its child. Closing clears the
loaded/running state immediately. Source IO that completes after close is
rejected before a VM is published or any guest statement executes. Calling
Script banks are borrowed from the real runtime and remain owned by that Script.

The explicit original-engine adapter below remains an oracle path when a
World already has `nativeEngine` or `nativeEngineLoading`. Original World
fixtures open that owner explicitly before creating kind 55. Its original
class and executable assertions remain unchanged. Ordinary execution never
falls back to it on an unsupported program.

## Ordinary CsImage loading

`new CsImage()` creates a typed, data-only host reference in the existing
`NativeHandles` registry, with a context slot and no explicit plane. Guest aliases
retain that same reference. No second image table or pixel cache is created.
`image.load(name)` (or a zero second argument) returns the actual Boolean result
of the existing selector image factory. It releases the previous owned output
before loading, including when the next name is missing. String filenames use
the existing image-category, comma-selector, decoder and bitmap authorities.
`setBaseType()` defaults to image mode; `"scene"` or numeric zero selects scene
mode. The finite adapter accepts strings and signed32 integer numbers
(`-2147483648` through `2147483647`); other numeric values fail with their
source span. It does not emulate arbitrary V8 numeric coercion or modulo conversion. These setters return
`undefined`; unsupported methods and argument forms fail with a source span.
Image mode keeps the original base-anchor adjustment and normalizes the output
bitmap's offsets and canvas to its physical extent. Scene mode preserves those
source extents. Loading alone does not publish a drawable; the finite pose and
Draw-target methods below opt into that path.

A host load suspends the data interpreter at its call continuation. Only the
adapter awaits the real IO Promise; its result resumes that call once, before
any following guest statement. Pending IO is not a completed logic frame and
cannot be checkpointed. A settled checkpoint saves typed references and the
existing real bitmap outputs; fresh restore does not construct, reload, execute
source, publish commands or draw RNG values.

Without `setPlane`, the original CsImage virtual callback returns before its
raw `113`/`11C`/`126` draw publications, so an unbound Image creates no drawable.
Close sends SDK raw `114` to its actual linked target with the real JavaScript
sender, context slot and flags zero. A calling-Script target maps to canonical278
and remains unhandled; that result is not deletion success. A Draw target maps to
canonical281 and deletes its real alias. Slot return and owned-bitmap release are
separate operations. Borrowed Script/Draw/Plane owners are retained. IO completing after owner close
releases its output instead of resurrecting the object or continuing its guest.

## Original engine oracle

The frozen SDK engine embeds V8 3.26.16. The browser runs its original
mutex, default isolate and compiler table initialization, and the JavaScript
portion of WinMain's platform setup. The guest owns its isolate, executable
pages and ArrayBuffer allocator. The browser runs the original disposal
routine before closing the PE process.

The SDK's shared MOT cache is created before the isolate using the original
list constructor. Plain JavaScript objects traverse this cache during native
destruction even if no FES or motion ran. The engine releases the cache with
its original static destructor after the task graph and V8 have closed.

The browser uses the original V8 options that disable concurrent
recompilation and parallel or concurrent sweeping for its single virtual CPU.
It also turns off idle notifications: the guest clock advances between game
frames. Allocation-triggered collection, compilation and script operations
use the embedded engine. See [V8 3.26.16 flags](https://github.com/v8/v8/blob/3.26.16/src/flag-definitions.h).

The native tests construct the original JavaScript task, load an authored
program and advance its closure through the original GameLoop callback.
Restoring after the first frame reproduces the exit on the second frame in a
fresh PE process. The tests also verify the allocator and task teardown.
KCS creates the original kind 55 task; its `3CE` link message creates a real
kind 6 base image-plane child, `3CF` runs the mounted script through the original filename
formatter and loader, and `3EE` updates the original task option word.
`3D0` formats the function name and passes the selected KCS strings as one
JavaScript array. The original receiver converts CP932 to UTF-8 and passes an
empty string for an absent index. Its `cfGetStrVar` and `cfSetStrVar` callbacks
read and write the calling Script's live string bank. The test calls from KCS
with Japanese text, reads back a JavaScript write in KCS, and verifies later
reads and writes after restoring into a fresh World.

`cfGetVar` and `cfSetVar` share the Script's DWORD bank, including signed
JavaScript results, unsigned index bounds and native write dirtiness.
`cfCalc` runs the original SDK interpreter with the live global words, selected
private words, named values and context word. Only its temporary interpreter
owns the guest allocations; its changed words return to the shared KCS bank.
The KCS test reads a JavaScript write immediately and compares the result of
global, private and named expressions after fresh restore.

The SDK's original `CsSound` sends profile-specific packets directly to the
sound task. Its allocated load is 280 bytes, with no crossfade fields. The
receiver returns the allocated SDK bank without a crossfade offset, and the
original object sends volume and play to that bank. In Chromium the official
sample decodes and plays `bgm.int/bgm01.ogg` on its allocated channel.

The normal official-tutorial browser gate enters through real title and choice
menus, checks moving Plane pixels and the actual soundtrack, restores mid-motion
into a fresh World, and retains its 300-frame completion/fade/scene-return/removal
assertions. Physical pointer observations remain in the explicit original-owner
helper. Host unit coverage is not a pass of that full browser gate.

## Ordinary CsPlane children

The finite normal SDK host accepts `new CsPlane(width, height, u, v, priority)`
with five signed32 integers and positive dimensions. Omitted constructor arguments
remain unsupported with source spans; finite methods are described below. The own
constructor creates a real kind2 child under the kind55 controller, not under its
borrowed calling Script. The returned native task ID is resolved separately from
its World ID. For nonzero child IDs, existing graphics packets create a VRAM type1 graph and preserve the
independent w1 texture-position and w0 physical vectors, and start with display0.
This creates a VRAM Plane rather than a solid-rectangle substitute; explicit
CsImage binding uses the Draw target described below.

Plane host references use the existing NativeHandles registry and point to actual
World children. Graph/MOT/Input state stays in its existing authority. Constructor
service waits use the existing pure-data VM continuation; closing the owner while
creation is pending releases the late child before any guest continuation. Close
preserves the native child-ID0 guard; for nonzero IDs it sends canonical3. It
releases the actual owned child while retaining the borrowed Script.
Settled fresh restore validates both CsImage and CsPlane references and restores
actual graph state without source, image, command or RNG replay. Constructor coverage does not establish arbitrary V8 conversion, default arguments
or the official scene's complete drawing path; finite motion is specified next.

## Finite CsPlane motion and Context busy query

The normal SDK kind55 host supports `CsPlane.motMove(duration, x, y, z)`,
`cfIsExecMotion()` and `cfIsExecMotion(plane)` for one known CsPlane. Duration is a
signed32 integer, default30; the selected MOT script clamps values below1 to1.
Coordinates are finite float32 numbers or omitted current values. The motion
call returns `undefined`, not a native pointer or a manager handle; queries
return booleans. Other selector forms, general V8 coercions/string shorthand,
other curves and `cfWait` remain explicitly unsupported. This slice does not
run the complete official tutorial.

Own callback539790 first updates the actual object at its owner's native frame,
then samples physical position and freezes target-minus-current registers before
resource I/O. Physical canonical51/w0 is separate from constructor texture51/w1.
The constructor still creates real type1 VRAM with display0; motion does not make
it a solid rectangle or implicitly display it. Motion requires the existing real
nonzero owned child and retains the strict missing-model boundary.

The exact `mot.int/motMove.kcs` resource is loaded through
`readNativeResource(world, name, 3)` on a MotionLibrary cache miss. The optional
reader seam shares its existing decoded-script Map; callers without an explicit
reader preserve their category/default path. Missing or empty script data adds
no motion; arbitrary I/O or parse errors propagate. No substitute interpolation,
loaded flag, fake busy state, second geometry model or original CPU fallback is
used. Existing NativeMotionRegistry/Manager/Instance own actual KCS records and
execution; the private SDK script is retained only as ignored proof, while
maintained tests construct their own semantic KCS fixture.

The no-argument global query scans the current Context's supported type1 objects
and reads real manager activity, independently of Graph kind numbers. The
one-Plane query reads only that Plane's actual manager; a Plane without motion
returns false even while another Context member is busy. Queries do not update
motion, advance frames, read files, send packets or draw RNG values. The current
CsImage slice has an empty manager and no enabled MOT methods.

The one-object form requires a live typed CsPlane reference from the same
Context, with its real nonzero owned child/model. Missing, released, malformed,
wrong-type or other-owner references, strings, numbers, arrays and multiple
arguments fail with a located unsupported diagnostic. These typed isolation
guards define this finite normal implementation; the native argument path does
not establish a native cross-owner refusal contract.

Ordinary tick order is GameLoop followed by object motion/publication,
including the callback that called `cfExit`. Later stopped callbacks do not tick.
The native same-frame pre-update is preserved; FES forest traversal or a generic
same-frame suppression rule is not substituted. Frame0 retains the manager's
real startTick sentinel behavior, rather than using elapsed values as World
frame values.

Snapshots retain the typed Plane/child/manager ownership links and actual
manager/instance state. Cold restore preloads required immutable MOT code through
the same mode3 cache-miss seam before restoring the existing manager, without
replaying JavaScript, image reads, native commands or RNG draws. That permitted
MOT bytecode read is recorded separately from zero warm frames. Unknown,
cross-owner and duplicate manager references fail validation. Closing the owner
releases its managers and real children without force-running a final position;
late MOT I/O cannot publish a new manager or revive the guest. Other official
classes, selector queries, methods, platform effects and pixel parity remain
outside this finite host contract.

## Finite CsSound through the shared SoundTask

The normal SDK kind55 host supports `new CsSound()`, `load(filename, category)`,
`play()` / `play(signed32LoopCount)` and `stop()`. Load takes two bounded CStrings
with an explicit nonempty `bgm`, `se`, `voice` or `sysvoice` category. Play defaults
to one and preserves the signed argument's DWORD bits; stop has no fade argument.
All methods return `undefined`. Empty-category filename inference, general V8
conversions, inherited volume methods and other Sound APIs remain unsupported.

Construction queries the actual zero-ID Root for its existing SoundTask. Its
native task ID and allocated bank index are separate domains; bank0 is valid and
missing loads retain `0xffffffff`. The host sends the existing group query and
280-byte allocated-stream packet, then volume/play or stop packets with flags0.
SoundTask, AudioMixer, its decoder cache and actual device/channel own playback.
No Task child, second bank/cache, substitute channel or timer is introduced.

Play reads the live canonical configuration's master-prederived words0..2 and
master/category mute flags. `sysvoice` aliases voice. It retains the native signed
low32 multiply/divide by100 for the object's default volume100; it does not derive
again, consult the hierarchical Sound tree or copy the VOICE master into the
independent Sound device factor. Existing SoundTask stop owns its ten-logic-frame
fade and later stop; the host supplies no replacement scheduler.

Typed host references and aliases restore into a fresh World with the complete
settled DTO and zero warm frames. Immutable audio preload during Sound restore is
accounted separately from zero JavaScript/native-command/RNG replay. Host state
contains no Promise, function, AudioBuffer or physical address. Closing the JS
owner drops its host references, without stopping or releasing the shared bank.
The SoundTask may legitimately complete an outstanding decode or fade after that
close; a late continuation cannot revive the closed host or guest. World/SoundTask
shutdown performs the real device/channel cleanup. Owned-WAV unit coverage uses
the real AudioMixer/device pipeline with a PCM-reading WebAudio test context; it
does not claim physical browser audio or the complete official SDK tutorial.

## Explicit normal debug output

Normal SDK `cfLog` accepts one ASCII string, including a guest concatenation,
with no percent/NUL and fewer than500 encoded bytes. It returns `undefined`.
This is an explicit `world.host.nativeDebugOutput` capability: the existing
World service forwards the bytes once to the actual Host. Production EngineHost
uses its bounded nativeLog array; there is no second logger, default noop or
console substitute. A missing sink or unsupported argument gives a located error.

The host method and World forwarding service retain their original synchronous
exception/return or Promise. The VM stores only a pure-data pending log request,
awaits the original operation once, discards its result and resumes the guest.
A close during that wait cannot revive its machine or emit again. Settled fresh
restore retains callable aliases without replaying logs, source, commands or RNG.
The native SDK's default three debug gates and exact IAT identity remain unproved;
this explicit capability does not enable ABI unicodeOutput or establish default
native debug-window equivalence. Non-ASCII/format/long-string/general V8 arguments
remain outside the finite host domain.

## Owned Draw target and finite Image/Plane pose

The normal link keeps its calling Script/bank owner distinct from the resolved
kind15 drawing target. A real Draw target is queried for its initialized output
offset; the older calling-Script data-only domain remains supported. CsImage
publishes exclusively through the existing Draw bitmap/alias consumer, with
canonical280 bind,289 clip,299 layer and281 deletion. Script tasks gain no new
drawable table. The first clip precedes bind and is a no-op for a missing entry,
as in the own SDK receiver; Draw's existing behavior is preserved.

`image.setPlane(plane)` borrows a live same-context CsPlane with a real nonzero
child/model. Its fixed UV origin and extent determine the clip and image origin;
the Plane's physical position remains its existing Graph/MOT authority. Image
load preserves scene/image base conventions, and object tick emits the native
60-byte bitmap descriptor only when dirty. `image.setPlane()` removes the actual
Draw alias and returns its slot, without releasing the borrowed Plane/Draw/Script.
Rebinding after detach and arbitrary/external Plane lifetime are outside this
finite domain. Normal owner cleanup closes Images before Planes, matching the
proved ownership without claiming native Plane destruction automatically detaches.

Image and Plane `setPos` accept zero to three finite float32 numbers; `setDisp`
accepts an optional boolean or0/1. Each first updates its existing object-local MOT
manager, then samples omitted components and adds the real mode3 `pPos` or `pDisp`
script. The returned value is `undefined`. The record is busy immediately, before
its next object update writes the pose and ends it. A following setter in the same
callback consumes the prior record before sampling its defaults. Active records
retain the existing MOT traversal/order; there is no direct-pose shortcut or second
busy flag. General V8/string forms remain unsupported. Plane results publish through
existing physical Graph packets, and Image results update its existing draw fields.
The Image `disp` property is a distinct, independently proved immediate raw0/1
display/dirty store: a previously pending `setDisp` MOT can overwrite it on the next
update. Finite member assignment returns the original RHS, including through
pure-data host waits. Unknown properties and general JavaScript objects remain
unsupported.

Actual Draw aliases, typed borrowed references, position/display/dirty and the
caller banks restore with the full settled DTO before a warm frame, without
source/image/native-command/RNG replay. Pending setter MOTs retain their real
manager/instance state; fresh restoration may reread their immutable KCS without
executing it. Detach and close use actual Draw deletion
and NativeImages reference counts; they do not destroy borrowed owners or revive
late I/O. Owned tiny-HG3 tests check literal packets and actual bitmap pixels,
separately from the original SDK tutorial's still-required integration gate.
