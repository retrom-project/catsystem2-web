# Effekseer GPU submission

The typed normal backend accepts explicit sprite/ribbon/ring/track geometry,
camera/projection/viewport and the current shared D3D semantic state. It draws
through the existing StageRenderer program, target, depth attachment and
texture cache. Typed buffers grow on demand and are reused. It does not create
an Effekseer canvas or move frame images through the CPU.

The default kind61/raw36 path connects its current manager and sole Task-owned
MeshBatch/Ring to the same World StageRenderer through `EffekseerTaskGPU`. The
view borrows the existing GPU, target, depth and texture cache; it creates no
canvas, renderer, device or second CPU state owner.

The normal solid/no-fog profile preserves the original quad order, programmable
alpha and inherited depth/alpha/sampler state. The device scope restores twelve
render states and actual physical bindings; sampler changes retain the original leakage.
`createD3DContext` owns the single `samplerStages` Map; its stage-zero entry
aliases `samplers`. The JS semantic view and transitional Emote adapter read
and write that same authority. Stages are allocated only when written, using
the adapter's existing defaults. A read of an unwritten stage does not create
another state owner. The snapshot stores stage zero only in `samplers` and
other allocated stages only in `samplerStages`. Sampler ownership is separate
from physical capture and actual kind61 submission.

ParticlesGL now owns one VAO for its existing fixed interleaved vertex layout.
Initialization, ordinary/typed/presentation draws, resource validation, shared
generation rebuild and close use that same layout resource. Inherited attribute pointers,
including the default VAO's null pointers, are never rewritten. After selecting
the entry VAO, restore explicitly reinstates its captured ELEMENT binding;
the entry may itself be the backend VAO used by the typed upload. A successful
resource transaction retires a previous VAO that is still valid; context-loss
handles are already invalid. Failed allocation does not publish a new layout.

Its physical binding primitive captures the actual current program, the owned
program's linked uniform values, VAO/ARRAY/ELEMENT bindings, four2D texture and
sampler bindings, active unit, draw/read framebuffer, renderbuffer, viewport,
depth/scissor, blend/stencil/masks and unpack state. The temporary token belongs
to one GPU/device generation; loss, retirement, closure or reconstruction skips
old handles. Completed or failed restoration releases captured resource
references. Captures are not checkpoint data or a parallel device/cache.

The C7 view/scope now delegates to this same physical owner, replacing the
five-string semantic binding interface in place. Scope Begin saves the twelve
D3D values, captures physical state and binds the backend's normal pipeline;
End restores both. A nonready entry is rejected before CPU pass mutation. Only
an active captured-owner/generation proof explaining restorefalse receives the
private device-invalidation brand; completed bytes/cursor/Ring are not rewound.
Known loss/retirement can recover after shared reconstruction, while arbitrary
GL/cleanup failures and aggregates containing an unknown leaf remain permanent
CPU-batch faults. Empty/cyclic/sparse aggregates do not qualify. Physical tokens
and errors are not serialized or retained as new World authorities.

The scope-focused tests use actual JS backend/lifecycle classes with an authored
WebGL API recorder. Those tests establish neither real shader compilation nor
GPU pixels; numeric mixed-frame acceptance must exercise the actual default
FES/Task callback separately. The API state partition follows the [WebGL2 specification](https://registry.khronos.org/webgl/specs/2.0.0/)
and [uniform queries](https://registry.khronos.org/webgl/specs/1.0.3/#5.14.10).

## Default Task callback

Normal FES FILE/play commands retain the existing resource FIFO, default kind61
factory and live executor. The registered D6 range callback draws that Task's
current manager, loaded texture bindings and camera/projection, without another
Play, Update, resource read or RNG sample. Ordinary plane alpha, clip and
transform do not modify the custom callback. Current-FILE NULL and pending-reset
gates still return0; an eligible callback returns1 even with no live instances.

Entry checks require the same World graphics owner, StageRenderer GPU and open
frame before any CPU pass changes. The borrowed view reads the current physical
viewport/depth range and delegates normal-pipeline capture/restore to that GPU.
Fresh Task restore starts without a backend view and rebinds on its first draw;
it restores the existing current manager/resources/camera/Ring without replay.
Task close retires its view while the World retains GPU/resource ownership.

The normal default-FES tests cover current packed vertices, shared target/depth,
entry/loss/fault boundaries and fresh rebinding through an explicit GL recorder.
The screen-effect renderer owns current/previous dirty RECT history. Normal
presentation collects every known enabled D6 callback independently of its
draw priority or the supplied frame subset. Positive queries contribute the
configuration's current screen viewport; an enabled callback also expands
nonempty current damage when its query returns zero. The presentation request
carries the viewport intersection of the previous/current union. Known boolean
47/48 registration changes query under the old flag before assigning the new
one; repeated booleans add no query. FES MOT display uses that same47 producer.
Unknown registration values retain their existing gates.

History retires only after that renderer's presentation operation completes
with an explicit signed32-success HRESULT, including zero. Negative HRESULTs,
unsigned words with the high bit set, throws and paused/inactive frames retain
history. The current checkpoint restores both RECTs in place without replay.
These are callback contribution and data/history side effects: drawing and
presentation still process the complete frame. Partial or empty damage does
not crop or skip ordinary content.

Known D6 message3 unregisters query the old enabled registration before disabling
and erasing it. Real FES SIZE/delete use this path while the old Task and FILE
remain open; physical disposal follows in logic without another query. SIZE's
empty replacement does not erase the old callback's damage. The existing
checkpoint also retains this settled pending-destruction state and its dirty
history, restoring the erased graph without registering or replaying it.
Unknown flags acquire no query or implicit enable value during removal.

Known kind61 direct release follows the later destructor order instead: clear
the current FILE, close the manager and Task batch/Ring, then query the still
enabled registration before disabling and erasing it. That callback returns zero
for its cleared FILE while the full query still collects other dirty models.
Only a closing, not-yet-closed Task with a NULL current FILE admits that query;
queries of a fully closed Task still fail. A graph already erased by message3
or disabled through47 acquires no second query. This does not widen unknown
registration or ABI admission.

Query failures remain part of the existing aggregate cleanup result while
remaining Task/plane disposal continues. The short real FES/World tests check
the dirty CPLANE cache transition through actual presentation, movement and
direct release, plus empty/disabled/repeated and failed-close boundaries. They
do not establish native fatal-error behavior or browser pixel equivalence.

Plain colored CPLANE2D models now contribute their cached old RECT and current
transformed vertex bounds to that same renderer history. The calculation uses
the real model geometry and projection phase, without the draw visibility,
alpha or MOT gates. Float32 coordinates truncate with signed32 conversion;
each vertex contributes its native one-pixel RECT, including signed overflow
and empty-rectangle rules. The proven domain is the finite2D plane transform
with the default screen matrix and shift. Other model types, vertex effects,
trails,3D transforms and nondefault screen projection remain partial; normal
rendering continues to process them without guessing a damage rectangle.

The dirty marker and raw cached RECT belong to the colored model even when
its current transform leaves that calculation domain. Transform setters,
parent propagation and actual FES MOT writes mark the model; color/alpha
changes use the native value/override comparison. Known47/48 changes mark
before querying under the old registration flag. Normal3/42/68 removal also
queries before disabling and erasing the old model. The cached RECT changes
during collection; a failed or paused presentation keeps the dirty marker and
history. Successful presentation clears registered models' markers, including
disabled models, while retaining their cached RECTs. Current checkpoints require
both model fields and restore them with the existing transform alias intact.

Real FES CPLANE SIZE preserves the old model's damage before replacement.
Its newly created disabled model retains the existing initial empty-cache
behavior; this does not establish complete SIZE parity or replay its old pose.
The short actual FES/World cases cover movement, failed presentation,47/48,
color, enabled deletion, parent MOT and fresh checkpoint restoration through
the existing presentation boundary. They add no browser pixel evidence.

Direct close for other task/model families, other model replacement damage
and complete native rectangle clipping remain partial.
Full Task geometry/device pixel acceptance and final frame-rate/memory goals
also remain outside that recorder evidence.

Unknown fog-enabled or non-solid inherited branches report an explicit error.
The current2000-quad packet guard is an upload boundary, not a proof that the
original shared batch splits or clamps at2000. Byte reserve/flush and the
persistent Ring cache use the owning Task MeshBatch; complete default-Task
geometry/device and legal2000-particle acceptance remain separate requirements.

The authored default World browser cases use the ordinary FES FILE path and one
actual51/571 Play followed by four normal World updates. A public view and57
camera input select their fixed perspective reference before the registered D6
callback draws on the current World GPU, target and depth. Each Sprite, Ribbon,
Ring and Track case requires actual indexed submission and exact numerical RGBA,
then repeats the same current state in a newly constructed World and its own
GPU through the existing checkpoint restore. Restore reloads the pinned immutable
authored78-byte bootstrap KCS program without executing it, then reopens the one
pinned case Effect for the existing mounted-source identity validation. Each read
reserves its sole ordered quota on entry and must match its fixed length and
SHA-256. FES, texture and all other mounted reads remain forbidden. Rendering and
snapshotting perform no mounted reads. Neither restore nor rendering may replay
resource commands/state, Play, Update or RNG sampling. The helper does not force
Task camera, manager, frame or depth fields. Active legacy CPU vertex bytes,
typed GPU uploads and Uint16 index uploads are observed separately from
backing-buffer capacity.

The first Ribbon/Track draw creates the fixture's sole identified group draw
cache. The tests require the independently fixed count, final cursor and UVs;
Track also requires its fixed sampled colors and sizes. They clone the complete
manager state before drawing, replace only that one initially null cache with
the fixed expectation, and compare every manager field. The fresh checkpoint
must already contain that exact cache, and its next draw must preserve the whole
manager state unchanged. No other matrix, sample, age, pool or counter field is
excluded from the comparison.

The four CC0 effect inputs and independently derived perspective references are
self-contained public test data. Their finite opaque, untextured, solid/no-fog
scope is separate from the older independent typed-backend shader profile.
These cases add no legal2000, device-loss/reset or nonprimary-target coverage.

The fixed source is official Effekseer1.23,
5239bb1e416cbf55b4d3c8170594cbdc7815f263, under the retained MIT grant in
licenses/effekseer-MIT.txt. Typed packing, shared-owner interfaces and renderer
integration are authored JS. The old normal shaders' vertex/fragment algorithms
are ported in readable GLSL; no original EXE/DLL or shader bytecode is required
to run the backend or its tests.

Node tests separate official-template Matrix44 geometry expectations, observed
D3DCOLOR float32 normalization, shared-device call records and real mounted
resource/CPU composition. They read public expected JSON and require no C++
compiler, Wine, native executable or ignored research files.

The minimal public WebGL golden contains seven authored shader/API cases:
textured alpha127 and independent untextured vertex126/127/128 with test-off
and GREATER127. Its exact RGBA comparison profile is pinned Wine8/llvmpipe and
Chromium148/ANGLE SwiftShader. The vertex values use the observed float32
reciprocal conversion; EFK compares float alpha against float32(ref/255).
Ordinary PPI retains its existing integer alpha contract.

The golden input/output data is dedicated to CC0-1.0. Matrix44 algorithm
expectations retain the Effekseer MIT source attribution. GPU profile results
do not establish original manager/geometry simulation or original batch
execution, and they do not replace full kind61 task/World restore checks.

## Texture capabilities and layout ownership

Game ABI `2.6.1.76` and SDK ABI `2.6.1.74` register
`graphics.textureCapsPolicy: 'virtual-d3d9'`. Their independently verified
normal caps constructors write the registered renderer block through the
current virtual D3D9 `GetDeviceCaps` service. The shared platform policy is
`min(4096, MAX_TEXTURE_SIZE)`, or 4096 without a GPU, with guard band
`[-maximum, -maximum, maximum, maximum]`. The ordinary PLANE path captures
these capabilities in its texture layout, negotiates the page limit and passes
the owned guard band to source-cell division. This fixes the previous raw GL
maximum and default half-cell policy. The generic layout and division helpers
retain their independent input defaults. The SDK renderer independently consumes
its caps block's maximum width/height and four guard-band floats, with its own
verified -1/+1 thresholds, when deriving page and cell dimensions.

Current registered layout checkpoints include and validate these owned capabilities;
fresh restore copies them without querying the GPU or replaying FES declarations,
macros, bank services or motion. Existing initialization early returns and
configuration/reinitialization control flow are unchanged. The verified native
scope covers normal initialization, the sound-enumeration tail and the existing
layout owner. This change does not establish every native configuration or
refresh policy, or extend the proof to failed capability queries or mode2.

The short default-entry tests exercise actual PLANE creation, rendered triangle
coordinates, UVs and page identity, plus CPU-owned source pixels and fresh state.
Their GL API recorder has no rasterizer: checkpoint readback verifies only bytes
explicitly uploaded to its known backing, not native GPU pixel equivalence.
The caps policy alone enables neither textured dirty queries nor unknown ABIs.
Ordinary page dirty ownership is independently established below.
The SDK max/guard input policy does not establish complete native factory,
clipping or UV equivalence from the Game tests.

Both reviewed ABIs independently register
`graphics.texturedBoundsQuery: 'model-and-pages'`. The SDK registration is supported
by its own ordinary rectangle source/derived factory, query, page lookup and
successful-presentation retirement evidence. Its ordinary factory uses the source
and derived slots and leaves both independent backend slots empty; their
consuming cache queries remain outside this bounds policy.
Only the registered kind2 SimplePlane task owns this query policy; text tasks'
composed planes retain their existing drawing contract and remain unreviewed.
Ordinary PLANE models in both reviewed versions keep distinct source and derived dirty markers and
a derived cached RECT. Source transform writes mark the source; geometry/MOT
writes and the native color setter mark the derived model, including repeated
identical color assignments. Source vertex rebuilds retain their existing
geometry path rather than being treated as an invented F8 writer. An enabled
query promotes a source marker into the derived marker and immediately clears
only the source. It unions the old derived RECT, calculates the new bounds from
the same divided/projected triangles used by drawing, and updates the RECT.
The derived marker survives queries and failed or paused presentation; successful
presentation retires that marker even for disabled models, retaining the RECT.
Known enable changes and normal3/41/68 removal query under the old enable flag.
The current checkpoint copies both markers, the RECT and the separate transform
buffers without replaying declarations, bank/macro services or MOT.

This calculation covers ordinary finite2D PLANE geometry with the default screen
projection and its owned texture layout. Unsupported geometry keeps its owner
and cached RECT and reports `geometry-domain-unreviewed`. With a clean derived
marker, only actual triangles whose texture IDs have a nonzero page flag
contribute; this query does not union the old cached RECT, write it, or consume
page flags. These
`dirtyQueryGates` are per-query diagnostics passed to presentation, never graph
or checkpoint fields. Actual full drawing and presentation continue in every
case. The existing texture-page owner keeps one DWORD flag for every grid index,
independently of allocated pages and pixel revisions. The table starts at zero
after initial allocation; later allocations preserve it. Upload and clear mark
each intersecting present page before pixel work, and
release preserves its flag. Failed pixel work does not roll back that mark.
Only successful actual presentation clears the entire grid, including unused
and released indices; failed or paused presentation preserves it. The current
checkpoint copies these owned flags and restores them directly without source
uploads. SDK policy remains null and does not activate this tracking or query.
SDK query ownership and complete textured branch acceptance remain separate
gates. Native allocation/capacity fatal callees and external diagnostics remain
unreviewed; this normal resource proof does not establish all native exception
paths. The short recorder
cases establish API, geometry and owner behavior, not native raster equivalence.

### Default World legal2000 workload

The separate `default FES legal2000` browser case uses the existing CC0 Fixed2
Sprite Effect (284 bytes, SHA-256 `c200585d…5cbbd5`) and the original 2000
ordered float32 positions, with exactly two normal World updates. FES owns one
kind61 Task and one logical FILE load. All 2000 public 51/571 Play pairs and both
updates use that Task's actual frame executor. Delegated setup reads are observed
after bootstrap: the Effect source is read once across FILE, Plays and updates;
bootstrap reads before this observer are not counted.

Public view and message57 inputs put this same workload in the default camera's
visible domain without changing the 65-degree rotation, fov, near1/far50, Effect
or positions. The float32 camera eye is `(0, 0, 1.500999927520752)`. Independent
float32 matrix, shader, clipping and 4–12 subpixel-bit raster derivations establish
2000 disjoint samples and reproduce the entire existing 12288-byte RGBA mask
(SHA-256 `86f0a74a…8e126e9`). The hermetic
`default-world-legal2000-reference.json` records those inputs and provenance;
no observed browser pixels create the expected image.

The normal registered callback submits through its own World StageRenderer/GPU,
current primary target/depth, and unchanged physical/logical render state. The
legal manager has 2000 roots outside the pool plus 2000 nonroot instances occupying
the complete 2000-slot pool: global count4000 is distinct from 2000 rendered
particles/quads. One draw contains 8000 vertices and 12000 Uint16 indices. CPU
active batch bytes are192000 within a320000-byte reserve; GPU active vertex bytes
are320000 and index bytes24000 (GL type5123). Two normal/fresh submissions upload
688000 active bytes in total; that cumulative count is neither resident capacity
nor a per-frame byte count.

Two updates have already calculated every newborn before drawing. This Sprite
workload permits no first-draw manager cache exception. Complete manager, Task
restore, CRT and MT comparisons retain typed storage and negative zero. Only this
pinned legal2000 case transports compact successful byte counts/hashes and bounded
failure differences; the four smaller geometry cases retain full snapshots.
A true fresh World owns new CPU, StageRenderer, GPU and device objects. Restore
revalidates the immutable78-byte bootstrap KCS and284-byte Effect exactly once
each, then snapshot and drawing perform no mounted reads. Restore/render cannot
Play, Update, sample RNG, or replay resource commands/state. Both actual normal
and fresh RGBA outputs must equal the independent full reference. This case does
not establish over-capacity behavior, performance, device loss/reset or nonprimary
target acceptance; unregistered versions and slots remain disabled.
