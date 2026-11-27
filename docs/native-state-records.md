# Script-visible state records

SDK23 Main863–868 expose a fixed-record LIFO owner. Push copies one mapped VM
record, pop copies the last live record and decreases count, and copy replaces
the destination layout and every capacity byte. Popped bytes remain in inactive
storage. Explicit release is independent of Script lifetime.

The loaded-VM fixture in [sdk23-data-records.test.mjs](../tests/sdk23-data-records.test.mjs)
fills both capacity records before comparing them. It copies into an owner with
a different record layout, releases the source, consumes the remaining LIFO
record, writes popped records into CSS and reconstructs the destination through
a new file reader. Main390's cloned container survives source remove/clear and
release. Main389 returns control1 and its success word is consumed explicitly;
Main469 returns control2. Four independent cold continuations preserve live and
inactive record bytes. Original CSS writer bytes also feed the current VM reader.

The original producer uses intact Main bodies, a real loaded typed Script and
the qualified CRT, FileServer and ApplicationRoot. Its Windows OS file port is
controlled memory storage. These data-owner results do not establish physical
disk or platform GAME_SAVE acceptance, arbitrary stack capacity limits, or
defined values for uninitialized CSS capacity tails.
