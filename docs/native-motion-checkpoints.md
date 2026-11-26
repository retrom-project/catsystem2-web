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
Decoding validates record extents against used length while allowing retained
capacity after it. The motion-checkpoint handle stores its owner manager,
buffer and capacity separately. In the two modern builds, a Main294 manager
survives the creating Script's destruction and remains usable by another Script;
Main295 explicitly releases it. The creator recorded in a JS checkpoint is
provenance, not its lifetime owner. Cold restore also works after that Task has
gone, and closing the World releases the remaining handles. Earlier builds keep
their current task cleanup policy pending their own lifetime evidence; this does
not establish an opposite native rule for them. Independently held checkpoints
retain their separate lifecycle.

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
restore. Earlier builds keep their existing initialization policy until their
own constructor chain is reviewed.

The modern knowledge fixture links actual Main294/303/304/307/295 calls through
the original file-server registration, mounted loose reader, KCS/zlib parser
and Motion receiver. The mount namespace, extension and loose directory remain
separate. Its partial-write/read, whole-bank stack copy, overlapping matrix copy
and opaque local copy distinguish portable initialized bytes from captured heap
contents. This is an authored resource/owner bridge, not a full game startup.
The current library retains the requested resource filename independently of
its folded cache key so a qualified filename remains loadable after cold restore.

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
