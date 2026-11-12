# Startup resource verification

The ordinary `CatSystem2.initialize` path uses the existing World/configuration,
NativeFileStorage and integer/real MT owners. PE input is data only; it never
opens a native process. Only the two registered ABIs are enabled.

| Input               | Current behavior                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP/v_code`        | Exact owned native XML text bytes via `nativeXMLTextBytes`, without Unicode re-encoding, trim or entity substitution; explicit ABI narrow encoding (74 CP932, 76 UTF-8), first NUL, default `open_cs2` only when absent. The original 260-byte field overflow is diagnosed at 260 bytes, not truncated.                                                        |
| `KEY_CODE/KEY`      | Missing, zero-size, failed backing read, or size >512 retains `open_cs2`. For 1..511 bytes XOR CD, then use first NUL. Empty effective key and original size512 unsafe domain are diagnosed. No 56-byte modern limit; only first72 bytes can affect this schedule.                                                                                             |
| `V_CODE/DATA`       | Missing skips compare. Present zero-size/read error fails. Decrypt two LE32 words per block into size+8 zeros, no IV/padding removal. Nonaligned input leaves output zero. Game compares C bytes; this SDK wrapper unconditionally writes `open_cs2\0` over output before comparison. That difference is explicit ABI data, not inherited by unknown versions. |
| `V_CODE2/DATA`      | Same real lookup/read/decrypt and failure behavior; no invented Settings+262 state because current decrypted JS VFS has no consumer. Encrypted KIF remains rejected independently.                                                                                                                                                                             |
| `cs2_debug_key.dat` | Relative filename: Game uses its original UTF16 literal, SDK its original ANSI literal. Metadata checks the same saved-record-first/GameFiles lookup namespace as file reads, including untimed loose files. No credential bytes are read in this stage. Any existing credential reports required, unimplemented VC3 verification.                             |

Author verification precedes key selection/schedule and both code resources.
The current virtual C: Windows-directory/volume gates succeed; the two callers
use CRC without volume serial. Their MSB `04C11DB7` CRC starts FFFFFFFF and
complements **after each byte**, including the public `@@--cs2-debug-key--@@`
suffix. It seeds both canonical streams, consumes exactly32 integer draws,
then resets both streams from another local-clock sample before checking file
metadata. Missing credentials then produce false and update current authorMode;
a caller-set authorMode does not bypass verification. The 32 words will be used
by the required VC3 64-byte credential verifier; their effects are not erased by
restoring a previous MT snapshot.

The first MT constructor sample and an optional explicit scalar seed occur at
the ABI's actual position: 74 after resource/author checks and before preferences;
76 before preferences and the later checks. Explicit seed only overrides that
constructor; it does not suppress later author reset. A fresh checkpoint restores
current owners without rerunning either sample, resources, metadata or draws.
No new persistent state or checkpoint version is introduced.

The Blowfish P18/S1024 constants and lower-level layout were compared in full
for both engine inputs. Public primitive answers and authored multi-block/key
answers come from the independent designer C reference already recorded in
[startup-blowfish](native-startup-blowfish.md); tests never compile it or read
private resources. Resource bounds/failure injection tests validate the JS data
boundary, not live Win32 allocation/LockResource failures. The current service
has no successful full-author credential path, encrypted KIF consumer, or claim
of native execution/dynamic startup equivalence.

The native XML byte owner/handle codec was closed independently before this
consumer was connected. SDK FA40 and its Unicode-equivalent CP932 EEEF remain
different CRC inputs; Game UTF-8 also reaches CRC as its original normalized
bytes. The derived `text` view is never used to regenerate startup code bytes.
Element-name alias lookup is outside that text ownership proof.
