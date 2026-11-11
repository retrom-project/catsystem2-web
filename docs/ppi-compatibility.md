# Particle and plugin compatibility

Product PPI execution is JavaScript. [Particles](../src/particles.mjs) owns
banks and clocks; [JSPluginRuntime](../src/ppi/js-runtime.mjs) owns module statics,
private particle state, RNG and lifecycle. The twelve reviewed algorithms live
under [src/ppi/plugins](../src/ppi/plugins). StageRenderer owns textures, geometry
submission and the common destination/depth target. No DLL is mapped, initialized
or executed by the product plugin path.

The [small verified list](../src/ppi/verified-versions.mjs) records name, PPI version
and SHA-256. A recognized name with another version or digest warns once with
identity and implementation, then continues with the same JS algorithm.
Names without an implementation fail explicitly. This is not a game-specific
allowlist, content firewall or automatic claim of another build's equivalence.
See the [support boundary](ppi-support.md) for sample_rain1.0, deferred Amakano2
implementations and unsupported OpenJTalk/TTS.

The public SDK record remains148 bytes with float32 fields; the host exposes
the reviewed2.1/2.2 named services. Private velocity, lifetime, spline and emitter
state belongs to JS rather than a guessed public ABI field. Both engine RNG
streams are shared across instances. The normal engine x87 precision/rounding
is reproduced; cross-call changes made by a plugin are retained as oracle
evidence rather than a product behavior contract.

Authored [frozen DLL differentials](../tests/differential/ppi-js-plugins.test.mjs)
require exact records, control/frame flags, graphics states and RNG. They cover
all twelve builds plus nondegenerate paths, attachments, restart, compacting
emitters and fresh checkpoint continuation. Exec reuses instance buffers and
is tested with TypedArray construction prohibited. The reviewed DLL hosts and
mapper now live only in oracle/ and are excluded by development-server and
distribution gates. [Original oracle contracts/evidence](ppi-oracle.md) remain
available for explicit differential work.

Current checkpoints store JS module/instance state, public records and RNG;
they restore without a DLL read, constructor or Init call. The development
contract is changed in place, including the pluginID bank reference. There is
no old checkpoint converter or compatibility reader.

The EXE transition still has its own engine mapper and Win32 services for the
remaining domain7/8 consumers. It accepts the reviewed original EXE directly,
without the former private IMAGE_FILE_DLL header alteration. Its common PE
inspection, CPU backend and Windows services are domain8 infrastructure until
the remaining migration removes them. They are not a plugin execution fallback.
The shared renderer consumer view projects only the registered FES/media fields
(domains7/8); no domain9 projection remains.
