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

The current frame-source binding covers the compared HG3 path. HG2 frame-source
enumeration, cross-class encoded rebinding and other decoded formats remain
specific guarded follow-up shapes within the Image-to-Draw work. Replacing
encoded frames keeps an already loaded ANM object and its control state; it does
not create a new retained source or implicitly load a program.
