# Bitmap producers and script ownership

[The bitmap factories](../src/native/bitmap-factory.mjs) execute main
6F, 70, 72, 75, 76, 77 and 79 in JS. NativeImages owns their pixels,
metadata, independent clones and task lifetimes. Script cleanup releases its
remaining handles. Original Draw/FES references use the registered independent
bitmap projection and its consumer lifetime.

75 uses physical bottom-up bitmap row coordinates. Its zero-bitmap branch
clears the view with four coordinates. 79 retains unsigned percentage arithmetic
and leaves alpha intact. 77 writes both outputs, including zero for a null
image. Missing argument words use adjacent mapped GCALL memory.

6F uses the JS image resource/decoder layer and evaluates the resulting alpha
presence cache. Detailed file-selector, composition and codec coverage is
completed in phase 5.3. Blank images preserve zero dimensions; clones preserve
independent pixels and the original metadata initialization rules.

`tests/differential/native-bitmap-foundation.test.mjs` compares both frozen
handlers with normal JS World registration. Producer, fill, tone, clone,
metadata, null, zero-dimension and release sequences compare all VM bytes,
canaries, metadata and RGBA exactly. Pure-JS fresh World tests preserve aliases,
image-owner metadata and task cleanup without private fixtures. Projection tests
verify separate script authority and consumer-owned raw views.

The original facade is retained in `oracle/bitmap-factory.mjs` for the existing
standalone layout proof. `verify-native-bitmap-factories.mjs` checks 388 original
calls and 2,449 comparisons per engine, including list and heap layouts. Those
layout comparisons describe the oracle. The normal JS runtime uses its handle
and pixel observations in the differential fixture.
