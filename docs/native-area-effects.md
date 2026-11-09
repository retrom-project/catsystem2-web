# Native area effect controls

KCS can create the original `Task_Eff2D_Wipe2` task with kind 29. Both frozen
profiles run the original constructor, packet receiver, frame update, masked
bitmap drawing and destructor in the shared PE process. The area effect writes
to the native view's bitmap upload path.

Kinds 30 and 31 run the original Wipe3 and WipeAlpha3 tasks through that same
path. Wipe3's 60-byte initializer borrows bitmaps at offsets 8, 20 and 32. It
copies destination RGB into fully transparent pixels of the borrowed source.
WipeAlpha3's 52-byte initializer borrows bitmaps at offsets 8 and 20 and
requires 32-bit sources and mask. Its two alpha directions can end naturally
on a different frame from the explicit `C6` and `CB` finish operations.

| Main slot | Arguments                  | Control | Game entry | SDK entry | Game / SDK message                    |
| --------- | -------------------------- | ------- | ---------- | --------- | ------------------------------------- |
| `C4`      | Task ID, VM packet address | 2       | `641600`   | `529770`  | 13, then 274 / 269 for Wipe2          |
| `C5`      | Task ID                    | 2       | `6419A0`   | `529B10`  | 257 / 252                             |
| `C6`      | Task ID                    | 2       | `6419D0`   | `529B40`  | 258 / 253                             |
| `C7`      | Task ID, VM matrix address | 2       | `641880`   | `5299F0`  | 262 / 257                             |
| `C8`      | Task ID                    | 1       | `641840`   | `5299B0`  | 259 / 254                             |
| `C9`      | Task ID, selector, VM data | 2       | `641910`   | `529A80`  | 13, then 264 / 259 or 273 / 268       |
| `CA`      | Task ID, VM source pair    | 2       | `641A00`   | `529B70`  | 13, then 260 / 255 for Wipe1 and Fade |
| `CB`      | Task ID                    | 2       | `6415D0`   | `529740`  | 261 / 256                             |

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
and clears the active flag. The Wipe2 receiver also accepts message 260 / 255.
The main `CA` wrapper only sends that message to kind 26 (Wipe1) and kind 27
(Fade). Its 20-byte packet borrows the new source and destination at offsets
4 and 16. The original receiver keeps the active clock and work bitmap, and
Fade still checks the pair's dimensions and pixel format.

With selector zero, `C9` queries the target kind and sends its mapped packet
to Raster (kind 18) or Hydro (kind 25). The original Raster initializes from
`C4`, updates its parameters through `C9`, and draws through the original
GraphManager callback. Stop or destruction removes that callback. Hydro's
receiver leaves this message unhandled; the wrapper still completes.

UnderWater (kind 17) is an original task without a rendered surface. Its
receiver leaves query outputs unwritten and ignores the KCS delete message.
The original draw bookkeeping still advances its draw clock. The tested
lifecycle covers UnderWater as a child; registering children under it needs
separate task namespace handling.

RainDrop (kind 19) takes the original 40-byte `C4` packet and updates its
separate source and projected arrays using the native clock and shared random
stream. The original graph callback draws pretransformed diffuse line lists.
`C6` stops the effect; `CB` leaves it active.

GlassBreak (kind 20) initializes from a 12-byte `C4` packet (graph ID,
float speed and duration). The original start reads the live graph geometry,
creates shard records, and installs its vertex callback. Completion, `C6`
and destruction detach that callback. `CB` does not address this kind.

`C7` translates the VM address, copies exactly 64 bytes to the original stack,
and sends that copy with zero `w` and flags. The original wrappers fault on a
failed translation before sending. The original receiver scan found no matrix
consumers among the inspected task types. Raster and SimplePlane receive the
packet without changing the active effect or applying a matrix to the scene.

## Verification

`scripts/verify-native-area-effect-commands.mjs` executes both complete frozen
wrappers and the adapter with an independent observing transport. Each profile
runs 7,288 wrapper cases with 56,869 comparisons over initializer, replacement
and live-update branches, data, shared and extended VM regions, missing addresses,
receiver writes, output canaries and unwritten replies. Its 620 receiver checks
per profile execute the original Wipe2, Wipe1/Fade, Raster, Hydro, Wipe3,
WipeAlpha3, UnderWater, RainDrop and GlassBreak paths.

`tests/browser/native-area-effect.spec.mjs` runs authored KCS in both profiles,
displays the native upload through a real VRAM plane and compares exact RGBA
pixels. It restores a fresh World mid-effect, verifies the next frame, then
exercises both finish commands and destruction. A separate test replaces Wipe1
and Fade sources during playback and verifies the next pixels before and after
fresh restore. Another test exercises the original Raster callback, reads
its rendered pixels after fresh restore and verifies callback removal on
stop and active destruction. It also verifies that the original `C7` packet is a
stack copy and has no visual effect. Source ownership stays with the KCS resource
list or bitmap owner. Frozen executables and raw reports stay outside version control.

The wrapper checks cover the routing envelope for every `C4` kind. Native
initialization and fresh browser pixel checks cover Raster, RainDrop, GlassBreak
and Wipe2 through WipeAlpha3. Other `C4` receiver types still require verification.
