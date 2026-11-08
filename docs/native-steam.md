# Native Steam state

The fixed game engine exposes main `411..414`; the fixed SDK engine does not.
`411` initializes the singleton once. Failed initialization still leaves an
allocated manager, and subsequent initialization does not retry. `412` formats
the achievement name and unlocks a known cached entry. `413` formats the name
and returns whether its cached byte is nonzero. `414` clears every cached flag
and calls `ResetAllStats(1)` when the stats interface exists. Its GCALL result
word is unwritten, so the VM receives the original fresh `CCCCCCCC` sentinel.

Achievement names compare as exact bytes. Unknown names do not create entries.
The cached flag changes before `SetAchievement` and `StoreStats`; their boolean
results do not roll it back. Unlocking an already unlocked achievement does not
call the SDK again. A query reads the cache rather than asking the SDK. Reset
clears cached flags even when the cache exists without its SDK interface.

`NativeSteam` is an optional browser platform service. A provider supplies
`initialize(): boolean`, a complete `achievements: Map<string, boolean | byte>`,
`achievement(name)` implementing SetAchievement followed by StoreStats,
`resetAllStats(1)`, `enableScreenshot(word)`, optional `isBroadcasting()` and
`shutdown()`. Only operations actually requested need their provider methods.
`refreshAchievements(map)` accepts a platform callback's complete cached state.
An absent map represents an absent cache. `statsReady = false` represents a
temporarily absent stats interface. No provider means unavailable Steam.
Windows Steam entry points are not executed by the browser player.

One Engine owns the service across replacement Worlds. Checkpoint restoration
does not rewind external achievement state, and replacing a World does not
shut down its Engine's provider. Standalone Worlds own and close their service.
FES initialization refreshes its host's manager reference; see
[FES Steam commands](native-fes-steam.md).

The actual game handlers are `6549E0`, `6549B0`, `654940`, and `654990`.
The original singleton is `5AEA30`, its constructor `5AEB40`, cache update/query
`5AF320` / `5AF400`, and reset traversal `5AED60`.
`scripts/verify-native-steam.mjs` executes these original handlers, formatter,
constructor and map traversal. Only external SDK calls are authored boundaries.
It compares 434 results/call traces/cache states across missing managers,
failed/successful initialization, missing caches/interfaces, repeated unlocks,
empty/unknown/long/UTF-8/malformed names, reset and false SDK results. Public
tests also cover KCS/FES sharing, fresh World restoration and provider lifetime.

The broadcast query has separate engine state. `5AEDC0` optionally asks the
Steam Video interface for a side effect, ignores both its return and output,
and reads the engine's raw broadcast flag only when its author-mode setting is
nonzero. A missing Steam singleton bypasses that setting gate. Menu command
`40096` toggles the actual engine flag; its checkmark refresh is author-mode
gated. The flag remains part of the native process checkpoint.
`scripts/verify-native-broadcast.mjs` compares 267 outcomes using the original
helper, full menu toggle/refresh and the main `41E` return-title request.
The latter posts window message `468`, which reaches the canonical Script
event queue through the original engine event envelope. Public two-profile
tests cover event routing; game-profile tests additionally cover this request,
broadcast toggle and independence after fresh process restoration.

The provider reset operation follows Steam's documented
[ResetAllStats](https://partner.steamgames.com/doc/api/ISteamUserStats#ResetAllStats)
contract; it is not a store/flush-only operation.
