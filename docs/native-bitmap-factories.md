# Original bitmap factories and Script ownership

The main interfaces `6F`, `70`, `72`, `75`, `76`, `77` and `79` execute their
complete original wrappers. Loading, blank construction and cloning return the
original image wrapper directly to the shared bitmap registry. They retain the
same native pixel allocation, attributes and metadata; no host decoder or
reconstructed pixel object replaces the producer result.

The game wrapper is 536 bytes and the SDK wrapper is 276. Its first word points
to the bitmap, while its own final reference word and optional motion owner at
offset 8 have separate lifetimes. Wrapper construction and release execute the
original methods. Logical aliases own independent image wrappers around their
shared original bitmap. Presentation-only borrows remain weak until explicitly
passed to a native image interface.

Every original producer registers its wrapper in the calling Script's real
circular list at `+152`. Explicit release executes main `72`, including list
search/removal and the original image destructor. Script reload/close releases
its remaining image owners before clearing and freeing the list. The list,
image reference words, opaque handles and restored guest addresses retain one
consistent lifetime. Cross-task release preserves the original receiver-list
behavior; it is not silently reparented to another Script.

`75` uses physical bitmap row coordinates. They differ from logical top-down
Canvas coordinates: row zero writes the logical bottom row. Its zero-bitmap
branch clears the view with four coordinates and does not consume a color word.
`79` retains the original percentage arithmetic and its 100/100/100 early return.
`77` clears both mapped outputs before querying, including for a null image.
Missing argument words use adjacent mapped GCALL memory.

`6F` keeps the engine's original formatted token parsing, frame selectors,
multi-file composition, decoder path, conversion from three-byte images and
automatic registration. A successful later file can supply the result after a
missing first file. Image-cache and device behavior are exercised in the World
tests separately from the authored empty-cache boundary used by the CLI oracle.

`verify-native-bitmap-factories.mjs` compares **388 complete calls and 2,449
checks per frozen engine**, **4,898 checks total**. The reference runs original
scanlines; only the adapter enables the independently verified raster kernels.
It compares all live heap bytes and complete VM regions, including wrappers,
bitmap pixels, attributes, reference words and automatic-list nodes. Two explicit
allocator fill patterns, `00` and `A7`, define otherwise uninitialized input bytes.
Cases cover zero dimensions, 16/24/32-bit pixels, clipping, percentage limits,
loaded-image clones, missing/broken files, composition and null branches.

The public tests run both original profiles and a complete fresh SDK World.
Chromium additionally runs both full Worlds with original file loading, cloning,
automatic-list restoration, failed Script reload and original destruction.
Separate browser tests check visible VRAM upload and fresh GPU state through
`16F`. These results do not establish every possible decoder input, cached-file
eviction or arbitrary invalid native pointer.
