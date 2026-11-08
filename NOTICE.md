# Notices

This project is distributed under the Mozilla Public License 2.0; see LICENSE.
Its format parsers, VM, script execution and E-mote implementation adapt
[CatSystemKit](https://github.com/OWCramer/CatSystemKit), by OWCramer, at
`02873f0becbdab5fd992cd9f3dcd50edd3937d78`. The browser platform, file access,
WebGL backend, audio, persistence and standalone host are implemented here.
Modified and derived files remain under MPL-2.0 with source available in this repository.

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
fonts, images, audio or movies are included. The player reads content supplied by
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
with architectural state captured at budget exits and checked shared-RAM views;
these remain modifications under the backend's
GPL license. Existing source-file licenses remain intact.

The reviewed native regions use a separately compiled zlib 1.2.3 under the zlib
license. The standalone build includes its license and corresponding source in
`vendor/ZLIB-LICENSE.txt` and `vendor/zlib-1.2.3-source.tar.gz`; the fixed inputs and
build toolchain are recorded in `vendor/zlib-manifest.json`.

`tests/fixtures/native-movie.webm` is an authored synthetic color/tone fixture,
distributed under this project's MPL-2.0 license. Its adjacent text file records
the FFmpeg generation command. It contains no game media and is excluded from
the standalone player build.
