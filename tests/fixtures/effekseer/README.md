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
