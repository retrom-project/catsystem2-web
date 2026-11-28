# Effekseer level0 texture conversion

`src/effekseer/texture-level0.mjs` implements the selected single-level RGBA8
CPU conversion used by the existing renderer device profile. It is a pure
module; its presence does not establish World integration or GPU equivalence.

`convertEffekseerLevel0({ width, height, rgba }, profile?)` accepts complete,
straight RGBA8 pixels in a `Uint8Array` or `Uint8ClampedArray` and returns
`{ width, height, rgba }` with independently owned plain `Uint8Array` storage.
Node Buffers follow the same copy rules. For format21, source RGB beneath alpha zero remains
data. Format22 ignores the input fourth component and returns defined sampled
alpha255; native raw X padding is never stored or hashed as alpha. No source buffer is modified, cached, premultiplied or canvas processed.

The exported fixed profile declares texture caps 5, maximum width/height/aspect
4096, format21, managed pool1, usage0 and one level.
`effekseerLevel0Profile(format)` returns the matching immutable selected profile
for format21 or format22, with all other device fields shared. Other profiles
are explicit unsupported operations. Source dimensions follow the existing PNG
decoder's finite domain, with at most `64*1024*1024` decoded pixels. The separate
`effekseerLevel0Dimensions` helper rounds each default dimension upward to a
power of two and then applies the fixed size limits. An unchanged size copies
all format21 bytes directly; format22 retains RGB and projects alpha255. A changed size runs integrated Triangle filtering
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

`src/effekseer/texture-decoder.mjs` supplies the bounded default decoder for
`EffekseerResources`: RGBA8 selects format21, and noninterlaced RGB8 without
tRNS selects format22. Both use the same Triangle contributions, RGB arithmetic
and ordered dither. Format22 packs only RGB and supplies defined sampling alpha255;
its raw X values are irrelevant. Explicitly requesting the other source format
fails. The frame adds its actual `format` discriminator; the pure converter
continues to return `{ width, height, rgba }`. Resource snapshots derive profile,
dimensions and defined-RGBA digest from that frame, keeping source hashes and
logical load tokens separate. No extra pixel copy, cache or snapshot root exists.

The generic PNG parser projects gAMA/sRGB chunk CRC, size, position and raw gamma
integer without performing color conversion. At the EFK seam, images without
color chunks, or exactly one valid nonzero gAMA before palette/data are accepted
only when the original transformation threshold is false. sRGB, duplicate or
late chunks, unknown lengths/CRC, zero gamma, RGB tRNS/Adam7 and active gamma
conversion remain explicit unsupported domains. cHRM/iCCP/pHYs/text are skipped
by the proved compiled PNG reader and do not alter samples. This is not a general
color-management claim.

Only gAMA metadata storage uses f32: the original f32 scale is multiplied by the
integer, then stored as f32 and returned as double. The screen2.2 multiplication
and subtraction have no intervening f32 store. The seam evaluates
`abs(2.2 * fileGamma - 1) > 0.05` using double, rather than adding invented f32
stores. Positive integer gamma gives a monotonic metadata value. The adjacent
unsafe/safe pairs are43181/43182 and47727/47728; safe integers are43182–47727
inclusive. Their distances to the threshold are approximately1.80e-5,3.95e-6,
6.05e-6,1.60e-5. These exceed even a conservative2^-21 arithmetic discrepancy
bound near1; double-versus-extended rounding cannot change a verdict. This derives
the numeric domain, without enumerating two fixture gamma values or emulating
general x87 state. Zero and unclosed metadata/order domains are rejected.

The two CC0 RGB inputs in `tests/fixtures/effekseer-rgb-level0/` reuse two recorded
discovery calls:12physical pixels,36 original defined RGB bytes and12 statically
defined opaque sampling components. Ordinary tests perform zero original calls.
They do not compare native X as alpha, and are not an independent holdout. The
previous six plus three independent RGBA cases remain unchanged:185pixels /
740original bytes exact. Metadata behavior for the ten existing public/authored
sources has static no-transform evidence; the old metadata-free calibration is
not relabeled as a dynamic metadata comparison. One separately authorized independent holdout then ran the fixed public
LaserMain02 input after the product/runner/input freeze: format22,64×256,pool1,
usage0,one level and49152 original RGB bytes all exact. Its16384 sampled alpha255
components remain static semantics, with no native alpha/GPU observation.
`holdout.json` records the descriptor and defined-RGB hash without copying the
public input or a large pixel table. Default World/kind61 drawing, GPU,
mip-capable hardware and other source domains remain separate work. See `docs/effekseer.md` for the resource owner's release
and fresh-restore contract.
