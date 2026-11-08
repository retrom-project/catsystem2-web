# Built-in tile-rules contexts

Main natives `0x1D6..0x201` operate on the engine's built-in rule model through
32-byte contexts. Both frozen engines contain all 44 interfaces. The model's
136 tiles, two/four-player configuration, dice, initial 25,000-point scores and
event/choice flow identify mahjong rules. This identification is an inference
from the recovered behavior; the descriptive names in the catalog are ours.

[The adapter](../src/native/tile-game.mjs) executes the supplied engine's
original global constructor, complete native wrappers, rules, random generator,
vectors and destructors in the World's shared process. It does not substitute
JavaScript rules or a title-specific game implementation. The normal engine
entry point and platform bootstrap are not executed.

## State and ownership

Each context owns four dynamically sized word vectors, the current/pending event
words and an optional native object. All contexts address the same process-global
rule model. Starting a game through one context changes the model queried by
another context; event caches remain separate. The original global constructor
initializes the tile and player records once. Its destructor runs after every
remaining context has been released during process cleanup.

Opaque `tile-game` handles retain the context pointer. The process owns its bytes,
global model, vector allocations and RNG state. Checkpoints save that single
process state, then restore handle identity and VM providers in a fresh World.
They do not create a parallel JavaScript game state. A pending event cached by
`0x1F5` survives restoration and is returned by the next `0x1D9` call.

## Interface

Every operation except create takes a context as its first word. VM pointers are
translated by the original interpreter bridge; address zero is valid data. The
table gives argument counts including the context. Word results keep their raw
32 bits; functions described as queries are not automatically booleans.

| ID      | Words | Control | Operation                                                 |
| ------- | ----: | ------: | --------------------------------------------------------- |
| 1D6     |     0 |       1 | Create a context                                          |
| 1D7     |     1 |       2 | Destroy context and owned vectors                         |
| 1D8     |     9 |       2 | Configure player/options records and start the model      |
| 1D9     |     1 |       1 | Advance or replay an event                                |
| 1DA     |     2 |       2 | Submit command 10006                                      |
| 1DB     |     1 |       1 | Player count                                              |
| 1DC     |     1 |       1 | Current player                                            |
| 1DD–1DF |     3 |       1 | Selectors 5, 6 and 7; copy returned word lists            |
| 1E0     |     2 |       1 | Indexed event argument, excluding event code              |
| 1E1     |     1 |       1 | Event argument count                                      |
| 1E2     |     5 |       2 | Decode a reference into type, player and index words      |
| 1E3     |     3 |       2 | Submit dice through command 10004                         |
| 1E4     |     1 |       1 | Selector 3                                                |
| 1E5     |     2 |       1 | Command 10008 and choice-list refresh                     |
| 1E6     |     3 |       1 | Decode cached action into four words                      |
| 1E7     |     4 |       1 | Selector 4 action decoded into four words                 |
| 1E8     |     2 |       2 | Submit command 10007                                      |
| 1E9     |     4 |       2 | Submit command 10005                                      |
| 1EA     |     4 |       1 | Decode a cached result into two words                     |
| 1EB     |     3 |       1 | Selector 11 element                                       |
| 1EC–1ED | 1 / 2 |       1 | Selectors 23 and 26                                       |
| 1EE     |     7 |       2 | Selector 16, five separate output words                   |
| 1EF     |     2 |       1 | Selector 18                                               |
| 1F0     |     5 |       2 | Round-related words and four seat values                  |
| 1F1     |     2 |       1 | Selector 14 boolean result                                |
| 1F2     |     3 |       1 | Selector 17, copied values multiplied by 16               |
| 1F3–1F4 |     1 |       1 | Selectors 24 and 25                                       |
| 1F5     |     1 |       2 | Cache the current event and arguments for replay          |
| 1F6     |     2 |       1 | Selector 19, four output words                            |
| 1F7     |     2 |       1 | Submit command 10009 with one word per player             |
| 1F8     |     1 |       1 | Selector 12                                               |
| 1F9     |     4 |       1 | Submit command with a signed count and VM word array      |
| 1FA     |     2 |       1 | Indexed cached choice                                     |
| 1FB     |     2 |       1 | Submit command 10014                                      |
| 1FC     |     1 |       1 | Selector 28                                               |
| 1FD     |     3 |       1 | Command 10014 with two words, return first resulting word |
| 1FE     |     4 |       1 | Selector 29 action decoded into four words                |
| 1FF     |     2 |       1 | Submit command 10012                                      |
| 200     |     2 |       1 | Selector 11, fourteen output words                        |
| 201     |     2 |       1 | First selector 4 result                                   |

A null context returns the original zero result or void behavior; `1EB` and
`1FA` return `FFFFFFFF`. It does not touch VM destinations. Live-context bounds,
mandatory outputs, packed action/reference fields and command-state gates are
executed by the original functions. Invalid native memory access remains a
diagnostic; the adapter does not replace it with success or clamp indices.
Several query names retain their selector number because a stronger user-facing
meaning has not been established independently.

## Verification

`scripts/verify-native-tile-game.mjs` executes **6,082 complete wrapper calls** per
profile, with **109,608 comparisons** each, **219,216** total. All 44 wrappers are
exercised, with null contexts, unsigned index boundaries, distinct output buffers,
local/shared/extended VM addresses, two/four-player sessions and **47 distinct
events**. Both sides run the original complete rule model and compare the global
state, context/vector records, all VM bytes, controls/results and heap ownership.
The original constructor/destructor and cached-event replay are included.

Authored integration tests also create two contexts in a World, restore a pending
event into another World, advance the same dealt hand independently, compare
events/model/VM bytes and verify release isolation and final cleanup. Tests mount
no game assets. The engine image remains an optional, user-supplied test input.

The platform boundaries are the reviewed CRT allocator/Win32 services, authored
KCS records and opaque browser handles. The differential run does not enumerate
every possible hand, scoring combination or rule option. The wider emulator's
system scripts, save/gallery/recollection modes and browser presentation remain
separate acceptance work.
