# Native Particle tasks

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
