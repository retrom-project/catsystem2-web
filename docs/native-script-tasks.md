# Script tasks and debugging

SDK23's separate fixed-PE message bridge is covered by
`tests/sdk23-task-message-context.test.mjs`. Its own Main69/70 wrappers send
raw159/160 to the Script receiver; the Web receiver uses canonical172/173.
The normal true-host group executes50 full GCALLs in9 complete Root updates.
Its actual parsed recipient receives16 copied bytes, can change the tag word
before synchronous return, and consumes queued packets in order at its later
update. An active self has no armed wait and returns0; an unloaded parent
Script returns1 without delivery. A wait's idle return0 leaves its destination
unchanged. A queue retained over reload can be dropped by the first update
before the replacement VM has armed a wait; retention does not promise delivery.

Final World shutdown preserves each live Top's already owned Input service until
all task destruction callbacks finish. The native child retirement order still
removes the Input task before later Script/FES children. A parsed child handling
its normal retirement notification can therefore disable its registered Plane
through Main105 while the original Input task record is already gone. This
temporary service ownership does not recreate a task or change raw routing;
an Input absent before shutdown still fails the normal availability guard.
The service references are released even when a callback fails. Concurrent
World close callers share one cleanup pass and its rejection, while subsequent
closes of the completed World remain harmless. No checkpoint or native save
layout changes are involved. `tests/native-world-input-retirement.test.mjs`
covers five-build retirement, independent modern cold continuations, concurrent
close, missing-provider protection and cleanup after an actual callback fails.

Eight independent current checkpoints cover the pending queue, reload and
retirement boundaries. Original PC0 bytes and the recreated-child observer's
allocation-reuse gap remain capture-only; the latter has separate actual
factory/load/message-copy observations. This scope does not prove physical
remote-memory access, full Application input publication, or GPU output.

SDK23 directed Main570/571/572 self-targets are separately classified as ignored
Script notifications. Only the null571 word is qualified by this group; it does
not establish nonzero external-word ownership or a special receiver. Likewise,
Main653 is the Plane selector envelope, while Main654/655 reach explicit empty
simple-Plane branches. Their control2/no-output observations are not successful
message delivery to a Script callback. Main69 transports four opaque words;
the four-byte user tag `stop` is separate from the real native destroy message3.

Main69/70 generate internal canonical Script messages172/173. Their native target
ID is resolved before using the canonical World dispatcher. The external raw
dispatcher retains each build's actual query mapping: SDK74 raw173 is Scene
query175, which writes its mapped destinations and leaves its result word
unwritten. Passing an internal queued message through that raw channel caused
ordinary self-posts to fail during initial Script execution. Five-build parsed
callers, real recipient tag copyback/FIFO and independent cold continuations
cover the corrected boundary. An ignored recipient still cannot invent a result.

`src/native/script-task.mjs` owns the Script task, its KCS loader, message queue,
debug queries and automatic resource lifetime. `src/kcs/debug.mjs` implements
the compiler's symbol records. `src/native/scene-memory.mjs` maps the existing
scene reader/history into the single shared engine process.

These contracts use the two hashes in `references.json`. Main-table IDs and
task messages are separate namespaces.

| Entry                  | Game 2.6.1.76 | SDK 2.6.1.74 |
| ---------------------- | ------------- | ------------ |
| Script constructor     | `5E8840`      | `4C4B60`     |
| Script destructor      | `5E8A10`      | `4C4D30`     |
| Message receiver       | `5E8DD0`      | `4C50C0`     |
| Script VFT             | `8CDBE4`      | `992EC4`     |
| Main `0x8F`            | `6568C0`      | `521A30`     |
| CST reader constructor | `72B270`      | `5DB920`     |
| History constructor    | `72D010`      | `5DBFA0`     |

## Loading and ownership

Main `0x8F(target, filename, initialExecute)` resolves its category filename,
sends load message 160, then binds the caller's shared memory with message 171.
Its control is 2 or 4 according to `initialExecute`, including a missing route.
The caller's namespace determines `target`; internal World IDs remain separate.

Loading replaces the interpreter and releases automatic bitmap/MOT managers.
It retains the Script's variable bank, string bank, scene reader/history,
exit code, string-dirty word and deferred queue. The loader consumes the current
resource bytes even when the filename was loaded earlier. Resource-cache policy
belongs to the read boundary. A failed or empty native load removes the old VM
and sets the loaded word; it does not invent a replacement interpreter.

Every Script constructs its own string bank. Parent attachment can replace it
with a borrowed parent bank. Variable contexts are registered against the live
bank and selected by the original frame/message lifecycle. Base destruction
precedes Script resource cleanup. The bank, scene, automatic bitmap and MOT
resources are released according to their ownership; independent checkpoints
are not automatic MOT managers.

After Base destruction, automatic bitmap/MOT resources are released before the
interpreter's data, stack, allocations and native VM header. Variable contexts,
owned scene reader/history and owned string bank follow. Reloading releases the
old interpreter at that same resource boundary, rather than retaining its arena
until a later native call or World shutdown.

The string-dirty word belongs to each Script. Main `0x114` and successful `0xFD`
imports mark the caller, even when multiple Scripts share one string bank.
Message 178 reads that word and optionally clears it.

## Messages and frames

The table uses the World's canonical message IDs. SDK messages 160–178 are two
lower; context notification is SDK 325 versus game 330, and the final immediate
event is SDK 441 versus game 446. Game messages 30/31 are absent in this SDK.

| Message | Behavior                                                           |
| ------- | ------------------------------------------------------------------ |
| 160     | Replace the script; optionally execute it immediately.             |
| 161/162 | Enable/disable execution and set the VM execution mode.            |
| 163     | Write the real contiguous VM-memory pointer when a VM exists.      |
| 164/165 | Copy a local/global 148-byte symbol record and its value word.     |
| 166     | Store the debugger callback/data words.                            |
| 167     | Write the current source line and optional CP932 filename.         |
| 168     | Refresh a supplied symbol descriptor's value.                      |
| 169     | Convert the mapped frame-relative address while retaining its tag. |
| 170     | Store the Script and VM debug-hook word.                           |
| 171     | Bind shared storage when a VM exists.                              |
| 172/173 | Deliver immediately or append a deferred four-word packet.         |
| 174     | Write the real interpreter pointer when it exists.                 |
| 175     | Write two distinct real CST-reader/history pointers, or two zeros. |
| 176/177 | Write variable/string-bank identities; 177 permits null output.    |
| 178     | Read and optionally clear this Script's string-dirty word.         |
| 330     | Own a copy of the CP932 context string and queue its notification. |

Deferred packets are a Script-owned live deque. Reloading, including a failed
load followed by a later successful load, preserves it. A frame processes packets
appended during delivery before doing its normal idle execution. Pausing retains
the queue. Both the World Script driver and standalone KCS scheduler follow this
ordering.

SDK Main `0x46` (`529070`) posts to the target Script with raw message 171
(canonical 173). The four call arguments are the native target ID, message,
W and L. The receiver copies the sender ID, message, W and L into its queue.
For a routed Script, the wrapper writes the receiver's result (1) and returns
control 1. The ordinary Load menu uses this deferred handoff.

Message 330 updates its own context first, then directly routes an embedded
message 26 through **that Script's subtree**. It does not climb to the Top.
Parents and siblings keep their context. Copies preserve CP932 bytes, including
byte sequences that cannot round-trip through a Unicode encoder.

Main `0x23A/23B/23C` send game messages 442/445/444, respectively; SDK uses
437/440/439. `0x23B` reads a nullable raw data word before sending the
word. All three return control 2. The pinned Script/Base receivers leave these
messages unhandled; Top handles them without writing an output word. The
wrappers execute the real routing protocol rather than substituting a no-op.

## Shared interpreter memory

Main `0x48` and `0x49` take four words in order: the target Script's native
task ID, its VM address, a byte count and a local VM address. The SDK 2.6.1.74
wrappers at `5290F0` and `529210` obtain the target interpreter with raw
message 172 (canonical 174). Each address is resolved in its owner's VM.
`0x48` copies from the target into the caller and `0x49` copies from the
caller into the target. Both return control 2 and leave the VM result word
unwritten. The SDK and game share the ordinary bounded VM copy implementation.
The SDK save menu uses this pair to exchange values between its scripts.

The scheduler's default shared storage, each interpreter's contiguous data/stack
storage and every extension allocation use one backing allocation in the shared
engine process once materialized. Native x86 writes and JavaScript VM reads are
immediately visible to one another, including nested callbacks and asynchronous
resumption. The bridge does not synchronize a second VM byte copy on return.

The VM reacquires its writable view through `bindMemory`, `bindShared` and
`bindBlock` providers. This is necessary because growing the WASM heap detaches
previously borrowed views. Shared chains are flattened to their actual source;
self-reference, a range within the runtime storage and another interpreter's
data/stack or allocation retain that source identity.

An interpreter has a stable `memoryID`; extension allocations have stable
`blockIDs`. Removing an earlier extension still shifts later virtual addresses,
as in the original VM, while an already borrowed native pointer continues to
address the same physical allocation. Once materialized, that pointer stays
fixed when its owner frees, reallocates or replaces the source. The native
allocator may reuse the freed address. A reference whose source is already gone
before materialization raises a dangling-reference diagnostic rather than
silently selecting another block.

Checkpoints retain logical allocation identities, canonical bytes and guest
addresses. Fresh World restoration recreates providers for the new process
before returning any interpreter to its caller. Writes made before the first
native call therefore already affect the restored arena, including data,
stack, extensions and borrowed shared ranges. Host pointers, views and provider
closures are not serialized. A restored interpreter cannot read or change the
previous World's RAM.

Inline shared spans also preserve overlap. Task snapshots copy each connected
span into a compact backing buffer and clone the descriptor graph together;
they do not clone an unrelated WASM heap or split overlapping Top views.
Materializing a process-owned view retains its existing guest address. Foreign
host spans share a guest arena; boundary synchronization merges changed host
bytes with current native RAM. Root state does not duplicate the descriptor's
shared storage. Public tests cover both profiles, overlapping Top spans,
independent host/native writes, forced growth and fresh-process restoration.

## Dumps, symbols and native addresses

Loaded Script dumps have an 88-byte header, the complete contiguous VM memory,
then direct-child dumps in the native ordered map's live order. The header
contains native ID, shared length, PC, memory pointer/length, SP, expression
floor, FP and switch word. C-string copies preserve the caller's unused header
padding. An absent VM makes message 16 unhandled. Message 15 would dereference
null in the original and is an explicit diagnostic.

Ordinary dump/163 addresses share the runtime's existing raw byte-address owner.
A finite borrowed region resolves `{taskID, memoryID, length}` to the live
contiguous VM memory, including immediate bidirectional writes. The address is
stable for that interpreter, distinct from a VM offset, task ID or opaque handle.
Its checkpoint stores only the source reference while the scheduler owns the
VM bytes. Invalid source identities or overlapping ranges fail before restore
mutation; fresh aliases are available as soon as restore returns. Reload/close
remove only that mapping. Explicit original owners retain their real guest
addresses; there is no automatic EXE fallback for ordinary pointer queries.

Opcodes 67/68 push/pop compiler symbol references. CALL/RETURN change the scope
marker deque; RETURN does not silently erase symbols that require an explicit
opcode 68. Opcode 66 stores a VM string address in the function stack, and RETURN
pops it. Symbols retain their original record bytes. Query 168's shared tag is
separate from the normal VM pointer tag and uses its own relative-address flag.

The release loader does not initialize the external debugger's symbol/scope
containers. The differential harness supplies that initialization explicitly.
Source line/file storage is also unwritten until opcode 65 executes. Querying it
earlier, negative/out-of-container symbol access, function-stack overflow and
frame-relative reads beyond mapped storage remain diagnostics; their accidental
native heap contents are not emulated as zero.

Script 175 uses the existing `NativeSceneData` as its state authority. The shared
process constructs a real reader and history at separate, stable pointers, loads
the canonical CST/CSTL with the original parser, and synchronizes cursor/history
mutations. Fresh World restoration preserves those identities. External raw
replacement of a reader's CSTL allocation has not received separate differential
coverage and is not implied by the canonical-load tests.

The legacy Script Scene query is raw 162 in .23, 169 in .63 and 170 in .67;
all three map to semantic 175 only for Script kind 12. An absent Scene context
writes two null pointers without stopping the interpreter. An initialized context
keeps ordinary JS history ownership; exposing physical reader/history addresses
still requires an explicitly supplied original-engine owner.

The .63 task-local Scene wrappers 219–235, history save/restore 239/249, existence
query 322 and explicit numbered-string entries 334/335/337 now use the shared
Scene implementation. Initialization replaces both resources and releases the old
handle. Implicit CST queries update the file-name/value markers just like the
explicit .63 reader. Task-local history names retain their extension; explicit
seen/path names use the existing extension-stripping rule. Cross-task operations
resolve the live Script owner through its Top, including a retained owner whose
interpreter has already been removed. Copies own their history bytes.

The regression executes authored KCS through all 23 wrappers, copies between two
Script owners, writes a native CSS file through Main245, exports its GAME_SAVE
file view and reads it through Main247/249 in a separate World and VM. A separate
snapshot restore checks Scene ownership after interpreter replacement. Original
legacy records define their numeric fields and C-string bytes through NUL;
unused name/string tails can contain native stack bytes. The finite original
fixture compares only those defined bytes. Import and subsequent copy/save keep
all bytes supplied in a file, including its unused tails. The reader constructor initializes its filename and file value to empty/zero,
including over a nonzero-filled allocation. Its cursor/size words remain
uninitialized until a successful load. Empty-reader text and unmapped object
storage are not assigned portable values from accidental native memory.
The capture/expand wrappers can write a zero to the native reply storage on a
missing-context branch while still returning control 2. Their `resultWritten`
metadata stays null; the VM does not push a result for that control code.

## Evidence

Public tests use authored bytecode and data. Optional scene-memory tests execute
the fixed engines when `CATSYSTEM2_ENGINE_EXE` / `CATSYSTEM2_SDK_EXE` are set.
They exercise original reader/history constructors, CST type queries, localized
text, history mutation and fresh World restoration.
`tests/native-shared-memory.test.mjs` also checks both engines' live data/stack,
allocation and runtime aliases, forced heap growth, nested asynchronous calls,
free/reallocation, interpreter replacement and fresh World restoration. These
authored integration checks are separate from the original-handler counts below.

| Script                               | Successful comparisons | Boundary                                                                                                                                                                             |
| ------------------------------------ | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verify-native-script.mjs`           |                  1,448 | Both receivers, actual KCS continuations and bank/attachment queries; queue insertion is captured explicitly.                                                                        |
| `verify-native-script-lifecycle.mjs` |                  6,256 | Both complete loaders, frames, real queues, dumps, failed/replacement loads and child context copies. File/category transport and an authored queue-appending callback are explicit. |
| `verify-native-script-transport.mjs` |                    256 | Both main wrappers through original upward routing and original Top/Script/Base packet receivers; device construction uses the original Base constructor.                            |
| `verify-native-kcs-debug.mjs`        |                  3,732 | Both original debug opcodes, CALL/RETURN containers and descriptor queries; debugger initialization is authored.                                                                     |

The debug probes exclude 34 out-of-allocation frame/width reads per build. The
lifecycle probes exclude eight uninitialized source-position queries per build.
These exclusions are recorded in the reports and are not successful comparisons.
Private reports, raw function evidence and binaries remain in ignored `.local/`.

The phase 4 raw-data path reads owned JS allocations directly for `23B`.
Physical PE pointers require an explicit oracle adapter. Ordinary task messages
and borrowed whole-VM sourceRefs use the current JS memory owner.
