# Native view geometry

Main `8` writes the original view's client dimensions to two VM destinations.
Main `C` stores a raw floating-point perspective distance in the original graph
manager. Main `313` returns the current drawing rectangle as x, y, width and
height. These wrappers execute against the same view created by full native
initialization, including its graph manager and configured clipping rectangle.

Output addresses are converted before writing. VM address zero is valid, and
shared memory, extended blocks and aliased destinations keep their original
sequential-write behavior. Rectangle subtraction wraps as DWORD arithmetic.
Perspective values preserve their original bits, including signed zero,
infinities and NaN payloads.

`NativeGraphics.cameraNear` reads the initialized manager's actual word at
offset 224. Host geometry and original renderer callbacks therefore use the
same perspective state. An authored component without an initialized native
renderer retains its explicit local geometry state.

`scripts/verify-native-view-geometry.mjs` executes all three complete original
wrappers and helpers in each frozen PE: 6,915 comparisons across 1,728 calls per
profile check complete VM domains, complete view/manager records, output alias
order, signed boundaries and raw floating-point values. Device records are the
explicit authored boundary in this probe. The public SDK World test covers real
initialization, actual dimensions and clipping, changed host projection, fresh
restoration and independent native ownership.
