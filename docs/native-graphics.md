# Native graphics and VRAM pages

Ordinary textured planes and explicit divided meshes use the same owned VRAM
pages. The CPU bitmap retained for drawing commands is separate from those
pages. Releasing a page drops its pixels and GPU texture; subsequent uploads
cannot update it until the original missing-page allocation operation runs.
Reallocation clears the new page and preserves the other pages' identities,
pixels and depth. A missing page follows the native unbound-texture behavior.

Mounted-engine clears execute the original view and TextureManager functions
(`6745B0` → `6803E0` in the game, `54B6A0` → `557000` in the SDK). They
intersect the requested rectangle with each existing page, lock its native
16- or 32-bit texture, and clear the intersecting bytes. Missing pages stay
unallocated. A 3072×6656 virtual rectangle therefore needs no full-size RGBA
bitmap. The view's disabled gate still returns failure without changing pages.
An existing CPU VRAM shadow is cleared only within its current extent.
Authored tests cover partial cross-page clears, sparse allocation, preserved
page identities/formats, subsequent original 16-bit dither uploads and fresh
World restoration in both frozen engines. Ordinary host bitmap uploads still
materialize the CPU shadow; large-coordinate uploads need a separate bounded
transfer change and are not covered by this clear fix.

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
256 KiB checkpoint budget. The overall checkpoint limit remains 256 MiB.

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
