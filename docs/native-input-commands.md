# Plane registration, input-owner query, bitmap mask and wheel reset

The .23 Input has 64 logical keys with four device slots each; .63 and .67 have 80. The existing per-version configuration key-row layout is the shared authority
for those dimensions. Input state, browser bindings, frame traversal, key gates
and pulses use that same count. A key beyond the registered domain is guarded
instead of reading the adjacent native repeat/capture fields. Snapshots retain
their current profile's typed arrays and validate their dimensions before
replacing either Input or binding state; no extra checkpoint field is needed.

The own original Top constructors create their real Input and Sound children,
and their factories construct the real Script caller. Complete original KCS
GCALLs register and unregister an Input region and read its initial text status.
A bounded original frame traverses 256 device slots in .23 and 320 in .63/.67.
The frame observation excludes the latter versions' additional mouse-state
queries from the key-table count. Device/window input samples are explicit test
boundaries; the Input constructors, receiver, frame and VM bodies execute intact.

With an explicit original engine or loading owner, `5F` retains its complete
original wrapper, and `18A` retains its original wrapper and mask helper.
Root queries use the caller's Top namespace; SDK's Root range remains distinct
from its ordinary two-slot message offset. Original bitmap aliases share their
backing, and the wrapper passes its first DWORD to the plane's alpha-mask
service, which owns a separate copy of the resulting packed bits.

In a normal World without that original owner, `18A` takes a native task ID
and an owned typed bitmap handle. It sends canonical Plane97 (SDK raw95), with
zero wParam and transport flags and the bitmap handle in lParam. Task0 is
still dispatched in the caller's real Top namespace; bitmap0 clears the mask.
Control2 leaves the VM result unwritten. The original Game649070/SDK515840
wrappers and their first-DWORD getters establish the corresponding pointer
packet; a JS bitmap handle is not cast to a native wrapper or pixel pointer.

The existing NativeImages alias/dataHandle authority and Plane97 mask service
sample canvas dimensions and source offsets. Nonzero 32BPP alpha produces
packed bits in low-bit-first order, copied into the Input region. Releasing
both source and alias does not free that copied mask. A fresh World restores
its own copy, and clearing it leaves the prior World unchanged. The normal
GCALL tests cover this owned 32BPP domain; the already reviewed 24BPP helper
domain is unchanged. No second bitmap table, new codec or automatic original
backend is introduced.

In a normal World, `5F` skips target0 before reading its second argument or
sending a packet. For an owned loaded SimplePlane (kind2) in the caller's
zero-ID Top namespace, it sends canonical89 (SDK raw87), with the caller's
native task ID in wParam, the literal second DWORD in lParam and transport
flags0. The existing Graph receiver derives the hit rectangle and priority
from its model/MOT state and retains the literal binding word; movement updates
the existing region without changing its priority or sequence. Control2 never
pushes a VM result, and the ignored local reply slot is not the universal output.

This finite normal path does not interpret that literal as a kind6 BasePlane
RECT pointer or certify nonzero-Top namespaces. These unreviewed receiver/owner
domains are rejected, and unloaded kind2 geometry keeps the existing explicit
error. The retained region flags are opaque JS metadata, separate from transport
or Input filtering flags. No new Graph/Input owner, ABI status or original
backend fallback is introduced.

In a normal World, `3A9` queries the caller's actual Top for its InputTask, then
sends that task the wheel-cancel message. Both envelopes keep zero flags, wParam
and lParam; the transport results are ignored and control 2 leaves the VM result
unwritten. The InputTask's service clears its existing browser wheel bindings.
The Root query uses each ABI's own message number and returns the actual native
task ID, including zero, independently from the transport's routed status.

`6B` uses that same owned Root query, followed by Input message 133 (SDK raw 131)
with its one raw owner word in wParam and zero lParam and flags. A registered
region returns its exact active DWORD, including zero and high bits. Control 1
pushes that word to the guest stack; the shared raw-word signature and
`resultWritten: null` remain unchanged.

When an original engine or its loading owner already exists, `3A9` retains the
complete original wrapper and actual window device helper, clearing both native
wheel counters and the pending browser wheel pulses. An adapter alone does not
open an original process. The ordinary path requires a complete owned Root/Input
graph whose Root has native ID 0 in the caller's namespace; it does not replace an unwritten original query's interface-pointer alias
with a fabricated zero or pointer.

`6B` also retains its original wrapper when an original owner exists. If its
Input receiver leaves the result untouched, that wrapper copies the incoming
ECX scratch word to the VM output. The ordinary path covers registered regions;
it does not model arbitrary native register contents for a missing region.
The typed receiver preserves `NATIVE_UNWRITTEN_WORD`, and the word bridge rejects
it. No zero, Boolean or CCCC result is invented, and native missing-case
equivalence is not claimed.

`5F` passes a literal flags word to the Graph receiver. It uses position
minus base, the raw model size, and signed truncation of base Z to register
the hit area. A move updates the existing rectangle without reordering the
input list. Legacy text uses this geometry with its retained graph.
`scripts/verify-native-plane-input.mjs` compares 201 cases per frozen engine
against the original Graph receiver, including signed and invalid float
conversions, the full-screen expansion, and the untouched outer output word.
Both mounted legacy text tasks move and unregister the region after a fresh
restore while the original World retains its own region.

`scripts/verify-native-input-commands.mjs` checks 388 complete calls and 1,843
comparisons per frozen engine. Its explicitly authored task receiver covers
returned and unwritten Root/input queries, route results, missing/zero targets,
DWORD limits, bitmap prefix identities/aliases, canaries and adjacent argument
reads. Uninitialized stack locals are given an explicit CC input pattern.

The public SDK World test exercises two Tops that reuse the same native task
IDs, a real original bitmap mask, independent mask ownership after image
release, both real device wheel words and untouched neighboring canaries.
Restoring a fresh World preserves the mask and device identity; changes in the
restored World leave the original input and bitmap state independent.

## Ordinary Input on .23, .63 and .67

The own original Top constructors create Input before the Script caller. Actual
Main66 kind11 creates another independently owned Input; Main67 requests retirement
without freeing it immediately. Subsequent calls of each own deleting destructor
free the native Input and its list/name allocations. Those destructor probes are
separate from the retirement call and do not claim a Top collection pass. The
normal World performs collection in its existing object walk, preserves retiring
owners through a checkpoint, and releases them independently after restore.
Window/device and renderer services are borrowed by Input.

All three versions register Main144–148, 151–154, 395 and 396; .23 and .63 also
register Main401, joining the already reviewed .67 entry. These 35 version/entry
pairs use the existing shared implementations. .23 sends Input raw119–124 for
registration through mask changes and raw132–135 for text/autohide. The equivalent
.63/.67 ranges are raw122–127 and raw135–138, with the rectangle query occupying
the unused slot between rectangle and mask setters. Cursor image/query/enable
are .23 raw140/141/142 and .63/.67 raw143/144/145. Shared semantic numbers stay
126–131, 139–142 and 147–149 respectively; Main IDs and Input messages are
recorded separately in the golden fixture.

Duplicate owner registrations remain separate ordered records. Priorities compare
as signed DWORDs; changing the first matching priority removes and appends that
record before sorting. Rectangles are copied from live caller memory, NULL clears
them, and masks preserve every bit. Registration always owns the calling Script,
while Main144's first argument supplies the packet sender. Missing owner updates
and repeated unregister calls preserve the other records. Only initialized native
record fields are compared: the unused scratch word and trailing padding word are opaque.

Text requests copy a CP932 string including its terminator into the existing
256-byte buffer. Pending status is zero, confirmation one, cancellation two;
cancellation retains the initial bytes. Reading text copies through NUL and
preserves destination bytes after it, even while pending. The own worker starts
the modal dialog and its original callback sets a 16-character edit limit with a
256-byte ANSI output capacity. Thread creation/exit and Win32 dialog IO in the
native probes are explicit authored service boundaries. The normal host supplies
`inputText`; a pending request cannot be checkpointed. The request, buffer and
status use the current snapshot contract without another format generation.

Cursor image hotspots use the low unsigned half of each argument. Input's visible
field is separate from the renderer's full visibility word. Autohide preserves
unsigned multiplication/division at the task frame rate and sends its visibility
notification in the current call. Native cursor wrapper probes use an explicit
borrowed renderer service; they do not establish a real device or decoder. The
normal image-provider path owns its decoded image and backup, releases replaced
or rejected image handles, and restores independent pixels in a fresh World.
The mapped CP932 path is admitted; the existing .23 NULL/uninitialized source
protection remains. Six finite own frames cover down/held/up and the final key's
fourth device slot, then verify that unregister stops delivery. The target reply
callback and physical key/window samples are explicit test boundaries.

`tests/native-input-legacy.test.mjs` replays the own records through actual KCS
GCALLs in a normal World, checks complete controls and output bytes, and verifies
frame dispatch, factory retirement/collection, image ownership and independent
cold restore. Main688 and the unproved serializer and physical pointer shapes
remain protected. These Input results do not close the separate rapid-dialogue
performance target.

SDK23 Plane/Base metadata is also checked through a loaded typed Script under
its actual ApplicationRoot. Main89–91 preserve model priority/inheritance;
Main95–99 and 102–110 preserve button rows, explicit Base rectangles, raw
active/source words and callback identities. A parent visibility message sends
raw44 to its children and recomputes button phase from the actual Input active
word. Direct raw43 with inheritance updates Input from the parent's renderer
display and the child's own shown word; without inheritance it updates only the
renderer. Child raw44 instead uses its incoming display word and the child's own
shown word. Both Input message branches require raw67 button-enable state:
raw83-only registration does not set it. Main99 clears twelve button
words while preserving button-enable state. These two policies are explicit to
this build; the other SDK policies retain their independently verified behavior.
Six fresh Worlds resume the same loaded VM across visibility, clear/rebind and
child-before-parent retirement. The normal hint in this proof is an independent
sibling; self/ancestor Plane hints are guarded before changing the retained hint, because
the original hide/broadcast chain recurses for that topology. Other cyclic hint
graphs remain outside this qualification.

This metadata fixture does not deliver a key or qualify application binding
publication. The SDK23 application publisher is statically identified, but it
belongs to the complete WinMain aggregate rather than the smaller Root/View
controller. A real Device row-setter port is a distinct qualification boundary;
passing a normal record to that API cannot be described as executing WinMain.
