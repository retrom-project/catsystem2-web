# JavaScript M2 native family

[`emote.mjs`](../src/native/emote.mjs) registers task 54, FES type 33 and the
reviewed game IDs 906–933, 965–966, 1025, 1027–1030 and 1047–1048.
[`emote-commands.mjs`](../src/native/emote-commands.mjs) translates VM words,
float values, ordered CP932 dictionaries, strings, writebacks and return/control
codes into [`M2Task`](../src/native/emote-task.mjs) messages.
[`M2Owner`](../src/native/emote-owner.mjs) owns immutable documents and settings;
[`emote-fes.mjs`](../src/native/emote-fes.mjs) drives JS M2PLANE motion and commands.
No wrapper calls an original EXE handler or DLL export.

External DIF chains, persistent DEFVAL pins, action queues, automatic blink,
sound-clock lip, inertia and spline controllers feed the PSB animation and
geometry API. Common task messages preserve float32 position/scale/angle,
packed color/tone/depth, display and pause state. Settings XML has the captured
UTF-8/CRLF shape and original key order. Touch queries select the DIF color-table
key and table index; they do not approximate this lookup as geometric picking.

The original FES command functions for m2eff/m2att/m2fspeed/m2prmscale/m2iner,
m2enable_blink/lip, m2splay and m2draw are no-ops in this ABI. The JS driver
preserves them. Active load/body/color and m2enable_eff paths use task messages.
Message545 is an unsigned fade-duration request; message535 affects only the
non-PSB image fallback, not PSB textures. Image-only M2 inputs are explicitly
unsupported by this PSB implementation. The SDK task is a SimplePlane placeholder; its reserved table entries remain
reserved. Existing oracle fixtures and [M2 evidence](emote-js.md) define the
observed behavior, including busy timing and retained output after Skip.
