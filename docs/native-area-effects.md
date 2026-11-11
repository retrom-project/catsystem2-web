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
upload path, also scheduled for removal in 6.6. These residual execution paths
remain visible in `b-migration.json`.

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
