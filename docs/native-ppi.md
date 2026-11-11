# JavaScript PPI host (phase 9 complete)

[`JSPluginRuntime`](../src/ppi/js-runtime.mjs) owns JS module statics,
instances, independent engine integer/real RNG streams, lifecycle and checkpoints.
[`PPIHost`](../src/ppi/host.mjs) exposes the SDK's 35 named services with 2.1/2.2
implementation capabilities. It uses the already verified numeric kernels.
[`PPIParticleRecords`](../src/ppi/records.mjs) owns the public 148-byte records;
float/vector/vertex stores write float32 into one reusable buffer per instance.
Private velocities, lifetimes and emitter cursors belong to each implementation's
JS state and are checkpointed; they are not invented fields in the public record.

[`PPIRegistry`](../src/ppi/plugin-identity.mjs) selects a JS implementation by
plugin basename. Its small [verified target list](../src/ppi/verified-versions.mjs)
contains names, PPI versions and SHA-256 only. An unverified version or digest
warns once with all identity fields and the implementation, then continues the
same implementation. Missing implementations fail with an explicit unsupported
error. No game-name switch, renamed-plugin alias or x86 fallback is supplied.

The product selects this host directly. The original DLL host/mapper live under
oracle/ and are reachable only from explicitly selected oracle clients.
[The boundary check](../scripts/check-plugin-boundary.mjs) enforces the source,
inventory and distribution separation. See [host contract](ppi-js.md) and
[support limits](ppi-support.md).
