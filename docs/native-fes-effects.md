# FES transition models

`fes-effect-model.mjs` is an independent JavaScript model of DRAW7/WIPE8,
RDRAW26/RWIPE27 and RWMOS31/RFMOS32. It calls the existing D6 canonical tasks for
actual CPU blending, captures, clocks, callbacks and rendering. Its object
identity and its child World task ID are separate. Default FES integration and
old execution/projection removal are still pending; this module alone does not
credit those families as migrated. PARTICLE23 and WBREAK30/task52 are separate
remaining work.

One `FESEffectModel(services)` belongs to each FES collection. The services create
real child tasks, send canonical packets, resolve live PLANE/Draw state, supply
owned mask/snapshot handles, execute recursive MOT queries and manage authored
output visibility. Packets are created at allocation/restore and reused at
repeated initialization. The caller serializes resource operations; snapshots
reject outstanding asynchronous operations.

The model preserves command-time capture0, collection-wide generated-name
guards, concrete PLANE selection, category-resolved mot/dummy without registers,
raw flags/level and the five-word WIPE scheduling record. Allocation and each
negative initialization phase are separate visits. Area effects initialize
without an eager send; screen effects initialize eagerly and repeat at the
specified visit. RWMOS repeats initialization, captures slot1, sends517, then
starts. Clock0 retains its original start-phase behavior. Completion uses the
real child activity query, including render-dependent completion.

Plane count snapshots read only raw type4. Reconciliation consumes the typed
IMAGE display delta once by sign, wraps the count word, and clears only a delta
whose PL association resolved. These helpers use the existing `nativeType`,
`currentCount`, `beforeCount` and `displayDelta` fields; they do not derive a new
count from temporary output visibility or pixels.

## Snapshot rows and ownership

`copyFESBitmapRectangle` copies the original physical storage rectangle into an
independently owned bitmap, preserving bpp and the **requested** output extent.
Source clipping copies a smaller extent at destination physical0,0 and leaves
its remainder zero; it does not resize the snapshot. RGB24 zero pixels remain
opaque in the canonical RGBA representation. FES DRAW copies the live Draw at
PLANE VRAM origin, outgoing WIPE at0,0, and cross WIPE at Draw offset+VRAM. These
origins must not be unified.

Physical rows differ from the bitmap registry's logical image Y. The original
copy methods of both registered engines were run through the existing bitmap
projection, without a new patch/probe, for ARGB32 and RGB24 nonzero-origin and
clipped rectangles. The public fixture retains all copied pixels. The area
model's real D6 tests use this production snapshot helper, including asymmetric
source rows, rather than a logical-image crop with the same numeric Y.

DRAW allocates its child before taking the snapshot. WIPE loads/converts its
mask before allocating the child. The mask service must implement the existing
ARGB conversion; the new effect fixture covers authored bpp4 masks. Borrowed
live Draw bitmaps are never released by FES cleanup. Owned masks/snapshots are
released during the later resource cleanup visit.

## Mosaic range and cleanup

The approved deterministic mosaic range is0..50000 by default. Explicit global
range arguments convert uint32 to float32 and become the authoritative semantic
range. Both516/519 initializer range words, capture0, RWMOS capture1 and the
checkpoint use that same range. The original two uninitialized stack words are
not reproduced; this specific difference is intentional and is not described
as native byte equivalence.

Normal DRAW/WIPE/RDRAW/RWIPE cleanup sends child3, then releases owned resources.
Normal mosaic31/32 cleanup removes the FES resource entry without child3,
preserving the separately evidenced original callback/task residual. Final
World owner teardown still releases the actual child and callback. The range
policy does not authorize changing this independent lifecycle behavior.

Sleep/wake preserves notify -> one resource visit -> output masking/restoration.
DRAW and WIPE receive258 on sleep; wake flushes Draw292 without restarting them.
Authored display/enable/count/delta remain unchanged. Existing child clocks
continue independently of the gated FES driver.

## Verification and remaining boundaries

The short model tests use a real JS World with EXE loading set to throw, real D6
CPU/capture/work buffers, fresh-World restore between captures, running and
pending-cleanup restoration, and actual owner teardown. The screen fixture's GPU
records geometry and clear pixels; final WebGL compositing remains a browser
integration gate. No placeholder skipped test claims that coverage.

The default FES controller must still supply the real WIPE scheduling consumer,
mask conversion, source/command context and recursive MOT/lifetime services.
The D6 shared capture allocator retains its existing behavior; the two-capture
case prepares two targets before observing command prepare1. This test does not
approve changing the allocator's unprepared1-to2 path or its capture lifetime.
Unknown effect types, missing services and failed allocations report explicit
errors. Missing parent/mask clears MOT while retaining the FES identity, as in
the original branch.
