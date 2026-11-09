# Native SDK JavaScript

The frozen SDK engine embeds V8 3.26.16. The browser runs its original
mutex, default isolate and compiler table initialization, and the JavaScript
portion of WinMain's platform setup. The guest owns its isolate, executable
pages and ArrayBuffer allocator. The browser runs the original disposal
routine before closing the PE process.

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
input child, `3CF` runs the mounted script through the original filename
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
