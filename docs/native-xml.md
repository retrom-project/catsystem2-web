# Native XML text ownership

`parseNativeXML` owns each native node's normalized text bytes. `text` is a
read-only Unicode view decoded in that document's declared encoding; the existing
`node`/`value` methods remain available. `nativeXMLTextBytes(node)` returns an
owned plain Uint8Array copy. Generic `src/xml.mjs` / `parseXML` is unchanged.

The two reviewed producers copy the input bytes, collapse CRLF to LF, read
original byte/same-order two-byte values, replace tab/LF with space, and append
those values to narrow strings. They do not convert CP932 aliases to Unicode
and back, or expand entities. The native-only parser therefore tokenizes
normalized bytes, decodes tag names for the existing lookup behavior, and keeps
literal text bytes. A C input terminates at its first NUL. Current profile
encoding declarations, BOM rejection, node limits, duplicate ordering, comments,
DOCTYPE and other admitted syntax retain their existing boundaries.

The installed ScriptXML string native `0x251` copies these same bytes plus one
NUL; absence leaves the destination unchanged. This follows both actual string
wrappers and their producer chain, independently of the startup `v_code` getter.
For example, the authored SDK CP932 alias FA40 remains FA40, rather than being
normalized to EEEF after decoding U+2170. Game UTF-8 payloads remain UTF-8 bytes.
Unicode text consumers still see the same characters, including an interior
text-leading BOM character; that byte sequence is not a document BOM.

The existing NativeHandles codec mechanism records a native XML node as
`{name, encoding, bytes, children}`. Each text value is stored once; no `text`
string copy is serialized. Fresh handles reconstruct derived read-only views
without resource I/O. There is no new checkpoint root/version or parallel reader.
Input Buffer views, returned byte copies and checkpoint payload copies cannot
mutate the restored node's owner.

This change closes native **text** byte ownership/output. Byte aliases in element
names and formatted path lookup are separate existing behavior; their equivalence
is not established by this text fix. Evidence is complete static producer/string
bodies plus authored Node/World/fresh tests, with no new original execution.
