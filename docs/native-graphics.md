# Native graphics and VRAM pages

## Renderer-owned surfaces

`StageRenderer.surfaces` owns packed texture and surface bytes in JS, including
headless Worlds. The transitional D3D device lends a PE virtual-memory projection
at LockRect and commits writable locks at UnlockRect. Copy, stretch and readback
operate on the renderer bytes. Guest heap capacity no longer owns these pixels.
The resource HRESULT and COM identity contracts remain observable at the DLL
boundary. Renderer checkpoints save sparse surface bytes and reject open locks.

The migration board registers this boundary as `renderer-surfaces-to-dll-locks`.
Original Draw/graph consumers have been replaced. FES consumers remain
until phase 7 and original E-mote/PPI consumers until phase 9. GPU targets and
sampling frames are derived from the same JS resource records.

Pixel projections use fully committed, nonexecutable RW spans outside the guest
heap. The renderer maps each span once and registers its lifetime with the
existing virtual-region registry. It does not reserve a large block and change
permissions per page from an active COM callback: a real 4095×2122 texture
exposed a CPU-backend stall in that path. Current checkpoints retain the
projection identity. Renderer-owned protection runs restore together, preserving
explicit read-only pages and decommitted holes without splitting every pixel
page into a CPU mapping. Other Win32 allocations retain their existing restore
behavior. StageRenderer bytes remain authoritative.

## JS model ownership and frame order

Kinds 2 and 6 use JS receivers and owned model data. Task IDs belong to a Top;
GraphManager IDs are raw native numbers shared by the view. Same-number planes
therefore alias one JS graph even under different Tops. Replacing or destroying
either changes the shared model. Queries retain task-local rectangle fields.

`plane-models.mjs` owns file-backed KX2 triangles and Plane trail history/modes.
`graphics.mjs` owns transforms, button state and input packets. The initial model
priority is 5000, confirmed against both original receivers. Solid models share
the geometry and texture selector's transform, as in the original model.
File-backed KX3 messages retain the original unchanged-model result.

`screen-effect-render.mjs` sorts by base priority and stable insertion sequence,
including particle, text and M2 submissions. StageRenderer owns the active target,
depth/stencil, texture pages and GPU submission. The original priority-55000
background ordering remains observable in the sorted queue. No original graph
traversal, Plane receiver or graphics worker runs on the normal drawing path.
The old implementation is available only through the explicit test composition
`tests/fixtures/graphics-oracle-world.mjs`.

World completes clock/window delivery, settles movies, runs task logic and draw
ticks, then flushes writes before the frame resolves. Tick, checkpoint and close
reject concurrent unsettled frames. Render has a separate completion guard and
recording runs after a successful present. Current checkpoints store JS graph,
trail, page and draw state. This is an unreleased format changed in place;
fixtures use the current writers and no earlier development reader is retained.

## Remaining consumer projections

`oracle/graphics-consumer-projection.mjs` lends view/device identities, matrices,
draw caches and bitmap packets to FES/text (phase 7), SDK/media (phase 8) and
M2 (phase 9). `renderer-consumer-projection.mjs` constructs the remaining view
lazily. Its native VRAM area table is empty during construction: remaining
consumers borrow JS pages instead of allocating a second page store. The canonical
configuration is restored immediately; Node tests verify both ownership and a
fresh restore. Large game startup otherwise spends minutes clearing duplicate
original textures.

Device defaults and configured filters are separate. A required M2 renderer
establishes shared linear sampling before scripts; JS-only Worlds preserve that
existing ABI capability's initialization state. The standalone consumer view uses
its configured words at +348/+352. The post-initialization native M2 device state
is imported explicitly. Both AVI boundary coverage and SDK screen effects retain
their existing assertions; no ABI format or version-selection logic changes.

The accepted `plane-movie-decoded-texture-projection` keeps original movie/COM
lifetime and borrows VMR9 or Texture Renderer decoded textures. JS owns Plane
geometry, visibility, transforms, ordering and submission. This D8 projection is
removed in phase 8. E-mote/PPI use the scoped `withPluginTarget` submission
interface until phase 9; their DLL algorithms are unchanged.

The migration inventory registers each projection's direction, fields, consumers
and removal phase. Shared records follow the approved 6 → 9 → 7 → 8 order:
DLL output and initialization end in 9, FES borrowing in 7, media/SDK borrowing
in 8. Test-only old code is absent from the shipped include list.

The [render route audit](b-phase6-route-audit.md) resolves both ABIs' 57 former
unknown wrappers. Normal Plane/Draw receivers are JS; conditional original
Scroll, SDK and M2 receivers remain listed per native in the inventory. The
remaining bitmap/image-owner/HG helpers serve FES or foreign tasks, keep their
EXE baseline counts, and are no longer classified as domain-6 rendering.

## VRAM pages

Ordinary textured planes and explicit divided meshes use the same owned VRAM
pages. The CPU bitmap retained for drawing commands is separate from those
pages. Releasing a page drops its pixels and GPU texture; subsequent uploads
cannot update it until the original missing-page allocation operation runs.
Reallocation clears the new page and preserves the other pages' identities,
pixels and depth. A missing page follows the native unbound-texture behavior.

JS page clears intersect only allocated pages and update their packed 16/32-bit
bytes. Missing pages stay unallocated. Uploads materialize only the requested
source intersections. The 4x4 A4R4G4B4 conversion/dither phase is retained and
snapshotted at page creation. Page identities and revisions remain stable;
CPU VRAM and uploaded pages have independent contents and lifetimes. Two-ABI
sequence tests compare clipping, origins, sparse allocation, clear/upload/release
and fresh World restoration with the original manager.

The page manager negotiates configured dimensions against device limits, then
rounds actual texture dimensions to powers of two. Graph subdivision retains
the configured dimensions. It uses full-page cells when all four device guard
bands extend beyond the clip rectangle, otherwise half-page cells. The browser
uses the latter guaranteed clip bounds. The native width-ratio calculation for
both axes is retained, including rectangular and odd page dimensions.

Subdivision transforms the source triangles, intersects them with each cell,
orders the resulting polygon, generates triangle fans and computes page UVs.
It then subtracts the source position. The divided model applies its own
transform and half-pixel offset before projection. Source and geometry
transforms therefore remain distinct; rotating or moving texture coordinates
does not become a crop of the full CPU bitmap.

16-bit pages use the original A4R4G4B4 high-nibble conversion. Page frame objects
remain stable while their revision changes, causing an existing GPU texture to
upload new pixels. Checkpoints preserve allocated holes, page depth, revisions
and pixels. A fresh GPU recreates textures from that state.

Bitmap backing resources and texture pages encode checkpoint pixels as sparse
fixed-size byte blocks. Omitted blocks restore as zero while retaining the
exact allocation length. Bitmap aliases still share one backing resource;
texture pages remain independent of the CPU bitmap, including stale pixels
from edits not yet uploaded. Canvas changes commit before their backing handle
is encoded. Public portable-checkpoint tests cover an 8 MiB bitmap, aliases,
independent CPU mutations and separate 32/16-bit page contents within a
256 KiB checkpoint budget. The temporary transitional checkpoint limit is 768 MiB and is registered for removal in phase 10.

## Evidence

The two frozen engines are executed separately with authored inputs:

| Probe                              | Comparisons across both builds | Boundary                                                                                                                           |
| ---------------------------------- | -----------------------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `verify-native-mesh.mjs`           |                          1,292 | Complete graph parameter/mesh wrapper transport and divided-model affine conversion; engine message delivery is supplied.          |
| `verify-native-texture-layout.mjs` |                          3,048 | Dimension negotiation, page selection and original scalar/MMX pixel conversion.                                                    |
| `verify-native-texture-pages.mjs`  |                          5,800 | Complete main21D/21E and manager allocation/release; D3D resource creation/destruction is supplied.                                |
| `verify-native-divided-model.mjs`  |                          1,120 | Original polygon clipping, source transforms, allocation, subdivision and UV generation; USER32 rectangle primitives are supplied. |

Public authored golden records preserve floating-point bit patterns, including
signed zero. Browser pixel tests exercise ordinary cross-page planes, 16-bit
color, released pages, fresh allocation, texture-position changes, GPU revision
updates and restored pixels. These checks do not establish every original
renderer state, arbitrary callback geometry, or complete scene rendering.

## Cursor plane and canvas composition

The cursor retains the view's visibility word, update gate, requested filename
and hotspot separately from the currently loaded image. The D3D cursor accepts
32-by-32 four-byte bitmaps and retains its previous image when a replacement
fails. The software cursor removes its reserved `INT_MAX` sprite before a new
load, and accepts the loaded bitmap's raw dimensions. Both paths place raw
pixels at pointer minus hotspot; bitmap canvas, offset and origin metadata do
not shift that rectangle. The first D3D backup image remains independently
owned. Closing releases active and backup images; checkpoints retain their
separate handles.

The browser presents cursor pixels through a final plane. It uses the original
view gate for image and visibility changes and preserves the raw visibility
word, including non-Boolean values. CPU canvases enter the D3D geometry path
with the half-pixel adjustment needed to cancel its native pixel-center offset.
This keeps unscaled bitmap pixels sharp across movement and fresh GPU restore.

`verify-native-cursor.mjs` executes each frozen engine separately: 431 checks
per build cover the complete view setter, filename encoding, backend dispatch,
gate, D3D size/depth checks, first backup, actual bitmap copy and raw upload rows.
Image loading and D3D COM methods are supplied boundaries. Public ownership
tests and an exact-RGBA browser test cover the host plane. These checks do not
establish the complete file-to-cursor path or Windows hardware-cursor screen
pixels; movie handling must maintain the shared cursor-update gate.

Blank bitmap construction accepts zero in either dimension. It keeps a nonnull
owned bitmap while its pixel storage is empty; raw canvas dimensions start at
zero. Cloning a nonempty bitmap materializes the effective canvas dimensions
and resets the clip to the full raw rectangle. An empty source's native copy
fails after creating the destination wrapper, leaving its metadata initialized
at defaults; the clone wrapper still belongs to the calling task.
`verify-native-image-create.mjs` executes main `0x70/76/77/72`, constructors,
copy and the original automatic image list: **1,622 comparisons per build**.
Cases cover zero dimensions, full raw/canvas/anchor/clip fields, copied pixels,
independent release and null handles. Empty canvas access skips the browser's
invalid zero-size `ImageData` operation. Resizing an empty logical canvas is a
separate acceptance boundary.
