# Motionplayer evaluation and plugin oracle boundary (9.0)

## Decision: partial algorithm port

Use the motionplayer implementation as a source for individual PSB, timeline,
controller and mesh algorithms, with CatSystem2 DLL differential tests deciding
which algorithms enter the JS runtime. Do not embed its KiriKiri/TJS player or
its native module loader. This is a **partial port**, not evidence that the two
engines have identical behavior. No motionplayer algorithm is ported in 9.0.

The read-only source is `kirikiroid2-web`, commit
`3840e3d86cab38217a193abaaea2c404e1bc71dc`, directory
`cpp/plugins/motionplayer`. It contains 80 files and actual player/controller/
geometry implementations. Its reconstruction reference is Kirikiroid2 1.3.9
Android ARM64/ARMv7 and iOS ARM64/ARMv7, **not** either CatSystem2 driver.
The source's final reconstruction report records 88 playback frames with no
mismatch, but also explicitly leaves scalar and paired render evidence blocked.
Those results describe its own reference targets; they do not certify our DLL.

## License and provenance

At that commit the repository's `README.md` says MIT, while its actual `LICENSE`
starts with the W.Dee/Kirikiri contributor notice and Japanese three-clause
BSD-style terms, followed by separately identified bundled-library notices.
The motionplayer directory contains no overriding license/copyright statement.
Use the actual license grant and retain its copyright, conditions and disclaimer
when translating code; do not label the translation MIT based on the README.
The grant permits modified source/binary redistribution subject to those
conditions and prohibits endorsement using contributor names without permission.
This assessment identifies the supplied repository's terms; it does not claim
that a reverse-engineered implementation establishes ownership of third-party
binaries. No binary, model asset, KiriKiri dependency or bundled-library source
is copied by this evaluation.

The three conditions correspond to the [BSD-3-Clause terms](https://spdx.org/licenses/BSD-3-Clause.html).
MPL permits combining separately licensed files; retain the applicable notices
and the existing MPL source obligations ([Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)).
The original Japanese grant must accompany the first translated source, rather
than substituting a newly written English grant. `NOTICE.md` records the source
commit and this distinction.

Pinned source digests:

| File                       | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `LICENSE`                  | `31887f008d3666961adb51572add59709c12eb56d39066fed62b5267d380042d` |
| `README.md`                | `5226845f24b0dd5f6dd3fdc3437cc65e7964278c902b27fbef6817a38df80bd8` |
| `ResourceManager.cpp`      | `ad47ce9227fb039a066bb5949ed45e2f431f17b5dac02ac2e03433353bd28470` |
| `EmoteAngleController.cpp` | `cd43f73b65c865ea0495c7cb077869113eedd6a0bc93416ca99e8234e047bc1e` |

## Compatibility evidence and port boundaries

| Concern       | Observed source / target evidence                                                                                                                                                                                                                                       | Decision                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version       | `ResourceManager::load` requires `id=motion`, `spec=krkr/win`, model version at most `3.0300001`. Three NEKOPARA prepared models have `id=motion`, `spec=win`, model version `3.0299999713897705`, PSB container version 4, metadata `format=emote/version=1`.          | The model schema overlaps. Container version, motion version and metadata version are distinct; no DLL-equivalence claim follows. Keep our existing PSB parser as the data boundary.                         |
| Timeline      | `PlayerMotionLoad`, `PlayerFrameProgress`, `PlayerTimeline` implement variable tracks, keyframe/easing and loop/selector state.                                                                                                                                         | Port small evaluators; compare ordered frame sequences, including zero delta, overshoot, loops and variable-driven evaluation. Do not copy TJS getter/Variant lifetime behavior into plain JS model objects. |
| Controllers   | `EmoteEngine`, angle/blink/eyebrow/mouth/var/loop/selector/spring/wind modules implement metadata controllers. Target metadata includes eye, mouth, hair, bust, clamp, loop, timeline and selector controls.                                                            | Port only with target oracle evidence. ARM double/float evaluation, RNG, spring order and target DLL x87 can differ. Existing JS heuristic blink/physics is not an equivalence baseline.                     |
| Mesh          | `PlayerUpdateGeometry`, layer evaluation and render modules implement Bezier patches, inherited geometry, ordering and stencil state.                                                                                                                                   | Reuse algorithm structure; target raw DrawUP vertices/indices and pixel fixtures decide rounding, transforms, clipping and draw order. Reuse per-instance buffers and StageRenderer textures.                |
| Host          | Native registration uses `motionplayer.dll`, `emoteplayer.dll`, TJS/Layer/D3D adaptors. CatSystem2 uses `EmoteCreate` and its M2 wrapper.                                                                                                                               | Rewrite the host boundary in JS; no reuse of native ABI layouts, native module loading or TJS infrastructure.                                                                                                |
| Second driver | NEKOPARA SHA `85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce`; アマカノ2 SHA `cf6131d9aa3053ec57cb540ea95d7427198870ef3a916329bf478f6f09a6f629`, SDK string `3.9.7p3pre`, three additional exports. Matching second-driver model data is unavailable. | Record the interface difference; do not infer compatible controller/render semantics or amend the engine ABI schema/version selector. Unconfirmed behavior must fail explicitly.                             |

This finding uses local source and three already prepared, unencrypted model
files. It executes no game EXE and modifies neither source checkout nor DLL.
Temporary measurements and fuller inspection records stay under `.local/phase9`.

## Frame recorder

`scripts/record-plugin-oracle.mjs` calls the existing `NativeEmoteDevice` or
`NativePPI` DLL host. `oracle/plugin-frames.mjs` records each public call boundary.
It neither opens a game EXE nor patches/injects any target code.

- E-mote: input variable changes and elapsed-frame bits; all exported variable
  values as float bits; visibility; every raw DrawUP header, index and vertex
  byte. The existing Wine/D3D recorder supplies independent pixel results.
- PPI: Init, every Exec and Stop; all 148-byte public particle records; register
  and Z-shift float bits; blend/render/sampler state and both RNG streams.
  This includes position, color, transforms and visibility. Private velocity
  and life fields and internal E-mote controller state are explicitly **not
  observed** until their individual DLL contracts have reviewed layouts or
  public observation sequences. They are not reported as passing comparisons.
- Raw integer/float bits preserve signed zero, NaN and infinity in JSON. Each
  frame owns its recorded bytes, unaffected by later native buffer reuse.
  Tolerances belong to each differential fixture, never to the recorder.
  Existing authored E-mote vertices/variables remain bit exact; no threshold
  has been relaxed. Pixel fixtures keep their existing per-channel bounds.

Example E-mote input: `{"steps":[{"elapsed":0,"variables":[{"name":"pose","value":10}]},{"elapsed":1}]}`.
Example PPI input: `{"options":{"count":4,"width":64,"height":64,"screenWidth":1280,"screenHeight":720,"registers":[1,1]},"frames":[0,1,2,15,60,61]}`.
For cmnptcl, `options.particleData` names a separately supplied plist.

```sh
node scripts/record-plugin-oracle.mjs --kind emote --plugin /private/emotedriver.dll --input .local/phase9/emote-input.json --output .local/phase9/emote-trace.json
node scripts/record-plugin-oracle.mjs --kind ppi --plugin /private/rain.ppi --input .local/phase9/ppi-input.json --output .local/phase9/ppi-trace.json
```

`--model` optionally selects a separately supplied PSB/PSZ; the default is the
public authored PSB. Outputs include plugin/model/recorder SHA-256 and the full
schedule. The tool deliberately accepts a caller-selected oracle DLL so another
build can be investigated; runtime registration must still match reviewed
name/version/digest identities. Real model traces stay outside Git. Tests use
an authored PPI and independent authored-model Wine golden; the original driver
comparison is skipped explicitly without `CATSYSTEM2_EMOTE_DLL`.
