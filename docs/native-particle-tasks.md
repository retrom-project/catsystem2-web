# Native Particle tasks

The fixed SDK23 native graph port separates script activity, the renderer's
enabled flag and its callback binding. Load creates a disabled model. Start
binds the callback and restarts relative time without resetting the quad,
backup, visibility or vector buffers, or immediately changing retained frame
words. The first subsequent idle enables the model. Script `exit` stops updates
while the already enabled model continues drawing; explicit stop disables it.
An active load replaces the model and retains script activity, but requires
another start to bind the new model's callback. The current checkpoint stores
that binding independently of the idle enable flag. These policies apply only
to the qualified SDK23 build; other profiles retain their existing defaults.

The loaded interpreter inherits its actual task FPS. A normal application
initializer argument of 30 gives `GetFps=30` and `CalcFrame(123)=61`. The original
host argument and matching SCREEN setting are recorded separately; the test
helper does not establish that its caller reads that setting for the argument.
The runtime follows the existing configured task clock and changes no pacer
or ordinary Frame semantics.

The lifecycle fixture covers real v2 quad transforms, whole-bank backup/reset,
mapped graph attachment consumed in geometry, UV coordinates, visibility,
alpha, stop/restart and an active rebind to v1. It compares complete projected
triangles and asymmetric HG3 atlas RGBA through normal Root/View submission.
A separate v1 exit/draw case completes normally. Eight independent v2 cold
points and one v1 cold point preserve these states. Present uses the qualified
COM memory port, so this is not physical GPU sampling evidence. The original
first Present observer identity error and the later incorrect expectation of
draw immediately after rebind remain sealed; the latter run completed all
native stages and normal cleanup before its author assertion failed.

The fixed SDK23 build has an independently loaded Particle v1/v2 table bridge.
Actual Main66 kind16 owners load an asymmetric 4×4 HG3 atlas through Main271,
then execute seventeen finite native calls for each of two particles through
the original VM and its header-selected table. Arguments, written results and
control 1/2/4 replies agree, including completion of the second particle after
the first executes `exit`. Normal register replacement copies all 32 words;
stop, retirement and six independent current cold points per table preserve
the initialized buffers and current owner. The device port is re-created as a
host capability before restoring a World; it is not serialized task state.

Together with the subsequent finite scalar and v1 geometry bridges, all 44 v1
and 51 v2 entries now have a bounded functional receipt. The 93 non-logger
entries have actual loaded-table arguments, return controls and written-result
captures in this batch. The two logger entries reuse their separate original
formatter/CRT/VM evidence; their receivers read no task fields. The 22 exact
Main-body groups covering 44 aliases retain their original body proofs, with
the per-table caller bridges checked independently. Registered status alone
is not the acceptance criterion.

This covers normal count2 banks, sized HG3 atlases, finite operands and live
mapped owners. It does not establish arbitrary image formats, every count or
float domain, missing/uninitialized atlas fields, stale attachment models,
plug-in/PPI loading or later external extra-name consumers. Those shapes keep
their existing guards or separately qualified behavior. No native GAME_SAVE
word or platform save layout changes in this group.

SDK23 idle copies its current relative frame into the retained previous-frame
field after the particle loop. Its explicit profile policy performs that copy
even without the modern RefBuffer backend. The interpreter still observes
`0xffffffff` during the first invocation. The current unstarted `hasFrame=false`
state uses an interpreter sentinel; it is not a numeric comparison to the
original task's pre-update raw zero. Standalone `update()` and other profiles'
completion policies keep their existing behavior. This normal initialized
bridge does not establish physical GPU output, allocation-failure behavior or
every operand domain for the two tables.

## Fixed SDK 2.6.1.23 external script loader

Main 669 is a distinct six-word wrapper for the actual kind16 Particle receiver.
It formats the PTCL and image names, copies the count to packet `+260`, leaves
priority `+264` zero and copies the 32 register words from argument4 to `+268`.
Each eight-word copy uses a direct DWORD for its first word and x87 for the other
seven. Argument5 is a formatted, owned extra name at `+400`; `+396` enables
external drawing. The wrapper writes one and returns control1 even when the
reviewed Base receiver leaves its reply unwritten.

The actual Particle receiver copies the complete 0x290-byte packet before loading
its script. External mode skips its own texture and graph allocations. The true
original CRT/FileServer/Window/View/Script chain covers two ordinary KCS2 loads,
register replacement, idle/start/stop queries and ordinary destruction. Current
World VM tests also check the copied metadata, two independent cold continuations
and final bank release. The extra name is retained in the current checkpoint as
packet metadata; later consumers of that name have not been admitted. Other SDKs
and receiver kinds retain their guards. Names without a terminator within the
owned 256-byte span remain protected. This group makes no native drawing or
physical GPU claim.

## Modern receiver messages

The measured 2.6.1.74 and 2.6.1.76 receivers share eight operations. `sendEngine`
uses the semantic number below; `sendNativeEngine` uses the build's raw number.
The FES Particle driver sends semantic numbers, while Main wrappers send raw
numbers. The receiver translates a raw number once.

| Operation        | Semantic | .74 raw | .76 raw | Main                       |
| ---------------- | -------: | ------: | ------: | -------------------------- |
| Load packet      |      314 |     309 |     314 | 271 (script), 693 (plugin) |
| Start            |      315 |     310 |     315 | 272                        |
| Stop             |      316 |     311 |     316 | 273                        |
| Release bank     |      317 |     312 |     317 | Message operation          |
| Busy             |      318 |     313 |     318 | 274                        |
| Set 32 registers |      319 |     314 |     319 | 275                        |
| Alpha            |      320 |     315 |     320 | 426                        |
| Attachment       |      321 |     316 |     321 | 427                        |

The script message group is paired with each build's actual receiver, original
file manager, mounted reader, file object, KCS loader, zlib and seven buffers.
The Main tests execute actual KCS wrappers with mapped short frames and ignored
tails. Main load returns one even when the named script is absent. Busy writes
the active word; void receiver operations leave the output word untouched.
The original Main sender in this bounded capture is a constructed BaseTask;
the current World tests additionally exercise a Script caller and FES producers.
These are distinct evidence scopes.

A packet contains resolved literal filenames. Script loading reads that filename
once through the mounted reader, before texture allocation. Forward slashes
select a mount namespace; backslashes remain a Windows physical path. Unknown
mounts and missing files take the missing-script branch. Invalid KCS and other
provider failures retain their diagnostics. The internal `@cat` authoring
fixture marker is resolved at its existing lower-level boundary.

A loaded instance owns the 32 register words. `bank.registers` reads that same
array; a checkpoint stores it in the instance. After release, the task retains
a copy until its next load. Initial family and registers remain `null`: the own
Main66 factory requests nonzeroing allocation, its constructor leaves those
fields unwritten, and its post-construction setters do not initialize them.
Starting before any load therefore requires a diagnostic. A known script can
be started after release without recreating its bank, matching the original.
Register messages preserve the modern receiver's raw float words, including
signaling NaNs, through self-copy and cold restore.

The loaded bank also owns texture dimensions, stored priority and near depth.
Release or a failed script reload transfers these four fields into the task; a
new successful bank takes ownership again. An empty texture after a sized image
retains its dimensions and stored priority while applying the requested near
depth. External draw after a sized image also retains its previous near depth.
An empty texture or external-draw request before a sized image has no initialized
size or stored priority. A zero-count bank can load, start, accept controls and
restore while these fields remain nullable. The original initializer first
consumes width and height for a nonzero particle count; that operation requires
initialized dimensions. Projection-bounds queries separately require the
stored priority. External draw before any image also leaves near depth unknown.
Release retains each known or unknown field separately, so a partial state
cannot supply invented zero values to a later bank.

FES converts signed 32-bit priority to a finite single-precision value. Main and
raw packets carry float words; nonfinite words currently retain the loader's
diagnostic before atlas fields are written and remain an unproved input shape.
Task restore accepts each unknown field as `null` and each known field as a
finite number, matching the currently admitted native packet paths.

Modern script banks allocate reference buffers in the original order, with a
four-byte reference header and DWORD request arithmetic. A recognized storage
allocation failure leaves that owner absent and retains the other allocations,
KCS and atlas. Initialization proceeds only when all seven data buffers exist;
an uninitialized buffer retains no invented zero contents. Position and quad
stores establish only their written byte ranges. Copying a saved quad buffer
propagates its known ranges, so a later read of a fully written quad succeeds
even when another buffer was never allocated. Missing or unwritten data is
diagnosed when an operation consumes it. Programming and decoder errors keep
their diagnostics.
The [RefBuffer golden](../tests/fixtures/modern-particle-ref-buffer-golden.json)
links both own v2 KCS-installed receiver/VM captures and their exact request
and write/read inputs. Captured reads of unwritten A5 data are interception
evidence and are excluded from functional data comparisons.

The JS checkpoint stores each nullable buffer and its known ranges once. Cold
restore rebinds those saved owners without retrying their allocation outcomes;
release frees every successful owner. The original large-count request captures
and current controlled-failure KCS tests allocate no large particle arrays.
The two auxiliary buffers belong to task idle and draw. After running the KCS
particle loop, idle stores its current frame as the previous frame, writes depth
and index pairs, and sorts pointers to those pairs. Draw consumes that stored
order. An absent depth buffer skips sorting after KCS; an absent index buffer
is diagnosed at its first write, preserving the completed KCS and first pair.
External draw skips the auxiliary buffers. Hidden particles read visibility
before vectors or quads; alpha zero returns before sorting or data reads in draw.
Idle still sorts while alpha is zero.

Checkpoints store known sorting references as offsets into the sole depth-pair
owner. Cold restore rebinds those references to the restored allocation. Unknown
pointer bytes stay unknown and are never interpreted as saved addresses. The
[idle golden](../tests/fixtures/modern-particle-ref-buffer-idle-golden.json)
links actual task idle, complete KCS locals, initialized buffers, small partial
allocation failures, draw commands and the live view dimensions from each PE.
The native pointer-store failures are protected-consumer evidence; writable low
page prototypes do not establish a successful native result. Request order is
independent of owner-field address order: bases allocate before positions even
though the positions field has the lower address.

Successful large resident capacity and additional overflow consumers remain
separate validation scope. Older builds retain their existing allocation
behavior until their own differences are proved. Native D3D SetTexture keeps
one device-bound texture reference after task release; the OS provider's final
cleanup is recorded separately from native task destruction.

Attachment assignment accepts a missing group. Resolution occurs when its KCS
query needs the current graph; deleted or absent groups then produce the proved
zero result. The task retains no parallel graph-position cache.

The tracked [message golden](../tests/fixtures/modern-particle-message-golden.json)
links own original receipts and separates original-uninitialized interception
cases from functional comparisons. The original resources are authored minimum
inputs. Missing nonempty textures exercise the defined 256-pixel fallback and
original registration cleanup.
The [texture resource golden](../tests/fixtures/modern-particle-texture-golden.json)
adds actual own view, display-capability, renderer and device initialization,
HG3 decode/upload, original KCS and seven buffers through load, start, missing
script, release, reload and destruction. It runs the own CRT CPUID and D3DX
initializer with selector two and verifies original executable code bytes before
and after execution. The Win32 and D3D9 interfaces are explicit virtual OS
providers; this is separate from a physical Windows GPU or full application
startup. Narrow CP932 Japanese filenames, zero/one particle counts, transparent
RGB and texture padding have current World and independent cold counterparts.
The original retains a 60-byte graph record for each registered load; an
external-draw reload does not register another graph. The provider's
texture-interface table is recorded separately; current surface owners are
released on task destruction.

Plugin resource shapes, large count allocation/overflow/failure, cache-worker
behavior and wider SDK/message/layout coverage remain open. First empty
texture interception evidence applies to operations consuming unwritten fields.
Zero-count load/start and definitely sized empty reloads have defined paired
behavior. Neither this group nor the
auxiliary-table census establishes complete SDK or product acceptance.

Modern `.74`/`.76` script tasks have a separate native graph-port enable bit.
Loading creates a disabled entry; start registers the draw callback without
enabling it. The first active idle enables the entry before running KCS and
writing/sorting its auxiliary buffers. Stop disables it, and release deletes it.
Starting an already enabled task retains the bit, while stop/start and reload
remain disabled until idle. This state cannot be derived from `active` or
`hasFrame`: a repeated start resets the particle clock but retains an enabled
port. Each build has an own twelve-stage real port/aux-write protocol control.

The current bank owns this one `nativeDrawEnabled` value. Default collection,
GPU drawBank and previously collected Canvas items follow it. A FES parent can
start a child after that child's logic phase; the child then waits for its first
idle before contributing a default draw item. Direct unqualified buffer
consumers still diagnose unknown indices. In particular, enabling a task whose
depth allocation failed does not manufacture sorting data or hide its later
uninitialized-index error.

The internal checkpoint stores the port bit directly and requires it on restore
for these native script banks. Cold restore retains disabled/enabled states
without inferring them from buffers or clocks. This is the current development
contract; native GAME_SAVE layout is unchanged. Other SDK builds retain their
existing policy until independently proved.
