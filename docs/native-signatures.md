# Native signature declarations

Registered ABI entries use structured parameter and result records. The records
describe reviewed knowledge; they do not coerce VM words, decode strings, choose
an implementation, or recover a missing signature. Engine and ABI identifiers
remain unchanged.

```js
{
  argumentWords: 4,
  parameters: [
    {
      name: 'destination',
      type: {
        kind: 'pointer',
        addressSpace: 'vm',
        direction: 'out',
        target: { kind: 'integer', bits: 8, signed: false },
      },
      description: 'byte* destination',
    },
    // The other three file.read parameters are omitted here.
  ],
  result: {
    kind: 'integer',
    bits: 32,
    signed: false,
    unit: 'byte-count',
    description: 'u32 bytes',
  },
  controlCodes: [1],
  resultWritten: null,
  review: 'needs-review',
}
```

`argumentWords` remains the explicit count from the declaration. It is not
derived from a label, numeric width, observed call site, or unknown parameter
list. A 16-bit value still occupies one 32-bit GCALL word. Fixed parameter lists
preserve their order. Each parameter has a name, structured `type`, and the
original description.

The parameter states are distinct:

| Value                                         | Meaning                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `null`                                        | Parameter types/list remain unknown. The signature retains its review state.  |
| `{ kind: 'ignored', description: 'ignored' }` | The handler ignores arguments; this is not a fixed zero-argument contract.    |
| `[]`                                          | An explicitly declared empty parameter list.                                  |
| An array of records                           | Declared parameters, including explicit variadic placeholders where recorded. |

Ignored and unknown lists retain `argumentWords: null`. A variadic placeholder
uses `kind: 'variadic'`, a `role` of `format-arguments` or `ignored-arguments`,
and an explicit element type. Its presence does not invent a new argument count
or change the existing MOT debug-call exception.

## Types and uncertainty

| Kind                                   | Relevant fields and boundary                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bits`                                 | Raw 32-bit word; an optional `initialization: 'uninitialized'` preserves that fact. It is distinct from an unsigned numeric value. |
| `integer`                              | `bits` and `signed`; reviewed byte-count/offset or codec-dependent units remain explicit.                                          |
| `float`                                | A 32-bit floating value. The VM still transports its word bits.                                                                    |
| `boolean`, `void`                      | Conditional availability or suspension annotations remain separate from actual control codes and result-write knowledge.           |
| `pointer`                              | `addressSpace` (`vm`, `native`, `pe`, `unknown`), `direction` (`in`, `out`, `inout`, `unknown`), and structured `target`.          |
| `handle`                               | An explicit `handleKind` and known/unknown ownership. Borrowed ownership stays borrowed; other handles are not assumed owned.      |
| `object-id`                            | `objectKind`, including explicit task identifiers or `unknown`; this is not a GCALL native-function number.                        |
| `character`, `format-string`, `record` | Pointee character encoding or record identity; unknown encoding/layout is not inferred from a parameter name.                      |
| `union`                                | Explicit alternatives, such as a handle or native pointer. Pointer spaces are not silently merged.                                 |
| `unknown`, `ignored`                   | Explicit missing knowledge or intentionally ignored values, including variadic elements.                                           |

Descriptions preserve source vocabulary but do not serve as a second type
reader. Unspecified pointer direction, encoding, handle kind, and pointee types
stay `unknown`. A parameter named `source`, `destination`, or `inOutDefault` is
insufficient evidence for access direction. The type record does not impose a
universal null-address policy.

For example, raw string-copy inputs and outputs remain byte sequences, not
implicitly CP932 or UTF-8. `string.append` actually reads and writes its
destination, so it is `inout`. `xml.string` only writes a found node and leaves
the default buffer unchanged when absent: its destination is `out` with
`writePolicy: 'conditional'`. That is not a read of the default buffer. Its
encoding remains CP932 for the SDK ABI and UTF-8 for the game ABI. UTF-8
diagnostic inputs retain the native permissive walker annotation; metadata does
not introduce strict decoding.

`resultWritten: null` remains unknown, not false. A typed result and a control
code of 1 or 3 do not by themselves establish that a handler wrote that result.
Uninitialized words, conditional results, output-buffer writes and suspension
retain their independent evidence.

## Consumers and comparison

`validateNativeSignature` validates the current structured records.
`validateABI` also checks that the entry-level catalog fields and nested
signature describe the same contract. Both remain ordinary deeply frozen data.
The public catalog exposes the explicit `argumentWords`; MOT uses that count
instead of deriving it from parameter descriptions. Scalar differential
fixtures identify float32 results by `kind` and `bits`, preserving their existing
case matrix and precision bounds.

`nativeSignatureDifferences` ignores descriptions and review prose, while
comparing counts, parameter/result structure, controls and result-write
knowledge. A `resultWritten` difference between `null` and a boolean can be a
difference in recovered knowledge rather than a proved behavioral change.

The eight reviewed lexical differences in main IDs
`06/1B/1C/1E/1F/26/27/31` normalize their known types in place. Word identity
uses raw bits32, allocation/free use VM addresses, and the reviewed read/write
and string operations retain byte-count or byte-offset units. Other pointer
spaces, unknown facts and actual per-version encodings remain distinct.

The binary extractor's `handler.signature` is a different static-observation
record: prefix argv reads, bounded control-return sites and unknown precise
types. It is not converted into an exact ABI signature automatically. See
[the offline survey tools](native-abi-survey.md).
