# Native input contracts

The input implementation uses the two frozen engine images in
[references.json](../references.json). It does not start either executable.
The reviewed regions execute in the shared original-engine process; browser
events supply window and device services.

| Engine              | InputTask constructor | Frame    | Message handler | Physical-device constructor | Window handler |
| ------------------- | --------------------- | -------- | --------------- | --------------------------- | -------------- |
| 2.6.1.74 / SDK 4.01 | 0x4C2C60              | 0x4C30B0 | 0x4C38F0        | 0x5C0830                    | 0x5C24E0       |
| 2.6.1.76 / game     | 0x5E69A0              | 0x5E6DF0 | 0x5E7680        | 0x70F560                    | 0x710F30       |

[NativeInput](../src/native/input.mjs) implements the task state, all original
input message branches and main 0x90..9A plus 0x11D/11E and 0x18B/18C. [Input controls](../src/native/input-control.mjs)
provide main 0x191/193/194. SDK message numbers at and above 37 are two lower
than the internal canonical numbers. Main wrappers first query input through
native task ID zero. A nested Top with a nonzero native ID can therefore fail
that original lookup; the emulator preserves this routing behavior.

Main 0x11D ORs all four physical-source queries, preserving their pulse consumption.
Main 0x11E resets active regions, previous coordinates and the cursor refresh
flag; it does not clear the device pulse table. Main 0x18B sets a CP932 cursor filename
and two packed 16-bit hotspots; 0x18C reads the task cursor-visible word through
the message payload, independently of the transport result. Mapped address zero
contains a filename and remains distinct from an unmapped/null source.

Every InputTask keeps its own 80-key captures, four-slot hold/repeat timers,
regions, text dialog, drag state, cursor timeout and warp. Region owners are
World identities; raw message boundaries translate native IDs in the receiver's
Top namespace. Region priority is signed, descending and stable. Duplicate
owners are allowed; removal and reprioritization affect the first match.
Press, release, repeat, hover, pointer activation and drag retain their separate
selection rules. A routed receiver's zero result consumes the event; an absent
route does not supply a fabricated result.

[Bindings](../src/native/input-bindings.mjs) hold the shared physical device's
80 × 4 sampled and live source masks. Each logical key has one repeat word shared
by all slots. Press updates both masks, release updates the live mask, and frame
completion copies live to sampled. A release can consequently remain visible
until the next sample. The 32-byte physical bitmap covers 256 virtual keys and
mouse codes; it is independent of the logical key masks. Author mode selects
whether the physical callbacks scan 32 or 80 logical definitions.

The script's joystick gate starts enabled, independently of the user's
`KEY/enable_joypad` preference. WinMain loads that preference after browser
bindings are constructed. Polling requires both gates; a later preference
change does not override an explicit script disable. Both gates are saved.

[NativeInputDevice](../src/native/input-device.mjs) constructs the original
physical device and window objects. Main input-device pointer queries return
that real object. Keyboard, mouse and wheel queues execute its original window
handler. Touch contacts execute original WM_TOUCH decoding and gesture code.
Joystick events enter the original joystick callback; browser Gamepad API values
supply the physical state. The device's native heap, queues and pointer identity
restore with the shared process. Each Top reads the same device in task order,
while retaining its own task state.

[Browser services](../src/native/input-browser.mjs) provide focus, polling,
pointer warp, text input and cursor display. Canvas positions enter the engine
in virtual coordinates, so this boundary performs a single identity conversion.
The browser's pointer-lock, OS cursor and modal prompt behavior remain platform
boundaries. Native pointer warp's original task-local coordinate assignment is
preserved separately. APP/touch is an original startup word, default zero, and
controls native touch enablement.

Input alpha masks sample the bitmap canvas rectangle through its offset-aware
color getter. Twenty-four-bit colors have no alpha and yield an empty mask;
32-bit colors set a bit for any nonzero alpha. The browser helper and the actual
native helper agree on canvas size, clipping and origin offsets. Cursor image
presentation has its own renderer gate and resource ownership. Explicit cursor
visibility retains the original uint32 word independently of auto-hide state.

Text entry retains the 256-byte CP932 buffer, including undecodable input bytes
when canceled. Status is zero while pending, one when accepted and two when
canceled. Confirmation uses the configured text input service. A pending dialog
cannot be checkpointed. The SDK's raw NULL cursor filename clears the cursor;
the game wrapper instead leaves a failed UTF16 conversion buffer uninitialized,
which remains an explicit diagnostic.

## Evidence

`scripts/verify-native-input.mjs FIXED_EXE IGNORED_REPORT` runs unchanged original
task constructors, handlers, region lists, routing, frame code, physical key
callbacks and main wrappers. Each engine passes 1,937 comparisons, including
complete state, output buffers, event packets and canvas alpha masks. Device,
renderer, dialog-thread, Base frame and task transport calls are explicit probe
boundaries.

`scripts/verify-native-input-control.mjs FIXED_DIRECTORY PROFILE IGNORED_REPORT`
passes 2,898 comparisons per engine for main 0x191/193/194 and the corresponding
input source, cursor and key-gate branches. Cursor pixels are a separate renderer
acceptance item.

The optional tests in `tests/native-input-device.test.mjs` use
`CATSYSTEM2_ENGINE_EXE` and `CATSYSTEM2_SDK_EXE`. They execute real device/window
construction, browser event queues, delayed release, touch contacts and gesture
polling, restore in a fresh process, then execute native destruction. Authored
public input, binding, control and World tests additionally verify independent
Top namespaces, captures and pending browser events after restore. These tests
do not establish equivalence with every physical controller or OS dialog.
