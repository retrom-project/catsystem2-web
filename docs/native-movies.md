# Native movies

The native movie service implements main `0x109..0x10E`, `0x1A1`, `0x314`,
`0x3E4..0x3E6`. It keeps each movie's preparation, running word, repeat count,
volume, rectangle, window mode and signed 100-nanosecond position independently.
Movie handles belong to the World, including during candidate checkpoint restore.

Opening routes the original root/InputTask messages and changes the shared view
cursor gate and renderer gate. A failed open undoes those changes. Close releases
the decoder, restores the gates, shows the cursor and sends the InputTask message
again. A disabled movie returns zero before formatting or creating a decoder.
The original InputTask platform message is an evidenced no-op; the message still
travels through the task router.

Play sets the running word before invoking the decoder. A failed graph Run
therefore leaves the running query true until stop succeeds. The second play
argument is a repeat count. Completion decrements it unless it is `0xFFFFFFFF`;
zero after decrement stops playback. An initial zero wraps to `0xFFFFFFFF`.
Completion events and native calls share a serialized queue. Frames and portable
checkpoint export wait for that queue; asynchronous decoder errors are reported.

Volume retains the original signed input and hundredths-of-decibel conversion.
When the window is inactive it uses the derived legacy BGM factor, or zero for
the original master/BGM mute gates. Active-window calls keep the supplied volume.
The browser applies the resulting attenuation to its media element.

Browser media replaces the DirectShow decoder and child window. Each movie owns
its own element and optional Blob URL. Restore opens a fresh decoder, waits for
the saved position to become seekable, seeks, and defers presentation/playback
until the candidate World becomes active. A source that cannot seek to the saved
position fails restoration; a silently reset time is not accepted.

`prepare:media` converts WMV/AVI/MPEG resources outside the original game tree.
Its provenance records the complete source identity, qualified archive aliases,
source size/SHA-256 and output SHA-256. The development server verifies output
hashes before exposing sidecars; the client checks the mounted identity and
resource size. Same-named resources in different archives remain independent.
Native browser formats can stream loose HTTP files directly or use an isolated,
revocable Blob URL for an archive slice. Missing browser codecs are reported as
an open failure; browser-native WMV decoding is not claimed.

`scripts/verify-native-movie.mjs` supplies **5,844 comparisons per frozen build,
11,688 total**. It executes all eleven original wrappers plus constructors,
play/stop, position, volume, rectangle, mode, destructor and completion-thread
helpers. Decoder open, COM methods, window/input routing, foreground state and
view gates are explicit boundaries. The completion wait supplies one event and
captures the repeating state before ending the diagnostic wait.

Public tests cover failure states, simultaneous handles, portable restore,
source/provenance isolation, and real Chromium decoding of an authored WebM.
The browser test checks decoded pixels, nonzero 440 Hz PCM, geometry, repeat
completion and fresh-decoder continuation at the saved position. It does not
establish Windows decoder pixel equality or the original renderer's complete
movie gate behavior; those remain separate acceptance items.

A second browser test runs authored KCS through the complete `CatSystem2`
instance for both frozen profiles. It checks the root/InputTask routing,
cursor/update gates, normal renderer suppression, live movie handles across
fresh World restore, old World disposal and explicit decoder close.
