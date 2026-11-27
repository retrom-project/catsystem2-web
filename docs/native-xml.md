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

## SDK23 resource and caller bridge

`tests/sdk23-xml-tone-resources.test.mjs` X1 binds the existing XML behavior to
the fixed `9f3a5ad0…` native body and a real mounted FileServer context. Main674
looks up the authored `config` Settings category; that returned index formats a
filename passed through Main598's finite comma-selector base extraction and
then Main590. The open wrapper uses stream flags `0x13`, not category number19.
It closes the source stream and frees its temporary input after constructing
the parsed document owner.

Two distinct Main590 owners supply finite present integer/text paths and a
Scene filename. Values reach loaded Script variables, expressions and formatting;
the filename loads an actual Scene whose text remains consumable after both
XML owners close normally. The defined absent integer path returns its fallback;
an absent text path preserves the existing destination. CP932 text and literal
entity spelling are compared as bytes, with bounded destinations and canaries.
This does not claim arbitrary XML grammar or locale support.

The current VM tests overwrite returned resource bytes after parsing and resume
later consumers at four independent cold points, closing the old World first.
Neither the remaining live owner nor its restored parsed state reopens that
resource. This document-owner bridge is separate from startup XML configuration
production and from native GAME_SAVE product persistence.
