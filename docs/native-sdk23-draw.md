# SDK2.6.1.23 retained Draw contract

The fixed .23 build uses Main66 kind15 to construct its ImageList task. Main256
initializes its owned renderer, Main260 establishes the output offset and Main262
can disable external output while ordinary CPU rendering remains available.
These entry contracts use this build's table and receiver messages; another
build's same-numbered slot does not establish a binding.

Main259 updates the bitmap entry selected by caller and key, or inserts it when
absent. Its transform fields are float32 words, alpha is capped at255 and the
bitmap remains retained after its caller releases the source owner. Main263
changes the entry's shown word. Main462 reads its layer, returning the wrapper's
initial minus-one value when the key is absent; Main463 changes that layer.
Main657 returns the entry's borrowed bitmap, or zero for an absent key. Its
lifetime follows the retained entry and renderer.

Main264 writes the current count to native result scratch but returns control2.
It consumes its argument and pushes no KCS value. Count and layer operations
require an initialized renderer; the browser keeps that missing-precondition
shape guarded instead of manufacturing a result.

The focused original comparison uses a real Top/Script/Draw constructor chain,
an encoded HG3 descriptor and its decoded bitmap. Complete GCALLs compare layer
outputs, counts, visibility, update and insertion, every CPU pixel, automatic
Script bitmap ownership, source release, entry removal and parent-update
destruction. A fresh World resumes the same VM after source release. Raw
addresses and temporary receipts remain in ignored local evidence.

Main663 is `draw.resizeRenderer`: its own raw282 receiver resizes the existing
renderer. It releases the old output bitmap and tile records, creates a blank
output at the new dimensions and keeps the retained entries, their clipping
rectangles, layer values, output offset and base-plane state. The old borrowed
output ends with that allocation. A later CPU render redraws the retained
sources, including sources whose caller has already released its bitmap.
This is independent of the shared entry-replacement command. The .23 binding
does not enable an unknown slot in another SDK.

Main703 loads a sufficiently sized mapped output array with72-byte records:
tag1 owns a bitmap and tag2 owns a retained source. Main704 releases the handle
and clears the tag/handle pair without overwriting the record's name storage.
Main706 writes nine geometry words; Main709 borrows the frame at the requested
ordinal, independent of its encoded frame ID. Main707/708 retain a source for a
Draw key and update its transforms. Rebinding the existing retained key keeps
that source reference. Main624 loads its ANM program.

Main622/623 bind encoded ImageData from Main365. In this SDK even the same
descriptor rebuilds the decoded frame owners; the previous borrowed entry
bitmap ends at that rebuild. Releasing the caller's output array or encoded
descriptor preserves Draw ownership. Complete original GCALLs compare both
record tags, metadata, distinct frame IDs, CPU pixels and reference counts
through release, removal and destruction. A fresh World continues the same VM
after the caller releases its array. Only the reviewed HG3/ANM shapes establish
this binding; other image formats and transform modes require their own shape
review.

The frame-source binding covers HG2 and HG3. Native HG2v25 enumeration stores
every decoded frame in the same source map, including a single-frame source;
the existing HG2v10/v20 decoder contracts supply their one-frame form. Ordinals
remain distinct from frame IDs. Encoded rebinding of an existing bitmap or array-retained source preserves
that source and its loaded ANM. The array owner observes the replaced frames
and geometry while keeping its original reference count. Image-owner rebinding retains its original owner independently of current
decoded frames, as described below. JFIF inputs still require their complete
decoder initialization proof. Replacing
encoded frames keeps an already loaded ANM object and its control state; it does
not create a new retained source or implicitly load a program.

The transform mode is a raw zero/nonzero word. Actual mode2 and all-bits-set
Image-owner GCALLs enter the same affine branch as mode1 and preserve the full
compared pixels, ownership and cold continuation. They are accepted ordinary
shapes. The field is not an enumeration restricted to0 and1.

A retained source loaded by Main703 starts with its own layer0. Main707 inserts
that same source into the renderer without deriving a new layer from the Draw
key. Main462 reads the shared source field; Main463 changes it and the selected
renderer's ordering key. Main708, ANM updates and encoded rebinding preserve the
layer. Each renderer keeps its ordering key separately from the shared field.
The focused original VM comparison covers layer0, signed layer-3, transform
update, CPU pixels, source release and independent cold continuation.

A valid BMP, PSD, KCF or PNG file with a matching ANM file follows Main703's
frame-source path. Its original ordinal decoder yields an empty frame map,
while Main703 succeeds with a typed retained source. Main706 clears its nine
output words and returns0; Main709 returns0 for its empty ordinal. The ANM is
still deferred until the explicit program load. These outcomes differ from
plain primary-image parsing and from a failed source factory.

An empty source remains a logical Draw entry: it contributes to the count,
retains its layer and clip, and Main657 returns0. CPU rasterization skips its
absent bitmap without creating a zero-size bitmap. Encoded rebinding can replace
that same source's empty map with HG3 frames and back again; old pixels are
invalidated while the node, layer and references remain. The original VM
comparison covers both transitions, every output pixel, caller-array release,
removal and destruction. Independent cold Worlds continue from the initial
empty bind, both encoded rebinds and array release.

For .23, an image-owner Draw source retains the same Main710 owner, its renderer
and children. Main711 removes the Script reference; the retained owner stays
alive until the Draw entry releases its final reference. The owner array and
renderer hold their two references to each child source. Child ANM objects,
frame handles and owner updates remain shared. The checkpoint stores these
resource identities and reference counts in the existing resource codecs.

Main623 can replace the current decoded frames of this source without replacing
its owner. Main657 prefers the current bitmap and falls back to the owner's
bitmap when the decoded map is empty. That fallback does not reset the source's
cached geometry. A source can therefore have logical dimensions3x2 while the
actual retained bitmap remains4x3 with its original pitch. Scalar and affine CPU
sampling use both values; the bitmap getter keeps the actual bitmap dimensions.
Affine cached dimensions beyond actual storage remain guarded pending their
normal contract qualification.

The .23 affine RGBA blend keeps full intermediate weights until its final
shift. It has a different partial-alpha rounding rule from the scalar helper.
Layer changes update the ordering tree without invalidating pixels. A later
source or visibility update triggers redraw using the new order. Normal VM
comparisons cover both layer orders, visibility-triggered redraw, alpha,
subsequent entry removal and independent cold continuation.

The display and capture path consumes the completed CPU renderer bitmap.
Retained source geometry does not go directly to Stage or a GPU texture.
`graphics.surface` returns that renderer bitmap; ordinary output copies its
RGBA rows into VRAM before texture-page upload and Stage composition. The short
comparison checks the full output bitmap and physical texture rows after both
layer orders and later drawings, reusing the established presentation path.
An unqualified non-HG animated Main710 owner remains protected at construction;
Main703's separately qualified empty source contract does not establish its
owner storage layout.

The ordinary Root-frame resource chain also has an independent .23 comparison.
The original App-controller Root and mode1 View, unredirected CRT/FileServer and
factory-created Script load the actual KCS program. Nine Root updates execute
28 business GCALLs (39 including waits and the three established load calls).
They compare every 12x8 output pixel after owner entry clipping, replacement,
caller release, rectangle update, independent bitmap cloning, base-image binding,
clear and forced publication. The final Root frame retires the Draw normally.
The corresponding World control resumes independent current checkpoints after
the replacement and after the cloned base bitmap's caller has released it.
This proves the CPU bitmap/resource and configured COM-memory path; it does not
claim physical texture sampling, a new GPU host, or coverage of arbitrary packet
shapes. The original bitmap observer reads pitch times height rather than the
potentially stale cached byte-length header.
The exact SDK74 and plain SDK76 builds also have a normal loaded-Script bridge
for Main731/732. Each creates the actual typed Draw and initialized renderer,
loads an ImageOwner, rasterizes it, replaces the retained key with another
owner, releases both creators, and compares all output pixels after subsequent
raster and clear. The normal host then retires the Draw. This confirms the
modern caller and retained ownership context, with the same software/COM-memory
scope as the SDK23 group; it does not qualify physical texture sampling.
