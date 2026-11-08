# Matrix and vector wrappers

[The geometry adapter](../src/native/geometry.mjs) executes all nine original
main wrappers `0x15E..166` and their original D3DX/SSE helpers in the shared
engine process. It shares the current matrix and stack with
[main `0xCC..CF`](../src/native/matrix.mjs). No second matrix state or JavaScript
arithmetic approximation is introduced.

| ID        | Parameters                | Behavior                                                                     | Control |
| --------- | ------------------------- | ---------------------------------------------------------------------------- | ------- |
| 15E       | VM matrix                 | In-place inverse; an unmapped VM pointer selects the original current matrix | 2       |
| 15F       | VM destination, VM source | Four sequential 16-byte copies                                               | 2       |
| 160       | VM vector4                | In-place normalization                                                       | 2       |
| 161 / 162 | VM vector4, VM vector4    | In-place addition / subtraction                                              | 2       |
| 163 / 164 | VM vector4                | Length / squared length, returned as raw float bits                          | 1       |
| 165       | VM vector4, VM float      | In-place scale; the second argument is a pointer to a float                  | 2       |
| 166       | VM vector4, VM matrix4    | Four-component matrix transformation                                         | 2       |

A VM address of zero maps to the beginning of data memory. It does not select
the native current matrix. Only the original translator's unmapped-pointer
result invokes `15E`'s fallback. Other wrappers retain their original pointer
requirements. Overlapping operands follow the original instruction order;
`15F` is not a `memmove`. Singular inverses, zero-length vectors, infinities,
subnormal values, signed zero and NaN payloads remain original CPU behavior.
Missing arguments read the still-mapped adjacent GCALL words.

`scripts/verify-native-geometry.mjs` compares all nine full wrappers against
the adapter in each frozen engine: **1,162 calls and 6,098 comparisons per
profile**, **12,196 comparisons total**. Cases cover data, stack, shared and
extension-block addresses, overlapping/cross-region operands, raw exceptional
float words, output canaries, current native matrix state and independent
fresh-process continuation. Arithmetic helpers are not replaced; ordinary
CRT and operating-system service boundaries remain supplied by the shared
engine environment.

Four optional public tests check concrete scalar/vector/matrix results,
pointer-valued scale, sequential overlap, extended/shared addresses and
independent restored engine RAM. A full SDK World test additionally checks
runtime dispatch, immediate CPU-to-VM aliasing and caller writes before the first
restored call. These tests establish the wrapper and shared
memory contract; they do not measure renderer pixels or device precision.
