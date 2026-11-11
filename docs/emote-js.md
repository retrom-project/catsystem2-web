# E-mote JS implementation

The JS implementation is introduced in phase 9. Until its native integration
is complete, the existing mixed runtime still uses the original DLL. The new
data layer is not a second executable backend and imports no native process.

## Data boundary (9.1)

`EmoteDocument.open(bytes, {name})` reads an ordinary PSB or zlib-compressed PSZ
through the existing parser. Container version, motion version and metadata
version remain distinct. The evaluated motion schema requires `id=motion`,
`spec=win/krkr`, finite positive motion version at most `3.0300001` and, when
present, metadata `format=emote`, `version=1`. Missing format/version fields in
the authored legacy metadata remain valid. This follows the reviewed data
contract, not a game-name or engine-version branch.

The document retains the original object/motion tree, metadata controllers,
variable tracks, keyframe ordering and easing data. It does not normalize away
unimplemented flags. Source and variable names use Maps. Unknown motion, icon,
texture encoding or metadata version produces an explicit error. This adds no
engine ABI fields or engine-version selection behavior.

Textures decode lazily and are cached by source (or per-icon resource). The
reviewed `RGBA8` PSB bytes have BGRA channel order in the original DLL upload;
the JS decoder returns canonical RGBA for StageRenderer. It supports complete
raw and RL32 resources, preserves the full texture dimensions and icon origins,
and checks resource/run/icon bounds. It performs no per-frame texture decode or
buffer allocation. Additional pixel formats require their own oracle evidence;
an unfamiliar type does not fall back to RGBA8.

Public tests cover authored PSB3/PSB4/PSZ, raw and literal/repeated RL runs,
metadata/easing preservation, cache identity and explicit unsupported/error
paths. With `CATSYSTEM2_EMOTE_DLL`, the existing DLL host also opens both
authored container versions and compares every uploaded texture byte with the
JS canonical pixels. The fixture encoder's default PSB3 output is unchanged.

The second emotedriver build has a different SDK version and three additional
exports; matching model data remains unavailable. The interface evidence and
the boundary on unverified reuse are in
[the motionplayer assessment](b-phase9-motionplayer.md). This data layer does
not register the second driver as behaviorally equivalent.

## Controller state (9.2)

`EmoteAnimation` owns variable/angle/mouth/eye/eyebrow controllers, selector
targets, cyclic curves, absolute/additive timelines, root transform/color,
the simple and two-segment spring solvers, and a bounded wind emitter. Their
float32 state is separate from the model's immutable motion data. Named variable
queries return the base controller values; additive timeline contributions and
mirror/clamp processing go to the geometry binding map. Selector targets can
be queried by name even though the DLL excludes them from its enumerated label
list. `variables()` preserves that distinction.

The DLL's observable float32 order controls this implementation. In particular,
controller slices subtract float32 `1.1`, eye and eyebrow paths can cross several
states in one update, root angle converts through float32 degrees, and spring
output keeps the two multiplications by `1.15` and the radian scale separate.
The spring wrapper initializes with a zero delta and canonicalizes a settled
output vector at the DLL's `0.01` dead zone. This is engine behavior, not a
differential tolerance. Root colors use the native packed RGBA weight and its
`128/128/128/255` neutral state.

Blink and wind use one shared four-word xorshift generator, not motionplayer's
MT19937. Hosts pass a shared `EmoteRandom` to instances; the standalone default
uses seed zero, matching the oracle's deterministic clock. Wind emission advances
by frame units, its collision width is twice the sampled strength, and its force
uses travel direction. These are reviewed target differences from the ARM source.
The wind tuple is `[start, end, speed, high, low]`; negative speed reverses travel.

`snapshot()`/`restore()` retain controller queues, graph paths, spring positions
and velocities, wind slots, RNG, root state and timeline cursors. The checkpoint
is the current unreleased JS contract; there is no native-state conversion or
reader for an earlier development snapshot. Root, spring and wind TypedArrays
are allocated per instance and reused while updating.

`tests/fixtures/emote-controller-golden.json` records the original DLL's output
on authored PSB models. It covers direct and graph transitions, easing,
fractional time/durations, automatic/random blink, mouth, both spring families,
wind, loops, selectors, absolute/additive and looping timelines, and root
position/scale/angle/color. Public JS comparisons require **exact float32 bits
and integer values**. The independent private DLL regeneration also compares
the recorded DrawUP bytes; geometry/render equivalence is checked in 9.3.

Regenerate explicitly with the separately supplied hash-checked DLL:

```sh
node scripts/record-emote-controllers.mjs --driver /private/emotedriver.dll --output tests/fixtures/emote-controller-golden.json
npx prettier --write tests/fixtures/emote-controller-golden.json
```

The fixture identifies the DLL, generator, frame recorder, authored cases and
each model by SHA-256. Raw investigation and instruction-level evidence remain
in ignored `.local/phase9`. No game EXE, patch or injected guest-code probe is
involved. The JS modules remain separate from the mixed runtime until 9.4.
