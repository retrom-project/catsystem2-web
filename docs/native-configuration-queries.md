# Native configuration queries

SDK 2.6.1.67 Main 360 copies the 5,628-byte voice, 60-byte message and 28-byte
effect inputs into the live configuration. It preserves the fourth window
block and skips unmapped inputs. Main 582/584 retain full word values across
the contiguous preference and system-voice banks, including signed aliases
into the preceding voice, message, effect and window blocks. These are live
views of the canonical owners and survive a cold World restore.

Main 583 returns `FFFFFFFF` when every system-voice channel is disabled and
consumes no random value. Otherwise it uses one value from the same integer
stream as Main 33. Main 589 writes both Settings words in order, including
aliased destinations. Its live words are also read and written through the
indexed system-voice view, including after a cold restore. Unrepresented native
configuration fields remain diagnostic; the overall SDK remains incomplete.
Main 361 saves the current configuration to the existing per-game preference
file even without a dirty request. It writes both system and user groups as
CP932 XML, including signed raw words, font and key bindings. The native writer
omits `GAME/autoselect`, `MESSAGE/read_color`, `MESSAGE/enable_read` and
`ETC/imgimport`; the live fields remain available to their other consumers.
Creation, write and close failures do not change its control-2 reply. A rejected
browser storage write retains a host diagnostic and the same reply; missing
file services and serialization errors remain errors.
This explicit save does not flush a separate SoundConfiguration file or clear
the pending refresh latch. The native application-data directory is represented
by the existing isolated per-game storage root.

The independently checked SDK 2.6.1.63 and 2.6.1.23 save and refresh entries use
the same shared owners. SDK63 additionally omits `FULL_SCREEN/no_full_res` from
its saved XML. SDK23 also omits `KEY/enable_joypad`, `ETC/waitd3dcommand` and
`ETC/disablepixelshader`. A key group with no persisted bindings is absent.
SDK23's original Root uses raw enclosure 10 and embedded event 18; its actual
Script receiver queues `FFFF0011`, the same event produced by the shared
canonical configuration notification 19. Its Sound receiver retains the same
device-dependent zero/one result without changing playback state.

Main 533 requests a configuration refresh. Repeated requests merge into one
pending latch. After the active Root finishes its update, the World broadcasts
event 19 with a zero sender, requests a redraw of the actual client rectangle,
and clears the latch. A request made during update is consumed in that frame;
one made by a notification receiver is cleared with the current request. An
absent Root retains the request. A paused or inactive renderer preserves its
dirty rectangle while the notification still completes. The pending latch and
renderer rectangles survive a cold World checkpoint. This operation does not
mark preferences dirty or save a file.

Run `node --test tests/native-configuration-refresh.test.mjs
tests/native-preference-save.test.mjs` for the three configuration command
families, including cold World restore and rejected storage I/O. File cold-read
integration remains a separate check from a World snapshot restore.

Preference files use `NativeFileStorage` independently of the completed native
progress slots in `GAME_SAVE`. A fresh Core opens that persistent store before
creating its World, then reads saved `setup.xml` before the first KCS executes.
Independent instances under the same browser storage origin and host-supplied
namespace share these preferences. Selecting an older progress slot leaves the
current preferences intact; another namespace has separate preferences. Mounted
read-only `setup.xml` is not treated as an existing user preference. The
`GAME_SAVE` file selection continues to exclude this configuration file.

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
