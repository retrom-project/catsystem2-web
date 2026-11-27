# Persistent bitmaps and native operations

SDK 2.6.1.23 base and alpha commands (`370`, `371`, `374`, `377`, `378`)
use the same typed bitmap model. Their own original Main112 constructor,
Script automatic list and loader-bound VM establish the live-owner contract:
base setters preserve signed words, base queries write both VM outputs in order,
alpha sampling reads the physical channel, and explicit alpha hints control the
cached query. Main377 with no owner leaves its original result unwritten and
remains a diagnostic. The SDK23 KCS test compares these outputs and pixels with
the intact original, then checks release, Script reload and independent cold
restoration without loading an EXE.

SDK23 `428` decodes an ordinal frame from a typed encoded image-data handle and
writes that frame's actual ID to its third VM argument on success. The ordinal
and ID can differ. It expands RGB24 into RGBA32 and registers the bitmap for
Script cleanup. `648` constructs a new bitmap from HG2/HG3 frame IDs `0`–`8`:
four corners, repeated vertical/horizontal edges and a repeated center. Its remaining operands are the
destination width and height. Both commands return control 1 with an owned
bitmap; explicit release, Script reload/destruction and checkpoints use the
existing bitmap ownership model.

The SDK23 tests compare opaque and alpha tile pixels, partial edge repetitions,
HG2 input, nonconsecutive frame IDs and RGB24 expansion with intact original
GCALLs. Valid partial resources preserve destinations for missing IDs, including
a single HG2 `0x25` corner and sparse or unmatched HG3 tile IDs. HG2 `0x10`
instead reuses its one image for every tile lookup; HG2 `0x20/0x25` uses IDs.
The separate `428` ordinal wrapper only exposes index zero for HG2 before
`0x25`. These are local command rules, and do not change other callers' frame
selection. Other encoded formats, empty nine-piece dimensions and destinations
smaller than a source tile remain guarded. Shared semantic names do not admit
these entries for other builds.

SDK23 pixel commands `376/468/538/558/564/641` reuse the shared color,
rotation, canvas-bounded blur, mirror, raw mask and alpha operations. A complete
KCS sequence compares every intermediate pixel and metadata field with the
original. `537` merges a real HG3 attribute tree into a separately constructed
bitmap; subsequent `536` queries preserve all five words and transformed origins.
The original `446` copies its VM RECT into stack scratch and discards the
computed rectangle. It leaves the VM bytes unchanged and returns success for
allocated pixel storage, including entirely transparent pixels. Its SDK23
pointer is therefore an input, rather than a rectangle output.

SDK23 `375` reads a file's first 1,024 bytes at most and parses the first image
header into nine mapped VM words. `431` instead parses the complete encoded
container owned by `365` and clears its nine-word destination before querying
all frames. HG2's depth-derived header word and the container parser's untouched
word retain their original values; they are not replaced by decoded pixel depth.
Normal HG2/HG3 KCS tests compare all output and surrounding seeded words, then
restore and release the still-live encoded descriptor in an independent World.

SDK23 `430` checks readable ANM presence, first directly and then through the
constructor-loaded `anmtable.csv` mapping. Stored table keys preserve case and
the first duplicate value; lookup normalizes the caller's basename. It returns a
boolean without executing the ANM program. `460` loads frame zero of an HG2/HG3
file or composes named selector layers. Ordinary RGB24 remains three bytes per
pixel when no selector is present; selector output uses RGBA and preserves the
old clipped scalar pixel rules, including untouched transparent RGB outside
each layer. Other encoded formats and alternate selector blend types remain
protected.

The `460` result has explicit bitmap ownership and does not join the Script
automatic list. Its KCS tests compare original pixels, geometry and reference
lifetime, then retain the result across independent cold restore and Script
reload before explicit release. These caller-specific pixel rules leave global
HG3 frame selection and other SDK profiles unchanged.

SDK23 image-owner `716/721/722/725/729/734` operate on the existing typed
image owner. The original file-server, Settings, software kcView, Top and Script
constructors establish the loaded layer vector and its separate Script cleanup
list. Packed multiplication and alpha scaling visit those layers; alpha queries
and hints use the current output bitmap. Attribute copy retains the five-word
payload. KCS tests compare each intermediate pixel, metadata word and mapped
attribute output, then check independent cold restore, release and Script reload.
The original automatic list also releases both loaded and blank owners on reload
and after retirement reaches the actual deleting destructor.

The `.23` RGBA `734` helper blends physical rows within independently clipped
rectangles, skips zero-alpha source samples and preserves all RGB outside the
rectangle. Source mask values `1`–`4` select B/G/R/A as an integer multiplier of
the target alpha; target RGB remains unchanged. This local strategy
retains the original integer alpha arithmetic without changing the shared
presentation compositor. Other pixel depths, alternate blend types, absent
source/output bitmaps and the external VRAM branch remain guarded. `721` with
no output bitmap leaves the native result unwritten and remains protected.
Blank owners are not passed to the loaded-layer iterators.

SDK23 `731` binds an image owner to a real Draw task initialized by `256`,
using the same retained resource graph. Its descriptor carries the float32
position, base, rotation and scale plus clamped alpha, visibility and mode.
The SDK23 CPU raster policy leaves zero effective-alpha pixels and rectangle
borders untouched, for normal rows and affine sampling. Modes `0` and `1` are
covered. The raw mode word selects zero/nonzero branches; subsequent actual
mode2 and all-bits-set GCALLs confirm the same affine behaviour and cold
continuation, so nonzero words are accepted. Positive KCS tests compare full CPU
pixels through rotated and scaled forms, replacing a key, releasing the source
owner, independent cold restore, entry removal and Draw destruction.

The Draw bitmap query returns a borrowed renderer bitmap. On SDK23, retirement
keeps that renderer alive until the existing task update performs destruction;
the bitmap ends with the Draw owner. The CPU policy preserves publication,
revision and output ordering, and leaves other builds' raster behavior intact.
The original tests disable external output and use the actual `340` render
entry; GDI/Win32 ports and CPU startup calibration are supplied host boundaries,
not native graphics behavior or a product clock service.

[NativeImages](../src/native/image.mjs) owns script bitmap pixels, metadata,
attributes and aliasing in JS. Canvas presentation is a derived cache. A
checkpoint saves the shared JS pixel backing once and preserves the bitmap
handles which reference it.

[The injected bitmap projection](../oracle/bitmap-projection.mjs) maintains
independent inputs for remaining renderer and FES consumers. JS changes refresh
those inputs by revision. Explicit decoder/capture results transfer into JS at
an operation boundary. Renderer targets and FES-decoded objects retain their
consumer authority and expose separately registered derived views. Wipe3 source
RGB preparation executes as a JS command before its input copy is consumed.

The original layout and operations below remain oracle evidence. `pointer`
materializes a 92-byte bitmap and `wrapper` a 536-byte game or 276-byte SDK
wrapper. The original derived HG3 object can occupy 4,476 bytes. Its own
consumer controls its virtual destructor and storage lifetime.

Host projections support BGRA32, BGR24 and A4R4G4B4 rows, reversing physical rows
into logical image rows. Four-bit presentation channels use their normalized
range; original CPU queries retain the engine's own shift-by-four color and
four-bit-alpha results. Writes back to these rows preserve padding. Empty images
have no pixel payload. An unknown nonempty pixel format remains an explicit
projection error; it is not treated as an RGBA32 image.

Strong logical bitmap owners contribute to the original reference word at `+80`.
Aliases retain that shared object, while each requested wrapper keeps its own
identity. Final release executes the original virtual destructor. UI mirrors of
an already-owned native image borrow its storage without adding a reference;
passing such a mirror through the native wrapper API promotes it to a strong
logical bitmap owner. The presentation layer must retire borrowed mirrors before
their native owner is destroyed and retain its last drawing bounds separately.

Script bitmap restore reconstructs JS state and aliases. Consumer-owned raw
views use their separately recorded PE checkpoint identity. All script CPU operations now execute in JS. Explicit decoder/capture imports
remain separate value transfers.

Alpha blits reuse the retained renderer's packed integer row compositor for
aligned, separate ordinary RGBA arrays. The same independently clipped rows,
transparent edge RGB and integer opacity rules apply. Each row rechecks storage
after its live geometry and edge reads; aliases, shared/resizable arrays,
fractional spans and custom pixel methods retain scalar processing. Pixel
providers, their awaits, revision publication and full VRAM writes keep their
existing order. This creates no new bitmap or checkpoint ownership.

[The JS operation dispatcher](../src/native/bitmap-operations.mjs) implements
these contracts, with arithmetic in [bitmap-pixels](../src/native/bitmap-pixels.mjs):

| IDs             | Operation                                                       | Control |
| --------------- | --------------------------------------------------------------- | ------- |
| 7A / 2C1        | Canvas-relative resize of logical or render-source bitmaps      | 2       |
| 16A / 16B       | Canvas size with image-size fallback; signed image offset       | 2       |
| 16F             | Clipped source/destination blit, or source upload to VRAM       | 2       |
| 171             | Packed color multiplication, including original byte arithmetic | 2       |
| 172             | Alpha at canvas coordinates, adjusted by the bitmap offset      | 1       |
| 173             | Base/anchor query through two VM pointers                       | 1       |
| 174 / 175 / 176 | Set canvas size, offset, base                                   | 1       |
| 178             | Mode 1 grayscale, 2 sepia, 3 inversion                          | 2       |
| 179             | Cached alpha-presence query                                     | 1       |
| 17A             | Set the alpha-presence hint; it does not scale pixels           | 2       |
| 1D4             | Rotate pixels, dimensions, anchors and attributes by 90° steps  | 2       |
| 22E             | Mirror pixels, offsets, anchors and attribute coordinates       | 2       |
| 234             | Set the raw bitmap mask word                                    | 2       |
| 281             | Scale the 32-bit bitmap alpha by a percentage                   | 2       |
| 402 (game only) | Packed native pixel at canvas coordinates                       | 1       |

Null branches preserve each original early return. `179` leaves its result word
unwritten for a null owner, preserving the GCALL `CCCCCCCC` sentinel. `16F` with
no source does not dereference the destination. VM address zero is valid, and
missing argument words read the adjacent mapped GCALL area.

Resize, rotation and alpha also accept validated domain 6 render-source
wrappers. Their consumer-owned storage is exposed as a temporary derived view;
the same JS operation writes it back at that explicit boundary. Unknown or
released wrapper identities are rejected before mutation. No original native
handler is used. See [render-source arrays](native-render-sources.md).

`16A` and `16B` translate and zero both VM outputs even when the owner is null.
For a live bitmap, each zero canvas dimension independently falls back to its
image dimension. Signed offsets and overlapping outputs retain the original
write order. The game-only `402` getter returns the original physical-row packed
pixel, including the native four-bit channel shifts. Null, missing pixel data
and out-of-bounds coordinates return zero. This slot lies beyond the SDK main
table and is not registered for the SDK profile. `22E` uses any nonzero direction
word for horizontal mirroring and zero for vertical mirroring. Its original
routine updates the corresponding offset and anchor using the raw canvas
dimension, and edits attribute payloads in place. Aliases keep one bitmap
identity. `234` updates the mask word without changing stored pixel bytes.
`1D4` uses SDK `5192A0` and game `64C770`. The original helper recognizes 90,
180 and 270 degrees; other values keep the bitmap unchanged. The browser
rejects a rotation when the helper would assign a four-byte stride to an
unaligned row wider than four bytes, before changing the bitmap.
`281` modifies only alpha bytes in a 32-bit bitmap. Its native lookup table
multiplies the alpha by the percentage modulo 2³², divides the unsigned
product by 100 and saturates at 255. Null input, other pixel depths and
100 percent leave the image unchanged. RGB, row padding and cached alpha
hints keep their previous values.

The oracle-only `verify-native-bitmap-operations.mjs` previously compared **1,420 complete calls and 9,071
checks for the game**, **1,346 calls and 8,553 checks for the SDK**, **17,624
comparisons total**. It covers nineteen game slots and eighteen SDK slots
(including the identical resize handlers), two-, three- and four-byte native
pixels, padded right-angle rotations, metadata, color modes, all 256 alpha
inputs and padded rows, clipping
and overlap, four VM domains, null gates, untouched bytes and all live
allocations. The VRAM upload is an
explicit test boundary. Original arithmetic and dispatch execute in the mounted
image. The reference process runs original scanline code, while the adapter uses
the separately verified raster acceleration. Its upload boundary also asserts
the original calling view in ECX. Both complete World/browser tests exercise
`16F` with a zero destination through the real visible VRAM plane and verify
GPU pixels in a fresh restored World. The authored `281` KCS tests cover a
logical alias and a borrowed HG2 wrapper through fresh restore. They also
queue a release ahead of an alpha operation and verify the stale wrapper is
rejected.

Public original-engine tests additionally cover persistent wrapper identities,
strong and borrowed aliases, source destruction, independent restored worlds,
canonical pixel storage, raw writes, attribute-payload identity through resize,
16/24/32-bit projection against original color getters and read-only revision
stability. Chromium tests in `playwright.image.config.mjs` cover both full
profiles with real devices, Canvas read/write behavior and fresh GPU restoration.
This evidence does not substitute for every final renderer, input-mask or
pixel-format path.

The phase 5.2 differential files compare independent JS dispatch with each
original ABI table. Pixels, metadata, attributes and VM bytes use exact equality.
Packed multiplication divides all four channels by 255; decompiled alpha
pseudocode was contradicted by both actual instructions and differential values.
Gray/sepia separately truncate three float32 lookup tables (white becomes 254).
Resize interpolates physical bottom-up rows. RGBA4444 resize is a no-op; RGB24
resize works in the game and is a no-op in the SDK, declared in ABI data.
The alpha scaler preserves its unsigned-overflow lookup behavior and cached hint.
No floating pixel tolerance was required by the covered algorithms.

SDK23 raster formats depend on the calling operation. Complete GCALLs confirm
that ordinary 40-byte-header BI_RGB BMP24/32 files load through Main460 and
Main703's tag1 branch with RGBA pixels and normal explicit ownership. Main428
uses the ordinal virtual method: BMP's original method is an explicit zero
stub, so it returns zero without writing the third VM output or inserting an
automatic bitmap. Valid PNG files are rejected with zero by Main428, Main460
and Main703; the latter still clears the requested output record pairs.

Main648 ignores its decoder's non-HG return and returns a real0x114 owner with
a null bitmap, inserted in the Script automatic list. The JS bitmap wrapper retains that identity with dataHandle0 and owns no
bitmap-data or pixels. Its existing codec preserves it through cold restore;
explicit release and Script automatic destruction free the wrapper. This is
separate from a zero handle or an allocated zero-sized bitmap. Dimensions,
pixels and queries that require real storage retain their precondition guards.
Selector composition retains its separate HG2/HG3 binding; plain BMP admission
does not enable BMP selectors, other headers or animated BMP frame maps.

SDK23 Main710 can retain one ordinary HG3 RGB24 layer without converting its
output to RGBA. Main734 therefore supports RGB24-to-RGBA, RGBA-to-RGB24 and
RGB24-to-RGB24 normal scalar rectangles. RGB24 output exposes opaque alpha.
An RGBA mask applied to an RGB24 target has no original mask dispatch function:
the complete wrapper returns control2 and preserves all target pixels. Source
masks remain restricted to real source components; other blend types and
unsupported pixel classes retain specific guards. Actual Main710/734 GCALLs
compare these ordinary pairs and their independent cold continuation.

The .23 primary image path accepts ordinary PSD RGB8 raw and PackBits merged
composites and KCF three/four-byte pixels. Its PSD reader skips three channels
of RLE row lengths even when the file declares a merged alpha channel, then
produces opaque output. This is a caller-scoped decode option; other SDKs keep
their selected decoder behavior. KCF preserves the header pixel depth. Complete
Main460/703 VM comparisons cover every output byte and cold ownership. For
both formats Main428 uses the original ordinal-reader zero stub without writing
the third output. Main648 still returns an automatically owned null-storage
wrapper; the helper's zero result does not become the wrapper's result.

The .23 scalar blend dispatcher accepts authored HG3 `cptype`1–5 for RGBA
sources. It selects that function before consulting the mask word. RGBA targets
use the existing mixed-alpha CPU arithmetic; RGB targets use their own scalar
weighting and mode4 color branch. The RGB source table has no cptype handler, so
the complete wrapper preserves the destination and still returns control2.
Main460 selector composition uses the same RGBA functions and preserves RGB24
source depth for this dispatch. The original bitmap header word at+80 counts data references; it is not the
browser's internal alpha classification. The comparison checks that ownership
separately from the actual alpha samples.
Normal VM comparisons cover all five RGBA modes, a RGB destination, cptype over
mask, all selector pixels, explicit/automatic ownership and independent cold
continuation. Other blend codes and unqualified external VRAM shapes stay
protected.

## SDK 2.6.1.63 initialized bitmap calls

This build's first resource group uses its actual software View, original CRT,
Settings, FileServer mounts, allocator and Main66/Main143 Script interpreter.
No private function is redirected. Thirty-eight target GCALLs and nine
constructor/query/release dependencies cover Main370/371/374/376/377/378,
446/468/537/538/558/564/641 on small real Main111/Main112-owned bitmaps.
Every captured pixel, geometry/cache word, explicit five-word attribute-copy
output and control/result matches current World KCS callers; eight fresh checkpoints continue through the next
real call. The original zero-fill path, not fresh heap contents, establishes
Main112's initial zero pixels. Explicit fills and subsequent transforms remain
in the compared sequence.

Main446 copies its RECT into private scratch and preserves the VM rectangle.
Main377's null-owner result is unwritten, so that shape has a precise diagnostic.
This group covers RGBA32 storage; RGB24/packed formats, shared or aliased frames,
additional resource factories and retained Draw require their own qualification.
It adds no native save fields and does not establish hardware or product pixels.

The next .63 group independently qualifies Main375/428/430/431/460/648 with
the same true resource chain. Twenty-eight target and twenty-seven dependency
calls compare the nine-word file/container outputs, HG2/HG3 ordinal endpoints,
RGB24-to-RGBA decoding, nine-piece pixels, narrow CP932 filenames, missing files
and explicit/automatic ownership. The three extra setup calls repair a fixture
mount location within the original total call budget: four table queries use
the actual View constructor's `images.int/anmtable.csv`, while the earlier
absent-table negative observations retain their original scope. Eight fresh
checkpoints continue through real subsequent KCS calls. The follow-up Main536
outputs also cover the nonempty attribute tree after rotation and mirror.

The own .63 RGBA blitter fills an adjacent all-zero destination pixel with the
edge RGB and keeps alpha zero. Nine-piece assembly preserves this behavior via
an explicit build policy; it is not inferred for .23, .67 or modern builds.
Main460 plain HG3 preserves RGB24 and owns its result independently of Script
reload; selectors combine normal named HG3 layers. Other formats, shared VM
frames, unproved empty/smaller nine-piece outputs and extreme resources remain
separate qualification work. These are software resource pixels, not physical
GPU or product acceptance.

The .63 loaded-owner group adds twenty-eight target GCALLs and twenty-six
constructor/query/mask/release dependencies, including one supplemental
RGBA-mask-to-RGB-target check. Actual Main710 objects own a
nonempty layer vector and either an RGBA or RGB24 output; Main733 creates the
independent blank target without a layer vector. All forty-eight current KCS
frames compare the constructor-written eleven-word information block, dirty
word, alpha hints, physical pixels, copied attributes, automatic Script list
order and explicit release. Eight independent checkpoints continue with the
next real call. The actual constructor zeros its information fields explicitly;
raw addresses and unselected owner/header words stay capture-only.

For this build, ordinary RGBA Main734 blends retain the existing bitmap
blitter's transparent RGB and adjacent edge behavior. Masks use the native
physical component/alpha path. Source clipping uses local bitmap coordinates;
the destination still receives the source offset. RGB24-to-RGBA, RGBA-to-RGB24
and RGB24-to-RGB24 results are separately compared, including offset inputs and
the defined mask no-op for an RGB target. These build policies do not change
.23 or .67. A null or bitmap-less Main721 would leave the original result
unwritten and stays diagnosed; no original invalid-pointer probe was run.

The .63 retained Draw entry group uses Main66's actual kind15 constructor,
its 0x94-byte task and the original software View. Twenty-three target calls
and forty-one initialization, resource and destruction dependencies compare
entry insertion/update/show, signed layers, borrowed bitmap results, two output
resizes, retained caller resources and Main731 ImageOwner packets. Fifty-eight
current KCS frames and eight independent cold continuations preserve every
compared output pixel, dirty/pending word, list count, output and return control.
The actual Script update deletes the retired Draw after Main67. These are
software resource results, without a hardware or product claim.

The own renderer unions each entry's cached bounds with its new bounds before
clipping. The build policy preserves this accumulated area across updates and
cold restore, so hiding a moved entry also clears its original area. It leaves
the existing mutation and publication barriers in place. The initialized Draw
retains its bitmap and ImageOwner resources when their caller releases them;
its own retirement and renderer release dispose of those resources.

The original receiver separately captures raw270/275/268 for the update, show
and ImageOwner insert wrappers; current full KCS callers deliver their canonical
messages and the same non-address packet fields. The first pixel group's
observer captured outer sends, so it is not used as receiver evidence. Main264
writes a private count scratch but returns control2 without a VM value.
Renderer-less count/layer operations retain their precondition diagnostics;
Main657 instead explicitly writes zero when the renderer or entry is absent.
Foreign owners, capacity extremes, other source/layout shapes and hardware
output retain their separate qualification boundaries.

The .63 source-array group qualifies Main622/623/624/703/704/706/707/708/709
with twenty-one target GCALLs and twenty-three resource/Draw dependencies.
Main703 writes 72-byte records: a single HG3 frame owns a tag1 bitmap, while
multiple frames own a tag2 source from the actual 196-byte constructor. Names
outside the selected outputs stay untouched. Main706 writes the nine-word
metadata block; Main709 borrows the two valid ordinal frames. A Draw entry
retains the source after Main704 clears and releases the caller's records.
Entry removal then releases the final source and its frames. Encoded bitmap
binding, signed layers, explicit ANM load and final Script destruction share
the compared sequence.

Forty-one current full KCS frames compare record words, typed identities,
metadata, reference counts, receiver packets and all selected pixels. Eight
independent checkpoints continue through the next real call, including caller
release with a still-live retained source. Raw addresses and other source words
remain capture-only. This group's source-frame admission is HG3; other formats,
nested owner models and capacity/alias variants remain separate work.

Main624 sends its receiver message even when ANM lookup fails. The original
clears its filename scratch and only copies a resolved name on a successful
lookup. The .63 policy therefore forwards an empty filename on failure, preserving
the existing source program and wrapper control2. Other builds retain their
selected behavior. A receiver-packet regression covers this distinction in
addition to the unchanged output pixels.

The .63 nested-owner group follows the same actual resource chain for Main710,
Main731, caller release and Draw retirement. Its 196-byte retained group keeps
the original 64-byte ImageOwner when Main623 replaces its decoded frames.
The current build policy preserves that group identity and owner reference.
Separate HG2 two-frame inputs use narrow CP932 filenames; valid ordinal frames,
ANM lookup, caller-array release and later Draw removal compare the full pixels
and selected state. Raw unselected object words remain capture-only.

This build separates source update from rasterization. Main340's receiver calls
the renderer without first running its frame update, while the normal derived
draw callback calls update before raster. Rasterization therefore keeps the
cached source state instead of implicitly advancing children after a layer
mutation. The ordinary update function remains in the normal draw path.
Main342 and the graphics preparation caller have current-only cache regressions;
six independent checkpoints cover the retained owner, encoded rebind, frames
and caller release. The existing capture path still renders Stage, and snapshot
stores the retained graph without adding an update or changing public loans.

The complete original group contains thirty-three GCALL frames. A separate
ten-frame consumer group includes one direct original derived draw callback
with its Draw output disabled. In total it uses twenty-three target and
twenty-six dependency GCALLs plus that one callback. This direct callback
observation does not establish the original Base/collector active filtering,
enabled animation cadence, capture pixels or hardware output. Those boundaries
remain separate from the compared resource and software-renderer shapes.

## SDK 2.6.1.67 initialized bitmap calls

The .67 bitmap group independently constructs its own CRT, Settings, FileServer,
Window/Device, software View and Main66/Main143 owning Script VM. Its normal CRT
prelude encodes the math callbacks before the reference heap's actual logger
formats its message. The initial host attempt missing that precondition is
retained as zero-target failed host evidence. No private allocator, formatter,
parser or constructor is replaced; the old .23 and W9 host redirects do not
qualify this resource chain.

Thirty-eight target and nine dependency GCALLs compare the thirteen ordinary
bitmap metadata/pixel entries, including their full selected RGBA pixels,
geometry/cache/clip fields, explicit attributes, returns and release. Forty-four
current full KCS frames and eight independent cold continuations match those
own .67 results using the shared implementation. Main112 explicitly clears its
successful pixel allocation through the original zero routine. Main377's null
owner would leave the result unwritten and remains diagnosed. Other formats,
shared/aliased layouts, retained Draw and physical hardware output keep their
separate qualification boundaries.

## SDK 2.6.1.67 encoded image and file calls

The own .67 software View constructor loads `anmtable.csv` from the actual
image archive before the first query. Its forty-five complete call frames
cover six encoded/file entries using twenty-four target and twenty-four
dependency GCALLs: file metadata, owned twenty-byte encoded descriptors,
HG3 ordinals and HG2 v20's first-frame lookup, nine-piece RGBA expansion,
RGB24-preserving composition, selector layers, CP932 names and missing-file
output preservation. Direct ANM lookup and basename table fallback produce
1/1/0/0 for the four independently recorded names, retaining stored-key case.

The selected pixel, metadata, owner and control states match the shared
implementation with explicit .67 policies. Eight independent current
checkpoints continue with the next real KCS call, including the loaded table
and retained encoded/bitmap resources. The first current fixture returned a
Node Buffer rather than the resource interface's Uint8Array; that author
failure is preserved separately. These calls do not qualify other formats,
shared or alias layouts, empty/smaller nine-piece destinations, resource
extremes or hardware presentation.

## SDK 2.6.1.67 loaded ImageOwner pixels

The own Main710/Main733 wrappers allocate sixty-four-byte ImageOwners through
`569810`, enter the calling Script's actual automatic-owner list, and retain
276-byte bitmap wrappers. Twenty-eight target and twenty-three dependency
GCALLs compare forty-eight frames for six pixel entries: alpha query/toggle,
physical metadata copy, color and alpha masks, all four blend modes, local
coordinates, transparent RGB neighbors and RGBA/RGB24 sources and targets.
The selected pixels, owner info, clip, reference counts, untouched VM bytes,
control/results and explicit releases match the shared implementation under
own .67 policies. Eight independent current cold continuations retain the
same owned resources and execute the next KCS call. The original alpha query
leaves its result unwritten without a bitmap; that shape stays diagnosed.

The merged original group's final allocation reuses a previously released
owner address. Its read-only observer originally labelled that address by
the first historical name. Fixture normalization resolves that recorded name
through the original GCALL address map to the unique live name, preserving
list order and the original report. No target behavior or pixels are inferred
from current JS for this correction. Shared/foreign owners, unproved formats,
resource extremes and hardware output remain separate scopes.

## SDK 2.6.1.67 Draw entries and software output

The own Main66 kind15 factory constructs a 148-byte Draw through `487ee0`
with vtable `662f74`, the real software View and its retained renderer.
Twenty target and twenty-eight dependency GCALLs compare forty-five frames
for eight entry, layer, count, resize and ImageOwner-binding operations.
Receiver packets are captured at the actual derived vtable slot +28 in this
same group: raw 271/276/269 become canonical 282/287/280 once. Main264 writes
only the original temporary result slot while returning control2, so it does
not push a VM result. Borrowed entry/output bitmaps keep their ownership.

The .67 policies preserve retained ImageOwners, accumulate the original old
and new dirty bounds, and hold resources across retirement until the actual
parent update destroys the Draw. Every selected software output pixel,
Script resource count, offset, pending flag and result/control matches own
original evidence; eight independent current checkpoints execute the next
call. Renderer-less count/layer calls stay protected. These frames do not
qualify full Base/collector cadence, physical GPU or capture output, additional
formats or resource extremes.

## SDK 2.6.1.67 source arrays and retained ANM resources

Twenty-one target and twenty-three dependency own GCALLs compare forty-one
normal frames for nine source-array, metadata, ordinal and retained-binding
entries. Main703 produces 72-byte records with a bitmap tag or an actual
196-byte source constructed by `523b80`; unused name words retain the input
sentinel. Own consumers qualify the program at +72 and reference count at
+188. Creation leaves the program empty until explicit ANM loading.

The same sender-keyed Draw keeps the source alive after caller-array release,
uses signed stored layers, and accepts bitmap/encoded replacement. Missing
ANM still sends the original empty-name packet. The .67 raw messages
269/271/282 become canonical 280/282/293 once. Selected software pixels,
metadata, references, guest writes, control/results and final parent-update
release match current full KCS calls and eight independent cold continuations.
HG2 and nested owner forms follow in their own group. Other formats, shared
or foreign resources, capacity extremes and GPU presentation remain open.

## SDK 2.6.1.67 nested ownership and raster consumers

The final own group retains the same sixty-four-byte ImageOwner inside its
196-byte Draw source while encoded replacement rebuilds that owner's frames.
Caller release and later entry removal preserve the original ownership order.
Two-frame HG2 resources and their explicit ANM use CP932 names through the
actual mounted reader and parser. Twenty-three target and twenty-six
dependency GCALLs, plus one direct derived callback, compare forty-three
complete software frames; six independent current cold continuations retain
the owner, rebind and source state.

Main340's actual raw279 receiver calls raster `51ff40` without advancing the
source. Own normal derived callback `486800` calls update `520aa0` before that
raster path. The .67 profile therefore uses the existing cached-source raster
policy, including Main342 and the graphics preparation caller. The first
current comparison showing alpha100 instead of the original cached alpha200
is retained. Normal update stays in its original phase; public loans, output
ownership, flush and capture callers are unchanged.

The one original callback is invoked directly with Draw output disabled. It
does not establish the complete original Base/collector filtering, enabled
animation cadence, Stage/capture pixels or physical GPU behavior. Current-only
controls cover normal collector update-before-raster, Main342 and graphics
preparation, without counting those controls as additional original coverage.
Other formats, foreign/shared layouts and resource extremes remain open.

## SDK63/67 canonical BMP paths

Each own build executes sixteen target and fifteen dependency GCALLs for
canonical three-by-two, forty-byte BI_RGB BMP24/BMP32 resources. The actual
CRT/Settings/FileServer/software View and typed owning Script are reused.
All actual direct bridge setup/target/cleanup calls are separately journalled
(77 for63,80 for67); those totals include the31 GCALL dispatches and do not
represent extra independent business cases.

The complete calls distinguish defined results: Main375/Main431 metadata and
Main428 ordinal lookup return zero without touching the mapped output bytes;
Main648 creates a real null-storage bitmap wrapper; plain Main460 and formatted
Main111 produce independent initialized bitmaps; Main703/704 create and release
a static tag1 bitmap. Selected pixels, metadata, references, automatic owner
counts, controls and untouched memory match28 current frames and eight fresh
internal checkpoint continuations per build. Selector BMP and animated raster
forms are not inferred from this plain/static path.

Own Main111 preserves the decoder's initially unknown alpha hint instead of
performing a separate alpha query. An eager JS query changed that0 to1 after
BMP24 load; the original red is retained. The own63/67 policy now defers that
query, and existing HG bitmap/encoded regressions remain unchanged. No new
persistent field, reader or format generation is introduced.

Both build policies allow only the evidenced plain BMP header/compression
shape; palette, bitfield and other depth/header forms still need their own
proof. An identified `UnsupportedNativeImageFormat` retains its existing
diagnostic and propagates as a guard for these builds, rather than becoming a
fabricated zero result. Native-defined zero/empty outcomes above stay functional
failure paths. Other SDK policies and ordinary decode-failure behavior retain
their existing contracts.

## SDK63/67 BMP selector and bitfield boundaries

Each exact build executes forty target and thirty-seven dependency GCALLs
for seven complete valid small BMP files. Both original groups compare the
same seventy-four frames and independently retain every setup/target/cleanup
direct bridge invocation (123/126, including the77 GCALLs). Eight fresh
internal cold continuations per build preserve the current VM and resource
state without rerunning those original groups.

The own format selector recognizes only24/32 at its fixed bit-count position.
Palette1/4/8 and RGB16 inputs return zero for primary/formatted loading. V4 is
recognized by depth but rejected by the decoder header check. The selected
CORE file is rejected at the selector; this does not establish every CORE
file, because its pixels or gap can occupy that selector position. Metadata
and ordinal results remain zero with untouched outputs, while nine-piece
loading still creates its real null-storage owner.

A valid32-bit BI_BITFIELDS file is accepted. The original decoder copies from
byte54 without interpreting masks or the file's pixel offset; current pixels
therefore preserve the same mask bytes rather than correcting the image.
Only the proved header/compression paths are enabled. Accepted but unreviewed
CORE and compression forms remain guarded until their own bounded chain.

The shared decoder publishes immutable header metadata through a private
instance map. Native callers use that metadata to distinguish a proved native
rejection from an unproved capability; neither requires another file read,
mutable bitmap field or new checkpoint layout. The existing SDK23 composite
header/compression values are only changed to equivalent singleton lists;
its format and ownership policy is unchanged.

## SDK63/67 merged PSD paths

Each exact build executes forty target and thirty-three dependency GCALLs for
five complete three-by-two merged RGB PSD resources. The dependencies include
the three real Script bootstrap calls. All direct bridge invocations are
separately retained (119/122, including the73 GCALLs). Seventy full current VM
frames and eight independent internal cold continuations per build compare
pixels, metadata, unchanged outputs, references, owner lists and controls.

Plain Main460, formatted Main111 and static Main703 preserve the own decoder's
three-byte-plane interpretation: merged alpha is discarded, sixteen-bit raw
samples are read as byte planes, and RLE skips exactly three channels' row
lengths even for a four-channel file. The four-channel RLE fixture uses valid
single-pixel literal runs so that this defined native offset remains bounded.
The detached native PSD decode leaves the shared image's decoded frame cache
unchanged. Other channel/depth/compression combinations remain guarded.

Both actual PSD constructors call the base data constructor, which explicitly
calls SetRectEmpty on the clip rectangle. Its four zero words are initialized
metadata, rather than an inference from heap contents. The first current red
with a full-image rectangle is retained; only these two proved build policies
now preserve the native empty rectangle. Metadata/ordinal queries return zero
without writing their outputs; nine-piece loading creates its real empty
owner. These bitmap and static-source results do not establish later retained
Draw, clipping or physical presentation behavior; those consumers remain in
the following resource group.
