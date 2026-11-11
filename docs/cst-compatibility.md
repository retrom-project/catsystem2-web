# CST execution contracts

The [generated FES/CST matrix](fes-cst-compatibility.md) owns the complete indexed command inventory,
documented signatures, implementation status and remaining gaps. Its reviewed source is
`scripts/fes-audit.contracts.json`. Command recognition, forwarding a host callback and traversing a
game are insufficient to mark a row implemented.

The references are the [official CST manual](https://cs2.suki.jp/manual/scene/reference/contents.html)
and the frozen SDK 4.01. Compiled SDK scenes are additional evidence: labels compile into separate
resources, and a selection table consists of consecutive command records after its selection command.
SDK/private scripts and raw native comparisons remain in ignored `.local/fes-audit/`.

## Variables and expressions

`ScenePlayer(game, host, globals, strings)` shares the caller's numeric and string objects with other
engine tasks. Numeric variables use `#n`; `#0`–`#511` belong to one playthrough and `#512`–`#1023`
belong to persistent game state. The persistence owner must honor that distinction when starting,
loading or rewinding a playthrough. Scene entry and subroutine calls do not invent a separate variable
domain. FES local variables do not exist in CST; access is an explicit error.

`$` is a hexadecimal prefix in CST numeric expressions, whereas FES uses it for numeric variables.
The scene evaluator normalizes hexadecimal tokens before using the shared signed-int32 expression
evaluator. Parenthesized arguments preserve internal whitespace. Assignment, prefix/postfix
increment/decrement, compound shifts and logical short circuits retain their side effects.
Unknown identifiers and malformed variable indices are errors.

String variables expand in command arguments, speaker names and message text. A log message freezes
its expanded original text so subsequent string changes cannot alter history. The documented native
queue/cache delay for `strn` with a numeric-variable source still needs differential validation; the
current immediate conversion is recorded as partial.

Primary contracts: [numeric domains](https://cs2.suki.jp/manual/scene/begin/2_var.html),
[operators](https://cs2.suki.jp/manual/scene/begin/3_num.html),
[string variables](https://cs2.suki.jp/manual/scene/reference/unique/str.html).

## Control flow and selections

Each CST frame stores its resource, next command position, translation message index and pending
message source position. `call` pushes a real frame; EOF or `return` restores the caller. `next`
replaces the current frame, preserving a caller underneath it. A single-line `if` can execute another
command or a parenthesized assignment.

The public selection waiting state is serializable:

```js
{
  kind: 'selection',
  mode: 'select', // select, select2 or fselect
  sequence: 1,
  script: null, // fselect defaults to select.fes
  file: null,   // select2 image
  plane: null,
  flag: null,   // select2 chosen image ID destination
  choices: [
    { id: 4, target: 'branch', text: 'Choice', enabled: true, disabledStyle: null },
  ],
}
```

IDs can repeat. `choose(rowIndex, sequence)` selects by table position, rejects disabled rows and
stale sequence replies, stores the selected image ID when requested and follows the actual target
resource. Disabled styles `0`, `1`, `2` apply to `select`; their appearance belongs to the renderer.
`host.selection(state)` may return a row index or let the host call `choose` later.
`host.selectionClosed(state)` releases the displayed selection. `host.undoPoint(request)` owns the
full engine checkpoint used by the most recent choice or explicit `undo` command.

`fselect` must run the selected game-supplied FES. The SDK selection FES receives the number of rows in
local variable zero and reads numbered strings beginning at 700. A generic built-in menu is not an
implementation of that FES. `select2` additionally needs the documented alpha-mask/state images.

Primary contracts: [subroutines](https://cs2.suki.jp/manual/scene/reference/unique/subroutine.html),
[selection and image selection](https://cs2.suki.jp/manual/scene/reference/unique/select.html),
[FES selection](https://cs2.suki.jp/manual/scene/reference/unique/fselect.html).

## Messages and waits

Messages retain `line`, `endLine` and `block` from the compiled CST in addition to translation index.
Those fields are source locations; a rendered log line requires the message layout to map back to
its source block. Native replay paths must not be fabricated from an array index.

`parseMessage` returns plain text and serializable formatting instructions in `runs`. Instructions
cover font/ruby size, main/ruby/shadow colors, alignment, character/frame waits, wait reset and
continuation. Relative font size stays relative to the active message window's settings. Escape
spelling is case-insensitive. Unknown escapes remain visible diagnostics. Complete typography,
same-page continuation, ruby, reveal timing and layout queries require native/renderer acceptance.

`wait` distinguishes frame, motion, key, voice, sound-effect, particle and tag waits. `wait 0` yields
at least one frame. `keyskip off` prevents input from terminating timed/motion waits. Forced auto mode
tracks its configured base and character delays and optional manual input. Voice-synchronization
policy remains a host requirement.

`frameoff` is temporary and message display can restore it. `forcemesdel 1` retains suppression until
explicitly cleared. `mesdraw 0` preserves log messages while requesting hidden message text.

Primary contracts: [message escapes](https://cs2.suki.jp/manual/scene/reference/escape.html),
[waits](https://cs2.suki.jp/manual/scene/reference/unique/wait.html),
[forced suppression](https://cs2.suki.jp/manual/scene/reference/unique/forcemesdel.html).

## Host ownership

The host owns browser resources, complete audio state, native FES/KCS task relationships and persistent
engine state. Scene code reports missing services instead of silently succeeding.

| Service                                                    | Contract                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `soundCommand({group,banks,verb,args})`                    | `group` is `bgm`, `se` or `pcm`; explicit banks are an array, omitted banks are `null`. Return `{handled:true,banks:[...]}` after performing the command. Undefined is not acknowledgement. |
| `soundBusy(group,bank)` / `particleBusy(bank)`             | Report real native/browser resource lifetime for waits; `null` means the unspecified bank set.                                                                                              |
| `fesAsync({bank,save,il,file,parameters})`                 | Own one of four asynchronous FES banks, its save/restart policy and VRAM ownership. `fesds` does not close a modal.                                                                         |
| `openFES(file,parameters)`                                 | Run a game-supplied synchronous FES and retain its task/result ownership.                                                                                                                   |
| `messageVisibility` / `showWindow` / `callMessageTag`      | Apply text/window visibility and call an actual message-window FES label.                                                                                                                   |
| `systemButton` / `automaticMode` / `skipStop` / `jumpStop` | Apply the real input policy and mode changes.                                                                                                                                               |
| `autoFace` / `voiceMuted`                                  | Apply name-table face mapping and per-character playback suppression. Log/manual voice replay is a separate policy.                                                                         |
| `cgRegister` / `cgFlag`                                    | Update the shared gallery registry, including automatic-registration policy.                                                                                                                |
| `replayEnd`                                                | Finish the active replay task. `replayFlagBase` must be configured from `adv.xml`; ordinary execution registers the offset flag and continues.                                              |

Audio control verbs cannot be interpreted as filenames. Automatic bank assignment and all true
playback/timing/spatial state have one owner in the audio host. Multiple PCM requests retain
`message.voices`; `voice` remains the current primary reference. Full native audio and checkpoint
acceptance are recorded separately from the parser tests.

## Verification

```sh
node --test tests/fes-contracts.test.mjs tests/scene-contracts.test.mjs
node scripts/fes-audit.mjs --check
node scripts/fes-audit.mjs --sdk /absolute/path/to/frozen/sdk/system/fes
node scripts/fes-audit.mjs --cst /absolute/path/to/frozen/sdk/system/scene
```

The probes are structural inventories. The complete matrix still includes unimplemented native
commands, rendering features, motion executors and host services. New native evidence must update
the implementation, public contract fixture and matrix entry together.

## Conditional token grouping

CST's `if` command first selects one native parenthesized token. An unmatched
opening group consumes the rest of that command line. The recovered expression
evaluator treats the unmatched group as its default zero node and does not
visit child assignments or increments. The command therefore takes the false
branch, with no trailing command dispatched; the next CST line still executes.
This applies to source syntax, without resource-name or game-name branches.

The original 2.6.1.63 system-script call chain and expression dispatch, plus the
existing 2.6.1.76 original expression oracle, establish this behavior. Public
fixtures use independently authored variables and commands. The corpus and
manual-audit tools use the same CST grouping; FES block conditions remain
strict and balanced unknown identifiers retain explicit errors.
