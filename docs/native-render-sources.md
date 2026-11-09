# Native render-source arrays

Main 2BF takes a formatted filename, a KCS destination address and a signed
initialization count. The original handler returns control 1 and the number
of emitted records. Main 2C0 takes a KCS array address and an unsigned release
count and returns control 2. The adapter executes both original wrappers
with the native VM translator and the caller's initialized view.

| Fixed profile           | Main 2BF / factory  | Main 2C0 | Record stride | Name field      |
| ----------------------- | ------------------- | -------- | ------------- | --------------- |
| NEKOPARA Vol.3 2.6.1.76 | 0x64C520 / 0x674F40 | 0x64B860 | 136 bytes     | 64 UTF-16 units |
| SDK 4.01 2.6.1.74       | 0x519040 / 0x54C0F0 | 0x518420 | 72 bytes      | 64 ANSI bytes   |

Each record starts with two DWORDs for its tag and native pointer. Tag 1
holds an original image wrapper, which owns its decoded bitmap. Tag 2 holds
an original retained drawing record. The remaining bytes hold the original
name. A plain filename leaves those bytes as supplied by the caller.
Selector output writes a terminated name and preserves its unused tail.
The original formatter, category mount, selector grammar, view cache and
ANM presence and manifest paths determine which records are emitted.

A positive initialization count clears that many tag and pointer pairs. The
factory can emit more entries, so the caller supplies enough mapped storage
for all outputs. A nonpositive count leaves the array untouched. Missing and
undecodable sources can return zero after the initialization writes. The
original formatter can also turn an unmapped source into an empty name,
which still initializes a mapped destination. An unmapped destination
returns zero before the factory writes any record.

Main 2C0 releases tag 1 and 2 pointers through their original destructors and
clears each processed tag. For an unknown tag, the pointer word is preserved.
Every name byte survives release. The original loop rereads its unsigned
count after each record, including when a KCS destination aliases the live
argument span and the first record clears that count.

The references belong to the caller's array. Draw can retain the underlying
bitmap from a tag 1 wrapper or retain the tag 2 record itself. Releasing the
array then drops its reference while Draw continues to use the original
object. KCS memory and the shared native process checkpoint preserve these
record bytes and pointer identities. Restoration leaves each World with its
own native heap and releases.

The direct wrapper comparison in `scripts/verify-native-render-sources.mjs`
checks 1,114 complete calls and 11,370 comparisons per fixed executable.
It compares control and output bytes, all VM regions, live native
allocations, prefetch state, file candidates and the original view. The
reference mounts authored HG2, HG3, ANM and manifest bytes. It uses the shared
IFile, raster, compression and image-prefetch platform boundaries.

The SDK World and both Chromium profiles use an authored KCS caller,
exercise live argument aliasing, and send both source tags through the Draw
receiver. They verify independent fresh-process release and the last Draw
reference's destruction. Chromium also compares the authored colors and the
restored view pixels.
