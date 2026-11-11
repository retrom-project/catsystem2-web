# Native screen effects

`NativeScreenEffects` owns the ten task kinds, their Base identities, clocks,
activity, single callback slot, shared captures and private working textures.
`NativeScreenEffectRenderer` submits their phases through `StageRenderer`.

| Native task | Effect      | JS state                                                      |
| ----------- | ----------- | ------------------------------------------------------------- |
| 35          | Blur        | Two captures, transformed previous-frame feedback             |
| 36          | Mosaic      | Capture, reduced target, first-initialization geometry        |
| 37          | Shade       | The original 49-quad index collisions and radius weights      |
| 38          | Draw        | Captured frame alpha over the live priority range             |
| 39          | Wipe        | Shared bitmap alias and independent resized blue-channel mask |
| 50          | Wipe mosaic | Two private captures, discrete mirrored cache                 |
| 51          | Fade mosaic | Private capture, discrete resampling and alpha cache          |
| 52          | Break       | Shared RNG, triangle velocities and accumulated rotations     |
| 57          | Page flip   | Stored-f32 page mesh and curl projection                      |
| 58          | Cube flip   | Two face meshes, sweep band and background color              |

Task and sender IDs resolve through their Top namespace. SDK messages retain
the independently mapped screen ranges. Raw activity values, untouched reply
words, constructor capability gates, configured capture limits, deferred Wipe-mosaic registration and the
unstacked callback destruction rule follow the oracle. A task clock excludes
paused Base frames. Page/Cube advance during tick, Break advances during render,
and the final rendered frame clears the active flag.

The ordinary frame clears black and draws the full priority range. Blur,
Mosaic and Shade split background, captured middle and foreground. The other
transitions draw the live `[0, maximum)` underlay before their captured overlay,
then draw the foreground. Each pass preserves the original depth-clear order.
The outer view pause gate retains both backbuffer and presentation.

StageRenderer surfaces own RGBA and captured depth/stencil snapshots. Private
textures and mask pixels survive a fresh World restore independently of bitmap
aliases. A pending render/capture rejects checkpoints. The transitional device's
creation result initializes the shared JS depth/filter context before captures.
Original graph traversal remains the model producer until phase 6.6.

## FES projection

The five FES object/resource drivers and global commands remain in domain 7.
Their capture metadata and D3D target identities cross the registered
`oracle/fes-screen-effect-projection.mjs` boundary. JS publishes its shared slots
before FES execution and imports dirty producer pixels before task transport.
Private Wipe/Mosaic copies keep separate ownership when FES releases shared slots.
Mask import reuses the existing FES bitmap projection. This projection is removed
in phase 7.

## Evidence and limits

`tests/differential/screen-effect-vectors.test.mjs` compares submitted geometry
against both frozen EXEs and against the authored public vectors in
`tests/fixtures/native-screen-effect-vectors.json`. Norm x87 PC24/nearest follows
the ABI's normal D3D initialization. Colors are exact and finite coordinates,
rhw and UV have a one-f32-ULP bound. The fixture records source hashes and seeds.
The private oracle uses existing task and D3D submission APIs.

`tests/differential/screen-effect-pixels.test.mjs` compares Wipe and both mosaic
working textures byte for byte, including mask flags, odd duration, cache
selection and activity. Zero-duration Wipe fails during initialization in both
EXEs. Its JS initialization raises a RangeError at the same command.

Chromium exercises real WebGL blending, depth, sampling and coverage. The FES
integration test includes all five global effects, live-request reuse, an HG2
mask, pause retention and whole-frame hashes across a fresh World restore.
The separate WebGL differential uses an authored layered scene and a default
per-channel bound of one. Integer working textures retain their exact bound.

Game Cube multiplies the scaled grid height by its input height again. SDK uses
the scaled height. The existing per-version `capabilities` map records this as
`cubeFlipGridHeightProduct`. The format/identity/signature proposals from the ABI
survey remain pending. Default D16 attachments preserve the observed overlap
coverage. A captured depth attachment retains its format across restoration.

A prior multi-effect reuse oracle run exposed Break's uninitialized homogeneous
pivot field. The fresh-World authored vectors and layered WebGL fixture remain
finite. JS initializes the homogeneous pivot deterministically to zero. Raw
heap-history evidence stays in `.local/phase6/` for later review.
