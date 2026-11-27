# Native Plane and Input commands

## Fixed SDK 2.6.1.23 divided model

Main 467 takes a reviewed kind2 Plane, a VM pointer and a positive record count.
Each 64-byte source record contains a texture selector followed by five columns
of three floats. The wrapper allocates 80 bytes per output record, adds its
ordinal and interleaves the three vertices. It does not initialize their color
words. The normal model loader makes two private copies and enables a uniform
white override before drawing; the ignored color words are not promoted to
numeric observations.

Raw 78 maps to canonical 83 only for this receiver/build. A fresh model registers
under the Plane's native ID. Loading again while that key is occupied still
constructs and decodes the new candidate, then rejects registration and destroys
the candidate while keeping the old model and its data. Main 83 explicitly
unloads the old model and allows a later Main 467 to succeed. Destroying the
Plane removes its model before the parent Script's later task retirement.

The same mode1 construction reads ordinary `config/startup.xml` TEXTURE size,
grid, allocation areas and format settings before creating its texture provider.
A configured two-page fixture uploads distinct RGBA content, releases the Script
bitmap owners and observes each mesh selector bound to its retained 8×8 COM
texture. Main 541 releases pages intersecting a pixel rectangle; Main 542
allocates missing configured pages. Re-uploading a released page changes the
existing model's next texture while preserving the other page. Original provider
lookup uses an unsigned index bound and tests missing entries. Those cases bind
no texture, using the same white fallback observed with the default empty grid.
There is no special global ID-zero rule.

`tests/native-sdk23-view-mesh.test.mjs` checks real GCALL stack/control, private
copy isolation, occupied-key rejection, explicit unload/reload, renderer geometry,
complete texture bytes and alpha, page and bitmap retirement, Plane destruction
and five independent cold continuations. Original packets come from complete
mode1 constructors and the actual Top/view rendering path into generic COM memory
leaves. The retained receipts also use explicit CRT/allocation and file-service
instruction redirects while keeping target function bodies and PE text bytes
unchanged. They establish the observed target state and submitted content; they do
not establish original allocator, archive mount or stream ownership end to end,
nor physical GPU/shader sampling or presentation. Nonfinite vertex inputs, nonpositive record counts, other typed
receivers, unreviewed existing model classes and inactive/device-less views remain
protected. This does not enable Main 467 in another SDK.

### Original resource-host qualification

A later bounded SDK23 group supplements the older dependency ports with the
original CRT, allocator, FileServer, Settings, Window, mode1 View and typed
Top/Script constructors. Settings records are mounted through the real archive
API; Main 66/209/143 produces the loaded Script VM. Instruction observers never
replace private functions, and both the redirect count and PE text comparison are
checked. The group covers HG3 load/decode, Draw storage, representative Text and
Fade calls, View near, Plane unload/reload and ordinary Task/Script/platform
destruction. It does not requalify every old format, font or rendering shape.

Bitmap ownership has three separate roles. The creator's 0x114-byte wrapper
keeps its own reference count at `+272`. Draw creates a different source wrapper
and retains the same 0x58-byte bitmap object through that object's `+80` count.
Main 114 frees the creator wrapper while that bitmap remains live; removing the
last Draw entry releases the shared bitmap and Draw source wrapper. The renderer
output has a separate bitmap and owner. JavaScript already models this with
distinct bitmap handles sharing a data handle, and releases the data after its
last alias. The Draw entry test checks those identities and release points in
addition to pixels and cold continuation; no product ownership change is needed.

The accepted native group executed 24 target calls, 19 semantic support calls
and 43 carrier yields: **86 actual GCALLs**. Carriers were omitted from its
original 52-call budget, a 34-call overrun recorded with the private receipts.
Future groups budget factories, support, carriers and cleanup together. Older
raw receipts remain unchanged and retain their original dependency qualification.
Unwritten allocation fields are not made defined by observing fresh heap zeros;
GDI and COM memory leaves still provide no physical GPU or font-rendering proof.

## SDK 2.6.1.74 Plane and Input commands

The table below describes the fixed SDK executable and its ordinary GCALL
surface. The raw message IDs are from the original Plane and BasePlane
receivers. Logical World message IDs share the base offset defined in the ABI.

|   Main | Raw message | Outcome                                                                                              |
| -----: | ----------: | ---------------------------------------------------------------------------------------------------- |
|     80 |          43 | Release the current Graph. Mode 1 can create an empty renderer Graph.                                |
|     83 |          66 | Release the Graph and clear both size fields. Remove the input registration if it tracked the Graph. |
| 86, 87 |      59, 60 | Write the selected model or texture pose through two or three VM output pointers.                    |
|     89 |          59 | Return the model base depth as a float word.                                                         |
|     91 |          52 | Stop inheriting the parent pose.                                                                     |
|     94 |          61 | Clamp signed alpha to 0–255 and combine it with the current Graph RGB.                               |
|     96 |          70 | Copy four button states and attach the Input region to the model geometry.                           |
|     97 |          71 | Select the texture pose by the low halfword and update the independent blocked bit.                  |
|     98 |          72 | Return the active phase with bit 31 set when blocked.                                                |
|     99 |          88 | Clear the registered Input receiver.                                                                 |
|    102 |          75 | Store the frame selector and send raw 45 to the selected target.                                     |
|    103 |          76 | Store the complete frame attribute word.                                                             |
|    109 |          93 | Query the Root's Input owner and return its source word.                                             |
|    110 |          94 | Store the raw Input receiver word.                                                                   |

The original pose wrappers use flags 1 and copy raw float words. Zero
targets skip the pose outputs. With a nonzero target, ordinary World requires
an initialized reply and valid output spans before writing to the caller.
Aliased pointers receive successive components. The original empty-Graph and
alpha paths require an available renderer owner. A Plane without a Graph
leaves its alpha state unset. The Input query uses raw 134, which converts
source 16 to 2 and copies all other values. It returns zero on a routing miss.

The button initializer copies 48 VM bytes and retains any existing Input
registration. It derives a new rectangle from the model pose and virtual
viewport. A selection changes the texture pose while retaining its depth.
Hover and key events use the same four states. The linked hint uses the
Input rectangle and its own rendered size. An absent model can leave
registration geometry unwritten, so World requires an attached model when
creating a region. A nonzero button-state target must reply with a word.

The original wrappers and both receiver types were exercised with a live
task registry fixture and sampled renderer boundaries. Ordinary production
KCS tests use Plane and BasePlane objects, the native variable and result
buffers, and the Input owner through the World. See
[the VM tests](../tests/native-engine74-plane.test.mjs).

## Prepared 2.6.1.76 Plane button receivers

The prepared executable uses raw 72, 73 and 74 for Main 96–98. Its own
BasePlane registration sends raw 126 to Input with the model bounds. Its
button states use the same separate texture transform and linked hint as
the fixed SDK. Raw 68 drops Input when the Plane tracks its Graph. Raw 77
stores and hides the hint by sending raw 47. Raw 78 stores its enable word.
The original wrapper, Plane and BasePlane were exercised separately with
sampled renderer and explicit Input recipient boundaries.

## SDK63 and SDK67 parent inheritance

Own Main66 factories create the published Top and both parent/child Plane owners.
Main79 constructs their separate solid models before Main89 reads the actual
base Z word with control1. Main90 copies three offsets and immediately inherits
parent base minus X/Y offsets, base Z plus Z offset, and parent position. Later
parent position/priority messages propagate while inheritance is enabled.
Main91 stops inheritance and retains the last pose. Both setters return control2
without writing a result. Explicit target zero follows each original early return.

The two own PE protocols each cover 16 target GCALLs, 26 bootstrap/dependency
GCALLs, five actual Top logic/draw pairs and normal child/model retirement.
The current KCS/World replay includes eight independent cold continuations per
build. Missing models, unresolved output words, non-finite inherited coordinates
and unreviewed receiver kinds remain protected at consumption. The configured
View and COM-memory host qualify ownership and messages, without physical GPU
or presentation claims. Other builds keep their existing policies.

## SDK63 and SDK67 button tables and Input lifetime

The normal primary zero-ID Root owns the independently routable Input task.
Main66 Plane/Hint factories and Main79 models supply real geometry before
Main96 registers its Input rectangle and copies twelve caller words. State
selection uses selector1 position, retains Z, ignores disabled rows, narrows the
selector to sixteen bits and stores the independent blocked high bit. Main98
returns that phase/high-bit pair. Main102 hides its typed hint, Main103 retains
the hint attribute, and Main110 stores the callback recipient ID word.

Main99 clears all twelve button words before normal Input unregistration. It
retains phase, button-enabled state, flags and model; a later Main96 registers
current bounds and copies a new independent table. Current snapshots own that
table and require twelve DWORDs plus the initialized enable state. Each build
has eight independent cold continuations of the actual KCS/World consumer.

The original nested-Top protocol had an Input child with native ID0, so the
fixed target0 Root query did not write its reply. Its empty Input list and hint
coordinates are not qualified successful behavior. Registration in that
unreviewed namespace is guarded at the unresolved reply consumption; ignoring
or clearing an absent registration does not need that reply. Input record
word10 was also unwritten by the native registration path and remains outside
the functional comparison. No physical mouse, View presentation or GPU claim
is made by this resource protocol.

## SDK63 and SDK67 real Root hover consumers

Main95 sends raw85 to an owned Plane with live graph geometry. It registers only
an absent Input region, but always enables button metadata and writes the flag
word. Calling it again on a disabled region preserves that region's identity
and disabled state while updating the Plane flags. This policy is explicit for
these two executable builds.

The original primary Root/Input Frame selects the highest-priority enabled
region. A blocked Plane retains the Input active flag while declining its hover
notification. Clearing and re-registering a region uses its new priority;
disabling it clears active. Main106 writes active, Main107 reads that owned word,
Main108 stores the next reply word, and Main109 returns the observed source0.
The independent Main66/Main143 Script waiter executes its actual KCS program,
records the two written hover packets and receives normal retirement. Each build
has eight independent current-checkpoint continuations of this caller chain.

The native host parses KEYCUSTOMIZE but does not execute the Application's
logical Device binding-row publisher. Its WndProc down/up delivery therefore
does not prove logical key callbacks, the key callback's return-word consumption
or physical input. Those shapes remain open. The Input constructor's word at
`+4928` is drag threshold2, not source; the proposed default-source change was
withdrawn before implementation. Main69 sends a four-word user message even
when its tag has the numeric value of an Engine stop. The original driver was
instead stopped by its own raw156/157 dispatcher message, with both enabled and
VM mode observed. This corrects the earlier P2 receipt wording without changing
Main69 behavior or its original logs. COM-memory attachment and virtual Win32
leaves do not establish View presentation, physical HID or GPU output.
