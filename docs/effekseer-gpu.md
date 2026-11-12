# Independent Effekseer GPU backend

The typed normal backend accepts explicit sprite/ribbon/ring/track geometry,
camera/projection/viewport and the current shared D3D semantic state. It draws
through the existing StageRenderer program, target, depth attachment and
texture cache. Typed buffers grow on demand and are reused. It does not create
an Effekseer canvas or move frame images through the CPU.

This backend does not yet install kind61, raw36, a task manager or a World CRT
owner. EFK language execution remains unsupported until those actual task/
device/thread/lifecycle paths are implemented and checked together.

The normal solid/no-fog profile preserves the original quad order, programmable
alpha and inherited depth/alpha/sampler state. The device scope restores twelve
render states and five bindings; sampler changes retain the original leakage.
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
