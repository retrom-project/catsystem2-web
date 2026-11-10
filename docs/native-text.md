# JavaScript text execution

The runtime owns text bytes, parsing, placement, reveal clocks, glyph bitmaps,
logs and checkpoints in JavaScript. It executes no original text constructor,
parser, glyph compositor, task-8 receiver or FES text driver. Original wrappers
and engines are retained under `oracle/` for private differential tests.

The modules separate the recovered contracts:

- [`text-parser.mjs`](../src/native/text-parser.mjs),
  [`text-scanner.mjs`](../src/native/text-scanner.mjs) and
  [`text-layout.mjs`](../src/native/text-layout.mjs) own incremental CP932/UTF8
  source, style stacks, 88-byte character records, line breaks, kinsoku and ruby.
- [`text-core.mjs`](../src/native/text-core.mjs) owns STRING/STRING8/NV writer
  state, page markers, speed changes, wipe backing pixels and independent NV
  main/sub sections. [`text-config.mjs`](../src/native/text-config.mjs) builds
  the per-ABI packets from canonical configuration.
- [`legacy-text-state.mjs`](../src/native/legacy-text-state.mjs) and
  [`text-legacy.mjs`](../src/native/text-legacy.mjs) implement task 8's separate
  1116-byte configuration, 40-byte cells, wrappers, image fonts and frame logic.
  Messages 114/115 remain unhandled, as in the reviewed original receiver.
- [`text-task.mjs`](../src/native/text-task.mjs) implements the canonical task
  messages and actual World frame clocks. STRING observes `userValue`; NV has
  no such pause gate. Raw source events retain their ordering across checkpoints.
- [`fes-text.mjs`](../src/native/fes-text.mjs) and
  [`fes-text-layout.mjs`](../src/native/fes-text-layout.mjs) own commands,
  deferred updates, group selection, definitions, cropped SIZE2/POS2 references
  and cached `isdraw`, `linecnt`, `endpos` and inline-ID queries.

## Metrics, fonts and pixels

The exact comparison policy is in
[`native-text-layout-policy.json`](../tests/fixtures/native-text-layout-policy.json).
Integer layout, breaks, ruby anchors and pixels have **zero tolerance**. Only
bytes 6/7 of each original 88-byte record are normalized: those are unwritten
padding after a uint16 character code, with no script meaning.

`CanvasTextGlyphs` supplies the GDI host boundary. Font selection resolves a
mounted game font alias or the packaged Noto Sans JP font; it never selects an
OS family. The packaged font's provenance, SHA-256 and OFL are under
[`third_party/fonts/noto-sans-jp`](../third_party/fonts/noto-sans-jp/README.md).
The oracle uses the same deterministic host metrics/masks, allowing exact
comparison of parser and raster algorithms without asserting Windows/Canvas
font pixel equivalence. GDI uses gray64 coverage, the original integer bold
and shadow rules, and independent source/destination clipping.

The original FreeType path reads the mounted `font` resource independently of
GDI. [`font-backend.mjs`](../src/native/font-backend.mjs) uses deterministic JS
builds of **2.4.8 for SDK** and **2.7.1 for game**, selected by ABI fields. SDK
converts CP932 before glyph lookup; game passes the 16-bit code directly.
The reviewed game configuration uses TrueType interpreter 35. Fixed font
fixtures compare actual glyph advances, boxes and every RGBA byte against
both original libraries. Missing resources/glyphs preserve the original empty
result; this backend does not substitute the packaged GDI fallback.

Build the font backends with:

```sh
python3 scripts/prepare-native-freetype.py --emsdk /path/to/emsdk-3.1.74
```

The builder verifies fixed upstream archives, compiler and wrapper identity.
Standalone builds verify the fixed generated hashes and package both JS
modules, FTL notices, source bundles and `vendor/freetype-manifest.json`.
No WASM or original EXE is involved in these font backends.

`GAME/strframe_frame` is the reveal scale (constructor default 5, missing XML
field 0), represented as `scene.textFrame`; it is not FPS. Speed rebasing,
unsigned clock wrap, page early exits, the cached end query and incremental
wipe alpha are compared as stateful sequences. NV retains separate parser
configuration per section, pending CR state and a shared writer clock.

Raw image-font bytes and decoded selector pixels belong to JS. Font cells use
the original square resampling and integer compositor. Task-8 image fonts own
a deep copy of the supplied bitmap. Character maps and all pending state are
included in checkpoints.

## Remaining EXE consumers

Domain 6 still owns GPU upload/render targets. JS text bitmaps cross the same
registered bitmap-input projection as other JS images. The upload consumes
physical rows in ascending address order; the original logical pixel accessor
reverses Y and is not used for text upload. VRAM addresses remain independent
of the enclosing Draw origin.

Domain 7 LOGSTRING/LOGSTRING8 still creates text children. Its
[`fes-text-projection.mjs`](../oracle/fes-text-projection.mjs) constructs only a
common plane/motion prefix and projects independent config/cached-query words.
Fourteen explicit semantic adapters route the original LOG caller's text
reads/writes to JS. Original text bodies and parser pointers are never used.
LOG owns the common motion/parent prefix; only that prefix is pulled back for
LOG-controlled children. Parser, source, config, reveal and query state remain
JS authority. This boundary is removed in phase 7.

SDK JavaScript task consumers keep separate original text objects; their
state belongs to domain 8 until that subsystem migrates. GDI/DC/DIB platform
services shared with rendering/startup also remain domain 6/8 services.
The complete ownership/deletion registry is generated in
[`b-migration.json`](b-migration.json), with source in `scripts/b-migration.mjs`.

## Display logs

[`text-log.mjs`](../src/native/text-log.mjs) implements main `2B8..2BC`, `311`,
`36C`, `3D1`, `352/353` and game `40A`. JS owns scenes, seven-word blocks,
two-string rows, speakers, captured config, cumulative bases and limits.

CSS wire bytes contain scene names, 28-byte blocks, tagged first-string rows
and speaker names. Second row strings are deliberately absent from the wire
format and preserved by World checkpoints. Validation precedes mutation.
History rebuild reads JS CST/history/string-bank state; it creates no original
display-log manager. Wrapping preserves CP932 byte rules and original ruby and
literal-backslash-n behavior. A stable no-progress input corresponding to an
unbounded original allocation loop raises a bounded diagnostic.

D7 LOG consumers receive independent read-only tables through
[`text-log-projection.mjs`](../oracle/text-log-projection.mjs). LOGSTRING8 remake
updates JS rows explicitly before projection. The original requested-language
subset differs from the unbound `40A` history fallback. Ordered definitions
and parent pointers remain in the D7 common-object path; child text is JS.

## Verification

`tests/differential/native-text-{layout,raster,sequence,font,legacy}-js.test.mjs`
compare both frozen ABIs with explicit private-fixture skips. The public
fixtures contain authored text/colors/configuration, no game scripts or fonts.
Coverage includes incremental configuration, kinsoku/ruby, style/escape parsing,
page/reveal/wipe/speed sequences, NV sections/CR/sub text and actual fixed-font
FreeType pixels. `tests/native-text.test.mjs` adds 492 authored layout goldens,
54 bitmap-upload goldens, FES arrays/definitions, log children, task namespaces,
font references and fresh-process checkpoints.

The GDI host boundary is tested independently; unsupported outline/matrix
formats remain explicit diagnostics. Actual Windows font rasterization and
visual game screenshot acceptance are separate from CPU/state equality.
