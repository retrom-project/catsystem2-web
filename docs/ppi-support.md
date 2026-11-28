# PPI support boundary

The JS registry implements the twelve [reviewed names](ppi-js.md#reviewed-implementations).
A different version or digest with one of these names warns once and continues
with that implementation. This is the approved diagnostic policy, rather than
a certification of another build's behavior. Missing JS implementations fail
explicitly with name, observed PPI version and SHA-256.

sample_rain.ppi1.0 is explicitly unsupported. The reviewed binary SHA-256 is
90266315c608b53e081fc2fa33a799178e245f621b9d49f56ee502b5bb3bb758;
it is present both in the SDK and the surveyed older work. Its public export3
returns1.0. The adjacent SDK C++ describes2.1 and is not evidence of the binary's
1.0 host/record layout. The inspected2.x oracle loader itself rejects1.0.
No verified cross-version host/record equivalence has been established, so it
is not renamed or mapped to the unrelated reviewed NEKO rain algorithm.

Amakano2's matrix_rain, matrix_snow, sakura, sample and spark implementations
are deferred until the overall migration is complete. Its different steam2.1
build (ad564d7eb6ed6ac271dd5f8dfd0bbf1e0ada699a87f54c671cd9194fde6faedc)
is also deferred for certification: same-name selection warns and uses steam-js,
without claiming equivalence. Its rain bytes are identical to the verified
NEKO build. No work name or game-specific allowlist participates in selection.

The second E-mote driver build remains a difference record in the E-mote
assessment/data documentation. It receives no dedicated implementation in this
phase. Unverified available metadata warns and continues with the same JS path;
unsupported operations retain explicit errors.

OpenJTalk/TTS has no implementation. The runtime does not substitute browser
speech synthesis, execute a DLL, or manufacture a successful speech task.
Unregistered engine versions and native IDs retain their existing explicit
errors. Passing a TTS/provider name through the plugin host also returns the
same explicit missing-implementation diagnostic.
