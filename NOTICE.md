# Notices

This project is distributed under the Mozilla Public License 2.0; see LICENSE.
Its format parsers, VM, script execution and E-mote implementation adapt
[CatSystemKit](https://github.com/OWCramer/CatSystemKit), by OWCramer, at
`02873f0becbdab5fd992cd9f3dcd50edd3937d78`. The browser platform, file access,
WebGL backend, audio, persistence and standalone host are implemented here.
Modified and derived files remain under MPL-2.0 with source available in this repository.

Phase 9 evaluates algorithms in `cpp/plugins/motionplayer` from
[kirikiroid2-web](https://github.com/fenghengzhi/kirikiroid2-web), source commit
`3840e3d86cab38217a193abaaea2c404e1bc71dc`. No code from that implementation
is included by the 9.0 evaluation. The supplied repository's actual LICENSE
contains a Japanese three-clause BSD-style grant and bundled-library notices;
its README's MIT label does not replace those terms. A code translation must
retain the original applicable grant and attribution. The assessed scope and
source digests are recorded in `docs/b-phase9-motionplayer.md`.

The phase-9 JS controller, graph, spring, timeline, wind, layer and mesh modules translate
parts of that motionplayer implementation, with CatSystem2-specific behavior
established through the local original-DLL oracle. Those source files retain
BSD-3-Clause notices; the applicable original Japanese grant and contributor
attribution accompany them in `licenses/motionplayer.txt`. Their presence does
not incorporate KiriKiri's TJS host, native binaries or game assets.

KIF and HG-2/HG-3 format algorithms follow CatSystemKit and
[GARbro](https://github.com/morkt/GARbro), by morkt, under the MIT license:

```
The MIT License (MIT)

Copyright (c) 2014-2020 morkt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

FelineSystem2 was examined as a reference; no code or assets from it are distributed
in this project. No native CatSystem2/E-mote/Steam binaries, SDK files, game scripts,
game fonts, images, audio or movies are included. The player reads content supplied by
the user. FFmpeg is an optional, separately installed development tool; converted
media is private local output and is excluded from the build.

Native x86 execution uses Unicorn.js commit
`560284c59c11c8d6c94d537f4354339f069ddcdf` and Unicorn commit
`8028ec436f2d9376525352dd38ed9ed6b9f6be10`, built with the maintained patches
under `third_party/unicorn`. This dependency is GPL-2.0 and includes components
under their upstream licenses. The combined distribution must retain the
applicable GPL, LGPL and MPL notices and provide corresponding source. The
standalone build serves `vendor/COPYING`, `vendor/manifest.json` and the complete
patched `vendor/corresponding-source.tar.gz` alongside `vendor/unicorn_x86.js`.
The manifest identifies the exact upstream commits, patches, toolchain and
artifact hashes. The maintained patches include exact instruction-budget handling
with architectural state captured at budget exits, atomic host instruction
accounting and checked shared-RAM views. These remain modifications under the
backend's GPL license. Existing source-file licenses remain intact.

The reviewed native regions use a separately compiled zlib 1.2.3 under the zlib
license. The standalone build includes its license and corresponding source in
`vendor/ZLIB-LICENSE.txt` and `vendor/zlib-1.2.3-source.tar.gz`; the fixed inputs and
build toolchain are recorded in `vendor/zlib-manifest.json`.

`tests/fixtures/native-movie.webm` is an authored synthetic color/tone fixture,
distributed under this project's MPL-2.0 license. Its adjacent text file records
the FFmpeg generation command. It contains no game media and is excluded from
the standalone player build.

The packaged Noto Sans JP font is distributed under the SIL Open Font License
1.1, with its provenance and license in `third_party/fonts/noto-sans-jp`. It is
an independently licensed fallback font, not a game asset.

The JS font backends compile FreeType 2.4.8 and 2.7.1, by David Turner, Robert
Wilhelm and Werner Lemberg, under the FreeType License. The distribution
retains `vendor/FREETYPE-2.4.8-LICENSE.txt`, `vendor/FREETYPE-LICENSE.txt`, both
source bundles and `vendor/freetype-manifest.json`. Maintained wrapper and
reproduction instructions are in `third_party/freetype` and
`scripts/prepare-native-freetype.py`.

The pure JS JPEG parser adapts jpeg-js 0.4.4, copyright 2011 notmasteryet,
under Apache License 2.0. Its CommonJS/browser exports and original inverse
DCT are replaced by an ESM entry and the engine's integer IFAST/color
conversion contract. The inverse DCT and quantizer scaling adapt IJG
`jidctfst.c` and `jddctmgr.c` as published in libjpeg-turbo 3.1.2. This software
is based in part on the work of the Independent JPEG Group. The license
texts accompany this distribution in `licenses/Apache-2.0.txt` and
`licenses/jpeg-ijg.txt`.

The legacy SKFE reader, numerical/matrix/generation algorithms and CPU
manager/instance/renderer-cache state and Sprite/Ribbon/Ring/Track geometry
algorithms adapt
Effekseer 1.23, copyright 2011 Effekseer Project,
commit `5239bb1e416cbf55b4d3c8170594cbdc7815f263`, under the MIT license.
The complete grant is retained in `licenses/effekseer-MIT.txt`. Selected public
Effects and their dependencies in `tests/fixtures/effekseer/public-1.23` are
CC0 sample assets from that same commit; the original sample notice is retained
in `licenses/effekseer-samples-CC0.txt` and each artifact has source and SHA-256
in the adjacent manifest. Authored fixtures use this project’s MPL-2.0 license.
These fixtures contain no private game data and are excluded from the player build.
