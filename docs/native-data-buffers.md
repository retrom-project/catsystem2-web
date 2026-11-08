# Native image-data resources

`NativeDataBuffers` owns raw image files in the shared original-engine process.
These resources differ from decoded bitmaps. KCS opaque handles use the
`image-data` type and store a guest pointer, owner and source name; they do not
store another copy of the bytes or reference counts.

| Main ID | Contract                                                            | Control                     |
| ------- | ------------------------------------------------------------------- | --------------------------- |
| 0x16D   | Load a formatted filename through the image category                | Word handle, or zero        |
| 0x16E   | Release one resource reference; zero is accepted                    | Void                        |
| 0x16C   | Decode a resource and selector into a task-owned bitmap             | Word bitmap handle, or zero |
| 0x170   | Query selector metadata into a 36-byte mapped VM destination        | Word boolean                |
| 0x1AF   | Query container metadata into a 36-byte mapped VM destination       | Word boolean                |
| 0x177   | Query metadata from the first 1,024 bytes of a formatted image file | Word boolean                |

Metadata parsing and image decoding execute the reviewed original helpers from
the mounted engine. The host supplies resource I/O, KCS formatting, Windows
services and the bitmap import boundary. This avoids replacing format-specific
metadata with inferred fields. An unsupported host boundary remains an error.

## Ownership

The 20-byte descriptor contains five DWORDs:

| Offset | Meaning                                                       |
| ------ | ------------------------------------------------------------- |
| 0      | Data pointer                                                  |
| 4      | Size                                                          |
| 8      | Capacity                                                      |
| 12     | Descriptor reference count                                    |
| 16     | Borrowed-data flag; any nonzero value suppresses data release |

Owned data has a separate hidden reference count in the DWORD immediately
before the data pointer. A new allocation initializes both counts to one.
Releasing the descriptor decrements its count using signed 32-bit comparison.
At zero or below it releases owned data, clears the first three words and
frees the descriptor. The data heap helper separately decrements or frees its
hidden allocation. Borrowed descriptors free only their descriptor.

The hidden allocation belongs to the original engine's Windows heap. Host
allocation and release use that same heap registry so an original destructor
can release a host-created buffer through `6A4B00` / SDK `575E10`, and the host
can finish releasing a buffer after an original decrement. Merely allocating
the same bytes in the process without heap membership would leak when the
original `HeapFree` runs. Both profile tests exercise these mixed release paths,
including zero-byte buffers.

The recovered allocation helper discards old data and rounds the new size up
to eight bytes. It preserves the descriptor count and does not copy old bytes.
New data bytes and alignment padding are not promised to be zero.

The modern text image-font setter consumes the supplied reference without
retaining it. FES explicitly retains its image source before sending that
message, leaving the FES object and font with separate references. KCS 0x26C
does not add this retention. The shared resource service preserves that rule;
using a handle after another owner has destroyed its resource is diagnosed.

0x16D does not add its raw resource to the caller's automatic bitmap list.
0x16C does add the decoded bitmap. Browser bitmap import takes that decoded
wrapper's one reference on success; a failed import releases it in the caller.
The import receives `{rowOrder: 'bottom-up'}`. Authored asymmetric images prove
this decoder output direction in both builds; the text writer's upload buffer
has a different origin and must not establish this decoder contract.

## Output behavior and checkpoints

0x170 and 0x1AF clear their 36-byte destination before invoking a parser when
both the resource and translated destination are nonnull. A null resource or
unmapped destination returns zero without changing the destination. VM address
zero remains a valid data address.

0x177 does not pre-clear the destination. Missing files preserve caller bytes,
and parsing failures preserve whatever fields the original parser did not
write. Unlike the other queries, its original wrapper does not guard a null
translated destination before calling a format parser.

The process snapshot owns descriptor, data and bitmap memory once. Resource
feature snapshots contain only their live descriptor identities. Opaque handle
restore points back into that same process image, preserving sharing rather
than allocating one block per handle.

## Evidence

`scripts/verify-native-data-buffer.mjs` executes the original loaders, release
wrappers, heap helpers and descriptor allocation helpers: **303 comparisons
per build, 606 total**. Cases include empty/missing/short reads, CP932 filenames,
both reference counts, signed wrap, borrowed flags, null data and alignment.

`scripts/verify-native-image-data.mjs` executes the four consumer wrappers,
their image parsers and decoders, original bitmap-list insertion and the font
reference setter: **536 comparisons per build, 1,072 total**. It checks authored
24/32-bit HG2 pixels, missing selectors, metadata destination bytes and canaries,
mapped-zero and unmapped destinations, ownership and explicit row direction.
KCS formatting, VM address translation, mounted file access and platform/CRT
services are declared boundaries. Browser rendering acceptance is separate.

The eight public resource tests cover the scalar evidence, two-level lifetime,
borrowed storage, invalidated handles, fresh restore, metadata initialization
and import ownership. No proprietary files or decompiler bodies are distributed.

## Raw heap and CTS records

Main `0x341..0x344` use the same native engine heap, independently of the
20-byte image-data descriptor. `0x341(size)` returns an actual guest-process
address with a reference count of one immediately before it. Even size zero
allocates that four-byte header. `0x342(pointer)` releases this reference using
signed comparison and accepts null. These addresses are not opaque handles or
KCS virtual-memory offsets.

`0x343(file, entry, size, pointer)` copies raw native bytes into a CTS record.
`0x344(file, entry, sizeOutput)` allocates an independent native buffer and
writes its size through the translated KCS destination. Missing records and
null files return zero and leave that destination unchanged. Duplicate record
IDs retain the file container's first-match behavior. Process checkpoints own
the raw allocations; restoring a file handle does not duplicate those pointers.

`scripts/verify-native-heap-data.mjs` executes all four original wrappers and
the original heap/CTS implementations, with **3,592 comparisons per build,
7,184 total**. It compares controls, allocation extents, headers, copied bytes,
duplicate records, signed references and null/missing outputs. Only the KCS
output-pointer conversion is supplied. Invalid-pointer behavior and allocation
failure are outside this report. Three public tests additionally cover fresh
process restoration and independent file/native-buffer ownership.

Dictionary exports `0x37B/384` and imports `0x37C/385` address this raw native
heap too. Their enumeration functions `0x37D/386` instead translate a KCS output
address. `verify-native-dictionary-memory.mjs` adds **3,024 comparisons per
build**, executing both original families against the browser dispatcher with
separate address spaces, full padding/canaries and null paths. A public test
exports through an allocated native pointer and imports after fresh restoration.
