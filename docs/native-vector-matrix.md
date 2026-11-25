# Matrix and vector calculations

Main `0xCC..CF` and `0x15E..166` are synchronous JavaScript operations in
[`matrix.mjs`](../src/native/matrix.mjs) and
[`geometry.mjs`](../src/native/geometry.mjs). They use no EXE or transitional calls.
The corresponding admitted Generic calculations use the shared word-level helpers.
Version policy preserves each proved build's arithmetic and copy order.

| ID        | Parameters                | Behavior                                               | Control |
| --------- | ------------------------- | ------------------------------------------------------ | ------- |
| CC        | matrix, x/y/z radians     | Row-vector matrix, postmultiply X then Y then Z        | 2       |
| CD / CE   | matrix, x/y/z             | Postmultiply translation / scale                       | 2       |
| CF        | matrix                    | Identity                                               | 2       |
| 15E       | matrix                    | In-place inverse; singular inputs remain unchanged     | 2       |
| 15F       | destination, source       | Four sequential 16-byte copies                         | 2       |
| 160       | vector4                   | Normalize with the proved per-version SIMD/scalar path | 2       |
| 161 / 162 | destination, source       | Sequential component addition / subtraction            | 2       |
| 163 / 164 | vector4                   | Length / squared length as raw f32 bits                | 1       |
| 165       | vector4, pointer to float | In-place scale                                         | 2       |
| 166       | vector4, matrix4          | Four-component row-vector transform                    | 2       |

Address zero is valid VM memory. Only an unmapped matrix address selects the
World-owned current matrix. Its initial 64 bytes are zero, as observed in both
fresh original images. World checkpoints own and restore these bytes independently;
there is no second mutable current-matrix state in the product. The original global
references belong to the migrated matrix helpers; renderer calls with explicit
matrix storage do not consume this fallback. No PE projection is required here.

Copies and add/subtract retain forward instruction ordering, including overlapping
operands. Modern copies use four sequential 16-byte blocks; older build policies
can select DWORD copies. Raw SSE arithmetic preserves its destination/source NaN
selection. Component rotations retain an untouched axis word without quieting an
sNaN, and translation/scaling read each aliased component after the previous write.

The fixed 2.6.1.74 and 2.6.1.76 builds execute their own CRT CPU and D3DX
initializers before physical IA32 measurements. The initialized SIMD dispatch,
wrapper bytes and exact callee targets are retained separately per PE. Original
code sections remain byte-identical; initialized data/thread state is an explicit
seed and TLS/error services are supplied boundaries. This is not a physical
WinMain/Windows startup claim. The Core uses the measured SSE matrix product,
reciprocal refinement, inverse, normalization and paired vector transform order.
An inverse can differ from the mathematical integer result by an f32 step because
that is the native reciprocal result; cold World tests retain those exact words.
On the modern SIMD path, a zero or underflowed squared vector length propagates
the original indefinite NaN words through reciprocal refinement; it is not
replaced by a fabricated zero vector.

Direct D3DX FSINCOS and the scalar CRT reduction are distinct paths. Outside the
hardware FSINCOS range, physical execution retains the input cosine word and
stores the x87 indefinite on the empty sine pop. Older Unicorn observations of
that pop and its approximate reciprocal operations remain backend evidence.
The current private adapter performs the own initializers with an explicitly
bounded host feature service. Nine exact inputs per build then require physical
calibration; each raw initialized-backend result must still match its archived
record before the separately observed physical words are selected. No large-value
or NaN class is excluded and no tolerance is widened. Plugin-modified FP contexts
remain outside this normal PC24/MXCSR1f80 proof.

The fixed 2.6.1.23 Main 662 and Generic 43/44 scalar rotations reduce
large finite angles with the physical x87 66-bit pi constant. Yaw, pitch and
roll enter the instruction as float32 half angles. The physical tests cover
the smallest subnormals, values around the normal boundary, signed inputs
and large finite angles up to the direct FSINCOS range. The rejected
nonfinite and out-of-range shapes retain their existing validation.

[`geometry-cases.mjs`](../tests/fixtures/geometry-cases.mjs) contains 92 authored
GCALL cases per ABI: current and explicit matrices, fractional and singular inputs,
exceptional vectors, aliases, unaligned copies, shared and extension storage.
Every declared f32 output uses 1 ULP, atol=rtol=0; all other memory, controls,
handles and task state compare exactly. No tolerance was enlarged to pass samples.
The oracle adapter observes original current-matrix RAM as semantic state and keeps
raw projected PE write evidence; all other PE writes remain exact comparisons.
Public golden fixtures retain every compared f32 word explicitly and exact hashes
for the remaining bytes. Public World checkpoint tests reject EXE initialization.

The old facades and exhaustive original-only verifier remain under `oracle/` and
`scripts/verify-native-{matrices,geometry}.mjs` for CPU evidence. Their agreement with
the original code is separate from the independent JS differential lane.

Main662 in each fixed modern PE writes a complete 64-byte matrix from three
float32 yaw/pitch/roll words. Its initialized dispatch selects the SIMD path;
the older scalar-copy capture is retained as historical evidence. Main662 has
its own physical samples rather than an inferred Generic alias.

The modern Generic group has 211 physical vectors per PE: complete local,
shared, heap and current-matrix bytes, including raw NaNs, ordered overlaps,
actual VM argv pointers, mapped zero/short frames, ignored tail words, argument
frame/target aliases and extreme angles. Thirteen Main wrappers have exact own
reachable-body/callee bridges; the existing 92 Main inputs and four Main662
samples are independently physical too. Current real KCS tests compare full
caller/owner state and independent cold continuations. A cold authored MOT
invocation reseeds its mapped argv words while retaining operand/object state.
World tests use a fixed clock and preserve consistent logical backing identities.
These are authored valid SDK inputs, not a claim of an actual game scene or of
completion for the remaining auxiliary functions.
