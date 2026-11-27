# Native frame pacing

`src/native/frame-pacer.mjs` separates an observed host wait, the ordinary game
Frame word, and the raw step supplied to a task update. It does not create waits
or estimate their count from elapsed time. The fixed SDK23 Main442/443 binding requires the actual Script owner and a
known accumulator; an update without a qualified raw source remains protected.

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

An explicitly supplied `frameSource.now` selects this driver only for the
reviewed SDK23 profile. World startup loads its real Script without inventing
an initial tick. Each completed observed wait owns one task-graph update at
the supplied absolute Frame. The presentation owner must complete that packet
after rendering; the checkpoint boundary rejects a pending presentation.
Other SDKs and Worlds without that source retain their existing driver.

The Script's accumulator is initialized by its constructor and updated after
Base, before scheduler readiness, execution mode or completion checks. An
update without a qualified raw word marks the value unknown. This is not a
zero step. Snapshots retain this knownness and the actual u32 value with the
Script owner. Mode0 remains active, normal completion deactivates after its
current increment, and reenabled mode0 can keep a completed VM active. Neither
the field nor this source policy registers Main442/443 by itself.

The Core browser entry captures the mapped timer word synchronously when its
existing rAF callback returns. Queued input and asynchronous work cannot move
that return into a later bucket. `step(count, wait, timer)` consumes one owned
observation for this profile even when `count` is zero or greater than one;
other profiles retain the existing count loop. The normal renderer presents
each callback, then completes any dispatched packet. Component entry tests use
ordinary Core construction and standard in-memory host leaves; they establish
order and ownership, not physical GPU pixels.

Standalone checkpoint actions run after presentation, preserving their FIFO
position relative to input actions. Replacing a World invalidates the previous
World's callback; a restored World gets a fresh wait. The Runtime adapter stops
and awaits an inflight update and presentation before host suspension. Its
GAME_SAVE transport remains separate from the internal instant checkpoint.

The consumer tests drive the actual World graph: FES beforeStep starts and
updates its real MOT manager once at the absolute Frame; Particle constructors,
load/start wrappers and per-particle mains receive one update; STRING draws
with its previous elapsed time before adding the current Frame delta. A
same-bucket return preserves queued keyboard input, and an independent cold
FES/MOT continuation retains the timer phase and manager start tick. These
checks do not replace the original executable's factory and VM evidence.

Main442 resets the owned Script accumulator and returns control2 without
writing a VM output. Main443 returns control1 with `u32(x + (x >>> 2))`. Only
SDK23 registers these shared meanings. Successful reload keeps the same Script
word and rebinds the World's main-task alias to its newly loaded VM; a separate
Script constructor initializes a separate zero word. Current internal cold
state retains the exact u32 value and knownness with that owner.

The bounded true-host group executes23 total GCALLs,8 Script updates and3
normal mode messages using the unchanged original private bodies. It covers
zero/reset, a Frame jump with one raw increment, mode0, inactivity, resumption,
completion, reload and another Script. The browser source observation covers
24 natural rAF returns, actual UHD730 rendering and an independent cold
continuation. It observes no same-bucket return; that branch retains its
focused module and World-test qualification. Neither result is a Windows
Sleep measurement or a performance result.

The actual CSS GAME_SAVE writer and reader transport only the game's explicit
records. A fresh World and Script do not inherit this private accumulator from
a game file. The focused VM save/close/read test checks the original-format
record bytes and constructor state; it does not add fields to native saves.
