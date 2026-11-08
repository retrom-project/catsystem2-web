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

The FES drivers are original code. The SimplePlane/BasePlane message receivers
still use the current host adapter after their original construction; replacing
that adapter with the complete original receiver and GraphManager/model path
is in progress. Their advanced geometry, all message combinations, complete
transformation variants and final browser transition acceptance remain open.
These bounded fixtures do not establish full-game completion.

Primary references: [CPLANE](https://cs2.suki.jp/manual/fes/code/o_cplane.html),
[PLANE](https://cs2.suki.jp/manual/fes/code/o_plane.html). Frozen executable
bytes, raw decompilation and private runtime reports remain outside Git.
