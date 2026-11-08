# Native configuration queries

All six interfaces execute their complete original wrappers and helpers in each
fixed engine. Formatting keeps original source bytes and uses the actual KCS
memory translator. No classifier, category lookup or query body is replaced.

| ID  | Arguments                              | Result                              |
| --- | -------------------------------------- | ----------------------------------- |
| 24D | Two VM output pointers                 | Void; writes two Settings words     |
| 25D | Formatted filename                     | Legacy sound group gain             |
| 25E | Formatted filename                     | Legacy VOICE play word              |
| 25F | Formatted filename                     | Legacy VOICE master-volume word     |
| 2A2 | Formatted filename, formatted category | INT row index, or FFFFFFFF          |
| 34C | Formatted filename                     | Legacy VOICE row index, or FFFFFFFF |

The sound queries use the existing live VOICE blocks and eight SOUNDGROUP
records. They retain directory-before-prefix classification, first-match row
order, group-type comparisons, mute gates and original unmodified word values.
The modern sound tree does not replace these legacy getters.

`2A2` compares category names without case. The special category `sound` first
uses the SoundConfiguration loaded flag. A loaded tree matches filename heads
before descending to children, in original record order; its INT field selects
the archive row. Without that flag it uses the legacy VOICE record's INT field.
An empty category can match an empty INT row; no invented missing-row filter is
applied.

The shared process reads derived 332-byte INT records from the same
`NativeResources.entries` consumed by mounted-resource lookup. Its 196-byte sound
records project the single `NativeSoundConfiguration` tree, including inline and
heap strings, child vectors, defaults and current words. Game XML text bytes are
UTF8; SDK text bytes are CP932. These guest descriptors own only their projection
allocations. They do not introduce another authoritative sound tree or file
catalog. The query probe supplies authored records; it does not establish the
complete XML loader or every sound-tree writer.

`24D` unconditionally copies Settings offsets `C484/C488` in the game and
`BA1C/BA20` in the SDK. Both lie just after the 64-word automatic-message preset
array. The full Settings constructor clears that area. Their higher-level
purpose has not been established, so the adapter preserves their actual guest
words and snapshot identity without assigning a guessed field name or constant.
Aliased output pointers retain the original sequential writes.

`verify-native-configuration-queries.mjs` compares **4,774 complete wrapper calls
and 28,580 checks per profile**, **57,160 checks total**, against independently
authored native records. It covers formatted values, UTF8/CP932/invalid bytes,
nested and shadowed heads, loaded/unloaded configuration, group and mute state,
four VM regions, overlapping outputs, adjacent GCALL words and complete VM byte
canaries. The public three-test set additionally checks live configuration
changes, stable projection allocations and a fresh SDK World with independent
sound state and preserved raw Settings words.
