# Native image transfers and filters

Main `73`, `74`, `78`, `1BE`, `218`, `219` and `21A` execute their complete
original wrappers with persistent bitmap identities. They cover blended
transfer, clipped copy/resizing, composition lists, opaque-bound computation,
rectangle attributes, attribute copying and the original blur filter.

Source and destination aliases retain one guest bitmap. `78` translates each
opaque image handle in its VM list to a real native wrapper without writing a
temporary guest pointer back to KCS. The rectangle is copied independently so
read-only overlapping inputs keep their original values. Attribute outputs use
the actual VM data, stack, shared memory or extended allocation, including
aliased destinations and the original low-16-bit attribute key.

The two transfer interfaces preserve their distinct treatment of destination
dimensions and clipping. `73` with destination zero uploads to the caller's
actual native view and configured VRAM texture pages. A visible VRAM plane
draws those pages through the shared renderer. An unallocated texture region
retains the original missing-texture behavior.

Some original results are surprising but intentional to preserve: `78` leaves
the composition packet's opacity multiplier at zero, so ordinary RGBA sources
retain its opaque black clear. `1BE` computes bounds in a local rectangle and
returns success without copying that rectangle back to KCS; a fully transparent
bitmap can still report success. The blur helper uses explicit canvas bounds,
including the zero canvas bounds of a newly created blank bitmap.

The original 24-bit horizontal blur writes one byte per output pixel into its
uninitialized temporary buffer; its vertical pass also consumes the unwritten
bytes. These outputs depend on previous heap contents. The differential probe
supplies two explicit allocator byte patterns for filter calls and compares all
bytes under each supplied allocation contract. Production executes the original
filter with its actual guest heap; it does not replace unwritten bytes with an
invented deterministic pixel value.

`scripts/verify-native-image-commands.mjs` compares both frozen images with
unaccelerated original reference calls. Cases cover BPP2/3/4, raw row bytes,
source/destination/self aliases, metadata, attributes, clipping, four VM domains,
output canaries, guarded invalid handles and adjacent argument-frame reads.
The view upload is an explicit transport boundary in that probe and checks the
actual view receiver. Public World tests additionally cover fresh restoration,
source mutation, final release and failed child Script reload.

The two-profile Chromium test uses an authored allocated texture page and a
visible native VRAM plane. It checks the changed pixels, replacement upload,
fresh restored GPU output and independence of the original World.
