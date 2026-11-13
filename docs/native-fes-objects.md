# JavaScript FES object models

Phase 7 is replacing the FES producer records and drivers. The independent
modules below are verified models; they do not yet replace the production
family entry, constructors or restore path. The migration inventory continues
to count those original consumers until the entry switch removes them.

| Model                       | Responsibility                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `fes-object-graph.mjs`      | Object identity, lifetime parents, ordered children, allocation counter                |
| `fes-image-model.mjs`       | Image selectors, typed coordinate queries, BUTTON lock                                 |
| `fes-common-model.mjs`      | Typed graphical setters, dirty propagation and query output sentinels                  |
| `fes-motion-model.mjs`      | Distinct image, plane, alpha-only and Base virtual state adapters                      |
| `fes-motion-driver.mjs`     | Recursive busy, base snapshot gating, child-first updates, stopping and target restore |
| `fes-image-cache.mjs`       | Task-owned encoded image cache and complete independent bitmap decodes                 |
| `fes-object-collection.mjs` | First-wins CP932 keys, persistent group counts and initialization request FIFO         |
| `fes-common-commands.mjs`   | Whole-selection common commands and argument/output boundaries                         |
| `fes-object-factory.mjs`    | Pure typed constructors with explicit family initializers                              |
| `fes-definitions.mjs`       | Actual header, numeric tuple and reference parsing, then typed application             |
| `fes-plane-driver.mjs`      | Real SimplePlane resource children, transforms and cached metadata                     |

Image/plane state is ordinary JavaScript data. The MOT adapter uses KX2's defined
144-byte script interface; that byte packet is an execution interface, not an
original PE object layout or a serialized object authority. Float32 matrices
retain their raw words, angles remain in radians, and per-object packet and
traversal buffers are reused.
Vector setters first compare the complete native vector and write it only when
that comparison changes. Consequently an unchanged negative-zero component
retains its word, including plane W; when another component changes, the whole
vector is written. Matrix setters instead compare raw words.

## Object identities and ordering

Object handles start at `0x1001`, are unsigned and increase monotonically within
one FES collection. They are never reused during that collection's lifetime.
Zero represents no object. `0xffffffff` is reserved as the exhausted/invalid
identity; `0xfffffffe` is the last allocatable handle. Allocation checks the
counter before incrementing, so uint32 wrap cannot produce a collision. A
checkpoint saves the next counter and each live object's identity and parent
handle. Restore rebuilds links without allocating replacement identities.

Children visit in ascending unsigned handle order, followed by their parent.
Reparenting preserves the child's identity. Only the lifetime operations consume
this order: dirty propagation, recursive MOT busy/update/skip/stop and recursive
deletion. The resource-driver queue retains its own order. Explicit drawing
priority, retained entry keys, draw tie-breaks and input priority do not use this
child order. An image's retained key remains separate from its current layer.

This is the approved browser memory-identity replacement. The original child
map sorts native object pointers, so reusing a native allocator hole can change
that order and which sibling consumes a shared MOT random value. The JS order
is intentionally stable after delete/create and across Worlds; it is not a claim
of equivalence to every native heap layout. The original no-object-reuse oracle
retains the same alpha/beta order and the same shared-RNG outputs in both
registered engines. Tests separately cover the deterministic delete/create,
reparenting, counter boundaries and restored ordering.

## MOT lifecycle

The registry owns exactly one motion target for an object. It may supply the
existing sound target rather than creating a second manager. Every manager
starts with the native default KX2 base. Base-family virtual snapshots leave
that base intact; known Base output methods do not project motion output onto
object geometry, while their managers still execute actual programs.

Before adding a motion, FES checks the object's whole lifetime subtree. Only
when no manager is active there does its typed virtual method refresh the base.
An idle parent with a busy child must retain its earlier base. SUBCOMMAND
parameter conversion reads that cached base; its actual KCS program controls
completion. Normal updates use the owning task's effective frame minus paused
frames, with children before the object's own manager.

Stop first marks all managers in the subtree skipped. It then updates the whole
subtree at frame zero, including a repeated visit to frame zero. Finally it
unconditionally clears only the explicit target's manager and delay. A child
that ignores skip remains active and keeps its delay; a child that exits is
retired by its ordinary update. Stopping a sound/particle/plugin host task is a
separate typed action of the command controller.

Restore rebuilds managers and clocks without applying their cached working
output over the separately restored current object fields. The public authored
tests compare complete original state packets and real MOT execution, check
shared RNG continuation, and reconstruct a new graph and target registry.
Production World integration and its complete rendering/input tests remain
phase-7 work.

## Encoded image cache

`FESImageCache` uses the canonical JavaScript data-buffer store. Its task-owned
resident map contains only explicitly inserted or preloaded descriptors. A new
message350 key retains one reference; a duplicate leaves that first pointer and
its count unchanged. `preload(name)` reads through the existing image category
and native search mode3 before attempting first insertion, even for duplicate
names. Successful default message332 connects the real whole-line `#PRELOAD`
source getter to this service after definitions and before resource entries.

`data(name)` grants one caller-owned reference: a resident hit increments that
pointer, while a lazy miss reads into a separate descriptor without inserting it
into the map. Independent misses perform independent reads and own distinct
buffers. Native file-backed descriptor size/capacity round up to eight bytes;
bytes beyond the actual file have no recovered native value. The current JS
allocator initializes them to zero without treating that padding as an oracle.
The resident lookup occurs only before I/O. An explicit first insertion arriving
while a miss waits owns the map's entry independently: this miss still returns0
for absent bytes, or a new owned descriptor for its own read bytes. It neither
substitutes the late resident nor changes that resident's reference count.

`decode(pointer, selector)` borrows the caller's descriptor and produces an
independently owned bitmap. `load(name, selector)` returns its temporary encoded
reference in `finally`, including decoder failure. Image, panel, text, control
and plane metadata consumers follow the same rule. An IMAGE frame map retains
its own descriptor; an IMGWND keeps one temporary descriptor across all nine
frame lookups. PANEL font-frame decoding holds the current temporary file while
consuming that file's frames and returns it on success or failure. Selector,
RGB24, canvas/crop, anchor, bitmap-mode and alpha policies remain those of the
shared bitmap import; a missing selector does not choose the first frame.

Unsettled source I/O rejects cache snapshot/close. Once settled, the existing
checkpoint saves the resident map's pointers once, while current object/entry
state separately refers to its genuinely held descriptors in the same shared
buffer store. Restore rebuilds those exact bytes/counts without source reads,
resident reinsertion or image selection. Closing an interpreter releases its
objects but preserves the task's resident map; final task close releases each
map reference once. A caller still holding a temporary reference remains its
owner until it returns that reference. Short ordinary World/kind34/default FES
cases cover both registered ABIs. Source `#PRELOAD` performs repeated nth scans
through the same bound string bank; its source and overflow boundaries are
specified in the native FES task protocol.

## Whole-selection common commands

`FESCommonCommands` coordinates the recovered 24 common commands through explicit
collection, variable-bank, motion and typed resource services. It evaluates
authored expressions once before iteration and preserves holes: position and
stop skip them, size and delete stop, and an interrupted `ismot` does not write
a partial OR. Coordinate queries require an explicit element and suppress only
the exact output index -1. PARTICLE contributes its raw busy word. SCROLL's
common `pri` changes its dedicated plane priority; SCROLL2 and SLIDER change
their biased image priorities.

Image/plane position commands write their typed coordinates and then execute
the actual `pPos` MOT with the object's delay. A motion registry can retain the
existing sound adapter as the sole snapshot and output owner. Blend keeps one
RGB source for the entire selection: a plane replaces it with its previous
ARGB, and later supported objects inherit that value. Other objects initially
use the explicit command-source address. This preserves the recovered boundary;
it does not introduce PE addresses as object state.

The public short tests cover expression side effects, type gates, holes,
query writes, deferred copy requests, table outputs, real MOT delay and fresh
target restore. This coordinator remains independent of the default FES
factory until the shared collection and family drivers are integrated. The
old D7 entry and projection counts therefore remain unchanged.

## Collection identity and initialization requests

`FESObjectCollection` separates byte-name/index keys, the first declared group
count, resource initialization requests and lifetime handles. Keys compare
NUL-terminated CP932 bytes and signed int32 indices; scalar declarations and
array index0 share one key. Repeated creation keeps the existing typed object
and its handle. The first count persists through later grow, shrink and
delete/recreate operations; explicit lookup may find an index beyond that
count, while bare selections retain missing slots. NUMIMG registers counts and
requests without an object. VIEW declares type5 but constructs a raw0 Base.

Every creation request appends its name/index to the initialization FIFO,
including duplicate and NUMIMG requests. Consumption looks up the current
object; deletion removes only the first request for its explicit target.
Stale requests for recursively deleted children can therefore resolve to a
hole or a later replacement. Resource ordering uses this FIFO independently
of object-map key order and semantic lifetime order.

Snapshot saves declaration and actual types, first counts, live typed state,
parent handles, the monotonic handle counter and pending keys. Fresh restore
rebuilds prototypes and links without replaying declarations or resource
initialization. These standalone semantics are covered by short public tests.
Default FESInstance factory/selection/restore and the implicit `_TOPOBJ_`
identity remain coordinated integration work; no D7 removal is claimed here.

## Typed definitions and frozen applicability

`FESDefinitionModel` compiles the original header codes and reads each row
once before its typed targets are visited. Tuple components are selected by
commas before evaluation; an empty component evaluates as0, while a missing
preceding comma leaves that component absent. Object references scan CP932
bytes and evaluate their index once. Bare references retain index-1 only when
the first declared count exceeds1. Resource setters then parse the first
colon's integer selector, separately from that object-reference index.

PARENT binds the lifetime graph before the type-specific application. PL and
external plane IDs remain independent. TABLE16..20 requires an immediate
owned loader before FILE, so START can query the loaded table. The factory
creates no World resources; text, sound, M2 and image tails must provide their
existing pure initializers and typed definition services. Missing services
fail explicitly. VIEW declaration5 owns a raw0 Base; NUMIMG has no instance.

Definition POS and common `pos` are separate contracts. PLANE/CPLANE definition
POS preserves omitted fractional coordinates and W; the command truncates
omitted coordinates through integer getters and writes W1. IMAGE SIZE2 retains
its metadata-source flag without setting the common size dirty flag. PLANE
SIZE2 additionally requests a size rebuild. Control POS2 pending references
are ordinary state and survive a standalone control checkpoint. Rectangle
control loading borrows an associated raw4 PLANE's local VRAM origin, rather
than its display position.

The frozen typed appliers define narrower applicability than the unversioned
manual. IMAGE/PANEL/SAVEPANEL/IMGWND headers do not apply generic SIZE/BASE/COLOR;
CIMAGE has SIZE/COLOR and BUTTON adds SIZE. Common command `size` remains
separate. SCROLL2 excludes ordinary POS/TYPE headers; SLIDER excludes POS/BASE;
control ID.\* columns have no typed application. Recognized inapplicable
columns still retain their original parsing side effects.

PRI's row-wide relative flag is set for whole-group selection. IMAGE, PLANE
and SCROLL add the element index when it is set; SCROLL2/SLIDER use the
opposite index rule. PRI_P is SCROLL's separate dedicated-plane priority,
not a generic image or parent-relative priority. These statements supersede
the earlier common-survey shorthand.

These independently tested models retain the evidenced74/76 behavior. The
contract inventory must record manual-versus-frozen differences and ABI
applicability separately from real missing implementations. They do not
create an unversioned extension API or establish another engine version.
Default factory/definition entry integration remains pending and counted.

## Normal DEFINE zero count

The registered SDK74 and Game76 normal `#DEFINE` consumers change a parsed
count0 to1 before ordinary object construction and requested initialization.
`CIMAGE image[0]` therefore creates `image[0]` and one pending key. `NUMIMG` keeps
its established null-object factory behavior but registers count1 and one
requested null key. A scalar, count1 and other nonzero counts retain their
existing paths. This normalization belongs to `FESCoordinator.initialize`;
the dynamic instance creation API and shared collection retain count0.

The parsed source declaration records its original count text `0`. The collection
owns the actual current count1, object, pending keys and resource entries.
Message332 consumes those pending keys through the existing graphics
initialization tail; message333 runs the ordinary interpreter/resource update.
Fresh restore uses saved current objects and resource wrappers without reloading
or re-evaluating the declarations. The public default-entry regression checks
OBJECT application, real bitmap creation, NUMIMG holes, dynamic count0 and
independent fresh ownership for both ABIs.

The normal zero-count branch is independent of the known-name matching below.
Per-version declaration-table membership, unknown-type diagnostics and the
remaining byte/name and malformed-count declaration constraints are still partial.

## Known DEFINE type names in the C locale

Normal DEFINE resolves an already-known type name using narrow ASCII case
matching, with a private lookup derived from the existing canonical type
catalogue and BASE descriptor. Only ASCII A through Z fold to lowercase; Unicode
case conversion and new type aliases are not used. The canonical descriptor
feeds the existing collection, typed object construction and Button keyNames
registration. Program source and declaration type text remain unchanged, as do
object-name matching and dynamic creation APIs.

All existing ABI factory guards remain authoritative. SDK raw36 EFKPLANE still
fails the effekseerTask guard in createFESTypedObject; raw37 STRING8 and raw38
LOGSTRING8 still fail their real initializer utf8Text guards. An authored SDK
negative case verifies uppercase and mixed case reach the same descriptors and
same errors without allocating the unsupported World tasks. This does not close
all original per-version declaration-table membership or diagnostic rules.

Each instance's existing mutable keyNames Set is saved once as an array in its
current FES player checkpoint. Restore validates that current array and fills
the newly created same Set; malformed or missing current data is not interpreted
as an empty set. Restoring does not replay source, declarations, macros or bank
expansion. This keeps actual Button focus callbacks and keyboard selection
metadata consistent with the restored canonical objects. DEFINE remains partial
for its remaining declaration-table, unknown-type and byte/expression behavior.

## Literal ASCII hyphen in DEFINE names

Within the already supported ASCII word-name domain, normal DEFINE also accepts
literal `-` (byte0x2D). Both original narrow scanners stop a name only at NUL,
space or `[`, so `panel-one[2]` retains name `panel-one` and the existing literal
count text `2`; `choice-one` retains its complete scalar name. This leaf adds only `-`
to the current name character class. Other punctuation, Unicode/CP932 names,
arbitrary suffixes and diagnostic policy remain pending. Count expressions have the
separate normal initialization contract below.

Names keep the current field and nativeName owner. For this ASCII-only domain,
CP932 encoding maps every name byte identically, including0x2D. There is no
case folding, substitution or second name buffer authority. Current collection
lookup, OBJECT rows, indexed commands, requested resource keys, Button callbacks
and fresh lookup use the complete original hyphenated name. Existing name-byte
limits and type/ABI/count behavior remain unchanged. The public two-ABI default
regression checks these consumers and independent restored ownership; DEFINE
remains partial for its unclosed domains.

## Normal DEFINE count expressions

A parsed declaration retains every explicit count as its original expression
text, including decimal literals such as `0`, `00` and `2`. A missing bracketed
count remains null. This is the current program and checkpoint representation;
it does not store an evaluated count or a second bank state.

Normal initialization expands a declaration's name first, then evaluates its
count once against the current interpreter bank, in source declaration order.
Count text receives no additional string-bank or SCRIPT replacement. Arithmetic
and variable side effects use the existing expression evaluator and signed
integer result. For example, with variable60 initially1, successive declarations
using `[$60++]` request1 and2 objects and leave that same variable at3. Object
construction, initializer keys and the later OBJECT rows observe this order.

The original shared name/count reader represents an omitted count as expression
`-1`. A result of-1 becomes0 only if the current same-name group count is at most1;
normal DEFINE then changes0 to1. Thus the first declaration `item[-1]` creates
one object. If the current group already has count2, a later declaration yielding
-1 records a diagnostic and skips that declaration. It does not request another
initializer or replace the first group count. Other negative results remain
unsupported and are diagnosed without invoking the factory. Dynamic creation
and the shared collection keep their separate count0 behavior.

The existing bare FES player also evaluates the retained count text before its
creation loop, preserving that independent path's null-to1 and zero-count
behavior. It does not acquire another native declaration or checkpoint reader.
Fresh restore rebuilds current objects from saved state without re-evaluating
count expressions, re-enqueuing initializers or reading the FES source.

The short two-ABI default-entry regression checks current-bank arithmetic,
name-before-count and declaration order, exactly-once increments, `00`, signed
positive counts, both-1 branches, actual OBJECT/resource FIFO and bitmap creation,
and fresh continuation without expression side effects. Empty brackets, general
malformed-expression fallback, other negative counts, remaining narrow-name
bytes and per-version declaration membership remain partial.
