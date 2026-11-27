# JavaScript text execution

The runtime owns text bytes, parsing, placement, reveal clocks, glyph bitmaps,
logs and checkpoints in JavaScript. It executes no original text constructor,
parser, glyph compositor, task-8 receiver or FES text driver. Original wrappers
and engines are retained under `oracle/` for private differential tests.

The modules separate the recovered contracts:

- [`text-parser.mjs`](../src/native/text-parser.mjs),
  [`text-scanner.mjs`](../src/native/text-scanner.mjs) and
  [`text-layout.mjs`](../src/native/text-layout.mjs) own incremental CP932/UTF8
  source, style stacks, 88-byte character records, line breaks, kinsoku and ruby.
- [`text-core.mjs`](../src/native/text-core.mjs) owns STRING/STRING8/NV writer
  state, page markers, speed changes, wipe backing pixels and independent NV
  main/sub sections. [`text-config.mjs`](../src/native/text-config.mjs) builds
  the per-ABI packets from canonical configuration.
- [`legacy-text-state.mjs`](../src/native/legacy-text-state.mjs) and
  [`text-legacy.mjs`](../src/native/text-legacy.mjs) implement task 8's separate
  per-build 1116/1128-byte configuration, 40-byte cells, wrappers, image fonts and frame logic.
  Messages 114/115 remain unhandled, as in the reviewed original receiver.
- [`text-task.mjs`](../src/native/text-task.mjs) implements the canonical task
  messages and actual World frame clocks. STRING observes `userValue`; NV has
  no such pause gate. Raw source events retain their ordering across checkpoints.
- [`fes-text.mjs`](../src/native/fes-text.mjs) and
  [`fes-text-layout.mjs`](../src/native/fes-text-layout.mjs) own commands,
  deferred updates, group selection, definitions, cropped SIZE2/POS2 references
  and cached `isdraw`, `linecnt`, `endpos` and inline-ID queries.

## SDK 2.6.1.23 Text services

The fingerprinted 2.6.1.23 build admits Main 130, 133, 134, 135, 391, 456,
585, 599 and 616 through actual Script GCALLs and typed Text/STRING receivers.
Task 8 uses its 1128-byte configuration and independent 40-byte cells. Its
force/restart operations consult the registered graph's visibility, separately
from the Base task's display word. Creation leaves registration disabled;
the ordinary output-enabled show message enables it. Mark budgets, indentation,
five font sizes and both current/default color words survive checkpoints.

Main 134 still converts CP932 into a temporary terminated 16-bit packet before
sending it, including signed single-byte characters. The reviewed receiver
ignores this message and Main 135's scalar message. Those receiver branches
do not make the wrappers constant-result stubs. Main 391 initializes its own
local output to zero and returns control 1 even after routing is removed. A
configured receiver returns its existing bitmap without retaining or aliasing
it; destruction releases that bitmap during the actual Task update.

Main 616 reads a configured kind-48 STRING writer. Pending source returns signed
`-1` without parsing or consuming it. A parsed page limit can leave a positive
character count after normal Task updates; finish-all returns zero, while clear
makes the next query pending again. A VM comparison consumes the pending word
before normal draw/update and further queries. Missing writers, other receiver
kinds and unreviewed argument shapes remain protected instead of producing a
default count.

For this build, GDI single-byte layout keeps the measured advance. Fixed glyph
centering independently uses the full/half font cell, the glyph's actual advance
and its origin. Legacy Text's borrowed bitmap uses logical image rows, while
its output adapter restores physical upload order. STRING's final writer bitmap
already uses upload order; its private glyph atlas is a different resource.
The compact original vectors compare defined words, cells, complete RGBA,
output rows, VM stack/control results, ownership and independent cold execution.
The original harness runs complete view/Task constructors with deterministic
GDI and generic D3D9 memory ports; it makes no claim about physical Windows GPU
or font rendering. These policies do not enable another SDK build.

Those original Text vectors used declared private CRT/allocation and file-service
ports. A subsequent normal-host group runs representative kind8 construction,
configuration, Main 134 conversion, Main 391 borrowing and Task/Script destruction
through the original dependency bodies. It supplements their ownership and file
qualification without replaying every Text shape or redefining unwritten fields.
The shared boundary is documented under
[original resource-host qualification](native-plane-sdk.md#original-resource-host-qualification).

## Metrics, fonts and pixels

The exact comparison policy is in
[`native-text-layout-policy.json`](../tests/fixtures/native-text-layout-policy.json).
Integer layout, breaks, ruby anchors and pixels have **zero tolerance**. Only
bytes 6/7 of each original 88-byte record are normalized: those are unwritten
padding after a uint16 character code, with no script meaning.

`CanvasTextGlyphs` supplies the GDI host boundary. Font selection resolves a
mounted game font alias or the packaged Noto Sans JP font; it never selects an
OS family. The packaged font's provenance, SHA-256 and OFL are under
[`third_party/fonts/noto-sans-jp`](../third_party/fonts/noto-sans-jp/README.md).
The oracle uses the same deterministic host metrics/masks, allowing exact
comparison of parser and raster algorithms without asserting Windows/Canvas
font pixel equivalence. GDI uses gray64 coverage, the original integer bold
and shadow rules, and independent source/destination clipping.

The original FreeType path reads the mounted `font` resource independently of
GDI. [`font-backend.mjs`](../src/native/font-backend.mjs) uses deterministic JS
builds of **2.4.8 for SDK** and **2.7.1 for game**, selected by ABI fields. SDK
converts CP932 before glyph lookup; game passes the 16-bit code directly.
The reviewed game configuration uses TrueType interpreter 35. Fixed font
fixtures compare actual glyph advances, boxes and every RGBA byte against
both original libraries. Missing resources/glyphs preserve the original empty
result; this backend does not substitute the packaged GDI fallback.

Native advance measurements reuse successful scalar results for the current
owned font face, pixel size and converted character code. Only the pinned
advance/glyph providers enter this cache; replaced or accessor exports keep
their ordinary calls. The wrapper's zero result is never cached. Each face
retains at most 4,096 measurements, and close or cold restore discards them.
The native glyph operation sets its own size and loads its own glyph, so it
does not consume the previous measurement's mutable FreeType slot. Font bytes,
layout records, raster pixels and the existing checkpoint fields stay owned
by their original producers.

Ordinary owned native glyphs also reuse the pure color and shadow raster.
Every call still obtains the current glyph and checks all alpha bytes, metrics,
colors and shadow settings. Shared or resizable buffers, accessor metrics and
unknown providers keep the ordinary compositor path. Returned pixels and
rectangles remain independent copies. Each font owner retains at most 512
rasters and 4 MiB of logical array/key content; eviction recomputes a complete
glyph, and close or cold restore discards the cache.

Build the font backends with:

```sh
python3 scripts/prepare-native-freetype.py --emsdk /path/to/emsdk-3.1.74
```

The builder verifies fixed upstream archives, compiler and wrapper identity.
Standalone builds verify the fixed generated hashes and package both JS
modules, FTL notices, source bundles and `vendor/freetype-manifest.json`.
No WASM or original EXE is involved in these font backends.

`GAME/strframe_frame` is the reveal scale (constructor default 5, missing XML
field 0), represented as `scene.textFrame`; it is not FPS. Speed rebasing,
unsigned clock wrap, page early exits, the cached end query and incremental
wipe alpha are compared as stateful sequences. NV retains separate parser
configuration per section, pending CR state and a shared writer clock.

Raw image-font bytes and decoded selector pixels belong to JS. Font cells use
the original square resampling and integer compositor. The glyph-image path
accepts 32-bit images; other pixel formats or a mapped cell without an image
produce the original blank-cell fallback, while reveal still completes. Task-8 image fonts own
a deep copy of the supplied bitmap. Character maps and all pending state are
included in checkpoints. Main26C supplies canonical JS bytes directly; an
initialized receiver consumes the source reference after accepting them, while
an absent/uninitialized receiver leaves it untouched. Text feature construction
does not instantiate an EXE buffer or file reader.

## Remaining EXE consumers

Domain 6 still owns GPU upload/render targets. JS text bitmaps cross the same
registered bitmap-input projection as other JS images. The upload consumes
physical rows in ascending address order; the original logical pixel accessor
reverses Y and is not used for text upload. VRAM addresses remain independent
of the enclosing Draw origin.

Domain 7 LOGSTRING/LOGSTRING8 still creates text children. Its
[`fes-text-projection.mjs`](../oracle/fes-text-projection.mjs) constructs only a
common plane/motion prefix and projects independent config/cached-query words.
Fourteen explicit semantic adapters route the original LOG caller's text
reads/writes to JS. Original text bodies and parser pointers are never used.
LOG owns the common motion/parent prefix; only that prefix is pulled back for
LOG-controlled children. Parser, source, config, reveal and query state remain
JS authority. This boundary is removed in phase 7.

SDK JavaScript task consumers keep separate original text objects; their
state belongs to domain 8 until that subsystem migrates. GDI/DC/DIB platform
services shared with rendering/startup also remain domain 6/8 services.
Those physical platform consumers now live under `oracle/`; ordinary text owns
its single writer/bitmap state and does not construct an original backend.

## Display logs

[`text-log.mjs`](../src/native/text-log.mjs) implements main `2B8..2BC`, `311`,
`36C`, `3D1`, `352/353` and game `40A`. JS owns scenes, seven-word blocks,
two-string rows, speakers, captured config, cumulative bases and limits.

CSS wire bytes contain scene names, 28-byte blocks, tagged first-string rows
and speaker names. Second row strings are deliberately absent from the wire
format and preserved by World checkpoints. Validation precedes mutation.
History rebuild reads JS CST/history/string-bank state; it creates no original
display-log manager. Wrapping preserves CP932 byte rules and original ruby and
literal-backslash-n behavior. A stable no-progress input corresponding to an
unbounded original allocation loop raises a bounded diagnostic.

D7 LOG consumers receive independent read-only tables through
[`text-log-projection.mjs`](../oracle/text-log-projection.mjs). LOGSTRING8 remake
updates JS rows explicitly before projection. The original requested-language
subset differs from the unbound `40A` history fallback. Ordered definitions
and parent pointers remain in the D7 common-object path; child text is JS.

## Verification

`tests/differential/native-text-{layout,raster,sequence,font,legacy}-js.test.mjs`
compare both frozen ABIs with explicit private-fixture skips. The public
fixtures contain authored text/colors/configuration, no game scripts or fonts.
Coverage includes incremental configuration, kinsoku/ruby, style/escape parsing,
page/reveal/wipe/speed sequences, NV sections/CR/sub text and actual fixed-font
FreeType pixels. `tests/native-text.test.mjs` adds 492 authored layout goldens,
54 bitmap-upload goldens, FES arrays/definitions, log children, task namespaces,
font references and fresh-process checkpoints.

The GDI host boundary is tested independently; unsupported outline/matrix
formats remain explicit diagnostics. Actual Windows font rasterization and
visual game screenshot acceptance are separate from CPU/state equality.

## Default FES text queries

`strid` reads the single World text writer's parsed ID map. STRING21 and STRING8 on ABI76 use the string query; LOG24 and LOGSTRING8 on ABI76 use the current viewport ring slot's generated main STRING. NVSTRING29 is excluded by the original handler. Whole-selection traversal skips holes and retains the original shared -1 argument caches across mixed classes. Missing writers or IDs return the original defined zero.

`redraw` only marks NVSTRING29. Its deferred resource driver sends canonical506 (NV operation17) after configuration and before section/source updates. The pending flag is owned by the current FES checkpoint; fresh World restore reuses the existing JS writer without resource replay. Two frozen-ABI default entrance tests, including real LOG children and pending redraw restoration, live in `tests/fes-resource-queries.test.mjs`. No PE text constructor or implicit text feature is involved.

## Owned FES clear publications

One STRING/STRING8 FES drive may combine repeated full empty-source outputs into
one pixel publication. Every resource message, configuration, parser operation,
query result and clock update still runs in its original order. The transaction
ends before plane/graphics updates and never spans another task, notification or
logic frame. This is a private driver contract; an `await` between its owned
operations does not promise that intermediate VRAM has been published.

The path requires an already initialized writer, an already opened owned FT
face, completed ordinary Canvas readiness, unchanged pinned FT exports and
unchanged writer/parser/task/bitmap/texture/graphics methods. An already loaded
image-font source and selector map may remain attached: empty clear/configure
operations do not consume them. The writer must own their records; this also
covers retained selectors whose source image is missing. Nonempty source,
user-font loads or remapping, NV, first initialization, font replacement,
first reference lookups, pending position references, changed dimensions,
VRAM position/output changes and unknown providers use ordinary publication.
STRING keeps `SIZE2` as a persistent definition mode. Once first-drive resource
and view preparation has completed, that flag alone does not imply pending IO.
A drive that prepares a dirty extent remains ordinary, and owned admission
still requires the live writer dimensions and VRAM footprint to match.
Eligibility is checked before every resource message and output. Losing it first
settles the last requested output, then runs the new provider. GDI and reentrant
callbacks retain their original intermediate clear and redraw sequence.

Each deferred request retains the already verified CPU bitmap and page sinks.
Commit uses their shared synchronous row/page primitives, without calling a
subsequently replaced output, bitmap or texture provider. The old request first
completes its pixels, dirty flags and logical versions; the next operation uses
the new provider. This prevents a provider's synchronous or asynchronous native
or raw-memory reentry from waiting on its own publication. The completion
promise exists before commit starts, and external observers still await it.
Only allocated, bounded, owned storage is eligible; growing or resizing storage
settles the old footprint through the existing observation barriers.

Public bitmap state, pixel/frame views, canvas contexts and texture-page frames
settle pending output before lending live storage. A lent state or buffer stays
ineligible for its remaining lifetime, including reads or writes through aliases
held across `await`. A new bitmap allocation can regain ownership; restoring a
method or taking a copy cannot revoke an earlier loan. Internal bitmap row/page
copies use identity-checked owned access, while bitmap snapshots, clones, crops
and page snapshots return independent copies. They do not lend the source.
The default graphics draw path may retain the original frame/cache key inside
the verified `ParticlesGL` instance and its original WebGL2 port. Its managed
texture reads, cache hits, device validation and reconstruction first settle the
page owner's pending output. Reader/cache/GL method replacement loses this
qualification and permanently borrows the affected page; restoring a method
does not revoke the loan. Public page frames and unknown GPU consumers keep the
ordinary borrowing path. No pixel shadow cache is added, and cold World page
reconstruction installs the same mutation and read fences.

Page indices for a plain, callback-free rectangle graph are acquired together
in one synchronous operation. This operation checks the current original GPU,
page Map, intrinsic D3D context and actual device attachment; public device
observers, replaced getters/ports and nonordinary geometry keep public borrowing.
No qualification survives this operation or an `await`.

A managed texture cache hit still settles its producer before reading revision
metadata. For an existing intrinsic reader, the synchronous hit uses only current
data descriptors and the original cache Maps, preserves LRU order, and returns
the existing opaque texture. It reads no pixel bytes, calls no GL/context/device
code and creates no reader or persistent trust cache. Frame acquisition, uploads
and later publication eligibility retain the complete GL qualification. Foreign
frames keep ordinary getter order; an intrinsic frame whose header becomes an
accessor permanently loses owned publication without invoking that getter early.

Public GPU cache Maps, texture-page Maps/layout/dirty flags and Stage surface
records retain their actual object and byte identities. Obtaining such storage
first settles its producer and permanently lends that owner, including future
cache/page entries and reconstructed storage. A public surface ID lends its
backing record; lending the whole surface collection also covers future IDs.
Default rendering and copy snapshots use short internal reads. Public surface
frames/pixels keep their writable aliases. A draw call settles before its first
foreign GPU or geometry getter, and eligibility checks a frame header before
reading any potentially replaced pixel accessor. Primitive diagnostic summaries
and independent snapshots never return cache keys or live pixel views.

The pending frame is the owned empty writer allocation, retained when a later
configuration replaces it. The final publication takes one independent pixel
snapshot and writes the complete footprint. Previously borrowed raw VRAM keeps
ordinary publication and its existing write order. Public native dispatch,
VRAM bitmap reads, graphics reads/writes, stage preparation, screenshot capture,
restore and close settle the transaction first. An in-flight flush also blocks
later observers. A failed drive flushes the last requested frame before propagating its
error. Checkpoints require settled World/text state and contain no transaction.

Publication versions retain their logical increments even when pixel copies are
combined:

| Field                         | Consumers                                           | Transaction behavior                                                                               |
| ----------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `NativeBitmap.state.revision` | cached frame/canvas invalidation, bitmap checkpoint | Advance once for every original full blit; invalidate the cache when committing pixels.            |
| Texture page `frame.revision` | GPU upload cache and retained publication ownership | Advance once for every original intersecting upload, with the same page footprint and dirty flags. |
| Stage surface `revision`      | stage/GPU surface synchronization and cold restore  | Copy the final page revision, including all logical increments.                                    |

These are internal cache/publication versions, not native task frame counters or
script query results. They are compared explicitly in the regression fixtures;
combining pixels does not discard them. Native dirty/bounds queries pass the
native dispatch barrier, and screenshots compose only after pending work has
settled. Presented-frame recording and host thumbnails continue to read the
presented framebuffer. The regular World checkpoint guard rejects an active
frame; direct text checkpoints also reject an unsettled publication.

## SDK63 and SDK67 StringPlane state and ownership

Each exact build's Main66 kind8 factory runs its own 1904-byte constructor under
an actual Script and Root. Main123 copies the 96-byte caller header and counted
CP932 line-break units into a 1128-byte receiver packet. The normal group uses
small four-channel bitmaps, bounded sixteen-cell storage and deferred parsing;
it does not consume glyphs. Main124 has two fixed words in both builds, with
its own formatted-byte expansion before the receiver.

Main126–129,131/132,138/139 and456 retain full option words, cursors, spacing,
font size, marks and alignment in the separate forty-byte cells. Main130 and133
consult actual graph registration. A newly configured graph is unregistered, so
hidden force/restart operations leave playback inactive even when the Base
display word is set. Both builds now use the existing shared registration policy.
Nonempty glyph raster and published output are a following qualification group.

Main134 converts its valid CP932 input into a temporary terminated sixteen-bit
packet; the kind8 receiver ignores it and Main135's scalar message through its
base default. This establishes a receiver-specific ignored shape, not a global
constant-result stub. Main391 returns zero before configuration or the existing
bitmap owner without retaining it. Reconfiguration releases the old bitmap;
normal Root retirement releases the final owner. JavaScript handles preserve
these ownership relations without comparing physical addresses as integers.

The original group executes 27 target and 18 bootstrap/dependency GCALLs per
build, with one real EngineStop and two actual Root logic frames. Each current
VM replay checks the copied configuration, all initialized scalar fields and
character cells, plus eight independent cold continuations. Native font/DC and
RefHeap allocations remain recorded separately from JavaScript cell storage.
Only pixels written by a proved clear are compared. Glyph/provider rendering,
physical GPU output, unsupported formats, unknown recipients and the separate
Application-to-Device logical key publisher remain outside this state group.
