# JavaScript particle plugins

`JSPluginRuntime` executes JS callbacks, never DLL code. A definition has a
name, implemented host API (2.1 or 2.2), and optional construct/init/exec/stop/
destruct callbacks. Each receives an instance with public particle records,
parameters, attachment state, named host services and private `state`.
`module.shared` contains module-wide numeric/data state shared by all instances.
Neither private nor shared checkpoint data may contain callbacks or borrowed host
objects; immutable implementation functions remain in the registry.

`start()` calls Init with frame0 and before `0xffffffff`. The first Exec retains
that before sentinel; later calls receive the preceding executed frame. Stop
executes even if already stopped when explicitly requested; ordinary close
invents no second Stop after one has completed. Restart retains public particle
memory and calls Init again, matching the original object lifetime. Releasing
the last instance releases its module statics. Callbacks are synchronous and
cannot reenter the host or create another instance.

The parameter object/buffer is reused and refreshed from the caller's 32
registers before each callback; plugin writes to it do not alter those registers.
The 148-byte particle buffers and vector/vertex accessors also survive every
frame. Their stores round to float32; host math retains the recovered operation
order. The original recursive PPF.abs anomaly is an explicit non-returning
operation error. Version2.1 adds Z shift, and2.2 adds resource bytes and render/
sampler state. The **implemented API** gates these services, independent of an
unverified file's reported version, so the warning policy does not become a
version rejection elsewhere in the host.

Attachment getters update base/position/display when the graph resolves. A lost
graph retains its preceding fields; the -1 sentinel clears them. Texture bytes
and GPU uploads remain owned by StageRenderer; plugins receive their texture
width/height, record UVs, blend mode and state overrides. They do not own another
renderer or WebGL context. The runtime clock is an injected engine clock; no
plugin host timer is created.

Snapshots store module statics, instance private data, particle bytes,
registers, attachment fields, frame/active flags, state overrides and both RNG
streams. Fresh restore runs neither construct nor Init. It needs the JS
implementation and external resource/attachment services, not a DLL or native
heap. A restore in a fresh registry warns about an unverified identity once.
The current checkpoint contract is edited in place; there are no old readers
or development snapshot migrations.

Identity handling is diagnostic. The basename selects an implementation; the
small verified list records name, PPI version and SHA-256. Other versions or
hashes produce one console warning and use the same implementation. A bounded,
best-effort file read recognizes the export3 constant for diagnostics; unfamiliar
or truncated version data reports `unknown` and still continues a known name.
This never maps an executable, resolves imports, runs initialization or validates
a complete component/format contract. Missing implementations fail explicitly,
including their name, observed version and digest. Unregistered engine/native
IDs keep their existing explicit errors. OpenJTalk/TTS has no JS implementation
and is unsupported; the second E-mote build and Amakano2-only plugins are not
certified by this host work.

The SDK's compiled `sample_rain.ppi` reports1.0, while its adjacent C++/header
source describes2.1. The original inspected2.x loader rejects the1.0 binary;
its filename is not evidence of equivalence with `rain.ppi`2.1. The1.0 support
choice is isolated in9.7. No alias or speculative layout conversion is introduced.

The host first lands independently (9.5), algorithms follow (9.6), and product
selection/removal of the old loader happens in9.8. Node tests cover warnings,
unsupported identities, shared lifetimes, attachments, buffered writes,
close/load races, fresh checkpoints and the existing authored DLL oracle's raw
records/RNG at irregular frames. No private game EXE or new patch/injection
probe is used by the public host differential.
