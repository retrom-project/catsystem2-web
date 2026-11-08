# Native system clock

`NativeWorld.clock` owns the system time used by KCS `main4`, the original
engine's Windows imports and particle DLLs. `GetTickCount` and
`WINMM.timeGetTime` expose its low unsigned 32-bit millisecond word;
`QueryPerformanceCounter` exposes the same elapsed time at a declared frequency
of 1,000,000 counts per second. `GetSystemTimeAsFileTime` and the KCS current-date
service use its UTC origin and elapsed time. Neither native task frame counters
nor PPF `Frame`/`Before` derive from these timer values.

The default clock starts at elapsed zero and anchors UTC to the host's current
date when the World is constructed. Each `World.tick` adds exactly `1000/fps`
milliseconds using a reduced BigInt fraction. Changing FPS changes the next
increment; it does not reinterpret earlier frames. Sixty ticks at 60 FPS are
exactly 1,000 milliseconds, including the integer API conversions. A nonpositive
or nonintegral virtual FPS is an explicit error; an external clock is required
when no frame duration is available.

`host.nativeTimeGetTime` can supply an external millisecond clock. Its fractional
values retain their IEEE-754 value exactly in the shared rational state. A
DWORD timer rollover is unwrapped for QPC and UTC, while DWORD APIs still wrap.
Other backwards movement is an explicit provider error. An external clock does
not advance when a logical frame advances.

Checkpoints save the elapsed fraction and UTC origin once, in the World. On a
fresh restore, an external provider is rebased to the saved elapsed time, so a
new browser navigation's timer origin cannot change the saved time. The new
World owns its own clock; resuming it does not advance the old World. The native
engine and restored PPI runtimes receive that same clock object. Floating-point
test harnesses may still inject `now: () => 0, epoch: 0` directly into standalone
PPI execution; mounted Worlds use the current UTC origin.

`tests/native-system-clock.test.mjs` checks exact accumulation, mixed FPS,
fractional external input, DWORD rollover, QPC/FILETIME precision, portable
BigInt checkpoints, World/VM/PPI sharing and independent restore. With the fixed
EXE fixtures, it executes both complete original `main4` wrappers and Windows
imports before and after a fresh native-process checkpoint. The existing SDK
full-startup/PPI checkpoint test also exercises the shared clock through the
original renderer initialization.

The platform representation follows the documented
[timeGetTime DWORD rollover](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timegettime),
[QPC counter/frequency contract](https://learn.microsoft.com/en-us/windows/win32/api/profileapi/nf-profileapi-queryperformancecounter)
and [UTC FILETIME contract](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemtimeasfiletime).
The exact virtual frame step and saved UTC origin are browser host policy,
separate from the original engine's frame scheduling semantics.
