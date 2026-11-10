# Native scene-history windows

`NativeHistoryCursor` is the runtime implementation. Its original address table
is retained in `oracle/history-cursor-handlers.mjs`. Bounded operation-sequence
differentials run through both ABI dispatchers and independent original wrappers.

Main `0x17B..0x180` browse the existing scene-data resource's path history.
They retain that resource's identity and allocate independent CST readers for
the window slots. They do not copy the authoritative history or use the display
log manager's separate formatted rows.

| Main | Arguments                                               | Result                                                 |
| ---- | ------------------------------------------------------- | ------------------------------------------------------ |
| 17B  | scene-data handle, slot count                           | Cursor handle                                          |
| 17C  | cursor                                                  | Void                                                   |
| 17D  | cursor, direction                                       | Boolean; zero moves backward, any nonzero word forward |
| 17E  | cursor, slot, message destination, speaker destination  | Boolean                                                |
| 17F  | cursor, slot, command destination, command ordinal      | Boolean                                                |
| 180  | cursor, slot, path-index destination, block destination | Boolean                                                |

The create wrapper is game `64F390` / SDK `51AA30`; move is `64F590` /
`51ABF0`. The complete address lists live in `src/native/history-cursor.mjs`.

Each 20-byte native slot stores path index, block index, that path's last block,
its reader pointer and a valid word. Window movement rotates the whole record,
including its reader identity. Backward scans start before the preceding slot;
forward scans start after the previous valid slot. Blocks without a speaker or
message are skipped. A failed movement restores the record and its position in
the window, while retaining any reader cache changed during the attempted scan.

Creation starts at the final history entry and fills older slots. A one-slot
window excludes the current final block. The remembered final path index is a
creation boundary; later queries still obtain each path record's current last
block from the live scene-data handle.

Text queries concatenate type `0x20` lines into the first destination and type
`0x21` lines into the second. Empty text of either type still makes a block
valid. Command queries select the zero-based ordinal among type `0x30` lines.
These are raw CST bytes: numbered-string references are not expanded and CP932
bytes are not decoded and re-encoded. Query misses before a successful reader
refresh preserve both destinations. After refresh, mapped destinations are
cleared by one NUL, including a missing command ordinal. Unmapped optional text
destinations can be omitted; position-query destinations are mandatory translated
pointers. Address zero is mapped VM data, not a null destination.

Releasing a cursor destroys every allocated reader, then its record array and
descriptor. The scene-data resource is borrowed and remains owned by its caller.
Access after the source has been released is an explicit dangling-resource error.
Snapshots preserve that same scene handle, slot order and reader state; restoring
the runtime reconstructs those references without a second history authority.

`scripts/verify-native-history-cursor.mjs FIXED_EXE IGNORED_REPORT` executes all
six wrappers and the original rotating-window, history, CST-load/text and
destructor code. Each pinned build passes **17,715 comparisons over 4,369 wrapper
operations**, or **35,430 / 8,738** in total. The comparisons include complete
initialized reader state and CST bytes, reader identity, every slot, full VM
canaries, controls/results and releases. Mounted category files, VM pointer
translation and platform CRT/heap services are explicit boundaries.

The original reader constructor leaves its string-size/current-block/current-line
words unwritten until the first successful load. These three words are excluded
before that load and counted separately in the private reports. Negative slot
indices, allocation failure and a nonempty history with zero allocated slots
would access invalid native storage; the browser implementation diagnoses them.
An empty history can retain a zero-slot descriptor and release it normally.

Five public tests cover rotation, command/text results, single-slot behavior,
ownership and both profiles' dispatcher/fresh-runtime restoration. The authored
fixtures contain no SDK or game text.
