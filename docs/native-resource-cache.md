# Native resource preloading

Main `1B2..1B6` operate the file server's preload list. Entries preserve their
original filename spelling and insertion order, a remaining lifetime, a
separate sorting age, the file-opening mode, and a processed flag. Requeuing
a case-insensitive filename resets its lifetime while retaining its sorting
age and already loaded bytes.

Starting preloads stably sorts the list by signed sorting age and resets progress.
The worker reads actual VFS resources in groups of equal remaining lifetime.
Progress advances at group boundaries and becomes `INT_MAX` when all entries
are processed. A missing file still becomes processed. A later ordinary read
can retry that missing file. A successful cached read returns independent
bytes to the consumer.

Queue mutation and cache lookup wait for the current I/O group, matching the
original list's critical section. The progress query reads the current signed
word without taking that lock. Browser promises supply the file-I/O and
thread boundary; host I/O does not itself add a logical game frame.

Aging decrements remaining lifetimes, releases entries whose resulting sign bit
is set, decrements
the sorting ages of survivors, and decrements progress with 32-bit wrapping.
An `INT_MIN` lifetime therefore becomes `INT_MAX` and survives that operation.
Clearing releases entries and sets progress to `INT_MAX`. When preloading is
disabled at construction, these operations preserve the empty list and its
initial zero progress; completion queries succeed and ordinary reads still
use the VFS.

The World owns a view of the mounted game's reader. Its KCS, FES and native
file consumers can reuse cached bytes without replacing the underlying game
object or another World's cache. A settled checkpoint retains bytes, entry
order and counters; Engine checkpoint creation waits for preload I/O to
settle. Closing the World releases the list.

The original game routines are `5D36D0`, `5D3C80`, `5D4410`, `5D4FF0`,
`5D4700` and `5D61C0`; the SDK counterparts are `4B05C0`, `4B0950`,
`4B10B0`, `4B1BA0`, `4B13B0` and `4B2B70`. Public tests cover
real pending reads, progress, mutex ordering, missing files, independent
restoration and all five KCS wrappers. `scripts/verify-native-resource-cache.mjs
FIXED_EXE IGNORED_REPORT` passes 603 comparisons in each frozen engine, 1,206
total. It runs the original five wrappers and queue/list sort/age/threshold/worker
code, comparing complete entry state, loaded bytes, file order and progress at
each file-I/O boundary. Formatting, category resolution, mounted-file reading
and OS mutex/events are explicit boundaries. These comparisons do not establish
complete file-server or OS-thread compatibility.
