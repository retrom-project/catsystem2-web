# Image transfers and filters

[Image commands](../src/native/image-commands.mjs) and
[bitmap arithmetic](../src/native/bitmap-pixels.mjs) execute in JS. Main `73`,
`74`, `78`, `1BE`, `218`, `219`, `21A` and `2A9` preserve their result/control
words and mapped VM output order. Ordinary bitmap state stays in `NativeImages`.
Only screen upload crosses the registered domain 6 device boundary.

`73` blends using source extents. `74` intersects canvas-coordinate rectangles
with each image's physical offset bounds before copy/resampling. These are
separate operations: negative destination clipping, bottom-up interpolation,
neighbor samples outside a cropped extent, and source/destination aliases matter.
`16F` uses the clipped blend variant. A null destination uploads the source to
the actual renderer through an independent bitmap input projection.

`78` reads its handle list and rectangle without modifying VM bytes, clears the
region to opaque black, and retains the original zero-opacity behavior for RGBA
layers. `1BE` computes bounds in a local rectangle: its success result does not
write the rectangle back. `218` uses the low 16 bits of its attribute key and
writes five words. `219` merges attributes; later entries replace matching IDs,
while self-copy retains the same data and succeeds.

`21A` preserves the integer triangular blur, alpha-aware RGB neighborhood
means, explicit canvas limits, format-specific expansion order and anchor
adjustments. Integer pixels are compared exactly, without a ±1 allowance.
The 24-bit horizontal helper writes only one B result per output pixel into
consecutive bytes; other scratch bytes are uninitialized in the original.
Instruction evidence confirms this behavior. JS initializes those unspecified
bytes to zero. Defined comparisons explicitly supply the same allocator bytes;
other allocator patterns remain oracle evidence, not an exactness claim about
arbitrary native heap history.

`2A9` formats and loads an image/selector using the JS factory, releases the
script handle and retains immutable cached assets. It returns control 2, including
missing-file paths, and does not initialize the EXE or modify the screen.

The independent tests are `native-bitmap-transfers`, `native-bitmap-packed`,
`native-bitmap-pixels` and `native-image-composite-js` under `tests/differential/`.
They exercise both ABI tables, all VM output bytes, format branches and complete
logical pixels/metadata. The old full-wrapper verifier and fixtures explicitly
import oracle-only modules; they remain layout and original-dispatch evidence.
GPU upload and fresh restoration are also checked by the image browser group.
