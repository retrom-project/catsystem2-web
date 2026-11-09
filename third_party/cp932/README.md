# Fixed CP932 mapping

`CP932.TXT` is Microsoft's CP932-to-Unicode table 2.01 (1998-04-15), Unicode 2.0:
[Unicode mapping archive](https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP932.TXT).
Source SHA-256: `c9bc0b0cd42e0fbcb82a09635bb5abed86afbdd4abc9e76fa5716638217cb59f`.
The accompanying Unicode license applies to this data and its generated form.

Run `node scripts/generate-cp932.mjs` to regenerate `src/native/cp932-data.mjs`.
It checks the source digest and emits 7,915 assigned mappings. The runtime adds
Windows user-defined rows F0–F9 and reuses the repository's independently measured
`REGISTRY_CP932_EXCEPTIONS` for special single bytes and UTF-16 best-fit encoding.
The fixed implementation has no Shift_JIS TextDecoder dependency. Undefined or
incomplete double-byte inputs follow the measured Windows middle-dot replacement.

This table serves migrated UTF-8 key search and Unicode diagnostic output.
Existing generic string and platform codecs are unchanged in phase 3.
