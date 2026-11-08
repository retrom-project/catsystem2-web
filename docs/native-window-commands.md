# FES window menu commands

`wndmenu` evaluates its first argument and posts window message `0x46C` with
`wParam=0` and that unsigned word in `lParam`. A missing argument emits no
event. The original application callback maps thirteen selectors to
`WM_COMMAND`. Unknown selectors do nothing. The FES event number differs by
profile: game 27 and SDK 30 both lead to the same window message.

The command handler's common preparation sends event `(158,0,1)` in the game
and `(156,0,1)` in the SDK, when the application's script core and its root
exist. These are enclosed events, not direct task messages: the original
helper constructs five initialized words `[0,0,event,wParam,lParam]`, then
sends engine message 11 to the root with the packet as `lParam`. Its sixth
temporary word is not initialized. Events 20 and 21 have the same numbers in
both profiles.

| Selector | WM_COMMAND | Original behavior                                                                                       | Common preparation |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| 0        | 119        | Show Yes/No confirmation, caption `$0000-0035$`, body `$0000-0036$`; Yes sends event `(21,0,0)`         | Yes                |
| 1        | 40045      | Open the configured save directory through the shell, show mode 5                                       | No                 |
| 2        | 40002      | Post `WM_CLOSE`; its separate window handler controls exit confirmation                                 | Yes                |
| 10       | 40008      | If windowed, pause the engine, enter fullscreen, notify configuration and resume                        | No                 |
| 11       | 40009      | If fullscreen, pause the engine, restore window mode, notify configuration and resume                   | No                 |
| 12       | 40021      | Post `WM_SYSCOMMAND` with `SC_MINIMIZE` (`0xF020`)                                                      | No                 |
| 13       | 40034      | Send event `(20,0,0)`                                                                                   | No                 |
| 20       | 40027      | Open the engine's game configuration property sheet                                                     | Yes                |
| 21       | 40057      | Open the system configuration DLL interface (`cs2confx.dll`)                                            | Yes                |
| 22       | 40011      | Open the native system volume interface with argument 1                                                 | Yes                |
| 30       | 40041      | Open dialog resource 9                                                                                  | Yes                |
| 31       | 40019      | Open dialog resource 129                                                                                | Yes                |
| 32       | 40037      | Run the configured external configuration tool in the save directory, show mode 1; process shell errors | Yes                |

Fullscreen changes the authoritative configuration. Entering it assigns
`currentWidth/currentHeight` from `fullWidth/fullHeight` and sets `fullscreen`
to 1. When `noFullResolution` is nonzero, the application dimensions first
replace the saved fullscreen dimensions. Restoring window mode assigns the
normal width/height and clears `fullscreen`. The display and window APIs are
platform boundaries; merely changing an FES object's visibility cannot
implement this command.

The game configuration property sheet and system configuration DLL are two
distinct interfaces. The former selects the engine's native property page
template. The latter flushes configuration, creates a copy for the DLL and
uses the DLL's actual exports and callbacks; a missing DLL has a native
warning path. Opening a save directory, invoking an external tool and
showing OS dialogs also require browser host substitutes. Their contract is
retained here independently of whether a particular browser host provides
the operation. A missing operation must not be reported as successful.

The implementation queues `host.postWindowMessage(message, instance)` through
the World. It preserves script execution and the original menu selection,
rather than recognizing a game's menu object name. Steam commands separately
use the optional Steam provider: the original null-manager branch does
nothing, and no achievement success is fabricated.

Sources are the mounted game handlers `780080`, `629E00`, `531670`, `530200`
and the independently recovered SDK handlers `619350`, `501350`, `442A30`,
`442080`. The root event helpers are `5DC540` and `4B8970`. Game fullscreen
helpers `530A20`/`530B00` correspond to SDK `442780`/`442860`.

`scripts/verify-native-window-commands.mjs` executes the original application
callback for 48 selector values in each frozen profile. The action probe
`scripts/verify-native-window-actions.mjs` executes each original menu handler
and event helper for 208 cases per profile: all thirteen commands, both
fullscreen states, present/missing script core and root, both confirmation
answers, and nonzero high bits in the command word. Its 832 comparisons check
call order, packet words and handler return values. Dialogs, shell execution,
display changes, translation and configuration UI remain declared host
boundaries in that probe; it does not claim to execute the Windows UI inside
the browser. Raw traces and original executable bytes remain ignored.

## Browser execution

The World drains posted messages in order, including a `0x46C` callback's
posted `WM_COMMAND`. Title and close confirmations use the native translated
captions/body. `WM_CLOSE` cancellation keeps the World alive. Acceptance hides
the view and posts `0x410`, which sends the original filtered Script-disable
event before requesting teardown. The Engine waits for its active frame,
releases the task tree, media, native process, rendering and persistent stores,
then returns the standalone player to its start screen. External disposal also
cancels a pending browser dialog and waits for that frame to settle.

`NativeWindowEvents` executes the original `5DC540`/`5DC640` or
`4B8970`/`4B8A70` packet helpers. Their internal transport CALL targets enter
the canonical World router. Their sixth packet word is retained from native
memory, rather than supplied as an invented flags value. Only the SDK's known
event numbers 156/160 become canonical 158/162 at this boundary. Public
optional tests run both original profiles through real Script queues and a
fresh World restore.

The browser host provides modal preferences, persistent game-file import,
download and deletion, audio controls, version/system information, fullscreen
and a resumable pause view. Game and system configuration are separate host
operations; the controls edit the recovered FES preferences and persist native
setup XML. Browser fullscreen state determines its resulting dimensions/state.
The Windows external configuration executable receives an explicit unavailable
notice. This does not claim to execute `cs2confx.dll`, shell programs, Windows
property-page resources or alter the operating system's volume/window manager.

The Node action/close tests check all thirteen selectors, unknown selectors,
mode guards, preparation order, close cancellation, accepted shutdown and
disposal while a dialog is open. The public browser case changes native
preferences, imports a real file, cancels and accepts exit, checks task-tree
release and reopens the same game to verify persisted preferences and files.
