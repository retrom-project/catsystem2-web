# Native area effect controls

JS owns all fifteen area-task kinds and main `C4`–`CB`. `area-effect.mjs`
owns parameters, clocks, work bitmaps, graph bindings and checkpoint state.
`area-effect-pixels.mjs` computes integer pixels. `area-effect-geometry.mjs`
computes Raster, RainDrop and GlassBreak geometry through the reviewed normal
script precision state.

| Kind           | Semantics                                | State and output                                                                                                                                  |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17, 22, 23, 24 | UnderWater, Weather, WipeCircle, TileRev | Handled receiver leaves every reply unwritten. Logic is empty. Draw bookkeeping advances.                                                         |
| 21, 25         | Wipe, Hydro                              | Base kind/deletion messages remain visible. Effect controls have no receiver branch. Empty logic retains a pending task until owner/host removal. |
| 18             | Raster                                   | Single model vertex modifier, both axes, normal/converted frequency and period, live parameter updates.                                           |
| 19             | RainDrop                                 | Shared random stream, owned line vertices, per-frame movement, respawn, custom JS graph and line projection.                                      |
| 20             | GlassBreak                               | Borrowed live model triangles, owned shards, radial/angular velocity, cumulative transforms and bounded duration.                                 |
| 26, 27, 29, 30 | Wipe1, Fade, Wipe2, Wipe3                | Borrowed source/destination/mask, owned working pixels, destination upload at completion.                                                         |
| 28, 31         | WipeAlpha, WipeAlpha3                    | Source RGB with mask-driven alpha, both directions, previous working image at natural completion and computed endpoint at forced completion.      |

| Main slot | Arguments                 | Control | Canonical messages                                             |
| --------- | ------------------------- | ------- | -------------------------------------------------------------- |
| `C4`      | Task, VM packet           | 2       | 13, then kind-specific initializer                             |
| `C5`      | Task                      | 2       | 257                                                            |
| `C6`      | Task                      | 2       | 258                                                            |
| `C7`      | Task, VM matrix           | 2       | 262                                                            |
| `C8`      | Task                      | 1       | 259                                                            |
| `C9`      | Task, selector, VM packet | 2       | 13, then 264 for Raster or 273 for Hydro when selector is zero |
| `CA`      | Task, source pair         | 2       | 13, then 260 for Wipe1/Fade                                    |
| `CB`      | Task                      | 2       | 261                                                            |

Per-version message numbers come from the existing ABI message map. `C7`
reads and privately copies all 64 bytes before dispatch, including a zero
target. Initializers borrow translated VM storage and preserve the packet.
VM address zero is valid. Failed translation sends a null initializer.
`C9` still queries the kind when its selector is nonzero.

An unwritten `C8` preserves a stable caller identity. An existing task-memory
binding supplies its guest identity. A caller without that projection owns a
small JS raw-data identity cell, checkpointed and freed with the task. `C4`'s
unwritten kind query starts outside the effect-kind range. The wrapper
verifier normalizes this opaque dispatch-slot identity after checking the
original GCALL slot independently.

The fixed 2.6.1.23 build implements Main 201 through raw kind query 12
and then raw 238 for Raster or 247 for Hydro. A nonzero selector and a
different kind stop after the kind query. Hydro and Raster without a
renderer leave the parameters unread. A live Raster keeps its graph,
axis, active word and accumulated phase and reads only amplitude,
frequency and period from the translated packet. A missing kind reply
or an invalid packet for a live Raster raises a VM error before changing
the effect. The original can reuse the last kind reply from its local
stack. The Core uses the original x87 PC24 precision for the converted
parameters and advances the phase with per-tick truncation and one
frequency subtraction. Original raw outputs and the three fixed KCS
call sites are checked separately from product route smoke tests.

### SDK 2.6.1.63 / 2.6.1.67 matrix and live Raster controls

The two builds copy the initialized 64-byte Main 199 input into private storage
before sending raw 250 / 251. The reviewed Top, Script and Raster receivers leave
this message unhandled and its reply unwritten; the operation does not transform
those objects. Other matrix receivers remain guarded. Main 201 queries the kind
before testing its selector. A written Raster or Hydro kind and selector zero
send raw 252 / 253 or 261 / 262 respectively. A live Raster reads only the last
three parameter words, keeping its graph, axis, activity and phase. Hydro ignores
the packet. A nonzero selector stops after the query.

A Top receiver can leave the kind reply unwritten. The native wrapper then retains
its actual caller address and takes no effect branch. This capture does not give
the JS opaque task identity a numerical native address; the current query guard
remains. The native derived-receiver observation and the complete Base query reply
are separate evidence boundaries.

Both builds use the original x87 precision and default Raster period/speed. The
paired normal factory/VM group binds a real color Plane, starts, changes, stops
and retires the Raster through the actual Root logic walk, with eight independent
current cold continuations per build. Main 67 sends the deletion message through
the same receiver path in JS: Hydro's empty logic leaves the pending task alive
until its owner is released. Explicit host destruction keeps its separate forced
cleanup behavior. No physical GPU or independent Raster vertex output is claimed.

### SDK 2.6.1.23 finish, matrix copy and source replacement

Main 198, 199 and 202 use the shared controls with this build's typed message
mapping. Main 198 accepts the reviewed Wipe1/Fade kinds 26/27 and sends raw 232
(canonical 258). An uninitialized receiver returns without an upload. An
initialized receiver uploads its destination and clears activity, including a
repeat call after it has already stopped. Its reply word remains unwritten;
the wrapper returns control 2 without a value.

Main 199 translates its VM pointer and copies all 64 bytes to a distinct local
packet before dispatching raw 236. The reviewed Base kind 0 and area kinds 26/27
do not consume that matrix: their derived/Base dispatch returns unhandled and
leaves the output word unwritten. Later writes to the original VM storage cannot
change the copied packet. This preserves the wrapper's real memory operation
without adding a numerical transform or matrix state to these receivers. Other
receiver kinds remain protected.

Main 202 first obtains a written raw 12 kind reply. For kind 26/27 it translates
the five-DWORD packet and sends raw 234 (canonical 260); the receiver replaces
only the source and destination bitmap handles. It borrows both owners without
retaining or aliasing them and preserves its clock, work allocation and other
parameters. A different written kind returns before reading the packet. An
unwritten kind reply raises a VM error. Only kind 27 gains the separately
reviewed initializer mapping raw 249 to canonical 275; this mapping does not
enable another receiver kind or SDK build.

The original kind 27 initializer leaves its owned work pixels zeroed until
normal drawing. Kind 26 copies its initial source. That difference is a
2.6.1.23 ABI policy; the shared defaults for other builds stay unchanged.
The source, destination and mask owners must outlive the effect. Destroying
the effect releases its work image, and the creator Script's later destruction
releases its automatic bitmap list.

`tests/native-sdk23-areas.test.mjs` replays a compact fixture from complete
mode-1 view/Top/Script constructors, real Main 66 factories and 16 original
family GCALLs. It checks exact packet bits and reply knownness separately from
numeric state, live replacement pixels/alpha through ordinary VRAM output,
forced and repeated finish, two-level Script cleanup and two independent cold
continuations. Current-only guard tests cover wrong arity, unreviewed receiver
kinds and an unwritten kind reply. The original short group uses defined,
same-size RGBA inputs and zero origins. Other formats and geometry combinations
are outside this short group; existing format and storage-bound checks remain
in force. Unwritten kind replies and unreviewed receiver shapes remain protected.

The older differential vectors retain their declared private allocator/file-service
ports. A later normal-host group supplements them with original CRT, archive mount,
FileServer, Window/View and loaded VM dependencies, representative kind27 live
replacement/matrix-copy/finish calls and ordinary destruction. It keeps borrowed
input owners alive until the effect is retired and separates actual object lifetimes
from allocator address reuse. It does not extend the tested receiver or geometry
range; see the shared
[resource-host qualification](native-plane-sdk.md#original-resource-host-qualification).

CPU effects keep physical bitmap row addressing. WipeAlpha's work allocation,
mask offset, blend rectangle and upload rectangle remain distinct, including
the natural-end reset of its mask offset. The speed table is sampled on start.
Wipe3 updates borrowed fully transparent source RGB. FES-origin bitmap aliases
are explicitly imported at the existing D7 bitmap projection, refreshed before
calculation, and released on replacement, reinitialization and destruction.

The oracle demonstrates out-of-bounds writes and heap corruption for paired
Wipe effects with nonzero source origins and full-size measured work extents.
The JS implementation checks the borrowed storage bounds and raises a
`RangeError` for that undefined storage range. The private authored clipping
evidence is recorded in `.local/phase6/6.4-crop-evidence.log`.

Raster attaches a single modifier and removes it on stop/destruction. RainDrop
keeps its initialized allocation when parameters change and retains its random
stream through restore. GlassBreak reads the current triangles on each start,
keeps its shard allocation after completion, and detaches the model callback.
The original centroid's unwritten homogeneous word is represented as zero in
JS. Finite paired pivot/position cancellation and returned XYZW are covered by
the callback differential. The existing D3D observation API also recorded a
VRAM-scratch reuse case where that original word makes all output positions
NaN. JS initializes it deterministically. The authored finite GPU fixture
starts GlassBreak before unrelated VRAM transfer scratch, and the NaN evidence
is retained in `.local/phase6/6.4-glass-sdk-evidence.log`.

The existing Plane traversal remains until 6.6. During this interval,
`oracle/area-geometry-projection.mjs` adapts the existing model callback data
slot to JS geometry. It adds no instruction hooks or EXE function calls. Its
removal phase is 6.6. CPU finish uploads still reach the old texture-page
upload path, also scheduled for removal in 6.6. These historical projections now belong to explicit `oracle/` compositions;
ordinary output uses the shared JS renderer/VRAM owner.

## Verification

`scripts/verify-native-area-effect-commands.mjs` compares all eight JS wrappers
with the complete frozen wrappers at the existing observing transport. Both
ABIs run 7,288 cases, including unwritten replies, exact packet bits, VM aliases,
matrix copy isolation, null translations and canaries. It also retains the
existing original task lifecycle and receiver evidence.

`tests/differential/area-effect-pixels.test.mjs` compares integer working bytes,
rectangles, activity, forced finishes, speed selection and fresh JS continuation.
`area-effect-geometry.test.mjs` compares both axes/modes, initial and respawned
rain, shard callbacks and RNG. Finite geometry allows one f32 ULP. Integer
pixels, colors, packet bytes and random state are exact.

`tests/native-area-js-state.test.mjs` runs without private files and checks
empty receiver lifetimes, query identities, work ownership and fresh custom-graph
restoration. `tests/browser/native-area-effect.spec.mjs` compares the nine
rendering effects with the original in real WebGL, including a fresh World
halfway through each sequence. Floating blend/filter output allows one channel
value. Node tests independently cover the integer pixels and geometry.

Original implementations are retained in the unshipped `oracle/area-effect-*`
modules for differential evidence. Private EXEs and game assets stay outside Git.

### RGB24 boundaries

Fade and alpha receivers reject RGB24 source/destination/mask inputs before
activation, as verified on both ABIs over seven ticks. Wipe1/2/3 accept those
inputs, but their CPU loops step borrowed bitmap data in DWORDs. An eight-pixel
RGB24 row has 24 storage bytes while these loops access 32 bytes, including
beyond the final allocation. JS reports `RangeError` for these unsafe wipe
inputs instead of reading adjacent allocations. The differential fixture retains
original activation evidence and exercises the defined RGB32 path separately.
