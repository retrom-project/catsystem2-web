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
