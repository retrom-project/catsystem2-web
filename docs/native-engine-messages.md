# Native task engine messages

[NativeEngineMessages](../src/native/engine-message.mjs) separates engine packets
from queued KCS user messages. A packet contains destination, sender, message,
two parameters and flags. Nonzero flags broadcast to immediate children when
the destination leaves a message unhandled. They do not enqueue it. The signed
32-bit ordered maps are read live: newly inserted later keys participate;
earlier keys wait for another walk.

Routing, handling and output initialization are independent. `dispatch` returns
`{routed, handled, result}`; `send` returns only `result`.
`NATIVE_UNWRITTEN_WORD` preserves an untouched output word. Query bridges call
`nativeEngineWord` before returning a word to KCS or native code. Void bridges
may ignore the sentinel. An absent task and a handled message without output
must not become an invented zero. Dispatch preserves the caller's context
object and writes `nativeUnhandled` back to it.

## Identity and route maps

`record.id` is the World's internal identity. `nativeID` is the engine number;
`namespace` identifies the Top that allocated it. A nested Top belongs to its
outer namespace while its children belong to its own namespace. A Top numbered
five constructs input zero and sound one, coexisting with its outer Top's
zero/one identities. The initial Top has namespace `null`; its own number is
reserved during allocation but absent from its registry.

`closestTop(worldID)`, `resolve(senderWorldID,nativeID)` and
`creation(parentWorldID)` expose these distinctions. Internal `send`/`dispatch`
accept World destinations. `dispatchNative` starts at a World sender with an
engine destination and follows the original vft+16/vft+20 path. A cached key
enters its stored branch directly. Missing keys climb parents until a Top
handles the route.

`nativeTaskRoutes` explicitly maps native key to World branch or `null`; it is
not reconstructed from the graph during sends. Factory registration updates
ancestors; manually sending registration to a cached branch need not do so.
Snapshots preserve this difference. Browser factory results normalize the
original task pointer to a native task ID. The raw PE reply carries the newly
allocated pointer from shared task memory, even when a lookup by that ID misses.

The Top factory allocates a task and initializes its clock before routing
registration message 2. The new task's parent stays null until the target
receiver accepts registration through Base. When a receiver such as UnderWater
consumes the message, the original ancestors still insert their first branch
for the new key. That key makes the Top existence query succeed, and the
frame walk can visit the same direct child twice. Ordinary routing still misses
the unattached allocation. A new factory call can reuse the number because it
checks the result of the recursive lookup. Base rejects a direct duplicate with
a null reply, leaving the Main42 GCALL word at its original sentinel. A different
parent can attach the new task in its own map while the ancestor retains the
first branch. A missing parent leaves the allocated task unattached.

## Base and Top contracts

Both Base builds implement registration 2, destruction request 3, kind 13,
recursive dump size/data 15/16, handled no-output 17, exit value 23/24 and pause
value 29. Dump headers contain 60 bytes and preserve supplied raw header bytes.
Type/name fields contain CP932 bytes; IDs and child counts are words. Owning
tasks reject known unfinished derived messages before Base's unhandled path.

| Top operation           | SDK 2.6.1.74              | Game 2.6.1.76      |
| ----------------------- | ------------------------- | ------------------ |
| Shared pointer/length   | 30                        | 32                 |
| Registry existence      | 31                        | 33                 |
| Input / sound native ID | 32 / 33                   | 34 / 35            |
| Write CSS task file     | 34                        | No branch          |
| Set / get path          | 35 / 36, CP932            | 37 / 38, UTF16     |
| Sound reset             | 37 → sound 192            | 39 → sound 194     |
| Extra word              | 38, raw +392              | 40, raw +652       |
| Top dump 15/16          | Shared bytes and children | Handled, no output |

Both constructors initialize the path to `.`. Default Top handling writes no
output, including kind queries. Existence tests the map, which excludes itself
and may contain null entries. The SDK CSS writer adds a 20-byte header containing
`CSS`, dump length and the caller's tag.

Shared data uses one byte view or a restorable `{kind:'vm',taskID,address,length}`
or `{kind:'engine',address,length}` reference. Original pointers survive zero
length. Wrapped PE payloads marked `nativePointer` retain their process address.
Snapshots resolve against the restored World rather than the previous VM.

## Destruction and frames

`unregister(record,{erase:false})` recurses through parents while matching keys
exist, then nulls those entries. It does not stop at Top boundaries. Such entries
still exist for queries and reserve their IDs. `erase:true` implements explicit
erasure; `release` uses it for immediate cleanup.

Game `5DCC80` finishes a complete child frame walk, then separately removes null
routes, then checks its own destruction flag. `pruneNullRoutes` supplies the
second phase. Base destructor `5DCF00` unregisters with `erase:false`, sends
immediate message 3 to each direct child and itself, then destroys children and
frees its map. Child messages use the parent's native sender ID and zero
parameters/flags. Derived cleanup and the World's lifecycle driver preserve
these phases; module evidence alone does not establish their integration.

Destroying a branch clears its own registration key. A key left by a rejected
child registration can still point at the released branch. The two original
lookups reach a null task map and fault with the low page protected. With the
emulator's low page mapped the same probe exhausts its instruction budget. The
World records a released branch and reports that error when traversal reaches
it, including after restore or reuse of the internal World ID. Explicit World
cleanup can still release the live tasks.

## Evidence

The World integrates these maps with its task lifecycle. Script destruction
enters Base destruction before releasing its VM, banks and image resources;
the native FES task has a different cleanup order. World shutdown releases
Top roots through the live child maps before cleaning any remaining objects.
This preserves valid borrowing between siblings encountered during parent
message broadcasts.

Script load queries its parent through message 176 with flags 1, retaining
the actual broadcast order and shared output location. A recognized bank
registers a private 512-word context. Frames and raw message 172 select that
context; the synchronous main45 wrapper subsequently reselects its caller.
An unsuccessful selection retains the previously selected context. Contexts,
names and selection belong to the bank checkpoint rather than duplicated
arrays on each task.

Every Script constructs its own numbered-string bank. Its parent-attachment
hook queries message 177 and replaces that bank with a borrowed parent bank
when present. A null reply retains the current bank and ownership. FES also
inherits its parent's bank through message 177. Public World tests cover absent
banks before D1, inherited and independent variable contexts, shared string
ownership, sibling broadcasts, synchronous messages, reload and fresh restore.
`verify-native-script.mjs` executes both actual Script constructors, parent
attachment and recovered message branches, with 724 comparisons per build. This
does not complete the remaining Script load/debug/dump contracts.

`scripts/verify-native-engine-message.mjs FIXED_EXE IGNORED_REPORT` executes the
original constructors, maps, factory, packet wrappers, routes, Base/Top handlers,
unregister helpers and frame null-entry sweeps. Game passes 1,387 authored cases;
SDK passes 1,388, including its full file writer. Comparisons include untouched
output, controls, all observed state, complete route maps, caller memory, file
bytes and dynamic visitation order. Another constructor probe covers both
profiles with four Top IDs each.

INPUT/SOUND device constructors call the original Base constructor in this
protocol probe; device behavior is outside its scope. CRT allocation, Windows
services and an authored user-handler mutation are explicit boundaries. Packet
instrumentation calls the complete original wrapper. Nine public tests retain
native result digests, scoped identities, context identity, shared aliases,
fresh restore and lifecycle phases. No proprietary assets, binary bytes or
decompiler bodies are distributed.

`scripts/verify-native-task-registration.mjs FIXED_EXE IGNORED_REPORT` adds 100
comparisons per profile through the original Main42, Top, Base and UnderWater
paths. It checks the distinct lookup, existence and child-enumeration results,
first-inserted routes, two visits to an aliased child and both fault probes.
`tests/native-task-registration.test.mjs` runs the same task topology through
authored KCS and the native task packet boundary. It restores the unattached
allocations, live routes and released-branch failures into fresh Worlds.
