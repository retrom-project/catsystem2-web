# JS-owned view geometry

Main `8`, `C`, `2E3`, `2E4` and `313` dispatch by ABI semantic name to synchronous
JavaScript in [`view-geometry.mjs`](../src/native/view-geometry.mjs). Calling them
never loads an EXE. NativeGraphics and NativeView own dimensions, raw camera word,
device offsets/scale, virtual ratios, displacement, activity and drawing rectangle.
World checkpoints retain that state, including NaN payloads and signed zero.

Dimensions write width then height. Drawing rectangles write x/y/width/height;
subtractions wrap as DWORDs. Inactive views use the configured current screen size.
Border queries clear Y then X, write truncated offsets when active, double X then
Y, and transform X before reading Y. Exact and partial VM aliases therefore see
sequential writes. Zero is a valid VM address; shared and extension blocks work.

Full-position mode 0 uses the drawing rectangle bottom plus the truncated device Y
offset (current height when inactive), mode 1 uses full height, and mode 2 writes
configured virtual height without conversion. Other modes clear X and leave Y.
Screen conversion retains f32 subtraction/multiplication and signed x86 truncation,
with INT_MIN for nonfinite or out-of-range conversion. All five calls return control
2 without writing the separate native result word.

During migration, the injected `syncViewGeometry` capability in
[`oracle/transitional-exe.mjs`](../oracle/transitional-exe.mjs) projects JS state
one way into the original renderer records. NativeGraphics setters and renderer
synchronization invoke it only after that renderer exists. It writes camera, virtual
size, offsets, scale, ratios and clipping rectangle; it never reads PE values back.
The inventory group `js-view-to-exe-renderer-projection` owns this temporary domain-6
dependency. Delete it with the EXE renderer in phase 6. Other renderer state, device
initialization and draw commands remain in their own migration domains.

Authored GCALL cases in `view-rectangle-cases.mjs` compare whole VM regions and
semantic view state exactly in both ABIs, through original table handlers and real
coordinate helpers. The only platform geometry boundary is the shared USER32 RECT
service, separately measured against Wine. All other calls fail the harness gate.
Public golden fixtures run without private files. Existing World tests prove raw
camera restoration, live PE projection and independence of a fresh World; explicit
PE corruption cannot change JS query results. Original-only facades and exhaustive
CPU probes remain in `oracle/` and `scripts/verify-native-view-geometry.mjs`.
