# Persistent bitmaps and native operations

[Bitmap memory](../src/native/bitmap-memory.mjs) gives `NativeImages` stable
original-engine pointers. `pointer(handle)` returns the bitmap base;
`wrapper(handle)` returns a persistent original image wrapper (536 bytes in the
game, 276 in the SDK), whose first word is understood by the original
`5AEBE0`/SDK `4326E0` getter. Its constructor/destructor preserve its independent
image reference and optional motion object. The bitmap base occupies 92 bytes;
decoded classes can be larger. HG3 decoding, for example, returns an original
4,476-byte derived object. Adoption preserves that object's identity, virtual
destructor, metadata and attribute map.

Materialized guest bitmap storage is authoritative. Metadata access projects
the original fields; RGBA and Canvas objects are derived caches. Handles sharing
a backing bitmap share its raw pointer and RGBA cache, including views reached
through different presentation handles. Writable Canvas operations mark their
cache dirty; simply presenting a Canvas does not commit it. This prevents a
read-only query from changing revisions or damaging low-alpha pixels through a
Canvas premultiplication round trip.

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

A physical bitmap's checkpoint stores its pointer and metadata in the handle
record, and its actual bytes once in the shared process. It does not store a
second authoritative RGBA image. Restore rebuilds projection accessors and alias
caches around the original restored addresses. CPU resizing uses the original
helper, preserving the bitmap identity and in-place attribute-payload updates.

[The operation adapter](../src/native/bitmap-operations.mjs) executes these full
original wrappers:

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
| 22E             | Mirror pixels, offsets, anchors and attribute coordinates       | 2       |
| 234             | Set the raw bitmap mask word                                    | 2       |
| 402 (game only) | Packed native pixel at canvas coordinates                       | 1       |

Null branches preserve each original early return. `179` leaves its result word
unwritten for a null owner, preserving the GCALL `CCCCCCCC` sentinel. `16F` with
no source does not dereference the destination. VM address zero is valid, and
missing argument words read the adjacent mapped GCALL area.

Both resize slots share an original handler. A registered logical bitmap
handle resolves through the bitmap bridge. A render-source wrapper keeps
its original pointer and ownership. A queued resize checks the same
allocation identity again at handler entry. Freed wrappers and unrelated
allocations are rejected before resize can mutate the bitmap. See
[Native render-source arrays](native-render-sources.md).

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

`verify-native-bitmap-operations.mjs` compares **1,258 complete calls and 8,071
checks for the game**, **1,184 calls and 7,553 checks for the SDK**, **15,624
comparisons total**. It covers seventeen game slots and sixteen SDK slots
(including the identical resize handlers), two-, three- and four-byte native pixels,
metadata, color modes, alpha/cache state, clipping and overlap, four VM domains,
null gates, untouched bytes and all live allocations. The VRAM upload is an
explicit test boundary. Original arithmetic and dispatch execute in the mounted
image. The reference process runs original scanline code, while the adapter uses
the separately verified raster acceleration. Its upload boundary also asserts
the original calling view in ECX. Both complete World/browser tests exercise
`16F` with a zero destination through the real visible VRAM plane and verify
GPU pixels in a fresh restored World.

Public original-engine tests additionally cover persistent wrapper identities,
strong and borrowed aliases, source destruction, independent restored worlds,
canonical pixel storage, raw writes, attribute-payload identity through resize,
16/24/32-bit projection against original color getters and read-only revision
stability. Chromium tests in `playwright.image.config.mjs` cover both full
profiles with real devices, Canvas read/write behavior and fresh GPU restoration.
This evidence does not substitute for every final renderer, input-mask or
pixel-format path.
