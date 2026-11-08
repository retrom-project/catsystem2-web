# Native zlib boundary

The two frozen engines link zlib 1.2.3. Their buffer wrapper is game `82C550`
and SDK `869E70`. `native-inflate.c` independently implements the surrounding
4096-byte output loop and uses the unmodified upstream inflater. It preserves
partial results, destination truncation, and the engine's distinction between
an untouched destination tail and a zero-filled tail.

The source comes from the [official zlib fossil archive](https://zlib.net/fossils/zlib-1.2.3.tar.gz),
SHA-256 `1795c7d067a43174113fdf03447532f373e1c6c57c08d61d9e4e9be5e244b05e`.
`scripts/prepare-native-zlib.py --emsdk <emsdk-3.1.74>` verifies that archive
and builds `.local/vendor/zlib/native_zlib.mjs`. The artifact contains its WASM
payload and has no external runtime dependencies. The preparation script also
produces the upstream license, a deterministic complete source bundle including
the authored wrapper and preparation script, and an input/output hash manifest.
Distribute the license with the module and retain the upstream license terms.

The public golden contains authored data only. All 60 cases were executed
through both original PE functions, with the standard-library replacement
disabled. Cases cover valid streams, invalid headers and checksums, truncated
streams, trailing data, zero-length input, and destinations
shorter or longer than the decoded stream. The wrapper does not substitute for
PSB parsing, model animation, deformation, physics, or CatSystem's M2 profiles.
