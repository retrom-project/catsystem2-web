# Native image-data resources

`NativeRuntime.imageDataBuffers` owns image-data bytes, descriptors and sharing
in JS memory. The six GCALLs load through the JS resource layer, parse image
metadata and decode HG/JPEG through the existing JS image readers. A fresh
runtime restores the buffer store once and reconnects its opaque handles.

The explicitly injected EXE backend supplies `oracle/data-buffer-projection.mjs`
for remaining image, FES and font consumers. It creates independent read-only
PE snapshots. JS-to-font transfer consumes a JS reference explicitly, while
external consumers manage their projection references. PE references and bytes
never become the script buffer's authority. The projection registry in
`b-migration.json` records fields, consumer domains and removal phases.

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

## JS ownership and original ABI evidence

Image-data handles retain a descriptor identity in the JS buffer store. Alias
handles share its bytes and reference count. Releasing the last reference removes
the descriptor and its owned payload. File loading preserves the original
size/read sequence and short-read failure. Snapshot restoration preserves alias
identity, with independent bytes in a newly constructed World.

The original ABI uses a 20-byte descriptor and an independent payload reference
word. `oracle/data-buffer.mjs` and the original verification scripts retain that
layout for differential evidence. The transition projection retains one PE
reference while JS owns a source, and lends separate references to consumers.
Fonts consume the supplied script reference. FES retains its canonical source
before assigning a font, so replacement of the font preserves the source cache.

0x16D returns a raw source handle. 0x16C returns a task-owned JS bitmap whose
pixels use the existing top-down RGBA representation. The independent oracle
lane converts the original bottom-up BGR(A) bitmap before comparing pixels.

## Output behavior and checkpoints

0x170 and 0x1AF clear their 36-byte destination before invoking a parser when
both the resource and translated destination are nonnull. A null resource or
unmapped destination returns zero without changing the destination. VM address
zero remains a valid data address.

0x177 does not pre-clear the destination. Missing files preserve caller bytes,
and parsing failures preserve whatever fields the original parser did not
write. Unlike the other queries, its original wrapper does not guard a null
translated destination before calling a format parser.

The runtime snapshot owns the JS buffer memory once. Opaque handles retain
identities into that store. EXE projection snapshots keep their PE allocation
identities separately and rebuild from the canonical JS bytes after restoration.

## Evidence

`tests/native-data-containers.test.mjs` exercises both ABI dispatchers with EXE
loading forbidden. `tests/differential/native-data-containers.test.mjs` compares
stateful operations against complete original GCALLs in both private EXEs,
including controls, VM canaries, typed handle lifetimes, metadata and pixels.
Missing private fixtures produce an explicit per-ABI skip.

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
