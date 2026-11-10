# Built-in mahjong rules

Main natives `0x1D6..0x201` expose 44 operations in both reviewed ABIs. The
136-tile wall, dice, seats, two/four-player configuration, hand patterns and
point settlement identify an independent mahjong module. The semantic names
are recovered project descriptions.

## State and ownership

`NativeWorld.tileGame` owns one JS rule model shared by every `tile-game` handle.
The model owns walls, hands, rivers, scores, declarations, abilities, AI state,
pending actions and event continuations. Contexts own their event, choice and
result caches. Starting through one context changes the model queried through
its peers. Releasing a context only releases that context.

The model's third MT19937 stream starts at 4357 and initializes subsequent
words with `69069 * previous`. The main/generic streams have a different
initializer. A World checkpoint stores this tile stream and shared model once,
then stores independent context caches through the handle codec. Pending event
replay and the complete dealt hand resume in a fresh JS World.

The implementation is split into the native interface, canonical rule record,
hand evaluator, action/AI rules, round driver and special/deal policies. Resource
reads and PE projections are absent from this independent module. The previous
EXE facade and table locations are retained under `oracle/` for verification.

## Interface

Every operation except create takes a context as its first word. VM pointers are
translated by the original interpreter bridge; address zero is valid data. The
table gives argument counts including the context. Word results keep their raw
32 bits; functions described as queries are not automatically booleans.

| ID      | Words | Control | Operation                                                     |
| ------- | ----: | ------: | ------------------------------------------------------------- |
| 1D6     |     0 |       1 | Create a context                                              |
| 1D7     |     1 |       2 | Destroy context and owned vectors                             |
| 1D8     |     9 |       2 | Configure player/options records and start the model          |
| 1D9     |     1 |       1 | Advance or replay an event                                    |
| 1DA     |     2 |       2 | Submit command 10006                                          |
| 1DB     |     1 |       1 | Player count                                                  |
| 1DC     |     1 |       1 | Current player                                                |
| 1DD–1DF |     3 |       1 | Selectors 5, 6 and 7; copy returned word lists                |
| 1E0     |     2 |       1 | Indexed event argument, excluding event code                  |
| 1E1     |     1 |       1 | Event argument count                                          |
| 1E2     |     5 |       2 | Decode a reference into type, player and index words          |
| 1E3     |     3 |       2 | Submit dice through command 10004                             |
| 1E4     |     1 |       1 | Selector 3                                                    |
| 1E5     |     2 |       1 | Command 10008 and choice-list refresh                         |
| 1E6     |     3 |       1 | Decode cached action into four words                          |
| 1E7     |     4 |       1 | Selector 4 action decoded into four words                     |
| 1E8     |     2 |       2 | Submit command 10007                                          |
| 1E9     |     4 |       2 | Submit command 10005                                          |
| 1EA     |     4 |       1 | Decode a cached result into two words                         |
| 1EB     |     3 |       1 | Indicator at selector index `4 − input`                       |
| 1EC–1ED | 1 / 2 |       1 | Selectors 23 and 26                                           |
| 1EE     |     7 |       2 | Selector 16, five separate output words                       |
| 1EF     |     2 |       1 | Selector 18                                                   |
| 1F0     |     5 |       2 | Round-related words and four seat values                      |
| 1F1     |     2 |       1 | Selector 14 boolean result                                    |
| 1F2     |     3 |       1 | Selector 17, copied values multiplied by 16                   |
| 1F3–1F4 |     1 |       1 | Selectors 24 and 25                                           |
| 1F5     |     1 |       2 | Cache the current event and arguments for replay              |
| 1F6     |     2 |       1 | Selector 19, four output words                                |
| 1F7     |     2 |       1 | Submit command 10009 with one word per player                 |
| 1F8     |     1 |       1 | Selector 12                                                   |
| 1F9     |     4 |       1 | Submit command with a signed count and VM word array          |
| 1FA     |     2 |       1 | Indexed cached choice                                         |
| 1FB     |     2 |       1 | Submit command 10014                                          |
| 1FC     |     1 |       1 | Selector 28                                                   |
| 1FD     |     3 |       1 | Command 10014 `[0, index, mask]`, return first resulting word |
| 1FE     |     4 |       1 | Selector 29 action decoded into four words                    |
| 1FF     |     2 |       1 | Submit command 10012                                          |
| 200     |     2 |       1 | Selector 11, fourteen output words                            |
| 201     |     2 |       1 | First selector 4 result                                       |

A null context returns zero or the declared void control, with `1EB` and
`1FA` returning `FFFFFFFF`. Native signatures and controls come from the selected
ABI. Typed-handle validation diagnoses wrong or released handles. Indexed event
queries retain unsigned word behavior, including `1E0(FFFFFFFF)` selecting the
event code. Dice, command-state gates, list filtering and packed references
follow the recovered native paths.

## Verification

`scripts/verify-native-tile-game.mjs FIXED_EXE IGNORED_REPORT` compares the JS
implementation against independent calls through the actual EXE native table.
The default bounds each two/four-player sequence at 360 events. Set
`CATSYSTEM2_EXTENDED=1` for 1,600 events per configuration. Observations include
controls, returned words, every event argument, all contiguous/shared/extended
VM bytes, handle lifecycle and cached-event replay.

The differential Node files add authored hand, public/concealed/added-kan,
riichi, response and historical-discard inputs. They compare score, fu, han,
limit, multiplier and decoded pattern results. Eight deal policies, special
commands, invalid state gates, packed-reference swaps and subsequent queries
have independent two-ABI sequences. The hand fixtures initialize a real round
before applying their authored records so AI pointer setup is valid in the
oracle. Comparisons cover observable results without requiring matching
internal layouts.

The pure Node World test restores two contexts and a pending event, advances
600 events independently, compares complete JS model/RNG snapshots and VM
bytes, and verifies release isolation. Its EXE loader throws if called. Private
EXEs are optional fixtures with the reviewed SHA-256/version check and explicit
missing-fixture skips.
