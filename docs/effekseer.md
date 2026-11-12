# Effekseer legacy resources

Phase 7 implements a JS reader, resource owner, independent CPU state algorithms
and typed geometry builders for legacy SKFE Effects.
It does not yet connect EFKPLANE commands, complete particle playback, drawing
or task checkpoints. FES raw type 36 remains explicitly unsupported.
The fixed 2.6.1.74 ABI has no kind-61 factory; the fixed 2.6.1.76 ABI has one.
Parsing a sample does not establish either ABI's complete runtime support.

`mesh-packet.mjs` provides reusable typed vertex/index packets, exact quad order
and explicit camera/projection/viewport inputs. `materials.mjs` requires current
shared-device operations and retains the old 12-state/5-binding restore set,
sampler inheritance and depth-only clear. `shared-device-view.mjs` maps those
operations onto an injected current context; it owns no device or target state.
StageRenderer exposes these independent interfaces through its existing shared
GPU backend; World and EFK tasks do not yet mount them. See
[the GPU backend contract](effekseer-gpu.md) for the calibrated profile and limits. Their
2,000-quad default upload bound does not define the original reserve/flush policy.
The 21 packet tests include six public-source matrix comparison groups and three
observed D3DCOLOR normalization boundaries; they do not establish task drawing.

`standard-batch.mjs` independently implements the old nine-field material
comparison, byte reservations and zero extension, physical VB precheck, ring
cursor and flush order. Required synchronous submission operations retain known
prepare/finish effects even when the fixed IB safety policy rejects a draw.
Normal requests beyond 320,000 VB bytes follow the original clear/no-submit
branch first; fitting requests needing more than 12,000 indices raise an explicit
unsupported/unsafe-domain error. This deliberate policy does not infer portable
out-of-storage behavior from a driver's success code. The component only permits
settled-boundary cursor snapshots, with no temporary vertex history. It is not yet
connected to World or the typed GPU adapter; 2,000-quad GPU/60-fps integration is
a separate obligation.

`ring-current-state.mjs` owns the complete persistent 16-word Ring matrix for
one renderer. It initializes once to identity, replaces only the 12 Matrix43
components on a submitted single Ring, and snapshots/restores the current words
without replay. The geometry builder's single-Ring zero-submission path retains
its zero reservation and skips the immediate End flush and matrix read. A future
task-owned shared batch must still preserve that reservation until its normal
flush; this independent correction does not mount the cache or batch in World.

`src/effekseer/effect-reader.mjs` adapts the structures from official Effekseer
1.23, commit `5239bb1e416cbf55b4d3c8170594cbdc7815f263`. Its implemented layouts
cover legacy versions 0–9: UTF-16 dependency paths, common generation/lifetime
values, translation/rotation/scaling and FCurves, absolute forces, generation
locations, material/fade/UV parameters, sound metadata, and root, none, sprite,
ribbon, ring, model and track nodes. Size-prefixed blocks must match implemented
layouts; byte, path, count, recursion and key budgets bound reads and allocation.
Errors include the source identity, byte offset and field. An unverified version
first emits an identity-bearing warning through `onWarning` and the returned
`warnings`, then attempts the implemented structures. An unreadable layout or
unknown operation fails explicitly. There is no version-only rejection list.

`readEffekseerEffect(bytes, { identity, onWarning, limits,
externalMagnification })` returns typed parameter data and a flat node table with
parent/child IDs and source spans. Consumers treat this resource data as immutable;
particle state belongs in a separate simulation owner. Model and sound paths are
retained even though the observed 76 wrapper installs neither loader. Normal and
distortion texture tables are also retained; parsing them does not claim a working
model, sound or background-distortion renderer.

`src/effekseer/resources.mjs` exports `EffekseerResources`. Its injected services
reuse the existing mounted VFS, category configuration, CP932 conversion,
SHA-256 identity and texture decoder. `resolveCategory`, `readNative`,
`roundTripCP932`, `identify` and `decodeTexture` are required. `disposeTexture`,
`onWarning` and `readerLimits` are optional. Resource reads use mode 3, leaving
archive qualification and patch priority to the existing file services.

`efk` and `efktex` are **category names**, not forced filename extensions. The
category appends its configured extension only when the input lacks a dot.
An explicit `fire.png` remains `fire.png`. Effects use the `efk` category and
retain their path; textures convert UTF-16 paths through CP932, take the old
wrapper's basename and use `efktex`. This distinction matters when an Effect
refers to `Texture/fire.png` while the configured texture archive contains
`fire.png`. The original basename rule also retains a leading separator at
index zero. The resource tests exercise these rules through real `GameFiles`,
KIF, native category/file services and the existing PNG decoder.

`load(name)` returns a shared, SHA-bound asset with an owner reference, or null
for an empty/missing Effect. Missing textures remain explicit missing bindings;
malformed Effects and decoder failures throw. `retain(id)` and `release(id)`
keep Effects and shared texture frames alive across separate owners; a frame is
disposed after its final reference. No manager, RNG, canvas or GPU is constructed.
`snapshot()` requires settled loads and records live IDs, references, Effect
identities and each texture binding's identity or missing state. `restore(state)`
requires a fresh resource owner, reopens the mounted resources, verifies those
identities and restores the IDs/references. It neither plays nor replays an Effect.
A failed restore closes its incomplete resource owner. `close()` is idempotent.
This is a resource checkpoint component, not a complete EFK task checkpoint.

`src/effekseer/crt-random.mjs` implements the unsigned MSVC CRT recurrence in
`LogicalThreadCRT`. `crt-threads.mjs` exports `LogicalCRTThreads`, whose callers
must explicitly create and select a logical thread. Separate managers on that
thread share one stream in call order; an unknown thread fails instead of
creating a fallback. A newly created thread starts at seed 1. This does not
establish the seed at the first actual EFK Play after other engine consumers.
Snapshots retain every current state word and diagnostic draw/reseed counter;
fresh restore neither draws nor reseeds.

These are independent data APIs. They are not registered with World or remaining
native consumers. That later binding must share one authoritative CRT state with
the actual logical thread, rather than keep independently advancing JS and guest
copies. No EFKPLANE runtime capability follows from these modules. Integer tests
include 20,480 comparisons with an independent BigInt recurrence; local original
oracle evidence separately compares 320 return values and 320 PTD state words.
That observation uses authored seeds on its synthetic thread, not a real first
Play or a complete external-caller map.

`numerical.mjs`, `math43.mjs` and `generation.mjs` implement the old scalar/vector
random sampling, PVA/easing/curves, HSVA colors, affine matrices and generation
locations from that same fixed source. Sampling and evaluation are separate:
evaluation reuses stored samples and does not consume randomness. Callers supply
the selected CRT stream; scratch and output buffers can be reused. Circle's
inclusive random endpoint retains the old denominator-decrement behavior. Its
one-division endpoint produces an explicit operation error after the original
four draws. The observed null ModelLoader branch records an unavailable model
generation without adding a modern loader or consuming model-selection draws.
Nonfinite results, integer conversion overflow and unimplemented operations fail
explicitly; the modules do not clamp them into invented valid values.

Tests include 71 direct numerical/generation unit cases and 31 comparison groups
against retained outputs from the fixed public source, built with contraction
and fast-math disabled. Those reference values are not original game outputs.
Separate local original-function calibration has 116 calls and 1,266 exact
float32 outputs under the recorded synthetic oracle FPCW `0x037F` configuration.
The same 116 fixed inputs also match bit for bit after the existing renderer
consumer-view constructor naturally creates a device: FPCW changes to `0x007F`
on the same recorded TID/TEB, with device flags `0x24` and no harness control-word
write. These are reused published inputs in a second configuration, not a new
blind holdout or a title-frame capture. Manager and cache evidence below retain
their own recorded configuration limits.
GetScale/GetRotation and unsampled parameter domains retain their source-reference
scope. No pixel tolerance, playback integration or browser support follows from
these independent algorithms.

`manager-lifecycle.mjs` owns per-manager handles, all retained Play instances,
groups/containers, FIFO non-root capacity and delayed removal queues. Its
`EffekseerManagerLifecycle` constructor requires resources, explicit logical
threads and three instance operations: `initializeGroup`, `initializeInstance`
and `calculateInstance`. It supplies no identity-matrix or color fallback for a
missing implementation. `play(assetID, position, threadID)` and
`update(threadID, delta)` choose the caller's stream explicitly; repeated Play
keeps earlier handles alive, and `stop(handle)` marks only that handle. This
StopEffect primitive does not implement the separate observed FES stop-verb quirk.

`instance-transform.mjs` supplies motion/parent-binding/generation/absolute-force
state and reused calculation scratch. Renderer initialization and cache-update
operations remain required callbacks. The opt-in CPU composition adapter below
supplies them when explicitly selected; it is not registered with World. The
manager's data visitor can
refresh a stale calculation sequence at zero delta, without advancing age or
sampling another random value; it is not a GPU renderer.

Manager snapshots retain the whole current graph, live and removing instances,
pool order, sampled operation data, matrices, pending flags and counters.
Fresh restore validates graph ownership and references before publishing it. It
adopts the references already restored by the aggregate resource owner; it does
not Play, resample, recalculate or retain them again. Existing checkpoint
serialization preserves typed arrays and signed zero. No World checkpoint hook
or checkpoint-format change is introduced by these independent state APIs.

Lifecycle and transform tests add 25 focused cases. Separate local original
no-GPU manager comparisons cover 12 cases and 154 current-state observations,
including repeated Play/StopEffect, pool starvation, root expiry and delayed GC.
Topology, counters, CRT words and sampled current matrices/positions match
exactly under that oracle's recorded FPCW `0x037F` configuration. These are CPU
state observations, not original renderer-cache, pixel, native fresh-process
restore or real frame-thread floating-environment acceptance.

`render-state.mjs` implements the five old renderer-cache families, sampled
colors and scalar parameters, UV animation, fade evaluation and reused CPU
output data. Ribbon easing retains its pending cache until the required matrix
calculation; Track samples and render indices belong to its group. Rendering
reads current data without sampling another random value. Model and distortion
nodes still evaluate simulation and cache state; their observed null-loader or
null-background branches do not become modern model or distortion rendering.

`createEffekseerInstanceOperations()` from `instance-operations.mjs` explicitly
combines the existing transform and cache operations for an independent manager.
`createEffekseerColorVisitor()` supplies reused per-type CPU outputs, with
unavailable-service metadata for those original model/distortion branches.
Callers consume each reused output immediately or copy it for observation.
There is no geometry builder, GPU submission, frame update or task registration
in that visitor. `snapshotRendererState` and `restoreRendererState` clone and
validate finite current data without initialization, Play, RNG or recalculation.
They use the existing project checkpoint serialization, including signed zero;
sequence metadata preserves the uint32 bits of signed or unsigned counters.

Cache/composition tests add 51 cases: 32 direct cases, eight retained public-source
comparison groups and 11 mounted-resource/current-state/fresh-restore cases.
The latter compare complete JS CPU state and future updates with a fresh resource
and thread owner. They establish no native fresh-process or rendered-pixel result.
Separate local original-76 observations cover 15 cases, 286 frames and 1,727
parameter records: 1,683 complete guarded GetUV calls, 1,463 instance caches and
44 Track group caches (some records exercise both calls and caches). Those
observations retain the synthetic FPCW `0x037F` configuration and do not establish
nonfixed Ring numeric domains, final faded/vertex-multiplied native outputs,
geometry, actual Draw or pixels. The natural `0x007F` math-only extension above
does not broaden that cache evidence.

`ribbon-track-geometry.mjs` exports `RibbonTrackGeometry`, an independent normal
CPU mesh builder. `beginNode`, `beginGroup`, `append`, `endGroup` and `endNode`
consume the caller's existing group/instance order and current matrix/color/UV
data. They do not update the manager or draw RNG. Positions, UVs, RGBA colors,
indices and group ranges use reused typed buffers. The output separately records
the source reserved vertex/index range and actual write/segment cursors; multiple
groups can leave the original zero-initialized tail. Consumers must retain that
range and original quad indices `[3, 1, 0, 3, 0, 2]`, rather than compact or reorder
it. Track preserves the integer midpoint and unnormalized averaged-axis rules.

The CPU allocation budgets bound input and growth. They do not establish the
original renderer's 2,000-quad GPU upload capacity or its overflow behavior.
The builder neither projects nor owns materials, render targets or the original
null-background discard. Its 50 focused cases include 24 exact public-source
comparison groups, one nonfinite boundary and 25 interface/current-data/buffer
cases. They read public/authored references without compiling C++ during tests.
There is no original native geometry, GPU Draw or pixel acceptance from this
CPU module, and no World/kind61/default-factory registration.

`sprite-ring-geometry.mjs` exports `SpriteRingGeometry`. `beginNode`, `append`
and `endNode` produce reused typed buffers for all four old billboard modes.
Sprite Fixed uses the source's sequential vector transform; billboard Sprite
and Ring bulk transforms retain the DX9 paired multiply/add tree. A retained
cancellation reference distinguishes these two arithmetic orders.

Ring with source count one retains local positions and a copied
`deferredMatrix43`, with both `flushBefore` and `flushAfter`. Its consumer must
apply that source camera-constant/flush boundary. Source count greater than one
uses the CPU bulk transform, even if fewer instances are submitted. Ring's
recurrence and reserved zero tails are retained. The module samples no RNG,
advances no simulation and owns no shader, material, target or projection.
Its 65 cases include 38 exact public-source comparison groups, three nonfinite
boundaries and 24 interface/current-data/buffer cases. These are source/CPU
geometry checks; actual native vertex output, shared GPU state, pixels, original
capacity behavior, draw-graph placement and frame-rate acceptance remain open.

The independent fixtures in `tests/fixtures/effekseer` include eight public
Effects from the fixed upstream commit (50 nodes, versions 1, 7, 8 and 9), their
dependencies, and an authored nonempty sprite Effect/texture. The public manifest
records exact URLs, sizes and SHA-256 hashes. The upstream sample grant is CC0;
its original text is retained in `licenses/effekseer-samples-CC0.txt`. The reader's
MIT attribution and original grant are in `licenses/effekseer-MIT.txt`. That
upstream notice also mentions DirectX Tool Kit; this reader incorporates no
DirectX implementation. Authored fixtures use this project's MPL-2.0 license.
Fixtures contain no private game resources and are excluded from the player build.

Node tests cover complete real-file decoding, truncation and layout failures,
parameter variants, Japanese paths, archive patch search, nonempty decoded PNG
pixels, shared ownership, concurrent loads and fresh resource restore. They do
not establish native float/pixel tolerances, playback timing, browser rendering,
full task restoration or frame-rate acceptance. Those remain required for EFKPLANE.
