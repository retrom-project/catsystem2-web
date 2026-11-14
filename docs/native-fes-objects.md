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

Normal common commands carry the selection's original `nameBytes` and signed
index directly into the existing collection; presentation names do not take part
in count or lookup. Their argument/name expansion has already happened at the
caller, so the command does not repeat bank expansion or parse another index.

Image PL and deferred copy references store owned `nameBytes` and signed indices
in the current checkpoint. PL compares byte content and index before dirty
propagation; copy keeps independent buffers for each target and retains its
source index-1 to0 rule. Normal image/panel/control/font and button PL readers
consume those bytes directly. Resource filename references and the bare player's
String plane association retain their independent contracts.

The short tests cover expression side effects, type gates, holes, query writes,
deferred copy requests, table outputs, real MOT delay and fresh target restore.
Raw-owner tests use the existing collection author API; they do not enable
non-ASCII DEFINE or native message338. Existing entry/projection counts and
unrelated command coverage remain unchanged.

Normal BUTTON bindings borrow one latest child task for each existing collection
`nameBytes`/signed-index tuple. The resource allocator passes an owned reference
explicitly even before the player root is assigned. Bounds and cursor warps read
the object's existing `nativeInputTaskID`; duplicate old entries still drive that
latest child. Cleanup removes the child actually destroyed, preserving another
latest binding. Current Input snapshots clone owned reference/child pairs without
replaying allocation or interpreting an older format. The independent bare
player's String-key binding API remains separate. The normal nativeEvent/byKey
bridge, keyboard name filters and named waits still have their own identity work.

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

The owned raw DEFINE row retains the complete source text `CIMAGE image[0]`. The collection
owns the actual current count1, object, pending keys and resource entries.
Message332 consumes those pending keys through the existing graphics
initialization tail; message333 runs the ordinary interpreter/resource update.
Fresh restore uses saved current objects and resource wrappers without reloading
or re-evaluating the declarations. The public default-entry regression checks
OBJECT application, real bitmap creation, NUMIMG holes, dynamic count0 and
independent fresh ownership for both ABIs.

The normal zero-count branch is independent of the known-name matching below.
Per-version declaration-table membership, malformed-declaration diagnostics and
the remaining byte/name and malformed-count constraints are still partial.

## Known DEFINE type names in the C locale

Normal DEFINE resolves an already-known type name using narrow ASCII case
matching, with a private lookup derived from the existing canonical type
catalogue and BASE descriptor. Only ASCII A through Z fold to lowercase; Unicode
case conversion and new type aliases are not used. The canonical descriptor
feeds the existing collection, typed object construction and Button keyNames
registration. The owned raw source row preserves the original type text; lookup
uses the type token after the normal row/token expansion stages below. Object-name
matching and dynamic creation APIs retain their existing authorities.

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
for its remaining declaration-table and byte/expression behavior.

Normal BUTTON registration records a keyboard membership key from the created
collection object's owned name bytes through the existing reversible byte view.
The key contains only the raw base name, with no index or decoded display text.
Normal public candidates compare the same base key, so distinct raw names that
decode alike remain separate while all indices in one registered group share
membership. An empty Set keeps the existing unfiltered policy. The current
String-array checkpoint carries these byte-view keys unchanged; restore does not
replay registration or expansion. Bare players retain their display-name keys.
This closes membership filtering and its checkpoint, while
placement/plane and broader keyboard identity remain separate work.

Normal public `push` accepts the current collection's raw `{nameBytes, index}`
reference. Its synchronous Boolean reports acceptance; `await player.flush()`
waits for the serial operation, including focus, push, the click handle and release,
and restores the interrupted frame and waits. Event and native input drains use
explicit command-only flushing so an operation never waits for its own completion.
A checkpoint rejects an unfinished public push; promises are not saved. The
independent bare player retains its synchronous String target API. A null or
missing target, including an exact index of -1, returns false without changing
focus or emitting events. Existing instance order, enable and visibility policy
remain. This closes public push target identity and completion; other synchronous
event entrances, coordinate parents and plane visibility remain separate work.

Normal named object-motion waits retain the selected collection references as
owned raw name bytes and signed indices. The initial busy check and later frame
checks resolve those same references through the current collection, so names
that decode alike do not redirect a wait. A missing saved element is no longer
busy; the existing frame path clears the completed wait. Snapshot and restore
copy the reference bytes without replaying source or argument expansion. Bare
players keep their independent String references. Getter order, skip, next and
motion completion timing retain their existing behavior.

Normal named sound waits also retain the selected collection's raw name bytes and
signed index. The two existing operand getters and first selected object policy
remain; later busy queries resolve that same reference. The object's filename and
native sound bank remain separate resource and playback identities. A missing
waited sound still raises the existing error. Audio completion or STOP releases
the wait through the existing busy query, while returning events preserve it and
`next` clears it. Current checkpoints copy the reference bytes without replaying
FES source or PLAY commands; rebuilding media sources during restore is allowed.
Bare players retain their independent String references and sound-host policy.
This closes sound wait identity without extending sound timing or table behavior.

## Literal ASCII hyphen in DEFINE names

Normal DEFINE retains literal `-` (byte0x2D). Both original narrow scanners stop
name bytes at NUL, space or `[`, so `panel-one[2]` retains name `panel-one` and
count text `2`; `choice-one` retains its complete scalar name. No Unicode regexp
or decoded-name reconstruction chooses the scanner boundaries.

Names reach the existing collection as owned bytes. Current collection lookup,
OBJECT rows, indexed commands, requested resource keys, Button callbacks and
fresh lookup keep the complete hyphenated name and existing nativeName owner.
The short two-ABI default regression retains these behavior and ownership checks.

## Normal DEFINE raw rows and expansion stages

The current program and checkpoint store DEFINE as owned raw byte rows, including
the first and repeated section headers and prepared interior empty/comment rows.
There is no persistent decoded type/name/count record. Normal initialization starts
at section index1; the first header is index0. Each visited row passes through the
same bound source string bank, without SCRIPT. An expanded row beginning with
byte `#` is skipped. Missing type/operand tokens diagnose and continue without
inventing an object.

The line-bank result is tokenized by the existing profile scanner. The selected
type token then passes through bank and SCRIPT before the shared known-type lookup.
Only a known type proceeds to the operand token, which receives its own bank and
SCRIPT expansion before the name/count byte scanner runs. Thus a row-bank value
can insert token-separating spaces, and an operand-token replacement can introduce
brackets and a count expression.

The scanner stops the name at NUL, ASCII space or `[`. An explicit expression must
reach `]` before NUL or space; bytes after that closing bracket are ignored. The
scanned name alone receives one further bank expansion, without SCRIPT or rescanning.
Only then is the scanned count sent directly to the integer evaluator, once. All
stages observe the instance's existing current bank in source order.

Semicolon is an ordinary name byte in this normal path: `CIMAGE scalar;` declares
`scalar;`, while `CIMAGE array[2];;` declares `array` with count2 and ignores the
suffix. The independent standalone FES consumer reads the same raw-row schema
using its existing optional-terminator grammar. Its pure parser is also used by the
static corpus survey, without evaluating counts or running expansion or handlers;
that static grammar does not define normal native behavior.

This stage supports nonempty final name bytes consisting of ASCII letters, digits,
underscore, hyphen and semicolon. Other characters, non-ASCII names and brackets
inserted by the final name-bank expansion remain unsupported implementation domains;
this is not evidence that native rejects them. No decode/re-encode fallback is used.
The existing collection copies through NUL and checks its existing31-byte name
boundary; this change adds no new native length claim. General narrow-byte identity
through labels, references and presentation-key consumers remains partial.

The few default-entry cases for both registered ABIs exercise the real ENTRY,
row/type/operand/name services, unknown-type skip, current-bank increments, OBJECT,
exact resource FIFO and message333 bitmap creation. Fresh restore retains raw rows
and current objects without reading source or replaying any expansion or count.

## Normal DEFINE count expressions

Each owned raw row retains its complete source operand rather than a decoded
count field. At initialization the row/token stages above run before the byte
scanner extracts count text. Decimal literals such as `0`, `00` and `2` use the
same direct evaluator as other expressions; an omitted bracketed count supplies
expression `-1` to the shared reader.

After scanning, normal initialization expands the name alone, then evaluates its
count once against the current interpreter bank, in source declaration order.
There is no further string-bank/SCRIPT pass or property-unit suffix stripping at
this evaluator stage. Arithmetic and variable side effects use the existing
expression evaluator and signed integer result. For example, with variable60
initially1, successive declarations using `[$60++]` request1 and2 objects and leave
that same variable at3. Object construction, initializer keys and later OBJECT rows
observe this order.

The original shared name/count reader represents an omitted count as expression
`-1`. A result of-1 becomes0 only if the current same-name group count is at most1;
normal DEFINE then changes0 to1. Thus the first declaration `item[-1]` creates
one object. If the current group already has count2, a later declaration yielding
-1 records a diagnostic and skips that declaration. It does not request another
initializer or replace the first group count. Other negative results remain
unsupported and are diagnosed without invoking the factory. Dynamic creation
and the shared collection keep their separate count0 behavior.

The existing bare FES player extracts its count text from each raw row with its
standalone grammar, then evaluates directly before its creation loop, preserving
that independent path's omitted-count-to1 and zero-count behavior. Its pure parsing
helper does not evaluate or retain a second program AST.
Fresh restore rebuilds current objects from saved state without re-evaluating
count expressions, re-enqueuing initializers or reading the FES source.

The short two-ABI default-entry regression checks current-bank arithmetic,
name-before-count and declaration order, exactly-once increments, `00`, signed
positive counts, both-1 branches, actual OBJECT/resource FIFO and bitmap creation,
and fresh continuation without expression side effects. Empty brackets, general
malformed-expression fallback, other negative counts, remaining narrow-name
bytes and per-version declaration membership remain partial.

## Unknown DEFINE type names

Normal initialization expands the row, tokenizes it, and expands the type token
through bank and SCRIPT before looking it up. A name absent from the existing
shared type catalogue and BASE descriptor produces a located diagnostic using the
original type-token text, then skips the row before operand expansion, name scanning
or count evaluation. Later valid declarations continue. An unknown declaration
creates no object, group, lifetime handle, initializer request or resource entry.

For example, with variable60 initially1, valid declarations surrounding
`UNKNOWN skipped[$60++]` can request1 and2 objects using their own `[$60++]`
counts and leave the current bank at3. The skipped operand is never requested from
the argument expansion service, although the earlier row and type stages have run.
The later OBJECT rows and ordinary resource consumer still process the valid
declarations in their original FIFO order.

A known descriptor whose ABI implementation is disabled keeps its existing strict
factory or initializer error. In particular, this change does not make SDK
EFKPLANE, STRING8 or LOGSTRING8 succeed or turn those errors into unknown-type
skips. Per-version membership is not inferred from a table length or sentinel,
and no unknown native slot or unregistered engine version is enabled.

The two short registered-ABI default-entry cases verify the diagnostic, untouched
raw declaration, name/count ordering, unchanged current bank, absent unknown
object/group/request, subsequent OBJECT application and actual bitmap creation.
Unknown rows do not validate a missing or malformed operand after their type has
been rejected. Full native diagnostic wording, arbitrary diagnostic callbacks,
per-version membership and remaining narrow-byte syntax remain partial. The
independent bare FES player's unknown-type policy is unchanged.

## Raw label keys and DEFAULT

Generic section labels and DEFAULT prefixes use reversible byte-view keys. The
program owns one block map with those keys; it does not retain a decoded label
map. For example, raw bytes `81` and `82` remain distinct even though CP932 decoding
can display both as the same replacement character. These are label identities,
not text for a case-folding or Unicode matching operation.

The normal DEFAULT definition keeps the expanded token as a byte-view key. Known
native events first visit DEFAULT.EVENT and then the ordinary object's own
name.EVENT label. The ordinary prefix comes from the collection's existing
nameBytes/index reference, rather than its decoded presentation key. The existing
current-object selection and event-index owners remain authoritative. Bare
object names retain their independent CP932 String boundary.

Labels, suspended stacks and DEFAULT keys are restored as saved runtime state.
A fresh World does not reparse the source, re-expand macros, repeat declarations
or dispatch the earlier event to reconstruct those identities.

Source-arena object-name addresses also retain the current selection's original
narrow bytes. One command record caches each byte-view name once, independently
of its selected array index; fresh restore preserves the same bytes and address.
This closes the address service after selection.

Normal DEFINE keeps its implemented ASCII-name guard. Dynamic message338 passes
raw names and signed int32 counts directly from the sender to the existing
collection; it does not parse bracket suffixes or use decoded names as identity.
Nonpositive counts retain empty groups and the original first count, including
through fresh restoration; they do not construct objects or queue initializers.
Complete positive factory coverage, unsafe names and failure/lifecycle behavior,
remaining public byKey/input bridges, numeric object references outside common
arguments and other ordinary-name consumers remain separate gates. Common-command selection and PL/copy
transport now preserve raw bytes; correct labels, source-name addresses and
common commands do not establish that all earlier consumers selected the correct
raw object name.

Normal native input events resolve the existing collection nameBytes/signed-index reference directly. Pressed references, SYSKEY and TOUCH resource tuples, directional selections and control messages 27/28 reach the current object without a presentation-key lookup; the shared event field writes, label whitelist and callback timing remain unchanged. Bare FES input retains its explicit String boundary. Keyboard-name filtering and public key lookups remain a separate gate, and the normal DEFINE ASCII guard stays enabled.

Normal common numeric operands now use one raw byte getter and the existing
collection's owned nameBytes/signed-index lookup. Known ASCII identifiers and
escaped ASCII quote bytes retain their exact spelling; missing objects yield0,
with one index evaluation. Literal high bytes are distinct from object-name
bytes: single quotes retain the proven WORD shifts, while high bytes in double
quotes remain an explicit literal-domain gate. Bare and independent String
lookups keep their existing boundaries. This common-argument closure does not
close the remaining decoded property/definition/motion/String numeric producers,
H1 head/directeval/mode1, general name consumers or the normal DEFINE guard.

The dedicated normal `lockactive` Number frontend also consumes its existing
expanded bytes through that reader, preserving optional-empty behavior, both
1024-byte checks and the original int32 FIFO. This closes that one producer;
remaining prepared-property, definition, motion and general String numeric
producers stay separate. The collection's raw ownership and signed-index lookup
are reused, with no new identity or saved-state format.

## Normal public focus callbacks

Normal public focus and FESInstance.event callbacks borrow the same event frame
as native notifications. The semantic object's collection reference supplies its
owned raw name, index and current word; display names and baseName aliases do not
supply this identity. The existing event owner restores the caller's tuple,
execution position and wait fields before reporting an internal settled outcome.

When an event completes synchronously and no public operation is pending, its
Boolean result, side effects and any thrown Error stay synchronous. A real
decode or platform await retains its completion in the existing public input
tail. Later normal public events use that same tail and check the captured
instance, runtime, task record and semantic object before dispatch. No additional
queue, context owner or checkpoint flag is created. Synchronous rejection is
consumed only as the duplicate of the same Error already thrown to the caller;
asynchronous failures remain visible through player.error and external flush.

Focus still commits at its original synchronous position: an UNFOCUS prefix may
run, then the focused target changes immediately. If that callback awaits, its
remainder settles before the queued FOCUS begins. This does not mean the whole
UNFOCUS callback finishes before the target changes. Pure synchronous keyboard
focus movement retains its immediate counters and target selection.

Native input and the public push operation continue to dispatch directly through
the event owner. Their internal commands-only drain does not wait on its own
public completion. An unfinished public callback remains covered by the existing
snapshot guard; settled restoration recreates no Promise or callback.

This closes only the public focus/event owner seam. Public press, click,
right-click, slider and drag actions still require separate review of writes
outside their callbacks, including PUSH/clickL/RELEASE and scroll position order.
Bare FES callbacks retain their independent synchronous String contract.
