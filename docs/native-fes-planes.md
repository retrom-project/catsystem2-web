# Native FES planes and area transitions

CPLANE and PLANE execute the mounted engine's original constructor, definition
application, built-in command handlers, motion methods and frame driver. Source
loading allocates the FES object. The first frame driver allocates its real
SimplePlane child after START has run. The raw object, child task and parent
pointer retain their identities across a fresh World.

| Contract                        | Game                | SDK                 |
| ------------------------------- | ------------------- | ------------------- |
| CPLANE constructor / driver     | `74A850` / `65D1D0` | `5EADE0` / `52D130` |
| PLANE constructor / driver      | `74B940` / `661940` | `5EBEA0` / `531330` |
| Common definition application   | `759650`            | `5F77D0`            |
| Save previous plane image count | `628B20`            | `500150`            |
| Reconcile image display changes | `62E0B0`            | `505460`            |
| Resource allocation / frame     | `628D60` / `62DA50` | `500390` / `504E50` |
| SimplePlane constructor         | `5DF7A0`            | `4BBB50`            |
| BasePlane constructor           | `5DECC0`            | `4BB080`            |

The two count phases execute their complete original routines against a
temporary list of live resource identities. Counts and pending display deltas
remain in the original FES objects. The list contains names and indices only;
it does not own images or replace the resource allocation queue. Before script
execution the current count becomes the previous count. After commands, the
original image type filter reconciles display changes before resource creation.
This distinction selects WIPE's incoming, outgoing and cross-image branches.
Sleeping hides retained entries through drawing-task message 287 and masks
input. It preserves each image's script-owned display word and pending count
delta. Both profiles check sleep/wake immediately before a cross-image wipe,
so a temporary UI mask cannot turn that wipe into an incoming-image transition.

The original frame dispatcher traverses the resource list in allocation order.
PLANE and retained image drivers preserve their declaration order so an image
reads the authored `SIZE2` rectangle of an earlier plane on its first frame.
Both profiles check the resulting Draw clip with a nonzero plane origin.

DRAW (type 7) and WIPE (type 8) execute their original constructors and resource
list lifecycle. Their children are actual area-effect tasks: cross-wipe 26,
alpha fade 27, and masked incoming/outgoing wipe 28. The original CPU kernels
write VRAM; intermediate transition pixels do not overwrite the retained CPU
surface. Completion removes the temporary object and task and reenables the
surface's ordinary upload. The source and mask bitmap references retain their
original ownership.

| Area task | Game constructor / receiver | SDK constructor / receiver |
| --------- | --------------------------- | -------------------------- |
| 26        | `5EFC30` / `5F01F0`         | `4CA560` / `4CAA90`        |
| 27        | `5F0690` / `5F0EA0`         | `4CAF30` / `4CB710`        |
| 28        | `5F10E0` / `5F1690`         | `4CB950` / `4CBED0`        |

Both pinned factories also have two unusual defined behaviors. VIEW (declared
type 5) allocates the 44-byte Base object and reports raw type zero; it does not
create an image or viewport task. NUMIMG (declared type 28) registers its group
count but allocates no objects. A declared NUMIMG group therefore answers its
count query while object lookup returns NULL. Its commands have no allocated
targets. Undeclared object names still produce diagnostics. No invented number
display substitutes for this pinned behavior.

`tests/native-fes-factory.test.mjs` runs both complete original factory switches,
with object/group map insertion and lookup as explicit collection boundaries.
It checks VIEW and NUMIMG with counts 0, 1 and 3, including long string storage.
`tests/native-fes-planes.test.mjs` checks true derived task allocations, scoped
IDs, original destruction, START sizing, parent/surface transforms, a real KCS
motion, the declared empty group, all three area-task kinds, incoming/outgoing
wipe selection, intermediate VRAM, completion and fresh-World continuation.

The first-frame child enters the original SimplePlane/BasePlane receiver.
The two-profile browser test verifies original model dimensions, color,
parent-relative position, scale and surface texture offset through FES.
It also exercises the drawing surface's original base plane and its fresh
GPU restoration. Original slider and scrollbar input, notification and
motion tests run with the initialized native view in both profiles.
Advanced geometry, additional message combinations and end-to-end game
transition coverage remain separate acceptance work.

Primary references: [CPLANE](https://cs2.suki.jp/manual/fes/code/o_cplane.html),
[PLANE](https://cs2.suki.jp/manual/fes/code/o_plane.html). Frozen executable
bytes, raw decompilation and private runtime reports remain outside Git.

## JavaScript plane resource driver

`FESPlaneDriver` creates actual SimplePlane children when the semantic size
dirty flag is consumed. CPLANE publishes the color shape; PLANE publishes the
VRAM shape, keeping physical dimensions, local VRAM origin and Draw output
offset separate from display placement. A later size rebuild destroys the
previous child and creates a new graph. Ordinary transform changes preserve
its identity and render order. An unmodified declaration alone creates no graph.

Position uses the existing typed3/4/21 parent rule. Base, scale and matrix
accumulate only through parent4; the parent's matrix precedes the child's.
Draw depth uses the current FES priority rather than accumulated baseZ.
Typed packet and transform buffers are reused. POS2 consumes its pending
metadata source once; SIZE2 remains active for subsequent size rebuilds.
Both use the owning FES encoded-byte cache, including inserted resources.
Missing metadata retains the original zero output fields.

Sleep publishes a temporary display mask and checkpoints that published mask
without changing authored display. New World restore reuses existing child,
shape, graph identity, render order and encoded cache without replaying loads
or transforms. The short public tests exercise both registered ABIs through
real World/D6 services, metadata, deletion/recreation and no-file continuation.
They do not add a GPU pixel claim; complete rendering acceptance belongs to
the coordinated default-entry browser gate.

The new driver is not yet installed by the default FES factory. Its original
entry, driver and projection dependencies remain counted until that switch.
SimplePlane message86 is an independently established empty branch, so its
pending filename request does not invent a file-backed graph.
