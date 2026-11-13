# Effekseer GPU submission

The typed normal backend accepts explicit sprite/ribbon/ring/track geometry,
camera/projection/viewport and the current shared D3D semantic state. It draws
through the existing StageRenderer program, target, depth attachment and
texture cache. Typed buffers grow on demand and are reused. It does not create
an Effekseer canvas or move frame images through the CPU.

The default kind61/raw36 path connects its current manager and sole Task-owned
MeshBatch/Ring to the same World StageRenderer through `EffekseerTaskGPU`. The
view borrows the existing GPU, target, depth and texture cache; it creates no
canvas, renderer, device or second CPU state owner.

The normal solid/no-fog profile preserves the original quad order, programmable
alpha and inherited depth/alpha/sampler state. The device scope restores twelve
render states and actual physical bindings; sampler changes retain the original leakage.
`createD3DContext` owns the single `samplerStages` Map; its stage-zero entry
aliases `samplers`. The JS semantic view and transitional Emote adapter read
and write that same authority. Stages are allocated only when written, using
the adapter's existing defaults. A read of an unwritten stage does not create
another state owner. The snapshot stores stage zero only in `samplers` and
other allocated stages only in `samplerStages`. Sampler ownership is separate
from physical capture and actual kind61 submission.

ParticlesGL now owns one VAO for its existing fixed interleaved vertex layout.
Initialization, ordinary/typed/presentation draws, resource validation, shared
generation rebuild and close use that same layout resource. Inherited attribute pointers,
including the default VAO's null pointers, are never rewritten. After selecting
the entry VAO, restore explicitly reinstates its captured ELEMENT binding;
the entry may itself be the backend VAO used by the typed upload. A successful
resource transaction retires a previous VAO that is still valid; context-loss
handles are already invalid. Failed allocation does not publish a new layout.

Its physical binding primitive captures the actual current program, the owned
program's linked uniform values, VAO/ARRAY/ELEMENT bindings, four2D texture and
sampler bindings, active unit, draw/read framebuffer, renderbuffer, viewport,
depth/scissor, blend/stencil/masks and unpack state. The temporary token belongs
to one GPU/device generation; loss, retirement, closure or reconstruction skips
old handles. Completed or failed restoration releases captured resource
references. Captures are not checkpoint data or a parallel device/cache.

The C7 view/scope now delegates to this same physical owner, replacing the
five-string semantic binding interface in place. Scope Begin saves the twelve
D3D values, captures physical state and binds the backend's normal pipeline;
End restores both. A nonready entry is rejected before CPU pass mutation. Only
an active captured-owner/generation proof explaining restorefalse receives the
private device-invalidation brand; completed bytes/cursor/Ring are not rewound.
Known loss/retirement can recover after shared reconstruction, while arbitrary
GL/cleanup failures and aggregates containing an unknown leaf remain permanent
CPU-batch faults. Empty/cyclic/sparse aggregates do not qualify. Physical tokens
and errors are not serialized or retained as new World authorities.

The scope-focused tests use actual JS backend/lifecycle classes with an authored
WebGL API recorder. Those tests establish neither real shader compilation nor
GPU pixels; numeric mixed-frame acceptance must exercise the actual default
FES/Task callback separately. The API state partition follows the [WebGL2 specification](https://registry.khronos.org/webgl/specs/2.0.0/)
and [uniform queries](https://registry.khronos.org/webgl/specs/1.0.3/#5.14.10).

## Default Task callback

Normal FES FILE/play commands retain the existing resource FIFO, default kind61
factory and live executor. The registered D6 range callback draws that Task's
current manager, loaded texture bindings and camera/projection, without another
Play, Update, resource read or RNG sample. Ordinary plane alpha, clip and
transform do not modify the custom callback. Current-FILE NULL and pending-reset
gates still return0; an eligible callback returns1 even with no live instances.

Entry checks require the same World graphics owner, StageRenderer GPU and open
frame before any CPU pass changes. The borrowed view reads the current physical
viewport/depth range and delegates normal-pipeline capture/restore to that GPU.
Fresh Task restore starts without a backend view and rebinds on its first draw;
it restores the existing current manager/resources/camera/Ring without replay.
Task close retires its view while the World retains GPU/resource ownership.

The normal default-FES tests cover current packed vertices, shared target/depth,
entry/loss/fault boundaries and fresh rebinding through an explicit GL recorder.
The screen-effect renderer owns current/previous dirty RECT history. Normal
presentation collects every known enabled D6 callback independently of its
draw priority or the supplied frame subset. Positive queries contribute the
configuration's current screen viewport; an enabled callback also expands
nonempty current damage when its query returns zero. The presentation request
carries the viewport intersection of the previous/current union. Known boolean
47/48 registration changes query under the old flag before assigning the new
one; repeated booleans add no query. FES MOT display uses that same47 producer.
Unknown registration values retain their existing gates.

History retires only after that renderer's presentation operation completes
with an explicit signed32-success HRESULT, including zero. Negative HRESULTs,
unsigned words with the high bit set, throws and paused/inactive frames retain
history. The current checkpoint restores both RECTs in place without replay.
These are callback contribution and data/history side effects: drawing and
presentation still process the complete frame. Partial or empty damage does
not crop or skip ordinary content.

Known D6 message3 unregisters query the old enabled registration before disabling
and erasing it. Real FES SIZE/delete use this path while the old Task and FILE
remain open; physical disposal follows in logic without another query. SIZE's
empty replacement does not erase the old callback's damage. The existing
checkpoint also retains this settled pending-destruction state and its dirty
history, restoring the erased graph without registering or replaying it.
Unknown flags acquire no query or implicit enable value during removal.

Ordinary old/new model bounds/cache, ordinary unregister, direct Task/World
close, other model replacement damage and complete native rectangle clipping remain partial.
Full Task geometry/device pixel acceptance and final frame-rate/memory goals
also remain outside that recorder evidence.

Unknown fog-enabled or non-solid inherited branches report an explicit error.
The current2000-quad packet guard is an upload boundary, not a proof that the
original shared batch splits or clamps at2000. Byte reserve/flush and the
persistent Ring cache use the owning Task MeshBatch; complete default-Task
geometry/device and legal2000-particle acceptance remain separate requirements.

The fixed source is official Effekseer1.23,
5239bb1e416cbf55b4d3c8170594cbdc7815f263, under the retained MIT grant in
licenses/effekseer-MIT.txt. Typed packing, shared-owner interfaces and renderer
integration are authored JS. The old normal shaders' vertex/fragment algorithms
are ported in readable GLSL; no original EXE/DLL or shader bytecode is required
to run the backend or its tests.

Node tests separate official-template Matrix44 geometry expectations, observed
D3DCOLOR float32 normalization, shared-device call records and real mounted
resource/CPU composition. They read public expected JSON and require no C++
compiler, Wine, native executable or ignored research files.

The minimal public WebGL golden contains seven authored shader/API cases:
textured alpha127 and independent untextured vertex126/127/128 with test-off
and GREATER127. Its exact RGBA comparison profile is pinned Wine8/llvmpipe and
Chromium148/ANGLE SwiftShader. The vertex values use the observed float32
reciprocal conversion; EFK compares float alpha against float32(ref/255).
Ordinary PPI retains its existing integer alpha contract.

The golden input/output data is dedicated to CC0-1.0. Matrix44 algorithm
expectations retain the Effekseer MIT source attribution. GPU profile results
do not establish original manager/geometry simulation or original batch
execution, and they do not replace full kind61 task/World restore checks.
