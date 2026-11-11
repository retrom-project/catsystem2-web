# Offline ABI survey

Run the extractor with Node 24 and GNU objdump available on PATH.

```sh
node scripts/extract-native-abi.mjs /path/to/engine.exe .local/candidate.json
node --test tests/native-abi-extraction.test.mjs
ABI_SURVEY_EXTENDED=1 ABI_SURVEY_FIXTURE_ROOT=/path/to/fixtures \
  node --test tests/native-abi-extraction.test.mjs
```

The extractor reads PE file bytes and version resources. Writable,
NULL-terminated code-pointer runs identify a main-table candidate. A unique
45-slot run and adjacent 44/51-slot runs identify generic and particle candidates.
Ambiguous structures retain `needs-review`. Wrapper section markers produce
`needs-unwrapped-sample` and stop before disassembly. The tool supplies no
unpacking or execution path. Reviewed engine addresses are used only by the
extended regression assertions.

Each slot records its handler address, alias group and bounded CFG evidence.
Instruction fingerprints retain constants and offsets, normalize image pointers,
and record short callee anchors and referenced ASCII strings. CFG traversal is
limited to 512 instructions and 4096 forward bytes. Indirect or external tail
branches remain incomplete. Pointer normalization loses global-data identity,
so matching results require semantic review.

Signature observations contain constant control-return sites and direct argv
reads in the initial basic block. Exact argument counts and types stay unknown.
The output is offline candidate evidence. Register reviewed per-version ABI
data through the existing ABI workflow after investigating unresolved entries.

The extended regression checks all four tables and every pointer against the
two reviewed private engine images. The default tests use authored PE bytes and
small disassembly fixtures. Game resources and survey measurements belong in
ignored local storage.

## Cross-version comparison

```sh
node scripts/compare-native-abi.mjs .local/source.json .local/reference.json .local/comparison.json
```

Whole-image SHA identity preserves reviewed IDs. Other automatic candidates
require a unique complete handler fingerprint with callee and string context.
Local body similarity with different context, shared aliases and bounded CFG
failures retain `needs-review`. Raw equal bytes can call different relocated
helpers. Unmatched entries also retain their review state, including possible
additions, deletions and renumbering.

For reviewed ABI declarations serialized as JSON, compare their structured
signatures separately:

```sh
node scripts/compare-native-abi.mjs --signatures .local/declared-source.json .local/declared-reference.json .local/signatures.json
```

These inputs have declared `tables` objects, rather than the binary extractor's
array of observations. The comparison preserves unknown semantic slots and
actual type/count/control differences, ignores description prose, and reports
differences in result-write knowledge. It does not register another engine or
infer types from argv offsets. See [native signatures](native-signatures.md).

## Numeric-ID stability observations

```sh
node scripts/native-id-stability.mjs .local/left.json .local/right.json .local/alignment.json
node --test tests/native-id-stability.test.mjs
```

The inputs may be existing extractor results or enriched offline observations
with `version`, `sourceSha256` and one `entries` record per contiguous main ID.
Enriched entries record `stub`, `prefixArgReadOffsets`, `controlCodes`,
`controlsComplete`, `boundedCFGComplete`, and optional `facts` containing
`importAPIs`, `strings` and `immediatePushes`. The producer must document its
bounds and unresolved paths in `limitations`; the comparison preserves them.
An import API uses `library!symbol`; library-name case is insignificant.

The tool compares same-ID observations and a global sequence alignment that
allows insertions and deletions. Equal numeric IDs are never a scoring feature.
The weighted Dice score uses argument reads (1), control codes (2), stub kinds
(2), imports (6), strings (6), and immediate pushes (1); each gap costs 60.
Both same-ID and best scores, a reproducible selected path, multiple optimal
paths, and pairs without shared features remain visible. CLI output binds the
input observation files by SHA-256 as well as retaining their declared image
identities.

These are candidate scores. Empty matching feature sets, partial argv reads,
repeated stubs, and even a unique optimal path do not establish semantic or
signature equivalence. Internal task-message constants can change without
native renumbering. Check handler bodies, message receivers and script call
shapes independently before accepting a mapping. Private inputs and raw
alignment reports belong in ignored local storage.

## Static script coverage

```sh
node scripts/survey-native-corpus.mjs .local/containers.json .local/corpus.json
```

The input is an array of records containing `work`, `path` and a provenance
`role`. The survey uses existing read-only KIF/KCS/FES/CST readers. It decodes
GCALL instructions without running the VM, separates main, MOT and versioned
particle namespaces, and records argument-word constants and dynamic operands.
FES parsing expands available includes and macros, then separates commands from
object methods. Existing command-prefix parsing is shared with `fes-audit.mjs`.
Counts represent static sites and work coverage. Encrypted containers, missing
includes and syntax failures remain visible in coverage records.

Keep original, prepared-reference, backup and translation-patch provenance
separate when aggregating results. A shared numeric ID across unregistered
versions requires independent handler evidence before sharing a semantic name.

Every cross-image candidate keeps `needs-review` for semantic and signature
validation. `candidateMatches` reports unique code-context pairs, while
`unresolvedMappings` counts slots without such a pair. `needsReview` also includes
paired candidates whose semantics remain unconfirmed.
CST condition-analysis failures are recorded per line. Other commands in the
same successfully decoded container remain in the static coverage result.
