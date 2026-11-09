# Scene-local checkpoints

Main `3DF` appends a local checkpoint to the last path entry in an explicit scene resource. Main `3E0` searches that path backwards and restores it. Main `3E2` branches the history at a scene index and position. This is the original engine's scene-local state used by history and replay; it is separate from a complete browser World checkpoint.

The original selector constructor runs in the shared PE process: game `5B0BA0`, SDK `492A60`. It reads the `config` resource, parses `localstr` with the original XML and comma/integer routines, and selects variable indices using the current eight local flag ranges. The browser keeps one authoritative variable bank, string bank and scene history. It serializes selected variable index/value pairs and a temporary selected-string bank using the recovered layouts and pinned zlib 1.2.3 level 9.

Each extra-data record has five DWORDs: older-record offset, compressed-record length including its 20-byte header, variable byte count, string-bank byte count, and position. A new record precedes the older chain. Restore compares positions as signed DWORDs, scans the requested entry's chain, then falls back to earlier scene entries. An earlier entry takes its newest checkpoint regardless of the requested position. Successful selection writes both caller VM words before restoring banks; misses preserve them. Only the selected variables and strings change.

`scripts/verify-native-scene-checkpoint.mjs` executes both complete original wrappers, original variable/string banks and history objects. Each PE passes 7,965 comparisons across 260 calls: chained snapshots, backwards positions, signed limits, earlier-scene fallback, empty histories, configured ranges including invalid bank indices, duplicate/malformed string selectors, and complete VM/bank state. The original string-bank writer reports eight unread padding bytes containing previous heap contents. The comparison records these bytes but excludes them from semantic payload equality; compressed sizes can therefore differ. The browser emits zero padding, and its actual compressed records are also fed into the original restore wrapper.

Branching removes checkpoints whose signed positions are at or above its argument, updates the selected path value, and removes later path entries. Two original quirks are retained: finding no older checkpoint preserves its extra-data bytes, and trimming an earlier entry writes the last entry before deleting the tail. The strict scene index and the wrapped, signed tail index have different boundary behavior. Neither operation changes the seen list or caller banks. Main `3E1` copies only scene names and values; copying a scene onto itself clears its path first.

`scripts/verify-native-scene-branch.mjs` executes complete `3E2` and `3E1` wrappers against both frozen PEs. Each passes 3,049 comparisons across 613 calls, including full path/seen serialization, bank/dirty state and all four VM domains. Only `3E1`'s uninitialized bytes after each copied name terminator are excluded; all defined metadata and content are compared.

Main `3A6` formats both names as raw VM strings before it copies the
source's unsigned seen value. The original history folds ASCII bytes
(including matching bytes in multibyte names), does not strip extensions,
and adds a record only when the source matches and the destination is new.
The raw alias survives a fresh history restore. The original SDK `528A80`
and game `642780` wrappers pass 144 comparisons across 48 calls each in
`scripts/verify-native-seen-alias.mjs`, covering all four VM domains and
untouched path records.

Two public fixture tests dispatch through World, restore into a fresh World, continue storage, restoration and branching, and check independent ownership, raw UTF-8/invalid bytes, unaffected outside variables/strings, original branch quirks, self-copy and null-scene behavior. Full game history/replay UI acceptance remains a separate requirement.
