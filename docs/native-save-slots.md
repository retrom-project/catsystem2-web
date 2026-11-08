# Native save slots

`NativeSaveSlots` executes the original FES save handlers from the reviewed SDK
2.6.1.74 and game 2.6.1.76 images in the World's shared engine process. The
system KCS prepares a global-file container and binds it to an interpreter with
main `0x1C3`; FES exposes this value as `_SAVEOBJ_`. It is a typed global-file
handle at the browser boundary, not a task identity or an emulator checkpoint.

`datasave slot object` writes the explicitly supplied container. A missing
second argument or a zero object is an original no-op. The adapter projects the
authoritative container into a temporary native descriptor for the original
writer; it does not duplicate persistent save state. The file contains the
original CSS signature, tag, compressed ordered entries and payload. All save
commands use the interpreter's inherited context directory and the same virtual
file storage as KCS and SAVEPANEL.

| FES command     | Original behavior                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `datasave`      | Write the supplied global-file object to `save%04d.dat`.                                                                               |
| `saveexist`     | Write missing/present/version-mismatch status to a global variable; optional unsigned tag range.                                       |
| `savedelete`    | Delete the slot file through the original file helper.                                                                                 |
| `savecopy`      | Check the source, delete an existing destination, then copy.                                                                           |
| `saveexchg`     | Move a lone file, or use temporary copies and the original recovery sequence when both exist.                                          |
| `newsave`       | Scan the inclusive slot range by last-write FILETIME. Equal dates retain the first scanned slot; an empty range writes `-1`.           |
| `sortsave`      | Sort an inclusive range with the original comparator and sort routine. A range containing fewer than two slots preserves destinations. |
| `sortsave2`     | Sort the explicit slot list with the same original routine.                                                                            |
| `saveapend_str` | Replace the first matching entry with a parameter string, then write while retaining the file's modification time.                     |
| `saveget_str`   | Copy a found entry into the live numbered string bank. Missing files/entries preserve the previous value.                              |
| `saveget_date`  | Read local calendar fields from a CSS file's last-write time. Missing files preserve output variables; `-1` destinations are skipped.  |

The original string-annotation handler stores `strlen + 4` bytes. The terminator
is initialized; its final three stack bytes are not initialized by the string
producer. Execution preserves this original behavior. Byte comparisons must
exclude those three values while retaining the original stored length.

The reviewed common command tables contain no `dataload` handler. System KCS
loads the CSS container with `0xF7`, then restores its variable, string, history,
motion, image and other entries through their respective native interfaces.
The generic browser save store does not implement this protocol.

Static call-site evidence in both frozen `sscript.kcs` files establishes
container preparation, `0x1C3` binding and `0xF5`/`0xF7` file access. Original
helper execution, adapter differential checks and full system-client tests are
separate evidence levels; none alone establishes complete save-screen or
whole-title acceptance.

`scripts/verify-native-save-slots.mjs` executes all eleven original handlers in
each pinned image: **827 complete calls and 4,136 comparisons per profile**.
The comparisons cover full file bytes/metadata, global/string writes, file
operation sequencing, missing parameters, unsigned version bounds, equal dates,
range edges, duplicate explicit sort entries and failed exchange/copy/delete
steps. The three uninitialized annotation-tail bytes described above are the
only excluded CSS payload values. Parameter tokenization, authored numeric
expressions and bank access are explicit host boundaries; the CSS, filesystem
helpers and sort routines execute their original instructions.

`tests/native-save-slots.test.mjs` separately exercises both complete command
families and two fresh-World system clients. Each client prepares native
variable/string entries, binds the global-file handle with `0x1C3`, executes
`datasave 7 _SAVEOBJ_` through FES, and restores the resulting context-relative
CSS with `0xF7`/`0xFA`/`0xFD` in a new World. This checks actual Runtime/FES/file
integration without a legacy story object or a browser save-store snapshot.
