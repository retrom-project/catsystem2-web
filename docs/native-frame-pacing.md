# Native frame pacing

`src/native/frame-pacer.mjs` separates an observed host wait, the ordinary game
Frame word, and the raw step supplied to a task update. It does not create waits
or estimate their count from elapsed time. Main442/443 remain protected until
the complete SDK23 source, dispatch and Script contracts have been validated.

For the fixed SDK2.6.1.23 executable `9f3a5ad0…`, the dispatcher completes its
pacer loop, calls the Root update once with two independent words, and draws.
An ordinary Frame jump does not request extra Script, FES, MOT or particle
program invocations. Other builds do not inherit this scheduling admission.

The captured rate comes from Settings `+0x5908`: startup `SCREEN/fps`, optionally
overridden by setup `WINDOW/fps`. `Src` is Settings `+0x210`. Its word4870 is
Settings `+0x4e28`, initialized to zero and loaded from `SCREEN/no_skip`.
Consequently the default mode advances ordinary Frame by
`u32(60 * bucketDelta) / rate`; `no_skip` advances it by `60 / rate` per
iteration. Both integer divisions truncate. This mode does not select the
Script's active state or implement a browser host suspension.

Each actual cooperative-wait return supplies one sampled timer DWORD. The
Q32 bucket divisor is `floor((1000 << 32) / rate)`. A return in the same bucket
increments the 64-bit wait counter. The return which leaves the bucket does
not increment it. The current dispatch receives the previously published raw
step, initially zero. Completing the dispatch publishes
`u32(1 + (waitCount >> 2))` and retains `waitCount & 3` for the following one.
There is no default step when a host has not supplied a wait observation.

Wait and dispatch objects are owned by one pacer instance. A dispatch must
settle before another wait or a checkpoint. A pending host callback itself is
an external lease and is not serialized. Cold restoration retains the saved
timer phase, counter and delayed step; the shared system clock must map actual
new-host timer samples onto the saved clock origin. It must not calculate wait
counts from that timer delta. Explicit host suspension cancels a pending lease
and reanchors on resume without inventing background returns. Native pause
continues to observe waits while holding ordinary Frame.

Browser rAF and Windows `Sleep(1)` are different cooperative-wait leaves. Their
observed numbers depend on the scheduler; the browser backend does not recreate
hidden Windows returns. This does not alter the original CSS `GAME_SAVE`
writer/reader or add private timing fields to game files. The current internal
checkpoint remains an in-place development contract.

The focused pacer tests cover delayed publication, carry, both Frame modes,
different wait sequences with equal timer endpoints, native pause, host
suspension and an independent serialized cold continuation. They are module
tests, not complete browser or original-dispatch acceptance.
