# Retained drawing commands

Main `26E` and `26F` bind an `image-data` resource to a drawing entry through
messages 280 and 282. The original wrapper fills the complete 60-byte packet:
the second source word contains the original `kcBuffer` pointer, transforms
retain their raw floating-point bits, alpha clamps as an unsigned DWORD, and
all unused fields are initialized. These resources are separate from decoded
`bitmap` handles and 64-byte `image-owner` collections.

Main `270` formats its filename through the caller VM, resolves the original
ANM filename through the shared view and mounted file service, then sends
message 293. Main `271` sends the raw enable word through message 295. All four
wrappers route zero targets through the caller's Top namespace. Missing targets
retain the original routing result and control code 2.

The complete wrappers execute in the mounted PE. Their task transport maps the
native sender back to its World identity while preserving the target namespace,
message words and original payload pointers. Receivers continue through the
shared original retained-image decoder, animation and raster routines. A
single-frame image decodes without retaining its raw buffer descriptor; the
decoded retained object owns its resulting bitmap independently.

`scripts/verify-native-draw-commands.mjs` passes 6,050 comparisons across 1,100
complete calls per frozen PE. It checks all four wrappers, every initialized
packet byte, opaque buffer translation, signed/unsigned limits, raw float bits,
formatting and ANM resolution from data/shared/extended-block addresses, complete
VM state, descriptor reference counts and output canaries. Device initialization
is an explicit boundary in this transport probe.

The public SDK World test uses complete native view/device initialization,
decodes an authored HG2 resource, binds and updates its actual pixels, loads an
authored ANM through the original filename helper, and changes its original
animation gate. It releases the raw source, restores into a fresh World,
continues control and removes the retained object with independent ownership.
Whole-game playback and GPU effect pixels have their own acceptance checks.
