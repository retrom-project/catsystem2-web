# Native render-source arrays

Main 2BF takes a formatted filename, a KCS destination address and a signed
initialization count. The original handler returns control 1 and the number
of emitted records. Main 2C0 takes a KCS array address and an unsigned release
count and returns control 2. The JS adapter uses the existing per-version VM layout and JS image loader.
The executable addresses below document the retained oracle.

| Fixed profile           | Main 2BF / factory  | Main 2C0 | Main 2C2 / helper   | Record stride | Name field      |
| ----------------------- | ------------------- | -------- | ------------------- | ------------- | --------------- |
| NEKOPARA Vol.3 2.6.1.76 | 0x64C520 / 0x674F40 | 0x64B860 | 0x64BC70 / 0x746E60 | 136 bytes     | 64 UTF-16 units |
| SDK 4.01 2.6.1.74       | 0x519040 / 0x54C0F0 | 0x518420 | 0x518830 / 0x5E7A50 | 72 bytes      | 64 ANSI bytes   |

Each runtime record starts with two DWORDs for its tag and opaque JS handle.
Tag 1 holds a bitmap wrapper which owns a reference to JS bitmap-data. Tag 2
holds a JS retained source with frames, ANM, references and transforms. The remaining bytes hold the original
name. A plain filename leaves those bytes as supplied by the caller.
Selector output writes a terminated name and preserves its unused tail.
The JS formatter, mounted image lookup, selector grammar, ANM presence and
manifest paths determine which records are emitted.

A positive initialization count clears that many tag and pointer pairs. The
factory can emit more entries, so the caller supplies enough mapped storage
for all outputs. A nonpositive count leaves the array untouched. Missing and
undecodable sources can return zero after the initialization writes. The
original formatter can also turn an unmapped source into an empty name,
which still initializes a mapped destination. An unmapped destination
returns zero before the factory writes any record.

Main 2C0 releases tag 1 and 2 JS resources and
clears each processed tag. For an unknown tag, the pointer word is preserved.
Every name byte survives release. The original loop rereads its unsigned
count after each record, including when a KCS destination aliases the live
argument span and the first record clears that count.

The references belong to the caller's array. Draw can retain the underlying
bitmap from a tag 1 wrapper or retain the tag 2 record itself. Releasing the
array then drops its reference while Draw continues to use the original
object. KCS memory and the JS handle codecs preserve record bytes, resource
identities and ANM state. Fresh-World restoration owns independent resources.

## Retained image geometry

Main 2C2 takes a retained-source handle and a KCS output address.
It returns control 1 with a success word. A null source or an unmapped
destination returns zero and leaves the destination untouched. Otherwise
the wrapper clears exactly 36 bytes and reads the static bitmap or the
first entry of the JS animation frame map. An empty retained record
or first entry without a bitmap returns zero with the cleared output.

On success the nine words are the signed image offsets, pixel dimensions,
canvas dimensions, bytes per pixel, and signed base coordinates, in that
order. Each zero canvas dimension uses its matching pixel dimension. The
wrapper uses mapped VM storage, including address zero and a destination that overlaps the GCALL arguments. The caller
supplies a live retained-source handle and writable storage for all
36 bytes. The query leaves source reference counts intact.

## Borrowed animation frames

Main 2C5 takes a live retained-source handle with an initialized animation
frame map and a signed ordinal. It returns control 1 with a borrowed bitmap
wrapper handle. Zero and negative ordinals select the first entry.
Positive ordinals advance in frame-key order, regardless of gaps in the
keys. An ordinal past the map or an entry without a wrapper returns zero.

| Fixed profile           | Main 2C5 | Frame lookup |
| ----------------------- | -------- | ------------ |
| NEKOPARA Vol.3 2.6.1.76 | 0x644480 | 0x746460     |
| SDK 4.01 2.6.1.74       | 0x51CB30 | 0x5E7100     |

JS sources decode all required frames before publishing the array. A static
source has no frame-map entry and returns zero. The query adds no reference,
so the borrowed wrapper's lifetime follows its retained source. Its identity
survives VM and JS-handle restoration. Resize aliases 2C1 and 7A accept this
handle through the phase5 JS bitmap dispatch, including after restore.

FES remains an original producer until phase7. Its descriptors enter through
`oracle/fes-draw-projection.mjs`, which imports typed resources and writes
animation results back to the producer's records. The projection records
allocation generations so reuse of a PE address cannot revive a stale source.

The direct wrapper comparison in `scripts/verify-native-render-sources.mjs`
checks 1,116 load and release calls and 131 geometry calls per fixed
executable. It adds 49 frame calls on the game and 48 on the SDK, with
14,776 and 14,760 comparisons in total. It compares control and output
bytes, all VM regions, live native allocations, prefetch state, file
candidates, the wrapper index and the original view. The frame cases include
signed limits, adjacent stack arguments, sparse IDs, an empty map and a
missing wrapper.
On the game, the verifier completes an authored pending frame at the return
from the original `Sleep(0)` call and checks the existing worker's lifetime.
The returned pointers also pass through the mounted 2C1 and 7A dispatchers.
Their resized metadata and pixels match independent calls to the original
wrappers. The reference mounts authored HG2, HG3, ANM and manifest bytes
through the shared IFile, raster, compression and image-prefetch platform
boundaries.

The SDK World and both Chromium profiles use an authored KCS caller,
exercise live argument aliasing, and send both source tags through the Draw
receiver. The geometry caller writes over its own second argument. In the
fresh World it queries the same JS record after the array releases
its reference. The frame caller stores the borrowed wrapper in VM memory
and sends its bitmap to Draw before and after restoring. The tests verify
independent fresh-World release and the last Draw reference's
destruction. Chromium also compares the authored colors and the restored
view pixels. A second authored KCS caller resizes a borrowed frame and
draws 24 exact pixels. After restoration it uses the saved handle through
7A and draws 96 exact pixels. The tests reject a queued resize after
release and an unrelated allocation at the same address with the same
size and bytes. See [Browser image tests](../playwright.image.config.mjs).
