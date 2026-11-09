# Native scalar math

All twenty main scalar operations in [scalar-math.mjs](../src/native/scalar-math.mjs)
execute JavaScript, selected by the current
ABI's semantic name. No EXE host is created for a scalar GCALL. Inputs and results
are raw 32-bit words, with adjacent arguments read from the VM frame when the
wrapper signature requires them. Each operation returns its declared control.

`32..40`, `141`, `18D`, `1CD`, `36A` and `36B` cover trigonometry, rounding,
absolute value, remainder, square root, power, angle conversion, triangle wave
and signed word packing/unpacking. `atan2` takes y then x. Degree conversions
round each multiply/divide to f32, using the f32 pi constant. Triangle wave uses
absolute phase/period, quarters and ordered f32 operations; the half-period
retains negative zero. Unpacking sign-extends low then high halves and writes
in that order, including identical, unaligned and overlapping VM destinations.
Zero is a valid VM address. An invalid destination raises a VM memory error;
a valid first destination remains written if the second write fails. Four
explicit invalid-address cases retain a separate oracle limitation: its VM
translator returns NULL, and the sandbox null page is writable, so it can
return control 2 after corrupting that page. JS deliberately rejects these
invalid VM writes. This is outside the 460 valid-input comparisons and is
asserted as an explicit boundary difference, not a passing equivalence case.

The contract is the normal script context, FPCW `0x007f`, MXCSR `0x1f80`.
Plugin changes to FPCW across calls are not reproduced by JS. The original
oracle regressions retain all eight masked precision/rounding configurations
and full x87/SIMD state, including a fresh World checkpoint with modified FPCW.
They live in `tests/oracle/native-scalar-math.test.mjs`, using the oracle-only
scalar facade, handler map and wrapper adapter. These files are absent from
the transitional product include list; the product adapter now owns only bounded
startup and the separately registered one-way view-state projection.

`tests/fixtures/scalar-cases.mjs` supplies 230 authored cases per ABI. They run
normal GCALL scripts in two independent Worlds. JS refuses to load an EXE; the
oracle calls the unmodified original table handler. The tests compare controls,
actual result writes/canaries, all VM regions, writable PE deltas, handles, task
metadata and events. CRT domain/NaN paths may call only the named TLS and
last-error OS services recorded in each fixture. These services do not replace
the arithmetic implementation. Every host trap is traced and validated.

Finite transcendental results have a fixed budget of one f32 ULP. Ceil, floor,
abs, integer operations, sqrt, angle conversion, remainder and triangle wave are
bit exact in this corpus. Signed zero, infinity, NaN sign/payload/quieting and
unrelated bytes are exact for every operation. No tolerance was widened.
Public tests use the checked-in oracle golden words and exact hashes of VM
bytes outside the declared floating result slot. Missing private EXEs produce
an explicit per-ABI skip in differential mode; strict full mode requires them.

Large-angle and remainder results also expose a limitation of the pinned
Unicorn oracle, not hardware x87 accuracy. Its FPREM/FPREM1 helpers perform
partial reductions with double arithmetic. CRT trigonometry at magnitude
2^63 and above first reduces by its extended 2*pi*2^61 constant, then evaluates
the reduced argument. Cancellation can differ greatly from direct `Math.sin`.
`nativeRemainder` reproduces this currently script-visible path, including the
partial-reduction steps, rather than widening the ULP limit. For example,
sin(f32(1e30)) writes `0xbf6919a5` on both pinned oracles. Hardware equivalence
for these extreme arguments is not established by this backend. The evidence
and instruction trace are retained in ignored `.local/phase3/` storage.

Run `npm run test:differential` with both reviewed EXEs, or `npm run test:js`
without private resources. Existing generic math cases remain independent too.
Reproduce the checked-in scalar golden with
`node scripts/capture-native-calculations.mjs --check scalar` (or `--write` after
reviewing an intentional change). The same tool handles each migrated family.
