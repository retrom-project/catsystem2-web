# Persistent bitmaps and native operations

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
