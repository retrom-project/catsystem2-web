# Native SDK JavaScript

The ordinary SDK kind 55 owner executes a finite JavaScript subset using a
tokenizer, compiler and data-only instruction interpreter. It does not pass
source to `eval`, `Function`, an embedded V8 or another JavaScript engine.
KCS creates the real task with `42`, links its calling Script with `3CE`, and
loads through the `javascript` resource category with `3CF`. Link and load
retain control 2 with no VM output. Link creates the actual kind 6 base
image-plane child named `js base button`; it is not a second Input owner.
The link then sends the actual rectangle/ancestor-depth packet and enables
that child's region through its existing typed Input owner. Both messages keep
transport flags 1; the rectangle's sixth word is separate Input metadata.

This first slice supports function and `var` declarations, lexical function
expressions and closures, parameters, return, assignment, increment,
arithmetic, strict equality, conditional blocks and calls. Structural tokens
are distinguished from quoted strings, including keyword and delimiter text.
Function declarations directly in a program or function body are hoisted;
block and conditional function declarations fail with a source span rather
than applying unreviewed Annex B semantics. The `CsImage` constructor and its
finite member-call slice are described below. The other host import is `cfExit`
from a running callback, with an
integer first argument or no argument (code zero). It updates the exit code and
clears running, then returns `undefined` normally: the current JavaScript call
continues, while subsequent logic frames do not call `GameLoop` again.
`GameLoop` receives the task's actual logic frame. Loaded/running state follows
successful program execution and its exit completion, rather than writable
emulations of process fields. Unsupported syntax and host imports fail with
the source filename and span. Relinking, reloading, missing-source behavior,
`3D0`/`3EE`, arbitrary host waits, and the official tutorial's plane/sound,
position, display and MOT APIs remain outside this finite slice.

Checkpoints retain the program, lexical cells and closure references as data.
Fresh restore does not execute source or callbacks, reload resources, or borrow
the old World's mutable cells. Snapshots require a completed callback; an
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
source extents. No position, display, plane, animation or drawing API is enabled.

A host load suspends the data interpreter at its call continuation. Only the
adapter awaits the real IO Promise; its result resumes that call once, before
any following guest statement. Pending IO is not a completed logic frame and
cannot be checkpointed. A settled checkpoint saves typed references and the
existing real bitmap outputs; fresh restore does not construct, reload, execute
source, publish commands or draw RNG values.

Without `setPlane`, the original CsImage virtual callback returns before its
raw `113`/`11C`/`126` draw publications. This leaf therefore creates no drawable.
Close still sends SDK raw `114` (Script canonical `278`) with the real calling
Script target, JavaScript sender, context slot and flags zero. The ordinary
Script/Base drawing consumer remains unimplemented; an unhandled transport
result is not deletion success. Returning the local slot and releasing its owned
bitmap are separate operations and do occur. The borrowed Script is retained;
nonzero borrowed planes are outside this slice. IO completing after owner close
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

The official tutorial browser test enters through the original title and
choice menus. Its original `CsPlane` moves while the soundtrack plays. The
test restores mid-motion into a fresh process with the same rendered pixels,
verifies the plane advances and hides at the end of its 300-frame motion,
then waits for the original sound stop fade and the return to the scene.

The finite normal SDK host also accepts `new CsPlane(width, height, u, v, priority)`
with five signed32 integers and positive dimensions. Omitted arguments and other
methods, including motion methods, remain unsupported with source spans. The own
constructor creates a real kind2 child under the kind55 controller, not under its
borrowed calling Script. The returned native task ID is resolved separately from
its World ID. For nonzero child IDs, existing graphics packets create a VRAM type1 graph and preserve the
independent w1 texture-position and w0 physical vectors, and start with display0.
This does not create a solid-rectangle substitute or implement CsImage.setPlane.

Plane host references use the existing NativeHandles registry and point to actual
World children. Graph/MOT/Input state stays in its existing authority. Constructor
service waits use the existing pure-data VM continuation; closing the owner while
creation is pending releases the late child before any guest continuation. Close
preserves the native child-ID0 guard; for nonzero IDs it sends canonical3. It
releases the actual owned child while retaining the borrowed Script.
Settled fresh restore validates both CsImage and CsPlane references and restores
actual graph state without source, image, command or RNG replay. This finite leaf
does not establish arbitrary V8 conversion, default constructor arguments, motion
execution, or the official scene's complete drawing path.

## Finite CsPlane motion and Context busy query

The normal SDK kind55 host supports `CsPlane.motMove(duration, x, y, z)`
and the no-argument `cfIsExecMotion()`. Duration is a signed32 integer,
default30; the selected MOT script clamps values below1 to1. Coordinates are
finite float32 numbers or omitted current values. The result is `undefined`,
not a native pointer or a manager handle. Selector arguments to the global
query, general V8 coercions/string shorthand, other curves and `cfWait` remain
explicitly unsupported. This slice does not run the complete official tutorial.

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

The global query scans the current Context's supported type1 objects and reads
real manager activity. It is independent of Graph kind numbers and of a supplied
single Plane; the current CsImage slice has an empty manager and no enabled MOT
methods. Ordinary tick order is GameLoop followed by object motion/publication,
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
