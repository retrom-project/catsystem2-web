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
