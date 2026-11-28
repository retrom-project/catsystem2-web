# Tiled SimplePlane

Main `1B1` takes five KCS words in order. They are the native target ID,
tile width and height as float bits, and column and row counts as signed
words. It returns control 2. A zero target returns before reading the
remaining arguments or looking up a receiver.

| Fixed profile           | Main handler | Raw message |
| ----------------------- | ------------ | ----------- |
| NEKOPARA Vol.3 2.6.1.76 | 0x6405E0     | 46          |
| SDK 4.01 2.6.1.74       | 0x512CC0     | 44          |

The original handler sends a 40-byte packet. It clears words 0–2, writes the
dimensions to words 3–4 and the counts to words 8–9, and leaves words 5–7 as
they were on the guest stack. The adapter executes that handler and keeps
its live packet address through the task transport in the caller's Top
namespace. The original SimplePlane receiver stores the full packet and
forwards its first eight words to the child models.

The receiver builds a custom parent model and creates one textured
SimplePlane per tile in row-major order. Each child inherits the parent's
position and applies its grid offset to the model base. A nonpositive row
or column count leaves the model with no tiles from that call. A Draw task's
base plane can receive the command. Sending it to the Draw task itself
follows the ordinary task route.

`scripts/verify-native-tile-plane-command.mjs` compares the complete
wrappers against a transport probe. Each fixed PE passes 7,441 comparisons
across 600 paired calls. The comparisons cover exact float bits, signed
count words, adjacent arguments, guest stack contents, message envelopes
and result canaries. The zero-target reference points to a single readable
argument immediately before unmapped memory.

`playwright.image.config.mjs` includes the two fixed-profile browser tests.
An authored KCS script targets a Draw task's SimplePlane, which creates four
original child tasks and textures. The tests compare the source tile colors
at all 48 grid pixels, then compare the full frame and original task and
model identities in a fresh World. Destroying the original Draw task
releases its child models and leaves the fresh World's frame intact.

## Ordinary JavaScript owner

Both already registered fixed profiles use a normal typed producer when no
explicit original engine owns the World. Target0 returns before other argument
or host reads. The producer sends canonical46 with the actual caller World ID,
normal native-target routing, w0/flags0/control2 and no VM result. The original
`NativeTilePlaneCommand` class and its physical stack-byte oracle remain intact
for an explicitly owned original engine; an adapter alone does not select it.

The normal packet marks only words5/6/7 explicitly unwritten. Canonical46 reads
known finite geometry and signed counts, then forwards that definedness to
child41. Ordinary mode1 consumes only the independently proved first five
geometry words. Parent ten-word and child eight-word retained fields keep
`undefined` in the current DTO, style copies and production checkpoint codec;
there is no additional packet reader or snapshot format. Unknown semantic
geometry/count words and raw access to unknown packet bytes reject rather than
becoming zero. Existing all-numeric packet callers retain their known values.

This finite owner covers ordinary mode1 models. Other backend factories and
malformed geometry remain unsupported. Node tests exercise actual GCALL through
a real Draw-owned base plane, row-major children, VM/transport/lifecycle and
settled cold DTO equality without command or RNG replay. Physical GPU pixel
acceptance is recorded separately; these Node assertions do not establish it.

## Modern file-model replacement bridge

The exact 74/ee6-76 normal factory Script/Root/View context now also covers a
file-backed KX2 parent followed by Main433. This removes the primary model,
registers the empty parent hidden and appends textured children in row-major
order. A repeated call retains earlier children and appends the new group;
old shown children remain shown while the new group waits for the normal
parent display notification. Parent retirement then releases the complete
subtree. The source/UV packet still retains its unwritten words.

The paired fixture compares actual 64×64 COM-memory submitted vertices and
8×8 texture RGBA, with two independent cold continuations per build. Parent
empty-model bounds remain guarded; they are not inferred to be zero. A tiled
parent is also outside the reviewed trail clone-constructor shapes and keeps
a qualification guard rather than cloning its empty primary geometry. This is the ordinary
Main433 business route, independent of the stopped Tile address flow, and
is not a physical GPU or PFB acceptance claim. See
`tests/fixtures/native-modern-plane-tiles.json`.
