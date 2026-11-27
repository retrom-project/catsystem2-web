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

These inputs have resolved ABI `tables` objects, rather than raw registration
descriptors or the binary extractor's array of observations. The comparison preserves unknown semantic slots and
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
signature equivalence. The [shared semantic catalog](native-abi-data.md) uses
explicit reviewed engine registrations and signature differences; survey
similarity does not register an engine or enable an unknown slot. Internal task-message constants can change without
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
object methods. Its literal object inventory shares the standalone FES consumer's
pure declaration parser over the current owned raw DEFINE rows. It never evaluates
counts or OBJECT rows, constructs objects, or calls bank, SCRIPT or native handlers.
Rows containing string-bank placeholders or outside that standalone grammar retain
their reversible raw byte view in `unresolvedDefinitions`.

Literal type/name statistics describe the source as written; they do not establish
native type membership, runtime bank/SCRIPT results or native DEFINE support. In
particular, the normal native consumer's staged expansion and semicolon rules are
independent of the static standalone grammar. Existing command-prefix parsing is
shared with `fes-audit.mjs`. Counts represent static sites and work coverage.
Encrypted containers, missing includes and syntax failures remain visible in
coverage records.

Keep original, prepared-reference, backup and translation-patch provenance
separate when aggregating results. A shared numeric ID across unregistered
versions requires independent handler evidence before sharing a semantic name.

Every cross-image candidate keeps `needs-review` for semantic and signature
validation. `candidateMatches` reports unique code-context pairs, while
`unresolvedMappings` counts slots without such a pair. `needsReview` also includes
paired candidates whose semantics remain unconfirmed.
CST condition-analysis failures are recorded per line. Other commands in the
same successfully decoded container remain in the static coverage result.

## SDK 2.6.1.23 remaining scopes

The census at core `f8f770147ea31077ca0fd1e3e6e4a8eacee14704` joins the
historical classification to the resolved [current registration](../src/native/abi/2.6.1.23.mjs),
not its historical unknown count. It applies only to executable SHA-256
`9f3a5ad0ed22074420685f1e2a3bc92436d68289c7bac854d5f7d7331dc3ef67`.
Main has 57 reserved, 710 recovered, 17 constant-zero and 85 unknown slots;
Generic 45 and Particle 44/51 are registered. Registration alone does not
establish every receiver, argument shape or lifecycle.

The remaining 85 slots classify as 61 ordinary runtime, 21 desktop author/export
and three with insufficient receiver evidence (`457`, `682`, `688`). Their 85
original handler bodies are distinct. The selected CST corpus contains 16 call
sites with 14 distinct argument/result shapes, all in the desktop group. Absence
of a selected script reference does not establish that a slot is unreachable.

The ordinary group contains 27 bitmap/image/Plane, 16 Draw, nine text, three
AreaEffect, two Script accumulator and one each of camera, screen effect,
Particle and sound slots. The bitmap group includes the separate Plane mesh
entry `467`. Image/Draw ownership and data interfaces require their own
build's factories, raw message mapping, retained references and VM callers;
modern same-ID implementations are candidate contracts until those checks pass.

Entries `837`–`843` belong to the original kind-53 `kcTaskQzDebug` factory and
Win32 dialog receiver. They remain desktop scopes. Normal player routing misses
observed for other desktop wrappers establish only those argument/receiver
shapes; formatting may still occur before routing. Neither classification nor a
routing miss establishes an original whole-slot stub.

`442`/`443` operate on the real Script's unsigned accumulator at `+0x1e4`.
Its update follows Base and precedes VM execution while active. The original
second update input comes from host frame-pacer wait sampling. The observed-cooperative-wait SDK23 driver now supplies that independent raw
word through the whole dispatch. The reviewed Script shape is recovered;
Worlds without a qualified raw source retain unknown-value protection. No
Frame difference, elapsed time or constant substitutes for observed returns. The separate 88-byte Script diagnostic
dump omits this field; that export alone does not prove the GAME_SAVE reader.
Main `588` likewise keeps its established split: an active original manager
leaves the caller's result unwritten, while an absent manager has a defined zero
shape. The active branch is already reviewed original undefined behavior.

The historical 52 guarded shapes and six secondary items remain provenance,
not current residual totals. In particular, the KCDB resource-stage follow-up
has a later implementation receipt. Current ordinary guards still distinguish
RGB24 rightward aliasing, packed legacy text initialization and nonfinite vector
transforms; Main/Generic aliases share a body/shape review. Original undefined
inputs retain guards without new native probes. Raw per-slot records, source
pins, positive VM observations and receipt hashes stay in ignored local storage.
