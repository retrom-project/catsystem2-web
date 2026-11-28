# Selector image composition

Main `1CC` is implemented by
[the JS selector factory](../src/native/image-composite.mjs). Its output is an
explicit `bitmap` handle, independent of Script automatic cleanup. Alias and
final-release rules are shared with the other JS bitmaps. It returns control 1
and a handle, or zero when no usable extent exists.

The filename is formatted before extension splitting and comma parsing.
[The shared splitter](../src/native/resource-selection.mjs) drops empty fields,
uses the signed first byte of each selector, and has no CSV quote grammar.
Selector `0` skips that position while preserving its zero-padding index. SDK
`base,1,2.ext` loads `base_1.ext` and `base_02.ext`; no-selector input strictly
uses frame ID 0.

The game ABI retains its unusual narrow-basename-to-wide interpretation:
CP932 bytes are read as little-endian UTF-16 units. Unspecified bytes after the
one-byte terminator are zero-filled in JS. Thus `abc` becomes `扡c`. Raw oracle
calls retain stack-history evidence; comparisons use an explicitly cleared
scratch stack. This is a deterministic choice for unspecified input bytes, not
a claim to reproduce arbitrary previous native stack contents.

The first pass reads cached metadata or image headers, unions physical extents,
retains maximum effective canvas dimensions and takes the first successful
anchor. Decode failure in the second pass does not undo a successful header
union: an allocated transparent output can still be returned. The second pass
composites layers in order with the original anchor adjustment, independent
physical clipping and bottom-up row arithmetic. Attributes merge by their
16-bit IDs without anchor translation. Multi-layer output is RGBA32 with the
original zero alpha hint and mask. Single-file output keeps decoder metadata;
the SDK preserves RGB24 where the game decoder produces RGBA32.

Immutable cached source pixels survive a fresh World checkpoint independently
of source files and mutable output handles. The cache is limited to 32 assets.
D6/FES consumers receive the registered independent bitmap projection.

`tests/differential/native-image-composite-js.test.mjs` compares normal JS
runtime dispatch with independent original handlers in both frozen ABIs.
It checks full pixels, format, canvas, offsets, anchors, attributes and missing
inputs. The oracle-only factory remains in `oracle/image-composite.mjs`.
Browser tests additionally verify actual VRAM plane pixels and fresh GPU restore.
