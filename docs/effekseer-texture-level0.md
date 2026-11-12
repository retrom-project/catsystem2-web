# Effekseer level0 RGBA8 conversion

`src/effekseer/texture-level0.mjs` implements the selected single-level RGBA8
CPU conversion used by the existing renderer device profile. It is a pure
module; its presence does not establish World integration or GPU equivalence.

`convertEffekseerLevel0({ width, height, rgba }, profile?)` accepts complete,
straight RGBA8 pixels in a `Uint8Array` or `Uint8ClampedArray` and returns
`{ width, height, rgba }` with independently owned plain `Uint8Array` storage.
Node Buffers follow the same copy rules. Source RGB beneath alpha zero remains
data. No source buffer is modified, cached, premultiplied or canvas processed.

The exported fixed profile declares texture caps 5, maximum width/height/aspect
4096, format 21, managed pool 1, usage 0 and one level. A different profile is
an explicit unsupported operation. Source dimensions follow the existing PNG
decoder's finite domain, with at most 64 million decoded pixels. The separate
`effekseerLevel0Dimensions` helper rounds each default dimension upward to a
power of two and then applies the fixed size limits. An unchanged size copies
all source bytes directly. A changed size runs integrated Triangle filtering
with edge wrap, preserving source-row/source-column contribution order and
f32 multiply/add rounding. It uses the selected 4 by 4 ordered dither in
serpentine row order; the packer's f32 arithmetic rounds toward zero before
integer conversion and clamping. It consumes no random numbers.

The six CC0 images and factual expected bytes in
`tests/fixtures/effekseer-level0/` reproduce the previously recorded native CPU
results without any executable, compiler or private data. The source PNG
hashes, decoded RGBA and packed native BGRA hashes are pinned separately. The
ordinary Node test checks all 57 output pixels, 228 channel bytes, with zero
tolerance. Original executions total six; ordinary tests perform zero original
calls. This covers the fixed format/profile path, source alpha boundaries,
unchanged POT copies and the recorded NPOT cases. It is not a native hardware,
GPU, general image-format, sRGB, color-key, diffusion or mip-chain result.

Later resource integration must apply this conversion after the existing
decoder and before upload, recording the converted physical storage dimensions
and bytes. The immutable source name/content digest and per-successful-load
logical texture token remain owned by their existing resource/load services.
They must not be replaced with a POT-sized identity or merged because physical
storage can be shared. The resource owner must also decide its frame metadata,
release and restore fingerprints as one contract. This module adds no resource
state, cache, asynchronous job or checkpoint fields. Default World loading,
nonempty GPU drawing, mip-capable hardware and unverified source-format
selection remain separate work.
