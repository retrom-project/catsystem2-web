# Original selector image factory

Main `1CC` executes the complete original image factory. It returns an owned
image wrapper, represented by the existing `bitmap` handle. Its first DWORD
points to the original 92-byte bitmap. The wrapper is 536 bytes in the game and
276 bytes in the SDK; its initial reference count is one. Pixel storage,
metadata, decoder state and view cache remain in the shared native process.

| ID    | Arguments             | Control/result             | Game handler / factory | SDK handler / factory |
| ----- | --------------------- | -------------------------- | ---------------------- | --------------------- |
| `1CC` | formatted VM filename | `1`, bitmap handle or zero | `64C470` / `6746A0`    | `518FB0` / `54B790`   |

With no comma selectors the original factory loads one file at frame selector
zero. With selectors, each nonzero first character chooses a layer. For example,
the SDK resolves `base,1,2.ext` to `base_1.ext` and `base_02.ext`: each position
adds another zero before its selector. A zero selector skips that position.
The selector is a signed extension of its first byte, not an integer parsed
from the entire field. Empty fields and quoting follow the original comma
splitter. The filename is first formatted with the original KCS formatter and
resolved through the shared mounted image-category boundary.

The first pass queries each layer's native header or existing view-cache entry.
It unions physical extents, retains maximum canvas dimensions and obtains the
first available anchor. A successful union allocates the output wrapper and a
32-bit bitmap. The second pass loads or borrows each layer, composites it with
the original CPU raster code, copies its attributes and releases temporary
wrappers. A missing layer can be omitted when another layer supplies a valid
extent. No usable extent returns zero. Both passes, header readers, complete
decoders, clipping and pixel operations execute their original instructions.

The game version has an observable path-construction quirk. Its comma parser
produces a narrow CP932 basename, which is passed directly to
`wsprintfW("%s_")`. The basename can therefore be interpreted as UTF-16 and
consume bytes after its one-byte NUL. For example, an isolated `abc` buffer
becomes `扡c`; preceding stack contents can append further characters. The SDK
uses its original narrow formatter. The implementation preserves these
instructions and actual caller stack contents, without repairing filenames or
initializing the original local buffers.

Unlike `6F`, `70` and `76`, this wrapper **does not insert its result into the
Script automatic bitmap list**. The adapter does not create a list entry or
invent Script ownership. The caller can release the result through existing
main `72`; explicit bitmap aliases retain the original bitmap reference.
Script reload does not release an unregistered result. World teardown releases
remaining host-held references. Adopting the wrapper adds no pixel copy and no
extra original reference. The process checkpoint and bitmap-memory identity
maps restore the same wrapper, bitmap and cache pointers in a fresh process.

`verify-native-image-composite.mjs` executes **1,094 complete original wrappers
per frozen executable**. The game passes **14,000 comparisons** with 764
produced wrappers; the SDK passes **14,004 comparisons** with 765 produced
wrappers. Checks include frozen table slots, full controls/results/canaries,
all VM regions, exact file candidates, entire bitmap metadata and physical pixel
rows, all live native allocations and bytes, original reference counts and
destruction. Authored cases vary layer combinations, positions, anchors,
24/32-bit sources, alpha, empty/missing/corrupt files, selectors, raw bytes,
integer/recursive formatting and adjacent argument words.

Three optional Node tests execute both fixed engines and a complete SDK World.
They verify opaque and alpha-composited logical pixels, physical dimensions,
canvas/offset/anchor metadata, all VM regions, original wrapper release and
bitmap aliases. The World test enables the actual initialized-view cache,
restores its references and successfully recomposes after the mounted layer
files are removed. It also verifies that Script reload leaves the unregistered
results alive and that releasing a result in the restored World leaves its
source process independent.

Two Chromium tests execute the full initialized game and SDK renderers. Both
original layers decode and compose into one bitmap, upload through the original
view to VRAM, and produce six exact authored colors in the actual GPU output.
The new process restores the bitmap and GPU pixels; explicitly releasing its
image does not affect the source World. Run this optional suite with
`playwright.image.config.mjs` and the fixed-engine environment variables.

The private probe uses an authored view without a file cache and an explicit
zero caller stack to isolate most cases. A separate retained-stack-history pair
tests the game overread. These are declared input boundaries; product execution
keeps its actual stack and original view cache. Mounted category resolution and
IFile opening use the existing file adapter. Raw assembly, decompilation and
reports remain in ignored local storage.

The separate `2BF`/`2C0` render-source array lifecycle is not exposed by this
factory implementation.
