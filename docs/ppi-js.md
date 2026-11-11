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

## Reviewed implementations

The default JS registry now contains all twelve reviewed NEKOPARA plugin names.
Selection uses only the plugin basename; this is an implementation registry,
not a game allowlist. Unknown versions continue under the warning policy.

| Implementation              | State owned by JS                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| blur                        | Slice vertices, transform, jitter, colors and counters                                         |
| cmnptcl                     | Plist configuration, emission, private position/velocity, lifetime and compacting active array |
| dash                        | Head/tail records, travel, fading and module-wide activation count                             |
| em_angry                    | Scale/rotation stages and growing trails                                                       |
| em_double                   | Timed four-direction displacement                                                              |
| em_note                     | Random Hermite paths and activation                                                            |
| em_question / em_question_a | Distinct state machines, including the A build's permanent state3                              |
| em_sweat                    | Hermite motion and fading trails                                                               |
| filmnoise                   | Flicker, scratch and noise record groups                                                       |
| rain                        | Atlas selection, warm start, emission, velocity and lifetime                                   |
| steam                       | Random emission line/path, warm start and alpha phases                                         |

The kernels retain observed quirks: centered quads' third Y uses texture width,
cmnptcl color deltas wrap as bytes, dead records compact from the end, rain/dash
movement advances once per Exec, and zero-length splines retain their original
NaN behavior. No SDK sample is substituted for a different shipped algorithm.
All mutable path/particle buffers are allocated per instance and reused by Exec.

[Baseline records](../tests/fixtures/ppi-js-plugins-golden.json) freeze all twelve
DLLs at Init, six frames and Stop. [Motion records](../tests/fixtures/ppi-js-motion-golden.json)
add fifteen authored cases with nondegenerate paths, tail grouping, rapid resets,
radius/gravity emission, parameter/attachment changes and restart. These contain
public output bytes and RNG hashes, with no DLL or private game resources.
Both use the normal script environment's x87 control word0x007f. Existing0x037f
and changed-control-word evidence remains oracle evidence, outside the selected
JS cross-call contract. The differential requires **exact bytes**, control flags,
render/sampler states and RNG state; no floating tolerance was widened.
Fresh JS checkpoints continue each motion case against the frozen DLL output.
Each Exec also runs with TypedArray construction prohibited by the test.

To refresh the motion evidence with privately held original plugins:

```sh
node scripts/record-ppi-js-oracle.mjs --root /private/ptclpi --output tests/fixtures/ppi-js-motion-golden.json
node --test tests/differential/ppi-js-plugins.test.mjs
```

The recorder uses the existing public DLL lifecycle oracle, never an EXE,
patch or injected probe. Input and recorder hashes prevent stale frozen inputs.
The shipped DLL hashes in the small verified list identify the reviewed builds;
the default Node differential itself needs no private binary.
