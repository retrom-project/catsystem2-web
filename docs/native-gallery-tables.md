# Binary gallery tables

`src/native/gallery-tables.mjs` implements all twelve main interfaces
`0x195..0x1A0`. The names are project descriptions. These legacy binary tables
are distinct from the CGL registration trie, XML gallery definitions and FES
numbered strings.

| IDs       | Resource      | Behavior                                                |
| --------- | ------------- | ------------------------------------------------------- |
| 195 / 196 | Variant table | Load / release                                          |
| 197 / 198 | Variant table | Group count / file count within group                   |
| 199 / 19A | Variant table | First / second selection count                          |
| 19B       | Variant table | Build a filename and comma-separated selector reference |
| 19C / 19D | Name table    | Load / release                                          |
| 19E / 1A0 | Name table    | Row count / test a row's column                         |
| 19F       | Name table    | Copy a row's column to mapped KCS memory                |

Both loaders resolve their formatted filename in the **fes** category. Empty
mapped strings still resolve through that category: the original formatter
returns success independently of the resulting string length. Unmapped format
sources are diagnosed rather than formatting unrelated native memory.

The variant file has exactly 86,400 bytes: twenty groups of eight 540-byte
records. A record contains a presence word, 16-byte base filename, two choice
counts and two sets of sixteen 16-byte masks. A cached group count counts every
group containing a nonzero presence word. Per-group file counts likewise count
nonzero presence words without compacting holes. Reference selection retains the
original additional count-based checks; sparse tables must not be silently
reindexed.

Selection overlays nonzero mask bytes other than ASCII `0`, with the second
mask taking precedence. The resulting reference retains internal empty positions
as `0`, separates selectors by commas and omits trailing empty positions. A
rejected selection preserves the entire destination. A variant loader with a
missing or wrong-sized file still returns a valid empty descriptor; its queries
return the original zero results.

The name table contains a DWORD count followed by 128-byte rows, each with four
32-byte fields. Queries retain signed row and unsigned column checks. An empty
first byte makes the field absent and preserves the output. The original copy
uses a NUL terminator, not a forced 32-byte truncation; a field without a NUL can
continue into the following field. Raw CP932 bytes are preserved.

Parsers, mask selection, name copies, queries and releases execute the original
reviewed functions in the shared engine process. Opaque `gallery-table` handles
contain only kind and guest descriptor pointer. Their bytes and hidden heap
references belong to that process, and fresh World restoration preserves those
identities. Each table's release frees its descriptor and parsed payload. The
original `19C` wrapper leaves its temporary input allocation live; the adapter
preserves that lifetime until process teardown. It does not turn that allocation
into a second authoritative resource.

`scripts/verify-native-gallery-tables.mjs FIXED_EXE IGNORED_REPORT` compares the
complete original wrappers with the browser adapter: **26,615 comparisons over
3,800 operations per build**, or **53,230 / 7,600** in total. It compares controls,
results, every VM byte, complete parsed payload/reference counts, the shared
filename buffer, diagnostics and settled heap-allocation deltas. Cases include
sparse tables, missing/wrong-sized/empty inputs, invalid selections, mapped-zero
destinations, Japanese and invalid CP932 bytes, unterminated fields and releases.
KCS formatting/handles, mounted files and CRT/platform services are explicit
adapter boundaries. Malformed pointer reads and allocator failure are excluded.

Public tests cover null/service boundaries and, when either pinned EXE variable
is supplied, both profiles' actual World dispatch, fresh process restoration,
independent ownership and resource release. No game tables are distributed.
