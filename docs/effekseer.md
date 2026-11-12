# Effekseer legacy resources

Phase 7 implements a JS reader, resource owner and independent algorithm modules
for legacy SKFE Effects.
It does not yet connect EFKPLANE commands, complete particle playback, geometry,
drawing or task checkpoints. FES raw type 36 remains explicitly unsupported.
The fixed 2.6.1.74 ABI has no kind-61 factory; the fixed 2.6.1.76 ABI has one.
Parsing a sample does not establish either ABI's complete runtime support.

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
This does not establish the real frame thread's complete floating environment;
successful D3D device creation has a separate single-precision API contract.
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
operations remain required callbacks. The automatic renderer-state/composition
adapter is not registered or included here. The manager's data visitor can
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
