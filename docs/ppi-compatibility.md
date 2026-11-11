# Particle, plug-in, motion, and effect compatibility

This document is the implementation contract for CatSystem2 particle effects. A
game-name or effect-name switch is not a substitute for executing its script or
plug-in. Completion requires the execution, renderer, lifecycle, and persistence
contracts below. Passing one game's route does not establish this coverage.

## Evidence and current implementation

The fixed source oracle is SDK 4.01, bundle SHA-256
`411e9dbb86e3f81697327fafa4b2f3cad4e2719fbc3cc734234b75830f686b35`.
Public ABI declarations come from `tool/パーティクル作成SDK`, `system/ptcl`, and
the [official particle plug-in manual](https://cs2.suki.jp/manual/data/plugin/particle.html).
The SDK contains nine plug-in development files, the single compiled
`sample_rain.ppi`, 111 paired particle `.wss`/`.kcs` files, and two stock `.kx2`
meshes. The compiled sample reports PPI 1.0, which the inspected native loader
does not accept; the adjacent source/header declare 2.1. Do not infer a usable
2.1 binary from that sample filename. The stock rain C++ source is an independent lifecycle/frame-delta oracle.

Native addresses in this document identify the prepared NEKOPARA3 engine
2.6.1.76, SHA-256
`ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0`.
They describe that binary, rather than promising that every CatSystem2 release
uses identical addresses or internal object offsets. The shipped SDK engine is
2.6.1.74 and remains a separate comparison target.

The maintained interfaces are:

- `src/ppi/abi.mjs`: little-endian PPI/PTCL records and initial geometry.
- `src/ppi/contracts.mjs`: all 51 PTCL native slots and all 35 PPI 2.2 host slots,
  including signatures, minimum versions, native handler addresses, and KCS
  callback control codes.
- `src/ppi/script.mjs`: all 51 PTCL natives, persistent per-effect VM data,
  per-particle main invocation, attachment, geometry, and snapshots.
- `src/ppi/numeric.mjs`: recovered float32 operation order, frame conversion,
  clamped interpolation, signed triangle wave, rounding, and vector rotations.
- `src/ppi/random.mjs`: native old-initializer MT19937, independent integer/real
  streams, and complete serializable state.
- `src/ppi/pe32.mjs`, `native-services.mjs`, `native-runtime.mjs`, and `native.mjs`:
  actual PE32 loading and x86 execution, Windows ABI services, shared DLL and
  instance lifecycle, and complete guest-process checkpoints.
- `src/particles.mjs`: one shared particle bank owner for CST and native task
  messages, resource loading, 32 registers, frame clocks, alpha/fade and saves.
- `src/native/particles.mjs`: the original kind-16 task factory and eight main
  native wrappers, installed in `NativeWorld` with shared DLL state.
- `src/ppi/render-state.mjs`: independent mode/blend caches and original render,
  texture-stage, and sampler state profiles.
- `src/ppi/geometry.mjs` and `src/render/particles-gl.mjs`: the native XYZRHW
  transform path, arbitrary textured quads, destination-dependent blend factors,
  per-corner colors, alpha/depth/stencil state, and sampler addressing.
- `docs/ppi-coverage.json`: machine-readable source inventory and outstanding
  integration coverage. A recovered declaration is not marked as executed.

All 51 particle native handlers and the 35-slot PPI 2.2 vtable were inspected
statically. Random, rounding, triangle-wave, UV, and perspective-query cases were additionally executed
from the original PE's x86 instructions in a minimal Linux ELF harness under
`qemu-i386`. Raw PE-derived files, disassembly, and execution output belong in
ignored `.local/ppi-audit/`, outside Git. No FelineSystem2 implementation or game
assets are distributed by these modules.

The generic executor ran all 111 SDK particle bytecodes and all 17 test-game
particle bytecodes at frames 0/1/2/15/60/61 with 4 particles and test registers.
Restoring a snapshot produced identical subsequent quad bytes and VM memory
for every program. These are execution/continuation checks, not image comparisons
or proof that each test register set produces the intended visual effect.

The former five named-effect approximations have been removed. The runtime
executes supplied PTCL bytecode or PPI DLL instructions and renders their vertex
records. Native record equivalence and graphics equivalence remain separate
claims: the former has original-DLL evidence below; the GPU has39 independent
D3D9 raster probes. Whole-game native image equivalence remains a separate
acceptance requirement.

## Three execution families

| Family                   | Entry                                  | Native interface                            | Required state                                              |
| ------------------------ | -------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `particle` / `particle2` | KCS `main()` for each particle         | PTCL 1.0: 44 slots; PTCL 2.0: 51 slots      | Persistent VM data and per-particle vertices/transforms     |
| `particle3`              | PE DLL instance `Init`, `Exec`, `Stop` | PPI 2.0: 31 virtual slots; 2.1: 32; 2.2: 35 | Native instance/heap, PPI records, host services            |
| MOT                      | KCS motion program                     | Generic table and motion shared data        | Coroutine state, parameters, target image/plane/sound state |

The scene syntax supplies bank, executable/script, texture, particle count,
priority, and up to 32 float registers. `particle2` and `particle3` additionally
supply an attached plane. The attachment exposes plane information; the script
or plug-in decides how to use it. The host must not automatically add the plane
position a second time. Particle banks are documented as 0–3. Commands also
support `stop`, register `set`, `alpha`, and frame-based `fade`.
See [particle](https://cs2.suki.jp/manual/scene/reference/effect/particle.html),
[particle2](https://cs2.suki.jp/manual/scene/reference/effect/particle2.html), and
[particle3](https://cs2.suki.jp/manual/scene/reference/effect/particle3.html).

## KCS particle ABI and invocation

The KCS file's script version uses unsigned 16-bit major/minor fields at byte
offsets 8/10. Native `sub_877060` packs them as `(major << 16) | minor`.
The SDK corpus contains 25 version 1.0 and 86 version 2.0 particle scripts. The
loader at `0x5f58f0` selects table `0xa40778` for exactly `0x20000`, otherwise
the 44-slot table at `0xa406c0`. The KCS container format version at offset4
is separate from this script ABI version.

The SDK `.def` wrapper defines `main()` with no arguments. It reads
`GetFrame`, `GetBeforeFrame`, `GetNow`, `GetBox`, and `GetPos`. Frame 0 invokes
the script's `Initialize(now, vertices)` for every particle. Later frames invoke
`Exec(before, frame, now, vertices)`. After either callback it writes the quad
and position back. At particle 0 it refreshes the shared 32 initialization
registers, and on initialization it also reads screen dimensions. These are
ordinary compiled script operations, not host shortcuts.

The same VM data region survives invocations and is shared by the particles in
one effect. Scripts keep arrays indexed by particle number and shared globals
such as `fReg`, `fScreenX/Y`, and `dwOldFrame`. Starting `main` resets the
execution stack/frame while retaining initialized and mutated data. Recreating
the VM for each particle or frame destroys the effect's state.

The engine's current-particle index is exposed by `GetNow`. `GetPos` and
`SetPos` access that particle's float3 position in a 16-byte record, not a
single emitter-wide position. `GetBox`/`SetBox` copy exactly 112 bytes: four
KCS `VERTEX` records of 28 bytes:

| Offset   | Type    | Value               |
| -------- | ------- | ------------------- |
| 0,4,8,12 | float32 | x,y,z,w             |
| 16       | uint32  | packed vertex color |
| 20,24    | float32 | u,v                 |

Initial corner order is top-left, top-right, bottom-left, bottom-right, with
coordinates `(0,0)`, `(width,0)`, `(0,height)`, `(width,height)`, w=1, white
color, and full-image normalized UVs. Per-particle position/base/rotation start
at 0, scale at 1, and visibility at1. The backup quad initially equals this quad
(`0x5f6240`).

Every GCALL has an explicit control result. A scalar native returns1 and pushes
its output; a void native returns2 and does not push; particle `exit` returns4,
marks the effect inactive, and suspends. In particular, SDK declarations for
`GetAttachBase` and `GetAttachPos` say `long`, but native handlers return control2
and only write the pointer outputs. Declared return type alone is not an
execution oracle.

The complete slot list is in `PTCL_NATIVE_CONTRACTS`. Its groups are debug/frame
and screen queries0–5, math6–21, quad rotation/translation/scaling22–26,
position/texture/quad access27–31, termination/RNG/register/index32–36,
distance/projection/visibility/count37–40, interpolation/round/wave41–43,
and V2 backup/attachment/blend44–50. The stock corpus calls32 distinct slots;
the other19 declared slots still belong to the contract.

Native details that need explicit handling:

- `GetMax()` returns `count - 1`, including unsigned underflow for count 0.
- `CalcFrame(0)` returns0; a value with bit31 set passes through. Other values
  become at least 1 after float32 `fps/60 * frame` and unsigned truncation.
- `SetShow(no, value)` changes only an in-range particle.
- `ResetVertex(no)` and `BackupVertex(no)` ignore `no` in this native version
  and copy all `112 * count` bytes between live and backup storage.
- Missing attachment (-1) produces zero attachment coordinates/visibility.
- `SetBlendMode` accepts modes 1–5 and maps all other values to normal 0.
- `SetTex`'s SDK signature says four `long` values, but the inspected handler
  uses floating loads, ignores the second/fourth parameters, subtracts0.5,
  and updates current UVs. Original-instruction probes verify both raw integer
  words and float-encoded inputs; `ParticleScriptInstance` preserves this
  behavior rather than correcting the SDK declaration.
- `ParsScreen` builds the diagonal perspective matrix, inverts it, then
  transforms the half-viewport vector. The scalar D3DX inverse rounds the
  diagonal cofactor, reciprocal determinant and final inverse scale at
  separate float32 stores. Game `65B190` and SDK `52B0D0` are shared by
  their version 1 and 2 tables. Engine-side JS uses normal PC24/nearest
  precision. The oracle retains evidence for six x87/MXCSR settings and
  alternate dispatch tables. The direct oracle covers the zero denominator,
  singular inverse, large negative depth and six floating-point settings.

The PTCL frame comparison runs the fixed SDK's `snow.kcs` (version 2) and
`wind.kcs` (version 1) through each original engine's task constructor,
loader, Start message and frame callback. Both programs match the
browser's complete quad, backup, transform, visibility, VM data and
random stream state at the six sampled frames.

The Chromium test takes the original 100-particle arguments from SDK
`spl2_ptc.cst`. Each original PE and the mounted browser World load
`fg_snow.hg3` independently and compare the uploaded atlas, DrawUP quads
and full frame pixels. The JS bank decodes and uploads an owned 32×32
StageRenderer surface while the script reads the cropped 21×22 dimensions.
Its JPEG reader uses IJG integer IFAST and integer YCbCr conversion. The
original JPEG helper writes RGB directly into BGR storage, so the JS reader
preserves that channel order and converts physical rows into logical rows.
Four authored baseline/progressive, 4:4:4/4:2:0 fixtures compare every byte
against both original bitmap decoders. The private snow atlas also matches
exactly, including transparent pixels. A fresh World restores the surface
without decoding again. Reload/destruction release that bank's surface.

The original task keeps the image dimensions and depth priority when its
texture name is empty. A nonempty name that fails to open stores 256×256
and the new depth priority. The external-draw branch preserves those three
fields and the previous focal depth. Normal draws recompute focal depth
from the incoming priority and retain that priority separately for layer
ordering. Both original receivers are exercised through these reloads.
An asymmetric HG2 also checks the original upload's row direction.

## PPI DLL ABI

A PPI is a32-bit Windows DLL, loaded by ordinal:1 `MakeInstance`,2
`ReleaseInstance`,3 `GetPluginVersion`,4 `GetPluginType`. Type 1 is a particle
plug-in. The loader supports versions `0x20000`, `0x20001`, and `0x20002`.
The fixed public SDK declares2.1; the game also ships2.2 plug-ins.

The MSVC object has a vtable pointer at 0, context pointer at 4, host-function
pointer at 8, particle-array pointer at 12, blend mode at 16, attached plane at 20,
attached base float3 at 24, attached position float3 at 36, and attached visibility
BOOL at 48. The base object occupies 52 bytes before subclass fields. Its virtual
order is destructor, `Init`, `Exec`, `Stop`. Function pointers and Windows
`LONG`, `DWORD`, and `BOOL` are32 bits. Native methods use the x86 member-call
ABI; floating return values require the native x87 convention, not a JavaScript
integer return register.

`INITPARAM`, `EXECPARAM`, and `STOPPARAM` are each 148 bytes:

| Offset | Type        | Value                       |
| ------ | ----------- | --------------------------- |
| 0      | uint32      | particle count              |
| 4,8    | float32     | screen width/height         |
| 12,16  | float32     | particle image width/height |
| 20     | float32[32] | supplied registers          |

Each PPI `PARTICLE` also occupies 148 bytes, but has a different layout:
four 24-byte vertices at 0, base float3 at 96, position float3 at 108, rotation
float3 at 120, scale float3 at 132, BOOL visibility at 144. A PPI vertex contains
xyz at0/4/8, raw color bytes at 12, UVs at16/20, and no w component. The SDK
`COLOR` union declares byte order r,g,b,a. Preserve the raw color word across
the PPI/PTCL bridge; do not silently reinterpret it according to a canvas
library's channel order.

The native bridge at `0x5f69b0` copies engine state into PPI records on creation.
After `Exec`, `0x5f6650` copies them back into the engine's quad and separate
transform/visibility arrays, supplying w=1. It also copies the plug-in's blend
mode. Vertex colors, UVs, visibility and all transform axes are writable.
The [official structure](https://cs2.suki.jp/manual/data/plugin/struct.html)
and [polygon](https://cs2.suki.jp/manual/data/plugin/outline.html) manuals
confirm that individual corners may form arbitrary quadrilaterals.

Host slots 0–30 provide screen/termination, RNG, math, vector math, interpolation,
and triangle wave. Version2.1 adds slot 31 `SetZShift(context, no, float)`.
Version2.2 adds three functions absent from the public SDK header: slot 32 loads
data from the `ptcldat` resource category,33 records a D3D render state/value,
and 34 records a sampler-0 state/value. Their descriptive names in the
catalog are inferred from the native bodies and renderer calls. Their ABI and
effects are supported by static native evidence.

`PPF.abs` is an observed native anomaly: slot 19 at `0x65c370` loads the object's
vtable and tail-jumps to offset0x4c, the same slot. It is not the ordinary
PTCL `abs32` handler. `VecRotateXYZ` in the fixed SDK takes one angle, while
the older manual describes three. Preserve version-specific interfaces and
verify actual callers before resolving such discrepancies.

## Original DLL execution and shared process state

`NativePPIRuntime.open({unicornFactory, random, clock, now, epoch})` creates one guest
process for a game. `runtime.create(bytes, options)` creates a particle instance;
`options.autoStart: false` loads it without calling `Init`. Its methods are
`start()`, `exec(before, frame)`, `update(frame)`, `stop()`, `records()`,
`particles()`, and `close()`. It exposes `blendMode`, `zShifts`, `renderStates`,
and `samplerStates`. `NativePPI.open(bytes, options)` is the convenience form for
an instance with its own process. No plug-in filename selects an implementation.

The PE32 loader maps sections, resolves named/ordinal exports and imported
functions, applies HIGHLOW relocations, initializes static TLS and callbacks,
and executes the original `DllMain`, `MakeInstance`, `Init`, `Exec`, `Stop`,
`ReleaseInstance`, and detach callbacks. The CPU establishes a masked x87 control
word and SSE2 state. PPF float callbacks return through the real x87 stack;
zero-argument `rand`/`frand` must not pop a nonexistent stack argument.

Simultaneous instances share a DLL's writable statics, CRT heap/TLS, and engine
random streams. The final reference releases the DLL and runs detach; a later
load starts its statics anew. The loader relocates different DLLs whose preferred
addresses collide. A reference/identity mismatch is an error.

`runtime.snapshot()` captures all live instances and process memory, GPR/x87/
XMM registers, heap/free blocks, module identities, static/dynamic TLS, Windows
heap ownership, virtual pages/protections, error/lock state, PPF state, clocks,
and shared RNG. Zero memory blocks are omitted and remaining blocks use base64
so save-size checks do not expand each typed-array element into a JSON property.
`runtime.restore(state)` requires the same live module/instance topology.
`NativePPIRuntime.fromSnapshot(state, {unicornFactory, readPlugin,
instanceOptions})` verifies each DLL's SHA-256, rebuilds its mappings and host
function identities, and rebinds saved instances directly to their private
objects. It does not rerun those objects' `Init` callbacks. Use the runtime
snapshot when several banks share native state.

The browser CPU backend is rebuilt from pinned upstream source with maintained
TCI/helper/page-protection fixes; see `third_party/unicorn/README.md` and
`scripts/prepare-ppi-backend.py`. `.local/vendor/ppi/manifest.json` identifies the
exact backend and complete corresponding-source archive. The generated backend
is GPL-2.0; existing project MPL notices remain intact. Distribution must retain
applicable notices and provide the corresponding source alongside the backend.

The independent Wine oracle loads the same original DLLs and calls the frozen
engine's original PPF math/RNG routines. All 12 frozen game plug-ins match all
4,144 output bytes each: four 148-byte particles after `Init` and six updates
at frames 0/1/2/15/60/61. The tests use fixed registers, attachment, and seed4357.
`cmnptcl` receives a complete authored ParticleDesigner plist, not a game asset;
omitted plist fields can expose uninitialized plug-in data. No target-game
particle-data file has been invented to hide a missing resource.

Reproduce the native records with:

```sh
python3 scripts/native-ppi-wine-oracle.py \
  --exe /path/to/frozen/analysis/binaries/NEKOPARAvol3.exe \
  --plugins /path/to/frozen/analysis/game/ptclpi \
  --emsdk /path/to/emsdk-3.1.74 \
  --output .local/ppi-audit/wine
CATSYSTEM2_PPI_FIXTURES=/path/to/frozen/analysis/game/ptclpi \
  node --test tests/ppi-native.test.mjs
```

The Wine container image is pinned by SHA-256. Its composite main image privately
reserves the original engine's preferred VA; it does not start the complete game.
Screen, termination and resource callbacks are explicit authored test services.
Z-shift/custom-state callbacks reject that bounded oracle rather than pretending
to verify native rendering. Generated composite PE files remain ignored.
Golden hashes and the authored plist are public test inputs, without DLL bytes.

The Windows service profile implements private/process heaps, virtual reserve/
commit/protect/decommit/release, TLS, pointer encoding, single-thread critical
sections/interlocked operations, clocks, module/export lookup, CP932/Unicode
conversion and CRT locale services. Unimplemented imports, exception dispatch,
guard pages, or unsupported locale capabilities fail explicitly. This profile
is not a complete Windows implementation; the 12-DLL evidence establishes only
its exercised native paths, not every possible import or NLS input.

## Scene ownership and native task messages

`Particles(stage, {game, images, random, fps, attachment})` owns one bank map and
one shared native runtime. Its scene entry is `await command(verb, args)` for
`particle`, `particle2`, and `particle3`. `update(stage.frame)` advances native
frames; `drawItems()` returns priority/order items whose `drawGPU(gpu)` function
participates in the stage's sorted draw list. `StageRenderer` and native graph
tasks share one RGBA8/depth/stencil target through `beginFrame`, `drawGeometry`,
and `endFrame`. A native-plane-plus-x86-particle browser test verifies that the
second draw's `DESTALPHA` factor sees the first draw's actual target alpha.

The native API is `create(key)`, `load(key, spec)`, `start(key)`, `stop(key)`,
`end(key)`, `set(key, registers)`, `alpha(key, value)`, `attach(key, graph)`,
`get(key)`, and `busy(key)`. `message(key, message, payload)` dispatches native
**task messages**0x13a–0x141; these numbers are not main-VM GCALL IDs. The native
GCALL bindings in 2.6.1.76 are load0x10f, PPI load0x2b5, start0x110, stop0x111,
active0x112, registers0x113, alpha0x1aa and attach0x1ab.

Factory `0x5ddcb0` case16 constructs `0x5f4b50`; PTCL and PPI use the same
`kcTaskParticle` class. `installNativeParticles(world)` installs this factory
and the eight wrappers. Each task ticks only its own bank at its effective frame.
The native tick executes callbacks even when the counter is unchanged; the
integer frame multiplier and prior counter are retained. Repeated stop messages
call `Stop` repeatedly; destruction releases without inventing another `Stop`.
Load resets resources and counters while retaining the native active flag.
`NativeWorld` saves the shared guest process once and restores it after the
task graph, preserving interleaved DLL globals/RNG across live tasks.

The actual CST wrappers in both fixed copies of `sscript.kcs` recognize
`stop`, `set`, `alpha` and `fade`. All three commands address one eight-slot
table. The original stop-all loops use four entries for `particle` and eight
for `particle2` and `particle3`: the comparison PCs are `0702C8`, `072769`,
`07A5E7` in the SDK and `0736D3`, `075B74`, `07DB31` in the game. The
shared update loop loads both PTCL and PPI from the upper slots. The portable
command path supports explicit banks 0–7 and uses the same stop-all limits.
Run `node scripts/verify-native-particle-banks.mjs FIXTURE_ROOT` to exercise
those original blocks from both pinned scripts. `set` clears all 32 registers
before copying the supplied values. Alpha defaults to255; fade defaults to
30 frames, from0 to255. Fade records its origin on the first owner tick and
clears only the fade flag at its endpoint. It does not destroy a still-active
particle when alpha reaches0. CST `stop` calls the effect's stop callback and
releases the bank. Bare `start/end/init/load/file` have not been established as
CST particle subcommands; lower-level lifecycle methods cover those operations.
The previous `ptcl`/`ptclp` aliases had no original-script evidence and are not
accepted as invented scene commands.

The FES `PARTICLE` object uses the same task type. The original 348-byte
object constructors (`5EFFD0` in the SDK, `74FDF0` in the game) and resource
allocation routines (`500390` / `628D60`) create one `FE Particle` child per
object. The resource-list frame drivers invoke `5310E0` / `6616F0` to send
the load, registers, alpha, start, stop, busy and attachment packets.
The SDK packet IDs in that range are five lower. The browser tests exercise
both families from FES commands and compare rendered pixels after restoring
an active attached effect in a fresh World.

For CST attachment, the original wrapper selects plane index+27 from its unified
scene graph and supplies that graph handle to the particle task. The attachment
provider receives `(id, {namespace, bank})` and returns `{id,base,pos,disp}`;
CST namespace requires its resolved native graph ID. An unavailable provider
or an unresolved CST plane mapping produces a diagnostic. HG3 texture
dimensions use the cropped `stdinfo` width/height, as confirmed by original
image loader stores and `sub_68cdc0`. Logical canvas width and height are
separate metadata.

For a native graph handle, the PPI callback adapter follows game
`5F6560` and SDK `4D0DA0`. Each Init, Exec and Stop reads the current
base, position and visibility from the view. A missing model preserves the
DLL object's previous values while the graph handle stays in the attachment
field. Passing zero to the attachment command selects `-1` and clears all
seven values on the next callback. The DLL heap preserves these fields
across a checkpoint.

The final screen matrix belongs to the global graph manager:
`0x67c4d0` uses manager+0x60 and shifts+0xe4/+0xe8. Particles read
`stage.nativeGraphics.projection()` like native graph tasks. Their own
`0x5f5280` projection retains its explicit1000-unit focal argument.

## Lifecycle, clock, and random state

Mounted Worlds pass the same [system clock](native-clock.md) to the original
engine process and PPI runtimes. Windows elapsed-time APIs, QPC and UTC FILETIME
therefore share one saved authority. Default virtual time accumulates each
frame's duration exactly across FPS changes; task and PPF frame counters remain
separate. Standalone numeric oracles retain their explicit zero-time injection.

Start/load, active/stop, and destruction are separate operations. Native task
messages0x13a–0x141 load/reset, start, stop, release, query active state, replace
registers, set alpha, and set attachment. Loading releases prior resources.
Starting resets geometry and calls the PPI `Init` with current attachment and
register information. An active PPI receives `Exec` each update; its first
`Exec` has frame 0 and before=`0xffffffff`. Later updates pass the previous and
current counters. Stop calls `Stop` before resource teardown; the SDK sample's
empty `Stop` is a sample choice, not permission to omit the callback globally.
See the [callback manual](https://cs2.suki.jp/manual/data/plugin/code.html).

Use the engine's frame counters and preserve dropped-frame deltas. The stock
rain example multiplies direction by `frame-before`; one update per browser
RAF is not equivalent. Attachment snapshots and current registers refresh
before native callbacks. PPI output is committed after `Exec`.

The original engine uses two shared MT19937 streams: integer functions use
`0x5c21d0` and float functions use `0x5c2040`. They do not consume one another's
state. Each 624-word state is initialized with two 69069 LCG steps per word,
combining consecutive high16-bit halves. This differs from modern MT19937's
1812433253 initializer. The float stream divides its uint32 result by
4294967295 and rounds to float32. Actual startup seeding is supplied by the shared engine host;
4357 is the native fallback seed and the reproducible test seed.

The native golden test covers 1024 outputs of each stream, crossing a twist:

| Stream  | SHA-256 of little-endian output bytes                              |
| ------- | ------------------------------------------------------------------ |
| uint32  | `20cb731c856e758cb79975c86f748462d10361d2af76a04b021df45ce58e2e03` |
| float32 | `216de8e6297cb128218d6b5fb72dc01f00e6d0734ba758b423e37c9cd47e9644` |

The signed native triangle wave completes0→1→0→-1→0 within one absolute period;
it treats negative input as positive and preserves a negative zero halfway
through. Period 0 yields NaN. This conflicts with the old PPI web manual's
nonnegative example. Native rounding is float32 `floor(x+0.5)` followed by
signed32 conversion; negative halves round upward and invalid/out-of-range
conversions produce `INT32_MIN`. Original-instruction probes cover these
cases. JavaScript trigonometry may still differ from the native Intel math
library by an ulp; this is a separate numerical precision boundary.

Reproduce the original-instruction checks with:

```sh
python3 scripts/native-ppi-oracle.py \
  --exe /path/to/frozen/analysis/binaries/NEKOPARAvol3.exe \
  --output .local/ppi-audit/oracle
```

The script requires the pinned binary hash, GNU as/ld and qemu-i386. It selects
the binary's baseline D3DX dispatch table for the projection probe and supplies
a fixed screen-size and identity pointer service. It does not initialize or
observe the complete Windows engine.

## Rendering contract

Each particle is two textured triangles, with independent corner xyz, w,
color, and UV. An axis-aligned `drawImage` path loses deformed quads, 3D
rotations, perspective, per-corner colors, and nontrivial texture mapping.
Render the resulting geometry and state, rather than recognizing an effect
name and synthesizing a similar animation.

The native renderer (`0x5f5280`) subtracts base coordinates, scales, rotates
X/Y/Z, and translates. It then converts depth with `65000-(z+priority)`,
projects relative to screen center with a 1000-unit focal distance, applies
the engine's final screen transform, and submits a triangle strip. PPI 2.1
z-shift participates in both sort depth and final depth. Per-particle sorting
uses position.z + base.z + firstVertex.z, adjusted by zShift\*65000. The
game's `7C80F0` and SDK's `868AD0` sorters take the middle entry as pivot
and move strictly lower depths to its left. Equal-depth entries therefore
follow the original pivot swaps. Hidden entries participate in sorting, and
the renderer reads the final z-shift by sorted rank.

Blend factors were recovered from `sub_671df0` setting D3D source/destination
render states19/20. `PARTICLE_BLEND_FACTORS` publishes the same table:

| Mode      | Source factor | Destination factor |
| --------- | ------------- | ------------------ |
| normal0   | SRCALPHA      | INVSRCALPHA        |
| add1      | SRCALPHA      | ONE                |
| add2      | ONE           | INVSRCALPHA        |
| multiply3 | ZERO          | SRCCOLOR           |
| invert4   | INVDESTCOLOR  | ZERO               |
| double5   | DESTCOLOR     | ONE                |

D3D9 factor semantics are defined in Microsoft's
[blend enumeration](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dblend).
Labels such as add/invert do not define interchangeable canvas composites.
PPI2.2 render-state and sampler overrides are applied after the default mode.
Slot34 reaches device vtable+276 (`SetSamplerState`); +268 would instead be
`SetTextureStageState`. The distinction is reflected in the catalog and code. Bank alpha is stored as a
fixed-point multiplier: scene alpha 255 maps to 256, then modulates vertex alpha
by a shift of 8. Fade must preserve the frame-based interpolation and endpoint
behavior, rather than removing the emitter unconditionally at fade end.

The renderer preserves partial D3D state updates. `0x671df0` has separate
draw-type and blend caches; a repeated type leaves earlier PPI overrides in
effect. `createD3DContext`, `snapshotD3DContext`, and `restoreD3DContext` keep
this shared state with `NativeGraphics`. The profile executor matches all4,356
original calls in120 combinations of type0–7, blend0–5, depth/stencil, forced
setup, and cached transitions. It also preserves type1's alpha stage, which
selects diffuse alpha instead of multiplying texture alpha.

The WebGL path implements table fog's linear/exponential/exponential-square
formulas, no-specular XYZRHW vertex fog, sRGB reads, and sRGB writes with blending
in linear space. sRGB output copies the current target before each triangle;
alpha remains linear. Samplers provide five address modes, point/bilinear/
anisotropic filtering, and border colors. Native anisotropy uses the browser GPU
extension; a bounded footprint filter covers border addressing or devices without
that extension. Filter kernels are device-dependent. Flat/Gouraud shading,
point/wireframe/solid fill, face culling, line coverage, alpha/depth/stencil tests,
color masks, separate-alpha blend, and scissor share the same target.
Vertex-processing inputs such as WRAPn, lighting, and point size preserve the
native pretransformed-vertex behavior rather than altering supplied UVs or the
triangle-point size.

An independent authored COM-ABI harness under pinned Wine8/Mesa22.3.6 supplies39
D3D9 raster probes. Interior non-anisotropic pixels match within one8-bit level.
Exact point-filter ties may select either adjacent texel; line endpoints/
antialias joins and anisotropic footprints have measured device-dependent
coverage. Browser tests constrain exceptions to analytic tie/endpoint positions
and compare anisotropic footprint energy. They do not claim identical filter
kernels across two GPU drivers.

`ppi-world.spec.mjs` mounts the frozen game's `filmnoise.ppi` as a
kind-16 task between two planes rendered by the original GraphManager.
The fixture uses an authored red and blue atlas. The Wine DLL oracle
supplies the Init and six Exec records. An independent i386 run of the
original record copy, sort and projection captures the submitted vertices.
Wine D3D9 renders those vertices between the original plane submissions
into 36 selected 8×8 crops. The browser matches the particle records and
vertices byte for byte. The crop containing the equal-depth overlap
matches exactly, with a one-level tolerance in the other crops. A new
World restored after frame 2 produces identical whole frames and particle
records at restoration and during continuation.

`ppi-attachment.spec.mjs` compares the live 32-byte attachment fields with
each original engine during changes to a native plane's KX2 transform and
visibility, Stop, restart, unload, fresh restore, model recreation, and
detach. The mounted `em_question.ppi` matches 11 independent Wine callback
records. Nine 8×8 interior crops match Wine D3D9 exactly. All projected
XYZRHW, color and UV words match the original executables byte for byte.
The browser also changes the guest's x87/SSE settings across engine draw
calls and verifies JS geometry retains normal PC24 results. The independent
PC53/directed-rounding captures remain frozen oracle evidence.
The complete frame is identical immediately after restoring the checkpoint
taken with the attached graph absent.

Engine-side particle geometry uses JS scalar D3DX operation order, PC24
rounding and float32 trigonometric stores. Both ABI oracles compare 128
quads, returned order, XYZRHW/color/UV and exact rounded pixel coordinates.
Finite floating geometry has a 1 f32 ULP limit. `oracle/particle-*-original.mjs`
retains the previous mixed-precision implementations and existing harness.
PPI algorithms and their DLL state continue until phase 9.

The eight main wrappers construct canonical 400-byte load/register packets
and route live task controls in JS. Load wrappers return control1/value1
after routing, including a missing task. Query318 initializes its unwritten
result to zero. Strings are bounded 128-byte C fields. Bytes following the
terminator in old global scratch are excluded from semantic comparisons.
Bank resources, atlas ownership, reload clocks and raw register copies are
covered independently from the remaining PPI DLL callbacks.

The observed D3D9 device does not advertise `D3DPRASTERCAPS_WBUFFER`. It accepts
`D3DZB_USEW` while retaining z-based XYZRHW depth; the browser matches this
explicit device profile. Single-sample targets have no multisample coverage to
modify. Phong and obsolete quad filters are outside that native device's
declared capabilities.

Reproduce the state and raster oracles with:

```sh
python3 scripts/native-ppi-render-state-oracle.py \
  --exe /path/to/frozen/analysis/binaries/NEKOPARAvol3.exe \
  --output .local/ppi-audit/render-state
python3 scripts/native-ppi-d3d9-oracle.py \
  --emsdk /path/to/emsdk-3.1.74 --output .local/ppi-audit/d3d9
```

The diagnostic D3D9 image identity and rebuild recipe are fixed in
`scripts/native-ppi-d3d9.Dockerfile`. Public goldens contain authored vertices,
textures, state calls, and pixels; engine-derived executables remain ignored.

Raster and special-plane support also belongs to the generic renderer. SDK
`raster_x.kx2` and `raster_y.kx2` contain 320 and 448 triangles respectively.
The engine applies raster displacement to this supplied mesh; the official
[raster command](https://cs2.suki.jp/manual/scene/reference/effect/raster.html)
specifies direction, amplitude, pixels per cycle, and frames per cycle.
Loading a special plane and subsequently resetting it has its own lifecycle.
Tool plug-ins such as the Metasequoia exporter and Susie image readers are
authoring/file-I/O tools; their behavior should become format readers rather
than game-time Windows UI emulation.

## Motion scripts and native execution boundary

The SDK's `mot.int` contains 64 KCS programs for finite, asynchronous, continuous,
and immediate plane/particle operations. Current motion loading at `0x789860`
constructs `0x78abf0`, which registers the45-slot generic table `0xb229a0`.
This table includes scalar/vector/matrix math, shared-data access, exit/yield,
RNG, interpolation, and signed triangle wave. Motion target state and command
parameters are supplied through the task's shared data; they are not the
particle-native `GetReg` interface.

Some legacy `pt*` archive members invoke native0x17 with zero argument bytes,
whereas the current generic slot 23 expects a matrix plus three angles. Their
archive presence alone does not establish that the current loader executes
them. This binding discrepancy remains explicit in coverage. The current generic
executor's45 native slots have separately passed2,160 byte comparisons across
both frozen engines; see the maintained MOT contracts and tests. Those checks
do not resolve the legacy `pt*` binding discrepancy.

Windows services and engine semantics must remain separate. DLL mapping,
relocation, imported heap/TLS/error/timer APIs and process services are OS/ABI
services. PPI host callbacks, particle geometry, register refresh, frame
counter semantics, native state changes and rendering are engine semantics.
The prepared test game ships 12 PPI DLLs: 8 at2.2 and 4 at2.1, each importing
KERNEL32. That bounded import inventory does not prove arbitrary PPI modules
use only those services.

PPI code executes on the engine's calling thread. The native DLL sandbox
therefore exchanges the complete x87 and SSE register state with the unique
World engine process before and after loading, calling and unloading a plug-in.
This includes the x87 stack, tags, status, control word, last instruction/data
addresses and selectors, plus all XMM registers and MXCSR. An independent
144-case Wine probe shows successful Direct3D9 device creation selects x87
single precision, nearest rounding and masked exceptions, preserving the other
control bits, unless `D3DCREATE_FPU_PRESERVE` was requested. The ordinary `037F`
becomes `007F`; MXCSR is unchanged. Reset and release do not repeat that change.

The original 12 plug-ins were run under both `007F` and `037F` for the fixed
particle/register/frame inputs. All 24 record hashes match the native oracle;
`em_note.ppi` and `rain.ppi` have different record bytes between those precision
modes. Treating each sandbox's initial `037F` as the engine thread would lose
this behavior. Public fixtures record hashes and authored inputs only. The
SDK full original display initialization followed by a kind-16 PPI task and a
fresh World checkpoint verifies that the current engine process, including a
later control-word change, remains the thread-state authority after restore.

A general implementation must execute a supplied PE32 plug-in with an explicit
compatible backend, or execute a verified rebuild of that plug-in when source
is available. Replacing DLLs by filename with approximate JavaScript effects
does not satisfy this contract. Missing execution capabilities must produce a
diagnostic with artifact identity, version, entry/callback, and missing import
or host slot, rather than silently succeeding.

## Save/restore and completion checks

The public PPI ABI has no serialization callback. A browser save cannot claim
to preserve arbitrary private plug-in fields merely by saving the148-byte
particle array. A native execution backend must capture instance/heap state,
or use a separately verified deterministic reinitialization/replay strategy.
The native backend snapshots that private memory. Native Windows save behavior still needs observation; no equivalence to a Windows
save-file format is implied by these record codecs.

Particle checkpoints require VM data/heap/shared memory, any suspended execution
state, live and backup quads, all per-particle transforms/visibility, registers,
blend mode, bank alpha/fade, current/before counters and clock remainder,
attachment, texture identity, priority/z-shifts/custom rendering state, active
status, and both RNG states. Random state is shared across effects, so restoring
it independently for each emitter changes interleaved execution.

Completion requires native comparisons for all declared PTCL slots, execution
of all applicable SDK scripts and custom generated programs across initialization,
updates, stop/restart and save/restore, and PPI 2.0/2.1/2.2 lifecycle/ABI probes.
Render acceptance must exercise arbitrary quads, atlas UVs, vertex alpha/color,
all blend modes, attachment,3D projection, sort/z-shift, custom D3D state and
both stock raster meshes. Game tests add coverage to those contracts; they do
not replace them.
