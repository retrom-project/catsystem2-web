# Native character tone tables

Main594–597 open and release a parsed character tone table, or query its group
and name RGB words. The current resource codec owns group/name mappings; it does
not retain a source FileServer stream or a view into its input bytes. Snapshot
restore reconstructs that owned state in the current internal contract.

The fixed SDK23 `9f3a5ad0…` normal bridge in
`tests/sdk23-xml-tone-resources.test.mjs` X2 loads a finite authored CP932 list
from an actual mounted archive through Main594. Complete headers define small
RGB triples. Two independent owners demonstrate group and CP932 name queries,
ASCII case folding and first insertion of a repeated name. Successful writes
follow R/G/B order even when all three destinations alias; a missing group
returns zero and leaves previously initialized output canaries intact.

Those returned color words format a real Scene filename, which Main325 loads
and Main327 consumes as text. After the first table closes, the second remains
usable with an overwritten query source; after both tables close, the independent
Scene and copied color words still feed later loaded Script consumers. This is
a data/resource-selection consumer, not proof of physical display color or GPU
rendering. The original wrapper's temporary stream and buffer close normally.

The current tests also overwrite returned file bytes after parsing and verify
four independent cold points without rereading the parsed resource. Existing
parser tests retain their own scope for comments, incomplete headers and other
inputs; this normal bridge does not promote arbitrary table grammar, raw-byte
alias equivalence, malformed files or other builds from SDK23 evidence.

The exact 74/plain ee6-76 resource programs in
`tests/native-modern-xml-tone-name.test.mjs` independently qualify the same
finite two-group tone format in each loaded Script context. Two owners copy
group/name mappings, including ASCII folding and first insertion of the repeated
Alice alias. Returned small RGB words format a real Scene filename and its text
is consumed after both tone owners retire. A missing group preserves initialized
output canaries. Replacing the loose source yields 8/6/12 in a new reader while
the old owner retains 7/9/11. Current cold continuations preserve the independent
owners and copied words. This proves table selection and text consumption;
pixel color, GPU output, general parsing and physical file ports remain separate.
