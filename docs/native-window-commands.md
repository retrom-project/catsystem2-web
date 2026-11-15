# Native window commands

`wndmenu` evaluates its first argument and posts window message `0x46C` with
`wParam=0` and that unsigned word in `lParam`. A missing argument emits no
event. The original application callback maps thirteen selectors to
`WM_COMMAND`. Unknown selectors do nothing. The FES event number differs by
profile: game 27 and SDK 30 both lead to the same window message.

The KCS natives `34D..34F` post `0x469..0x46B` with both parameters zero
and return control 2, regardless of the Windows post result. The window
procedure then posts `WM_COMMAND` 40012 (toggle fullscreen), 40021 (minimize)
or 40002 (request exit). The toggle does nothing when the original startup
record forces fullscreen because of the desktop color depth. The browser
desktop normally supplies 32 bits per pixel. Minimization uses the browser
pause view, and the exit command shares the regular confirmation path.

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
callback for 48 selector values, then checks the three KCS wrappers and their
posted messages with both Windows post results, in each frozen profile. The action probe
`scripts/verify-native-window-actions.mjs` executes each original menu handler
and event helper for 212 cases per profile: all thirteen FES commands, both
fullscreen states, present/missing script core and root, both confirmation
answers, nonzero high bits in the command word, and the Script toggle with or
without the startup lock. Its 848 comparisons check
call order, packet words and handler return values. Dialogs, shell execution,
display changes, translation and configuration UI remain declared host
boundaries in that probe; it does not claim to execute the Windows UI inside
the browser. Raw traces and original executable bytes remain ignored.

## Browser execution

An initialized original window uses its `kcWindow` loop. Its application
window calls SDK `442A30` or game `531670` for messages `0x469..0x46C`,
posting the resulting `WM_COMMAND` to its window queue. Ordinary JavaScript
Worlds drain their owned message queue without constructing a Win32 process.
The Game language shortcut path below translates its queued keyboard metadata
into the same command handler.

The following title/close behavior belongs to the original-window integration.
Its confirmations use the native translated captions/body. `WM_CLOSE`
cancellation keeps the World alive. Acceptance hides
the view and posts `0x410`, which sends the original filtered Script-disable
event before requesting teardown. The Engine waits for its active frame,
releases the task tree, media, native process, rendering and persistent stores,
then returns the standalone player to its start screen. External disposal also
cancels a pending browser dialog and waits for that frame to settle.

In that original-window integration, `NativeWindowEvents` executes the
original `5DC540`/`5DC640` or
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

Main `1BD` shows a modal script message. SDK `51B460` and game `64FDB0`
execute the original formatter and emit their original caption. Only their
`MessageBoxA/W` call is supplied by the browser. Both pass `MB_OK`; the
native Script waits until OK or Escape dismisses the message. The output
word remains untouched and the wrapper returns control 2. Other USER32
message boxes keep their separate platform boundaries.
[Microsoft MessageBoxW reference](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-messageboxw).

## Game language shortcuts in an ordinary World

For the registered Game 2.6.1.76 profile, NativeWindow derives its language
accelerators from the current configuration entries' `accel` and `accelsub`.
Zero keys are omitted; each entry contributes main then sub, with independent
packed counters starting at zero. The command is 40075 plus the main counter
or 40085 plus the sub counter. Stored flags gain the virtual-key bit. If any
configured key exists, the last row is character `N`, flags4, command40085 plus
the number of nonzero sub keys. That suffix is not a special "none" value:
when it is a valid language index the normal sub-language handler selects it.
An all-zero configuration adds no language rows. Resource101's base shortcuts
are outside this typed owner; they are not fabricated from test expectations.

The browser's existing keydown producer retains modifiers and translated
character alongside the physical key message. The ordinary queue owns a copy
and translates it when the next World frame consumes it. An unmatched key
continues through InputBindings, the sole key/device state owner. The typed
and Win32 boundaries share the same row matcher, including first match,
virtual-key versus character rules and Alt handling.

WM_COMMAND takes its low word. UI40065..40074 and main40075..40084 accept only
valid indexes; sub40085..40094 maps an out-of-range index to FFFFFFFF. Existing
command/applyNativeLanguage remains the configuration and global-string
update authority. Core derives notifications to the optional
`host.nativeMenuChecked` hook from those fields: clear all thirty language
items, then mark UI, main and sub in order. A sub FFFFFFFF marks command40085
plus the configured language count.

EngineHost forwards checked notifications separately from enabled-menu
notifications. The standalone browser app displays Interface, Main text and
Secondary text selects when the registered `windowLanguageAccelerators`
capability supports the live World. Their selected values
derive from `configuration.language`; enabled options derive from the existing
World menu state. A selection queues one existing WM_COMMAND, and the normal
World frame applies it. The controls are hidden without a supported World.
They do not reproduce an operating-system menu or add another language map.

Core publishes the derived checked state when binding a cold or restored
World. Fresh binding does not execute a pending keyboard command or reload
language/options tables. The app reads its current World when receiving a
notification, and queued UI actions retain their original World identity.
A closed source World cannot change the fresh owner's selections. The public
browser case loads an owned Game-profile folder through the actual app,
checks keyboard and select commands, then imports its checkpoint through a
new World before the next frame consumes the saved keyboard message. This
covers the production browser consumer, not complete platform startup or the
original process, accelerator resource, workers and operating-system menus.

Only pending keyboard metadata is checkpointed in the current World queue;
the table and checked-notification values derive from restored configuration,
with no parallel language state or old snapshot reader. A fresh World restores the
queue without executing a command, loading language/options tables or drawing
random values. Normal immutable-program and nullable M2 configuration
revalidation remain part of the existing restore contract. Closing the source
World drops pending window messages and prevents later keyboard callbacks;
a fresh owner remains independent. This covers the registered Game's language
rows, not SDK accelerators, the resource base rows, other profiles or complete
platform startup. Unknown VM slots retain their explicit admission guards.
