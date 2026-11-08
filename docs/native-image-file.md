# Original ANM file presence query

Main `1AE` tests whether the image's corresponding animation file can be
opened. The implementation executes the original wrapper and `kcView`
predicate, including the original extension/basename helpers, `anmtable.csv`
parser and ordered map. It uses the existing mounted category/path and file
adapter; original IFile construction, existence check and destruction remain
in the shared engine process.

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
part of the basename; this predicate does not split image selectors. These
behaviors come from executing the original helpers rather than reimplementing
path or table parsing in JavaScript.

The full original view constructor loads and owns the table. The map is at
view byte offset 268 in the game and 204 in the SDK. Game paths are UTF-16
inside this predicate; SDK paths are CP932 byte strings. The wrapper obtains
the shared, initialized outer `kcView` through Script byte offset 116. Its
caller VM uses the existing live data/stack/shared/block mapping, including
valid VM address zero. Querying adds no persistent object, image reference or
parallel table state. The native process checkpoint already contains the view,
map and original allocation identities; restoring this feature does not rerun
the view constructor or reload the table.

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

Three optional public tests execute both fixed engines and a complete SDK
World. The World test loads the table through its real view constructor, checks
the actual Script/view link, restores a fresh process without table reload,
then uses the original parser to modify only the restored map. The original
World remains independent. Raw decompilation, assembly and comparison reports
remain in ignored local storage.

Main `1CC` is a separate bitmap composite factory. Main `2BF` and its `2C0`
release operate on owned render-source records. Their decoder, ownership and
release contracts are not covered by this presence query.
