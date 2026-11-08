# Input-owner query, bitmap mask and wheel reset

Main `6B`, `18A` and `3A9` execute their complete original wrappers. Root queries
use the caller's Top namespace; SDK's Root range remains distinct from its
ordinary two-slot message offset. Source bitmap aliases share their original
backing, and the wrapper passes that actual pointer to the plane's alpha-mask
service. The mask helper runs in the original engine and owns a separate copy
of the resulting packed bits.

`3A9` resolves the Top's InputTask and invokes its wheel-cancel service. This
executes the actual window device helper, clearing both native wheel counters
and the corresponding pending browser wheel pulses. `6B` preserves raw active
words and the original unwritten-stack result when the receiver does not write
an output; no Boolean or default-zero result is substituted.

`scripts/verify-native-input-commands.mjs` checks 291 complete calls and 1,358
comparisons per frozen engine. Its explicitly authored task receiver covers
returned and unwritten Root/input queries, route results, missing/zero targets,
DWORD limits, bitmap prefix identities/aliases, canaries and adjacent argument
reads. Uninitialized stack locals are given an explicit CC input pattern.

The public SDK World test exercises two Tops that reuse the same native task
IDs, a real original bitmap mask, independent mask ownership after image
release, both real device wheel words and untouched neighboring canaries.
Restoring a fresh World preserves the mask and device identity; changes in the
restored World leave the original input and bitmap state independent.
