# Resource names and comma fields

Main natives `256` and `388` use the engine's narrow-byte comma splitter.
[The implementation](../src/native/resource-selection.mjs) preserves CP932,
UTF-8 and invalid byte sequences without a text conversion. Commas separate
fields, empty fields disappear, and neither quotes nor parentheses group fields.
Spaces remain part of a field. The first NUL terminates the input.

| ID  | Arguments                              | Control and result                 |
| --- | -------------------------------------- | ---------------------------------- |
| 256 | Formatted source, VM destination       | 1, whether a base field was copied |
| 388 | VM input/output, formatted replacement | 2, no result                       |

`256` copies the first nonempty field with one NUL. An empty selection returns
zero and preserves the destination. The shared resource-selection helper also
returns each subsequent field's first byte, sign-extended into a word. These
selectors are character bytes, including negative values, rather than parsed
decimal numbers. Source formatting finishes before the destination is written,
including when their memory overlaps.

`388` splits both the previous destination and the formatted replacement.
A replacement field containing exactly `@` inherits the previous field at that
index; a missing previous field supplies `0`. Other fields replace that position.
The result joins the replacement fields with commas and appends one NUL, without
clearing unrelated destination bytes. Both sources are captured before writing
the result, preserving overlapping source/destination behavior.

VM address zero remains valid mapped storage. Invalid mapped writes and inputs
exceeding the original unchecked scratch capacities produce explicit errors;
they do not become successful truncation. `256` has a 256-byte split buffer and
64 selector slots; `388` has a 2,048-byte split buffer.

## Verification

`scripts/verify-native-comma-fields.mjs` runs **970 complete wrappers and
276 original resource-selector helper calls per profile**, with **7,332
comparisons per profile**, **14,664 total**. The original formatter, comma
splitter, selector extraction and VM address translation execute from each
frozen engine. Controls, return words, full mapped VM memory, destination
padding and helper scratch-output canaries are compared.

Inputs cover all 256 possible selector-leading bytes, collapsed comma runs,
empty fields, spaces, quotes, parentheses, exact `@`, raw CP932/UTF-8/invalid
bytes, embedded NUL, percent formatting, four VM memory regions, overlapping
inputs and original-capacity boundaries. Public tests also cover fresh-World
restore and independent mutation of restored shared memory. These interfaces
do not establish completion of the image/resource loaders that consume their
results.
