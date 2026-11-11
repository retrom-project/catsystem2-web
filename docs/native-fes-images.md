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

The JS retained compositor owns integer and affine sampling, clipping, opacity,
MASK, BTYPE, ordering, dirty regions and references. FES producer descriptors
cross `oracle/fes-draw-projection.mjs` until phase7. The importer preserves
allocation generations, frame maps, ANM clocks and live wrapper identities.
The JS ANM result is published back to each original producer record at the
call boundary. Animated effective opacity remains separate from base opacity.

NativeBitmap stores logical RGBA rows. The Draw raster uses physical rows and
converts its final CPU result back to logical rows. VRAM receives physical
rows. Resource pixels and ANM state belong to JS handle snapshots. GPU/COM
locks use the StageRenderer-owned surface store through an explicit DLL
projection. The following original compositor addresses are oracle evidence.

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

ANM files execute the JS 18-opcode interpreter with the shared World integer
RNG. Clocks, registers, alpha, display and frame selection survive restoration.
Game HG3 frames and SDK HG2/HG3 frames retain their observed enumeration
difference. Script sources are fully decoded before publication. FES's remaining
producer worker is settled at its registered import boundary.

Source initialization creates BUTTON's BasePlane input child; its original
frame driver binds the real bounds and priority. Original task and FES object identities remain in the
owning Top's namespace. Destruction removes retained items and releases borrowed
bitmap mirrors separately from their native source owner.
The script-side enabled value is pulled from the native object's enable word,
including changes after definition application. Native button navigation and
public rectangles read the actual registered input region, which can include
image-frame anchors absent from the object's scalar position.

KCS `2DB` and `2DC` provide a 64-byte image owner in descriptor field 3.
JS Draw aliases its bitmap-data and layers, preserving independent references
after the script owner or PE projection is released. This ownership survives a
fresh World. The Node owner test compares the asymmetric CPU surface against
the original manager's direct owner-source operation. The browser test checks
actual uploaded pixels, restored GPU pixels and final resource destruction.

The SDK CG viewer declares an IMAGE and uses `loadlist2` to select from its
registered CGs. Both pinned engines execute their original `loadlist` and
`loadlist2` handlers. The current FES instance's CGL file and serialized
registration bytes are copied through the original list readers into a scoped
native owner. The interpreter restores its previous pointer after the command.
This keeps the FES registration source authoritative and lets the original
handlers resolve the variant and load the image. Authored tests distinguish
unfiltered and seen-only selection by exact colored pixels, check that a miss
preserves the image, and restore the drawn surface in a fresh World.
The same authored gallery opens an all-frame HG3 in its animation IMAGE,
loads an ANM, and compares the composed pixels on successive frames after a
fresh restore. Both original drivers choose an existing static bitmap before
their all-frame source branch. The fixture gives the animated viewer its own
IMAGE so the original all-frame path is the one under test.

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
`native-retained-raster.test.mjs` checks the retained oracle against those
results. `tests/differential/draw-raster.test.mjs` checks the JS compositor
against the same bytes, with no channel tolerance. Browser tests take ten asymmetric cases per profile through a
real native textured plane and StageRenderer's shared GPU; RGB and render-target
alpha agree within one byte. These tests distinguish top and bottom rows.

The retained oracle's large affine and integer BTYPE draws can use additional allowance for
complete simulated rows within the original retained manager call. The
scope covers its owned RGBA32 bitmap, up to 2,073,600 pixels with each
dimension at most 1,920. The descriptor, original loop and helpers must pass
the raster guards. The computed final row must fit the remaining native
budget. That row and all other guest instructions still use the ordinary
200-million-instruction limit per execution segment. The scope expires
with the call, including after a fault.

`native-render-budget.spec.mjs` exercises 720p and 1080p affine draws and
1080p integer overlay and dodge in both mounted browser Worlds. It compares
the full bitmap, visible backbuffer and instruction totals against the
original manager with shortcuts disabled. A repeated draw in a fresh World
produces the same pixels. The native budget tests also compare the cutoff,
registers, stack and memory for ineligible rectangles and an unknown guest
loop after a credited draw.

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

The lossless HG3 reader uses bounded host work for its vertical delta rows at
`5733E4` (SDK) and `6A1FF4` (game). The native image-owner loader and bitmap
decoder supply a per-call byte allowance. Only rows inside the verified
bitmap, source and lookup ranges are processed in bulk; the final row,
bitstream handling and all surrounding guest code still execute in x86
under the ordinary instruction cap. The regression checks the complete BGRA
bitmap with a cap that stopped both original row loops.

Compound viewport image sources and retained nested-renderer resources still
have explicit missing adapters. Other image-derived FES object types remain
separate unfinished contracts. Complete skin/input/scene acceptance is ongoing.
The remaining phase7/9 producers use registered legacy raster kernels at
reviewed instruction boundaries. Script Draw uses the JS raster directly.
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

## Standalone JS model during phase 7

`fes-image-model.mjs` currently provides independently verified selector and
coordinate helpers; it has not yet replaced the original default FES image
entry or its projections. The existing execution counts stay in the migration
inventory until the coordinated family switch.

The selector stores 32 initial IDs, explicit-table activation, the current raw
unsigned ID and independent table/image dirty flags. A table entry can force a
reload of the same ID. Invalid table indices leave all state unchanged; an
explicit table rejects `setid` above 31, while a direct selector retains
`0xffffffff`.

Coordinate queries distinguish PARENT from PL. Image coordinates sum
`float32(float32(origin + position) - base)` and only recurse through raw parent
types CIMAGE/IMAGE. Plane coordinates add local position and only recurse
through CPLANE/PLANE/STRING parents. Parent base, scale, rotation and drawing
plane association are not added by these queries. Parent-first arithmetic and
CVTT float-to-int behavior are explicit; changing the sum order changes the
observed float32 cancellation cases. Buffers are borrowed and reused per object;
checkpoint state remains ordinary authored fields and selector values.

`tests/fes-image-model.test.mjs` compares both profiles' eight selector states
and eight coordinate cases plus five BUTTON-lock states against independently
captured original command
outputs, including unsigned sentinel values, invalid indices, parent type
filters, cancellation, overflow and fresh model reconstruction. It also checks
buffer identity, cycles and the absence of serialized pointer/cache fields.
BUTTON lock captures visible floating coordinates only on an unlocked-to-locked
transition and retains the raw lock word. Its input query uses that snapshot
plus the current image parent, including the original double-parent addition;
image drawing continues to use live position. Reassigning a nonzero lock does
not capture again. Lock state restores as ordinary fields.

These helpers do not establish complete image loading, definitions, rendering,
input or family integration; those remain phase-7 work.

## Typed common state model

`src/native/fes-common-model.mjs` contains independently verified JavaScript
setters and queries for the image and plane families. It preserves the distinct
size setter/query type gates, image priority's comparison and +20 adjustment,
the separately retained definition entry key, float32 positions and integer
queries, auxiliary image sizes, raw clipping rectangles, PL associations and
external parent-plane numbers. Dirty propagation follows PARENT relationships;
PL does not create a lifetime or coordinate parent.

The authored fixture records 32 original command observations for each registered
engine. A separate variable-bank test covers the exact -1 output sentinel and
out-of-range dirty behavior; the original oracle's host bridge rejects -2 before
its native bank setter, so that test uses the independently recovered bank
contract rather than claiming an original runtime comparison for -2.

This model is not yet the production FES command entry. MOT programs, control and
log setters, child tasks and render drivers remain separate integration work;
the migration inventory continues to count their original execution paths.

## Typed MOT state adapters

`src/native/fes-motion-model.mjs` preserves the distinct virtual adapters rather
than treating every object as an ordinary rendered plane. Its IMAGE snapshot
starts with 144 zero bytes, exposes priority minus 20 as base Z and includes only
the alpha color byte. Plane snapshots expose their raw priority as base Z;
application writes that value into local base Z without changing priority. Even
PLANE does not expose its separate VRAM origin through this MOT adapter. Angles
remain in radians, and plane matrices retain their float32 words.

Controls and particles expose only alpha. SCROLL and PARTICLE always propagate
dirty after motion output; SCROLL2 and SLIDER instead set their alpha-pending
field. The full raw display word remains separate from its visible boolean;
image display changes also accumulate the original display-count delta. Known
Base virtual methods do not replace the manager base or project MOT output into
object geometry. They still require real manager execution in the command and
frame driver.

Both engines' authored-MOT fixture independently records the complete snapshot
and output application for IMAGE, CPLANE, PLANE and all three controls. Additional
tests cover matrix NaN payloads, signed zeros, buffer reuse and reconstruction
from copied semantic state. This adapter is not yet connected to the production
FES family entry.

The built-in blend register builder now makes its recovered source explicit:
only planes use the previous ARGB's RGB. Other supported families use the
world-owned command-source address already maintained for FES string identity.
This is supported by the original handler instructions; the new common oracle
does not expose the internal register packet and is not claimed as a dynamic
blend comparison. The existing sound path keeps its verified behavior.

## JavaScript window composition model

`fes-window-image.mjs` implements IMGWND's CPU nine-piece composition as an
independent resource model. The default FES driver above remains counted until
its separate integration/removal. Call `composeFESWindow(images,width,height,
loadFrame,owner)` only when the image/size resource is dirty; normal rendering
must not reload or recompose it. `loadFrame(id)` returns an owned bitmap or0.
The compositor releases every temporary frame and returns one independently
owned output; I/O errors release the partial output as well.

IDs0..3 are physical corners,4/5 vertical edges,6/7 horizontal edges and8 the
center. Edges and center tile with their **own** decoded dimensions, including
their inset and clipped last piece; they do not stretch or derive one common
border from corner0. Composition preserves order0..8, source bpp/alpha behavior
and independently clipped native rectangles. Physical row coordinates convert
to the bitmap registry's logical RGBA coordinates after clipping. Missing frames
are skipped without substituting frame0.

The public authored fixture contains complete original pixel output from both
registered engines for a13×11 window: unequal tile dimensions, asymmetric
per-pixel colors, half/zero alpha, clipped final repeats and missing5/7. The
JavaScript test uses the real JS cache/decoder/bitmap operations with EXE loading
set to throw, then restores the owned output into a fresh World without
reconstructing tiles. Original instruction transcripts and the reused original
World harness/captures remain in ignored phase7 evidence.

Zero-extent tiles and repeated-axis tiles larger than the target throw and
release ownership explicitly. Those inputs make the original unsigned tiling
bounds underflow or fail to progress; they are not covered by the normal-window
pixel equivalence claim. Full FES initialization timing, resource dirty flags,
Draw/input ownership and default new-World restoration remain integration work.

## JavaScript image table model

`FESImageTable(type,bytes)` independently implements raw types16..20 and saves
ordinary table/node/section state plus the CP932 base option. Default TABLE and
image-driver integration is still pending, so the old execution remains counted.
Selectors are complete evaluated integer arrays. Results are owned CP932 bytes
or null; **empty bytes can be success**, so callers test `result !== null`.

| Type        | Selection and missing values                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BGTABLE16   | Existing D4 binary names table; row and variant0..3, empty name is a miss.                                                                                                                                                |
| BGTABLE2 17 | Count only exact CP932 ○ marker rows. Signed column is variant+2; -1 can select the description, -2 the marker, and positive variants use actual column bounds.                                                           |
| CHTABLE18   | Existing D4 character/pose and two16-entry variant banks, with their separate enabled/count checks.                                                                                                                       |
| CHTABLE2 19 | First two selectors match node IDs; later selectors match their bank ID and variant ID. A lower miss retains the accumulated prefix/mask. Sibling insertion reverses wire order, so the last duplicate ID is found first. |
| CHTABLE3 20 | Start at _TOP_, then follow row ordinals and the next-section name. Missing later rows retain partial output; invalid first row can succeed empty. Missing _TOP_ is a miss.                                               |

The CSV field rules retain quote/newline/empty-field behavior from the frozen
parser, rather than RFC CSV assumptions. CHTABLE3 reads raw lines: only byte0#
starts a section; TAB, quotes, comment markers and trailing section-name bytes
are content. Empty sections are not inserted and repeated nonempty section
names keep their first rows. Comma merge drops empty tokens and treats a single
right-side @ as a placeholder. Its final @->0 replacement is byte-blind,
including a CP932 trail byte0x40; CHTABLE2 does not perform that replacement.
Base options append to CHTABLE2's prefix but enter CHTABLE3 only before an
existing nonleading comma.

The typed max API preserves each table's query structure. In the command
adapter, an invalid CHTABLE max mode must leave the output bank untouched; it
must not turn a typed API error into a successful write0. Missing command
arguments, the16-selector cap, type gates and image dirty/reload timing remain
interpreter responsibilities.

`tests/fes-image-table-model.test.mjs` uses existing independently authored
original selection/missing/base-option expectations and complete static parser
transcripts for the additional raw boundaries. Both registered Worlds select,
decode and draw actual pixels, then restore without image/table resource files.
Malformed cyclic/out-of-range trees, embedded CSV NUL and an unterminated fixed
prefix fail explicitly; arbitrary original out-of-bounds reads are not emulated.
