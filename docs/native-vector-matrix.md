# Matrix and vector calculations

Main `0xCC..CF` and `0x15E..166` are synchronous JavaScript operations in
[`matrix.mjs`](../src/native/matrix.mjs) and
[`geometry.mjs`](../src/native/geometry.mjs). They use no EXE or transitional calls.
The existing generic motion calculations are unchanged.

| ID        | Parameters                | Behavior                                                   | Control |
| --------- | ------------------------- | ---------------------------------------------------------- | ------- |
| CC        | matrix, x/y/z radians     | Row-vector matrix, postmultiply X then Y then Z            | 2       |
| CD / CE   | matrix, x/y/z             | Postmultiply translation / scale                           | 2       |
| CF        | matrix                    | Identity                                                   | 2       |
| 15E       | matrix                    | In-place inverse; singular inputs remain unchanged         | 2       |
| 15F       | destination, source       | Four sequential 16-byte copies                             | 2       |
| 160       | vector4                   | Normalize; squared length at or below FLT_MIN becomes zero | 2       |
| 161 / 162 | destination, source       | Sequential component addition / subtraction                | 2       |
| 163 / 164 | vector4                   | Length / squared length as raw f32 bits                    | 1       |
| 165       | vector4, pointer to float | In-place scale                                             | 2       |
| 166       | vector4, matrix4          | Four-component row-vector transform                        | 2       |

Address zero is valid VM memory. Only an unmapped matrix address selects the
World-owned current matrix. Its initial 64 bytes are zero, as observed in both
fresh original images. World checkpoints own and restore these bytes independently;
there is no second mutable current-matrix state in the product. The original global
references belong to the migrated matrix helpers; renderer calls with explicit
matrix storage do not consume this fallback. No PE projection is required here.

Copies and add/subtract retain forward instruction ordering, including overlapping
operands. Float32 storage and the normal x87 PC=24 intermediate rounding points
are explicit in [`calculation-math.mjs`](../src/native/calculation-math.mjs).
D3DX rotation uses direct FSINCOS: for finite magnitudes at least 2^63, the pinned
oracle leaves the argument as cosine and reads zero on its second stack pop.
This observed backend behavior differs from the scalar CRT reduction path and is
preserved for the canonical fresh FP state. Outside the FSINCOS input range, an
empty-stack pop can expose prior popped register contents in the oracle; reproducing
that undefined cross-call residue remains `needs-review`. The differential adapter
resets the complete fresh FP state for each authored input and does not claim to
cover that residue. This is not a hardware accuracy claim. Plugin-modified precision state remains outside the approved contract.

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
