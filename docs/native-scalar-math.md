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

The modern 2.6.1.74 and 2.6.1.76 profiles now use the original physical IA32
scalar results. Each own PE's executable sections are checked byte for byte.
CRT/D3DX and thread data are initialized in the explicitly isolated PE host,
then that data seed is used with unmodified arithmetic/CRT code on the physical
CPU. Only the named TLS, last-error and pointer-encoding platform services are
supplied. This does not claim a physical WinMain or Windows startup sample.
FPCW and MXCSR are checked before and after every physical call.

The physical corpus contains 222 Main inputs and 233 Generic inputs per build,
including 52 directed raw-NaN and interpolation endpoint extensions. Complete
own-wrapper bytes, argument conversion and exact callee targets bridge the 19
common scalar functions to Main and both Particle tables. Current real KCS
checks those functions through each table, including control/result words,
complete caller/owner state, and independent cold interpreter continuation.
Wrappers read a fixed number of argv words independently of the GCALL-declared
length. Mapped zero/short frames and ignored tail words are accepted; actual
unmapped reads remain diagnostic. This evidence covers the listed finite cases;
other Generic and Particle functions remain a separate acceptance scope.

Seven saved Main observations per build expose exact limitations of the pinned
Unicorn backend: large-angle reduction and a signed-zero remainder. The old
raw observations remain archived. `scalar-backend-calibration.json` identifies
each own PE, operation, raw argument vector, verified alias, old backend word
and independent physical word, with source hashes and FP context. The private
capture tool first requires the raw backend observation to match its saved
record, then selects the separately observed physical result for that exact
input. Other inputs still compare directly; no NaN or large-value class is
excluded. For example, sin(f32(1e30)) is physically `0xbf76d1a8`; the old
backend's `0xbf6919a5` is retained as backend evidence and is not a runtime
contract. `nativeRemainder` remains an explicitly scoped older backend helper;
modern remainder and triangle-wave dispatch use the proven physical semantics.

The fixed 2.6.1.23 profile uses the physical x86 results for sine, cosine and
tangent after the original CRT initializer selects SSE2. Above each routine's
small-angle SSE2 branch, the original falls back to the x87 range reduction.
The Core applies the full extended CRT period when necessary and reduces with
the x87 processor's 66-bit pi constant. Main 50–52, Generic 1–3, both Particle
6–8 aliases and vector rotation use the same reduction. Physical x86 also
confirms the quiet NaN word for a signaling power base raised to signed zero.

Run `npm run test:differential` with both reviewed EXEs, or `npm run test:js`
without private resources. Existing generic math cases remain independent too.
Reproduce the checked-in scalar golden with
`node scripts/capture-native-calculations.mjs --check scalar` (or `--write` after
reviewing an intentional change). The same tool handles each migrated family.

The fixed SDK23 `9f3a5ad0…` normal-host bridge in
`sdk23-numeric-memory.test.mjs` supplements the existing body/calibration corpus.
Main54/57/62/63/64/397 run through an actual Main143-loaded Script with the
qualified CRT/FileServer/controller Root. Finite acos, abs, degree/radian,
integer-abs and ordered y/x atan2 results feed native variable stores, expression
reads and later formatted strings. Negative angles, signed-zero abs and zero
unit conversions are included. Complete result words, output spans and canaries
are exact for these finite inputs, including four independent current cold
continuations and source-format overwrite before later consumption.

This 14-target/30-GCALL bridge does not repeat the large scalar matrices or
extend the existing special-value, plugin FPCW or arbitrary numeric-domain
qualification. No arithmetic implementation or ABI registration changed.
