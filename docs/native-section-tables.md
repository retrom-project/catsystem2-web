# Section/key text tables

Main natives `2AB/2AC/2AD` operate on an independent eight-byte owner containing
a section map and source-order records. [The adapter](../src/native/section-table.mjs)
executes each fixed engine's complete original wrappers, text parser, strings,
lookup and destructor in the shared process.

| ID  | Arguments                                                               | Control and result                     |
| --- | ----------------------------------------------------------------------- | -------------------------------------- |
| 2AB | Formatted filename                                                      | 1, new table handle or zero            |
| 2AC | Table handle                                                            | 2, release table and all owned records |
| 2AD | Table, formatted section, formatted key, signed ordinal, VM destination | 1, copied-value boolean                |

A section name includes its original leading `#`. Section and key comparisons
are case-sensitive byte comparisons. Repeated sections share the same value
list. Repeated keys are retained in source order; ordinal zero selects the first
match, one the next, and so on. Negative or excessive ordinals do not match.
A row separates its key from the value at the first space after common line
processing. That processing replaces tabs with spaces, collapses space runs
and removes the resulting leading/trailing space. The stored value therefore
does not retain additional source indentation or repeated spaces.

The original common line/comment processor runs before these rows are parsed.
No JavaScript INI, XML or dictionary parser is substituted. The representation
retains the original narrow bytes, including CP932 and invalid byte sequences;
the returned value is copied with one terminating NUL. A missing section, key,
ordinal or unmapped output leaves the caller's output bytes unchanged and
returns zero. Address zero remains a valid mapped KCS destination.

The filename uses the engine's regular file/resource lookup and its original
flags. There is no additional `database` category or CSS context-directory
prefix invented by this adapter. A missing source returns zero; an existing
empty file constructs a valid empty table. Each opaque `section-table` handle
holds only the original owner pointer. A checkpoint retains its parsed strings
and vectors even if the source file subsequently changes. Restoring a table
does not reload it into a second authoritative JavaScript map.

## Verification

`scripts/verify-native-section-table.mjs` compares **3,874 complete wrapper
calls and 23,245 observations per profile**, **46,490 comparisons** total.
All three interfaces execute from both original images. The checks compare
control/result words, full KCS data/stack/shared/extended-block memory and every
live original tree, vector, string and allocation.

Authored sources cover repeated sections and keys, exact case, empty values,
spaces, comments, CR/LF/CRLF, embedded NUL, long and invalid CP932 bytes,
empty/missing files, signed ordinals, local/stack/shared/block output addresses,
unmapped outputs, adjacent GCALL words and output aliases of both input
strings. Four optional integration tests cover the two profiles' parsed values,
ownership/release and fresh-World restoration after a source-file change.

The mounted-file service and reviewed CRT allocator are explicit platform
boundaries. Parser inputs exceeding the original unchecked destination
capacities are not claimed as defined behavior.
