# Original ANM file presence query

Main `1AE` uses the JS-owned `NativeImageFiles` service. It formats the VM
filename, resolves the image category, and tests the direct `.anm` candidate
before the immutable `anmtable.csv` aliases. Readable empty/invalid files still
return one. Table keys retain their raw CP932 bytes and first insertion;
lookup lowercases only ASCII bytes outside CP932 pairs.

Initialization freezes the table bytes once. World checkpoints own the lookup
entries and bytes. Remaining domain 6 views construct an independent private
map from those same bytes; changing that consumer map cannot affect script
queries. This projection is removed in phase 6. Ordinary queries never load
an EXE. The original adapter lives in `oracle/image-file.mjs` for differential
fixtures only.

The following addresses document the frozen oracle, not runtime entry points.

| ID    | Arguments             | Control/result | Game handler / predicate | SDK handler / predicate |
| ----- | --------------------- | -------------- | ------------------------ | ----------------------- |
| `1AE` | formatted VM filename | `1`, BOOL word | `644570` / `6767F0`      | `51CC20` / `54D8D0`     |

The wrapper formats the filename with the original KCS formatter and resolves
the image category. An empty formatted string returns zero. Otherwise, the
predicate replaces the resolved extension with `.anm` and tries to open that
file in mode 3. Its contents are not parsed: an empty or malformed ANM file
still returns one. The existence of the image alone does not satisfy the query.

When the first file is absent, the predicate consults the calling view's
`anmtable.csv` map. It removes the source directory and extension, lowercases
the lookup key, and tries the mapped filename in the image category with its
extension replaced by `.anm`. Duplicate table keys preserve the first entry.
Insertion does not lowercase the table keys. Selector text after a comma stays
part of the basename; this predicate does not split image selectors. These behaviors are covered by two-ABI differential fixtures.

`verify-native-image-file.mjs` executes **2,098 complete original wrappers and
16,789 comparisons per frozen executable**, or **33,578 comparisons** across
both profiles. It checks independent frozen table slots, controls/results and
canaries, entire VM regions, exact candidate-file order, complete view bytes
and all process allocations. Authored cases include empty/missing/malformed
files, direct hits, table fallback, duplicate and case-sensitive table keys,
directory aliases, extensions, selectors, Japanese and invalid byte strings,
the original integer and recursive formatter, all VM regions and adjacent
GCALL argument words. Mounted category resolution/IFile opening and the
authored input view are explicit probe boundaries.

The SDK World test checks the JS checkpoint and the consumer's independent PE
map, including a negative proof that modifying the latter does not modify JS
queries. Raw decompilation and comparison reports remain in ignored storage.

Main `1CC` is a separate bitmap composite factory. Main `2BF` and its `2C0`
release operate on owned render-source records. Their decoder, ownership and
release contracts are not covered by this presence query.
