# Native image owners

[The image-owner model](../src/native/image-owner.mjs) owns logical handles,
bitmap state, metadata queries/setters and automatic task cleanup in JS.
All commands, including file and ANM input loading (`2C6`), use that model.
[The loader](../src/native/image-owner-load.mjs) decodes layer/frame pixels,
selects unsigned frame IDs and retains raw ANM program bytes in JS. The
remaining ANM timeline and rasterizer belong to domain 6. Comma grouping
preserves the original unflushed trailing ANM candidate.
[Pixel commands](../src/native/image-owner-pixels.mjs) transform each JS layer.
[The projection](../oracle/image-owner-projection.mjs) builds independent PE
vectors, bitmap wrappers and frame maps without image native handlers. Those
frame maps are immutable inputs to the retained consumer; only their current
frame selection changes. The PE release boundary remains until phases 6/7.

The independent 64-byte PE collection serves retained Draw and IMAGEEX. It
contains its own bitmap/wrapper references and keeps the renderer's original
retained lifetime. The JS handles checkpoint owns script pixels and metadata.

| IDs                   | Operation                                                      | Result control        |
| --------------------- | -------------------------------------------------------------- | --------------------- |
| 2C6 / 2DD             | Load formatted resource / create a four-byte-pixel image       | 1, image-owner handle |
| 2C7                   | Drop the caller's list entry and release one reference         | 2                     |
| 2C8 / 2CA / 2CB / 2CD | Query size, canvas size, offset, base                          | 2 / 2 / 2 / 1         |
| 2CE / 2CF / 2D0       | Set canvas size, offset, base                                  | 1                     |
| 2C9 / 2CC / 2D9       | RGB percentages, packed color multiplication, alpha percentage | 2                     |
| 2D1 / 2D2             | Cached alpha-presence query / explicit hint                    | 1 / 2                 |
| 2D3 / 2D6 / 2D7 / 2DA | Quarter-turn rotation, blur, flip, resize                      | 2                     |
| 2D4 / 2D5             | Query five-word image attribute / copy attributes              | 1                     |
| 2D8 / 2E1             | Mask word / original color-processing selector                 | 2                     |
| 2DB / 2DC             | Draw/replace a retained entry using an image owner             | 2                     |
| 2DE / 2DF / 2E0       | Blend/copy rectangles and fill an image or the VRAM boundary   | 2                     |

The catalog records complete parameter lists. Scalar words cross the ABI
unchanged, including float-bit drawing parameters. `2D4` truncates its index to
16 bits and copies exactly five words on success. Null owners retain each
wrapper's original early returns, preserved outputs and unwritten result words;
the adapters do not normalize these different branches into a generic failure.

Each Script owns its JS handles. Reload and destruction release its logical
references. PE projections retain independent wrappers and program buffers. Draw entries
retain those projections using descriptor field 3; releasing the Script handle
preserves the consumer's remaining reference.

File paths and pixels are loaded through the shared JS mounted-resource reader.
HG2 keeps its decoded pixel depth in both ABIs; game HG3 expands RGB24 to RGBA32,
while SDK HG3 keeps RGB24. Main `6F` expands RGB24 to RGBA32 as its wrapper requires.
Cache entries are immutable values and checkpoints retain JS inputs alongside
each remaining consumer's independent state.

## Verification and boundaries

`tests/differential/native-bitmap-foundation.test.mjs` compares normal JS
owner creation, metadata, cached alpha flags, null outputs and release with both
original handlers. Full VM bytes, canaries and bitmap pixels match exactly.
Separate pure-JS tests cover fresh World restore and task cleanup. Original
layout proofs below remain in the oracle fixture.

The oracle-only `scripts/verify-native-image-owners.mjs` previously executed every wrapper in both frozen
images: **754 complete wrapper calls and 5,596 comparisons per profile**,
**11,192 comparisons total**. It compares result/control words, complete mapped KCS data/stack/shared
and extended blocks, original image/bitmap/tree/list allocations and all bytes
delivered to explicit task-routing and VRAM boundaries.

Authored inputs include missing, empty and malformed files; asymmetric HG2
pixels; HG3 attributes with a valid and truncated ID; single ANM and two-layer
ANM composition; size/offset/base metadata; color/alpha/mask operations;
90/180/270-degree rotations; both flips; blur/resize; source/destination aliasing;
clipped rectangles; four VM output regions; drawing packet fields; independent
Script owners; retained references; reload and destruction. Four optional public
tests additionally check logical RGBA, output canaries, original attribute data
and independent fresh-process restoration of references and lists. An SDK full-World
test and two Chromium tests execute complete original view/device initialization,
Script-owned lists, parent/child isolation, failed reload cleanup and fresh-World
restoration. The browser tests use separate real `ParticlesGL` devices for the
original and restored World (`playwright.image.config.mjs`).

The standalone differential fixture supplies an authored outer-view record,
default native configuration, mounted files and reviewed CPU raster/worker
boundaries. It does not validate complete device initialization or final
browser pixels. The full-World tests above cover the view/device and Script lifecycle;
retained-renderer pixels require their separate acceptance tests. Original operations on invalid owner classes, freed resources,
invalid dimensions or absent layer containers remain invalid; a constructor
returning a handle does not make every subsequent original operation defined.

`2DE/2DF` read argument 0 and write argument 5, as independently checked with
different source/destination colors. The argument labels in the original
wrapper catalog are corrected to match that direction. Draw packet words are
built in JS; the D6 receiver materializes its logical owner only at consumption.

Single static output aliases its layer. Layer colors/alpha mark a compound
output dirty without eager recomposition. Rotation/mirror/resize rebuild it;
ANM cached container extents remain distinct from transformed frame extents.
Blur preserves its separate output-expansion sequence. Program bytes and all
frame pixels belong to JS; the remaining D6 ANM VM owns its timeline.

D6 rendering can update the compound derived output. Capture is tied to an
observed actual compositor draw and completes at async D6 call boundaries.
Clearing the dirty flag during bounds refresh is insufficient and does not
trigger capture. This registered PE-to-JS output projection is removed in phase 6.
The ordinary JS input layers are never refreshed from that output.

New independent pixel, packet and reconstruction differentials are in
`native-image-owner-pixels.test.mjs` and `native-image-owner-projection.test.mjs`.
The latter also checks complete static/ANM output pixels, immutable input
ownership, projection dimensions and fresh World restoration.
