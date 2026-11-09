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
fresh PE process. The tests also verify the allocator and task teardown. The
KCS message route and the tutorial's drawing, input and sound need their own
integration coverage.
