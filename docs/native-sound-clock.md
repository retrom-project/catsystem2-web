# Native sound timing and bank commands

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

## Native playback classification

Allocated sound loads retain the semantic category of the group that actually
selected the bank. With a loaded sound configuration, explicit `PART` records
relate their `type` to a group ID; an explicit `SOUNDGROUP` type can also supply
that category. IDs and empty type strings are not legacy category enums. An
absent or conflicting relationship remains unclassified. A canonical PART
ancestor supplies the category for its same-group subtree; custom speaker
subtypes refine that ancestry. Independent unknown types, unknown explicit
group types, or another canonical category remain conflicts. Without that tree,
the existing reviewed legacy type table interprets the selected group's type
code. Stream/static load mode, filenames, and physical bank numbers do not
determine whether a track is dialogue.

The native device bank owns its nullable `category`. Playback projects it into
the existing mixer channel's `nativeCategory`; both are retained in the current
checkpoint contract. Release clears the device category, and swaps carry the
device and channel metadata together. Cold reconstruction preserves that data
without issuing a new guest command or looking up a replacement classification.
The device/channel projections must agree before restore mutates an owner.
Mixer restore likewise preflights the finite category enum and plain numeric
tag map (unsigned source milliseconds converted to seconds) before stopping
any current channel.

Native channels keep their `native` mixing group and original volume factor.
The shared `voiceInfo()` selection also includes native channels explicitly
classified as `voice`, ordered with high-level voices by the mixer's existing
playback sequence. Their envelope uses the same decoded buffer as high-level
voices. Tags come from the native task's already loaded tag map, converted from
milliseconds to seconds and retained in the channel checkpoint. Playback and
cold reconstruction do not read another tag file. Classification does not apply a second
configuration gain, mute, master, or voice-group factor. System voices, effects,
music, and unclassified native tracks do not become dialogue voices.

Active or paused voices have selection priority. If none remains active, a
completed native voice can still expose its retained channel metadata until
the native bank is released. Its `playing` value stays false, its completion
cursor stays at the real endpoint (or zero after native stop), and no source,
clock, timer or history cache is created. Native pause/replay retains the real
cursor; release removes the channel and therefore its information. High-level
voice completion keeps its existing selection behavior. Lip motion, tag waits
and auto advancement continue to consume the existing explicit `playing` gate;
retained metadata never represents continuing playback.

Ordinary audio regressions and the shared owned AudioContext fixture have no
original-engine dependency. The explicit physical-checkpoint composition test
lives separately in the oracle group, with its original body and assertions.

SDK23, SDK63 and SDK67 Main569 read the primary DirectSound buffer's decoded-
stream query word. Both Main155 per-file load types use this backend owner; a
file's streaming/static mode does not select the other global native backend.
Absent devices, missing buffers or decoders and invalid banks return zero.
The alternate backend has no proved browser mapping and remains an open shape.
Main587 returns the primary buffer completion word, irrespective of the current
file mode. Static playback increments it once per completed pass. Finite repeat
counts decrement to one; zero repeats until stopped. Pause preserves the counter,
Play and Stop clear it, and release retains it. Loading a stream into the same
bank also retains that counter until Play. Each build's actual Main155 and
notification-callback differential proves these transitions; production cold
restore preserves the counter and the remaining repeat count. An active-device
out-of-range Main587 bank leaves the original result unwritten and remains
diagnostic; an absent device returns zero. Main165 retains signed pan readback
and Main349 returns only the pending volume fade bit. Both return zero for an
out-of-range bank.

The three older builds also retain the same Main602/603 Sound group owner:
registration copies five raw words, preserves the first record on a duplicate
ID, and keeps signed or reversed bank ranges without normalization. Removal of
an absent ID is silent, and a removed ID can be registered again. Zero and
high-bit DWORD IDs remain independent. The original tree allocation, erasure
and destruction chain releases every allocated group node; the shared owner
preserves its records through a cold World restore and closes with its Sound
task. These commands register selection data and do not start playback.

Main604 creates actual decoder/buffer owners from those records. SDK67 includes
the upper bank bound and, when full, reuses a releasing bank, a finishing bank,
or the first bank. SDK63 and SDK23 scan a half-open range and otherwise reuse a
releasing bank. The SDK63/67 packet wrapper leaves the separate type selector
zero; SDK23 sends its selector directly. Missing groups return -1. The owning
load/selection differential includes the actual native Sound frame callback:
an allocated release finishes its ten-frame fade before the following frame
unloads the decoder and buffer. A playing member marked to end after playback
is reusable by SDK67's finishing-bank scan; the two half-open allocators leave
that full group unavailable. Final native manager unload closes every retained
decoder, mounted-file owner and captured COM interface.

Main166 packs its signed 16-bit target pan and unsigned 16-bit duration before
storing the fade state at the Sound task's current-minus-base frame. Main167
ignores the first distance float and stores the second as maximum distance,
preserving minimum distance. In these three builds distance, position,
velocity and Doppler setters use a loaded primary-backend buffer for either per-
file load type; an absent 3D output interface still preserves that buffer value.
Absent devices and invalid banks retain their native
no-change behavior. The setter proof covers control state and captured output
arguments; subsequent fade ticks and playback remain separate checks.

The SDK23, SDK63 and SDK67 owning Main155 differentials use a 64,000-frame PCM WAV so its type-1
stream stays a stream and type 2 stays static. Both execute the same primary
DirectSound backend; their per-file flags differ. The production Main155 path
creates these modes through AudioMixer from the same WAV bytes. A mono 3D
buffer reapplies its retained pan at creation and derives its initial position
from that pan. The captured backend fields, file modes and this projection are
kept separate in the evidence manifest.

The three legacy stream paths also retain counted playback through native
half-second refill notifications. Finite counts one and two, unbounded zero,
partial final reads, mono 8-bit PCM and stereo 16-bit PCM agree through the
owning creation, refill, query, stop and release chain. Completion and Stop
rewind the retained buffer. Browser refill addresses use integer PCM bytes;
floating-point times must not duplicate or skip samples.

SDK63/67 activity capture preserves the native 80-word ring, including its
segment-slot clear and the original partial/empty-read clearing order. The
separate version policy applies that refill behavior only to those proved
builds. SDK23 has no corresponding Sound activity-capture message; its message
boundary remains intact. Cold restore retains both the ring and the remaining
playback duration.
