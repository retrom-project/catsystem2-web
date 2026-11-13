# Independent Effekseer GPU backend

The typed normal backend accepts explicit sprite/ribbon/ring/track geometry,
camera/projection/viewport and the current shared D3D semantic state. It draws
through the existing StageRenderer program, target, depth attachment and
texture cache. Typed buffers grow on demand and are reused. It does not create
an Effekseer canvas or move frame images through the CPU.

The default kind61/raw36 CPU path now owns its task manager and World CRT
binding, but its callback still reports an unsupported GPU adapter. This
independent backend is not yet connected to that actual submission path;
callback pixels and complete Task/device lifecycle remain GPU integration work.

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

This interface/lifecycle leaf does not connect default kind61 submission. Its focused tests use
actual JS backend/lifecycle classes with an authored WebGL API recorder; they
establish neither real shader compilation nor GPU pixels. Real WebGL numeric
and mixed-state acceptance belongs to the later task/backend connection. The
API state partition follows the [WebGL2 specification](https://registry.khronos.org/webgl/specs/2.0.0/)
and [uniform queries](https://registry.khronos.org/webgl/specs/1.0.3/#5.14.10).

Unknown fog-enabled or non-solid inherited branches report an explicit error.
The current2000-quad packet guard is an upload boundary, not a proof that the
original shared batch splits or clamps at2000. Its byte reserve/flush and
persistent Ring cache are separate task-renderer integration work.

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
