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
| 2.6.1.74 | 1009       | 817       | 82            | 19            | 91      | 45 / 44 / 51               |
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

## Language keyboard capability

`capabilities.windowLanguageAccelerators` is a mandatory boolean owned by each
version registration: Game 2.6.1.76 explicitly enables its proved language
keyboard producer, while SDK 2.6.1.74 explicitly disables it. Missing or
nonboolean values fail ABI validation. NativeWindow reads this capability;
configuration language support, dynamic menus and legacy startup layout do
not implicitly grant it. Unregistered profiles remain rejected. This covers
core language input and derived checked notifications. The standalone Game
consumer binds these through EngineHost, Core and the browser app; see
[Game language controls](native-window-commands.md#game-language-shortcuts-in-an-ordinary-world).
Resource101 base shortcuts and SDK language routing retain separate gates.
This consumer does not establish Retrom integration or complete platform
startup.

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

## SDK deferred Script destruction registration

SDK main `0x43` (`task.destroy`) is explicitly recovered from its own
`0x528ea0` wrapper and normal registered Script interface. It takes one target
word, sends message3 with zero payload and flags, ignores message-out scratch,
and returns control2 without a universal VM result. The shared signature already
states `resultWritten=false`; it needs no override or common-data change.

The own SDK Script constructor and vtable bind the existing transport. Exact
lookup reaches a live target or follows its parent chain to a missing/null
no-op. A live Script first sends its existing VM delete notification
`[0xffffffff, 0xffff0006, 0, 0]`, then Base marks the task pending. Repeated requests
while pending do not notify again. Normal logic visits children before consuming
that flag, invokes the deleting destructor and skips the deleted Script's own
VM tick. Destruction nulls the registered ancestor routes, releases actual owned
children and lets the normal parent walk prune those routes.

The tests use real Script GCALLs, a delegated notification observer and actual
message-wait continuations. They verify request-before-frame, repeated request,
child-first destruction/owner cleanup, then the same released ID as a missing
target; all three GCALLs have control2 and no result push. Zero is not treated as
a missing task ID. Notification writes in the receiver VM are legitimate effects,
separate from a native return-value write in the independent caller.

Game registration and runtime implementations remain unchanged; the Game case
is a control for its existing module contract, not new SDK proof for other
versions. Private VM, allocator and all-resource destructor internals are outside
this admission. SDK70 (`task.post`) remains the actual built-in fallback and
shared-semantic unknown representative; SDK455/467 and unregistered versions
remain blocked.

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

No other slot, version, type or capability is enabled by these two registrations.

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
These two registrations do not enable any other slot.

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
guard are unchanged. SDK455 remains unknown. These are normal JS receiver
acceptances; they do not claim execution of the original engines.

## SDK FES formatted jump

SDK main450 (`fes.jump(task, formatLabel)`) is explicitly recovered from its own
complete wrapper. It takes two VM words, formats a temporary narrow CString and
sends SDK raw330 through the existing kind34 mapping to canonical335; the Game's
own wrapper independently sends335. The public operands are the task and caller's
format source. There is no guest string-destination operand. Message335 selects
a real loaded FES block and returns whether it exists.

Both complete wrappers initialize their local result to zero and copy that
local DWORD to the universal VM result. Their normal cookie tail preserves
control `1`. The shared main450 `resultWritten` observation is therefore
corrected from unknown to `true`, without changing its existing boolean result,
unknown pointer/handle fields, declared review, Game registration or other slots.
The accepted bounded original formatter comparison covers24 selected supported
rows per engine, including full output/NUL/canaries. It corroborates that finite
formatter domain; it is not an unrestricted CRT or exception-path proof.

Ordinary World tests use real kind34/FESCoordinator receivers and a normally
loaded Script caller. They verify caller-owned ASCII format sources/canaries,
the exact temporary335 packet bytes and NUL, selected and missing labels, and a
following real Coordinator marker. A direct control1 reply leaves the caller VM
snapshot unchanged. Executing the actual Script GCALL then pushes the successful
and missing-label boolean results onto its VM stack; the direct reply alone is
not claimed as an applied VM write. Unsupported conversions still raise explicit
errors before a jump packet is sent. No malformed/oversized, arbitrary encoding,
unterminated pointer or unknown-version domain is enabled by this registration.
SDK455 and467 remain unknown representatives; central unknown admission remains
unchanged.

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

## SDK settings-menu request

SDK main393 is registered from its own `51B4A0` wrapper and `442080`
consumer, with the `8F2A20` field getter. The wrapper forwards the full argument
DWORD as message `0x464` lParam and returns control 2 without writing a VM
result. The consumer maps zero/nonzero to disabled/enabled for command `0x77`;
this registration reuses the shared one-word void signature already registered
by Game76.

The browser contract commits `World.menu` desired state and forwards the request
through the real `EngineHost.nativeMenuChanged` callback. The two-profile Script
GCALL test checks zero, one, a negative word and a high-bit word, continued guest
execution and no result push. This proves the World/Host request boundary, not
Win32 message-pump timing, GUI acknowledgement or successful OS menu mutation.
SDK455 remains unknown; main467 remains unknown in both profiles, and
unregistered engines remain rejected.

## Colored rectangle main79

The common main79 meaning is `plane.createColoredRectangle(target, width, height,
argb)`: a native task ID, two f32 dimensions and one ARGB word. It is not a bitmap
assignment. Both registered wrappers take four words, return control 2 and leave
the VM result unwritten. Target zero skips message delivery. The SDK wrapper's
raw plane message 40 maps to the Game wrapper's canonical message 42.

Both own plane receivers remove the previous target model before creation. Only
plane mode 1 creates the solid model and publishes its dimensions, draw type and
shape words. Modes 0 and 2 remove the old graph without a replacement, retaining
those task fields; a later mode-1 request can create a new model. The SDK slot is
explicitly recovered from its own wrapper and receiver evidence. Other unknown
slots, including SDK78 and main467, remain guarded. The packet's two unused
original scratch words carry no value claim; this contract does not establish
pixels, other backends or malformed/OOM behavior.

## Base window accelerators

`capabilities.windowBaseAccelerators` is a required boolean. SDK2.6.1.74 and
Game2.6.1.76 explicitly enable the independently recovered resource101 table;
new registrations must declare their own value. Missing/non-boolean fields and
unregistered profiles are rejected. The four rows live once in
[accelerator-rows.mjs](../src/native/accelerator-rows.mjs), outside the native-slot
catalog. This enables no VM slot or unknown version. The separate language
accelerator capability remains Game-only; SDK language rows stay disabled.

## Priority main88

Main88 `plane.setPriority(task, z)` takes a native task ID and one f32 priority
word. Both registered wrappers return control 2 without writing a VM result;
target zero skips delivery. The SDK's raw messages 59 and 47 map to the Game's
canonical 61 and 49: read the three-word base vector, replace only z, then write
the same packet back. Both sends retain their original flags value 1.

A handled Plane stops ordinary D2 propagation. An unhandled Base with loaded
Plane children visits its ordered immediate children with the shared vector
packet: the last responding child supplies x/y for the subsequent priority
write to those children. This normal hierarchy behavior is covered through real
Script GCALL, Base/Plane services, guest continuation, memory canaries and void
stack behavior in both registered profiles. SDK88 is explicitly recovered from
its own wrapper and receiver evidence; the already matching common signature
and Game registration remain unchanged. SDK78/455/467, unregistered versions
and other unknown slots remain guarded. This does not establish missing or
nonresponding-model scratch values, malformed packets, alternative backends,
inherited-position corner paths or rendered pixels.

## Visibility main92

Main92 `plane.setVisible(task, visible)` takes a native task ID and one raw
DWORD visibility flag. SDK513C80 sends its raw message45; Game6415A0 sends47.
Both map to canonical Plane47 with wParam0 and flags1, skip target zero, and
return control2 without writing a VM result. Zero pauses and hides the Plane;
a nonzero word unpauses and shows it. Registration still follows the existing
parent lookup and enable rules; input behavior is unchanged.

The ordinary D2 flags are observable through a real Base with two loaded Plane
children: an unhandled Base forwards the visibility request to its immediate
children, while a handled Plane leaves its sibling unchanged. Real Script GCALL
coverage in both registered profiles checks hide/show, a high-bit nonzero flag,
null-target continuation, unchanged caller words and canaries, and no VM result
push. The existing graphs, geometry and render order are retained. SDK92 is
explicitly recovered from its own wrapper and receiver; common signatures,
Game admission, D2 and all other receivers remain unchanged. SDK78/455/467,
Game467 and unregistered versions remain guarded. These checks do not claim
rendered pixels, malformed packets, or inherited-position corner behavior.

## Input-region binding main104

Main104 `plane.bindInputRegion(task, x, y, width, height, priority, bindingWord)`
takes seven DWORDs. Both own wrappers return control2 without writing a VM result,
construct the four-word RECT with32-bit addition, and send SDK87/Game89 with
transport flags0. Task number0 follows the real sender/Top registry; it is not
an unconditional null or Root alias. Other wrappers retain their own zero rules.

BasePlane binds the explicit RECT and priority once, retains the binding word
and actual sender, and leaves an existing registration unchanged. A rectangle
covering the configured viewport is replaced by the independently read literal
`[-100000, -100000, 100000, 100000]` in both the Input region and retained bindArea.
SimplePlane instead derives its rectangle from the loaded model's scalar-f32
position-minus-base vector and dimensions, truncates coordinates toward zero,
and uses truncated base.z as priority. It ignores the explicit rectangle and
priority. Missing or unreviewed SimplePlane geometry is rejected rather than
given fabricated zero bounds.

The existing Input, geometry and owned packet services remain the authorities.
The existing Input region.flags is opaque JS metadata only: the native Input
registration packet does not carry the retained word. It does not affect native
Input filtering or callbacks; transport flags remain0.
The SimplePlane retains the packet's logical local address0 as its binding word;
this is not a claim that a physical native C-stack address equals0. Own Base
registration, actual frame, event forwarding and close paths do not pass that
retained word to Input mask/filter or VM output. The same retained extra passed
to the two original geometry-update helpers is unused. No raw native address,
uninitialized scratch or arbitrary native memory-query equivalence is claimed.

Real Script GCALLs through ordinary World services cover both registered profiles,
Base and SimplePlane behavior, duplicate binding, fullscreen retention, legitimate
zero routing, void stack/canary behavior and cleanup. SDK104 is explicitly admitted
from SDK515770 and its own receiver chain, independently of Game648FA0. All other
slots, signatures, stubs and version gates stay unchanged; SDK78/455/467 and
Game467 remain unknown. This does not claim rendered pixels or all Plane/drag
platform behavior.

## Main105 input enabled word

Main105 is `plane.setInputEnabled(task, enabled)`, independently established by
SDK5156A0 and Game648ED0. The two-word wrappers dispatch SDK raw90/Game92 to the
same canonical92, with w0, l equal to the complete enabled DWORD and transport
flags0. They dispatch legitimate task0 as well; control2 leaves the VM output
unwritten. The existing Main97 catalog label `plane.setColor` is unchanged;
both per-version Main97 entries remain unknown. Only SDK105 is newly admitted;
other slots, signatures, table lengths and version gates stay unchanged,
including SDK108/455/467 and Game467 unknown.

The bound Base receiver and loaded SimplePlane delegate to the existing Input
owner service. Input134 preserves the raw enabled DWORD on the first matching
region and marks Input changed even if the owner is no longer registered.
Exactly zero additionally invokes Input132 to clear all active records for that
same owner; another owner's active word is retained. A nonzero enabled word
leaves active unchanged. An unbound receiver does not access Input. The service
uses the existing World owner identity and region authority, without a second
state table or Boolean conversion.

Real Script GCALLs through both registered profiles cover actual Main104 binding,
Base and loaded SimplePlane enabled words, duplicate and removed registrations,
legitimate task0 dispatch, literal messages, void stack/canaries, fresh checkpoint
isolation and owner cleanup. These are ordinary JS receiver contracts, not a claim
about native stack addresses, pixels or all Plane/Input operations.

## Main106 input active word

Main106 is `plane.setInputActive(task, active)`, independently established by
SDK515640 and Game648E70. Both wrappers dispatch legitimate task0 and send
SDK raw91/Game93 to canonical93 with w0, l equal to the full active DWORD and
transport flags0. Control2 leaves the VM output unwritten. The previous table
handle description is corrected in the shared catalog; no extra handle table or
compatibility reader is introduced. Only SDK106 is newly admitted.

A bound Base receiver delegates to the existing Input132 owner service; loaded
SimplePlane reaches that same receiver. Every matching owner record receives
the complete active DWORD. A nonzero word also clears nonmatching owners, even
when no matching registration remains. Zero leaves other owners unchanged.
An unbound receiver never calls Input. This operation does not change enabled
or the Input changed flag. Existing World owner identity, region storage,
snapshot and close authorities remain in use.

Real dual-profile Script GCALLs cover Main104 binding, Base and loaded SimplePlane,
high and zero active words, duplicates, missing versus unbound owners, literal
sender/message/control and canaries, legitimate task0 dispatch, cold fullDTO fresh
restore without replay, isolated subsequent input and ordinary owner cleanup.
The prior Main105 business control and input-switch control remain covered. All
other slots, signatures, table lengths and version gates remain unchanged;
SDK108/455/467 and Game467 stay unknown. No pixels, physical stack addresses or
unreviewed Plane behavior are claimed.

## Main848 input hover word

The actual SDK cold-start fault at main848 triggered this recovery. Own
SDK5156D0 and Game648F00 independently establish `plane.setInputHoverEnabled`
with two words, task and enabled. The second word remains32-bit bits. Both
wrappers dispatch legitimate task0 and send SDK raw96/Game98 to canonical98
with w0, l equal to the complete enabled DWORD and transport flags0. Control2
leaves VM output unwritten. Only SDK848 is newly admitted;106 was recovered
earlier from its own proof, not observed as a cold-start fault.

A bound Base receiver delegates to existing Input135; loaded SimplePlane
reaches that same receiver. The first matching region's hover word receives
the complete DWORD, and Input is marked changed even when no matching owner
remains. An unbound receiver skips Input. Neither active, enabled nor another
owner's hover word is rewritten. Own SDK4C47D0 and Game5E8440 consume region+2C
as a zero/nonzero gate for hover selection and enter7/leave8. The shared
setFilter/filter description is corrected without changing word widths or
inventing a shader filter. Native version-specific hover selection details
and all other Input/Plane services remain outside this change.

Real dual-profile Script GCALLs use actual104 binding and Base/loaded SimplePlane
owners. They cover high and zero words, first-owner duplicate behavior,
active/enabled preservation, a real removed registration marking changed from
its independently false baseline, unbound and legitimate task0 dispatch,
literal sender/flags, VMvoid/canaries, cold fullDTO restore without replay,
fresh isolation and ordinary close cleanup. The affected old input control now
expects raw0; canonical99 and its drag behavior remain unchanged. No original
CPU, native stack-address, rendered-pixel or complete platform parity is claimed.
All other slots, signatures, version gates and table lengths stay unchanged.

## Main849 input drag word

The SDK cold-start main849 fault is recovered from its own SDK515700 and
Game648F30 wrappers. `plane.setInputDragEnabled` takes a task and a complete
32-bit enabled word. Both wrappers admit task0, send SDKraw97/Game99 to
canonical99 with w0, l equal to that word and transport flags0, and return
control2 without writing VM output. Only SDK849 gains admission.

The own Base branches forward to SDK Input151/Game Input153, canonical153,
using the same owner's identity, the original word and inherited flags. The
first matching region receives the complete DWORD at field+40. Found, missing
and empty paths leave Input.changed untouched. An unbound receiver skips
Input. Loaded SimplePlane reaches this same Base receiver through its own
out-of-range fallback.

Own frame calls to SDK4C4410/Game5E8080 establish the role: field+40 is tested
for zero/nonzero, independently of the region mask at+10 whose bit2 admits
drag routing. Enabled at+28 and the registered rectangle provide separate
gates before message6 is sent to the owner. The enable word is stored without
Boolean or mask conversion. The catalog's reference-capture label and the
existing route-audit label are corrected from this producer/consumer chain.

Real dual-profile GCALLs cover Base and loaded SimplePlane, high/zero words,
first-owner duplicates, unchanged active/enabled/hover words and dirtiness,
missing/unbound receivers and legitimate task0 dispatch. A high word with
bit2 clear still admits the actual drag service when the separate region
mask has bit2; zero suppresses that owner. Literal packet IDs/flags, VM
continuation and canaries, cold fullDTO restore without call replay, fresh
isolation and ordinary close are checked. The existing Input153 authority,
canonical98 and every other slot/signature/version gate remain unchanged.
The supported normal owner domain does not certify arbitrary native pointer
layouts, all drag/frame variants or complete platform parity.

## Main100 packed color and retained override word

The SDK main100 failure is an explicit unknown-entry admission rejection
before its installed handler runs. Own SDK5139C0 and Game6412E0 wrappers
confirm the existing `plane.setColor` descriptor: three words for task, packed
ARGB and override, control2 and unwritten VM output. Task0 skips before either
remaining argument is read. Nonzero targets send SDKraw57/Game59 to canonical59
with w equal to the complete override word, l equal to ARGB and flags0. Only
SDK100 gains admission; the common signature and route label stay unchanged.

Own SimplePlane routes4BDB16/5E17F6 reach the color manager and its owned
family1 model. Source leaves55AB00/6844F0 retain the raw override DWORD at+15C
and packed color at+160. Dirtiness depends on a zero/nonzero category change
or a changed color; a different nonzero word with the same ARGB is retained
without dirtying the source. Derived leaves55A630/683AC0 retain both words
and always dirty. Native Base does not handle this color message, and an
absent model receives no stored color update.

The current native style's `colorOverride` field now stores DWORD0/1 or the
complete command word. Existing explicit false/true native stores become0/1;
renderer truthiness and public render-option APIs retain their contracts.
There is one stored authority, updated in place with the current checkpoint
contract. High words remain available after a cold restore. This does not
introduce a second field, legacy reader or protocol version.

Real dual-profile GCALLs cover raw ARGB/high override, nonzero-word changes,
source dirty categories, actual namespace routing, a distinct sibling,
loaded/unloaded and Base boundaries, target0 and skipped-argument reads. VM
continuation/canaries, cold fullDTO restoration without call replay, fresh
isolation and close cleanup are checked. The supported owned ordinary Plane
domain does not certify arbitrary native pointers or every render family or
pixel variant. All other native admissions and signatures remain unchanged.

## SDK Main108 input return word

The independently recovered SDK Main108 wrapper accepts a native task ID and a
raw 32-bit return word, sends canonical94 with w0/flags0 even for target0, and
returns control2 without writing a VM result. Its own Base receiver stores the
whole word in its existing return/changed state; normal message4/5/6 polls return
it and clear it. This is separate from Input registration, enable/active/hover
state and model dirtiness. The existing normal receiver is reused. A zero-target
send preserves normal namespace routing without inventing a Root response.

The shared catalog label is corrected from `plane.setMode` to
`plane.setInputReturn(task,value)` with the existing two-word/raw32/void signature.
Only SDK108 is newly admitted (818 recovered,90 unknown); the Game's existing
admission remains. Main109/110 and all other unknown slots/profiles retain their
guards. Real dual-ABI GCALL tests cover raw high words, unregistered Base and
loaded SimplePlane owners, poll/clear, zero transport, cold full DTO restoration
and owner isolation. This short coverage does not claim a completed official SDK
tutorial or a new long-case pass.
