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
