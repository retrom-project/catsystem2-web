# Shared native ordered maps

Main `2A3..2A8` creates, destroys, writes, removes and queries a byte-string to DWORD ordered map. Lookup has an explicit caller-supplied fallback. Reverse lookup returns the first key in unsigned byte order whose DWORD matches, writing a VM C string only on success. A miss leaves the destination unchanged. Formatted keys retain their original bytes, including UTF-8 and invalid CP932; embedded NUL terminates a key.

These objects have the same original constructor and destructor as `203..206`, `375..37D` and `37E..386` in both fixed engines. All four interfaces therefore use the same typed `dictionary` handle and checkpoint codec. The raw-key interface keeps its first insertion and `FFFFFFFF` miss result; formatted writers replace existing values. These are operation semantics on one object type.

The game engine adds `41C`, used in its image-effect lookup. It formats the query and returns the value of the first stored key that prefixes it, visiting the existing unsigned byte order and comparing with the original default CRT's ASCII case folding. An empty key matches every query. A miss returns zero, and a null dictionary returns zero without reading the query.

`scripts/verify-native-ordered-map.mjs` runs the original full wrappers, formatter and tree helpers. The fixed SDK PE passes 4,000 comparisons across 1,889 wrapper operations, covering all four constructors/destructors, cross-interface use, byte ordering, recursive format strings, empty and NUL keys, explicit defaults, deletion and null handles. The fixed game PE adds prefix operations for 4,044 comparisons across 1,911 calls. VM data, stack, shared and extension block bytes are compared in full. Packed map exports additionally check native tree order and untouched alignment padding.

Public tests dispatch through both profiles' runtime and restore a checkpoint into a fresh runtime, then continue reverse lookup and destruction through different map interfaces. Released handles fail explicitly.
