# JavaScript FES object models

Phase 7 is replacing the FES producer records and drivers. The independent
modules below are verified models; they do not yet replace the production
family entry, constructors or restore path. The migration inventory continues
to count those original consumers until the entry switch removes them.

| Model                   | Responsibility                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `fes-object-graph.mjs`  | Object identity, lifetime parents, ordered children, allocation counter                |
| `fes-image-model.mjs`   | Image selectors, typed coordinate queries, BUTTON lock                                 |
| `fes-common-model.mjs`  | Typed graphical setters, dirty propagation and query output sentinels                  |
| `fes-motion-model.mjs`  | Distinct image, plane, alpha-only and Base virtual state adapters                      |
| `fes-motion-driver.mjs` | Recursive busy, base snapshot gating, child-first updates, stopping and target restore |
| `fes-image-cache.mjs`   | Task-owned encoded image cache and complete independent bitmap decodes                 |

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

`FESImageCache` uses the canonical JavaScript data-buffer store. It retains the
first descriptor inserted under a category-resolved name, caches file bytes
once, and decodes each requested image into an independently owned bitmap. It
preserves native selector behavior, format-specific RGB24 policy, canvas and
crop offsets, anchors, attributes, bitmap modes and alpha hints through
the shared bitmap import. A missing selector does not choose the first frame.

Concurrent reads share pending I/O. An explicit insertion while a read is pending
retains ownership of that name even when the read misses. Cache snapshots save
the descriptor references after I/O settles; runtime restoration reconstructs
their bytes and reference counts first. Closing an individual interpreter must
not release this task-owned cache. Final task close releases its descriptors.
The cache model is independently verified against a new World without loading
an EXE; the production FES task will adopt it at the family entry switch.

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
