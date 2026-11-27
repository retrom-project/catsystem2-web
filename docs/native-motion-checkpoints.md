# Native motion manager checkpoints

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
