# Native FES images and retained CPU drawing

CIMAGE, IMAGE, DIFIMAGE, BUTTON, PANEL and SAVEPANEL execute their mounted engine's object constructor,
definition application, built-in command handlers, motion virtual methods and
frame driver. Their retained entries share the native drawing task's surface;
they are not drawn as a separate browser overlay.

| Object         | Game constructor / apply / driver | SDK constructor / apply / driver |
| -------------- | --------------------------------- | -------------------------------- |
| CIMAGE (1)     | `748D60` / `768020` / `65CD40`    | `5E93C0` / `6042B0` / `52CCA0`   |
| IMAGE (2)      | `74A170` / `768190` / `65E110`    | `5EA7A0` / `604420` / `52DD00`   |
| DIFIMAGE (25)  | `750230` / `759650` / `65D5E0`    | `5F03E0` / `5F77D0` / `52D540`   |
| BUTTON (6)     | `74BB00` / `768730` / `65C750`    | `5EC030` / `6049C0` / `52C6C0`   |
| PANEL (11)     | `75CB10` / `768920` / `660620`    | `5FAC00` / `604BB0` / `530030`   |
| SAVEPANEL (12) | `762570` / `768930` / `662210`    | `5FE4A0` / `604BC0` / `531C00`   |

The common graphics platform distinguishes a bitmap's ascending physical rows
from its logical pixels. Both reviewed native bitmap classes store the logical
top row at `data + (height - 1) * stride`; their pixel getter confirms that
mapping. `bitmap()` exposes physical rows for the original texture-upload
boundary. `logicalBitmap()` and `writeLogicalBitmap()` transfer logical RGBA,
including canvas, crop offset, anchor, clip, MASK and BTYPE metadata. These APIs
must not be interchanged or globally flipped.

The original retained compositor remains responsible for integer and affine
sampling, clipping, opacity, MASK, BTYPE and ordering. A drawing surface retains
its original manager until the surface is resized or released. Native image and
ANM entries enter the manager through its retained-source operation
(`743270` / `5E3EA0`), which holds the same original object. Its owner, canvas,
anchor, animation and bitmap references are preserved. Effective animated
opacity is not written back as base opacity during rebinding.
Host-authored bitmaps cross the CPU format boundary when their data identity or
revision changes. The retained manager, source references, pixels and dirty
state belong to the single native process checkpoint. The logical CPU result updates the drawing task's
bitmap; the original upload boundary writes physical rows to VRAM and its
allocated texture pages. A source MASK selects a native BGRA byte channel for
destination alpha. BTYPE is a separate compositing field; it is not the MASK
selector.

| Boundary                         | Game                | SDK                 |
| -------------------------------- | ------------------- | ------------------- |
| Manager constructor / destructor | `742A10` / `742CF0` | `5E3720` / `5E39E0` |
| Bitmap entry                     | `742E20`            | `5E3B10`            |
| Retained entry                   | `743270`            | `5E3EA0`            |
| Image-owner entry                | `743100`            | `5E3D70`            |
| Remove entry                     | `743390`            | `5E3FC0`            |
| CPU compositor                   | `7439B0`            | `5E45E0`            |
| Clip / priority                  | `7441F0` / `744340` | `5E4E20` / `5E4F70` |
| Final bitmap upload              | `677690`            | `54E790`            |

ANM files execute the original retained object's interpreter, including its
frame, alpha and display state. That raw state and the FES object's own KCS
motion survive a fresh-process checkpoint. The game enumerates HG3 frames for
the retained all-frame source; the SDK also enumerates HG2 frames. That observed
profile difference is preserved. The game's image-prefetch worker executes its
original callback to completion before first presentation. This bounded browser
substitution is specific to that recovered resource worker, not general Windows
thread emulation.

Source initialization creates BUTTON's BasePlane input child; its original
frame driver binds the real bounds and priority. Original task and FES object identities remain in the
owning Top's namespace. Destruction removes retained items and releases borrowed
bitmap mirrors separately from their native source owner.
The script-side enabled value is pulled from the native object's enable word,
including changes after definition application. Native button navigation and
public rectangles read the actual registered input region, which can include
image-frame anchors absent from the object's scalar position.

KCS `2DB` and `2DC` provide a 64-byte image owner in descriptor field 3.
The original retained object binds it through `745E60` / `5E6CF0`, retaining
the real owner. Releasing the KCS handle leaves that reference alive; removing
the last retained record runs the original owner destructor. This ownership
also survives a fresh World. `tests/native-retained-owner.test.mjs` compares the
KCS path's complete asymmetric CPU surface against the original manager's
direct owner-source operation. `tests/browser/native-retained-owner.spec.mjs`
checks actual uploaded pixels, original-handle release, separate restored GPU
pixels and final owner destruction in both profiles. Authored clients explicitly
configure their texture regions; a zero-sized native texture grid does not
silently gain VRAM pages.

DIFIMAGE's original `refex` handler accepts the same real 64-byte image owner.
Its original frame driver sends a retained kind-3 source to the drawing task,
retaining the owner separately from the FES reference. Authored KCS loads an
asymmetric twelve-color image, transfers it through `refex`, releases the KCS
handle and checks all actual shared-backbuffer pixels in both profiles. A fresh
World preserves the complete CPU/GPU result; deleting the FES object removes
the last pixels and references. This establishes the external-owner path, not
every capture/reference variant of DIFIMAGE.

Borrowed bitmap mirrors do not extend native source lifetime. Retained record
replacement and ANM advancement may release the old bitmap before the next
host refresh. Dirty bounds are retained with the previous entry, so invalidating
its old region never reads freed bitmap metadata. Mirrors are removed before
the final original owner releases their backing memory. Raw FES destruction
visits children before parents, matching the original parent-container lifetime.

## Panels and save panels

SAVEPANEL construction copies the FES parent's context directory into the
original object: UTF-16 in the game, CP932 in the SDK. `setsave` constructs the
original `save%04d.dat` name and runs the original CSS loader, flag import,
date lookup and panel-part rebuild. The file, thumbnail and text remain actual
global-file entries; no host save-menu object supplies invented values.
The original panel frame driver composes the parts, including GDI glyphs, into
one bitmap before it enters the retained surface. Browser glyph masks are a
platform substitution, with the same limitation described in [native text](native-text.md).

The complete fixed `ptype` handler branches run as native code for `NORM`,
`IMAGE`, `SIMAGE`, `IMAGEOBJ`, `STR`, `SSTR`, `NUM_S`, `NUM_O`, `NUM_O2` and
`NUM_I`. These pinned engines differ from the older manual: `IMAGE` does not
consume its documented file argument; `IMAGEOBJ` and number-object references
use the object's bracket selector, and `STR`, `NUM_S` and `NUM_I` retain their
original parser/default behavior. The bridge does not fill those unused fields
from the manual. SSTR and SIMAGE use real CSS entries; original numeric, date,
flag, font and layout processing stays in the mounted engine.

## Evidence and remaining scope

BGTABLE and BGTABLE2 use their original constructors, `TABLE` definitions and
loaders. BGTABLE has four 32-byte filename variants per binary row. BGTABLE2
selects only CSV rows marked with CP932 `○`, then reads column `variant + 2`.
Invalid rows, variants and empty entries leave the previous image unchanged.
CHTABLE reads its original 86,400-byte character/pose table and both 16-entry
variant banks; fixtures cover plain-prefix selection and unsigned bounds.
Authored fixtures check these paths in both profiles through original image
drivers, retained resources, replacement selection and fresh-World restoration.
CHTABLE2 reads its original relative-offset binary hierarchy, checks both
leading selector axes, traverses dimension/value IDs and applies `baseopt`.
CHTABLE3 reads named text sections beginning with `_TOP_`, follows each selected
row's next section and merges its filename components. Fixtures check `max`,
partial and invalid paths, the original plain-prefix suffix behavior and
fresh-World restoration. Complete mask combinations and all table commands
remain in progress.

IMGWND executes its original constructor and image-window frame driver. Its
native nine-frame composer builds the four corners, tiled edges and center from
the mounted HG3/HG2 reader. Authored nine-frame HG3 fixtures check all nine
regions, actual retained drawing, visibility and fresh-World VRAM restoration
in both profiles. The original IMAGE definition apply function ignores the
ordinary `SIZE` column, including for IMGWND; the fixture declares its filename
in the header and executes the supported `size` command in `START` before the
first frame driver decodes it. Source initialization only allocates its empty
bitmap wrapper. Reference-derived sizing, all
window command combinations and final browser-pixel acceptance remain open.

Comma image references execute each engine's complete original layer composer,
including metadata, union bounds and pixel mixing. Mounted IFile resources
supply the original image readers. Independent tests call the entire original
FES image-cache entry before testing its production adapter. Both entries return
zero even after a successful composition. The SDK composes asymmetric authored
layers correctly; the pinned game instead passes the narrow filename prefix to
`wsprintfW("%s_")` and requests a name formed by interpreting its byte pairs as
UTF-16. That profile difference is preserved. Optional global decoded-image
cache lifecycle, complex character-table masks and independent final-screen
orientation acceptance remain open.

`verify-native-bitmap-upload.mjs` separately executes the complete original
bitmap-to-texture path in both engines. Only D3D device/texture COM methods and
Windows rectangle calls are host boundaries. Eleven authored cases compare
whole padded texture pages, dirty flags and LockRect calls for source cropping,
frame offsets, negative destination coordinates and four-page uploads. The Web
upload pipeline matches these bytes. This proves that upload retains the
bitmap's physical row order; it is separate from interpreting image-format
rows or validating a complete original Windows frame.

An initialized native renderer uses the actual original TextureManager and its
D3D texture allocations. Bitmap uploads run the original page routing,
LockRect, pixel conversion, UnlockRect and AddDirtyRect path. Browser frames
are decoded views of those live texture bytes; a page checkpoint stores only
the native binding marker, with pixels saved once by the shared process.
Original rectangle release and configured-area reallocation retain existing
pages and formats. `native-texture-memory.test.mjs` checks a four-page upload
across 32-bit and 16-bit pages, release/reallocation and fresh-process identity.
The full view's default 16-bit upload uses the original ordered dithering flag;
the earlier direct scalar/MMX packing probe deliberately tested that flag clear.
Standalone authored compositor clients still use their explicit host page store.

`verify-native-retained-raster.mjs` runs both complete original managers
independently with 43 authored inputs each. The public golden preserves all CPU
and VRAM bytes for ordinary/affine drawing, variable alpha, all four MASK
channels, BTYPE 1–5, negative scale, anchors, clip and partial dirty rectangles.
`native-retained-raster.test.mjs` checks the production drawing-task path against
those results. Browser tests take ten asymmetric cases per profile through a
real native textured plane and StageRenderer's shared GPU; RGB and render-target
alpha agree within one byte. These tests distinguish top and bottom rows.

`native-fes-images.test.mjs` uses authored FES, HG2/HG3, ANM and KCS motion to
check original construction, headers, BUTTON input, frame selection, visibility,
motion, destruction and continuation after restoring into a new World. Panel
fixtures run all ten `ptype` branches with actual CSS thumbnail/string/1024-word
flag records, file timestamps and complete composite pixels across a fresh World.
The persistent compositor tests also cover repeated draws, source revisions,
geometry changes that retain the source identity, entry removal and surface release.

`verify-native-hg3.mjs` separately compares the original decoder and logical
pixel getter with the public lossless HG3 decoder. Both PEs agree on 36 authored
frames covering asymmetric RGB(A), split sections, selectors, crop offsets and
anchors. Mounted SDK samples add 22 frames / 4,174,620 total compared RGBA bytes;
mounted game samples add 16 frames / 42,522,656 total bytes. Those totals include
the authored frames. Their names, raw bytes and reports stay ignored. The
lossless stream's first decoded row is its logical top row. These checks do not
establish JPEG/WEBP sections or an original HG3 writer.

Compound viewport image sources and retained nested-renderer resources still
have explicit missing adapters. Other image-derived FES object types remain
separate unfinished contracts. Complete skin/input/scene acceptance is ongoing.
Exact CPU raster kernels are installed at the reviewed instruction boundaries.
Their full register, stack and image comparisons are separate from the manager
and final GPU pixel checks. Remaining full-game timing and scene acceptance is
not established by the small authored fixtures.

Primary references: [CIMAGE](https://cs2.suki.jp/manual/fes/code/o_cimage.html),
[IMAGE](https://cs2.suki.jp/manual/fes/code/o_image.html),
[BUTTON](https://cs2.suki.jp/manual/fes/code/o_button.html).
[SAVEPANEL](https://cs2.suki.jp/manual/fes/code/o_savepanel.html),
[ptype](https://cs2.suki.jp/manual/fes/reference/co/ptype.html).
Frozen executable bytes, decompilation, resources and raw traces are never
distributed in the public fixtures.
