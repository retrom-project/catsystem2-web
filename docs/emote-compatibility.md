# M2 / E-mote compatibility

The product M2 path is JavaScript. `NativeWorld.m2` owns profiles, settings,
model documents and task instances; task 54, FES M2PLANE (type 33) and all 37
reviewed game natives use that owner. No M2 manager, native task suffix or
E-mote DLL is created. See [implementation and differential evidence](emote-js.md)
and [native packets](native-emote.md).

The SDK ABI retains its reviewed SimplePlane placeholder. It does not acquire
game M2 native IDs or an invented driver. ABI format and version selection are
unchanged. Other document/motion/metadata versions warn once with name,
version, SHA-256 and implementation, then use the same JS parser. Structural
bounds and explicit unsupported encodings/layer operations still apply.
The original driver binaries are oracle inputs only, not runtime assets.

The old wrapper and DLL device live under `oracle/` and are selected explicitly
by `M2OracleWorld`. [Original oracle evidence](emote-oracle.md) documents that
boundary. Private EXE/DLL/models are never published. Authored frozen fixtures
run publicly without them; fresh private regeneration skips when inputs are
absent.

StageRenderer owns the model target, integer fade mix and final composite.
Model/controller checkpoints rebuild derived GPU targets in a fresh World.
Unloading the task releases documents, uploaded textures and render targets;
shared documents stay alive while another task uses them. Audio supplies media
frames and sidecars through JS sound messages; no native lip buffer is borrowed.

Remaining original FES consumers can request an ordinary plane/motion prefix.
This is a **domain 7** projection of common fields only, removed in phase 7;
it contains no M2 state, driver pointer or model pixels. The shared renderer
still projects textures to FES/media consumers (domains 7/8). Its window setup
skips the old M2 manager and constructs only their common 3D view. These are
remaining domain dependencies, not an M2 fallback.

The accepted 384 MiB transitional process heap, 768 MiB checkpoint limit and
1024-entry JS log bound remain registered until phase 10. M2 models/textures
no longer allocate in that simulated heap. Live heap/performance measurements
are repeated at the phase-end gate.
