# Native motion manager checkpoints

The fixed SDK23 build has a loaded Script/Main315–317/387–388 CSS bridge.
Its real CRT/FileServer writer saves both a nonempty checkpoint and an empty
refresh retaining the original allocation. A separate file owner restores the
MOT registers, copied extra bytes, delay and start frame into a new manager;
the actual MOT VM then runs and publishes its working bank. The current test
checks the complete caller frame, normal releases and eight independent cold
points. Fresh filename padding remains outside numeric qualification; copying
an allocation preserves its opaque tail without making those bytes initialized.
The native producer uses a controlled Windows OS memory-file port with detached
writes and capacity accounting. It establishes the original CSS format and
virtual file lifecycle, separate from physical disk and product GAME_SAVE.

SDK23 also uses the existing `manager-delete` source-cache policy. Actual
loaded Script/FES callers attach a declared MOT to a CPLANE, stop it, delete
that object and retire the FES normally. Two independent managers share cached
source until a manager destructor clears the list. Existing actors keep their
original code; a subsequent same-name load observes changed storage bytes.
Six independent current cold points preserve both identities and the named
cache. The normal source-file directory is created through the OS API and
registered by the original FileServer; it is not a private mount-field patch.
The producer's final coordinate expectation was corrected without changing its
capture: its MOT writes KX2 VRAM X at byte 0, while `getpos` reads unchanged
position X at byte 24. Original and current callers both read zero. This case
qualifies that ordinary read and source lifecycle, without claiming a changed
position-output result. The earlier missing-directory case remains separate
evidence of absent resources. MOT managers are independent resource handles;
this does not introduce a MOT task-message endpoint.

The fixed SDK23 FES decoder updates its object/MOT tree after decoding the
current command continuation. Queue return -3 first drains the native records
and resumes decoding; it does not insert an intermediate MOT update. The
profile records this order explicitly, while other builds keep their existing
phase. Collection count sampling stays before decode. A declared CPLANE MOT
writes KX2 position at byte offsets 24/28 from registers at 156/160, so its
actual position and SimplePlane geometry change in the same Main448 start
frame. The current loaded callback/Main210 path and independent cold restores
retain that position without waiting another frame. The source-cache fixture
above writes VRAM X at byte0 and remains a separate ownership test.
The independent original consumer emits two triangles at bounds `[7,9,11,13]`
with the original color and alpha, then returns normally from View render and
cleanup. Its Present leaf copies the actual source/destination RECT arguments
and returns zero; this is COM-memory submission evidence, separate from a
physical GPU or framebuffer result. The earlier observer incorrectly required
null RECT pointers after capturing the same geometry. That interrupted return
and cleanup remains an author failure, alongside the separate phase-order red.

Motion checkpoints preserve the original manager's allocated capacity as
well as its used bytes. The first DWORD is used length. Refreshing a smaller
manager reuses the allocation: filename padding, bytes beyond used length and
unused capacity remain intact. Global-file persistence therefore writes the
whole retained allocation, not a newly truncated serialization.

| Field                          | Game 2.6.1.76        | SDK 4.01 / 2.6.1.74 |
| ------------------------------ | -------------------- | ------------------- |
| Record bytes before extra data | 1108                 | 1076                |
| Filename at byte 4             | 32 UTF-16 code units | 32 CP932 bytes      |
| Group                          | 68                   | 36                  |
| 256 register words             | 72                   | 40                  |
| Extra-data byte count          | 1096                 | 1064                |
| Elapsed frame                  | 1100                 | 1068                |
| Start delay                    | 1104                 | 1072                |
| Extra bytes                    | 1108                 | 1076                |

The manager's profile selects the layout. The serializer writes through the
filename's first NUL; it does not clear the rest of its fixed-width field.
The narrow record preserves the original CP932 bytes, including aliases which
decode to the same Unicode character. Its CSS reader passes those bytes to
the loader. The wide record uses the original conversion to UTF-16. Internal
manager snapshots retain each record's requested filename bytes with its code
source, so an independent cold restore preserves the same name and cache key.
Decoding validates record extents against used length while allowing retained
capacity after it. The last legal filename uses 31 bytes in the narrow record
or 31 UTF-16 code units in the wide record, followed by its NUL. Original
Main304/315/296 calls and CSS-file restoration cover these complete fields,
including CP932 double-byte names and aliases, with no unwritten filename
padding excluded. A wide CSS filename can contain characters outside CP932:
it remains UTF-16 through the mounted loader, source cache, query and cold
restore rather than being converted through a narrow filename. Its internal
requested-name bytes are null when the source of the name was WCHAR data.
Names exceeding the native field's capacity remain outside this defined scope.
The motion-checkpoint handle stores its owner manager,
buffer and capacity separately. In the two modern builds, a Main294 manager
survives the creating Script's destruction and remains usable by another Script;
Main295 explicitly releases it. The creator recorded in a JS checkpoint is
provenance, not its lifetime owner. Cold restore also works after that Task has
gone, and closing the World releases the remaining handles. The .23, .63 and
.67 builds independently establish the same lifetime: each actual Script
factory and loaded KCS VM creates a manager, the real Script deleting destructor
releases its VM while retaining the manager, and a second Script can query and
change it before Main295 frees it. Their profile policies now preserve that
ownership through creator-absent cold restore. This evidence does not extend
the modern source-cache or unknown-byte policies to those builds.
Independently held checkpoints retain their separate lifecycle.

The [modern manager lifetime fixture](../tests/fixtures/modern-motion-owner-lifetime-golden.json)
links both own PEs' real window, Top and Script factory, actual Main GCALLs,
creator destruction, surviving caller and explicit manager deletion. It compares
the initialized base bank and manager controls. The initial working-bank bytes
are a raw capture outside this lifetime acceptance; no initial value is inferred
from them. The virtual OS providers and standalone KCS caller do not establish
full application startup or a physical Windows GPU result.

The manager's internal checkpoint stores its speed as a raw float32 word.
This preserves negative zero and NaN payloads through a cold restore; the
native CSS motion-record layout is unchanged. The modern Main state fixture
also checks complete KCS local frames, overlapping output pointers, empty and
null-manager controls, and independent cold restores of both banks and flags.

The two modern constructors leave the working bank untouched. Its 144 bytes
therefore carry initialization knowledge separately from their backing storage.
Main303 and empty updates copy this knowledge with the bytes. A MOT script may
write individual fields, build a matrix, or copy opaque bytes without first
reading them; only an actual read of unknown bytes is diagnosed. Fully known
banks use a null mask. Internal checkpoints preserve masks for the manager and
any MOT VM region receiving an opaque copy, including after independent cold
restore. Other earlier builds keep their existing initialization policy until
their own constructor chain is reviewed.

The own 2.6.1.23 constructor and loaded Script/MOT chain now establish the same
unwritten working-bank and record object/frame domains. Its Main309 returns the
stored active DWORD, while group and manager busy queries remain boolean. The
current snapshot preserves these masks through deferred execution and finish;
an original unwritten domain is never promoted to a numeric initial value.
The [SDK23 manager fixture](../tests/fixtures/sdk23-motion-manager-golden.json)
uses the real CRT, ApplicationRoot, mounted KCS resources and typed Script VM to
cover bank copies, formatted loads, copied registers/extra data, finite speed
and frame inputs, skip/finish, replacement and explicit manager deletion.
Current replay includes independent cold restores before and after these
transitions. Direct authored MotionInstance construction keeps its explicit
initial state. Source-cache invalidation and attached object lifetimes require
their separate ownership qualification; this bank/record fixture does not
establish every Main295 side effect or all filename shapes.

The [SDK23 scalar bridge](../tests/fixtures/sdk23-motion-scalar-bridge-golden.json)
links the registered scalar, identity and ordered-rotation handlers to an actual
loaded MOT VM, and Main318/319/320 to its typed Script caller. It compares raw
result words, the complete caller frame, the produced matrix and a legal
three-knot spline through independent cold restores. Separate normal four- and
seven-knot callers cover the general endpoint formula and the unrolled loop. The integer random call
uses the original process's untouched lazy default seed and compares the full
post-call stream; it does not infer a seed from game time or reseed the owner.
These defined finite cases supplement the existing arithmetic/body evidence.
They do not extend nonfinite, extreme-angle, unmapped-pointer or other-build
qualification.

The modern knowledge fixture links actual Main294/303/304/307/295 calls through
the original file-server registration, mounted loose reader, KCS/zlib parser
and Motion receiver. The mount namespace, extension and loose directory remain
separate. Its partial-write/read, whole-bank stack copy, overlapping matrix copy
and opaque local copy distinguish portable initialized bytes from captured heap
contents. This is an authored resource/owner bridge, not a full game startup.
The current library retains the requested resource filename independently of
its folded cache key so a qualified filename remains loadable after cold restore.

Modern Main304/535 format the filename before loading, copy raw register words
without quieting signaling NaNs, and permit an unmapped register source when
its clamped count is zero. Main306 also clears the bank for that zero count.
Main309 returns the active DWORD as stored by the script. Main514 formats and
classifies its query using the mount's archive namespace. It compares that full
name against the stored basic filename, so a prefixed query can return zero
even after a successful load; it also refreshes working state from the base.
The existing 2.6.1.67 category evidence identifies the same archive field,
independently of the mount's loose directory.
The narrow 2.6.1.74 record splits basic filenames by bytes: the CP932 trail
backslash in `ソ.kcs` leaves `.kcs`. The wide 2.6.1.76 record splits after
conversion to UTF-16 and retains `ソ.kcs`. Query comparison follows the same
narrow/wide representation; both behaviors have actual add/query controls.

The two modern builds keep a process-wide raw MOT source list. Main296 clears
members without clearing this list. Main295 deletes a manager and clears the
shared list, while instances in another manager keep their already parsed code.
The current library follows that invalidation boundary. Its default reader is
bound to the current World's mode-3 mounted search, storage and resource-cache
view; an explicitly supplied library reader retains authority. Cache folding is
separate from the requested filename and each record's basic name.
FES objects own a manager through their native base, even when no motion was
added. The modern own BASE and CPLANE constructors/deleting destructors prove
that destroying an empty object clears the same source list. Collection
deletion, FES task teardown and the special top object now apply that manager
policy too; stopping or clearing members does not. Other managers retain
their already loaded actors and observe new bytes only on the next cache miss.
Independent World restore preserves the current cache and the actors' original
sources. Restoring into a populated World remains rejected before changing it.
The internal World checkpoint stores the current source cache and the actual
source bytes held by each live record. Records from one load share immutable
source storage. An older actor survives a same-name file change and cache
invalidation through cold restore; restoring it does not insert its old code
into the current cache. A byte-identical current entry is reused. These fields
belong to the internal checkpoint, and are not added to native CSS/CTS records.
The cache fixture runs the real MOT static constructor before its two-manager
Main GCALL sequence. Earlier probes which omitted that static constructor are
not evidence of native cache lifetime. An empty-archive filename fixture uses
an explicit FileServer slot registration, matching its original producer; it
does not establish automatic WinMain registration for that configuration.

The native inner loader checks the KCS signature. A noncanonical first DWORD
does not load or execute an otherwise valid compressed payload: the outer Add
can return a nonzero member handle for an active shell whose code pointer is
null. Canonical setter controls distinguish that shell from a loaded VM.
Earlier probes which observed only Add and state queries do not establish
accepted code. The JS loader retains its signature check; native failed-shell
consumers outside the captured delete/update controls remain protected.

Modern fixed wrapper reads are independent of the GCALL's declared argv size.
Mapped trailing words remain available when the declaration is short, and
unused tails are ignored. This includes Main387/388's three/four fixed words.
For Main300/302, the original wrapper resolves the output addresses before
writing: an output may overlap later argv words without redirecting subsequent
writes. Short-frame calls now retain those addresses too; the usual complete
argument array keeps its existing fast path. Own complete Main frames cover
unaligned buffers, overlapping output regions, guest address zero, argv overlap,
CSS tails and independent cold restores. Truly unmapped consumed argv words
remain diagnosed. These two wrapper policies are enabled only for the modern
builds proved by that fixture; the earlier builds retain their current policy.

Manager-created modern records leave their object and frame bytes untouched
until the respective input copy and VM update. Their internal checkpoint keeps
that qualification too, including a deferred record which has never run. Direct
`MotionInstance` construction retains its explicit authoring initial state.
The nonempty Main fixture compares both full KCS VM frames and the initialized
shared fields across delay/skip, wrapped frames, negative speed, raw active words,
register replacement, member/group deletion, finish, and independent cold runs.

The modern full-chain fixture adds actual Top/factory Script GCALLs for
Main315/316/317 and Main387/388. It captures an allocated envelope, refreshes it
with an empty manager, writes both retained buffers into a native CSS container,
saves and independently reloads that file, and reconstructs a new MOT owner at
a different frame through the real mounted KCS/zlib parser. Current KCS checks
all 8192 local bytes with pointer provenance, control replies and VM registers,
then repeats the restore through independent World checkpoints. A second check
loads the original saved CSS bytes directly and retains the copied envelope
after clearing its file. Only the original allocation's unwritten filename
padding is excluded from portable byte comparison; opaque padding from a loaded
native file is copied exactly. This is an authored resource/owner and virtual
OS-file bridge, not product deployment or a physical GPU result.
The nonempty Main fixture now references the qualified original source-cache
static initialization; its 70 normalized frames agree with the earlier parameter
vectors. The earlier uninitialized-cache runs remain historical captures.

The game serializer/load pair is `78A2F0`/`78A420`; the SDK pair is
`622400`/`622540`. `scripts/verify-native-motion-checkpoint.mjs` executes each
original serializer and main `13C` refresh wrapper against authored ordered
maps and VM memory. There are 96 cases per profile and 1,536 comparisons in
total, including zero to two motions, arbitrary register words, Japanese
filenames, extra bytes, wrapped frame counters, reused filename padding and
shrinking records. Public tests cover capacity preservation, profile-specific
names and owner cleanup. Original executables, memory and raw reports remain
in ignored local storage.

Main `0x183(globalFile, entry, checkpoint)` writes the full checkpoint
allocation to a CTS record, including retained tail bytes. Main
`0x184(globalFile, entry, targetManager, frame)` makes an independent copy
and, when the target manager is nonzero, restores its motions at that frame.
A zero target keeps the checkpoint detached; a missing file/entry returns
zero. These operations preserve the envelope's manager identity, data and
capacity. They do not reinterpret its first word as a type flag.

`verify-native-motion-persistence.mjs` executes both complete original
wrappers, CTS record methods and `0x13D` release for **3,107 comparisons per
profile**. MOT manager restoration is an explicit boundary in that wrapper
probe, separate from the serializer and replay evidence above. Public tests
also round-trip compressed CTS files, release the original manager, restore
into another manager and continue after a fresh handle-space restore.

现代两个构建的 Generic38–40 都不读取 argv word，因此 GCALL 的额外尾字被忽略。
退出会清除原 Motion 接收者的 active 字段并以 control 4 停止本次 KCS 执行，
既不压入结果，也不执行后继写入；此前的写入保留。普通 return 不清除 active。
独立原件台架实际运行 Motion 内存构造器，确认 VM shared 为 receiver+8、长度 1192，
VM callback 也指向该接收者，并核对整个共享记录、VM 数据和原析构分配释放。
这项构造证据只覆盖 Motion；Particle task 的 owner 布局仍由其独立证据约束。

随机数入口复用每版已封的整数/浮点 MT19937 完整状态向量，
新增真实 KCS 的零尾字、一尾字、两尾字及冷恢复对照，不重跑物理大向量。

The own SDK63/67 secondary fixture uses true CRT, configured FileServer mounts,
a typed Script loaded by Main143 and its actual GCALL dispatcher. Small parsed
MOT resources cover single/all start ticks, copied finite registers and zero
count, the stored active DWORD (including two), individual/group skip, finite
speed, deferred starts, delayed execution below its threshold, clear/rebind and
explicit release. SDK63 Main305/306/309/312 are now registered for these normal
shapes; both builds use their own x87 register-loader bodies. Sixteen independent
current cold continuations retain the manager and record states. Initial
working/object/frame bytes excluded by the fixture remain unqualified; captured
heap bytes are not initial values. This bridge does not establish FES phase
order or source-cache invalidation.

The SDK63/67 FES consumer fixture separately qualifies Main448's trailing MOT
phase and Main630 notification completion. Each own original journal records
MOT addition before the object/manager update. A frame-derived position advances
from0/9 to1/9 on successive Root updates; a normal CHANGE callback creates a new
instance at0/15, which advances to1/15 on the next update. The notification path
now completes the existing trailing phase after successful decoding and its
liveness check. SDK23 uses this same qualified phase; modern before-decode frame
behavior remains unchanged. Normal live-Core retirement clears the shared MOT
source list in both older builds. Eight independent consumer cold continuations
supplement the sixteen secondary continuations. These are CPU state and actual
callback/Root consumer controls, without drawing, Present or GPU claims. The
fresh-load control first runs an ordinary Root Frame0: Base clocks initialize,
but FES decoding remains disabled until Main448. Its disabled gate also survives
an independent cold restore. Captures taken before that normal clock producer
remain diagnostic records and do not establish numeric clock equivalence.

The subsequent SDK63/67 Core-replacement protocol closes that earlier gap for
ordinary CPLANE/MOT and actual parsed Script consumers. A bank-supplying Script
creates its own FES through Main66, loads/starts it, replaces its Core through
Main447, invokes Main630 and finally retires the FES before releasing its bank.
The controller created by the first Core remains live after replacement and
updates its own Plane through Main94. The new Core's callback returns13/15.
The task-owned resource FIFO retains the old Plane until the next resource
visit requests native deletion; the following Root frame collects it. The new
Plane and controller retire with the FES, and actual manager destruction then
clears the MOT source cache. Both exact originals record36 wrapper entries and
seven Root callbacks; a separate63 write trace identifies the actual raw3
sender and deferred collection. Captured Main77 results in the nested original
Top's root0 namespace remain excluded from pairing. The observer's permanent
freed-address tombstones also cannot establish absence after allocator reuse.

Native child-FES/Script slots and the resource FIFO belong to the FES task,
separately from its replaceable Core. The browser keeps those task resources,
input and surface bindings across replacement. Superseded interpreter metadata
is reclaimed without inventing a native manager-destructor/cache event. A FIFO
BUTTON initial-object borrower retains its particular old Core's semantic
identity until the last such entry is removed; equal local handles in a new
Core do not alias it. These bounded owners and pending handoffs are explicit in
the current internal checkpoint, including their private-bank context and Core
identity. There is no older-development-snapshot fallback or GAME_SAVE change.
The BUTTON cross-Core and interrupted-handoff checks are current ownership
counterexamples derived from the existing initial-pointer consumer; they are
not additional original dynamic glyph, hit-pixel or GPU evidence.

The original overwritten Core itself is not destructed or freed in the
observed normal shutdown, although its task children and live resources have
normal retirement. The browser preserves those observable consumers and cache
semantics rather than reproducing the superseded allocations. This does not establish
global unreachability: the old native bank registration also persists, but no
additional legal Core-specific consumer is established here. The native
fixture closes its inner Top before its outer supplying Script; the reused
Root0 current fixture preserves that provider lifetime explicitly. Full
Application/Device publication and broader replacement formats, callbacks and
platform resources remain separate qualification boundaries.

SDK63 generic17 and41 now have an intact manager/parsed-MOT-VM consumer receipt.
Two finite rounding results control a real VM branch; two interpolations feed
shared position words, which Main302 reads from the working bank. Clearing and
rebinding the same named source creates a new live record before explicit
manager deletion. The own table, VM callback,1/5-word packets and C1 writes are
observed separately from Main307 dispatch. Current cold continuations cover
loaded, evaluated, cleared and rebound states; the existing FES same-frame
consumer proof is reused. No new ABI slot, renderer or full-Application claim is
implied by these two scalar bridges.

The SDK `.63` [group/default consumer golden](../tests/fixtures/native-sdk63-mot-group-default.json)
pairs Main298, Main300 and Main586 with their actual loaded manager records.
Main299 produces the base bank; Main300 copies its nine fields to independent
VM spans. Main586 copies the full default DWORD into each newly loaded record,
and subsequent changes leave existing record flags intact. Two real MOT VMs
read those words, branch and write the working object. Removing one group
exposes the other record; removing both restores the explicit base on update.
A rebound record takes the current default. Parsed Script branches consume both
base and working readbacks, rather than treating the manager fields as the
only evidence.

The creator Script then retires normally. A separate loaded Script receives
the live manager through an ordinary queued packet, continues its updates,
removes/rebinds the group and explicitly deletes the manager. Six independent
cold points cover loaded records, group removal, replacement, creator
retirement, deletion and following parent pruning. The original wrappers
return control2 without writing a result. Manager pointers are normalized by
ownership; they are never compared numerically with current opaque handles.

Own `.23` and modern `.74`/plain `.76` manager/record groups and `.67` live
manager proof are reused with their separately checked wrapper, record and
caller contexts. The new bounded join confirms group-field/container layout
differences and the same default-to-record copy. Four current build bridges
reuse this finite program; they are not four new full native startup proofs.
No runtime policy, start/clock behavior, checkpoint schema or ABI registration
changes are required. FES same-frame MOT consumers retain their accepted scope;
this explicit-manager group does not qualify full Application startup,
unstarted-FES retirement, physical memory, GPU or larger resource domains.

The SDK `.63` [typed CSS golden](../tests/fixtures/native-sdk63-mot-typed-css.json)
pairs Main314/315/316/317/387/388 with two active records and real parsed
writer/reader Scripts. The snapshot envelope stores its manager association and owns its data
and capacity. Refresh requires that manager to remain live. Native CSS entries copy the entire allocated capacity; refreshing
after group removal changes the used prefix while retaining the larger
allocation. Filename copying initializes only bytes through NUL. Tests compare
all known fields and preserve that opaque padding in actual native CSS readers.

The original capture and source manager are released before the CRT CSS write.
An independent file/manager restores both records and runs their actual MOT VMs,
including copied registers, extra data and elapsed/delay state. The normal skip-all
source call precedes update and refresh; a live skip word is not serialized
into the restored record. Overwriting the disk source leaves the loaded CSS owner intact. The
reader then restores the refreshed group, closes its file, refreshes a retained
envelope and writes another CSS before normal envelope/manager/Script release.
Six independent cold points and a fresh native-CSS-only reader cover these
transitions. Typed Main387/388 consumers provide the proof; physical Main72/73
are neither needed nor enabled.

The accepted `.23` and modern CSS/file groups retain their own record widths and
caller qualifications. This group adds the missing `.63` normal bridge without
changing production code, ABI registration, time policy or checkpoint schema.
Unknown padding is not an invented default; absent resources, uninitialized
fields, wider filename/layout shapes and full Application startup keep their
existing boundaries.
