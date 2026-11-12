# Effekseer legacy resources

Phase 7 implements a JS reader, resource owner, independent CPU state algorithms
and typed geometry builders for legacy SKFE Effects.
The default registered76 kind61 factory now owns real CPU playback, mounted
resources and settled task/World checkpoints. Actual task drawing requires the
unimplemented GPU adapter and reports an explicit error. Registered76 default
FES raw type36 now reaches that CPU task through its normal resource FIFO.
This is partial EFKPLANE support; actual FES task GPU drawing remains unavailable.
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
SHA-256 identity. `resolveCategory`, `readNative`, `roundTripCP932` and `identify`
are required. The default `decodeTexture` uses the EFK-specific PNG8 source
contract and selected legacy level0 converter. RGBA8 produces physical format21;
noninterlaced RGB8 without tRNS produces physical format22. The returned owned
frame has `{ width, height, rgba, format }`. Format22's defined sampled pixels
have alpha255; its native unused X backing byte is neither alpha nor checkpoint
data. Unknown codecs, layouts and device profiles are explicit errors. It does
not use the general RasterImage/canvas fallback.

The general PNG parser only projects color metadata. The EFK seam admits images
without color chunks, or one valid gAMA before palette/image data whose original
numeric threshold does not require a gamma transform. It explicitly rejects
sRGB, duplicate/malformed/late color chunks, zero gamma and an active gamma
transform. cHRM, iCCP, pHYs and text chunks follow the proved ancillary-skip path.
This keeps all ten current fixture sources in the no-transform domain without
a source-name or observed-gamma whitelist. See
[the level0 contract](effekseer-texture-level0.md) for precision and evidence limits.

Decoder injection remains available for isolated algorithms or error/wait tests;
it must identify its actual physical format and provide defined RGBA samples.
A format22 frame with nonopaque fourth components is rejected. Injected generic
PNG algorithm fixtures explicitly provide format21 sample frames; their success
does not establish the native default source-format mapping. `disposeTexture`,
`onWarning` and `readerLimits` are optional.
Resource reads use mode 3, leaving
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
identities and each texture binding's source/missing state and derived physical
`storage` projection. A missing binding has `storage: null`; a successful binding
records the selected device `profile`, actual frame `width`/`height`, and
`rgbaSHA256`. The profile is derived from the actual frame's sole `format` value;
there is no separately writable resource format. Fresh restore compares the
profile as well as dimensions and defined-sample digest. The existing identify service hashes the converted pixels once;
the immutable frame owns those pixels, and snapshot dimensions read that frame.
There is no second writable dimensions record, pixel copy, cache or texture-ID
table. Renderers borrow this physical frame as immutable data. Source SHA and
per-successful-load logical tokens keep their separate existing authorities.
`restore(state)` requires a fresh resource owner, reopens the mounted resources,
regenerates and verifies source and physical storage identities, and restores
the IDs/references before the logical-token owner rebinds its saved tokens.
It neither plays nor replays an Effect.
A failed restore closes its incomplete resource owner. `close()` is idempotent.
Pending decode/hash operations cannot be checkpointed. Owner-close checks cover
both awaits, including synchronous provider reentry. Cleanup retires a frame
before invoking the disposal sink, so errors, concurrent failed loads and late
completion cannot dispose it twice or poison a later cache retry. The shared
StageRenderer's `releaseTextureFrame` delegates to its current GPU and does
nothing before GPU creation or after StageRenderer disposal.
This is a resource checkpoint component, not a complete EFK task checkpoint.

`src/effekseer/crt-random.mjs` implements the unsigned MSVC CRT recurrence in
`LogicalThreadCRT`. `crt-threads.mjs` exports `LogicalCRTThreads`, whose callers
must explicitly create and select a logical thread. Separate managers on that
thread share one stream in call order; an unknown thread fails instead of
creating a fallback. A newly created thread starts at seed 1. This does not
establish the seed at the first actual EFK Play after other engine consumers.
Snapshots retain every current state word and diagnostic draw/reseed counter;
fresh restore neither draws nor reseeds.

The pure-JS World gateway in `native/dispatch-context.mjs` and `effekseer/world.mjs`
owns one CRT registry and creates its logical frame executor once. Each gateway
Play/Update requires a live explicit executor entry; awaits and reentry retain
that entry, while queued messages use the actual drain executor. Sender task IDs
never select a stream. The existing `frameSettled` signal is published after the
frame entry fully exits, so awaiting it preserves the snapshot/close safe point.
Settled checkpoints store the current CRT words once and restore without replay.
While a native process exists or is loading, the gateway rejects sampling before
manager callbacks because the actual native-owner binding remains unverified.
The default76 kind61 CPU task uses this gateway per actual Play/Update. FES
type36 remains unconnected; neither the gateway nor CPU task establishes complete
EFKPLANE rendering support.

Integer tests include 20,480 comparisons with an independent BigInt recurrence; local original
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
supplies them when explicitly selected; the default kind61 CPU task now installs
these same required operations with its actual manager. The
manager's data visitor can
refresh a stale calculation sequence at zero delta, without advancing age or
sampling another random value; it is not a GPU renderer.

Manager snapshots retain the whole current graph, live and removing instances,
pool order, sampled operation data, matrices, pending flags and counters.
Fresh restore validates graph ownership and references before publishing it. It
adopts the references already restored by the aggregate resource owner; it does
not Play, resample, recalculate or retain them again. Existing checkpoint
serialization preserves typed arrays and signed zero. The kind61 CPU task now
connects these APIs to the current World checkpoint, with no additional format
generation or compatibility reader.

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

`mesh-batch.mjs` exports the independent `EffekseerMeshBatch` composition. It
consumes a live manager, the shared logical Effect-load owner, current device view,
StageRenderer and explicit camera/projection/viewport/pipeline operations. It uses
one StandardRenderer byte cache across nodes and drawsets, comparing all nine
material fields including logical texture identity. The decoded frame passed to
the GPU remains separate from that identity. Normal vertices use the original
24-byte XYZ/D3DCOLOR/UV layout before `EffekseerPackedMesh.prepareBatch` converts
them into reused typed GPU buffers. The original quad order is preserved.

Single Ring performs its real reset/reservation/deferred-matrix/flush sequence.
Its full renderer-owned matrix persists across nodes and frames. A zero-submission
Ring keeps its reserved zero range and skips the guarded End flush; it does not
replace the current matrix with identity. Ribbon/Track count one returns before
material/reservation work. The proved null-background branch retains simulation,
color/group and Ring current-state work, reserves its distortion range and submits
no normal substitute. Pool occupancy and global instance count remain separate:
root instances count globally but are allocated outside the reserved instance pool.

The composition uses the existing target/depth and state/binding scope. It does
not allocate a canvas or read pixels during rendering. Render-only drawing does
not advance RNG or living time. Normal End flushes the remaining valid byte cache;
explicit fault cleanup uses `EffekseerStandardBatch.abort` to discard only pending
unsubmitted bytes, preserving previous submissions/cursor/current-state effects.
The device scope still restores its twelve states and five bindings. The adapter
retains the original error, reports cleanup failures, rejects future draw/snapshot
after failure and never draws a partial cache from finally.

Settled checkpoints contain only the logical ring cursor and current Ring matrix;
transient vertices, shader/material stack and fault are not saved. A fresh owner
restores those values without Play, Update, RNG or historical replay. Resource,
logical-load, manager, caller, graphics readiness and current target ownership must
be restored by their respective owners before task publication. This module does
not register kind61/default FES type36, add ABI capabilities or install World/D6
hooks. Correct legacy texture conversion remains the resource owner's contract;
this mesh composition does not turn source decoding into a complete old D3DX
resize/filter/mipmap/format implementation. Those task/World/texture and complete
frame-rate requirements remain open.

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
complete rendered-task restoration or frame-rate acceptance. The CPU task and
true fresh-World checks below do not substitute for those EFKPLANE requirements.

## Default kind61 CPU task

The registered ABI capability enables the default kind61 factory for76 and keeps
it unavailable for74. Unknown registrations cannot borrow this capability by
name. Each task owns a real2000-capacity ManagerLifecycle and the existing instance
operations, camera and Ring current-state owner. Its World exclusively owns the
mounted source cache and EffectLoads. This leaf does not enable FES raw36 or
install its resource driver, and actual nonempty draw raises an unsupported GPU
adapter error; a blank frame is not accepted as successful playback.

Messages569/570 release current FILE ownership before replacement/unload; earlier
Play drawsets keep their own logical-load references. Each571 creates another
handle and keeps older instances alive.572 stops only the latest handle while
current Effect is non-NULL.573 writes the existing result container before Stop,
including when Stop suspends or fails. Other original unwritten branches retain
the established UNWRITTEN sentinel. The common receiver protocol passes its same
result container as an optional third message argument; existing receivers and
the direct four-word/queued return contract keep their behavior.

The three position words are one authority shared by constructor/51/57/571.
Constructor and57 calculate the rotated/transformed eye in that slot;51 replaces
it without changing old instances or recalculating the previous camera.55/66
only relay56/67 to children.57 uses the original1.57f projection constant and
current view aspect;59/63 are observed ignored overrides. The relocated camera
methods retain the fixed old approximate normalization. Two public/authored
whole-method reference outputs preserve exact float32 bits. Earlier local26
whole-method calls/312floats do not constitute an original whole57 calibration.

The optional beforeDrawChildren hook performs CPU Update1 before children only
on ordinary ready success. Actual LOST0x88760868 skips Update; NOTRESET0x88760869
calls OnLost and sets pending; the next pending branch calls OnReset, clears it
and skips Update. The original pending branch precedes another cooperative query.
The CPU-only loss/reset methods retain the same Ring owner and have no physical
handles to release/reconstruct. Physical adapter callbacks and actual GPU restore
remain required later work. Render/query does not advance time or randomness.

Snapshots save source/load identities and aggregate references once, then adopt
task current manager/vector/camera/pending/Ring/plane state without Play, retain,
seed or elapsed replay. Fresh World validates all task/current/drawset reference
counts after restoring the source and logical-load owners. Physical readiness,
GPU generations, executor entries, pending FILE Promises and fault stacks are not
saved. A pending FILE prevents World checkpoint/close; explicit task teardown
waits for that operation and releases its late load rather than publishing an
orphan. Cleanup continues after an error and reports the failure.

Focused Node checks use the actual default factory, mounted public/authored data,
real managers, existing executor and device owners, and true fresh World. They
exercise opaque-entry guards, queue consumption, delayed GC and shared logical
texture identities. A temporary host disposal failure and Stop wrapper test
cleanup/result ordering; they do not replace the manager under test or claim
native/GPU failure observations. No EXE is opened by this CPU path. The existing
mixed-native CRT guard remains unchanged. Actual D6 registration/display producer,
default FES36, shared GPU target/state and nonempty rendered-World/2000-particle
acceptance remain separate required closures.

## Default FES raw36 CPU integration

The typed factory requires the explicitly registered Effekseer capability. A
plain factory call without a profile, SDK74, or an unregistered ABI cannot enable
EFKPLANE. This adds no native-table slot or version-name fallback.

Default FESTask333 and337 pass the live executor entry to Coordinator.sync,
resource traversal/visit and the EFK driver. The entry is borrowed for this
invocation only: it is absent from semantic objects, FIFO entries, pending
records and checkpoints. Sender/task IDs do not choose a CRT stream. Existing
mixed-native and closed/unknown-entry guards still reject sampling.

The raw36 constructor requests its first kind61 child through sizeDirty. Each
SIZE rebuild sends destruction3 for the previous resource-entry ID, creates a
new ordinary kind61 child, and publishes the new ID to the existing entry and
owner before asynchronous FILE work. A rebuild does not re-mark FILE or Play;
the replacement can therefore remain empty. Normal logic later releases the
old child, and FES close releases all remaining owned children.

A different FILE stores its CP932 bytes and marks resource pending, using the
registered C-locale ASCII byte comparison. Case-only equality preserves the
original stored spelling and successful load; no language substitution is
added. The bounded256-byte field rejects an unsafe overflow. The FILE getter
consumes pending before569, and a failed load leaves current Effect NULL while
old drawsets keep their own load references. The driver then consumes dirty
position/metadata, base/priority, scale, matrix, color and display in the original
51,49,66,57,59,47 order. It uses the current common plane state; it emits neither
ordinary plane vertices nor an extra alpha override.

Both FES play and FES stop set pending value1 and send571. Stop first stops
motions, then preserves this observed original quirk; it does not become task572.
The play-pending getter clears before dispatch, including a failed dispatch.
Repeated Play retains old instances; FILE replacement keeps their old logical
load/tokens alive. Settled fresh restore revalidates mounted source/texture
identity and restores current IDs, aliases, matrices, manager state and the
single CRT word without replaying FILE commands, Play, allocation or RNG.

The default tests exercise actual managers, public authored nonempty Effects,
the existing PNG decoder and normal World resources. Forced333/337 and sleep
traversal retain their live caller. The window-queue test uses an explicitly
authored Host callback forwarding the actual drain entry to FES333; it is not
evidence that a native window automatically generates333. The independent
word-only object queue does not accept FESTask's UNWRITTEN return, and no normal
World publisher of333/337 into that queue was found; its contract is unchanged.
CPU render-only queries do not update time or RNG. Nonempty actual task draw
continues to throw the explicit unimplemented-GPU error. These checks complete
only this CPU/FES slice, not W5 pixels, complete W4 or phase7.

## D6 callback registration and query gates

The registered kind61 callback now opts into an explicit D6 registration mode
through the existing `NativeGraphics.customGraph`. Its saved graph owns one
`registrationEnabled` value. The verified41/42 rectangle,45/46 container and
custom callback registration paths initialize it to false, independently of
the model's initial MOT display. A boolean means a verified registration and
known enable value; null means the registration exists but its current value
is unknown. Other creators retain an explicit `unverified` value because their
registration existence has not been established here. Common47/48 can establish
a value only for a verified registration.47 follows a successful parent lookup;
a real missing registration retains the previous flag even when the external
request changes. An unverified parent leaves the child's value unknown, including
when a lookup failure could have preserved a previous nonzero value.48 combines
its request with the current external47 request without assuming a parent's
registration exists. Ordinary messages continue their existing shown/MOT/input
behavior with unknown metadata. Only the new callback query or eligible draw
reports an explicit error when it needs either unknown value, before treating
it as enabled or empty. Neither parent MOT nor parent shown substitutes for the
registration flag. The ordinary derived drawing flag and vertex path remain
unchanged. The independent model MOT word is not another callback draw gate.
Actual FES MOT output already reaches the common display setter, dirty FIFO and
47 producer; no second motion manager or display authority is added.

D6 actual draw checks registration enable, positive range maximum and the
existing inclusive-minimum/exclusive-maximum float priority interval. The
callback itself still checks current Effect and pending reset. Its query
checks the registered enable and invokes the existing task query without a
priority condition, drawing or updating. Range selection remains in the shared
screen compositor; stable priority/insertion order is unchanged. Ordinary plane
alpha/color, geometric clip and transform are not applied by this callback.
The current task's eligible actual draw continues to raise its unimplemented
GPU-adapter error. This gate work does not establish pixel/GPU support.

`NativeScreenEffectRenderer.queryRange` provides only the callback boolean
subbehavior, visiting enabled callbacks even after a previous positive result.
Its normal consumer is the no-GPU branch of full-target `captureInto`: a
positive result still requires a real GPU, while a false result permits the
existing full-target clear/write. That branch never uses a prior dirty region;
GPU captures also clear the whole target before drawing the selected range.
The complete original query's historical dirty-rectangle union and expansion
to full screen remain unimplemented here. This helper is not a replacement for
that complete native query or partial invalidation contract.

The ordinary area-effect customGraph caller does not select the callback-query
mode and retains its previous behavior. Checkpoints keep the current registration
flag and rebind the callback to the restored graph without Play, RNG or elapsed
replay. The focused default FES/World cases cover47/48, distinct query/draw range
gates, current-FILE NULL with retained instances, pending reset, real MOT display
consumption and true fresh World. Fullscreen dirty history, actual GPU/state
submission and W5 acceptance remain separate requirements.
