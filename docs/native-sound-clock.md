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
