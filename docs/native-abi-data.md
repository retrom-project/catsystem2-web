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
| 2.6.1.74 | 1009       | 804       | 82            | 19            | 104     | 45 / 44 / 51               |
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

## SDK message-wait registration

SDK main `0x47` (`task.waitMessage`) is explicitly recovered from its own
`0x5291e0` wrapper. It converts its single VM address argument through
`0x8a6910`, registers the resulting buffer through `0x8a6b30` on the mapped
Script task's VM at task `+0x70`, and immediately returns control `4`. The
Game's corresponding wrapper and helpers were checked independently.

The ordinary World producer's `240` is the address of a 16-byte VM destination,
not a message ID. This normal mapped-VM registration uses the accepted shared
JS VM protocol: a delivered four-word message writes that destination, pushes
`1` and resumes; an idle tick pushes `0` and resumes without writing the buffer.
The SDK's own static evidence closes address conversion, registration and the
immediate control return. Its original downstream copy/push/resume loop was
not independently read for this recovery. Unproved pointer subfields and
`resultWritten: null` remain unchanged, as do every other slot and the central
unknown-admission guard.

## SDK synchronous script-message registration

SDK main `0x45` (`task.send`) is explicitly recovered for normal registered
sender and receiver tasks from its own `0x529150` wrapper and complete
`0x5d8f60` bank selector. It takes four words: target, message, wParam and lParam.
Its Script message170 uses the registered kind12 mapping to canonical172;
the Game's independently reviewed wrapper sends172 and calls `0x728ab0`.
These are separate from the drawing-message mapping.

Both wrappers clear the VM output word, send the four-word packet with flags1,
conditionally restore the caller's bank, then copy the host-return scratch word
to the VM output and return control1. Their shared `resultWritten` field is
therefore `true`; all other parameter types, word widths, review and result
fields remain unchanged. The selector's own zero/one return is discarded: it
selects the existing receiver-keyed bank entry, preserving the prior selection
on a missing entry, and does not supply the message result. In the normal World
regression, a receiver that halts returns zero while the caller's successful
bank selection returns one; the caller VM then reads its own private word11,
with the receiver's private word22 preserved.

This recovery reuses the accepted host transport and valid compiler-call
contract. It does not establish foreign or uninitialized context, unregistered
target, unwritten transport scratch, native cookie failure or invalid-memory
behavior. Other unknown slots remain centrally blocked.

## SDK retained-drawing family registrations

SDK main256,257,258,260,263 and657 are explicitly recovered from their own
complete wrappers, with the Game wrappers checked separately. The existing
kind15 message mapping adds5 for SDK commands; it is not an admission rule for
adjacent native IDs.

| ID  | Existing shared operation | Words | SDK / Game raw message | Control | VM output written |
| --- | ------------------------- | ----- | ---------------------- | ------- | ----------------- |
| 256 | draw.initialize           | 3     | 0x112 / 0x117          | 2       | false             |
| 257 | draw.addBitmap            | 13    | 0x113 / 0x118          | 2       | false             |
| 258 | draw.remove               | 2     | 0x114 / 0x119          | 2       | false             |
| 260 | draw.setOutputOffset      | 3     | 0x116 / 0x11b          | 2       | false             |
| 263 | draw.setEntryShown        | 3     | 0x11a / 0x11f          | 2       | false             |
| 657 | draw.entryBitmap          | 2     | 0x12e / 0x133          | 1       | true              |

The shared operation and parameter names are corrected against the accepted
receiver:256 initializes width and height,260 sets signed output x/y offsets,
263 changes the keyed entry shown flag, and657 returns its entry bitmap.
These are corrections to common metadata, with no new business behavior or
per-version implementation branch.

The first five wrappers ignore message-out scratch and leave the VM output
untouched.657 clears a separate local word, passes its address in lParam, and
copies that local to the VM output after dispatch. Both wrappers establish its
shared resultWritten=true; task.send69 remains true and other signature types,
review fields and Game admissions are unchanged.

The addBitmap wrapper uses a zeroed60-byte temporary. Nonzero bitmap input is
converted by each engine's own first-DWORD getter; zero input bypasses it.
Seven transform words retain their bits. Alpha remains an unsigned32-bit
parameter, with the wrapper clamping it to255; it is not a restricted u8 input.
The owner member-view getters differ by0x21c/0x41c, but the concrete null-output
view and60-byte fill paths both produce the same zeroed temporary. This internal
layout difference needs no additional JavaScript profile business branch.

Normal World regressions keep the original render-source aliases, frame state,
VM bytes, two-Top task routing, auxiliary bitmap ownership and fresh-World
assertions. Only these six SDK slots are admitted:259,261,264 and all other
unknown slots remain blocked. This does not establish arbitrary invalid-memory,
foreign-context, cookie-failure or general CPU/memset behavior.

## SDK drawing flag registrations

SDK main262 and main534 are explicitly recovered from their own complete
wrappers, independently of the Game. Each takes two VM words, returns control
`2` and writes no VM value. The existing SDK message registration maps raw
messages281/299 to canonical286/304; the Game independently sends286/304.
No signature override or profile-specific implementation branch is needed.

The common descriptive names are `draw.setRasterEnabled(task, enabled)` and
`draw.setDirty(task, dirty)`. Message286 sets the drawing task's pending/enabled
flags from the second word's nonzero value and marks it dirty only when nonzero;
zero does not clear an existing dirty flag. Message304 changes only the dirty
flag. Both flag parameters remain full 32-bit words, without a boolean type,
0/1 restriction or clamp. Task handle kind and ownership remain unknown.
The ordinary World tests exercise the real kind15 receiver and native-ID
transport in both profiles with zero and a nonzero high-bit word. This recovery
does not establish original rendering pixels or any other drawing slot.

## SDK FES surface and save-object bindings

SDK main449 (`fes.bindSurface`) and main451 (`fes.setSaveObject`) are explicitly
recovered from their own complete wrappers, independently of the Game. Each
reads two VM words, returns control `2` and writes no VM result. SDK raw329/331
use the existing kind34 mapping to canonical334/336; the Game's own wrappers
send334/336. Shared signatures and Game registration data remain unchanged.

The ordinary World tests call the real kind34 receiver with native task IDs:
main449 rebinds two actual Draw surfaces, and main451 stores zero or either of
two real GlobalFile handles. They verify exact forwarded words, actual receiver
bindings, control2/no value and an unchanged caller VM snapshot. Packet
observation delegates to the real transport. This is a normal JS receiver
acceptance, not execution of the original SDK.

SDK450 retains its unknown admission and cannot execute its installed wrapper.
Its formatter core and exceptional tail remain separate evidence work. No other
slot, version, type or capability is enabled by these two registrations.

## SDK FES update and caller exit-code registrations

SDK main448 (`fes.update`) and main453 (`fes.setCurrentExitCode`) have their own
explicit wrapper evidence. Both take one VM word, return control `2` and write
no universal VM result. Shared signatures, Game data and all other SDK slots
remain unchanged. Main448 uses the existing SDK raw328 to canonical333 mapping;
the Game independently sends333. The real kind34 update runs its existing
FESCoordinator and source: the short test observes a FES bank assignment and one
player frame, while preserving the caller's stack/PC and control2/no-value reply.
Those intended FES bank effects are separate from a VM return-value write.

Main453 stores the complete argument DWORD into its actual caller context's
exit-code field. The normal JS bridge owns that value on the Script task record.
Tests use zero, a negative word and a high-bit word with the existing signed
interpretation; they verify the record and its current object snapshot, leave
a different FES task's exit code alone and preserve the caller machine snapshot.
No new width restriction, clamp, implicit target or VM result is introduced.
SDK450 remains unknown; its installed wrapper gains no admission from these
two registrations.

## SDK FES exit-code query and caller context-name copy

SDK main452 (`fes.exitCode`) and main454 (`fes.contextName`) are explicitly
recovered from their own complete wrappers. Both consume one VM word. Main452
initializes a local DWORD to -1, sends message23 to the actual target and copies
that word to the universal VM result, returning control `1`. The independent
Game wrapper does the same, so the shared main452 `resultWritten` observation is
corrected in place from unknown to `true`. Its existing signed 32-bit result,
handle type and declared review stay unchanged; no version signature override
is needed. Tests query a real kind34 FES before and after its normal `exit 7`,
then query an actual Script caller after main453 sets zero, a negative word and
a high-bit DWORD. They check the original result bits and real message23 path.

Main454 translates the caller-owned destination start and copies its actual
context CString including NUL, returning control `2` without writing a universal
VM result. The native source context fields have different private offsets
(SDK +0x1c4, Game +0x2c8), which do not alter the public signature or add runtime
layout branches. The ordinary JS test supplies a valid ASCII CString through
Script message26, creates and loads a real child Script, and observes the normal
parent message25 inheritance into that child's actual scheduler context. The
copy writes only that caller's allocated guest block, preserving surrounding
canaries and the rest of its machine snapshot. A subsequent parent name change
does not replace the child's context. This proves the existing valid owned
CString domain, not arbitrary buffers, unterminated strings, Unicode support or
a new pointer/encoding contract. Shared pointer types remain unknown.

Game registration data, other slots, table lengths and the central unknown-slot
guard are unchanged. SDK450 and455 remain unknown. These are normal JS receiver
acceptances; they do not claim execution of the original engines.

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
The central runtime rejects a resolved `status: 'unknown'` slot before preparing
bank/resource services, invoking a registered handler or entering a built-in
fallback. Registration may retain a dormant implementation shared with another
profile; it does not grant that slot permission to execute. For example, SDK
main264 keeps its unknown signature and cannot reach its installed drawing
handler. A signature's `review: 'needs-review'` is separate from slot status:
known recovered/declared calls still follow their existing dispatch, control
validation and explicit reserved/constant-zero behavior.

Both this early rejection and an unimplemented known call report
`UnsupportedKCSNative` with the selected profile/table/ID, task, script, guest PC,
arguments and source debug data. No other profile's shared meaning or observed
argument count supplies permission for an unknown slot. Unregistered versions
remain rejected when the runtime resolves its profile.

The migration inventory separately records installed source ownership, dependencies
and remaining EXE debt. Its implementation classification, `traced` review or
descriptive render route does not grant a current-profile slot permission to run.
Every unknown entry carries `runtimeAdmission: 'blocked-unknown'`, including
installed handlers whose AST ownership and evidence remain recorded while dormant.
An unknown slot with no installed handler is recorded as centrally blocked without
executing a fallback probe. Source footprints remain visible independently of ABI
admission; neither a Game implementation nor an observed SDK call recovers an
unknown SDK signature.

Signature comparison tools accept resolved ABI JSON, not raw registration
descriptors. See [structured signatures](native-signatures.md).

Executable fingerprints and table addresses remain separately owned by each
entry in `NATIVE_EXE_PROFILES`. Sharing semantics does not make those binary
identities, memory layouts or private survey observations interchangeable.

## FES common keyword membership

The separate [FES common catalogue](../src/native/abi/fes-common-heads.mjs) owns
134 native keywords once: 119 shared by the registered engines, 12 additional
Game words and three additional SDK words. Each engine's `fes.commonHeads`
explicitly registers the shared set, its additions, the complete count and
`byte-exact-cstring` comparison. Missing, incomplete or inconsistent registrations
are rejected. These keywords are not entries or ordinals in the four VM native
ID namespaces, and their presence does not change a slot or capability.

`nativeFESCommonHead(profile, narrowBytes)` resolves the exact registered profile
before querying its data. It returns a tagged `present` descriptor or `absent`;
the lookup compares narrow bytes through the first NUL, with an implicit NUL at
the end of a getter-owned byte array. It preserves case and does not decode,
expand, tokenize, evaluate or execute a command. It also does not establish
native temporary-buffer or overflow behavior.

A descriptor's `nameCrossrefs` are navigation to existing audit names, including
explicitly authored alias groups. They do not prove that a native common handler
has the same semantics or implementation status. The raw catalogue remains
unbound. Each common registration must additionally provide `reviewedBindings`;
only the matching registry's reviewed evidence may qualify a shared meaning.
An explicit empty list keeps every member present but unbound. Missing lists,
unknown reviews, duplicates and reviews from the other registry are rejected.

One reviewed shared meaning is `active-reference-null`, linked to
`fes.reference.cn.resetactive`. Separate Game and SDK review records preserve
their native codes 11 and 14, declared 36-byte reference size and a NULL payload,
zero operand getters and
zero return. Both query results reuse one qualified descriptor; the other 132
keywords retain pending semantic links and unbound dispatch. SDK `execjs`,
`endjs` and `calljs` remain known members regardless of their cross-references.

The second reviewed shared meaning is `active-lock-int32`, linked to
`fes.reference.cn.lockactive`. Its independent Game/SDK reviews retain one
optional operand getter, signed int32 scalar/default zero, native record codes
22/25 and opaque return-3. The original raw Number reader and active-lock FIFO
remain the consumer; no physical-code translation or checkpoint owner is added.
Each registry explicitly admits its own review, so omitting either qualification
leaves that keyword present and unbound. Runtime review identifiers contain no
original executable address.

The normal consumer queries this data only after the raw object probe misses
and token0 has passed through its second getter. Reviewed `resetactive` queues
the existing NULL semantic record and returns zero without flushing or running
a whole-row evaluator. Reviewed lockactive passes the original operand vector
to its existing reader and preserves return-3 for the queue drain. Known unbound
members and absent members retain separate
explicit pending gates. Other early routes, whole-row grammar and
conditional/skip remain separate work; no VM slot or capability is enabled.

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
