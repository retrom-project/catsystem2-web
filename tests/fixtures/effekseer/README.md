# Effekseer fixtures

`public-1.23/` contains eight Effects and eleven dependencies from official
Effekseer 1.23, commit `5239bb1e416cbf55b4d3c8170594cbdc7815f263`.
`public-1.23-manifest.json` identifies every unmodified file by source URL,
SHA-256, size and CC0 license source. The original sample grant is preserved at
`../../../licenses/effekseer-samples-CC0.txt`. The directory is flat because the
observed CatSystem2 texture loader takes each dependency's basename before
applying its `efktex` category. Effect dependency strings retain their original
paths. Wave/model files are included as source fixtures; the observed wrapper
does not install their loaders.

`authored-effect.mjs` writes independent old SKFE parameter cases. Recreate the
nonempty `authored-particles-v9.efk` from the repository root:

```sh
node --input-type=module <<'JS'
import { writeFile } from 'node:fs/promises';
import { authoredEffect } from './tests/fixtures/effekseer/authored-effect.mjs';
await writeFile('tests/fixtures/effekseer/authored-particles-v9.efk',
  authoredEffect({ colorPaths: ['Texture/authored-spark.png'] }));
JS
```

It has a root and one sprite node, three generated particles, nonzero PVA motion
and opaque orange color. `authored-spark.png` is an authored 2×2 RGBA texture with
rows `ff4000ff ff8000ff` and `ffc000ff ffff00ff`. These existing authored effect/texture files use this
project's MPL-2.0 license. These are parser/resource fixtures; their existence
does not establish EFK simulation or drawing support. They are not private game
assets and are excluded from the standalone build.

`numerical-reference.json` and `generation-reference.json` retain exact float32
words, integers and color channels produced from authored inputs by the fixed
official 1.23 algorithms. They are test references from public MIT source, not
private game captures. The reference build used g++ 14.2.0, C++17, `-O0`,
`-ffp-contract=off`, `-fno-fast-math` and `-fno-strict-aliasing`. Numerical
references cover 17 groups; generation references cover 14. Tests label these
as source references and read the retained JSON without a compiler, native
executable or provider. The algorithm attribution is in
`../../../licenses/effekseer-MIT.txt`; authored inputs and expected-value
fixtures use this project's MPL-2.0 license.

`render-state-reference.json` retains eight comparison groups from that fixed
MIT source: initialization/update colors and random counts, the deferred Ribbon
cache, Ring color conversion, Track integer-time evaluation, fade and UV values.
Inputs and expected float32 words are public/authored data, not private game
captures. Ordinary Node tests read the JSON without a compiler or original
executable. These cache references do not establish geometry or pixel output.

`ribbon-track-cases.json` and `ribbon-track-reference.json` retain authored inputs
and 24 exact whole-template comparison groups for the fixed public 1.23 Ribbon
and Track algorithms. Expected positions/UVs are float32 words, colors are bytes,
and source reservations, group ranges and original index order remain explicit.
The reference build uses the retained upstream template bodies with floating
contraction/fast-math disabled. Normal tests read the JSON without C++, original
binaries or local research files. These are CPU source references, not native
geometry or pixel captures; their authored fixture grant is MPL-2.0, and the
algorithm MIT grant remains in the existing license file.

`sprite-ring-cases.json` and `sprite-ring-reference.json` retain authored inputs
and 38 exact whole-template comparison groups for the fixed public 1.23 Sprite
and Ring algorithms. They cover all four billboard modes, Ring single-instance
local/deferred output, bulk world output, partial reservations and the independent
paired-versus-sequential addition cancellation case. Float values are retained
as float32 words. Like the Ribbon/Track reference, these are public-source CPU
outputs read by ordinary Node tests, not private native geometry or GPU pixels.
The test fixtures use MPL-2.0 and translated algorithm code retains the MIT grant.

`matrix44-cases.json` and `matrix44-reference.json` retain six exact float32
Matrix44 products from fixed official1.23 MIT source. Tests read these public
expected words without building C++. Inputs/expected JSON use MPL-2.0; the
algorithm source retains the existing Effekseer MIT attribution.

`gpu-unorm-reference.json` retains independently observed D3DCOLOR vertex
alpha126/127/128 float32 words in the pinned Wine8/llvmpipe profile. These
observations differ from simply rounding byte/255 and calibrate the typed GPU
input. Its calculated comparison-reference bit is labeled separately from
actual shader FP32 output.

`gpu-profile-reference.json` retains seven authored programmable normal shader/
D3D9 API input/output cases as compressed RGBA8. The profile, public shader
source commit, nonempty counts and zero RGBA tolerance are explicit. The data
contains no original EXE/DLL or shader bytecode and requires no Wine or native
compiler to run. The new GPU golden and UNORM input/output data are dedicated
to CC0-1.0. These GPU observations do not establish original manager/geometry
simulation or the original shared batch program.

`mesh-pass.mjs` is a test fixture that composes actual CPU state and geometry
with the independent backend. Its immediate per-node submission is deliberately
not installed as the original renderer; native reserve/flush and persistent
Ring lifetime still require their task-owned integration.

`batch-cases.json` and `batch-source-reference.json` contain 21 authored operation
sequences and outputs from the unmodified fixed 1.23 StandardRenderer template.
The reference backend records byte reservations, fixed ring-lock behavior,
state transitions and requested draw counts; it executes no original binary,
D3D API or GPU. Two unsafe-IB cases retain the source's oversized draw request in
the reference data. JS tests separately assert the explicit unsupported-domain
policy at that draw boundary while preserving known preceding/finally effects.
These public/authored source-reference fixtures use MPL-2.0, require only Node
and JSON during ordinary tests, and retain the existing Effekseer MIT algorithm
attribution. Reference C++/compilers and local research are not test dependencies.
