# Native semantic catalog and engine registrations

Native meanings live once in
[semantics.mjs](../src/native/abi/semantics.mjs), indexed by table namespace and
numeric ID. Main, generic/MOT and the two particle namespaces remain separate.
The catalog contains 921 reviewed main meanings and 45/44/51 auxiliary meanings.
These are the union of the registered engines' recovered declarations, not a
list of functions enabled in every engine. Project descriptive names do not
claim to recover the compiler's original symbols.

The engine modules [2.6.1.74.mjs](../src/native/abi/2.6.1.74.mjs) and
[2.6.1.76.mjs](../src/native/abi/2.6.1.76.mjs) explicitly register their own slots,
signature differences, observations and evidence. They also own their existing
service behavior, capability, message, encoding and layout records. No engine is
selected or enabled by proximity to another version number.

| Engine   | Main slots | Recovered | Reserved noop | Constant zero | Unknown | Generic / particle v1 / v2 |
| -------- | ---------- | --------- | ------------- | ------------- | ------- | -------------------------- |
| 2.6.1.74 | 1009       | 785       | 82            | 19            | 123     | 45 / 44 / 51               |
| 2.6.1.76 | 1055       | 917       | 58            | 17            | 63      | 45 / 44 / 51               |

All 2,344 registered slots remain represented. Auxiliary generic entries have
their existing `recovered` status and particle entries their existing `declared`
status. Neither status establishes that a native body is implemented.

## Registration data

Each table has an explicit `count` and `slots` object. Its `recovered` and
`declared` lists bind only the listed IDs to catalog meanings. `reserved`,
`constant-zero` and `unknown` lists use distinct shared slot defaults. Unknown
slots have no semantic catalog entry of their own; even when another engine has
a meaning for that numeric ID, an unknown registration keeps its null name and
unrecovered signature. Unknown controls can still have independent observations.

Every ID from zero through `count - 1` must occur exactly once across these lists.
Lists contain sorted unique integers. A missing ID, overlap, invalid status,
out-of-range ID or a semantic binding absent from the catalog is an error.
Increasing a table count or adding a shared meaning never fills a registration
implicitly.

Optional grouped differences use explicit `ids` lists:

- `signatures` supplies `fields` from the structured signature. Fields replace
  the corresponding shared field; parameter arrays and result records are
  explicit replacements, not guessed type merges. Names, families and slot
  statuses cannot be changed through a signature difference.
- `observedArgumentWords`, `evidence` and `migrationReview` supply `value` records
  independently. Grouping identical values does not infer an observation from
  the declared argument count. If argument observations are present, they cover
  every slot, including explicitly empty observations.

Overlapping groups and malformed values fail validation. Recovered/declared
bindings require their engine's evidence. Review state, review reasons and
`resultWritten: null` remain distinct from observed booleans. Existing evidence
and migration decisions are preserved without turning an unsupported body into
an implementation.

For example, SDK main `0x38a` remains a noop with observed three-word calls and
an ignored argument list; the game's same slot is `emote.message524`. SDK
JavaScript slots retain their meanings while the game's corresponding slots
remain stubs. XML string output retains SDK CP932 versus game UTF-8. These are
explicit registration differences, not rules inferred from engine age.

## Resolution and consumers

[resolveNativeTables](../src/native/abi/tables.mjs) expands only the registration
data. [resolveABI](../src/native/abi/index.mjs) validates its plain data and the
complete resolved ABI. Only the two explicitly installed engine modules enter
the deeply frozen `NATIVE_ABIS` registry. Calling the resolver does not register
an engine; `nativeABI` and `abiForEngineVersion` still reject unregistered keys.

`nativeABI(profile).tables[table].entries` is a derived view, with one entry per
slot. The entry-level parameter/result/control fields are independently copied
projections of the resolved signature, so cloned ABIs still detect a divergent
mirror. The maintained data contains a single signature declaration. There is
no parallel full table or alternate reader.

`nativeCatalog`, the World runtime, MOT, math/geometry registrations, fixture
policies, comparison tools and the migration inventory consume this same
resolved view. Dispatch controls, stubs, unsupported diagnostics, explicit MOT
argument counts and scalar comparison policies retain their existing behavior.
Signature comparison tools accept resolved ABI JSON, not raw registration
descriptors. See [structured signatures](native-signatures.md).

Executable fingerprints and table addresses remain separately owned by each
entry in `NATIVE_EXE_PROFILES`. Sharing semantics does not make those binary
identities, memory layouts or private survey observations interchangeable.

## Historical evidence and verification

The offline ID survey found signature extensions at main `0x181` (four to five
words, between 2.6.1.67 and .74) and `0x358` (six to seven, between .23 and .37).
A shared semantic ID does not require a globally identical signature. Explicit
signature differences can represent such changes; the survey is not an
authorization to register the remaining contracts of those older engines. Both
currently registered engines still declare five and seven words respectively.
No old parameter types or missing meanings are inferred from the modern rows.
See [offline survey limits](native-abi-survey.md).

The public short tests need no private engine, compiler or survey output:

```sh
node --test tests/native-shared-abi.test.mjs tests/native-abi.test.mjs tests/native-signatures.test.mjs
```

They cover exact registration boundaries, unknown versus known slots, stubs,
encoding/result-write differences, independent derived ownership and ordinary
World runtime dispatch. The authored four/six-word resolver example verifies the
representation only; it does not register or dynamically compare an old engine.
