# Scene-local checkpoints

Main `3DF` appends a local checkpoint to the last path entry in an explicit scene resource. Main `3E0` searches that path backwards and restores it. Main `3E2` branches the history at a scene index and position. This is the original engine's scene-local state used by history and replay; it is separate from a complete browser World checkpoint.

The JS selector reads the `config` resource, parses `localstr` with the ABI XML encoding and recovered comma/integer rules, and selects variable indices using the current eight local flag ranges. This replaces the original constructor in both ABIs. The browser keeps one authoritative variable bank, string bank and scene history. It serializes selected variable index/value pairs and a temporary selected-string bank using the recovered layouts and pinned zlib 1.2.3 level 9.

Each extra-data record has five DWORDs: older-record offset, compressed-record length including its 20-byte header, variable byte count, string-bank byte count, and position. A new record precedes the older chain. Restore compares positions as signed DWORDs, scans the requested entry's chain, then falls back to earlier scene entries. An earlier entry takes its newest checkpoint regardless of the requested position. Successful selection writes both caller VM words before restoring banks; misses preserve them. Only the selected variables and strings change.

`scripts/verify-native-scene-checkpoint.mjs` compares JS selectors and normal append/restore/prune entries against complete original wrappers, original variable/string banks and history objects. Each PE passes 8,103 comparisons across 260 append/restore calls and three branch calls: chained snapshots, backwards positions, signed limits, earlier-scene fallback, empty histories, configured ranges including invalid bank indices, duplicate/malformed string selectors, and complete VM/bank state. The original string-bank writer reports eight unread padding bytes containing previous heap contents. The comparison records these bytes but excludes them from semantic payload equality; compressed sizes can therefore differ. The browser emits zero padding, and its actual compressed records are also fed into the original restore wrapper.

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

Main `14C` and task-local `E3` also query the original byte sequence.
`14C` removes the final extension unless it first encounters a slash byte;
`E3` leaves the name intact. Both return zero for the empty-name record
that ends a native lookup. Main `148` and task-local `DF` keep the same
extension distinction when marking a scene. They retain the original
name bytes and update existing values as unsigned maxima. An empty
formatted name succeeds without adding a record.
`scripts/verify-native-seen-lookup.mjs` executes 98 queries and 122 writes
per frozen engine, including invalid CP932 sequences, Shift_JIS trail
bytes that equal a separator, formatter and owner boundaries, and the
untouched path list. Undefined stack bytes after the name terminator
are excluded from comparison of newly inserted records.

Main `149` and task-local `E0` append path names with the same bytewise
extension distinction. The original only coalesces a match with the
last path record. Main `14D` and task-local `E4` copy the raw name and
position into caller memory and clamp an oversized unsigned index to the
last entry. `3E1` copies these names without decoding and re-encoding them.
`scripts/verify-native-scene-path.mjs` compares 130 appends and 82 reads
per engine, including both result conventions, overlapping output pointers,
empty lists, and unchanged seen data. The branch and copy oracle also uses
an undecodable CP932 name.

Two public fixture tests dispatch through World, restore into a fresh World, continue storage, restoration and branching, and check independent ownership, raw UTF-8/invalid bytes, unaffected outside variables/strings, original branch quirks, self-copy and null-scene behavior. Full game history/replay UI acceptance remains a separate requirement.

Public IndexedDB acceptance stores a complete World and a CSS save, reloads the browser document, and restores CSS banks and scene-local state through normal native dispatch. The JS-only fixture rejects any attempted EXE load. [Browser acceptance](../tests/browser/public.spec.mjs).
