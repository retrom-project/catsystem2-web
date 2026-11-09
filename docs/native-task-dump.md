# Native task tree dump

Main `D0` takes one KCS format address. It executes at Game `643A30` and
SDK `52A1A0`. Both wrappers format the filename in the original VM, combine
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

The SDK path executes the original `4BABA0` receiver. Only the two internal
size/data sends at `4BACC9` and `4BAD25` cross into the shared World task
graph. Its heap allocation, path formatting and IFile calls remain in the
guest. Base and Script copy their record fields into that allocation,
preserving unwritten padding. A Script snapshot taken from a native callback
records the original advanced PC and popped argument stack position, even
when the browser VM is temporarily waiting to retry the asynchronous call.

The KCS parser retains the exact 52-byte source header. The shared VM prefix
owns a guest copy for the duration of the interpreter. The same allocation
is bound on restore and released with the interpreter.

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
