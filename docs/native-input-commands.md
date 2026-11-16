# Plane registration, input-owner query, bitmap mask and wheel reset

With an explicit original engine or loading owner, `5F` retains its complete
original wrapper, and `18A` retains its original wrapper and mask helper.
Root queries use the caller's Top namespace; SDK's Root range remains distinct
from its ordinary two-slot message offset. Original bitmap aliases share their
backing, and the wrapper passes its first DWORD to the plane's alpha-mask
service, which owns a separate copy of the resulting packed bits.

In a normal World without that original owner, `18A` takes a native task ID
and an owned typed bitmap handle. It sends canonical Plane97 (SDK raw95), with
zero wParam and transport flags and the bitmap handle in lParam. Task0 is
still dispatched in the caller's real Top namespace; bitmap0 clears the mask.
Control2 leaves the VM result unwritten. The original Game649070/SDK515840
wrappers and their first-DWORD getters establish the corresponding pointer
packet; a JS bitmap handle is not cast to a native wrapper or pixel pointer.

The existing NativeImages alias/dataHandle authority and Plane97 mask service
sample canvas dimensions and source offsets. Nonzero 32BPP alpha produces
packed bits in low-bit-first order, copied into the Input region. Releasing
both source and alias does not free that copied mask. A fresh World restores
its own copy, and clearing it leaves the prior World unchanged. The normal
GCALL tests cover this owned 32BPP domain; the already reviewed 24BPP helper
domain is unchanged. No second bitmap table, new codec or automatic original
backend is introduced.

In a normal World, `5F` skips target0 before reading its second argument or
sending a packet. For an owned loaded SimplePlane (kind2) in the caller's
zero-ID Top namespace, it sends canonical89 (SDK raw87), with the caller's
native task ID in wParam, the literal second DWORD in lParam and transport
flags0. The existing Graph receiver derives the hit rectangle and priority
from its model/MOT state and retains the literal binding word; movement updates
the existing region without changing its priority or sequence. Control2 never
pushes a VM result, and the ignored local reply slot is not the universal output.

This finite normal path does not interpret that literal as a kind6 BasePlane
RECT pointer or certify nonzero-Top namespaces. These unreviewed receiver/owner
domains are rejected, and unloaded kind2 geometry keeps the existing explicit
error. The retained region flags are opaque JS metadata, separate from transport
or Input filtering flags. No new Graph/Input owner, ABI status or original
backend fallback is introduced.

In a normal World, `3A9` queries the caller's actual Top for its InputTask, then
sends that task the wheel-cancel message. Both envelopes keep zero flags, wParam
and lParam; the transport results are ignored and control 2 leaves the VM result
unwritten. The InputTask's service clears its existing browser wheel bindings.
The Root query uses each ABI's own message number and returns the actual native
task ID, including zero, independently from the transport's routed status.

`6B` uses that same owned Root query, followed by Input message 133 (SDK raw 131)
with its one raw owner word in wParam and zero lParam and flags. A registered
region returns its exact active DWORD, including zero and high bits. Control 1
pushes that word to the guest stack; the shared raw-word signature and
`resultWritten: null` remain unchanged.

When an original engine or its loading owner already exists, `3A9` retains the
complete original wrapper and actual window device helper, clearing both native
wheel counters and the pending browser wheel pulses. An adapter alone does not
open an original process. The ordinary path requires a complete owned Root/Input
graph whose Root has native ID 0 in the caller's namespace; it does not replace an unwritten original query's interface-pointer alias
with a fabricated zero or pointer.

`6B` also retains its original wrapper when an original owner exists. If its
Input receiver leaves the result untouched, that wrapper copies the incoming
ECX scratch word to the VM output. The ordinary path covers registered regions;
it does not model arbitrary native register contents for a missing region.
The typed receiver preserves `NATIVE_UNWRITTEN_WORD`, and the word bridge rejects
it. No zero, Boolean or CCCC result is invented, and native missing-case
equivalence is not claimed.

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
