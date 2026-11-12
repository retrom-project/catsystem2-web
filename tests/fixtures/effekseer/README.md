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
rows `ff4000ff ff8000ff` and `ffc000ff ffff00ff`. All authored files use this
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
