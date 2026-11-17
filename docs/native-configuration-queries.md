# Native configuration queries

All six operations query live JS configuration, sound and resource state.
Formatting and comparisons retain narrow bytes and ABI-specific XML encodings.
The implementation lives in [configuration-query.mjs](../src/native/configuration-query.mjs).

| ID  | Arguments                              | Result                              |
| --- | -------------------------------------- | ----------------------------------- |
| 24D | Two VM output pointers                 | Void; writes two Settings words     |
| 25D | Formatted filename                     | Legacy sound group gain             |
| 25E | Formatted filename                     | Legacy VOICE play word              |
| 25F | Formatted filename                     | Legacy VOICE master-volume word     |
| 2A2 | Formatted filename, formatted category | INT row index, or FFFFFFFF          |
| 34C | Formatted filename                     | Legacy VOICE row index, or FFFFFFFF |

Legacy queries use the current VOICE blocks and SOUNDGROUP records. Directory
classification precedes filename prefixes. First-match order, mute gates, group
types and raw gain/play/volume words follow the recovered code. `2A2` uses the
loaded sound tree in parent-before-child order, otherwise the legacy VOICE INT
field. Category and INT comparisons use ASCII byte folding, including empty INT
rows. SDK XML strings use CP932 and game XML strings use UTF-8.

`24D` reads `NativeConfiguration.queryWords`. These two unassigned Settings words
are initialized to zero and snapshotted. `config-memory.push` projects them one
way into PE Settings, registered in the board for domain 8 removal. Query
execution itself builds no PE lookup tree. Aliased writes remain sequential.

Both ABI differential sequences use independently authored EXE input records and
compare every operation against normal JS dispatch. They cover loaded/unloaded
trees, filenames, mute/group state, raw query words and aliased outputs. Pure JS
World tests check snapshot restore and independent live mutation. The old wrapper
is preserved in `oracle/configuration-query.mjs`.

## 2.6.1.23 compact configuration

Main 359 copies the 2,856-byte voice, 56-byte message, 28-byte effect and
12-byte window blocks to its four VM destinations. Main 360 accepts the voice,
message and effect blocks as its three inputs. The voice block begins its
32 records at byte 20 with an 88-byte stride. The five raw volume words begin
at byte 2,836.

The text configuration stores 64 key records at a 28-byte binding stride. The
system voice table stores 32 rows in 2,176 bytes. Main 582 reads the row's play
word, Main 583 selects among eligible rows with the existing RNG and Main 584
writes the mapped play word. The configuration tests exercise the final row,
the first out-of-range index and the neighboring block boundaries through KCS.

Run `node --test tests/native-configuration-query.test.mjs` and, with private images,
`node --test tests/differential/native-configuration-query.test.mjs`.
