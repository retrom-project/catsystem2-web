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

The fixed SDK 2.6.1.23 Main 12 is admitted for its initialized mode1 view and
positive finite distance. Its original Script supplies a real kcView through
`+0x74`; the selector reads kcView `+8` and chooses its separately constructed
draw manager. The x87 leaf writes that manager's near word at `+0xd8`, rather
than writing the kcView itself. It does not request a repaint. Actual Plane
mesh submissions consume the new value when a normal visibility change requests
the next render. Selection-failure fallback, other view modes and unreviewed
distance shapes remain protected. Current checkpoint state keeps the same word
in place; other SDK policies are unchanged.

`tests/native-sdk23-view-mesh.test.mjs` uses actual factory/VM calls and frozen
native COM vertex submissions at two near distances. It keeps those submission
observations separate from physical GPU evidence. Configured texture content and
alpha have their own COM-memory qualification in the Plane fixture.

SDK63 and SDK67 admit Main12 for the same positive finite, initialized mode1
shape, proved separately in each executable. Their true CRT, Settings/FileServer,
caps and View constructors create the attachment and manager; a real Main66
publishes a kind1 Top under the Main143-loaded Script. Main12 stores the exact
Float32 word at that manager's `+0xd8` and returns control2 without a result.
The own-build View queries and three distances are replayed by
`native-legacy-configured-view.test.mjs`, including eight independent cold
continuations per build. The new host attaches its own logical device before
restore: device endpoints are not checkpoint data. These query/store and
COM-memory observations do not prove GPU pixels, Stage presentation, other
distance shapes or GPU presentation. The configured mesh lifecycle is qualified
separately in `native-legacy-owned-collector.test.mjs`.

In SDK63 and SDK67, Main467 packs the mapped 64-byte XYZ/UV columns into
80-byte records for native Plane message80 (shared semantic message83).
The own registration code first constructs a candidate, then discards it if
the key already exists. Main83 explicitly unloads that model; the next Main467
can register a replacement. Normal Base deletion releases the model and its
private source buffers. The wrapper leaves each color DWORD unwritten; the
reviewed model consumer selects uniform white independently of those bytes.
Finite vertex records and an actual mode1 Plane are required. Missing,
out-of-grid and untextured-page sampling remain protected at drawing, while
unreviewed receiver and record shapes are protected before registration.

The configured replay uses real Top/Draw/Plane factories, Root logic and draw
phases, and the original View's COM submissions. It compares initialized texture
bytes, vertices, software raster state and eight cold continuations per build.
SDK67 Main115 is admitted here for copies from an owned bitmap to VRAM;
other destination handles still require their own qualification. COM memory
and successful virtual Present are distinct from physical GPU pixels or Stage
presentation; those scopes remain open.

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
