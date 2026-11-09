# Native text execution

Text uses the mounted executable for the reviewed parsers, ruby, line breaking,
character records, image-font routines and glyph compositing. A World owns one
`NativeEngineProcess`, shared with M2 and configuration. It validates the frozen
SDK/game image identity before executing a region. It does not enter the EXE
entry point, WinMain, Steam initialization or PE TLS callbacks.

The browser supplies the Windows GDI boundary through `NativeTextWindows` and
`CanvasTextGlyphs`: loaded font names, metrics and grayscale glyph masks. This is
a platform substitution. Matching an original text layout does not establish
pixel equality between browser font rasterization and Windows GDI.

| Contract                                   | SDK 2.6.1.74                   | Game 2.6.1.76                  |
| ------------------------------------------ | ------------------------------ | ------------------------------ |
| Task 8 constructor / handler / logic frame | `4C0310` / `4C0F50` / `4C0E70` | `5E3FF0` / `5E4C70` / `5E4B90` |
| Task 8 record/config size                  | 40 / 1116 bytes                | 40 / 1116 bytes                |
| STRING task / first message                | 48 / raw 444                   | 48 / 449                       |
| STRING8 task / first message               | Absent in this profile         | 63 / 469                       |
| NVSTRING task / first message              | 49 / raw 463                   | 49 / 489                       |
| FES STRING constructor / frame driver      | `5EE900` / `532C40`            | `74E540` / `6632C0`            |
| FES STRING8 constructor / frame driver     | Absent in this profile         | `752EB0` / `663B30`            |
| FES NVSTRING constructor / frame driver    | `5F0BD0` / `52F8C0`            | `750AB0` / `65FEB0`            |
| FES LOGSTRING constructor / frame driver   | `5FC1D0` / `52F300`            | `75E0A0` / `65F710`            |
| FES LOGSTRING8 constructor / frame driver  | Absent in this profile         | `75FCB0` / `65F870`            |

`NativeLegacyTextTask` executes the complete original task-8 constructor,
handler, logic frame and destructor. It keeps that task's parser and character
records separate from the later STRING writer. Its main-native family
`0x7B..0x8B` executes the actual profile's wrapper and KCS pointer/formatting
helpers. The image-font wrapper marshals a browser bitmap into an original
native bitmap; the original font setter owns its deep copy. A temporary image
container here exposes the bitmap getter boundary, not a replacement task.

`NativeTextTask` and `NativeNVTextTask` port the later task's message/frame
protocol while executing their original writer engines. NV retains independent
main/sub-text section parsers. `insert` creates a section; `str` clears sections
according to the original command. A native remaining query without an
initialized writer raises a diagnostic rather than returning an invented zero.
The original NV frame has no task `userValue` pause gate; the ordinary STRING
frame does. Both use the World's actual two-phase task clock.

FES object constructors, command handlers and frame drivers run through the
shared `NativeFESObjectRuntime`. Group counts, explicit indices and whole-group
selection remain distinct. The native callback resolves each object slot; a
whole-group command executes the original handler once. Sources and object
definitions remain attached to the FES interpreter. `SIZE2` uses the original
frame's cropped size and position, including its selector. An absent authored
image font leaves the native image-data field null.

FES string-bank identity follows the original interpreter guard: game offset
2064, SDK offset 1800. A native shell supplies that identity while the World's
single string bank owns its contents. `str` and `apend` expand those raw bytes
once, then call the shared SCRIPT replacement bridge. CP932 STRING and UTF-8
STRING8 retain their distinct encodings. A bank value containing another
`$str` expression is not recursively expanded. The replacement bridge reads
the same configuration rules used by KCS; it does not build a second map.
Authored tests include Japanese, musical symbols, a literal nested expression,
and `A` to `AA` replacement to detect an accidental second pass.

The original object handlers scan the full command buffer for their requested
tail. For example, `layout fontind 1 Font Name.ttf` reads the index separately
and gives FreeType `Font Name.ttf`. STRING8 places its UTF-8 text in that same
buffer so the native tail reader and subsequent conversion see the original bytes.

Native font resource streams use the shared [resource search](native-resource-search.md)
and original MemoryFile operations. This permits the executable's own FreeType
path to read a mounted font file, independently of the browser GDI substitution.
Complete browser font and first-dialogue pixel acceptance remains separate.

## Display logs

The `display-logs` feature executes the mounted engine's display-log manager
and main wrappers `2B8..2BC`, `311`, `36C` and `3D1`; game additionally has `40A`.
Appending entries, line wrapping, block pruning, names, scene locations and
path indices remain native records. `311` limits blocks rather than flat lines.
`2BC` returns a speaker name; the source scene is a different field.

History rebuild imports the existing `NativeSceneData.history` into a temporary
original history descriptor, runs the original CST reader and parser, then
releases the temporary descriptor. It does not copy a host message array into
an invented history format. The game `40A` wrapper reads an available CSTL file
but leaves its requested-language bindings empty. The reviewed original
therefore falls back to the source CST. Tests observe those empty maps and
retain this behavior; the explicit language-binding scene API is separate.

LOGSTRING uses a 44-byte common base rather than the image-plane KX2 layout.
Its original driver creates one STRING child per slot; LOGSTRING8 creates two
STRING8 children per slot. Native child objects retain their own layout and
text records. Ordered definition rows run the original header parser, row parser and complete
type-specific apply handler. The shared PARENT step retains actual native object
pointers; parent coordinates remain local across repeated frame synchronization.
Children are destroyed before their referenced parents. Older manual columns
ignored by these pinned handlers are not treated as aliases.
LOG paging/color commands still need complete input/output coverage.

The shared configuration codec supplies the actual GAME/log defaults and
fields to the original manager. The two profiles store the name prefixes as
CP932 even though the game's general startup XML is UTF-8. A zero-filled
replacement configuration is not a valid native log setup.

## Bitmap upload and task transport

The native GPU upload path consumes the bitmap's physical rows in ascending
address order: `data + y * stride`. Its separate logical-pixel getter reverses
Y. Reusing the getter's reversal for a GPU upload inverts text and makes a dirty
rectangle miss its glyphs. `NativeTextWriter.frame` and
`NativeGraphicsPlatform.copyBitmap` use the upload order. This boundary does not
change the standalone image codec's documented coordinate convention.

Original upload clips the requested source window against the bitmap's
canvas-offset bounds, then transfers cropped pixels at the destination plus
that canvas offset. Negative destinations advance the source into the retained
texture page. Empty source intersections return zero. A valid intersection can
return one even when it affects no allocated destination pixels.

The shared `graphics-platform` feature owns one view/renderer/manager set and
native bitmap transfers. M2 and text consume the same platform records and GPU
context. Task identifiers read from the PE belong to the current Top namespace.
They are resolved to internal World IDs before graph lookup; raw message
senders stay native IDs, while `nativeSenderWorldID` identifies the sender's
memory. The World routes broadcasts and unwritten output words. Native code
does not receive a zero value for an unwritten query.

Snapshots retain one process image and feature registry. FES objects, native
writers, task prefixes and graphics retain references into that same restored
image. A fresh candidate installs the saved feature boundaries before restoring
the process and object graph. Destruction during a suspended host callback uses
`callFromHost` and preserves the outer native continuation.

Image-font data uses the shared `data-buffers` feature. KCS `0x16D` image-data
handles, main `0x26C`, FES source images and standalone writer image fonts all
refer to its original 20-byte descriptor. Its data allocation has a separate
hidden DWORD reference header; descriptor references and heap references are
distinct. The original setter consumes the supplied reference. FES frame
drivers explicitly retain their source reference before sending it. The bridge
does not invent another retain or duplicate the source bytes for a checkpoint.

## Verification and remaining work

- `tests/native-text.test.mjs` includes 492 authored FES layout records and 54
  original cross-profile bitmap-upload goldens. These run without proprietary
  executable bytes. The goldens contain only authored colors, dimensions,
  coordinates and output hashes.
- With `CATSYSTEM2_ENGINE_EXE` and `CATSYSTEM2_SDK_EXE`, the same suite executes
  real FES commands, STRING/STRING8/NV sections, array selection, image fonts,
  cropped `SIZE2`, task-8 constructors, LOGSTRING/LOGSTRING8 child rendering,
  history/CST rebuilds and fresh-process checkpoints. Separate
  Top trees deliberately reuse the same native task number.
- `tests/browser/native-text.spec.mjs`, run with `playwright.text.config.mjs`,
  executes both original text engines with real Canvas font metrics and masks.
  Appending new glyphs after a fresh-process restore produces identical pixels;
  the shared GPU matches the native bitmap alpha composite within one RGB LSB.
  This covers the browser platform boundary, not Windows GDI pixel equivalence.
- `scripts/verify-native-text.mjs` compares the thirteen later main wrappers:
  416 original executions across both profiles.
- `scripts/verify-native-nv-text.mjs` compares 816 original task message/frame
  states, native bitmaps and VRAM results across both profiles.
- `scripts/verify-native-graphics-platform.mjs` executes 108 original GPU-upload
  functions with asymmetric rows, offsets, clipped destinations and empty
  windows. Only preallocated texture-page lock/unlock/allocation is supplied by
  the host. `--write-fixture` regenerates the public goldens only after both
  original profiles agree.

This is not an acceptance claim for every FES text object or every glyph path.
LOGSTRING/LOGSTRING8 paging and color edge cases, remaining definition columns,
remaining object commands and complete UI flows still require coverage. Task-8 messages 114/115 are unhandled by
the reviewed native receiver and are not invented as new features. GDI outline
formats and non-identity glyph matrices not supported by the platform adapter
remain explicit diagnostics. Browser font pixels and actual game screenshots
need their own visual acceptance in addition to CPU/state tests.

Primary public references are the official [STRING object](https://cs2.suki.jp/manual/fes/code/o_string.html),
[NVSTRING object](https://cs2.suki.jp/manual/fes/code/o_nvstring.html),
[LOGSTRING object](https://cs2.suki.jp/manual/fes/code/o_logstring.html),
[layout command](https://cs2.suki.jp/manual/fes/reference/co/layout.html) and
[user-font command](https://cs2.suki.jp/manual/fes/reference/co/userfont.html).
Executable observations, original memory dumps and screenshots remain ignored
under `.local/`; no original executable instructions or assets are distributed.
