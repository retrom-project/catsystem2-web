# Fixed-record FIFO queues

The game engine adds main `3F2..3F5` and `400`. These slots are beyond the
fixed SDK engine's table and are not exposed under that profile.

| Native | Arguments             | Behavior                                                                                                  | Control |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------- | ------- |
| `3F2`  | record byte size      | Construct a 24-byte owner and its deque; return its queue handle.                                         | 1       |
| `3F3`  | queue                 | Delete active record allocations, deque storage and owner; null is accepted.                              | 2       |
| `3F4`  | queue, VM source      | Allocate and copy one record, then append; null queue or unmapped source does nothing.                    | 2       |
| `3F5`  | queue, VM destination | Copy and remove the oldest record; return 1 on success, otherwise 0. An invalid destination does not pop. | 1       |
| `400`  | queue                 | Return 1 for null, empty and nonempty queues.                                                             | 1       |

`400` really returns one in both branches; it must not be implemented as a
conventional empty/count query. Zero-byte records still append and pop, but
both wrappers require a mapped VM source/destination. Data address zero is
valid. The deque grows in native blocks and preserves its offset/capacity.

The shared native process executes the complete original wrappers, constructor
and deque helpers. Its queue handles contain only a native owner pointer.
Checkpoint state retains the actual deque allocations and copied records in
that process; restoring a handle does not allocate another queue. The VM bridge
uses its live data/stack/shared/extension arenas and reacquires host views after
WASM growth.

The original pop does not free the removed record allocation, and subsequent
destruction only frees records still in the deque. This native lifetime is
preserved inside the process; closing the World releases the whole process.
There is no inferred task-owned auto-delete behavior for these independent
containers.

Original wrappers are `653320`, `653390`, `653550`, `6534C0` and `653490`;
the constructor is `6532C0`. `scripts/verify-native-record-queue.mjs` runs
1,680 complete wrapper operations and compares 5,040 replies, full VM byte
states/canaries and queue states. Cases include zero/odd/large records, table
growth and wraparound, interleaved push/pop, null handles, invalid VM pointers
and destruction. These verify the address/handle adapter and lifecycle; queue
arithmetic remains the original code. Public tests additionally exercise a
fresh World, independent continued queues, all live VM byte domains, type
checks and the popped allocation lifetime.
