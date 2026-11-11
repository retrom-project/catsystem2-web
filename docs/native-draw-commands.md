# Retained drawing commands

Main 2C3 and 2C4 pass a JS retained-source handle to Draw. The
arguments are the target task, entry index, opaque handle, two position words,
two base words, rotation, two scale words, alpha, visibility and transform
mode. Position, base, rotation and scale retain their float bits. Alpha
clamps as an unsigned word. The complete 60-byte packet uses source word 2
and zeroes the other source words and the auxiliary word. Both wrappers
return control 2.

| Fixed profile           | 2C3 / message  | 2C4 / message  | Original Draw receiver |
| ----------------------- | -------------- | -------------- | ---------------------- |
| NEKOPARA Vol.3 2.6.1.76 | 0x644090 / 280 | 0x644B60 / 282 | 0x5F3F50               |
| SDK 4.01 2.6.1.74       | 0x51C740 / 275 | 0x51D1A0 / 277 | 0x4CE6C0               |

The JS wrappers carry the handle unchanged. A tag 2 render-source record
provides that handle. The Draw manager retains it once on insertion. For
an existing key, the original update helper changes the stored record's
transform, alpha and visibility and ignores the supplied replacement
handle. A zero handle leaves the entry alone. The manager and its resource
identities restore through JS handle codecs.

Whole-manager destruction decrements each reference. The explicit
single-entry removal command calls the record destructor and frees it
immediately, including when its reference count exceeds one. It leaves the
caller array's words as they were. A caller using both APIs releases its
array reference before single-entry removal.
[Native render-source arrays](native-render-sources.md).

Main `26E` and `26F` bind an `image-data` resource to a drawing entry through
messages 280 and 282. The original wrapper fills the complete 60-byte packet:
the second source word contains the opaque `image-data` handle, transforms
retain their raw floating-point bits, alpha clamps as an unsigned DWORD, and
all unused fields are initialized. These resources are separate from decoded
`bitmap` handles and 64-byte `image-owner` collections.

Main `270` formats its filename through the caller VM, resolves the
ANM filename through the mounted JS image-file service, then sends
message 293. Main `271` sends the raw enable word through message 295.
Main `370` packages an index and value into eight bytes (SDK message 307,
game message 312). The JS retained source applies the word to its
ANM register bank and nested retained animations. An unsigned index above
63 leaves the bank unchanged.

Main `36F` binds a Draw entry to a sound bank (SDK message 306, game 311).
Its logic tick queries the current Top's sound task and sets ANM variable 0
according to the unsigned level comparison. The default threshold is 1000;
main `371` updates it for an existing link (SDK message 308, game 313).
Reassigning a link preserves its threshold and enables the new bank without
disabling the previous one. Passing `0xFFFFFFFF` disables the current bank,
clears variable 0 and removes the link. The Draw destructor only releases
its link table. All nine wrappers route zero targets through the caller's
Top namespace. Missing targets
retain the original routing result and control code 2.

All nine wrappers, retained resources, ANM and CPU composition execute in JS.
The original address table and wrapper verifier are oracle evidence. FES
retains an explicit phase7 producer projection. Its descriptor import preserves
live source identity, frame references, visibility, clipping and animation
writeback. JS image-owner inputs compose in JS and survive release of their
independent PE consumer projection.

`scripts/verify-native-draw-commands.mjs` passes 14,035 comparisons across 2,475
complete calls per frozen PE. It checks all nine wrappers, every packet byte,
raw retained pointers and opaque buffer translation, signed and unsigned limits,
float bits, formatting and ANM resolution from data, shared and extended-block
addresses, complete VM state, reference counts and output canaries. Device
initialization is an explicit boundary in this transport probe.

The render-source World tests call the JS Draw entry points for both ABI
profiles and compare resource state after insertion and updates. They
exercise both destruction paths and compare the actual Draw pixels and
independent references after restoring into a fresh World. They write an ANM
register through its drawing key and check that the same live bank
continues independently after restore. The sound-link cases feed controlled
levels through the normal sound task, then check its capture words and the
live ANM variable in both browser profiles.
[`verify-native-draw-sound.mjs`](../scripts/verify-native-draw-sound.mjs)
compares the original Draw receiver and logic frame over 121 calls per
profile, including all sound packets and the unsigned registration order.

The public SDK World test uses complete native view/device initialization,
decodes an authored HG2 resource, binds and updates its actual pixels, loads an
authored ANM through the JS filename helper, and changes its animation gate. It releases the raw source, restores into a fresh World,
continues control and removes the retained object with independent ownership.
Whole-game playback and GPU effect pixels have their own acceptance checks.

The shared RNG and all 18 ANM opcodes are compared against both retained
oracles. Integer, MASK, BTYPE and affine CPU drawing use the 43 frozen cases
with exact CPU and VRAM bytes. Additional RGB24, format-dispatch and nonfinite
integer-coordinate cases compare directly with both original managers.
