# Native Wipe2 area effect

KCS can create the original `Task_Eff2D_Wipe2` task with kind 29. Both frozen
profiles run the original constructor, packet receiver, frame update, masked
bitmap drawing and destructor in the shared PE process. The area effect writes
to the native view's bitmap upload path.

| Main slot | Arguments                  | Control | Game entry | SDK entry | Game / SDK message           |
| --------- | -------------------------- | ------- | ---------- | --------- | ---------------------------- |
| `C4`      | Task ID, VM packet address | 2       | `641600`   | `529770`  | 13, then 274 / 269 for Wipe2 |
| `C5`      | Task ID                    | 2       | `6419A0`   | `529B10`  | 257 / 252                    |
| `C6`      | Task ID                    | 2       | `6419D0`   | `529B40`  | 258 / 253                    |
| `C8`      | Task ID                    | 1       | `641840`   | `5299B0`  | 259 / 254                    |
| `CB`      | Task ID                    | 2       | `6415D0`   | `529740`  | 261 / 256                    |

`C4` queries the receiver's kind before reading the VM address. The original
`GCALL` leaves the native table slot address in ECX, which `C4` initially saves
in its query word. When the receiver leaves that word unwritten, the slot address
fails the effect-kind check. With a matching kind, the original wrapper translates
the address and sends the corresponding init message. VM address zero can refer
to mapped data. `C8` reuses its caller pointer argument as result storage. When
the receiver leaves it unwritten, the returned word is the original caller's
guest identity. Messages resolve task IDs from the calling task's Top namespace.

The Wipe2 initializer copies 56 bytes and borrows the bitmap wrappers in words
1, 4 and 7. Its receiver owns the work bitmap and releases it on reinitialization
and destruction. A missing required wrapper leaves initialization unsuccessful.
For a KCS packet containing browser bitmap handles, the transport substitutes the
persistent PE wrappers in a temporary copy. Borrowed PE wrapper identities from
`2BF` and `2C5` remain PE pointers. The VM packet, the wrappers' owners and the
borrowed reference counts remain intact.

`C5` starts an initialized effect at its current native task clock. `C8` reads
the active flag. `C6` uploads the destination for any initialized effect, while
`CB` does so only for an active effect. During playback the original rasterizer
compares the first byte of each 32-bit mask pixel with the threshold computed from
elapsed frames and duration. At natural completion it uploads the destination
and clears the active flag. The receiver also accepts original message 260 / 255
to replace the borrowed source and destination wrappers.

## Verification

`scripts/verify-native-area-effect-commands.mjs` executes both complete frozen
wrappers and the adapter with an independent observing transport. Each profile
runs 1,528 wrapper cases with 10,868 comparisons over all initializer kind branches,
data, shared and extended VM regions, missing addresses, receiver writes, output
canaries and unwritten replies. A second phase in the same script runs the original
task factory, Wipe2 receiver, frame driver, draw and destruction. Its 52 checks per
profile use authored bitmaps and record the uploaded bytes at the view boundary.

`tests/browser/native-area-effect.spec.mjs` runs authored KCS in both profiles,
displays the native upload through a real VRAM plane and compares exact RGBA
pixels. It restores a fresh World mid-effect, verifies the next frame, then
exercises both finish commands and destruction. It also checks that source
ownership stays with the KCS resource list or bitmap owner. Frozen executables
and raw reports stay outside version control.

The wrapper checks cover the routing envelope for every `C4` kind. The original
receiver and browser pixel checks here cover kind 29. The remaining effect work includes other `C4` receiver types and the
`C7`, `C9` and `CA` wrappers.
