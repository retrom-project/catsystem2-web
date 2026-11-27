# Fixed text font backends

`native-font.c` exposes memory faces, integer advances and grayscale glyphs.
Both reviewed FreeType releases are compiled to JavaScript with Emscripten
3.1.74 and `WASM=0`. They do not load or execute the CatSystem2 EXE.

```sh
python3 scripts/prepare-native-freetype.py --emsdk /path/to/emsdk-3.1.74
```

The script pins upstream archive hashes, compiler version, wrapper and builder
hashes. SDK uses FreeType 2.4.8 with CP932 lookup conversion; game uses 2.7.1
with direct code-unit lookup and TrueType interpreter 35. ABI data selects the
release and encoding. Actual metrics and glyph pixels are compared with the
private originals using the packaged OFL font.

Artifacts live in ignored `.local/vendor/freetype`. The standalone builder
verifies the fixed module hashes in `src/native/freetype-artifact.mjs`, then
ships both JS modules, their FTL notices, corresponding source bundles and
`freetype-manifest.json` under `vendor/`. The source bundles contain the full
upstream release, this wrapper and the reproducible build script. No game font
is redistributed. Font resources remain supplied by the mounted game.
