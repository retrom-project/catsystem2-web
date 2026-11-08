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
buffer and capacity separately. Manager resources also retain their owning
Script task, so Script reload and destruction release only that owner's
managers; independently held checkpoints retain their own lifecycle.

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
