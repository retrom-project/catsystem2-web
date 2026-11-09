# Plane registration, input-owner query, bitmap mask and wheel reset

Main `5F`, `6B`, `18A` and `3A9` execute their complete original wrappers. Root queries
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

`5F` passes a literal flags word to the Graph receiver. It uses position
minus base, the raw model size, and signed truncation of base Z to register
the hit area. A move updates the existing rectangle without reordering the
input list. Legacy text uses this geometry with its retained graph.
`scripts/verify-native-plane-input.mjs` compares 201 cases per frozen engine
against the original Graph receiver, including signed and invalid float
conversions, the full-screen expansion, and the untouched outer output word.
Both mounted legacy text tasks move and unregister the region after a fresh
restore while the original World retains its own region.

`scripts/verify-native-input-commands.mjs` checks 388 complete calls and 1,843
comparisons per frozen engine. Its explicitly authored task receiver covers
returned and unwritten Root/input queries, route results, missing/zero targets,
DWORD limits, bitmap prefix identities/aliases, canaries and adjacent argument
reads. Uninitialized stack locals are given an explicit CC input pattern.

The public SDK World test exercises two Tops that reuse the same native task
IDs, a real original bitmap mask, independent mask ownership after image
release, both real device wheel words and untouched neighboring canaries.
Restoring a fresh World preserves the mask and device identity; changes in the
restored World leave the original input and bitmap state independent.
