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
