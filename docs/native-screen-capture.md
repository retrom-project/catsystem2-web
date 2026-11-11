# Screenshots and frame recording

Main `71` reads the completed JS backbuffer into a Script-owned bitmap. It keeps
the original vertical mirror caused by the old top-down copy/bottom-up bitmap
accessor. Original helper addresses are used only by the explicit oracle.

Main `1B9` sets the raw recording flag, filename prefix and DWORD counter.
Main `235` and `236` query this JS state. Prefix bounds/encoding follow the ABI.
No Boolean conversion changes the raw flag. After a successful present, JS
encodes a bottom-up 32-bit BMP and writes it through persistent storage. The
filename preserves the original prefix-directory/prefix-stem convention and
signed zero-padded counter, including DWORD wrap. Recording retains displayed
orientation independently of the screenshot bitmap contract.

Window command 40030 uses the completed JS frame, retains the author-mode gate,
and chooses the first free `cap%04d.bmp`. Cursor overlays retain their separate
window composition boundary. Capture/recording have explicit completion guards;
checkpoints save their state only between settled frames. Current checkpoints
are written and restored using the same unreleased contract.

`verify-native-screen-recording.mjs` compares setter/getter state and VM writes
against each original executable: SDK 11,323 comparisons/3,087 calls, Game
9,706/2,646. Browser tests compare asymmetric full-frame pixels, screenshot
orientation, BMP contents, signed filenames, menu capture and fresh World
continuation. Original D3D/GDI capture evidence remains in the test-only oracle;
normal capture calls no original view or graph traversal.
