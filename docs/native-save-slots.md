# Native save slots

The eleven FES save commands use JS-owned global-file containers and the existing per-game IndexedDB file storage. System KCS binds the typed container through `1C3` and FES exposes `_SAVEOBJ_`. `datasave` serializes that container directly, with its CSS tag and ordered entries. Missing or zero object arguments preserve the files. There is no remaining global-file projection for these commands. [Implementation](../src/native/save-slots.mjs).

With an empty context, both native handlers form a drive-rooted filename
such as `\save0001.dat`. The Win32 boundary resolves it at the mounted
game's virtual drive root regardless of the current directory. Both native
save scans and CSS writes are exercised with this context; they use the same
per-game store as relative paths.

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

The string annotation retains the original `strlen + 4` stored size. JS initializes the three originally unwritten tail bytes to zero. Differential comparisons exclude only these undefined values and preserve the terminator, declared size and every defined entry byte. The original empty-payload writer also reads eight bytes beyond its 16-byte allocation. Its reader ignores this tail when the declared payload size is zero, so comparisons retain that header and file size while excluding the undefined tail. Nonempty CSS files compare exactly after accounting for the annotation tail.

The reviewed common command tables contain no `dataload` handler. System KCS
loads the CSS container with `0xF7`, then restores its variable, string, history,
motion, image and other entries through their respective native interfaces.
The generic browser save store does not implement this protocol.

Static call-site evidence in both frozen `sscript.kcs` files establishes
container preparation, `0x1C3` binding and `0xF5`/`0xF7` file access. Original
helper execution, adapter differential checks and full system-client tests are
separate evidence levels; none alone establishes complete save-screen or
whole-title acceptance.

`scripts/verify-native-save-slots.mjs` compares the JS implementation against independently executed original handlers, CSS and filesystem helpers. The default bounded sequences cover all eleven commands and exchange/copy/delete failure steps in both ABIs. `CATSYSTEM2_EXTENDED=1` enables the larger sample. File metadata, complete ordered entries, global/string writes and file-operation sequencing are compared after every operation. Tokenization, numeric evaluation and bank access are explicit fixture boundaries.

The existing system-client tests bind a container through `1C3`, execute FES `datasave` and restore variable/string entries through `F7`/`FA`/`FD` in a new World. Public browser acceptance additionally writes CSS and a World checkpoint to IndexedDB, reloads the document, reopens storage and restores both CSS banks and a scene-local checkpoint through normal dispatch. Node cannot cover document replacement or browser transactions. [Differential](../tests/differential/native-save-persistence.test.mjs), [browser acceptance](../tests/browser/public.spec.mjs).
