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

Image/plane state is ordinary JavaScript data. The MOT adapter uses KX2's defined
144-byte script interface; that byte packet is an execution interface, not an
original PE object layout or a serialized object authority. Float32 matrices
retain their raw words, angles remain in radians, and per-object packet and
traversal buffers are reused.

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
