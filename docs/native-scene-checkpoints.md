# Scene-local checkpoints

Main323 creates an independent owner containing a CST reader and a history
owner; Main324 destroys both and releases the enclosing RefBuffer. Main219
instead replaces the reader/history fields of its real Script callback owner.
The two modern builds use 304-byte and 324-byte readers respectively, plus
the independent 8-byte history owner. Neither Scene35 nor Scene38 is a Task
kind: those are ledger counts of explicit scene-family Main entries. The
related implicit taskScene and historyCursor entries have separate coverage.

The own74 reader type method consumes F0/F1 records as current filename/value
markers. Its message-count scan performs the same writes. Own76 returns the
types without those marker writes. The shared reader uses the build policy
at these consumption points; the earlier builds retain their existing type
policy. Only74 has the newly proved message-count side effects enabled.
The74 reader has no translation tail and does not request CSTL input. The76
localization methods and configured language prefixes have separate own-build coverage below.

The modern reader fixture runs actual Main323 owners and factory-created
Script callbacks through mounted CST/zlib loading, CP932 byte copies, count
sentinels, missing-file retention, seen/path operations and independent cold
restore. Before a successful load, the original block/line fields are untouched
heap bytes; their raw captures do not establish portable initial cursor values.
An implicit text call with a mapped destination and no readable record remains
diagnosed rather than pretending that a native null-source copy succeeded.
Separate ignored receipts use the shipped sc01/01 CST entries, exact container
and entry hashes, full native/current KCS frames and cold reader state. These
are short resource/owner bridges, not full application or product-route tests.

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

The modern Scene history string wrappers also have own-build typed Script and
Main323 owner comparisons. The `.74` and `.76` factories each create an empty
caller string bank. Main334/335 and Script Main229/230 retain independent
history copies, distinguish a missing string table from an absent key in an
existing table, clamp the path index, and truncate stored narrow strings at 62
bytes without repairing a split CP932 character. Main336/231 capture the current
caller bank only for parsed `$str` references; later caller-bank edits do not
change the captured values until another capture. Main337/232 expand found,
missing, signed, hexadecimal, and literal reference forms in place.

`modern-scene-strings.test.mjs` replays 41 complete Main frames per modern build,
checks the serialized caller bank and dirty flag, and performs three independent
checkpoint restores per build. The original receipts retain all native history
record bytes. Newly allocated record padding after a string terminator remains
uninitialized native data; the portable comparison checks logical names, keys,
and string bytes through their terminators. This group does not establish raw
CSS padding round trips, cross-task receiver lookup, or localized reader tails.

The modern cross-task wrappers use the source Script's history even when the
source has no interpreter. Main234 copies both native history lists into the
caller's existing context, including self-copy; a missing target or a target
without Scene data returns zero. The copied history remains independent of
later source edits, clear, and Main219 replacement. Main233 reads the source
history when expanding references and preserves missing references verbatim.
A caller without Scene data returns before reading its text buffer.

The own `.74` wrappers send Script raw message 173; `.76` sends 175. The `.74`
`taskQueries` mapping converts only kind12 raw173 to semantic175, with the inverse
recorded separately. An empty Script context writes two zero pointer outputs
without writing the message result. A loaded context's physical reader/history
pointer outputs remain protected outside original-engine ownership; the ordinary
Main233/234 bridge uses the reviewed typed Scene resource instead. Canonical
`sendEngine` and raw `sendNativeEngine` have separate controls so the raw query
cannot become the semantic173 queued-message operation. The tests retain full
36-frame Main comparisons per build and three cold restores per build. No FES
source receiver or raw pointer layout is inferred from the Script cases.

Own modern Main385/386 and Script Main239/249 now have a complete CSS record
comparison through Main238/244, the original history parser, native file
save/release/load (245/246/247), and independent GAME_SAVE-only reconstruction.
The authored input includes nonzero bytes after the NUL in each 32-byte name
and 64-byte string field. These bytes are defined input: all imported/exported
48-byte records and 72-byte string pairs, the complete file payload, and the
compressed CSS file match the own-build native result. No native padding is
replaced or regenerated. Direct and Script owners keep their separate histories;
missing entries and missing target contexts return zero without changing them.

`modern-scene-css.test.mjs` replays 35 native Main frames per build, restores two
independent internal checkpoints per build, and reconstructs a fresh World from
only the native `save0071.dat` GAME_SAVE file per build. All writes use isolated
fixture storage. The original native file providers are explicit memory-backed
Win32 leaves; this is an authored SDK file/owner bridge, not a product-route or
user-record measurement. History extras, full Scene checkpoints, and localized
reader variants retain separate evidence requirements.

The modern history-extra wrappers have own Main934/978/979/981/993 comparisons.
An attached global-file snapshot belongs to the last path record; releasing the
source file preserves that snapshot. Main979 constructs an independent file
owner, and Main981 copies extras by matching list positions without replacing
the destination strings or names. Main993 copies only path names and values,
drops strings and extras, and clears the path on self-copy. The native raw CTS
header's first DWORD is a process data pointer. Both own importers allocate a
new data buffer and ignore that saved pointer; only this DWORD is normalized
in portable comparisons. Capacity, used size, tag, and payload are compared
without masks. The 38 complete Main frames per build also cover CP932 aliases,
missing extras, independent file releases, and three checkpoint restores.

Modern full Scene checkpoints have an own typed Main/VM bridge through the
complete startup XML Settings reader. The fixture selects two local variables
through `GAME/flag` and two strings through the mounted `config` XML. The native
FileServer reads the actual selector file for Main991/992; Main994 follows its
own branch/prune path. The comparisons cover ordered checkpoint chains, earlier
Scene fallback, signed position misses, missing selector files, selected and
unselected caller-bank values, all 64 initialized variable words, and three cold
restores per build. The JS World fixture explicitly applies the same startup
configuration supplied to the native Settings reader.

Each chain is decompressed and compared by its defined position, variable
payload, string IDs/bytes and declared string size. The string serializer's
final eight unread padding bytes can change native compression length and chain
offsets; those raw bytes remain in the original captures. The comparison
validates each native/JS chain's internal offsets separately and excludes only
that unused tail from logical bank contents. It does not assume equal compressed
bytes or invent initialized padding. Existing method-level selector/checkpoint
matrices remain separate evidence; this group adds 36 real Main frames per
modern build with the real caller/Settings/FileServer bridge.

Modern Cursor6 has an own real Main323 history/FileServer/CST/379 constructor
bridge, covering 0/1/3/5 slots, rotation, final-block exclusion, text/speaker
concatenation, command ordinals, misses, independent release, and cold restores.
The cursor's readers call the same own Type methods as direct readers: `.74`
therefore consumes F0/F1 markers while scanning text or commands, preserving the
filename used by subsequent refresh checks. `.76` retains its no-marker Type
behavior. The cursor policy is explicit for `.74`; it does not infer a new
legacy-build policy. All Main frames and defined row/path/block/valid/body and
filename fields are compared; no large native slot allocation is performed.

The `.76` localized wrappers have a full own XML language-vector/reader-factory
bridge. The native Settings member at `+e0cc` contains 56-byte language records;
Main323 and Script initialization register the actual prefixes with their reader.
Main1033/1035/1037/1038 comparisons cover raw CP932 versus UTF-8, speakers,
first-message segment joining, later-message empty output, missing-prefix
fallback, command text, mapped misses and old-buffer length behavior. A CSTL may
contain a subset of registered languages, no languages, or additional languages.
The native loader binds only registered prefixes: an additional unregistered
prefix does not invalidate matching translations and cannot itself be queried.
The `.76` policy now preserves that behavior instead of rejecting the entire
sidecar. No `.74` or legacy translation behavior is inferred from this result.

`NativeSceneData.load` receives the current Scene behavior object as its fourth
argument; its Scene and Cursor callers use the same translation policy without
new persistent fields. Three-argument low-level readers keep their explicit
model defaults. The localized fixture passes the same own-proved language list
to the ordinary World constructor and replays 41 complete native Main frames,
with five independent cold restores including extra-language and empty tables.

Language prefixes are literal native map keys. An additional own nine-frame
control registers `__proto__` through the real XML reader and retrieves its CSTL
text through direct and Script wrappers. Unregistered `toString` and
`constructor` spellings fall back to the source text. The CSTL parser now creates
own data properties, and the reader checks own membership before lookup, so JS
object members cannot become translations or hide a registered label. Two
additional independent cold restores preserve the literal key without changing
the checkpoint codec or layout.
