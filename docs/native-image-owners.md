# Native image owners

[The image-owner adapter](../src/native/image-owner.mjs) executes all 28 original
main wrappers in `2C6..2E1`. Their 64-byte reference-counted image collection is
distinct from a raw bitmap, a decoded image wrapper and a 20-byte file-data
buffer. These resources share one original-engine process and their original
ownership relationships.

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

Each Script has the original circular owner list at `+156`. Loading and creating
append to it; releasing removes from the caller's list and decrements the
collection reference count. Reload releases all owned references before clearing
the original list. Script destruction also frees its head and container. Draw
entries independently retain an image owner through the original retained-image
setter. Their descriptor uses **field 3**; field 0 remains an ordinary bitmap.
Releasing the Script reference leaves the Draw reference alive.

The loader executes original category resolution, extension/selector processing,
image decoding, ANM resource loading and composition. Comma selection generates
names such as `base_1` and `base_02` before the extension. Both original ANM
records and decoded bitmap metadata stay in guest RAM. Checkpoint handles retain
only pointer/owner identity; restoring never reloads the file or builds another
authoritative image collection.

The Script's `+116` view is the original outer `kcView`, shared with its Top.
Production loading waits for `graphics-platform.ensureRenderer()`. Browser
presentation, hardware texture upload and task routing use their shared platform
services. No private renderer or independent texture parser is created here.

## Verification and boundaries

`scripts/verify-native-image-owners.mjs` executes every wrapper in both frozen
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

The no-ANM multi-selector fallback includes an original narrow-base argument to
`wsprintfW`. That branch is retained as original code and is not silently
rewritten into a different filename convention.
