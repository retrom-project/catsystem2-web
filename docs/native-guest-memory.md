# Native VM extension blocks

SDK63 Main27/28/237 and SDK67 Main237 now use the shared KCS extension-block
implementation after each exact executable completes its own normal lifecycle.
Main27 returns an address in its owning VM; it is not a process pointer or a
cross-VM numeric address. This group compares the mapping role and bytes, not
numeric equality between original and JavaScript addresses.

The original normal group uses 0/16/64-byte requests, explicit fill/copy through
Main35/36, LIFO release, and a fresh allocation after release. A zero-sized node
returns 0xffffffff without an addressable span and stays owned until VM disposal.
Positive allocations are cleared before use. Main28 returns a success word;
Main237 writes that word into the original temporary result cell but returns
control2, so GCALL publishes no value. ABI `resultWritten` records that physical
store and does not change the public void reply.

Fifteen target and fourteen dependency/bootstrap calls per build run in real
CRT, resource and Script/Main143 VM owners with unchanged whole text. Current
World callers replay every owned byte and seven independent cold continuations
per build. The existing internal block codec is used without a new generation;
native GAME_SAVE/CSS layouts are unchanged. There is no task-message/update
service associated with these per-VM allocations.

Foreign addresses, address-as-number use, overlapping copies, stale/double
release and allocation extremes remain outside this group. Existing mapped-read,
allocation-limit and ownership guards remain in force. The shared legacy
rectangle group uses separate caller-owned 16-byte spans and is documented in
[native-rectangles.md](native-rectangles.md).

## SDK23 normal copy/fill consumer bridge

Main35 in fixed SDK23 `9f3a5ad0…` uses the same already implemented forward
8-byte/4-byte algorithm family selected by `copyUsesMMX`. Its normal initialized
helper was observed taking the 8-byte loop for 16-byte spans and the 4-byte MMX
loop for 12-byte spans. The SDK23 profile now selects that existing algorithm.
Forward overlapping chunks can read bytes changed by an earlier chunk, so a
whole-span snapshot copy was incorrect. Separate spans, identical aliases,
backward overlap, low-byte fill and complete canaries are also checked.

The shared implementation validates nonzero VM spans before any write. The
original SDK67 helper's raw physical-NULL shortcut does not prove that any
nonzero unknown VM address is a no-op; the old two expectations are replaced by
actual loaded-VM rejection controls for both SDK23 and SDK67. No VM address is
invented to stand for a process NULL, and zero is still a valid mapped VM offset.
A zero-length custom copy performs no byte access. SDK63 and the modern builds
are not given this copy algorithm by inference from the SDK23 sample.

`sdk23-numeric-memory.test.mjs` compares the original byte order, then consumes
an overlap-dependent DWORD through Main211/210 and the formatter. A retained
before-fix control reads a different value; the corrected chain reads
`0x21222324` (`555885348`) and keeps it after source-prefix overwrite and an
independent current cold continuation. The original whole-text/normal cleanup
and pure VM checks use the current checkpoint contract. This is a bounded native
helper proof, not a claim about arbitrary C memcpy overlap or alternate CPU modes.

## Current non-LIFO offset diagnostic

Main27 returns a virtual extension-segment offset, not a stable process pointer.
A deterministic ordinary VM sequence on both fixed0e9b and6cd allocates A16/B64,
records A8192/B8208, and stores `314159` at B and `2718` at B+16. After releasing A,
the old number8208 selects B+16: parsing reads2718, an ordinary string append writes
there, and freeing that old number returns0 while B's storage remains owned.
The beginning of B still contains314159. This distinguishes virtual lookup changes
from moving or already-released storage. The current snapshot retains that same
interpretation; host references normalized before deletion retain their block ID.

The complete own63 allocation, forward/inverse lookup, free and list-erase helpers
statically use the same current-list length sums and remove the erased node without
a hole. This is not evidence of a Web-only regression and no stable-address or
allocator-schema change is made. Original non-LIFO behavior has not been dynamically
captured, so the original finite LIFO qualification remains the boundary. Do not
keep an old numeric offset as an opaque handle after deleting an earlier segment.
The current diagnostic and both baseline outputs are preserved separately from the
configuration checkpoint; see `native-cross-build-configuration-checkpoint.test.mjs`.
