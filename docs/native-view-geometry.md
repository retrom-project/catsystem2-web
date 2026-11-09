# Native view geometry

Main `8` writes the original view's width and height to two VM destinations.
Main `C` stores a raw floating-point perspective distance in the original graph
manager. Main `313` returns the current drawing rectangle as x, y, width and
height. These wrappers execute against the same view created by full native
initialization, including its graph manager and configured clipping rectangle.

Main `2E3` executes at Game `650200` and SDK `51B850`. It writes the truncated
device offsets, doubles each destination in order, and converts the resulting
coordinates from screen space to virtual space. The arithmetic wraps at each
DWORD write.

Main `2E4` executes at Game `650070` and SDK `51B6C0`. It clears X and then reads
`screen.fullPosition`. Mode 0 adds the truncated device Y offset to the current
rectangle's bottom. Mode 1 uses the configured full height. Both pass X and Y
through the original screen-to-virtual conversion. Mode 2 writes the configured
virtual height directly. Other values leave Y as it stands after clearing X.
Both position queries take two VM output addresses and return control 2.

Output addresses are converted before writing. VM address zero is valid, and
shared memory, extended blocks and aliased destinations keep their original
sequential-write behavior. The position transform completes the X writes before
reading Y. Rectangle subtraction wraps as DWORD arithmetic.
Perspective values preserve their original bits, including signed zero,
infinities and NaN payloads.

`NativeGraphics.cameraNear` reads the initialized manager's actual word at
offset 224. Host geometry and original renderer callbacks therefore use the
same perspective state. An authored component without an initialized native
renderer retains its explicit local geometry state.

`scripts/verify-native-view-geometry.mjs` executes all five original wrappers
and their helpers in each frozen PE. There are 8,877 comparisons across 2,120
calls per profile, including 392 position calls. The probe supplies device and
settings records and uses the shared USER32 rectangle service. It checks whole
VM domains and native records, exact and partial aliases, all position modes,
signed boundaries and raw floating-point values.

The SDK World test covers live dimensions and clipping, host projection and
fresh restoration. The two-profile Chromium test runs authored KCS through the
original position wrappers in initialized views. It checks live RAM at VM address
zero and in shared and extended storage, preserves adjacent canaries, and
queries the restored view with changed settings in an independent World.
