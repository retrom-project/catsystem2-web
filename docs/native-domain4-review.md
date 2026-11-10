# Domain 4 ABI review

The SDK entries below were checked against the frozen 2.6.1.74 main pointer
table and complete wrapper bodies. Review followed VM argument offsets, result
stores, control returns, reader/history ownership, CSS serialization, file APIs,
string banks, CG registration and variable-backup callees. The normal JS World
registration/fallback route was checked independently. All 65 existing SDK
observed argument counts agree with the recovered signatures. These names now
have SDK-specific evidence. Internal pointer layouts differ between versions.

| SDK ID | Semantic name                   | Words | Control | SDK handler |
| ------ | ------------------------------- | ----: | ------- | ----------- |
| 1D     | file.open                       |     2 | 1       | `0x522FA0`  |
| 20     | file.close                      |     1 | 2       | `0x522F80`  |
| DB     | scene.initializeTaskContext     |     0 | 2       | `0x5146D0`  |
| DC     | taskScene.load                  |     1 | 1       | `0x514820`  |
| DD     | taskScene.typeOrCount           |     2 | 1       | `0x5144E0`  |
| DE     | taskScene.text                  |     3 | 1       | `0x5145E0`  |
| E1     | taskScene.clearSeen             |     0 | 2       | `0x5148C0`  |
| E2     | taskScene.clearPath             |     0 | 2       | `0x5148E0`  |
| E5     | taskScene.setHistoryString      |     4 | 1       | `0x514900`  |
| E6     | taskScene.getHistoryString      |     4 | 1       | `0x514670`  |
| E7     | taskScene.captureHistoryStrings |     3 | 2       | `0x514960`  |
| E8     | taskScene.expandHistoryStrings  |     3 | 2       | `0x513DF0`  |
| E9     | scene.expandTaskHistoryStrings  |     4 | 2       | `0x513F80`  |
| EA     | scene.copyTaskHistory           |     1 | 1       | `0x514120`  |
| EB     | taskScene.currentFilename       |     1 | 1       | `0x514590`  |
| EF     | scene.saveTaskHistory           |     5 | 1       | `0x516AE0`  |
| F0     | variables.saveRange             |     5 | 1       | `0x5167F0`  |
| F2     | globalFile.saveNested           |     3 | 1       | `0x516C90`  |
| F3     | strings.save                    |     2 | 1       | `0x516D10`  |
| F5     | globalFile.write                |     2 | 1       | `0x516470`  |
| F7     | globalFile.read                 |     1 | 1       | `0x516390`  |
| F8     | globalFile.tag                  |     1 | 1       | `0x516360`  |
| F9     | scene.restoreTaskHistory        |     4 | 1       | `0x516110`  |
| FA     | variables.restoreRange          |     4 | 1       | `0x515E50`  |
| FC     | globalFile.readNested           |     2 | 1       | `0x516240`  |
| FD     | strings.restore                 |     2 | 1       | `0x5162C0`  |
| FE     | globalFile.readBytes            |     4 | 1       | `0x515CC0`  |
| FF     | globalFile.modifiedTime         |     6 | 1       | `0x515D40`  |
| 114    | strings.set                     |     2 | 2       | `0x524480`  |
| 115    | strings.get                     |     2 | 1       | `0x524420`  |
| 116    | strings.expand                  |     1 | 2       | `0x5243D0`  |
| 142    | scene.exists                    |     1 | 1       | `0x514790`  |
| 143    | scene.create                    |     0 | 1       | `0x528330`  |
| 144    | scene.close                     |     1 | 2       | `0x5283B0`  |
| 145    | scene.load                      |     2 | 1       | `0x5289B0`  |
| 146    | scene.typeOrCount               |     3 | 1       | `0x528530`  |
| 147    | scene.text                      |     4 | 1       | `0x528780`  |
| 14A    | scene.clearSeen                 |     1 | 2       | `0x528B10`  |
| 14B    | scene.clearPath                 |     1 | 2       | `0x528B30`  |
| 14E    | scene.setHistoryString          |     5 | 1       | `0x528CB0`  |
| 14F    | scene.getHistoryString          |     5 | 1       | `0x528950`  |
| 150    | scene.captureHistoryStrings     |     4 | 2       | `0x528D10`  |
| 151    | scene.expandHistoryStrings      |     4 | 2       | `0x528190`  |
| 152    | scene.currentFilename           |     2 | 1       | `0x5286E0`  |
| 181    | scene.saveHistory               |     5 | 1       | `0x5169F0`  |
| 182    | scene.restoreHistory            |     4 | 1       | `0x516090`  |
| 1A3    | cg.create                       |     0 | 1       | `0x51E230`  |
| 1A4    | cg.release                      |     1 | 2       | `0x51E270`  |
| 1A5    | cg.clear                        |     1 | 2       | `0x51E210`  |
| 1A6    | cg.register                     |     2 | 2       | `0x51E090`  |
| 1A7    | cg.contains                     |     2 | 1       | `0x51E2A0`  |
| 1A8    | cg.save                         |     3 | 1       | `0x516600`  |
| 1A9    | cg.load                         |     3 | 1       | `0x515BB0`  |
| 1CA    | cg.loadList                     |     2 | 2       | `0x51E3C0`  |
| 1CB    | cg.registerGroup                |     3 | 2       | `0x51E350`  |
| 260    | scene.blockCount                |     1 | 1       | `0x528740`  |
| 261    | variables.backup                |     0 | 2       | `0x52A470`  |
| 262    | variables.restore               |     0 | 2       | `0x52A600`  |
| 3D2    | scene.setPathExtra              |     2 | 2       | `0x528B50`  |
| 3D3    | scene.pathExtra                 |     2 | 1       | `0x528640`  |
| 3D4    | scene.messageCount              |     1 | 1       | `0x5285A0`  |
| 3D5    | scene.copyExtra                 |     2 | 2       | `0x528A50`  |
| 3D6    | scene.lastPathIndex             |     1 | 1       | `0x528570`  |
| 3DE    | globalFile.removeFile           |     1 | 2       | `0x5159E0`  |
| 3E1    | scene.copyPath                  |     2 | 2       | `0x528300`  |

SDK E7/E8/E9/151 can write the hidden output word on a missing-history/scene
branch while returning control 2. Their signature resultWritten is null in both
ABI records. KCS receives the declared void control. The completed migration
uses the corresponding JS data models for normal calls.

## Reviewed unsupported entries

Game 121 through 125 retain namePairs.allocate, free, append, findName and
findPair. Normal World dispatch reaches UnsupportedKCSNative for all five.
Diagnostics include the profile, table, ID, arguments, task, script position and
source metadata. The frozen game corpus contains 103 KCS files and the SDK
contains 186. None references main 121 through 125. The strict instruction
scanner found zero dynamic GCALL operands. This scoped corpus conclusion also
finds zero main 1D6..201 and 334 references. Authored and future scripts can
reach these entries through ordinary GCALL.

Reproduce the static input with scripts/native-audit.mjs and its --corpus option,
then inspect each corpus.nativeIds entry. references.json identifies the two
frozen EXEs. Raw IDA output and private corpus measurements remain in ignored
local evidence storage. The generator copies the five reviewed unsupported
decisions into b-migration.json and preserves their unsupported classification.

## Mission empty-character query

Mission 334 selector 9 reads an uninitialized std::set sentinel when CHAR is
empty. Both frozen oracles recorded indeterminate words for this input. The JS
path raises RangeError and preserves a diagnostic. Valid nonempty character
sets retain the independently verified first-character result. Neither frozen
corpus calls 334. Future authored callers must provide a nonempty CHAR set.
