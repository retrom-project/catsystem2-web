# FES configuration

`NativeFESConfiguration` is the shared FES `getconf` / `setconf` service. It uses the live `NativeConfiguration` blocks and named fields, so main KCS natives and FES menus modify the same state. `EngineHost` and the native-world facade route through this service. There is no separate menu settings object.

The frozen SDK engine has 43 getter keys and 42 setter keys; the frozen game engine adds nine keys, giving 52 and 51 respectively. `iswindow` is read-only. Names are case-sensitive. Both executables recognize `wndframe`; the manual's `wndfram` spelling is not an alias. Unknown getters leave the destination unchanged. Unknown setters still execute the original dirty/volume-update epilogue after the required arguments have parsed.

`font` and `ruby` read and write the FES string bank, while other fields use numeric banks. The SDK stores these strings in CP932 and the newer game stores UTF-16LE. `fshadow` clamps only its upper index to two; element two aliases `fontweight`. The preserved lower-index behavior accesses the adjoining font backing. Unsafe accesses beyond the recovered backing raise a diagnostic. `play` indexes the sum of its two extras. `sysplay` checks that sum against 48 but uses its first extra as the array index, matching both original executables.

Setting `screen` enqueues event 21 in the SDK and event 18 in the newer game. It does not immediately change `screen.fullscreen`. Valid UI-language changes enqueue event 43 only when the selection changes; valid main-text language assignments enqueue event 44 even when unchanged. Invalid subtitle language assignments become `0xffffffff` and do not emit an event. The world/platform service owns handling these events.

`NativeM2Configuration` models the distinct Emote configuration manager: six flags over all loaded models, interleave, and two maps over registered parts. Unknown part setters do not create entries. Inertia levels clamp to 0–200; enabled values remain raw words. Reset preserves the loaded-model and registered-part sets. An absent manager produces no FES writes. `m2_getconf` writes the local 512-entry bank. Its per-part commands require the third argument. The browser must supply this service from the actual initialized Emote manager; requesting a field does not initialize one.

The maintained oracle executes SDK handlers `616610` / `617310` and game handlers `77CDB0` / `77DD20`, including the original dirty flag and derived-volume code. It replaces only parser, integer-expression, bank and event boundaries. The game M2 handlers `786970` / `786E50`, actual RB-tree traversal, string construction, setters, reset and local-bank bounds execute against authored trees. The public fixture contains 326 configuration cases and 165 M2 cases, authored inputs and state digests. It contains no engine or game assets.

Regenerate private observations with `scripts/native-fes-config-oracle.mjs --exe <frozen executable> --output <ignored observation.json>`. The script verifies the frozen executable's SHA-256 and changes the DLL header bit only in its in-memory analysis image. Run public differential tests with `node --test tests/native-fes-config.test.mjs`.

This validates the configuration handlers and their integration contracts. Whole-engine startup, Emote loading, platform event handling and preference persistence have separate acceptance checks.
