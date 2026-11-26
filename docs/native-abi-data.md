# Native semantic catalog and engine registrations

Native meanings live once in
[semantics.mjs](../src/native/abi/semantics.mjs), indexed by table namespace and
numeric ID. Main, generic/MOT and the two particle namespaces remain separate.
The catalog contains 932 reviewed main meanings and 45/44/51 auxiliary meanings.
These are the union of the registered engines' recovered declarations, not a
list of functions enabled in every engine. Project descriptive names do not
claim to recover the compiler's original symbols.

The engine modules [2.6.1.23.mjs](../src/native/abi/2.6.1.23.mjs),
[2.6.1.63.mjs](../src/native/abi/2.6.1.63.mjs),
[2.6.1.67.mjs](../src/native/abi/2.6.1.67.mjs),
[2.6.1.74.mjs](../src/native/abi/2.6.1.74.mjs) and
[2.6.1.76.mjs](../src/native/abi/2.6.1.76.mjs) explicitly register their own slots,
signature differences, observations and evidence. They also own their existing
service behavior, capability, message, encoding and layout records. No engine is
selected or enabled by proximity to another version number.

| Engine   | Main slots | Recovered | Reserved noop | Constant zero | Unknown | Generic / particle v1 / v2                       |
| -------- | ---------- | --------- | ------------- | ------------- | ------- | ------------------------------------------------ |
| 2.6.1.23 | 869        | 688       | 57            | 17            | 107     | Generic 44 of 45, Particle 43 of 44 and 50 of 51 |
| 2.6.1.63 | 938        | 657       | 80            | 19            | 182     | Generic 44 of 45, Particle 43 of 44 and 50 of 51 |
| 2.6.1.67 | 938        | 723       | 80            | 19            | 116     | Generic 44 of 45, Particle 43 of 44 and 50 of 51 |
| 2.6.1.74 | 1009       | 859       | 82            | 19            | 49      | 45 / 44 / 51                                     |
| 2.6.1.76 | 1055       | 922       | 58            | 17            | 58      | 45 / 44 / 51                                     |

The registry represents 5,509 slots, including 2,344 SDK74/Game76 slots.
The older registrations retain unknown auxiliary slots and unadmitted stub
observations. The counts reflect the classified slots in each registration.
SDK74/Game76 auxiliary generic entries retain `recovered` and particle entries
retain `declared`.

These registration counts do not count SDK acceptance. Every table entry also
needs a link to its own executable fingerprint or a proved equivalence bridge,
and to an actual test of that behavior. A `recovered` label or static wrapper
survey alone is insufficient. In particular, the 95 declared particle entries
per modern build remain subject to that evidence review; choosing the correct
particle table does not prove its individual functions. Functional cases,
original stub behavior and guarded shapes are recorded separately.

## 2.6.1.23 startup and title

The fixed `.23` Main table points 57 slots to `0x479660`, which returns control
2 with the VM result untouched. Another 17 point to `0x487160`, which writes
zero and returns control 1. Both bodies ignore their operands. Literal GCALLs
in the fixed script archives establish separate widths for 435 Main slots,
including 34 of these stubs. A width observation does not bind an unresolved
handler or impose arity on the ignored operand lists.

Main 140, 142 and 549 use a separate control-1 body at `0x487a50`. The
body leaves the result unwritten. GCALL pushes its fresh `0xcccccccc` scratch
word and reports the unwritten result. Main 6 copies its input word, Main 65
yields and Main 453 sets the caller's exit word. Main 50–52 and 54 return
single-precision sine, cosine, tangent and arccosine. Main 57 takes a floating-point
absolute value, quieting a signaling NaN and clearing the sign. Main 397 uses
the same y, x operand order and x87 CRT
result as Generic 7 and Particle 12. Main 64 and Generic 16 take the signed
integer absolute value. Main 318 uses x87 interpolation and Main 319 writes
the low word of the integer64 after half-step rounding.

Main 7 returns the caller's frame-rate DWORD, sharing its native body with
slot 4 in both Particle tables. Main 53, 55, 56, 58, 59, 60, 61 and 321
share bodies with Particle 9, 11, 13, 15, 16, 17, 18 and 43 respectively.
All publish one float32 result word. Physical x86 confirms the original
remainder, including signed zero from nonzero dividends and NaN operand
selection. The triangle wave uses the Core x87 PC24 baseline. PC53 and
PC64 can differ by one float32 ULP on subnormal results. Both Particle
power entries and Generic 13 follow the same initialized SSE2 CRT selection
as Main 61. The hardware quiets a signaling NaN even when its exponent is
signed zero. Main 50–52, Generic 1–3 and Particle 6–8 use the initialized
CRT's trigonometric ranges. Large arguments use the original CRT period
and the x87 processor's 66-bit pi for reduction, including finite inputs
above the x87 instruction range.

Generic 18–20 snapshot three writable component DWORDs before rotation.
Generic 21/22 instead read and write each mapped component in order, so
overlapping pointers preserve the original live values. Both validate all
three pointed words before writing. Generic 24/25 use the current matrix
fallback shared with Main 205/206.

Main 350–358 and Generic 27–37 share mapped matrix and vector layouts.
Inverse uses the current matrix when the destination fails address
translation. A singular matrix retains its prior words. Copy and
subtraction process DWORDs forward, so overlapping buffers retain the
original live source behavior. Vector scaling loads its factor once.
Length and squared length return one x87 result word. The Core uses the
original scalar D3DX PC24 path for inverse, multiply, normalize and
transform. The original SSE2 selector can produce different words on
these operations, including a distinct zero-vector normalization.
Transformation requires finite operands until its raw nonfinite results
are reproduced.

Main 11 writes seven local date and time DWORDs in original field order.
An aliased destination receives its last field. Main 214–217 clear, unite
and test signed 16-byte RECT records. The bitmap union uses physical
dimensions and signed offsets. A null bitmap contributes an empty
rectangle, and the union reads both sources before writing the destination.
The Core checks the complete guest spans before any write.

Main 120 reads a destination bitmap, a list of 12-byte bitmap handle and
signed XY records, an unsigned record count, and a signed RECT. It clips
the rectangle to physical bitmap rows, clears that region to opaque black,
then composites each clipped source in list order. RGB24 copies into RGB24
and ARGB8888. ARGB4444 blends into ARGB4444 and ARGB8888 using the source
alpha. ARGB8888 to ARGB8888 uses the wrapper's zero opacity. One-byte bitmap
paths leave the raster untouched. The four remaining packed conversions
reach bytes outside the original pixel span or opacity table. Rightward
overlap on one RGB24 backing varies with the native CPU copy mode.
The Core guards these shapes before clearing. A null destination bypasses
pointer reads. The wrapper returns control 2 with the result untouched.

Main 121 scales a borrowed bitmap and Main 713 walks owned layer and animation
bitmaps. Both take four words in bitmap or image, red, green, blue order. They
return control 2 without writing the result. A null owner or three factors of
100 skip owner lookup. The shared CPU kernel updates the RGB bytes of each
four-byte pixel with unsigned DWORD multiplication, division by 100, and
saturation to 255. The kernel preserves alpha, row padding and metadata.
Repeated references to a layer bitmap apply the operation repeatedly.

The original kind 8 text receiver handles Main 126–129, 131, 132, 138
and 139. Main 126 sets both scheduling words and resets its cursor.
Main 127, 128 and 131 update line spacing, layout and font size. Main 132
appends the 40-byte pause cell when its row table has space. Main 138
writes the two cursor coordinates, and Main 139 adjusts the retained row
positions in vertical modes 1 and 2. Missing owners leave these setters
inert. Main 129 publishes availability as 0 or 1. When the original
route does not initialize this reply, its wrapper pushes the caller's
native pointer. The Core guards that form and requires the live kind 8
owner for the query.

Main 123 builds the 1,128-byte initialization packet shared with Main 418.
It copies a 96-byte guest definition, converts up to 256 CP932 units into
the first line-break table and clears the second table. The disabled form
retains the current object. Active initialization is covered for
ARGB8888, including empty dimensions and the visible output flag.
The Core guards packed text bitmaps and a line-break table that would spill
into its neighboring count. Both wrappers return control 2 with the result
untouched.

Main 136 normalizes a borrowed bitmap into an independent ARGB8888 atlas
for the live kind 8 text owner. The copy uses its logical canvas, native
signed offsets and packed pixel conversion. A zero bitmap operand skips
the message. Main 137 inserts the first rectangle for the low 16 bits of
the character and retains it on repeated insertion. Both return control 2.
The atlas consumer uses physical rows, signed bounds for interpolation and
integer crop origins for area reduction. The Core guards area reduction
beyond the owned atlas, as well as invalid or uninitialized owners.

Main 27 appends zeroed storage to the caller's virtual memory. A zero-byte
allocation keeps an empty record and returns `0xffffffff`. Main 28
releases a mapped allocation at its exact start and returns 1. Interior,
unmapped, local and shared addresses return 0. Releasing a block compacts
later virtual addresses while keeping their bytes. A stale address can
therefore resolve to the start of another block.
Both wrappers return control 1 with a written result.
Main 237 performs the same release. Its wrapper writes the release result
into the original native scratch word, and control 2 leaves the guest stack
without a result.

Main 26 consumes the decimal prefix of the formatted CP932 input and
returns the float32 word through control 1. Its exponent accepts E or D,
and the result preserves signed zero. Main 37 writes the grouped signed
decimal bytes with two trailing NULs and returns control 2. The optional
plus is used for a positive value and the signed minimum preserves the
original byte sequence produced by DWORD arithmetic.

Main 289 creates an owned array of 40-byte rows. Each row holds a
32-byte CP932 name field and two DWORDs. Main 291 writes the first empty
row and returns control 2. Main 292 finds the first matching name with
ASCII byte case folding. It writes the first DWORD before the second when
both destination addresses coincide. Main 293 searches both words and
writes the stored name with its terminator. Both queries return control 1
with 0 or 1 when a table is present, and control 2 with no result for a
null table. Main 290 releases the owned allocation. The Core limits table
allocations to 64 MiB, checks guest output spans and requires the row scan
to stay inside the table. Main 834 retains the guard on the untyped
native-memory release alias.

Main 405–416 load and query binary gallery resources in the FES category.
Variants use 20 groups of eight 540-byte records. A missing or wrong-size
resource creates a variants handle with zero groups. Names use a signed row
count and four 32-byte fields per row. A missing names resource returns zero.
The count and close pairs share the original bodies and accept either layout;
variant and name field queries require their respective layout. Variant
references merge two choice masks and write two trailing NUL bytes. Name
lookups write one NUL byte. A reference with an unmapped destination returns
zero. A valid name with an unmapped destination is refused before writing,
since the original would write through a null pointer.

Main 122 and 705 share the original bitmap resize wrapper. The four-byte
bitmap path uses the Core x87 PC24 baseline for dimensions and metadata.
It interpolates for ordinary scaling and averages the source cells when either
axis exceeds a four-to-one shrink. The two-byte cell path publishes a zeroed
bitmap. Ordinary resampling retains two- and three-byte bitmaps when the
original kernel declines them. Empty dimensions follow the original result.
Nonempty 24-bit cell averaging is protected because the original reads past
its source allocation. The measured PC53 alternative can change large
unsigned offsets without changing the sampled pixels or control word.

Main 10 formats CP932 bytes and expands backslash-n before opening the caller's
clipboard. The browser host publishes text under its normal permission and user
activation rules. Clipboard denial leaves the VM result untouched. Main 441
publishes the full recording DWORDs and a prefix of at most 31 CP932 bytes.
The original copies longer prefixes into the adjacent view resource, so those
inputs are rejected before the recording state changes. Main 565 and 566 read
the retained flags and counter. A frame increases the counter when the view
obtains a bitmap, before the virtual BMP write. The filename retains the signed
counter spelling and the counter wraps as a DWORD.

The Main 271–275, 426–427 and 693 wrappers use the original kind 16
receiver's raw messages 285–292. Load receives a 656-byte packet with
separate 128-byte names and a 128-byte register section. Replacement
keeps the active word. Main 271 and 693 write one. Main 274 initializes
a zero result before routing and reads the active word when the owner
answers. The raw status message is the only receiver case that writes
a result. Raw load with a null pointer retains the bank. Register update
quietens signaling NaNs during its float32 copy. Alpha is signed below 255
and becomes 256 at or above 255. Attachment zero selects the detached
state.

Generic 43 and 44 and Main 662 use the original unoptimized D3DX scalar
path with x87 PC24 as the Core arithmetic baseline. Main 662 writes a
new YPR matrix. Generic 43 multiplies its mapped matrix by the rotation.
Generic 44 derives two axes from the reference matrix and applies three
rotations in order. Each operation validates the mapped span and writes
the complete matrix. Generic 43 and 44 preserve overlapping source and
destination spans, including unaligned local or shared memory.
Main 204–206 apply XYZ rotation, translation and scale. They use the
current matrix from the caller's World when the address does not map.

Main 89 reads the priority of the selected Plane model through raw 57.
A zero target returns a zero float word. An unwritten or unresolved
active result stays guarded because the original wrapper can copy stale
stack bytes. Main 90 stores finite parent offsets and applies the attached
renderer model's pose. It retains those offsets when a child is unloaded
or the renderer is detached. A live child with unresolved parent model
coordinates stays protected before mutation. Main 91 stops inheritance
without changing the stored offset or pose. Main 102 stores the selected
task and hides that recipient through raw 43. Main 103 retains the
complete hint attribute word.

PTCL v1 and v2 slot 38 point to the same receiver. It computes four
bounds from the viewport, live priority and near plane and writes the
four output words in call order. Guest offset zero is a valid destination.
The query runs without a texture or graph attachment. PTCL v2 slots 44 and
45 restore and save every owned 112-byte quad. Initial allocation seeds
the backup from the active span. The single argument is ignored. Slot 46
publishes the full attachment DWORD without resolving a graph.

PTCL v2 slots 48 and 49 write the selected live model's base X/Y and
position X/Y/Z respectively. An empty attachment or detached graphics
device produces zero words. Each call checks all destinations before
writing. An active renderer with an unresolved model stays protected
because the original can return prior scratch coordinates. Slot 47
reads the separate renderer registration DWORD. Plane raw 43 and 44
retain the old word when a request leaves enablement in the same state.
The fixed registration tracks the complete DWORD for proven live records
and returns zero for a detached device, empty attachment or missing
record. Older snapshots and graph types without a verified register
word reject this query until a covered registration is created.

PTCL slots 29 and 37 share the same handlers across v1 and v2. Slot 29 reads
the first and third words as float32, subtracts a half texel, and divides by
the current texture dimensions. All eight writes belong to the selected
quad. Slot 37 reads two three-word vectors and writes the distance result.
The Core uses the physical x86 PC24 arithmetic for both calls. The optional
desktop diagnostic in slot 0 stays guarded while the authorized original
debugger output path is outside the browser coverage.

The fixed executable assigns the PTCL v2 table only to header version
`0x20000` and selects v1 for other versions. The acceptance collector uses
that dispatch rule for the registration's original executable digest.

The original tuned x87 and SSE2 arithmetic can round intermediate matrix
and viewport values differently. Core uses the selectable scalar path
with D3DX CPU optimizations disabled. The observed native CPU paths
share the same control codes, output locations and task state transitions.
This coverage concerns the arithmetic and VM outputs before rendering.

Main 61 and 461 use their linked CRT operations for power and base-10
logarithm. Under the original modern CPU selector and masked floating-point
environment, the power wrapper retains a NaN base when the exponent is zero.
Bases of either sign at unit magnitude return one with an infinite exponent.
Both wrappers write through x87 and quiet signaling NaNs in the guest result.
The original fallback without SSE2 differs in some power result words.

Main 83 uses Plane raw 63 to release the graph and its tracked input
registration. Main 86 and 87 send raw 57 and 58 to query the selected
geometry or texture pose and write two or three float words. The query
leaves guest memory unchanged when the target ID is zero. A nonzero
target must supply initialized pose words before the Core writes the VM
outputs.

Main 74 reads the complete Base flags through raw 12 and returns
`0xffffffff` if the route misses. A routed Top or retiring task can
leave the original caller pointer in the result slot and remains protected.
Main 75 reads the caller's registry in signed key order and counts entries
whose direct branch belongs to that caller. A key may identify a descendant
through an owned branch. An index past the available entries returns
`0xffffffff`. Main 77 reads membership in the current Top's registry,
including reserved keys with no live value.

Main 95 registers input through Plane raw 83 using the owned pose,
configured virtual dimensions and signed rectangle coordinates. A live
device and registered graph are required to obtain this geometry. A repeat
retains the installed region and updates the receiver's last flags.
Main 96–98 send raw 67–69 to the Plane button owner. Main 96 copies four
12-byte enable/X/Y rows and stores the complete flags word. The first call
requires live model geometry and registers its current hit rectangle.
Repeats preserve the existing Input registration. Main 97 selects the row
from the low halfword and stores bit 31 independently. A disabled row keeps
the current phase and position. An enabled row moves the primary model on
a live device. A linked hint uses the retained Input rectangle and a Plane's
written dimensions. Main 98 returns the phase DWORD with the blocked bit
in bit 31 and requires a written reply from a nonzero target.
The registered Input owner selects the hover and press rows on pointer
events and selects the hover or idle row on button release. The blocked
bit suppresses pointer transitions. A selected state 3 suppresses both
pointer and keyboard forwarding through the Plane's key receiver.
Main 107 uses the caller's Top and reads the selected Input region's full
activity DWORD. A missing region leaves the original scratch unchanged
and is refused before a value reaches the guest.
Main 109 retains the full raw Input source word through Plane or BasePlane
raw 89 and Input raw 129. A route miss writes zero. A route without a
verified source reply fails before exposing an output.

Main 346 formats a CP932 filename and resolves the configured KX3 directory
before sending raw 66. The verified Plane and BasePlane receivers leave
the result and graph unchanged. Other live receiver kinds remain protected.

Main 398 and 399 configure and write the 128-byte retained Plane
history through raw 74 and 75. The receiver retains the selected stride and
applies explicit samples on the next draw.

Main 701 and 702 use Plane raw 40 and 82. A hardware-backed mode-1 Plane
loads the verified MPEG source through the old CP932 movie category. A
missing source or declined decoder leaves the existing nonmovie graph in
place. Main 702 returns the owned movie handle or a zero result for a route
miss or an owner without a movie. See [ordinary Plane movie ownership](native-movies.md#ordinary-plane-movie-ownership)
for the decoder and device limits.

The fixed factory declines task kind 43. With an unrouted parent, Main 66
retains the interpreter's unwritten result word `0xCCCCCCCC`. A live
parent enters the original null-object registration branch and remains
protected. Main 576 and 689 read a CSS record before querying the optional
task. A null CSS handle or missing record returns zero. For an unrouted
recipient or a neutral Top or Script, a present record returns one and
leaves the CSS and tasks unchanged. Main 689 accepts the verified packed
tree layout with relative child and sibling offsets and requires a whole
record. Other live recipients and malformed trees remain protected.
Main 688 stays guarded because a missing reply can cause the native serializer
to interpret the GCALL argument area as a tree.

Main 433 sends raw 42. With a live mode-1 device it reserves an empty
parent graph and creates its child planes in row-major order. An already
registered parent keeps its existing graph and children. The native empty
parent's bounds lookup leaves its output coordinates unwritten. Native and
FES size or input registration requests that need those coordinates fail
before exposing an output. Child graphics retain their measured dimensions.

Main 521–524 use raw 343–346 on screen effects 35 and 36. The matrix
initializer copies 64 mapped bytes and six operands into an 88-byte
packet. The rectangle initializer sends nine words and scales its
rectangle using the current and configured view dimensions. The start
wrappers pass the full active word. With no capture capability, the
receiver leaves the effect state unchanged.

Main 855, 857 and 861 use raw 449, 451 and 453 to start or stop kinds 50,
51 and 52. The receivers retain the full active word. A nonzero word
restarts the range from the effective frame minus paused frames. A zero
word keeps the previous range and elapsed frame. Kinds 50 and 51 reset
their mosaic selection key on both start and stop. A disabled receiver
leaves state unchanged.

Main 860 sends the seven-word WBreak initializer over raw 452. The task
uses the full logical screen for its grid and a power-of-two capture for
texture coordinates and projection. It consumes four words from the
legacy real stream per shard. Active initialization resets start and end
from the current effective frame and retains elapsed time for the next
unsigned frame step.

Main 853 and 856 take six VM words and send five-word WipeMosaic and
FadeMosaic packets over raw 447 and 450. Main 854 uses raw 448 to prepare
the second private WipeMosaic capture and release the shared targets.
Both screen effects keep the raw mode word and restart the clock range
on active initialization. WipeMosaic retains the base frame on zero and
one-frame intervals. Both mode branches keep the original working texture
pixels, mirrored wipe keys and fade alpha.

Main 29 scans the formatted CP932 mode bytes for the first lowercase
`r` or `w`. Main 30 and 31 transfer the DWORD product of the element
size and count, report the actual byte count and turn an unavailable
transfer into zero. A mapped read that cannot fit its destination leaves
the open cursor intact. Main 32 releases the owned file and leaves the
VM result untouched.

Main 683–685 load, release and query a CP932 section table. Section and
key comparison is byte-exact. Repeated headings accumulate matching
rows in order. The lookup uses the zero-based ordinal and writes a
NUL-terminated value only for a match, including an empty value.

Main 454 copies the caller's NUL-terminated CP932 FES context name to VM
memory. Main 577 sends raw 37 to the caller's Top and sets its field.
Main 651 and 694 send raw 23 and 28 to the selected Base task and set
its exit or user word. Target zero routes to Top, whose receiver leaves
the Base fields untouched. Calls preserve the VM result word.

Main 99, 106, 110 and 394 use Plane raw 84, 87, 90 and 91. They remove
the region, activate it with the supplied DWORD, set the receiver word
or install a private hit-mask copy. The mask uses the native bitmap
row order, canvas offsets and packed alpha. Alpha-free 24-bit pixels
leave the mask clear. Main 150 routes through the caller's Top and
passes unsigned 16-bit coordinates to Input raw 130. The move keeps
its original interval. A disabled preference or an out-of-bounds
point leaves the pending move in place.

Main 845–847 post display toggle, minimize and close commands to the
script window. The queue drains through the corresponding menu
commands. The close branch uses the fixed CP932 prompt and configured
title. Decline leaves the task tree open. Main 445 formats its CP932
operand and opens a modal with the fixed `system error` caption.
FES `setconf screen` appends the five-word event `[18, mode, 0, 0, 0]`.
The Root task posts window message `0x467` with the full mode DWORD
as its `lParam`. The response from the window updates the stored mode.

The original FES row dispatcher resolves the expanded name and index
against the live object collection before considering its common
command table. A matching object always uses its object verb or named
subcommand. A missing object falls through to the common command for
the original head. The same spelling can therefore name a button in
one FES collection and a common command in another.

FES type 15 owns a kind 42 Slider. The original FES update at
`0x472140` sends raw 328–334 to the kind 42 receiver at `0x455d40`.
The 292-byte load packet holds the Draw ID, a 260-byte CP932
filename, priority, rectangle and two Plane offsets. The receiver
loads HG2/HG3 frame 0 and creates separate kind 6 track and thumb
areas. A track click sets the value and notifies the FES owner.
Thumb press enters drag and selects frame 3. Focus forwards the
original DWORD and selects frame 0 or 2 outside a drag. Enable
forwards the same DWORD to both areas and retains the current
skin. The verified window settings use the direction query, range,
value, alpha, enable and show messages. Kind 40 SCROLL, kind 41
SCROLL2 and Slider skin-table mutation remain guarded on this build.

Main 514 formats its CP932 operand and completes the MOT category
filename. It copies the manager's 144-byte base bank to working
before comparing the requested filename to the retained record
basenames with C-locale byte folding. A null manager writes zero
without reading the filename. A qualified filename can miss even
if its basename names a loaded motion.

FES `endfes` and `endkcs` enqueue separate child-destruction records
and reset `_EXITCODE_` to -1. Both return one to the decoder. The
frame cursor resumes on the next tick, after the child's destruction
request, and a notification cursor stops at the command.

FES `getconf iswindow` reads the startup flag for windowed mode
availability. `getconf screen` reads the independently stored current
display setting. The browser can fit the rendered canvas into the
viewport in windowed mode, including when fullscreen is currently active.

Main 681 resolves a formatted CP932 image filename and warms the
decoded image cache. It releases the temporary bitmap owner and leaves
the GCALL result word unwritten. A missing image leaves the cache unchanged.

Main 723 rotates a borrowed image owner's retained layers by 90, 180
or 270 degrees and resets the bitmap clipping rectangle. Main 727 mirrors
the layers vertically for zero and horizontally for any nonzero word while
retaining the clipping rectangle. Both rebuild the retained owner geometry
and leave the result word unwritten.

Main 735 clips the source and destination rectangles independently. An
equal-sized copy updates aliased rows from the bottom upwards. A scaled
copy samples the live backing of an alias and preserves a destination
pixel when every contributing alpha byte is zero. The scaled paths handle
32-bit input to 32-bit or packed 16-bit output. An empty destination owner
selects the VRAM transfer.

The kind 48 STRING receiver handles raw CP932 resource messages 407–419.
The 188-byte record contains 172 configuration bytes after its size word
and three trailing words for VRAM coordinates and output. Main 611–615
and 617–621 route through the same receiver as FES STRING. Finish renders
all pages. The image-font message transfers the resource when the task has
a writer, and the character mapping uses the low 16 bits. Main 695 changes
the writer period and rebases the animation clock when the period differs.

Main 4 writes the current millisecond timer DWORD, including its rollover.
Main 25 formats a CP932 string from guest memory and parses its signed decimal
or hexadecimal prefix into a DWORD. A decimal point after the digits or an
invalid first digit produces zero. Main 786 calculates a weekday using the
original signed integer century formula, including the signed remainder for
dates whose intermediate sum is negative. All three write the result and
return control 1.

Main 33 and 34 share the integer and real MT19937 streams with Generic 39
and 40 and Particle 33 and 34. Both Particle tables use the same entry addresses.
Each call consumes one word from the selected stream and writes one result.
The real conversion adds 2³² to negative signed inputs at x87 precision
24 before scaling. The addition can change the low bit of the final float.

The Grisaia base profile selects the exact loose `config/startup.xml` and
checks its executable resources after applying preferences. Startup then
initializes Sound and textures, publishes the raw window title and starts
the Root Script. The native Root protocol starts at message 29. Its Input and
Sound queries are 31 and 32, with the Sound reset routed to message 181.

The startup Script uses Main 14 for a formatted CP932 copy. It returns the
destination pointer and writes two zero bytes after the string. Its startup
XML branches also use Main 1 for formatted logging and Main 36 to fill a
bounded byte table. Main 35 copies the requested span between mapped VM ranges,
including shared Script memory. These calls use the shared standard handlers.

Story setup uses Main 15 to append raw narrow bytes to the destination and
return its VM address. It writes two terminating zero bytes. Main 594–597
open and release the group's tone table and query RGB values by group or
character alias. A missing query leaves the three output words untouched.
Main 739 doubles the truncated device offsets and projects them into the
two output viewport coordinates. Main 740 writes the coordinates using the
configured full-position mode. Main 741 returns the Settings `mw_pos` word
in fullscreen and zero in windowed mode.
Main 16–20 and 22–24 implement formatted append, raw/formatted byte
counts, byte comparisons and pair-aware truncation. The second compare
formatter writes 1,024 bytes below the first, so a sufficiently long
second result replaces the first string's beginning.
Main 40 and 47–49 use the narrow CP932 pair rules for classification,
character counts and search boundaries. Search returns a byte offset or
the whole input byte length when absent.
Main 38 and 39 copy up to the first separator or capacity and write two NULs.
Both recognize literal `\t` as a separator escape. Main 41 splits the live
source bytewise, Main 43 keeps nested parenthesized groups, and Main 42/44
select and join the live NUL-delimited entries.
Main 392 formats and extracts narrow text without ruby annotations or
layout controls. Its older scanner copies literal tabs, consumes unknown
escapes and treats the `r` in `\wr` as ordinary text. It terminates the
output and returns its CP932 byte length.
Main 418 configures the kind 8 Text task with the 1128-byte packet and
both line-break tables. Main 124 appends formatted narrow text, Main 125
clears the task and Main 557 sets its secondary color. These use raw
94, 96, 97 and 114, respectively for configuration, append, clear and color.
Clear publishes the empty bitmap when the configuration directs output
to the virtual surface.
Main 212 sets the caller's expression context word. Main 213 evaluates the
mapped narrow expression in that bank after removing a trailing `%`.
Main 539 evaluates scalar, comma-list and inclusive range arguments in the
same bank. It writes at most the supplied capacity and returns the word count.
Main 46 scales signed integer percentages in place. The base word is unsigned
and the original x87 multiplication reads the integer percentage directly.
Main 62 and 63 convert angles with the extended x87 exponent before storing
the float32 result.
Main 320 updates five-float spline records in place with the original x87
evaluation order. Fewer than three points leave the guest range untouched.
Main 609 and 610 copy the bank's capacity in bytes between its live and
backup allocations. Main 658 and 659 access its selected private context
with a 512-word bound.

Its title draws through the caller-owned Input, Plane, Draw and FES tasks.
The title's pointer handlers use Main 108 to set the Plane's input return
word. Its wrapper sends raw Plane message 88 with W zero and the full 32-bit
value in L. The current input dispatch consumes and clears this word. The
wrapper returns control 2 without writing a VM result.
Main 285 reads the four Input source words for a key through raw 137 and
returns their bitwise OR. Main 286 sends raw 138 to clear active regions
and invalidate the last cursor position.
Main 403 sets a single key's gate by raw Input message 143. Main 404
restores all key gates by raw 144. Both resolve the owner through Root 31
and return control 2.

Main 347 and 348 send velocity and Doppler words to the selected loaded
Sound bank through raw 182 and 183. Main 602 and 603 register and release
sound groups. Main 604 sends a resolved filename and a group selector to
raw 192–195. The receiver chooses the group by ID or type, allocates a
bank within its exclusive bound or among releasing banks, and preserves the
streaming loop flag in the high selector word.
Main 605 reads the selected raw group gain, or 100 for an unmatched
group. Main 606 and 607 return the original play and master-volume
words from the compact 88-byte voice rows. Matching uses the standard
CP932 directory splitter before the original prefix comparison.
Main 844 returns the same voice row index used by those getters. Main 674
resolves its archive through the original 48-entry category table.
Main 565 and 566 read the recording state and counter from the active
view. Main 567 writes a formatted CP932 line through the owned native
files and retains the original append cursor before CRLF.
Main 113 captures the active view as an owned opaque bitmap. Main 116
clips equally sized source and destination requests to the smaller
surviving span. Main 241 and 251 write and restore an independent HG
bitmap through CSS, and Main 850 and 851 persist the display log there.
Main 852 returns the full `GAME/log/static` configuration word with
control 1. The original getter's view begins 0x210 bytes into the
startup configuration read by the XML parser.
Main 568 prepares one screen capture, then draws the requested floating-point
priority range into slot zero. Main 858 and 859 expose separate preparation
and capture. All three leave the VM result unwritten.
Main 520 reads the transition activity word through raw 342. Main 527/528
configure and start a retained Fade through raw 349/350. Main 530/531 use raw
352/353 for Wipe and retain the supplied mask. Configuring an already active
Fade or Wipe recomputes its start and end from the live task clock.

Main 78 creates a textured Plane through raw message 38 with an eight-word
rectangle packet. Main 80 resets it through raw 41. Main 81 formats a narrow
filename and loads the mounted KX2 triangle model through raw 64. Main 82
uses raw 65 to load the standalone colored model through the original
CP932 category path. It copies the triangles and signed bounds into a
new owner in renderer mode 1. A repeat retains an existing graph. An
inactive renderer, missing file or another file signature leaves the
owner unchanged. These wrappers return control 2 without writing a VM
result. Main 84, 85 and 93 update its
position, planar base or rotation. The planar base update reads and preserves depth. Main 94 clamps
the signed alpha to 0 through 255 and sends raw message 59 with flag one.
Main 101 and 344 set scale and a selected transform matrix. Main 343 and
345 read the authored local bounds. Main 402 sets blend mode, and Main 466
writes coordinates only to a present render model. A replacement model
starts with coordinate mode zero.
Main 541 releases the texture pages intersecting its rectangle. Main 542
allocates missing configured pages while preserving existing pages.
Main 257 adds a bitmap entry with its transform and clamped opacity.
Main 258 removes a selected Draw entry. Main 261 queries the bitmap owned
by the Draw task. Main 455 copies an optional source into its independent
base image. A zero source hides the base image.
Main 339–342 use raw Draw messages 263–266 to clip an entry, redraw, clear
the retained entries and force output. Clear releases the entries and
reinstates the base image when present. Main 534 sets the Draw update word
through raw 278. These wrappers return control 2 without a VM result.
Main 653 applies the full VRAM type word through raw Plane message 79.
Main 654 and 655 format two or one CP932 strings and send raw 80 and 81.
The Plane consumes both notifications without changing its state.
Main 218 replaces the caller's signed rectangle with its intersection,
using four zero words for an empty result. All four wrappers leave the
VM result unwritten.

Main 119 returns bitmap size through two mapped guest output words. Main 363
writes bitmap offsets through the same argument shape. Both write zeros for a
null bitmap and leave the GCALL result unwritten. Main 372 and 373 set bitmap
canvas dimensions or offsets and return zero for a null bitmap. Main 369
multiplies each of four channels by its packed channel byte divided by 255.
Main 718–720 update an image owner's canvas dimensions, offsets or base point.
These three report success on a null owner and failure when an existing owner
has an empty bitmap.

Main 111 loads a formatted image list. Main 112 creates a bitmap, Main 114
releases it, and Main 118 clones its pixels into an independent owner.
Main 115 and 367 copy clipped regions and Main 362 reads the canvas size.
Main 365 opens packed data from the `image` archive. Main 368 returns
36 bytes of frame metadata, Main 364 creates a decoded bitmap, and
Main 366 releases the original packed buffer.
Main 598 extracts the base from the first nonempty comma field.
Main 710 loads selected image data into a Script-owned bitmap, Main 711
releases it and Main 714 writes its canvas dimensions. Main 733 creates an
independent four-byte canvas and Main 736 fills its rectangle. Main 732
updates the selected Draw entry through raw 256 with the image owner and
the authored transform and opacity.
Main 712, 715 and 717 query the image dimensions, offset and base point.
Main 724 writes the selected attribute's rectangle and color using its
low 16-bit ID. Main 713, 726, 730 and 737 tone, blur, resize and filter the
image. An empty image owner writes zero dimensions in Main 712.
Main 625 sends the selected entry's full animation enable word through raw
Draw 269. Main 728 writes the bitmap's mask word without rebinding its owner.
Main 862 sends the four original RECT boundaries through raw Draw 284.
The receiver marks its own surface dirty and redraws that rectangle immediately.
Main 196 selects an Area initializer by the receiver's kind. Kinds 26 and
29 read a 56-byte bitmap wipe packet in raw 248. Kind 30 reads a 60-byte
packet with a second duration in raw 251. Main 197 starts the task through
raw 231, Main 200 reads its activity through raw 233, and Main 203 finishes
an active wipe through raw 235. The legacy queries require a written reply
because the source wrapper's scratch word has no initial value.
These receivers allocate a zeroed work bitmap with the smaller width and
height of the two images. The mask starts at its own origin. Its offsets
place it in the work bitmap and the borrowed images. The remaining work
extent clips its width and height. Kinds 26 and 30 copy destination RGB into
fully transparent source pixels. Kind 29 copies each whole pixel from the
source or destination according to the advancing threshold. Kind 26
uploads the full work bitmap. Kinds 29 and 30 upload only the clipped mask
rectangle. Natural completion clears the mask offset and uploads the
destination rectangle. An explicit finish for kinds 29 and 30 retains the
mask offset on that upload.
Main 76 reads the caller's parent ID. Main 536 searches an owned bitmap
attribute using the low 16 bits of the selector. A match writes four rectangle
words and the color, while a null bitmap or missing attribute returns zero
without writing to the destinations.
Main 149 resolves the caller's Input through Root 31 and writes its
virtual cursor coordinates through raw Input 118.

Main 265 opens a formatted movie filename and queries the Input task
through Root 31. It sends raw Input 136, a handled notification with no
state change. Main 266–270 own play, stop, close, status and redraw.
Main 417 scales the requested volume by the effective BGM gain.
Main 787 reads the drawing rectangle as left, top, width and height,
and Main 788 sets the movie window with those same units. Failed open
and close release the renderer and cursor gates.

Main 450 and 451 use raw FES messages 306 and 307 for label selection and
the saved object word. Main 630 synchronously dispatches raw 308 with the
formatted event and an optional object reference containing 32 name bytes
and a signed index. Main 645 and 646 use raw 311 and 312 to write and read the
target's private 512-word bank. Main 647 changes its sleep value via raw 313.
Only the label selection and bank read write a VM result.
Main 649 and 650 transfer the selected 512-word FES bank through CSS
using raw messages 314 and 315. Loading a nonempty entry selects
`_LOAD_` when present.

Main 69 delivers four message words immediately through raw Script message
159 and reselects the caller's variable context. Main 70 queues the same packet
through raw Script message 160. Both write the receiver result and return
control 1. Main 72 reads from the addressed Script and Main 73 writes to it.
Both resolve that Script's address space through raw message 161 and copy the
requested byte span. They return control 2 with the VM result untouched.
Main 143 sends the formatted `kcs` path through raw Script message 147
and binds the caller's shared memory through raw 158. Its last operand
selects control 2 or 4 and the wrapper leaves the VM result untouched.
Main 570–572 send directed messages through raw 400, 403 and 402. Main
571 reads one addressed host word or sends zero for a null pointer.
All three return control 2 with the VM result untouched.

Main 207 writes a 16-word identity matrix. Main 294 creates an owned motion
manager at speed one with an empty list. Main 295 releases that owner, and
Main 296 clears the current motions. Main 586 writes the full flag word
used by subsequent motion instances.
Main 297 removes the selected instance ID and Main 298 removes the requested
group. Main 299–303 transfer or commit the
manager's 144-byte base and working records. Main 302 allows an unmapped
display output pointer. Main 304 and 535 read a formatted CP932 motion
name from the `mot` archive and return a new handle or zero. Main 535 adds
the authored delay word. Main 305 updates the start frame for one instance
or for all instances when its ID is zero. Main 306 replaces up to 256
Float32 register words, clears the remainder and activates the instance.
The shared original x87 loader quiets signaling NaNs and preserves signed
zero. A missing instance leaves guest memory and owned state untouched.
Main 307 advances elapsed frames with x87 rounding,
and Main 308 sets the speed.
Main 309–311 query active motion instances by handle, group or manager.
Main 312–314 apply skip in the same scopes. Main 440 finishes the motions
currently owned by the manager and reports whether it visited one.
Main 315–317 own an independent motion record buffer. Main 315 reads
the two adjacent stack words for the manager and frame even where the
authored GCALL encodes one word. The buffer has an eight-byte header and
1,076-byte CP932 motion records, plus each record's extra bytes.
Main 387 stores the allocated buffer in CSS. Main 388 restores an owned
copy, optionally rebuilding the motions at the supplied frame.

Main 323–327 allocate, release and read the owned CP932 CatScene document.
Main 322 formats a CP932 name and uses the scene category's default extension
before checking whether the file can be opened. An existing empty or
unrecognized file still succeeds; the query does not initialize a reader
or parse the scene document.
Main 379–384 borrow the explicit Scene resource and browse its live path
through independent rotating reader slots. They preserve the single-slot
endpoint rule, raw CP932 text and command bytes, conditional text outputs,
required position outputs, and reader identity across rotation. These old
readers do not request CSTL. [History-window contracts](native-history-cursors.md)
also record the retained large-capacity and invalid-lifetime boundaries.
The reader copies file markers from the records with types `0xf0` and
`0xf1`. Main 338 queries those markers and Main 608 queries the block count.
Main 328–333 update or read the independent seen and path lists. Main 336
captures the strings referenced in a record from the caller's existing bank.
Main 334/335 set and retrieve numbered strings with five words, including
the explicit Scene handle. Main 337 expands a writable source using saved
strings and removes parsed missing references; this differs from Main 233's
literal preservation. These calls use the same clamped unsigned path index,
CP932 bytes and 62-byte saved-string limit as the task-local history. A null
handle short-circuits without reading the text pointer. Explicit Main 336
also short-circuits before reading the source when the caller has no bank.
Main 219 replaces the caller's task-local reader and both history lists.
Main 220–232 and 235 use that owner. The task reader shares the explicit
CP932 file-marker and CatScene behavior and does not request CSTL data.
Missing files and unrecognized signatures retain the previous document;
a truncated recognized CatScene clears it. Main 222 requires a mapped
destination and readable text record once the reader exists. Task-local
seen and path names retain their extensions, compare ASCII-folded bytes,
and keep unsigned maxima. Path reads clamp unsigned indices and write
the filename before the position. Main 231 scans the source before
dereferencing the caller's existing string bank: text without a parsed
`$str` reference succeeds without one, while a parsed reference with no
bank retains the original failure. Captured bytes remain independent of
later bank changes and survive a cold World restore.
Main 233 expands references from a separately selected Script history;
missing keys retain their literal source text. A missing source history
is only dereferenced when a parsed reference is encountered. Main 234
replaces both lists through compact serialization, keeps copied strings
independent, and preserves the lists on self-copy. The real Script
receiver returns its history even after its interpreter has been removed,
so a source Script's retained context remains available to these helpers
and after a cold World restore. FES sources without interpreters and the
raw physical-pointer query remain separate message-level scope boundaries.
The raw task-message entry maps `.23` query 162 to shared Script semantic
175 only after resolving the actual kind-12 target. Its inverse mapping
also remains explicit in ABI data. An empty Script writes two zero words
without changing its execution mode. A live Scene owner keeps the existing
physical-pointer guard before writing output. Other actual receiver kinds,
including FES, retain an explicit query guard until independently reviewed;
the raw query cannot execute shared Script action 162 by numeric coincidence.
The native CSS history wrappers 385 and 386 take four words. They use
40-byte headerless records followed by 72 bytes per saved string. The
task-selected wrappers 239 and 249 also take four words. They resolve
the requested Script owner, store or replace the selected seen/path list,
and preserve the other side. Null CSS handles, absent history owners and
missing CSS entries return zero without changing either list.
The CSS file wrappers 242, 248, 252, 389 and 390 store or extract an owned
nested file, query the tag, clear contents, and clone the file.
Main 243 saves the existing caller string bank. Main 253 loads one only
after finding its CSS entry. An absent bank or entry leaves caller
ownership unchanged.
Main 255 reads the caller-relative CP932 file's local timestamp after its
four-byte CSS header matches. It writes year, month, day, hour and minute
in that order and returns one. An absent or different file returns zero
with the outputs intact.

Main 515–518 create and release a narrow dictionary, keep the first word
for each exact byte key, and return `0xffffffff` on a miss. Main 519
selects one space-separated group and preserves grouped expressions.
Main 675 and 676 use the same native allocation and release as 515 and 516.
Main 21 compares reversed narrow operands without ASCII case differences,
Main 45 replaces bytes using the live operand buffers, and Main 540 finds
the selected space-separated token's offset. Main 278 expands numbered
`$str` references using the existing caller bank. Plain copies still write
both terminators when the caller has no bank.
Main 675/676 share creation and release with Main 515/516. Main 677–679
format CP932 keys, replace a raw DWORD, remove a key or return the supplied
fallback word. Main 680 compares the raw value and copies the first matching
key in byte order with one terminating NUL. A miss leaves the destination
untouched. This family preserves the original case-sensitive ordering.

Main 434–438 clear the file-server preload queue, resolve and queue a
formatted category path, start reading, poll progress and age the records.

Main 633–640 use an owned CP932 name table from the `fes` archive.
The narrow records cap their fields at 32 bytes, keep authored row order,
and provide exact-name queries and filename matching and substitution.

Main 696 creates a configured CP932 backlog. Main 698 appends a scene
block and Main 699 rebuilds the backlog through a saved scene path using
the caller's formatted voice and paragraph commands. Main 700 writes a
row's speaker and Main 785 sets the pruning limit. Main 697 releases the
backlog owner.

Main 863–868 own fixed-length record stacks. A push grows a full stack
before translating the guest pointer. A valid pop copies the last record.
Copy includes every byte in the allocated capacity, including popped records.

Main 790 reads a start and count pair from one of eight configured variable
ranges. The first word selects local or global storage. An out-of-range
index returns zero and leaves both output words untouched.

Sound load messages carry the selected bank or group in W and the filename in
L. The grouped stream uses the low word for the group ID and the high word to
skip the loop-point lookup. Ranges are clamped to the 32 banks and exclude the
upper limit. A full range can reuse the first bank pending release. The
configuration layout and bounded voice operations are documented with the
[configuration queries](native-configuration-queries.md#26123-compact-configuration).

Main 155 resolves the formatted Sound path and uses raw 166 or 167 to load
the selected bank. Main 156–164 release, play, pause, stop, query or control that
bank. Main 168 sends the authored position words through raw 180, and Main 284
probes a formatted name in the Sound category.

The .23 FES Sound playback handler sends message 169 with the bank and loop
count for active eligible playback. An ineligible pending play sends stop
message 171. An eligible inactive object still invokes the start notification.
The Sound producer's version policy leaves the playback clock and standalone
loop updates disabled. On the base logo route an unallocated system voice
follows the stop path and returns the FES update to its caller.

The fixed-base logo motions use the engine's own Generic 17, 38, and 41.
Generic 17 takes one float32 word, adds `0.5` at float32 precision, floors the
sum, writes the integer result, and continues with control 1. The engine's
rounding handler and its data constant establish the half-step behavior.
Generic 38 clears the motion owner's active word at byte 148 of the guest shared
block and yields with control 4 and no stack result. Generic 41 reads five
float32 words in order (output minimum, output maximum, input minimum, input
maximum, and value), writes a clamped interpolation result, and continues with
control 1. The JS motion VM uses the shared implementations. Its tests cover
the finite fade range, both endpoints, signed zero, and the rounding ties.

Generic 23 postmultiplies a 64-byte matrix by X, Y, then Z rotation in radians.
Generic 26 takes one matrix address and writes identity. Both translate the
guest address and select the World current matrix on an unmapped address.
Guest address zero is valid memory. Both return control 2 without writing a
result. The archived zero-word form of Generic 23 is rejected by the VM.

Generic 42 and Particle 43 in both script tables take the value and period as
float32 words. They use the same x87 triangle wave with two CRT remainders and
ordered quarter-period comparisons. The result is a float32 word with control
1, including negative zero at the half-period boundary.

Both Particle tables rotate four vertices around X, Y, or Z in slots 22–24.
The calls take a quad address and a float32 angle in radians. Slots 25 and 26
take the address and three float32 components for translation and scale.
Rotation uses the original x87 operations on X, Y, Z and W. Translation also
adds positive zero to W. The scale writes X, Y and Z. Color and texture
coordinates retain their original bytes in every mode. Each call returns
control 2 without a result.

The close callback uses Main 469 with a CSS handle and a record ID. The engine
compacts the remaining tagged records after removing the first match. The
wrapper returns control 2 with the VM output word untouched. A null handle or
missing record takes the no-op branch.

The story's CG owner uses Main 419–425 and Main 458–459 for the registration
tree, global-file records and CGL list. The `.23` tree serializes each filename
in a 68-byte record with eight-byte selector nodes. The original CGL group
walker at `0x592b40` advances by 64 bytes per variant. The shared gallery service
preserves these widths and the registered tree when replacing its list.

The .23 STRING object creates its own kind 48 text task. Raw messages 407–419
operate on a 188-byte packet. Its 172-byte configuration starts with width
and height and includes the 32-byte CP932 face at configuration offset 124.
The packet ends with two VRAM coordinates and the output flag. The writer
projects those fields into the shared parser and preserves the native packet
for task updates and restore.

NVSTRING creates a separate kind 49 task. Raw messages 420–437 operate on
its 432-byte packet. The primary and secondary rectangles each precede a
172-byte CP932 configuration at packet offsets 28 and 216. VRAM coordinates
are at offsets 388 and 392, followed by the output flag at 396. The shared
writer keeps the parsers and their section contents separate. FES reset
refreshes text settings and retains the divided view and base colors.
The end-position query writes both coordinates when the main section exists.
Before the first section or after clearing the sections, it leaves both
destination words untouched.

The .23 layout dispatcher has 17 literal modes. Five color aliases perform no
action on STRING. The remaining modes include dimensions, colors, margins,
sizes and font. The default `font` operand selects the fixed MS Gothic face.
Reset reloads the settings font and retains dimensions and layout colors.

## Registration data

Each table has an explicit `count` and `slots` object. Its `recovered` and
`declared` lists bind only the listed IDs to catalog meanings. `reserved`,
`constant-zero` and `unknown` lists use distinct shared slot defaults. Unknown
slots have no semantic catalog entry of their own; even when another engine has
a meaning for that numeric ID, an unknown registration keeps its null name and
unrecovered signature. Unknown controls can still have independent observations.

Every ID from zero through `count - 1` must occur exactly once across these lists.
Lists contain sorted unique integers. A missing ID, overlap, invalid status,
out-of-range ID or a semantic binding absent from the catalog is an error.
Increasing a table count or adding a shared meaning never fills a registration
implicitly.

Optional grouped differences use explicit `ids` lists:

- `signatures` supplies `fields` from the structured signature. Fields replace
  the corresponding shared field; parameter arrays and result records are
  explicit replacements, not guessed type merges. Names, families and slot
  statuses cannot be changed through a signature difference.
- `observedArgumentWords`, `evidence` and `migrationReview` supply `value` records
  independently. Grouping identical values does not infer an observation from
  the declared argument count. If argument observations are present, they cover
  every slot, including explicitly empty observations.

Overlapping groups and malformed values fail validation. Recovered/declared
bindings require their engine's evidence. Review state, review reasons and
`resultWritten: null` remain distinct from observed booleans. Existing evidence
and migration decisions are preserved without turning an unsupported body into
an implementation.

For example, SDK main `0x38a` remains a noop with observed three-word calls and
an ignored argument list; the game's same slot is `emote.message524`. SDK
JavaScript slots retain their meanings while the game's corresponding slots
remain stubs. XML string output retains SDK CP932 versus game UTF-8. These are
explicit registration differences, not rules inferred from engine age.

## Language keyboard capability

A reviewed `capabilities.windowLanguageAccelerators` value is an explicit
boolean: Game 2.6.1.76 enables its proved language keyboard producer, while SDK
2.6.1.74 disables it. An unreviewed version records null plus a nonempty
`unreviewed` reason, never a false default. Missing or malformed values fail ABI
validation, and NativeWindow rejects an actual request for an unknown value;
configuration language support, dynamic menus and legacy startup layout do
not implicitly grant it. Unregistered profiles remain rejected. This covers
core language input and derived checked notifications. The standalone Game
consumer binds these through EngineHost, Core and the browser app; see
[Game language controls](native-window-commands.md#game-language-shortcuts-in-an-ordinary-world).
Resource101 base shortcuts and SDK language routing retain separate gates.
The ordinary browser keyboard checks base shortcuts on older configurations
without a language owner. An explicit language shortcut or menu lookup still
requires its reviewed ABI capability.
This consumer does not establish Retrom integration or complete platform
startup.

## SDK message-wait registration

SDK main `0x47` (`task.waitMessage`) is explicitly recovered from its own
`0x5291e0` wrapper. It converts its single VM address argument through
`0x8a6910`, registers the resulting buffer through `0x8a6b30` on the mapped
Script task's VM at task `+0x70`, and immediately returns control `4`. The
Game's corresponding wrapper and helpers were checked independently.

The ordinary World producer's `240` is the address of a 16-byte VM destination,
not a message ID. This normal mapped-VM registration uses the accepted shared
JS VM protocol: a delivered four-word message writes that destination, pushes
`1` and resumes; an idle tick pushes `0` and resumes without writing the buffer.
The SDK's own static evidence closes address conversion, registration and the
immediate control return. Its original downstream copy/push/resume loop was
not independently read for this recovery. Unproved pointer subfields and
`resultWritten: null` remain unchanged, as do every other slot and the central
unknown-admission guard.

## SDK synchronous script-message registration

SDK main `0x45` (`task.send`) is explicitly recovered for normal registered
sender and receiver tasks from its own `0x529150` wrapper and complete
`0x5d8f60` bank selector. It takes four words: target, message, wParam and lParam.
Its Script message170 uses the registered kind12 mapping to canonical172;
the Game's independently reviewed wrapper sends172 and calls `0x728ab0`.
These are separate from the drawing-message mapping.

Both wrappers clear the VM output word, send the four-word packet with flags1,
conditionally restore the caller's bank, then copy the host-return scratch word
to the VM output and return control1. Their shared `resultWritten` field is
therefore `true`; all other parameter types, word widths, review and result
fields remain unchanged. The selector's own zero/one return is discarded: it
selects the existing receiver-keyed bank entry, preserving the prior selection
on a missing entry, and does not supply the message result. In the normal World
regression, a receiver that halts returns zero while the caller's successful
bank selection returns one; the caller VM then reads its own private word11,
with the receiver's private word22 preserved.

This recovery reuses the accepted host transport and valid compiler-call
contract. It does not establish foreign or uninitialized context, unregistered
target, unwritten transport scratch, native cookie failure or invalid-memory
behavior. Other unknown slots remain centrally blocked.

## SDK deferred Script destruction registration

SDK main `0x43` (`task.destroy`) is explicitly recovered from its own
`0x528ea0` wrapper and normal registered Script interface. It takes one target
word, sends message3 with zero payload and flags, ignores message-out scratch,
and returns control2 without a universal VM result. The shared signature already
states `resultWritten=false`; it needs no override or common-data change.

The own SDK Script constructor and vtable bind the existing transport. Exact
lookup reaches a live target or follows its parent chain to a missing/null
no-op. A live Script first sends its existing VM delete notification
`[0xffffffff, 0xffff0006, 0, 0]`, then Base marks the task pending. Repeated requests
while pending do not notify again. Normal logic visits children before consuming
that flag, invokes the deleting destructor and skips the deleted Script's own
VM tick. Destruction nulls the registered ancestor routes, releases actual owned
children and lets the normal parent walk prune those routes.

The tests use real Script GCALLs, a delegated notification observer and actual
message-wait continuations. They verify request-before-frame, repeated request,
child-first destruction/owner cleanup, then the same released ID as a missing
target; all three GCALLs have control2 and no result push. Zero is not treated as
a missing task ID. Notification writes in the receiver VM are legitimate effects,
separate from a native return-value write in the independent caller.

Game registration and runtime implementations remain unchanged; the Game case
is a control for its existing module contract, not new SDK proof for other
versions. Private VM, allocator and all-resource destructor internals are outside
this admission. SDK70 (`task.post`) remains the actual built-in fallback and
shared-semantic unknown representative; SDK455/467 and unregistered versions
remain blocked.

## SDK retained-drawing family registrations

SDK main256,257,258,260,263 and657 are explicitly recovered from their own
complete wrappers, with the Game wrappers checked separately. The existing
kind15 message mapping adds5 for SDK commands; it is not an admission rule for
adjacent native IDs.

| ID  | Existing shared operation | Words | SDK / Game raw message | Control | VM output written |
| --- | ------------------------- | ----- | ---------------------- | ------- | ----------------- |
| 256 | draw.initialize           | 3     | 0x112 / 0x117          | 2       | false             |
| 257 | draw.addBitmap            | 13    | 0x113 / 0x118          | 2       | false             |
| 258 | draw.remove               | 2     | 0x114 / 0x119          | 2       | false             |
| 260 | draw.setOutputOffset      | 3     | 0x116 / 0x11b          | 2       | false             |
| 263 | draw.setEntryShown        | 3     | 0x11a / 0x11f          | 2       | false             |
| 657 | draw.entryBitmap          | 2     | 0x12e / 0x133          | 1       | true              |

The shared operation and parameter names are corrected against the accepted
receiver:256 initializes width and height,260 sets signed output x/y offsets,
263 changes the keyed entry shown flag, and657 returns its entry bitmap.
These are corrections to common metadata, with no new business behavior or
per-version implementation branch.

The first five wrappers ignore message-out scratch and leave the VM output
untouched.657 clears a separate local word, passes its address in lParam, and
copies that local to the VM output after dispatch. Both wrappers establish its
shared resultWritten=true; task.send69 remains true and other signature types,
review fields and Game admissions are unchanged.

The addBitmap wrapper uses a zeroed60-byte temporary. Nonzero bitmap input is
converted by each engine's own first-DWORD getter; zero input bypasses it.
Seven transform words retain their bits. Alpha remains an unsigned32-bit
parameter, with the wrapper clamping it to255; it is not a restricted u8 input.
The owner member-view getters differ by0x21c/0x41c, but the concrete null-output
view and60-byte fill paths both produce the same zeroed temporary. This internal
layout difference needs no additional JavaScript profile business branch.

Normal World regressions keep the original render-source aliases, frame state,
VM bytes, two-Top task routing, auxiliary bitmap ownership and fresh-World
assertions. Only these six SDK slots are admitted:259,261,264 and all other
unknown slots remain blocked. This does not establish arbitrary invalid-memory,
foreign-context, cookie-failure or general CPU/memset behavior.

## SDK drawing flag registrations

SDK main262 and main534 are explicitly recovered from their own complete
wrappers, independently of the Game. Each takes two VM words, returns control
`2` and writes no VM value. The existing SDK message registration maps raw
messages281/299 to canonical286/304; the Game independently sends286/304.
No signature override or profile-specific implementation branch is needed.

The common descriptive names are `draw.setRasterEnabled(task, enabled)` and
`draw.setDirty(task, dirty)`. Message286 sets the drawing task's pending/enabled
flags from the second word's nonzero value and marks it dirty only when nonzero;
zero does not clear an existing dirty flag. Message304 changes only the dirty
flag. Both flag parameters remain full 32-bit words, without a boolean type,
0/1 restriction or clamp. Task handle kind and ownership remain unknown.
The ordinary World tests exercise the real kind15 receiver and native-ID
transport in both profiles with zero and a nonzero high-bit word. This recovery
does not establish original rendering pixels or any other drawing slot.

## SDK FES surface and save-object bindings

SDK main449 (`fes.bindSurface`) and main451 (`fes.setSaveObject`) are explicitly
recovered from their own complete wrappers, independently of the Game. Each
reads two VM words, returns control `2` and writes no VM result. SDK raw329/331
use the existing kind34 mapping to canonical334/336; the Game's own wrappers
send334/336. Shared signatures and Game registration data remain unchanged.

The ordinary World tests call the real kind34 receiver with native task IDs:
main449 rebinds two actual Draw surfaces, and main451 stores zero or either of
two real GlobalFile handles. They verify exact forwarded words, actual receiver
bindings, control2/no value and an unchanged caller VM snapshot. Packet
observation delegates to the real transport. This is a normal JS receiver
acceptance, not execution of the original SDK.

No other slot, version, type or capability is enabled by these two registrations.

## SDK FES update and caller exit-code registrations

SDK main448 (`fes.update`) and main453 (`fes.setCurrentExitCode`) have their own
explicit wrapper evidence. Both take one VM word, return control `2` and write
no universal VM result. Shared signatures, Game data and all other SDK slots
remain unchanged. Main448 uses the existing SDK raw328 to canonical333 mapping;
the Game independently sends333. The real kind34 update runs its existing
FESCoordinator and source: the short test observes a FES bank assignment and one
player frame, while preserving the caller's stack/PC and control2/no-value reply.
Those intended FES bank effects are separate from a VM return-value write.

Main453 stores the complete argument DWORD into its actual caller context's
exit-code field. The normal JS bridge owns that value on the Script task record.
Tests use zero, a negative word and a high-bit word with the existing signed
interpretation; they verify the record and its current object snapshot, leave
a different FES task's exit code alone and preserve the caller machine snapshot.
No new width restriction, clamp, implicit target or VM result is introduced.
These two registrations do not enable any other slot.

## SDK FES exit-code query and caller context-name copy

SDK main452 (`fes.exitCode`) and main454 (`fes.contextName`) are explicitly
recovered from their own complete wrappers. Both consume one VM word. Main452
initializes a local DWORD to -1, sends message23 to the actual target and copies
that word to the universal VM result, returning control `1`. The independent
Game wrapper does the same, so the shared main452 `resultWritten` observation is
corrected in place from unknown to `true`. Its existing signed 32-bit result,
handle type and declared review stay unchanged; no version signature override
is needed. Tests query a real kind34 FES before and after its normal `exit 7`,
then query an actual Script caller after main453 sets zero, a negative word and
a high-bit DWORD. They check the original result bits and real message23 path.

Main454 translates the caller-owned destination start and copies its actual
context CString including NUL, returning control `2` without writing a universal
VM result. The native source context fields have different private offsets
(SDK +0x1c4, Game +0x2c8), which do not alter the public signature or add runtime
layout branches. The ordinary JS test supplies a valid ASCII CString through
Script message26, creates and loads a real child Script, and observes the normal
parent message25 inheritance into that child's actual scheduler context. The
copy writes only that caller's allocated guest block, preserving surrounding
canaries and the rest of its machine snapshot. The child retains its context
when its parent receives a different name. A second CP932 spelling of the same
character verifies that the preserved bytes reach the destination unchanged.

Game registration data, other slots, table lengths and the central unknown-slot
guard are unchanged. SDK455 remains unknown. These are normal JS receiver
acceptances; they do not claim execution of the original engines.

## SDK FES formatted jump

SDK main450 (`fes.jump(task, formatLabel)`) is explicitly recovered from its own
complete wrapper. It takes two VM words, formats a temporary narrow CString and
sends SDK raw330 through the existing kind34 mapping to canonical335; the Game's
own wrapper independently sends335. The public operands are the task and caller's
format source. There is no guest string-destination operand. Message335 selects
a real loaded FES block and returns whether it exists.

Both complete wrappers initialize their local result to zero and copy that
local DWORD to the universal VM result. Their normal cookie tail preserves
control `1`. The shared main450 `resultWritten` observation is therefore
corrected from unknown to `true`, without changing its existing boolean result,
unknown pointer/handle fields, declared review, Game registration or other slots.
The accepted bounded original formatter comparison covers24 selected supported
rows per engine, including full output/NUL/canaries. It corroborates that finite
formatter domain; it is not an unrestricted CRT or exception-path proof.

Ordinary World tests use real kind34/FESCoordinator receivers and a normally
loaded Script caller. They verify caller-owned ASCII format sources/canaries,
the exact temporary335 packet bytes and NUL, selected and missing labels, and a
following real Coordinator marker. A direct control1 reply leaves the caller VM
snapshot unchanged. Executing the actual Script GCALL then pushes the successful
and missing-label boolean results onto its VM stack; the direct reply alone is
not claimed as an applied VM write. Unsupported conversions still raise explicit
errors before a jump packet is sent. No malformed/oversized, arbitrary encoding,
unterminated pointer or unknown-version domain is enabled by this registration.
SDK455 and467 remain unknown representatives; central unknown admission remains
unchanged.

## Resolution and consumers

[resolveNativeTables](../src/native/abi/tables.mjs) expands only the registration
data. [resolveABI](../src/native/abi/index.mjs) validates its plain data and the
complete resolved ABI. Only the two explicitly installed engine modules enter
the deeply frozen `NATIVE_ABIS` registry. Calling the resolver does not register
an engine; `nativeABI` and `abiForEngineVersion` still reject unregistered keys.

`nativeABI(profile).tables[table].entries` is a derived view, with one entry per
slot. The entry-level parameter/result/control fields are independently copied
projections of the resolved signature, so cloned ABIs still detect a divergent
mirror. The maintained data contains a single signature declaration. There is
no parallel full table or alternate reader.

`nativeCatalog`, the World runtime, MOT, math/geometry registrations, fixture
policies, comparison tools and the migration inventory consume this same
resolved view. Dispatch controls, stubs, unsupported diagnostics, explicit MOT
argument counts and scalar comparison policies retain their existing behavior.
The central runtime rejects a resolved `status: 'unknown'` slot before preparing
bank/resource services, invoking a registered handler or entering a built-in
fallback. Registration may retain a dormant implementation shared with another
profile; it does not grant that slot permission to execute. For example,
2.6.1.67 Main 264 keeps its unknown signature and cannot reach its drawing
handler. A signature's `review: 'needs-review'` is separate from slot status:
known recovered/declared calls still follow their existing dispatch, control
validation and explicit reserved/constant-zero behavior.

Both this early rejection and an unimplemented known call report
`UnsupportedKCSNative` with the selected profile/table/ID, task, script, guest PC,
arguments and source debug data. No other profile's shared meaning or observed
argument count supplies permission for an unknown slot. Unregistered versions
remain rejected when the runtime resolves its profile.

The migration inventory separately records installed source ownership, dependencies
and remaining EXE debt. Its implementation classification, `traced` review or
descriptive render route does not grant a current-profile slot permission to run.
Every unknown entry carries `runtimeAdmission: 'blocked-unknown'`, including
installed handlers whose AST ownership and evidence remain recorded while dormant.
An unknown slot with no installed handler is recorded as centrally blocked without
executing a fallback probe. Source footprints remain visible independently of ABI
admission; neither a Game implementation nor an observed SDK call recovers an
unknown SDK signature.

Signature comparison tools accept resolved ABI JSON, not raw registration
descriptors. See [structured signatures](native-signatures.md).

Executable fingerprints and table addresses remain separately owned by each
entry in `NATIVE_EXE_PROFILES`. Sharing semantics does not make those binary
identities, memory layouts or private survey observations interchangeable.

The normal ABI validator does not require the original `motionCheckpoint`,
`memoryFile` or `systemInformation` structure descriptors. They describe original
C++ objects rather than the normal motion, resource or system services. Existing
reviewed descriptors remain unchanged. The explicit original file and system
owners require their own registered layout before accessing the process or
installing patches; another profile's layout cannot supply that permission.
Normal text and configuration data remain required. Resolving such an ABI still
does not register a version or admit any unknown native slot.

## FES common keyword membership

The separate [FES common catalogue](../src/native/abi/fes-common-heads.mjs) owns
134 native keywords once: 119 shared by the registered engines, 12 additional
Game words and three additional SDK words. Each engine's `fes.commonHeads`
explicitly registers its member names, additions, count, coverage and
`byte-exact-cstring` comparison. These keywords have their own namespace.

The shared catalogue is independent of a version's complete membership. Each
registered set contains sorted, unique catalogue names and an exact total;
119 shared words is the current two engines' fact, rather than a minimum for
another engine. The independently recovered .63/.67 tables contain 109/110
members, with neither `getsndconfex` nor `setsndconfex`. This data does not
register those ABIs or qualify any of their handlers for execution. The existing
Game/SDK binding reviews still require their matching complete modern sets;
an older set cannot inherit them by containing the same keyword.

The complete `.23` common table has 78 members in 20-byte records at `0x624328`.
The dispatcher at `0x5b1ca0` uses the table's zero handler sentinel to identify
a miss. It then evaluates the original row in its owning variable context and
returns control word zero. An undeclared object head such as `bgm stop` in the
new game transition reaches this path. The reviewed `wait` binding takes a
260-byte operand buffer and preserves frame thresholds, named object references
and the no-argument delay.

The .23 macro emitter at `0x5ad8a0` leaves the row alone when the macro
dictionary is empty. Its narrow lexer consumes valid CP932 pairs before
interpreting a single-byte backslash. It removes the escape before a double
quote in a string literal and surrounds a character literal's complete raw
span with another pair of single quotes.

`nativeFESCommonHead(profile, narrowBytes)` resolves the exact registered profile
before querying its data. A complete registration returns a tagged `present`
descriptor or `absent`. The lookup compares narrow bytes through the first NUL,
with an implicit NUL at the end of a getter-owned byte array. It preserves the
original case.

A descriptor's `nameCrossrefs` are navigation to existing audit names, including
explicitly authored alias groups. They do not prove that a native common handler
has the same semantics or implementation status. The raw catalogue remains
unbound. Each common registration must additionally provide `reviewedBindings`;
only the matching registry's reviewed evidence may qualify a shared meaning.
An explicit empty list keeps every member present but unbound. Missing lists,
unknown reviews, duplicates and reviews from the other registry are rejected.

One reviewed shared meaning is `active-reference-null`, linked to
`fes.reference.cn.resetactive`. Separate Game and SDK review records preserve
their native codes 11 and 14, declared 36-byte reference size and a NULL payload,
zero operand getters and
zero return. Both query results reuse one qualified descriptor; the other 132
keywords retain pending semantic links and unbound dispatch. SDK `execjs`,
`endjs` and `calljs` remain known members regardless of their cross-references.

The second reviewed shared meaning is `active-lock-int32`, linked to
`fes.reference.cn.lockactive`. Its independent Game/SDK reviews retain one
optional operand getter, signed int32 scalar/default zero, native record codes
22/25 and opaque return-3. The original raw Number reader and active-lock FIFO
remain the consumer; no physical-code translation or checkpoint owner is added.
Each registry explicitly admits its own review, so omitting either qualification
leaves that keyword present and unbound. Runtime review identifiers contain no
original executable address.

The normal consumer queries this data only after the raw object probe misses
and token0 has passed through its second getter. Reviewed `resetactive` queues
the existing NULL semantic record and returns zero without flushing or running
a whole-row evaluator. Reviewed lockactive passes the original operand vector
to its existing reader and preserves return-3 for the queue drain. Known unbound
members and absent members retain separate
explicit pending gates. Other early routes, whole-row grammar and
conditional/skip remain separate work; no VM slot or capability is enabled.

## Historical evidence and verification

The offline ID survey found signature extensions at main `0x181` (four to five
words, between 2.6.1.67 and .74) and `0x358` (six to seven, between .23 and .37).
A shared semantic ID does not require a globally identical signature. Explicit
signature differences can represent such changes; the survey is not an
authorization to register the remaining contracts of those older engines. Both
currently registered engines still declare five and seven words respectively.
No old parameter types or missing meanings are inferred from the modern rows.
See [offline survey limits](native-abi-survey.md).

The public short tests need no private engine, compiler or survey output:

```sh
node --test tests/native-shared-abi.test.mjs tests/native-abi.test.mjs tests/native-signatures.test.mjs
```

They cover exact registration boundaries, unknown versus known slots, stubs,
encoding/result-write differences, independent derived ownership and ordinary
World runtime dispatch. The authored four/six-word resolver example verifies the
representation only; it does not register or dynamically compare an old engine.

## SDK settings-menu request

SDK main393 is registered from its own `51B4A0` wrapper and `442080`
consumer, with the `8F2A20` field getter. The wrapper forwards the full argument
DWORD as message `0x464` lParam and returns control 2 without writing a VM
result. The consumer maps zero/nonzero to disabled/enabled for command `0x77`;
this registration reuses the shared one-word void signature already registered
by Game76.

The browser contract commits `World.menu` desired state and forwards the request
through the real `EngineHost.nativeMenuChanged` callback. The two-profile Script
GCALL test checks zero, one, a negative word and a high-bit word, continued guest
execution and no result push. This proves the World/Host request boundary, not
Win32 message-pump timing, GUI acknowledgement or successful OS menu mutation.
SDK455 remains unknown; main467 remains unknown in both profiles, and
unregistered engines remain rejected.

## Colored rectangle main79

The common main79 meaning is `plane.createColoredRectangle(target, width, height,
argb)`: a native task ID, two f32 dimensions and one ARGB word. It is not a bitmap
assignment. Both registered wrappers take four words, return control 2 and leave
the VM result unwritten. Target zero skips message delivery. The SDK wrapper's
raw plane message 40 maps to the Game wrapper's canonical message 42.

Both own plane receivers remove the previous target model before creation. Only
plane mode 1 creates the solid model and publishes its dimensions, draw type and
shape words. Modes 0 and 2 remove the old graph without a replacement, retaining
those task fields; a later mode-1 request can create a new model. The SDK slot is
explicitly recovered from its own wrapper and receiver evidence. Other unknown
slots, including SDK78 and main467, remain guarded. The packet's two unused
original scratch words carry no value claim; this contract does not establish
pixels, other backends or malformed/OOM behavior.

## Base window accelerators

`capabilities.windowBaseAccelerators` is a required boolean. SDK2.6.1.74 and
Game2.6.1.76 explicitly enable the independently recovered resource101 table;
new registrations must declare their own value. Missing/non-boolean fields and
unregistered profiles are rejected. The four rows live once in
[accelerator-rows.mjs](../src/native/accelerator-rows.mjs), outside the native-slot
catalog. This enables no VM slot or unknown version. The separate language
accelerator capability remains Game-only; SDK language rows stay disabled.

## Priority main88

Main88 `plane.setPriority(task, z)` takes a native task ID and one f32 priority
word. Both registered wrappers return control 2 without writing a VM result;
target zero skips delivery. The SDK's raw messages 59 and 47 map to the Game's
canonical 61 and 49: read the three-word base vector, replace only z, then write
the same packet back. Both sends retain their original flags value 1.

A handled Plane stops ordinary D2 propagation. An unhandled Base with loaded
Plane children visits its ordered immediate children with the shared vector
packet: the last responding child supplies x/y for the subsequent priority
write to those children. This normal hierarchy behavior is covered through real
Script GCALL, Base/Plane services, guest continuation, memory canaries and void
stack behavior in both registered profiles. SDK88 is explicitly recovered from
its own wrapper and receiver evidence; the already matching common signature
and Game registration remain unchanged. SDK78/455/467, unregistered versions
and other unknown slots remain guarded. This does not establish missing or
nonresponding-model scratch values, malformed packets, alternative backends,
inherited-position corner paths or rendered pixels.

## Visibility main92

Main92 `plane.setVisible(task, visible)` takes a native task ID and one raw
DWORD visibility flag. SDK513C80 sends its raw message45; Game6415A0 sends47.
Both map to canonical Plane47 with wParam0 and flags1, skip target zero, and
return control2 without writing a VM result. Zero pauses and hides the Plane;
a nonzero word unpauses and shows it. Registration still follows the existing
parent lookup and enable rules; input behavior is unchanged.

The ordinary D2 flags are observable through a real Base with two loaded Plane
children: an unhandled Base forwards the visibility request to its immediate
children, while a handled Plane leaves its sibling unchanged. Real Script GCALL
coverage in both registered profiles checks hide/show, a high-bit nonzero flag,
null-target continuation, unchanged caller words and canaries, and no VM result
push. The existing graphs, geometry and render order are retained. SDK92 is
explicitly recovered from its own wrapper and receiver; common signatures,
Game admission, D2 and all other receivers remain unchanged. SDK78/455/467,
Game467 and unregistered versions remain guarded. These checks do not claim
rendered pixels, malformed packets, or inherited-position corner behavior.

## Input-region binding main104

Main104 `plane.bindInputRegion(task, x, y, width, height, priority, bindingWord)`
takes seven DWORDs. Both own wrappers return control2 without writing a VM result,
construct the four-word RECT with32-bit addition, and send SDK87/Game89 with
transport flags0. Task number0 follows the real sender/Top registry; it is not
an unconditional null or Root alias. Other wrappers retain their own zero rules.

BasePlane binds the explicit RECT and priority once, retains the binding word
and actual sender, and leaves an existing registration unchanged. A rectangle
covering the configured viewport is replaced by the independently read literal
`[-100000, -100000, 100000, 100000]` in both the Input region and retained bindArea.
SimplePlane instead derives its rectangle from the loaded model's scalar-f32
position-minus-base vector and dimensions, truncates coordinates toward zero,
and uses truncated base.z as priority. It ignores the explicit rectangle and
priority. Missing or unreviewed SimplePlane geometry is rejected rather than
given fabricated zero bounds.

The existing Input, geometry and owned packet services remain the authorities.
The existing Input region.flags is opaque JS metadata only: the native Input
registration packet does not carry the retained word. It does not affect native
Input filtering or callbacks; transport flags remain0.
The SimplePlane retains the packet's logical local address0 as its binding word;
this is not a claim that a physical native C-stack address equals0. Own Base
registration, actual frame, event forwarding and close paths do not pass that
retained word to Input mask/filter or VM output. The same retained extra passed
to the two original geometry-update helpers is unused. No raw native address,
uninitialized scratch or arbitrary native memory-query equivalence is claimed.

Real Script GCALLs through ordinary World services cover both registered profiles,
Base and SimplePlane behavior, duplicate binding, fullscreen retention, legitimate
zero routing, void stack/canary behavior and cleanup. SDK104 is explicitly admitted
from SDK515770 and its own receiver chain, independently of Game648FA0. All other
slots, signatures, stubs and version gates stay unchanged; SDK78/455/467 and
Game467 remain unknown. This does not claim rendered pixels or all Plane/drag
platform behavior.

## Main105 input enabled word

Main105 is `plane.setInputEnabled(task, enabled)`, independently established by
SDK5156A0 and Game648ED0. The two-word wrappers dispatch SDK raw90/Game92 to the
same canonical92, with w0, l equal to the complete enabled DWORD and transport
flags0. They dispatch legitimate task0 as well; control2 leaves the VM output
unwritten. The existing Main97 catalog label `plane.setColor` is unchanged;
both per-version Main97 entries remain unknown. Only SDK105 is newly admitted;
other slots, signatures, table lengths and version gates stay unchanged,
including SDK108/455/467 and Game467 unknown.

The bound Base receiver and loaded SimplePlane delegate to the existing Input
owner service. Input134 preserves the raw enabled DWORD on the first matching
region and marks Input changed even if the owner is no longer registered.
Exactly zero additionally invokes Input132 to clear all active records for that
same owner; another owner's active word is retained. A nonzero enabled word
leaves active unchanged. An unbound receiver does not access Input. The service
uses the existing World owner identity and region authority, without a second
state table or Boolean conversion.

Real Script GCALLs through both registered profiles cover actual Main104 binding,
Base and loaded SimplePlane enabled words, duplicate and removed registrations,
legitimate task0 dispatch, literal messages, void stack/canaries, fresh checkpoint
isolation and owner cleanup. These are ordinary JS receiver contracts, not a claim
about native stack addresses, pixels or all Plane/Input operations.

## Main106 input active word

Main106 is `plane.setInputActive(task, active)`, independently established by
SDK515640 and Game648E70. Both wrappers dispatch legitimate task0 and send
SDK raw91/Game93 to canonical93 with w0, l equal to the full active DWORD and
transport flags0. Control2 leaves the VM output unwritten. The previous table
handle description is corrected in the shared catalog; no extra handle table or
compatibility reader is introduced. Only SDK106 is newly admitted.

A bound Base receiver delegates to the existing Input132 owner service; loaded
SimplePlane reaches that same receiver. Every matching owner record receives
the complete active DWORD. A nonzero word also clears nonmatching owners, even
when no matching registration remains. Zero leaves other owners unchanged.
An unbound receiver never calls Input. This operation does not change enabled
or the Input changed flag. Existing World owner identity, region storage,
snapshot and close authorities remain in use.

Real dual-profile Script GCALLs cover Main104 binding, Base and loaded SimplePlane,
high and zero active words, duplicates, missing versus unbound owners, literal
sender/message/control and canaries, legitimate task0 dispatch, cold fullDTO fresh
restore without replay, isolated subsequent input and ordinary owner cleanup.
The prior Main105 business control and input-switch control remain covered. All
other slots, signatures, table lengths and version gates remain unchanged;
SDK108/455/467 and Game467 stay unknown. No pixels, physical stack addresses or
unreviewed Plane behavior are claimed.

## Main848 input hover word

The actual SDK cold-start fault at main848 triggered this recovery. Own
SDK5156D0 and Game648F00 independently establish `plane.setInputHoverEnabled`
with two words, task and enabled. The second word remains32-bit bits. Both
wrappers dispatch legitimate task0 and send SDK raw96/Game98 to canonical98
with w0, l equal to the complete enabled DWORD and transport flags0. Control2
leaves VM output unwritten. Only SDK848 is newly admitted;106 was recovered
earlier from its own proof, not observed as a cold-start fault.

A bound Base receiver delegates to existing Input135; loaded SimplePlane
reaches that same receiver. The first matching region's hover word receives
the complete DWORD, and Input is marked changed even when no matching owner
remains. An unbound receiver skips Input. Neither active, enabled nor another
owner's hover word is rewritten. Own SDK4C47D0 and Game5E8440 consume region+2C
as a zero/nonzero gate for hover selection and enter7/leave8. The shared
setFilter/filter description is corrected without changing word widths or
inventing a shader filter. Native version-specific hover selection details
and all other Input/Plane services remain outside this change.

Real dual-profile Script GCALLs use actual104 binding and Base/loaded SimplePlane
owners. They cover high and zero words, first-owner duplicate behavior,
active/enabled preservation, a real removed registration marking changed from
its independently false baseline, unbound and legitimate task0 dispatch,
literal sender/flags, VMvoid/canaries, cold fullDTO restore without replay,
fresh isolation and ordinary close cleanup. The affected old input control now
expects raw0; canonical99 and its drag behavior remain unchanged. No original
CPU, native stack-address, rendered-pixel or complete platform parity is claimed.
All other slots, signatures, version gates and table lengths stay unchanged.

## Main849 input drag word

The SDK cold-start main849 fault is recovered from its own SDK515700 and
Game648F30 wrappers. `plane.setInputDragEnabled` takes a task and a complete
32-bit enabled word. Both wrappers admit task0, send SDKraw97/Game99 to
canonical99 with w0, l equal to that word and transport flags0, and return
control2 without writing VM output. Only SDK849 gains admission.

The own Base branches forward to SDK Input151/Game Input153, canonical153,
using the same owner's identity, the original word and inherited flags. The
first matching region receives the complete DWORD at field+40. Found, missing
and empty paths leave Input.changed untouched. An unbound receiver skips
Input. Loaded SimplePlane reaches this same Base receiver through its own
out-of-range fallback.

Own frame calls to SDK4C4410/Game5E8080 establish the role: field+40 is tested
for zero/nonzero, independently of the region mask at+10 whose bit2 admits
drag routing. Enabled at+28 and the registered rectangle provide separate
gates before message6 is sent to the owner. The enable word is stored without
Boolean or mask conversion. The catalog's reference-capture label and the
existing route-audit label are corrected from this producer/consumer chain.

Real dual-profile GCALLs cover Base and loaded SimplePlane, high/zero words,
first-owner duplicates, unchanged active/enabled/hover words and dirtiness,
missing/unbound receivers and legitimate task0 dispatch. A high word with
bit2 clear still admits the actual drag service when the separate region
mask has bit2; zero suppresses that owner. Literal packet IDs/flags, VM
continuation and canaries, cold fullDTO restore without call replay, fresh
isolation and ordinary close are checked. The existing Input153 authority,
canonical98 and every other slot/signature/version gate remain unchanged.
The supported normal owner domain does not certify arbitrary native pointer
layouts, all drag/frame variants or complete platform parity.

## Main100 packed color and retained override word

The SDK main100 failure is an explicit unknown-entry admission rejection
before its installed handler runs. Own SDK5139C0 and Game6412E0 wrappers
confirm the existing `plane.setColor` descriptor: three words for task, packed
ARGB and override, control2 and unwritten VM output. Task0 skips before either
remaining argument is read. Nonzero targets send SDKraw57/Game59 to canonical59
with w equal to the complete override word, l equal to ARGB and flags0. Only
SDK100 gains admission; the common signature and route label stay unchanged.

Own SimplePlane routes4BDB16/5E17F6 reach the color manager and its owned
family1 model. Source leaves55AB00/6844F0 retain the raw override DWORD at+15C
and packed color at+160. Dirtiness depends on a zero/nonzero category change
or a changed color; a different nonzero word with the same ARGB is retained
without dirtying the source. Derived leaves55A630/683AC0 retain both words
and always dirty. Native Base does not handle this color message, and an
absent model receives no stored color update.

The current native style's `colorOverride` field now stores DWORD0/1 or the
complete command word. Existing explicit false/true native stores become0/1;
renderer truthiness and public render-option APIs retain their contracts.
There is one stored authority, updated in place with the current checkpoint
contract. High words remain available after a cold restore. This does not
introduce a second field, legacy reader or protocol version.

Real dual-profile GCALLs cover raw ARGB/high override, nonzero-word changes,
source dirty categories, actual namespace routing, a distinct sibling,
loaded/unloaded and Base boundaries, target0 and skipped-argument reads. VM
continuation/canaries, cold fullDTO restoration without call replay, fresh
isolation and close cleanup are checked. The supported owned ordinary Plane
domain does not certify arbitrary native pointers or every render family or
pixel variant. All other native admissions and signatures remain unchanged.

## SDK Main108 input return word

The independently recovered SDK Main108 wrapper accepts a native task ID and a
raw 32-bit return word, sends canonical94 with w0/flags0 even for target0, and
returns control2 without writing a VM result. Its own Base receiver stores the
whole word in its existing return/changed state; normal message4/5/6 polls return
it and clear it. This is separate from Input registration, enable/active/hover
state and model dirtiness. The existing normal receiver is reused. A zero-target
send preserves normal namespace routing without inventing a Root response.

The shared catalog label is corrected from `plane.setMode` to
`plane.setInputReturn(task,value)` with the existing two-word/raw32/void signature.
Only SDK108 is newly admitted (818 recovered,90 unknown); the Game's existing
admission remains. Main109/110 and all other unknown slots/profiles retain their
guards. Real dual-ABI GCALL tests cover raw high words, unregistered Base and
loaded SimplePlane owners, poll/clear, zero transport, cold full DTO restoration
and owner isolation. This short coverage does not claim a completed official SDK
tutorial or a new long-case pass.

Main78 is independently recovered for the SDK. Its own wrapper and the Game
wrapper take a native task ID and two raw float32 dimensions, skip target zero,
and send the existing `plane.texturedRectangle` message41. The eight-word
payload is `[0,0,0,widthBits,heightBits,32,1,FFFFFFFF]`; control2 writes no VM
result. This is a textured model using the existing graphics authority, rather
than a new bitmap-handle constructor. Ordinary mode1 replaces the old model
and retains all eight words. Modes0/2 remove the old model while keeping its
rectangle, draw type and retained packet fields. Other backend modes, Base-only
primitive targets and unreviewed SDK slots are outside this finite admission.

SDK Main85 now independently admits the existing `plane.setBaseXY` signature:
raw native task ID, float32 X/Y and an unchanged DWORD geometry/texture selector.
Its own wrapper and the Game wrapper both query message61 and then send49 with
transport flags1, preserving the last initialized query Z while replacing X/Y.
Zero target returns before both sends. Control2 writes no VM result. The existing
D2 Base-to-child traversal and typed model/MOT owner remain the authority.

`NativeGraphicsPacket` has one explicit unwritten-word set; existing numeric
callers default to all-known data. Main85 starts its three query words unwritten.
A Plane without a graph leaves the query untouched, so a late unloaded child
preserves the value from an earlier loaded responder. Both sends also complete
when the nonzero target is missing or no recipient has a graph. The unwritten
Z survives the setter packet. An unloaded Plane skips the graph assignment and
continues its normal inheritance, input area and child updates. A loaded
graph's assignment still requires a known Z. `load` can report `undefined`.
Raw data, view and byte reads reject unknown bytes, and known slices isolate
their backing storage. Constructors, stores and float consumers require known
values where they read or write a word.

SDK Main84 independently recovers `plane.setPosition(task,x,y,z,coordinateMode)`.
The SDK and Game wrappers both skip target zero before reading the remaining
words, send canonical51 with the unchanged DWORD selector and three raw float32
coordinates, and explicitly set transport flags1. Control2 does not write a VM
result. Only SDK84 is newly admitted (822 recovered,86 unknown). The shared name,
signature, Game registration, existing zero-target gate and position/MOT receiver
remain unchanged. Real Base-to-child routing updates the existing loaded ordinary
models; the selected primary/texture positions and both task identity domains
remain distinct. Cold full DTO restoration does not replay commands or RNG.
This finite leaf adds no other SDK slot, backend, inherited-position corner,
native dirty-layout or official tutorial acceptance claim.

SDK Main101 independently recovers the existing `plane.setScale` declaration
(823 recovered,85 unknown). Both native wrappers take the target, three raw
float32 components and an unchanged DWORD selector, skip target0, and send
canonical66 with flags0. They explicitly initialize a fourth packet word to
float32 one; the normal producer retains those four known words. The receiver
forces geometry selector0 for itself and inherited scale notifications, so an
incoming nonzero selector does not choose a texture scale. Existing model/MOT
owners and receiver66/67 behavior are unchanged. Control2 writes no VM result;
the native transport out aliases the argv parameter slot instead.

The fourth-word correction preserves the native packet-byte contract. It does
not assert a previous geometry/pixel defect, a dirty-layout equivalence or a
completed official tutorial. All other SDK slots, Game declarations, shared
signatures, flags, zero-target gates and unknown-version guards remain intact.

SDK Main93 and341 are independently registered from their complete own
wrappers, bringing this SDK to826 recovered and82 unknown slots. Main93 uses
five words: native target, three raw float32 angles and an unchanged DWORD
selector. Target0 skips before the other operands. Its canonical55 send uses
flags1 so the actual Top route can visit loaded children even when the target
Base has no model. The existing selected model and rotation/MOT receivers own
the update; the wrapper authors three vector words, without introducing a
fourth script argument or a physical stack-cookie byte contract. Control2
writes no VM result.

Main341 is `draw.clear`. It sends canonical291 even for target0, with w/l/flags0,
and returns control2 without a VM result. Its initialized local transport output
is separate from the guest result. The existing Draw receiver removes retained
entries and clears its bitmap, then reinserts its base image when enabled. A
Draw without a renderer leaves its state alone. This shared name corrects the
previous `draw.pop` catalog label; the route validator already uses `draw.clear`.
It does not change the existing Game clear behavior or receiver lifecycle.

True dual ABI GCALL checks cover raw selectors, real child models and bitmap
pixels, missing/zero routes, VM stack canaries and complete settled checkpoint
restoration before any warm tick. Restored commands and RNG are not replayed,
and owners remain isolated through close. AuthorMode-dependent279/281 and the
unproved688 receiver remain unknown; no conditional CFG census item enables a
slot or another engine version.

The normal task router requires the registered ABI's Root protocol: the first
message number, caption encoding and Sound reset message. These fields are
validated before constructing a World. Its logical Root state uses no original
function address or C++ field offset. The existing Root `field` offset and the
two original message-layout descriptors remain owned by the explicit original
task bridge and its physical verifiers. An original task dump rejects a missing
physical descriptor before accessing the process, installing traps or allocating
memory. This separation adds no engine version or native-slot admission.

Normal configuration requires its four word-aligned block sizes and the actual
font/key byte layout: character width, encoding, field widths, record stride and
complete backing size. ABI validation checks the canonical owner's geometry.
`text.configurationLayout.ownerOffset` and `configuration.memory` describe the
original Engine allocation and are not prerequisites for that normal owner.
The explicit `NativeConfigurationMemory` adapter validates its own offsets,
block mappings, scalar widths and read extent before touching process memory;
an absent or partial physical descriptor fails there. These missing fields are
not defaulted, and this separation registers no additional engine version.

## Finite ordinary construction in 2.6.1.63 and 2.6.1.67

Each older registration has its own narrow configuration dimensions, defaults,
Root protocol, sound categories, complete FES common-head membership, startup
verification policy and texture-cap policy. Their first ordinary service sequence
is startup sound, textures, raw title and Root/Script. It does not infer global
translation, M2 or unrelated native capabilities from a modern engine. Source
version metadata selects a reviewed registration; it does not execute an EXE.

Main359 copies all four actual configuration blocks, including a valid VM address
zero, and has control2 with no VM result. Main465 returns the existing author word
with control1. Main605 formats one CString and returns the existing flat sound
gain, including the already-derived master/group percentage and mute words. Both
older versions register these operations. The reviewed startup entries below
expand each version's registration. In particular,
0x181 retains four words rather than the modern five, and 0x358 retains seven
words while remaining unknown. Table length, nearby IDs and stub observations
never grant a semantic binding.

The filename policy keeps the actual .63 wide pair predicate and .67 standard
pair predicate. Directory extraction preserves pairs, while basename and extension
scans inspect raw separator bytes. C-locale directory comparison folds individual
ASCII bytes; filename lowering preserves the selected pairs, and stored prefix
heads are compared without another lowercase pass. The existing native XML byte
owner supplies narrow VOICE fields without CP932 alias re-encoding. Archive
lowering uses the same per-version pair data. The admitted filename domain is a
live NUL CString of at most 255 bytes, the proved C-locale branch and the captured
extension-removal call; larger scratch, other locales and optional suffix behavior
remain unsupported. Master mute precedes getter classification but cannot bypass
the wrapper's scratch boundary.

Both old FES common tables omit getsndconfex/setsndconfex. Their configuration
pair may be constructed, but requesting either absent command fails. Raw rows
without quotes do not consume an unknown quote policy. An empty macro dictionary
does not consume unknown macro-literal policy. The proved calling Script bank
supplies `$str`; global translation requests, nonempty unknown macro policy and
unproved control-task policy still fail at their actual consumers. FES membership
is separate from handler admission; this first path does not claim old OBJECT,
text, motion or full game execution.

Texture initialization requires its own known cap policy before querying a GPU
or changing layout/configuration. Internal upload/clear dirtiness is independent
of whether the native bounds-query API is admitted. Cold restore applies that
same policy before replacing image assets or live pages. Ordinary sampler defaults
consult M2 requirements only when that service is selected. SDK74/Game76 keep their
existing M2 sampler behavior.

The normal validator requires real construction fields. Explicit unknown fields
have null values and documented reasons; `nativeABIBehavior` rejects their actual
use. Physical layouts, table addresses and original engine support remain separate.
Original query/menu enumeration includes only its own descriptors and rejects a
missing descriptor before process access or allocation. The SDK74/Game76 physical
oracle corpus is unchanged. Positive test corpora select their own admitted slots
or captured receiver maps; registering an ABI does not make every test operation
available.

Shared implementation installers may encounter a known catalog operation beyond
a reviewed engine's table length. `NativeRuntime.register` returns false for that
absent slot and installs nothing, or true for a present slot. Bad table/ID/handler
and duplicate present bindings still fail. Unknown and stub entries are not absent;
their existing dispatch/status gates remain authoritative.

The .63 startup code default is independently empty. The .67 constructor's own
default independently matches the public `open_cs2` CString and is recorded in
its verification data. Missing APP/v_code uses that reviewed default; explicit
APP bytes still override it. Owned startup/cold controls cover both paths. This finite ordinary coverage
and cold ownership do not establish either commercial sample's full campaign or
complete the remaining multi-version corpus.

## 2.6.1.63 startup and Script wait

The .63 entry registers Main 5/8/13/68/71/209/211/393/789 from its own wrappers
and receivers. Main393 reads the guest word in full, forwards message
`0x464` to the application window and returns control 2. The owner uses its
zero/nonzero value to update command `0x77`. Main8 writes the virtual
dimensions through two translated VM pointers. Main13 copies narrow bytes,
writes two terminating zero bytes and returns the destination address.
Guest byte zero is a valid destination.
Main15 appends the second narrow string to the first, writes two terminators
and returns the original destination address with control 1.

The first episode's `sscript` calls Main5 with no arguments after Main8.
The .63 wrapper writes one unsigned word and returns control 1. Its task clock
receiver subtracts the paused-frame count from the effective frame, matching the
existing shared `task.clock` implementation.

Main790 returns one configured start/count pair through two guest pointers.
A zero class selects local ranges and a nonzero class selects global ranges.
Indices 0 through 7 return one, and an out-of-range unsigned index returns
zero with both outputs unchanged. Main739 writes the virtual coordinates
calculated from twice each device offset and returns control 2.

Main789 returns the variable capacity set by `GAME/flag/max`. Main209
creates the owner's zeroed bank. Main211 writes an in-range word and marks
the existing bank dirty even for an out-of-range index. Both calls return
control 2. Main68 returns the Script's native identity. Main71 stores the
translated packet pointer and suspends the Script with control 4. The
owned startup test covers these operations through guest GCALLs, then
delivers one packet to resume the waiting Script.

## 2.6.1.63 FES task entry

Main66 creates and attaches the selected task, including a kind 34 FES
child of the calling Script. Its reply contains the task's native identity.
The .63 Main447 sends raw 319 to initialize the interpreter with the
Script's variable bank and raw 320 to load the formatted source. Main448
updates that interpreter through raw 321. Main449 binds its draw target
through raw 322. The ordinary wrappers use the corresponding typed receiver
operations and return control 2. Main67 requests destruction with message 3.

The owned path loads a small FES script into a real draw owner, updates the
borrowed Script bank and removes the FES task and drawing binding on
destruction. The Script keeps ownership of its bank.

## 2.6.1.63 startup files and flag bank

Main247 loads the selected CSS file in the caller's save directory. Its
global-file owner grows in 512 KiB increments and Main246 releases that
owner. Main250 looks up a tagged entry, resolves the destination Script
in the caller's native namespace and imports complete words from the
specified first index up to the bank's capacity. An absent file, entry or
bank returns zero. Main254 copies the available prefix to a translated
VM destination and returns its byte count. The owned control covers the
two startup selectors in the Script's flag bank, file and tag misses,
bounded imports, raw copying and handle release.

## 2.6.1.63 startup resource and string calls

Main 1, 14, 36 and 41 use the debug text formatter, the formatted copy with
two terminating bytes, the byte fill and the delimiter-list writer. Main
29, 30 and 32 own a file handle across open, bounded byte reads and close.
The read returns its byte count and returns zero for EOF or a NULL handle.
Main 210 returns an in-range Script variable or zero, and Main 276 writes
the Script's narrow string bank. Main 590–593 open and release an XML owner
and query integer and narrow text nodes. Missing integer paths keep the
supplied default. Missing text paths leave the VM buffer intact.

Main 43 splits the live narrow string into a NUL-delimited list, preserving
literal balanced parentheses and separating a preceding ASCII word. Main 44
clears its destination before joining the inclusive range of list entries.
Each selected entry contributes a trailing space. Both return control 2.

Main 4 returns the platform millisecond clock as a DWORD. Main 17 counts raw
bytes to the first NUL. Main 318 clamps linear interpolation to its input
interval and preserves the engine's x87 rounding and unordered comparisons.
Main 439 is the original control-2 stub.

Main594 opens an owned CP932 name and RGB table from a formatted filename.
The .63 Script uses this interface for background tone groups. Main596
looks up a group and Main597 resolves an alias through its group. A match
writes three color words and returns one. A miss returns zero and preserves
the outputs. Main595 releases the table and returns control 2.

Main542 allocates missing configured texture pages, starting with the
16-bit rows. Already allocated pages keep their pixels and depth. Main
543, 546, 550 and 652 share the .63 control-2 stub and leave the result
unwritten.

Main683 loads an owned CP932 section table. Main685 selects the zero-based
match within a section and key, preserving authored row order. It copies
the NUL-terminated value on a hit and leaves the destination intact on
a miss. Main684 releases that owner. Main25 parses the resulting signed
integer prefix with decimal and hexadecimal rules.

## 2.6.1.63 CST reader and history

Main323 creates an independent CatScene reader and history. Main325 loads
the CP932 CST and Main326/327 read the block count, line type and raw text.
Reading types `0xf0` and `0xf1` sets the filename and value returned by
Main338. Main329 appends to the path and returns one on a valid request.
Main328/332 mark and query the greatest seen value, independently of the
ordered path. Main330/331 clear the respective lists. Main324 releases the
reader and its history together.
Main336 snapshots the numbered string references using the caller's existing
string bank. A caller with no bank leaves the history record untouched.
Main934 aliases a seen value to a new formatted name and preserves an
existing destination.

The .63 MOT wrappers transfer the entire 144-byte base or working object
through separate vectors, matrix and scalar fields. Main303 copies the
working object to the base. Main304 formats the script name and resolves it
through the mounted MOT category, then copies up to 256 register words and
any mapped auxiliary data into the instance.
Main315–317 create, refresh and release the MOT snapshot. Each record has
a 1,076-byte fixed part with a 32-byte CP932 name and appended auxiliary
data. A one-word Main315 call still reads the frame from the adjacent VM
stack word, as the original wrapper does.
Main311 queries the live MOT list. Main440 rebuilds the working state from
the base and runs each motion with the final-frame flag.
Main314 sets the skip word of every MOT record in that manager.

Main863–868 own fixed-record stacks used by the script. Their push grows
capacity before reading the VM record. Pop copies the last record out,
and copying a stack preserves its full capacity, including popped bytes.

Main515–518 own the command dictionary. Keys are raw CP932 bytes. Inserting
the same key preserves its first value, and lookup returns `0xffffffff`
for a missing key or dictionary.

Main519 keeps parenthesized arguments byte-for-byte, and Main540 locates
space-delimited argument offsets. Main42 copies a list item forward and
tests its source after the copy. Main38 copies from the live source up to
its delimiter or capacity and writes two terminators. Main212/213 set expression context and
evaluate it, and Main278 expands the Script string bank. Main46 rounds the
scaled percentage to float32 after division, and Main319 writes the low
word after the float32 rounded result is converted to a signed 64-bit integer.
Main539 evaluates a single argument, bracketed list or bracketed range using
the caller's variable bank and writes up to the requested number of DWORDs.
Main45 clears its destination before searching the live byte buffers. The
final suffix follows the forward DWORD and byte copies used by the three
engine versions.
Main19 compares the second raw string to the first using signed bytes.
Main21 uses unsigned bytes and ASCII case folding in the same operand order.
Main35 copies the requested number of bytes between mapped VM ranges.

Main633–638 load, query and release the name table from the configured FES
category. Rows follow source order and use three 32-byte CP932 fields.
An overlong name skips the row, and optional fields are limited to 31 bytes
before their terminator. Main639 matches the filename prefix by the row's
stem and extension wildcards. Main640 applies its live-buffer replacement
template. Main49 reports byte offsets at the engine's wide CP932 character
boundaries.

Main390 clones a global-file owner, retaining its tag and capacity and
copying its records independently of the source.
Main389 clears the entries and returns the owner to its 512 KiB initial
capacity while preserving the tag.
Main248 reads that tag. Main385 and Main386 write and restore the seen or
path list through an entry. The .63 format uses 40-byte records without a
header, followed by 72-byte numbered-string records. An empty list has an
empty entry, and a missing entry preserves the existing history.

Main143 loads a Script through raw message 154 and binds the caller's
shared memory through raw 165. Main69 sends four words immediately through
raw 166 and reselects the caller's expression context after delivery.
Main70 appends the four words to the receiving Script's deferred queue
through raw 167. Main454 copies the caller's original CP932 context name
through its terminator and returns control 2.
Script message 4 forwards the render notification through the waiting VM.
Messages 30 and 31 use the Top receiver. The Script receiver delegates them
to Base.

Main571 and Main572 send raw 426 and 425 through the same task routing.
Main571 reads an optional DWORD pointer for the payload and Main572
sends zero. Both return control 2.

Main882 sets a named FES word through raw 340, and Main883 reads it through
raw 339. The dictionary uses the original formatted CP932 bytes as the key.
The same bytes select the value after a fresh checkpoint restore.

Main392 writes the formatted base text bytes to a VM destination and
returns their byte count. The .63 writer and extractor use the same wide
CP932 pair test as the original string character counter.

Main365 owns the full packed resource from the image category. Main368
initializes the 36-byte metadata output for a live image owner and mapped
destination before inspecting the frame. Main366 releases the buffer owner.
Main112 allocates a Script bitmap, including a valid zero-sized bitmap,
and Main114 releases it. Main364 decodes an owned packed frame into an
independent bitmap with four-byte pixels. Main362 reads the recorded canvas
size with the bitmap dimensions as fallback. Main367 starts at the clipped
destination and uses the clipped source extent until the destination edge.

Main308 sets the motion manager's float32 speed. Main785 sets the display
log's unsigned block limit and immediately prunes its oldest blocks.

Main403 and Main404 use the Root Input owner to set one key gate through
raw 146 or to reset all gates through raw 147.
Main285 queries the same Input owner through raw 140 and returns the OR of
its four source words for the selected logical key.

Main155–164 use the same .63 Sound owner as FES. Main155 sends the
280-byte load packet to raw 173 or 174, followed by raw 175–183 for
playback and bank controls.

Main696 creates the CP932 backlog with the current log configuration.
Main698 appends an authored block and Main700 writes the speaker for a
visible row. Main876 clears the lists and Main697 releases the owner.

Main455 sends raw Draw message 284 with the optional bitmap and no crop.
The receiver copies a live bitmap into its owned base image. Zero hides
the base plane and removes its drawing entry while keeping that bitmap.
Main258 removes the sender's selected entry through Draw message 269.

Main598 extracts the image base name from the first nonempty comma field.
Main710 loads the selected image collection for the Script, and Main711
releases it and its sources. Main714 queries its composed canvas size.
Main726 blurs and Main730 resizes the loaded layers. Main733 creates an
independent four-byte canvas and Main736 fills the specified region.

## 2.6.1.63 CG registration

Main419 creates an independent registration tree and an empty list. Main420
releases both, and Main421 clears only the registrations. Main422 and Main423
share the formatted base and variant name. Selectors use signed CP932 first
bytes. The .63 register wrapper also records the alternate name with `L`
before an underscore removed.

Main424 and Main425 save and load the tree in a global-file entry. A filename
record occupies 68 bytes and a selector node occupies eight bytes. A missing
entry leaves the current tree in place. Main458 loads a list into that owner.
The .63 list has 64-byte variant fields and a failed lookup leaves the existing
list in place. Main459 registers the selected section and group through the
same tree. The owned Script test exercises these calls in order and resumes
from a fresh checkpoint before releasing the gallery.

## 2.6.1.63 FES sound playback and release

The selected FES Sound producer and Sound task receiver use raw messages
173, 175, 176, 178–180, 183, 194, 199, 203, 204, 210 and 211. Their
typed operations cover load, allocation, playback, bank queries, volume, pan,
tags and release. Root's separate reset uses raw 188. The FES load packet
contains 280 bytes and supports the filename argument. The receiver's 32 banks
and its consumed load fields through byte 279 establish the packet boundary.
Allocated loads return the selected bank index. A WAV decoder query returns
the PCM frame count. Elapsed-frame queries and other unreviewed messages still
fail at their own protocol boundaries.

An owned FES program loads an authored WAV into a fixed bank and through the
legacy group allocator, plays both banks, and uses the same FES and Sound
owners during the destruction request and cleanup.

Main 284 formats the filename, resolves the Sound resource category and
returns whether the resource can be opened. It releases a successful open
without loading any Sound bank.

Main 168 sends three float words to the selected Sound bank. The device
applies the position when 3D sound is configured and that bank has a buffer.
Main 347 and 348 write the loaded bank's velocity and Doppler factor.
Main 604, 935 and 936 retain the 280-byte Sound load packet. The group scan
excludes its end and falls back to the first pending release. The option
forms pass the unsigned caller ticks converted to milliseconds.
Main 606, 607 and 844 return the configured enable word, master gain and
index. The lookup checks the archive directory before the lowercased full
CP932 filename prefix.
Main 674 searches the 64 configured archive category slots. The Sound query
uses that same voice row's archive name.
Main 903 reads a formatted tag from the selected bank. Selector −1 uses the
first matching bank in order.

Main 400 resolves the formatted table and each filename through the sound
resources. Its Sound receiver requires ordered signed 64-bit endpoints.
The default end of −1 is valid when the start is less than −1. Duplicate
filenames replace the start and keep the first accepted end. Missing tables
and rejected records leave no result word on the VM stack.

## 2.6.1.63 Draw and FES waits

Main 79, 88, 92, 104, 105, 848 and 849 set up the starting SimplePlane
and its Input registration. The plane derives its rectangle and priority
from the loaded graph. Its retained binding word uses the logical packet
address 0. Enable, hover and drag requests each carry their literal DWORD.
Destruction releases the Input registration with the plane.

Main 653 sets the Plane's VRAM type through raw message 81. Main 654 sends
two formatted narrow strings through raw 82. SimplePlane defines raw 82 as
an empty notification.

Main 256, 260 and 262 initialize the Draw renderer, set its offsets and write
its enabled word. A rising edge sets the pending word. Main 339 sends
the caller's clip rectangle to its layer and Main 534 sets the Draw dirty
word. Main 717 and 724 query the bitmap's base point or its five-word
attribute by a sixteen-bit ID. Main 341 sends raw
message 279 to clear its retained entries and bitmap and reinsert the visible
base. Main342 sends raw
message 280 to the selected Draw owner. The receiver marks that surface dirty
and forces its full output, then clears the pending word after the render.
The wrapper returns control 2. The own FES common
`wait` callback uses the numeric, no-argument and object-reference forms and
the `frame` and `tag` selectors. The tag uses record 32 and a 32-byte field.
The owned control reaches timed, frame-relative and no-argument suspensions
with the attached Script bank and Draw owner active.

The first Flow idle turn passes the rectangle to Main 117. A zero bitmap
handle clears the matching VRAM rectangle. A live bitmap receives the color
and a vertically mapped rectangle. Main 100 then applies the requested color
and override word to the startup Plane through its own raw message 56. These
operations return control 2. Main 452 delivers Base message 23, returning the
FES task's signed exit word or the initialized -1 when no receiver writes it.
Main 453 sets the exit word of the current task. Main 94 clamps signed alpha
to 0–255 and sends raw Plane 60 with dispatch flag 1 to the selected target.
Main 568 prepares one screen capture and draws the supplied priority range
into slot zero after successful preparation. Main 858 and 859 expose the
separate count and slot operations.
Main 520 queries the selected transition's activity. Main 527/528 configure
and start a retained fade. Main 530/531 configure and start a bitmap wipe.
The initialization packets carry the priority range and duration in the
original order. The wipe retains its mask through the transition.

Main 625 changes the animation enable word of the selected Draw entry.
Main 257/259 and 731/732 bind a bitmap or logical image owner to the
selected Draw entry with its authored transform, opacity and visibility.
Main 713 scales RGB by three authored percentages. Main 723 and 727
rotate or reflect the collection and rebuild its bitmap. Main 728 sets the
bitmap's mask word. Main 737 applies the authored color filter to each
collection layer and frame. Direct canvases keep their pixels.

Main 111 loads a formatted list of bitmaps and composes its overlays using
physical bitmap offsets. A colon supplies the original numeric frame prefix.
Main 115 copies from the source rectangle, and Main 118 creates a bitmap
copy owned by the caller.
Main 712 reads the composed image size, and Main 715 reads its signed offset.
Main 218 clips the caller's rectangle in place and writes a zero rectangle
when the intersection is empty.

Main 565 and 566 read the active view's recording word and counter. Main 567
writes a formatted CP932 line and CRLF at the last existing byte of the
literal filename.

Main 78 sends an eight-word textured rectangle packet to the live Plane.
Main 466 writes the coordinate mode into the current D3D render model.
Creating a replacement model starts with coordinate mode zero. Both
wrappers skip a zero target and return control 2.

Main 84, 85, 93, 101, 344 and 402 update Plane position, base X/Y,
rotation, scale, matrix and blend mode. The base X/Y update retrieves
the current priority before replacing X and Y. The matrix uses the
selected vertex or texture transform, and the scale receiver uses the
vertex transform. Blend values 1–5 reach the renderer and other values
select mode zero.

Main 343 and 345 write the live Plane's cached width and height or its
four local bounds coordinates into VM memory. These bounds come from the
local shape before the Plane's position, scale and matrix are applied.
Target zero preserves the output addresses. Both wrappers return control 2.

Main 630 delivers raw FES message 325 with the formatted event and an
optional 32-byte object name followed by its index. The receiver runs the
event, synchronizes changed resources and forces the bound Draw surface when
requested. Main 645 and 646 select the interpreter's private 512-word bank
through raw messages 328 and 329. Out-of-range writes are ignored and
out-of-range reads return zero. The notification and write return control 2.
The read returns control 1 with the bank word.

Main 741 takes no arguments and returns the Settings `mw_pos` word in
fullscreen or zero in windowed mode, with control 1.

Main 16 appends formatted CP932 data, writes two NUL bytes and returns
the original VM destination. Main 47 counts characters using the original
wide byte-pair rule. Its lead range is 0x81–0xFE and its trail range
is 0x40–0xFE. Both return control 1.

Main 294 creates an owned motion manager at speed 1 with empty motion state
and an identity base transform. Main 295 releases a nonzero manager handle
and returns control 2. Main 207 initializes the 16-word identity matrix
through a single VM address, using the current global matrix on native NULL.
Main 586 stores a full DWORD of default flags on the live manager. Motion
creation reads that DWORD. A zero manager leaves state untouched.

Main 535 adds a motion through the same formatted CP932 resource lookup as
Main 304 and passes its eighth word as the authored delay. Main 320 prepares
five-float spline points in place. Counts below three leave the buffer
unread. Main 62/63 convert degrees and radians using the original
single-precision x87 arithmetic with its extended exponent before storing
the final float word.

Main 307 updates the ordered MOT records from the base state using the
caller's frame and shifted start time. Its third word defers the start of
records with no previous tick. Main 310 reports group activity and Main 313
sets skip on that group. A pending delay still applies to a skipped record.
Main 673 and 686 share the original control-2 stub with no memory effects.

The optional-animation branch at the start of the Script calls Main 925.
The original table binds it to a zero result with control 1. Adjacent
Main 908 and 926 discard their input and return control 2 at the original
shared reserved entry.

Main 434–438 clear the file-server preload queue, queue a formatted
category resource, start the queue, check a signed progress threshold
and age its entries. A duplicate queue entry refreshes its lifetime.
Main 437 returns the threshold result with control 1. The other four
operations return control 2.

## 2.6.1.63 FES STRING

The narrow STRING object is original FES type 20 and canonical type 21. Its
owned task is kind 48. The receiver uses raw messages 430–447 for operations
0–17. Initialization and configuration updates pass 200 bytes, including
184 configuration bytes, two VRAM coordinates and the output flag. The
CP932 face occupies 32 bytes. The FreeType backend uses version 2.4.8 and
converts the original narrow character codes for glyph lookup.

The FES layout handler selects 24 literal modes. An unknown mode such as
`vdraw` leaves STRING state unchanged. Reset takes the settings font and
preserves the current dimensions, scroll type, wipe width and layout colors.
The reset and the packet output flag follow the original STRING object
independently of the font settings flags. NVSTRING admission remains separate.

The same `draw` dispatcher returns immediately for a BUTTON selection.
Only its explicit Plane and text-family cases process the optional value.

Main 937 takes no arguments. It resolves the caller's Top Input task through
raw message 32 and clears the pending wheel directions through raw 153.
It returns control 2.

## 2.6.1.63 close and persistence

Main9 returns control 2 and posts a window message. A nonzero argument asks
for window confirmation using the fixed prompt and configured title. Zero
selects raw 0x433 and skips that prompt.
Both accepted routes hide the view and post the 0x410 Script shutdown.

The window-close message selects the Script's persistence callback. Main
238, 240, 244, 245 and 469 handle CSS creation, variable export, raw VM
bytes, save and tagged-entry removal. Main 833–836 own reference-prefixed
host buffers, including a tagged-entry copy with a separate VM byte-count
output. A missing entry leaves the byte-count word intact. Main 277 returns
1 for an existing empty string and 0 for a missing entry. Main 870 releases
the database, and Main 872 returns or copies a record count followed by
268-byte rows. A NULL database leaves its export result unwritten.

Main 869 resolves the database resource and creates the database owner. Main
873 applies flags from its CSS host buffer to matching database records.
Import preserves the raw DWORDs and the database's dirty state. A NULL
input buffer returns zero. A NULL database leaves the import result unwritten.

An owned Script waits for the close message, persists its banks and releases
its typed handles. A fresh World restores the complete saved fixture before
running its own close and produces the same bytes.

## 2.6.1.63 caller task addresses

Main 74 sends raw 13 through the caller's Top. A live recipient supplies its flags, and a route miss returns `0xffffffff`. Top and a destroy-requested recipient can leave the caller word in the result. For a live Script caller, that word is a stable borrowed native address. The reference remains valid until the caller is released, including when the caller's interpreter is replaced. Reusing a task ID gives the replacement a different address.

Main 835 can copy any byte span within the caller's eight-byte header. The first word identifies the reviewed Script class through an opaque value. The next word is the caller's native task ID. CSS stores its own byte copy, and Main 836 returns separately owned data. The checkpoint codec preserves the borrowed address and validates its live Script owner. Main 834 requires an owned raw allocation. Wider header reads, writes to the borrowed address and other raw-pointer consumers raise an explicit error.

## 2.6.1.63 story motion

The story MOT resources use the generic scalar table for sine, cosine,
arccosine, atan2, absolute values, conversion to radians and a signed
quarter-period triangle wave. MOT matrix calls use the native row-vector
orientation. The normal SSE products use paired sums on the first and
fourth rows and sequential sums on the middle rows.

## 2.6.1.63 NV text

FES NVSTRING creates the original paired CP932 text plane. Its raw messages
448–465 carry a 456-byte packet with two 184-byte parser configurations and
separate rectangles. The writer owns both sections. FES reset keeps the
divided view while refreshing the parser defaults.

## 2.6.1.63 movie window

Main265 formats the CP932 movie resource and opens an owned decoder. The
wrapper queries the Root Input task with message 32, sends that task raw
139 and takes the renderer and cursor gates. The raw 139 receiver has no
side effects. Close and failed open release the gates. Main266 through 270
use the shared playback, repeat, close, status and redraw logic. Main417
always scales the requested volume by the effective BGM level and honors
master and BGM mute. Main787 writes the drawing rectangle as left, top,
width and height. Main788 sets the movie destination with those same units.

## 2.6.1.63 title Particle

The title emitter uses the v2 particle table. Own slots 1, 2, 6, 19, 34 and
36 write scalar results. Slots 5, 25–28, 30, 31, 35 and 50 use control 2
for dimensions, vertex and position operations, registers and blend state.
The FES init, param and start commands use the owned kind 16 receiver.

The normal particle host checks the active engine table on load and cold
restore. The authored FES control reaches all fifteen selected calls, rejects
an unknown v2 slot before mutation and restores the complete raw World state.

Main426 and Main427 carry signed alpha and the graph attachment word to
the owned Particle receiver with raw messages 308 and 309. Alpha words
below 255 keep their signed value and larger words select 256. A zero
attachment clears the reference. Both wrappers return control 2.
The raw attachment word survives an absent graph. Particle coordinate
queries use zeroed outputs when a graph lookup fails and use the live
coordinates when the graph becomes available.

Main271 and Main693 deliver raw 302 with the program family, two CP932 name
fields, the count and priority, 32 registers and a cleared draw word.
Main272 and Main273 start and stop the bank. Main274 initializes its result to
zero and reads the active word through raw 306. Main275 passes the register
buffer to the live Particle task through raw 307.

Particle v2 slots 7 and 16 return cosine and floating-point remainder.
Slots 22–24 rotate the four owned vertices in place and keep their other
fields. Slot 38 writes the four projected bounds at the requested depth
using the bank priority and view. All four pointer-writing calls return
control 2.

The selected warning and title motion programs use Generic 17, 38 and 41.
The round and clamped interpolation calls each write a result. Generic 38
clears the motion's active word with control 4 and leaves the VM stack intact.

## 2.6.1.67 first-title entry and normal services

The .67 startup -> flow -> title slice separately registers Main
1/8/13/14/36/41/66/67/68/71/79/88/92/100/104/105/117/209/211/247/256/260/262/276/
359/393/400/447/448/449/452/465/590/591/592/593/789/848/849. Main605 keeps its
previous finite binding. Each new entry has its own captured wrapper, argument
count, control word and selected receiver proof. A shared semantic ID alone does
not admit a version. Main393's zero action is a real void call, Main13/14 may
return guest address zero, and the normal task/receiver IDs keep their existing
separate domains. The .63 table and the modern tables are unchanged.

The selected FES factory/parameter/frame chain covers CIMAGE/IMAGE/CPLANE/PLANE/
BUTTON/WIPE/SOUND (types1/2/3/4/6/8/9). Its own FES raw messages320..323 are
0x140..0x143; the normal typed service uses logical331..334. This is semantic
normalization at the existing service, not a physical message-number identity
claim. Generic17/38/41/42 use the existing MotionInstance and numerical authority;
38 consumes no argument and returns control4 without a VM result. No other curve
or generic slot is enabled.

Only `wait` is newly bound from .67's own complete110-name common table. The
captured callback has numeric/noarg/object waits and the own `frame`/`tag`
selectors, with record32 and a32-byte tag. This does not bind other common heads.
Its Sound service maps only own raw174/176/177/179/180/181/184/195/200/204/205/211/212
to canonical IDs five higher. Unmapped messages remain errors. The280-byte load
packet and filename-only FES load callback establish the finite absence of the
later packet tail, not a claim that all engine crossfades are absent. Sound
completion-frame tracking and elapsed message219 remain unreviewed. The captured
SOUND constructor does not initialize its+17C play-option field; explicit `play`
is the proved writer, and no raw uninitialized C++ field equals the normal DTO
by assumption.

Owned Core/Script GCALL, FES image/plane/effect/Sound and motion controls exercise
this slice without executing commercial scripts or original code. They check
literal outputs, actual child identities and resources, complete settled cold
DTO restoration with no warm tick or command replay, and isolated close. Those
controls do not establish an actual commercial title presentation or enable any
unselected menu, storage branch, translation API, quoted-name policy or larger
scratch domain. Unknown385/856 retain their own four/seven-word signatures.

Ordinary Script child registration does not need its optional immediate/queued
message policy. That policy is read with `nativeABIBehavior` only when one of
those mappings is actually selected; a missing policy then rejects before
changing the task. Base registration and destruction continue through their
existing receivers. No modern message array supplies an old-version default.

### 2.6.1.67 selected close callback

The reviewed close message `0xffff0006` selects main callback 4036 and its
persistence subroutine. Main 238/240/244/245/246/277/469/833/834/835/870/872
are admitted only from their own complete wrappers and selected callees. Main
247 was already admitted. Other operations, including 239/385/856/869/871/873,
stay unknown; no neighbouring slot or other version is enabled by this group.

The existing global-file, variable/string banks, database handles and single
`NativeBufferMemory` remain the owners. Guest byte address zero remains valid;
raw native-buffer addresses, typed handles, native task IDs and World IDs stay
separate. Main 240 resolves a real native task ID before reading its bank. Main
833/834 reuse the existing four-byte reference prefix; 835 copies the exact
owned range. Database export 872 queries or writes `4 + count * 268` bytes,
including a 256-byte name and three raw DWORD flags per record. A NULL database
leaves the native result unwritten and is outside the admitted normal domain:
the consumer rejects it without inventing zero or a scratch value. The VM reply
contract is unchanged.

Own version data records 67's 512 KiB global-file capacity increments and its
getter result zero for both empty and missing strings. The existing modern
64 KiB growth, empty-string presence result and explicit fixture sentinel
policy are retained; these new data fields do not claim new native evidence
for modern versions. Version 63 keeps these unreviewed behaviours unknown and
its corresponding slots disabled. Growth is derived from the Runtime profile
when a global-file handle is restored; it adds no checkpoint field, parallel
heap or compatibility reader.

Owned tests deliver the real close message through Root/Script, save CSS and
check literal variable/guest/database bytes and buffer canaries. A full World
DTO cold restore executes no native, VM step, World tick or MT draw, and closing
the old owner preserves the fresh handles and buffer before independent close.
The tests also distinguish empty/missing text, cross the actual growth bucket,
and reject the unwritten database domain. The four unique short passes are a
composite: the original two baseline native failures and all later dependency
and author failures remain in ignored receipts. No new actual startup, close,
title-WAIT, whole game, browser or physical-oracle result is claimed here.

## Question, Mission, Selection and compiled data services

The fixed .23, .63 and .67 builds independently admit their own Question,
Mission, Selection and KCDB table wrappers. Each registration uses the common
JavaScript data models only after comparing its own wrapper, callee, allocator,
object fields and full GCALL behavior. In .63 and .67 the 769/770 wrappers still
resolve a valid one-word Question owner before an empty original member call;
these two entries are empty behavior, separate from the 83 functional entries.
The .23 versions remain its independently proved arbitrary-width empty entries.

Native Question and Mission state can travel through the author raw allocation,
CSS copy, native save, cold read, import and release calls. Owned buffers retain
reference headers, independent copies and the original length-write behavior.
Only proved allocation failures return zero; invalid sizes, pointers and unrelated
errors remain diagnostics. Unwritten CSS record zero depends on unused native
storage and remains protected; explicit zero-byte records are supported.

Question genre ranges match occupied keys without expanding every integer in a
large legal interval. Duplicate and overlapping ranges retain their original order
and shared integer RNG consumption. KCDB reads enforce the declared output size
and exact decoded length without a local artificial size threshold. Its output
reservation precedes local streaming decompression: output-allocation exhaustion
stays diagnostic, while inflater-internal resource errors and bad streams return
zero. The five own originals establish these distinct failure branches; small
controlled real-GCALL cases cover retry and cold ownership without huge files. The input tables are legal authored native-format fixtures;
scoped original-resource inventories did not find corresponding game data tables.
These checks establish VM and native-format behavior, not a new product route.
