# Native screenshots and frame recording

Main `71` creates a Script-owned bitmap through the original view screenshot
helper (`6758E0` / `54CA70`). It renders the original capture range and keeps the
actual returned bitmap in native memory. The host transfers its ownership into
the canonical image list, with no second authoritative pixel array. Explicit
release and failed Script reload release the original allocation.

Main `1B9` sets the raw recording flag, filename prefix and starting counter.
Main `235` and `236` read those fields from the actual native view. The game
uses a 32-WCHAR prefix; SDK uses 64 ANSI bytes. No Boolean conversion is applied
to the flag. The original outer frame renderer captures and encodes a BMP after
Present, increments its DWORD counter and uses the signed counter in the
zero-padded filename. All of this state survives a fresh World.

Both original capture paths are supported. Direct3D uses the shared original
render targets and readback. The GDI window path selects the view's real DIB,
fills it and copies the presented browser canvas through the shared DC/bitmap
services. Cursor overlays retain their window-level composition boundary.

The original `71` helper copies top-down D3D pixels into a bitmap whose ordinary
pixel accessor reads bottom-up rows. Its logical result is therefore vertically
mirrored. This behavior is retained, including with raster acceleration disabled.
The original recording branch explicitly flips rows before encoding, and its
decoded BMP matches the displayed picture. D3D readback orientation is independently
checked by the authored Wine PPI and M2 pixel fixtures; it is not changed to hide
this bitmap contract.

`scripts/verify-native-screen-recording.mjs` executes the complete original
recording setter and getters, comparing whole view buffers and unchanged VM
regions. Game passes 7,942 comparisons across 2,646 calls; SDK passes 9,265 across
3,087 calls, including its longer ANSI prefix. Cases cover formatted Japanese
names, maximum fields, data/shared/extended sources and all DWORD limits.

`tests/browser/native-screen-capture.spec.mjs` runs both full engines on a real
GPU with authored asymmetric graphics. It checks screenshots through Direct3D
and GDI, unaccelerated original results, real BMP bytes/decoded pixels, counter
wrap with signed filenames, failed Script reload, native allocation release,
recording in a fresh World and restoring its device before another frame.
