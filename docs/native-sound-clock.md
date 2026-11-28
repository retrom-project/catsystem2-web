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
The original engine startup selects the primary backend in all three builds.
SDK63/67 retain a private WaveOut constructor mode, but their sole engine
construction call passes mode one. SDK23 compiles mode one inside that
constructor. All four native tables, exports, incoming constructor references
and stored function pointers preserve this boundary; window initialization and
configuration routes keep the same selection. Controlled native captures retain
the private WaveOut behavior separately. A failed DirectSound initialization
releases its owner without selecting WaveOut.
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

A partial stream can exhaust its decoded data before the next native refill
notification. Its bank remains active while that final buffer region drains.
The adapter derives that endpoint from PCM bytes and the native half-buffer
size, independently of the new AudioContext's clock origin. Pause retains this
state, a one-count resume finishes it without starting another decoded source,
and Stop, Release or a new load discards it. Cold restore preserves the same
pending endpoint and starts no output node for the silent remainder.

Changing the repeat count of a paused, already-draining stream preserves its
decoder, ring cursor and refill reader. A later refill appends newly decoded
PCM behind that cursor; the output source waits until the cursor reaches those
bytes. Zero repeats indefinitely, while finite counts retain the original
decoder-restart and empty-refill stopping order. The same PCM ring, decoder
position and pending output position survive a cold World restore without
replaying the silent prefix or discarding queued samples. Stop, Release and
replacement loads discard the old queue and its scheduled output.

Own Main155/157 creation chains in SDK23, SDK63 and SDK67 cover repeat changes
to zero, two and three, two nonaligned EOF tails, mono 8-bit and stereo 16-bit
PCM, and cold restores before and after queued output begins. Captured native
ring bytes agree with the production reader and scheduled output PCM. These
are controlled output-port checks; they do not establish physical device
playback. Host initialization-failure results and remaining tag/decoder-option
shapes are separate from this primary stream lifecycle.

SDK63 and SDK67 Main903 query a selected bank's TAG resource by its original
CP932 bytes. Main155 loads the 24-byte records through the mounted category
path; duplicate names retain the first record. Names remain case sensitive,
empty names are valid, and CP932 byte aliases retain independent values.
Cold restoration and device-bank release preserve these keys; replacement
loads own a fresh map. Decoding happens when tags cross into a host voice UI.
The original selector -1 branch addresses a tree outside the bank tag array,
so it remains diagnostic instead of returning an inferred first-bank match.
SDK23 has no raw Main903 table slot.

SDK63/SDK67 Main935 and Main936 convert unsigned 60Hz ticks to a DWORD count
of whole milliseconds, then let the owning PCM decoder prepend silent whole
frames. This changes real buffer contents. The source sample-count query
continues to report the original file frames. A stream keeps its bounded
four-second ring, consumes initial silence once, and uses the native refill
and termination counters; a long silent prefix does not allocate a matching
AudioBuffer. Static buffers include the prefix in their capacity and repeat
that stored buffer. Stop rewinds the decoder without restoring consumed
silence, preserving static capacity by filling its remaining tail with silence.
Pause retains the reader and cursor; cold restore retains the same ring,
remaining prefix and output scheduling. Release discards the bank's decoded
buffer owner. This path covers PCM WAVE 8/16-bit source bytes. SDK23 has no raw
Main935/936 slots.

The integer MS ADPCM decoder preserves SDK63/SDK67's own RIFF accounting,
signed prediction/adaptation and mono/stereo interleaving. Its advertised byte
count comes from an initial scan after the format coefficients; actual reads
restart at the data payload and stop eight bytes before the container chunk
end. The two lengths remain separate. Invalid predictors and partial block
headers retain diagnostics for the original's undefined memory reads. This
reader overwrites the original destination after consuming a partial silent
prefix, leaving the rest of the returned region with its previous bytes. Its
seek operation restarts instead of honoring the target. Static capacity retains
the advertised count plus the prefix, with the decoder's shorter output and
remaining tail kept separate. Streams present the actual bounded ring and
replace its scheduled source at refill boundaries; they do not approximate
that discontinuous output with an offset into the source file. Pause, Stop,
replacement loads, finite repeats, allocated banks and cold restore retain the
same decoder/prefix/ring ownership. No checkpoint fields or production modules
are added by this codec path.

MS ADPCM is selected only by the proved SDK63/SDK67 policy, for mono/stereo
4-bit blocks with owned coefficients and complete block headers. A stream
whose half-second region splits a PCM frame remains diagnostic until its
native word-write overrun is modeled; static decoding does not need that
restriction. Other decoder options, including Ogg, remain diagnostic pending
their own codec output and lifecycle proofs. Controlled VFS/COM output and
scheduled AudioBuffer PCM checks do not establish physical device playback.

## Modern primary completion and ownership

The exact SDK74 and plain SDK76 primary managers now use the common native
buffer-completion path. Their original parsed Scripts load two nonempty PCM8
WAV sources through the normal FileServer, query and consume gain/pan, receive
real virtual completion events, repeat, pause, resume, stop, rebind and release.
Completion counts survive pause, reset on Play/Stop, and the saved remaining
repeat count survives reconstruction in a fresh World. This behavior also
retains the already qualified SDK23/63/67 path; it is not an ABI capability.

The source buffers and completed PCM bytes are independently owned. The finite
COM-memory output and matching WebAudio clock prove CPU-visible samples and
state, not physical sound, alternate backend 104, spatial output or additional
stream/decoder shapes. The SDK74 probe's by-type group miss and incorrect
final comparison remain author-input observations; SDK76 separately exercises
positive by-ID allocation and the result-dependent Script branch. The original
pause/resume cancels the pending fade, so its later queried value remains 37.

The nonempty modern SoundConfig group uses the original Engine-class reader,
resource-authored Settings INT rows, normal FileServer mounts and real WAV/TAG
sources. Its parsed Script consumes master/filename/type/key fields in an
arithmetic checksum, uses effective volume and TAG values in peer bank setters,
and loads a source from the actual configured group. The CP932 TAG first-insert
value remains independent after peer replacement. The original reader releases
its XML input; current owners also survive source-buffer overwrite and a fresh
checkpoint owner constructed from changed configuration XML.

SDK74 executes the complete finite field group. SDK76 independently executes the
same nonempty producer and each selector context; its remaining field getters
reuse complete equivalent bodies, preserving record offsets, defaults, control
flow and actual lookup context. A separate SDK76 parsed program consumes that
whole group. Counts distinguish these bridges from new native executions. This
is a qualified Engine-class/data-owner and controlled filesystem scope, not
WinMain, full Application startup or a physical audio device.

## Primary decoder option and initialized legacy metadata

SDK74 and plain SDK76 Main935/936 use the same PCM decoder silence prefix as
SDK63/67. Whole unsigned 60Hz ticks become whole milliseconds before the decoder
adds whole sample frames. Prefix bytes count toward the short-source static
conversion threshold and stored static capacity, while Main569 still returns
the original file's frame count. This is common decoder behavior, not a build
capability. Unsupported codecs retain their existing diagnostic.

The finite modern group uses real FileServer resources, two distinct PCM8
sources, fixed and allocated banks, nonzero prefixes, completion events,
pause/resume, replacement, release and fresh checkpoint owners. Original COM
buffer bytes and Script queries match current output. Main400's authored table
is loaded into the actual Sound owner and binds its ranges to declared type1;
the short source is independently confirmed to convert to static before Play.
This proves table ownership and binding, not stream loop-range playback. The
static buffer repeats its stored PCM, including its silence prefix.

Legacy filename gain, voice enable/master and voice index read initialized
Settings, separately from the newer SoundConfig table. The Engine-class startup
reader leaves derived gain words untouched until its real volume-derivation
method runs. The independent metadata bridge calls that existing method on the
original owner, then feeds filename gain through an actual loaded-bank setter
and readback into parsed Script arithmetic. The earlier pre-derivation zero
observations remain separate; they do not establish an implicit refresh rule.
SDK76 reuses the complete equivalent derivation and relevant owner context.

The exact SDK63 bridge maps its own raw Sound selectors, 32 banks and 128-byte
control records through the real factory/constructor and complete relevant
receiver/Frame bodies. Its finite integer fade end branch is distinct from any
claim about arbitrary floating-point trajectories. A parsed current Script
uses normal legacy Settings, explicit FileServer paths and public Main602 group
creation, consumes completed gain/pan, and then observes Play restoring the base
gain. It replaces two prefixed PCM sources and completes pending release across
four fresh current owners. This reuses the corrected original primary-source
and bounded COM/allocator/CRT receipts plus the complete body/context bridges;
it is no new native SDK63 execution or full Application qualification.

The two normal loop-table entries are distinct. Duplicate-entry mutation,
stream range playback, alternate backend104, spatial/physical output and other
codec options remain outside this finite bridge. SDK63's original stereo default
is established by its actual Settings initializer; the pan bridge does not
invent a new profile flag or replace an uninitialized field.

A normal repeated-key modern table keeps the first end while updating start;
the loaded short type1 owner therefore receives 32/4000 from rows 16/4000 and
32/6000. SDK74's original resource/Script/decoder group verifies that binding
and normal release; the complete SDK63/67/76 writers have the same relevant
update rule. Independent modern current owners retain it across reconstruction.
The existing shared implementation already implements this behavior.
