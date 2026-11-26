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
