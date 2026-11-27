# Native screen effects

`NativeScreenEffects` owns the ten task kinds, their Base identities, clocks,
activity, single callback slot, shared captures and private working textures.
`NativeScreenEffectRenderer` submits their phases through `StageRenderer`.

| Native task | Effect      | JS state                                                  |
| ----------- | ----------- | --------------------------------------------------------- |
| 35          | Blur        | Two captures, transformed previous-frame feedback         |
| 36          | Mosaic      | Capture, reduced target, first-initialization geometry    |
| 37          | Shade       | The original 49-quad index collisions and radius weights  |
| 38          | Draw        | Captured frame alpha over the live priority range         |
| 39          | Wipe        | Resized blue-channel mask and captured working alpha      |
| 50          | Wipe mosaic | Two private captures, discrete mirrored cache             |
| 51          | Fade mosaic | Private capture, discrete resampling and alpha cache      |
| 52          | Break       | Shared RNG, triangle velocities and accumulated rotations |
| 57          | Page flip   | Stored-f32 page mesh and curl projection                  |
| 58          | Cube flip   | Two face meshes, sweep band and background color          |

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

## Fixed SDK 2.6.1.23 Main 532

This one-word wrapper skips a zero target. A reviewed Base0 or Wipe39 target
receives raw354 (canonical389), which both the derived Wipe and Base receivers
leave unhandled. The reply remains unwritten; the wrapper returns control2.
It changes no Wipe activity, clock, parameters or owned resources and does not
finish the effect. The Core still routes the actual message and retains its
ordinary publication fences. Other receiver kinds and raw message namespaces
remain protected.

The original Base constructor leaves its current-frame word unwritten until an
ordinary update. The qualified fixture therefore runs the real parent/child
frame entry first, using authored Script carriers to avoid advancing the start
call prematurely. Frames100/102 reach the original Base writer and Wipe update;
the subsequent active call preserves current102, start100 and end104. Current
World VM tests preserve the same state through two independent cold continuations.
The earlier uninitialized-clock receipt remains historical and supplies no clock
value contract. This proof does not cover all Wipe timing/rendering shapes or
provide the separate raw-pacer input missing from Main442/443.

StageRenderer surfaces own RGBA and captured depth/stencil snapshots. Private
textures and mask pixels survive a fresh World restore independently of bitmap
aliases. A pending render/capture rejects checkpoints. The transitional device's
creation result initializes the shared JS depth/filter context before captures.
Original graph traversal remains the model producer until phase 6.6.

The reviewed 2.6.1.23, 2.6.1.63 and 2.6.1.67 Wipe receivers borrow the 32-bit
source long enough to make a private mask. Initialization resets working alpha
with the gradient calculation at elapsed zero. Stopping preserves both clock
words. The .23 receiver reads four initializer words and uses gradient mode.
The .63 and .67 receivers read a fifth word. It selects the threshold mode that
preserves cleared pixels across restarts.

| Build    | Raw query, initialize, start | Main wrappers      |
| -------- | ---------------------------- | ------------------ |
| 2.6.1.23 | 342, 352, 353                | 520, 530, 531      |
| 2.6.1.63 | 365, 375, 376                | 520, 530, 531, 905 |
| 2.6.1.67 | 366, 376, 377                | 520, 530, 531, 905 |

The shared receiver uses canonical messages 377, 387 and 388 for these
operations. Main530 and Main905 select the gradient and threshold modes,
respectively.

Shade uses a power-of-two capture in .23 and a logical-size capture in .63 and
.67 under the virtual device. Its vertices retain the original capture extent
and signed radius, capped at four. Main525 initializes Shade and Main526 writes
its raw activity word. Main529 sets the Draw finish latch. Those calls route
through canonical messages 382, 383 and 386.

Draw retimes an active fade on initialization and retains both clock words on
stop. These three builds bound the unsigned elapsed word by the absolute end
before multiplying it by 255. Wrapped frames can therefore retain an
intermediate alpha at completion.

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
