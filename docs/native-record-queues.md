# Fixed-record FIFO queues

The game engine adds main `3F2..3F5` and `400`. These slots are beyond the
fixed SDK engine's table and are not exposed under that profile.

| Native | Arguments             | Behavior                                                                                                  | Control |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------- | ------- |
| `3F2`  | record byte size      | Construct a queue and return its typed handle.                                                            | 1       |
| `3F3`  | queue                 | Delete active record allocations, deque storage and owner; null is accepted.                              | 2       |
| `3F4`  | queue, VM source      | Allocate and copy one record, then append; null queue or unmapped source does nothing.                    | 2       |
| `3F5`  | queue, VM destination | Copy and remove the oldest record; return 1 on success, otherwise 0. An invalid destination does not pop. | 1       |
| `400`  | queue                 | Return 1 for null, empty and nonempty queues.                                                             | 1       |

`400` really returns one in both branches; it must not be implemented as a
conventional empty/count query. Zero-byte records still append and pop, but
both wrappers require a mapped VM source/destination. Data address zero is
valid. The original oracle deque grows in native blocks and preserves its offset/capacity.

The runtime uses `NativeRecordQueue` and the normal JS native registration.
Records are copied into JS byte arrays. A fresh World restores only live records
in FIFO order, preserving VM mapping checks and the always-one status reply.
The queue has no EXE allocation or task-owned automatic deletion.

The original pop retains its removed allocation until process shutdown. This
internal allocation behavior remains recorded by the oracle verifier. The JS
container releases obsolete storage when records leave the queue.

Original wrappers are `653320`, `653390`, `653550`, `6534C0` and `653490`;
the constructor is `6532C0`. `scripts/verify-native-record-queue.mjs` runs
1,680 complete wrapper operations and compares 5,040 replies, full VM byte
states/canaries and queue states. Cases include zero/odd/large records, table
growth and wraparound, interleaved push/pop, null handles, invalid VM pointers
and destruction. The independent bounded differential sequence compares the JS registration with
those original GCALLs, including empty queues, invalid pointers and interleaved
push/pop. Public Node tests exercise a fresh World and independent continuation
without loading an EXE.
