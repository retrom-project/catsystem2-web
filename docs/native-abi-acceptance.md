# Native build acceptance

Use the complete original executable SHA-256 as the acceptance identity. Keep
the reported engine version, exact Core revision and each tested work's content
identity beside it. An executable reporting the same version with different
bytes needs its own table, receiver and layout review. Compare callable
behavior before reusing an implementation in another registration.

## Collect the evidence

Keep file paths, extracted scripts, original bodies and raw receipts in ignored
local storage. From the core checkout, extract the selected executable and any
same-version peers, then assemble a local acceptance manifest.

```sh
node scripts/extract-native-abi.mjs /path/to/original.exe .local/original.json
node scripts/collect-native-abi-acceptance.mjs .local/acceptance.json .local/acceptance-report.json
```

Paths in the manifest resolve from the current directory. The collector hashes
the executable staged for each work and checks the extractor and archive
digests. It uses the selected registration at the declared Core revision and
retains all four native tables. Use the actual entry executable for each work
when multiple mounts share a version label. See the extractor, signature
comparison and corpus commands for their independent review scope.
[Offline ABI survey](native-abi-survey.md)

| Manifest field      | Content                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`             | `executableSha256`, the local `survey` path and its `surveySha256`, the registered `profile`, and a full `coreRevision`.                                                                                                                                                                                                     |
| `alternates`        | Optional objects with `executableSha256`, `survey` and `surveySha256`. Each has the same reported version and a distinct digest. Keep a wrapper or incomplete survey visible with its original reason.                                                                                                                       |
| `works`             | At least one work with a unique `id`, its staged `executablePath`, exact `executableSha256`, optional full `contentIdentity`, and `containers`. Each container has a local `path`, the archive's actual `sha256`, a normalized `logicalPath` and its provenance `role`. Put the baseline first.                              |
| `callShapeEvidence` | Optional `path` and `sha256` for a static call survey with `scripts[].sha256` and `scripts[].sites`. Every matching site's PC, GCALL number and operand count must agree with the decoded script.                                                                                                                            |
| `receipts`          | Objects with a unique `id`, `kind`, `path`, `sha256` and `executableSha256`. Kinds are `original`, `vm`, `guard` and `product`. The three runtime kinds also need their full `coreRevision`. Product receipts identify an included `contentIdentity` and may list the `scripts` SHA-256 values exercised in the short scene. |
| `reviews`           | A `table`, `id`, observed `handlerVA`, `disposition`, `reason` and referenced `receipts` for each reviewed slot. Optional facts record the original argument order, exact widths and kinds, result writes, effects and unresolved branches.                                                                                  |
| `secondary`         | Reviews of FES commands and object types, task-message channels, layouts or other build-specific data. Give each review a `name`, `reason`, and matching `receipts`. The report includes the declared ABI data for comparison.                                                                                               |

For a guarded slot, use `reviews[].sdkScope` to record the boundary the
original evidence establishes. Keep each review's reason and receipts with
the slot and its observed call shapes.

| Scope                      | Evidence to record                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ordinary-runtime`         | The original exposes an ordinary operation. Record which operands, receivers, effects or VM behaviors still need implementation or verification.                |
| `original-undefined-input` | The original leaves the relevant result or inputs undefined. Identify the precise call shape and the observed failure, stale word or out-of-range access.       |
| `desktop-author-or-export` | The original hands off to an author tool or platform export capability. Record the receiver, platform action and signature.                                     |
| `unclassified-evidence`    | The original callable scope still lacks enough evidence for a classification. The collector uses this scope when a guarded slot has no explicit classification. |

Place individual guarded calls in `reviews[].guardedShapes`, including calls
to an implemented slot with an outstanding valid shape. Each entry has
`shape`, `sdkScope`, `reason` and `receipts` with original and guard
evidence. A guard on an undefined operand should leave the slot classified
as ordinary or unresolved when its valid calls still need review.

The report's `sdkCoverage` lists guarded slots, guarded shapes and the
admitted original stubs separately. An ordinary or unclassified guard at
either level keeps `ordinaryRuntime` incomplete. `no-identified-open-slot`
describes the reviewed scope. The separate `productReceiptsByWork` lists
product evidence for each included content identity. Runtime rejection
receipts establish the guard behavior. Product receipts establish the paths
exercised in the corresponding work.

GCALL scripts are grouped by the bytes of the decoded archive member and by
their table. FES scripts with identical member bytes can produce different
calls when include bytes differ. Retain the include digests and the block,
command, static object type and argument-token count for each context. A count
describes the observed syntax. Include `scene.int` to inventory CST scenes by
member SHA-256, decoded command and undecoded command line. Resolve dynamic
IDs, arguments, required objects and execution paths through the original
handler and the real VM.

When a registration records its original executable SHA-256, the collector
requires that digest before applying its script-version fallback. A content
member with a nonstandard particle header remains unresolved without
matching table-selection evidence.

Compare the exact-build works by script SHA-256 and call shape. Shared content
counts once while each work and archive reference remains listed. Review the
added scripts, changes to include contexts and new call shapes for each
additional work. A bundled copy of a script from the same executable can share
the existing native ABI evidence. Link product-visible changes in new scenes
to a short product receipt with its full content identity. The delta lists the
new script hashes with matching product receipts.

Across executable digests, the table diff supplies candidates. Reuse a shared
implementation or prior test only after original wrapper and consumer evidence
and a VM receipt establish the same behavior for the proposed scope. A wrapped
executable with unavailable tables remains an independent, unverified build.

## Review each function family

1. Use the native table namespace and numeric slot to identify the call. Group
   aliases that point to the same original address, including Particle v1/v2.
   Keep the caller signature and context for each alias.
2. Read the original wrapper and its callees. Establish argument count, order,
   access widths, address spaces, result writes and control codes. Check
   message receivers, conditional paths, memory bounds, object ownership and
   key FES or persistence layouts for the functions that use them.
3. Exercise the production VM with calls of the proved shapes. Include a
   representative positive case, the actual malformed or unsupported inputs
   that reach a guard, and assertions for control, result, memory, state or
   rendered output as applicable. Record the original call site when one is
   available. Use a real game save for short Retrom scenes that depend on
   graphics, media, menu input or persisted state.
4. Record `implemented` for a proved implementation and `original-stub` for a
   proved original stub, both with native and VM evidence. Record `guarded`
   with native and guard receipts and the specific remaining proof. Include
   protected SDK slots outside the selected script scope even if their first
   callers will come from another work.
5. Track product scenes, VM behavior, original evidence and admission counts
   independently. A previous receipt can be reused when its relevant
   declaration, implementation and input bytes still apply. A single game
   reaching its ending covers the visited scene and input paths in that game.

Keep shared meanings in the semantic catalog. Use a per-build declaration for
a demonstrated signature, arithmetic, message or layout difference. Leave
unproved paths guarded and include the reason in the report.
[Native semantic catalog](native-abi-data.md)
