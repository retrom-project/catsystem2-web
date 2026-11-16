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
than applying unreviewed Annex B semantics. The only host import is `cfExit`
from a running callback, with an
integer first argument or no argument (code zero). It updates the exit code and
clears running, then returns `undefined` normally: the current JavaScript call
continues, while subsequent logic frames do not call `GameLoop` again.
`GameLoop` receives the task's actual logic frame. Loaded/running state follows
successful program execution and its exit completion, rather than writable
emulations of process fields. Unsupported syntax and host imports fail with
the source filename and span. Relinking, reloading, missing-source behavior,
`3D0`/`3EE`, arbitrary host waits, and the official tutorial's image/plane/sound
imports remain outside this finite slice.

Checkpoints retain the program, lexical cells and closure references as data.
Fresh restore does not execute source or callbacks, reload resources, or borrow
the old World's mutable cells. Snapshots require a completed callback; an
instruction-budget pause is not a finished frame. Close discards this task's
VM and links while Base destruction releases its child. Calling Script banks
are borrowed from the real runtime and remain owned by that Script.

The explicit original-engine adapter below remains an oracle path when a
World already has `nativeEngine` or `nativeEngineLoading`. Original World
fixtures open that owner explicitly before creating kind 55. Its original
class and executable assertions remain unchanged. Ordinary execution never
falls back to it on an unsupported program.

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
