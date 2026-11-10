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

Run `node --test tests/native-configuration-query.test.mjs` and, with private images,
`node --test tests/differential/native-configuration-query.test.mjs`.
