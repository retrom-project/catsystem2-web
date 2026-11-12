# Startup Blowfish known answers

`vectors.json` contains 34 published numerical answers from the designer's
[official vectors](https://www.schneier.com/wp-content/uploads/2015/12/vectors-2.txt),
plus 14 newly authored inputs encrypted by one independent C reference run.
Official vectors use standard BE block notation. The fixture retains their
original BE values and reverses bytes within each 4-byte block word to express
the startup carrier's two LE32 words. Key byte order is unchanged.

The independent source is
[Bruce Schneier's C archive](https://www.schneier.com/wp-content/uploads/2015/12/bfsh-sch.zip).
It was compiled once with uint32 words, unsigned char key interpretation and
its original little-endian constant-file loading branch. Only obsolete platform
headers/type width were adapted. No round, key-loop limit, expected ciphertext
or cipher operation was changed. Before producing the authored answers, all 34
published answers were checked exactly; every reference result also decrypted
back to its original plaintext. The reference does not enforce the unused
header's modern 56-byte macro.

Authored effective keys are `key[i] = (73*i + 145) mod256`, truncated to
1/55/56/57/71/72/73/511 bytes, plus explicit public-default/zero/NUL examples.
The 32-byte boundary payload is eight 0s, eight 255s, then two copies of
`00417f80ff0a5500`. It tests independent blocks and preserved NUL bytes.
Additional inputs test padding-like plaintext and payloads without NUL.
No actual key file, game plaintext, executable code or SDK asset is included.

Every public input source, data and independent-reference hash is pinned in the
JSON. Tests require only these records and the JS primitive; no compiler,
private resource or research runner is consulted. Numerical pi constants are
credited to Bruce Schneier's official data page and its contributor Mike
Schaudies; see `licenses/startup-blowfish.txt`. New synthetic fixtures follow
this project's MPL-2.0 license.
