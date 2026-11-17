# PLV uses the system timer

`NativeSound.now()` reads the World's shared system clock and truncates it to
the DWORD returned by `timeGetTime`. It supplies PLV start times and sample
indices. `AudioContext.currentTime` supplies media timing elsewhere; it cannot
substitute for this system timer. Inferring milliseconds from a fixed 60 FPS
also fails when the configured frame rate differs or an external clock runs
independently of game frames.

The original game handler stores `timeGetTime()` at `5EBC47` on play and at
`5EBCB6` for message 217. Its scalar PLV helper `5EB070` and array helper
`5EB0D0` compute an unsigned DWORD elapsed time divided by the PLV step. The
SDK's independently examined equivalents are `4C6C50` and `4C6CB0`; its epoch
message is raw 215 in handler `4C7130`. Both builds retain an existing start
time unless it equals the original `FFFFFFFF` sentinel. DWORD subtraction
wraps at the timer rollover.

`scripts/verify-native-sound-clock.mjs` executes each fixed engine's complete
epoch message and original scalar/array query functions: **1,089 calls and
2,277 comparisons per profile**. It checks both bank boundaries, fractional
millisecond inputs, rollover and sentinel collisions, repeated enable calls,
sample-step limits, output-array canaries, unchanged control records and
24/75/144 FPS virtual clocks. The original WINMM import reads the injected
system clock; its call instructions and PLV functions are not replaced.

The probe authors PLV values and control records and sets the device-present
input explicitly. It does not exercise DirectSound playback or claim a sound
task constructor/hardware initialization proof. Those device boundaries are
separate from the timestamp source verified here.

Public regressions cover both profiles with unrelated or absent AudioContext
clocks, external DWORD rollover, a fresh sound/clock checkpoint at a different
host clock epoch, and preservation of the saved media offset. A full SDK World
also advances its PLV at 75 FPS, then restores an external-clock checkpoint to
a fresh World. Advancing the restored clock changes only that instance.
Reports and raw disassembly remain in ignored local storage.

## Audio playback checkpoints

Cold reconstruction preserves the mixer's next playback sequence. The snapshot
orders retained channels by their existing playback sequence, even after a bank
swap or replay changes Map insertion order. Recreating them uses the preceding
sequence range in that saved order; it does not consume new playback commands.
Absolute gaps between old channel sequence values are not used by selection;
their relative order and the next playback sequence are preserved. Deferred Core restore still has one
live channel per bank and starts each playing source once at activation. The next
real play receives the saved next sequence and follows every restored channel.
This changes no checkpoint fields, media clock, or native bank ownership.

The playback cursor belongs to the actual `AudioMixer` and its `AudioContext`.
It is independent of the system timer used by PLV above. After pending resources
and movies settle, `Core.snapshot()` samples that context clock once and passes
the same time through the World sound and mixer projections. A direct World,
NativeSound, or mixer snapshot likewise samples once for its complete bank set.
Each channel uses that time for its PCM progress/refills, remaining duration,
offset, and scheduled delay. Serializing other large owners cannot move one of
those projections to a later audio quantum.

The capture time is transient and is not stored as an absolute browser clock in
the DTO. Restoring keeps the existing deferred staging: saved bank data is loaded
without playing, then the committed mixer activates each live source once at the
saved offset. No logical frame, native command, or RNG value is replayed. Capturing
a checkpoint does not suspend, pause, or replace real audio output; subsequent
observations continue to advance on the actual context clock. A snapshot made
after elapsed playback therefore reports the new cursor, rather than returning
a cached checkpoint or a frame-derived approximation.

The regression uses a running owned Core with a clock advance during another
owner's snapshot to distinguish the two projections, plus two banks whose clock
changes between reads to expose internally inconsistent cursor fields. A short
owned browser witness decodes authored WAV PCM with the real AudioContext,
compares the complete cold World DTO, observes exactly one restored source start,
and records later media-time progress. It is not a native sound-oracle rerun or
a claim about the complete SDK tutorial campaign.

## Reviewed version behavior

The ordinary sound task requires reviewed `sound.crossfade` behavior before selecting an extended load packet or reading its optional level sidecar. An unreviewed value does not select the non-crossfade path. Invalid bank rejection still precedes that packet-layout decision.

The later elapsed-frame bookkeeping runs only for a reviewed boolean `sound.completionFrame` policy. An unreviewed policy leaves those later bookkeeping words unchanged; it does not select the modern false branch. An elapsed-time request must still pass its own version message mapping and reviewed policy. The .67 first-title evidence covers its own bank frame and sparse messages, without enabling the later elapsed query or supplying physical control layouts.
