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

## CG registration and resources

Main419–425 and458/459 construct a CG registration owner, load a normally
mounted CGL resource and register named groups or individual references. The
SDK23 fixture uses two sections with64-byte variant records. Actual contains
queries consume group registrations and the engine's `L_` filename alias rule.
These APIs maintain registration state; they do not render CG images.

The normal CSS writer snapshots the registration before its source is cleared
and released. A new file reader and new CG owner restore it, answer queries,
load the authored list again and register another section. The container can be
disposed before these consumers run. Three independent cold continuations and
an original-file input case preserve the same behavior. The existing gallery
table tests cover a separate API and do not stand in for this manager chain.

## Scene history and display logs

SDK23 Main696–700/785/850/851 run through actual Scene text and history.
Main327 supplies speaker and text bytes to Main698; Main699 reconstructs only
the saved history prefix. The fixture consumes speaker names before and after
block-limit pruning, saves the nonempty log, disposes the original Scene/log/file
owners and continues appending through a new log owner. Three independent cold
continuations and an original-file reader case cover the same consumers.

The SDK23 original format has six DWORDs per display-log block, matching63/67.
The modern builds retain their seven-word layout. The existing shared encoder
and reader now receive the SDK23 layout declaration; no file-version marker or
alternate reader was added. Native entry bytes, four section offsets, rows,
speakers and cursor bases match. The regression's former seven-word output is
retained as evidence of the corrected format mismatch.

This proves the data and CSS chain. It does not claim a rendered backlog UI,
arbitrary line-breaking configurations or extra FES viewport classes. The most
recent accepted SDK23 native product-save payload was inspected without writes:
its two slot files have no optional display-log entry48. That bounded check does
not establish compatibility for other pre-fix development saves containing
nonempty seven-word logs.
