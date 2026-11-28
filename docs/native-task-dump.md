# Native task tree dump

Main `D0` takes one KCS format address. Both registered profiles use the
ordinary VM formatter and actual source header, then send the packet through
the caller's live Root namespace. The Game Root has no file/output side effect.
The SDK Root sends its real size query 15 followed by data message 16, both
from that Root with flags zero, then writes the CSS bytes through the current
file service. A failed file write still returns the wrapper's zero word with
control 1. Cold World restore preserves the VM and task graph without replaying
the request. Other SDK unknown slots remain blocked.

Explicit original owners retain Game `643A30` and SDK `52A1A0` as independent
physical oracles. Both wrappers format the filename in the original VM, combine
the two WORDs at KCS header offsets 8 and 10 into the script version, and send
that version and the filename to native task ID zero in the caller's
namespace. Both return control 1 with a zero word, including when delivery or
file creation fails.

The Game wrapper sends raw message 36. The Game Top handles it without
writing an output word or a file. The SDK sends raw message 34 and the SDK
Top writes an uncompressed CSS task tree under its current path. The
20-byte header contains the CSS signature, dump byte count and script
version. Shared Top bytes precede the child records, in native task order.
A sound task without a device still counts as a child and reports zero
record bytes.

An explicit original owner executes the SDK `4BABA0` receiver. Only the two internal
size/data sends at `4BACC9` and `4BAD25` cross into the shared World task
graph. Its heap allocation, path formatting and IFile calls remain in the
guest. Base and Script copy their record fields into that allocation,
preserving unwritten padding. A Script snapshot taken from a native callback
records the original advanced PC and popped argument stack position, even
when the browser VM is temporarily waiting to retry the asynchronous call.

The KCS parser retains the exact 52-byte source header. An explicit original
VM prefix owns its guest copy for the interpreter lifetime. Ordinary execution
reads the retained source bytes directly; it does not create an original process.

The SDK's own Script receiver `4C50C0` writes an 88-byte header followed by the
actual contiguous VM bytes. Header offset 68 is the same live address returned
by canonical Script message 163 (SDK raw 161), through getters `8A6490/8A6540`.
The ordinary runtime registers a borrowed view of the current interpreter in
its existing `NativeBufferMemory` raw address space. Reads and writes resolve
to that actual VM memory, not a copied dump buffer or a VM-offset/handle token.
Borrowed regions do not enter the buffer store's owned-allocation/descriptor
registry. The mapping's address and `{taskID, memoryID, length}` source reference are
checkpointed; the bytes belong only to the scheduler's VM DTO. Restoring validates
references and ranges before changing the current state, then immediately
resolves them to the fresh interpreter without warm frames or guest/file/RNG
replay. Reload and close release the address mapping without destroying borrowed
VM storage. Extended allocations and external debugger process access are not
added by this contiguous-region contract. Explicit original owners keep their
physical address adapter.

`scripts/verify-native-task-dump.mjs` compares both frozen wrappers with
the adapter across 504 cases and runs six original GCALLs per profile.
There are 4,567 Game checks and 4,063 SDK checks, including formatted and raw
filename bytes, VM address zero, shared and extended pointers, metadata
versions, message delivery and result canaries. The Game reference also
executes the original Top 36 receiver. The SDK task-message oracle checks
the original CSS writer separately.

The Chromium tests run real KCS calls through both initialized Worlds. They
check the original SDK writer's CSS tree, caller frame and preserved heap
padding, reopen the file from IndexedDB in a fresh World, and execute a
second call on the restored interpreter. The tests also cover read-only
file failure, the Game receiver's lack of file output, and header release.
