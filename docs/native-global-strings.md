# System language tables

[NativeGlobalStrings](../src/native/global-strings.mjs) implements the system
translator used by window titles, menu items, dialog controls and other engine
strings. It is independent of FES `setstbl` numbered strings and the named
word dictionaries used by messages 351/352.

| Contract        | SDK engine 2.6.1.74                                               | Game engine 2.6.1.76                                                                        |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Loader          | `47E690`, direct `language.txt`                                   | `5AB510`, signed 32-bit table ID and UTF16 filename; direct file first, then archive flag 3 |
| Parser          | `47E770`, raw CP932 byte keys/values                              | `5AB7A0`, UTF8 converted to UTF16 through Win32 NLS                                         |
| Lookup          | `47ECF0`, cdecl CP932 pointer argument/result                     | `5ABE00`, cdecl UTF16 pointer argument/result                                               |
| Prefix          | `$...$` only                                                      | `$...$` or `#...#`                                                                          |
| Repeated load   | Merge, first existing value retained; failed open preserves table | Delete the selected table before opening; failed open leaves that ID absent                 |
| Multiple tables | One global map                                                    | Signed table-ID order; first matching table wins                                            |

The byte parser splits CR/LF/CRLF, removes line/block comments and replaces TAB
with SPACE. It erases one leading and one trailing SPACE per row. Its subsequent
blank-row scan compares the saved first byte repeatedly: a remaining leading
SPACE discards the entire row, including indented text. This behavior is retained.
Remaining rows form key/value pairs; an unpaired final key is ignored. `$nr$`
skips a pair, `$empty$` creates an empty value, and duplicate keys keep the first
insertion. A skipped pair does not reserve its key. UTF8 BOMs are preserved.

Lookup consumes only one leading delimited key, including both delimiters.
A hit returns the stored value without recursive translation or suffix append.
A miss returns the literal after the key. Missing closing delimiters and text
without a leading delimiter remain unchanged. SDK `getBytes` preserves raw
byte identity even for undecodable CP932 sequences.

## Lifecycle and host service

Construct with `{profile, read, readArchive?, configuration}`. `read(filename)`
must supply the direct file or `null`; the optional game-only
`readArchive(filename, 3)` supplies the archive fallback. An already resolved
provider must preserve those same precedence rules. The SDK loader has no
archive fallback. Existing empty files are successful loads.

`initialize()` loads SDK table zero from `language.txt`, or game table zero from
`language_<UI-prefix>.txt` followed by table one from `language.optionTable`.
That optional filename replaces `%LANG%` with the UI prefix, then `%LANG_M%`
with the main prefix. Every occurrence is replaced; `%LANG_S%` is untouched.
Unavailable UI/main indices use the valid default entry. If both are unavailable,
the initial UI filename has an empty prefix and the optional token remains intact.

`languageChanged('ui'|'main'|'sub')` performs the table work inside the validated
language handlers: UI reloads zero and one; main reloads one; subtitle reloads
neither. The full Windows message path also has an outer prelude. `WM_46F`
unconditionally expands the option-table filename and reloads table one before
calling the main-language handler. An invalid main index therefore reloads once;
a valid forced main update reloads twice. `WM_46E` has no such prelude: an invalid
UI index reloads neither table. `WM_470` never reloads a table. The messages use
the current shared configuration indices, rather than their message parameters.

The owning World performs that prelude and the handlers' validation, thread
pause/resume, dirty marking, menu reconstruction and object notifications.
`snapshot()`/`restore()` retain loaded entries and filenames without rereading
sources or copying configuration.

The optional browser adapter [browserWindowsLanguageID](../src/native/windows-language-ids.mjs)
maps browser BCP47 preference to an assigned Win32 LANGID. It uses the factual
assignments in [Microsoft MS-LCID section 2.2](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-lcid/63d3d639-7fd2-4afb-abbe-0d5b5551eef8),
with `Intl.Locale` region/script inference. This is an explicit host policy;
the browser cannot read Windows `GetUserDefaultUILanguage`. Unknown assignments
return `undefined`, retaining native startup defaults. Native configuration still
accepts an explicit injected LANGID and matches exact 16-bit startup codes.

## System UI callers and remaining boundaries

| Original caller             | Recovered behavior                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game `530BE0`               | UI reload, menu reconstruction, translated `APP/title` through `70EA60` to `SetWindowTextW`, and copy through `5DBAD0` to the thread runner's debug title buffer |
| Game `531060`               | Select normal/author menu resource 104/105; add UI/main/subtitle menu entries and accelerators from startup language records, then translate menu contents       |
| Game `5AC260`; SDK `47EE90` | Recursively translate menu item text through Win32 item query/set APIs                                                                                           |
| Game `5ABF30`/`5AC0E0`      | Translate parent/child window captions; cache the first nonempty original caption by HWND before translation so later language changes retain the key            |
| SDK `47EDC0`/`47EE30`       | Translate current parent/child captions without the game's dynamic-language caption cache                                                                        |

`APP/title` is exposed as `configuration.getField('application.title')`; its
native default is `CS2`. The raw codec maps that same string at Engine +1356
(SDK CP932) or +2136 (game UTF16). Translating a string does not establish a
browser implementation of Win32 menu resources, dialogs, focus, accelerators or
debug windows. Missing native window services must remain explicit errors.

## Verification

Seven authored module tests cover parser/lookup distinctions, reload order,
language changes, raw CP932 bytes and checkpoints. Two browser-language adapter
tests cover region/script handling and injected startup selection.

`scripts/verify-native-global-strings.mjs FIXED_EXE IGNORED_REPORT`
executes the original loader, parser, maps and lookup functions from each
SHA-verified user-provided image. The authored corpus produces 3,928 SDK and
4,112 game comparisons, including complete map entries, file/archive order,
control results, signed table ordering and 80 game filename-helper combinations.
CRT initialization/allocation, file I/O, Win32 NLS and Windows string APIs are
declared host boundaries. No proprietary language text or decompiler bodies are
distributed. Full native UI behavior and browser presentation require separate
acceptance evidence.

An additional private native i386 ELF probe runs the complete game loader/parser
against both frozen language resources. All 934 Chinese and 921 English map
entries, and all 1,855 corresponding lookups, match. That report retains only
source/output hashes and counts. The WASM probe's instruction budget is not used
to infer success for those larger resources.
