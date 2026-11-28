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

## Modern Settings and document consumers

The exact 74 and plain ee6-76 programs in
`tests/native-modern-xml-tone-name.test.mjs` use a separate parsed Main590
startup document and the intact Settings initializer/XML writer. That finite
prefix produces the real `config` and `fes` rows; Main674's returned category
index formats the filename selected by Main598. Actual FileServer reads then
create two independent document owners. Version 74 requires Shift_JIS and 76
requires UTF-8; text bytes, including literal entity spelling, match each own
original rather than being converted by a browser XML parser.

Present integer/text queries drive Script variables, an expression and an actual
Scene filename. Defined absent queries preserve fallback or destination bytes.
After one owner closes and the same loose source is replaced, the old owner
still reads 17 and a new reader reads 31. Both original streams, temporary buffers
and explicit document owners close normally; serialized current continuations
preserve this owned state. The qualification covers existing virtual file ports
and the finite Settings prefix. It excludes full Engine construction/destruction,
KIF rebind's unqualified 64-bit seek leaf, arbitrary grammar and physical storage.

## SDK63 resource owner and caller bridge

The exact `c8d4d709…` program in
`tests/native-sdk63-xml-name-resources.test.mjs` uses the qualified native
Settings/FileServer producer, including a real `config` category at index 4.
Main674 selects that index; Main598 formats the resource base; two Main590
owners parse the nonempty Shift_JIS XML. Integer/text outputs reach loaded
Script variables, an expression and an actual Scene filename. Defined absent
queries preserve the integer fallback or the existing text destination.

The original parsed Script runs ten normal virtual Frame calls across this and
the name-table group. It uses the already qualified Main71 idle-wait carrier on
initialized scratch storage; the separate Main65 guard is unchanged. Replacing
the controlled archive and calling the normal FileServer mount API leaves the
old document at 17 while a new reader observes 31. Both XML owners retire before
later Scene/text consumers, and eight independent current cold continuations
match the original initialized outputs and canaries.

This reuses the existing SDK63 virtual file port's normal finite KIF seek path.
It does not qualify a new general Win32 leaf, physical storage, full Application
or Root0 Input namespace. The modern KIF-rebind host gap recorded above remains
separate; this SDK63 context does not remove it or promote other builds.
