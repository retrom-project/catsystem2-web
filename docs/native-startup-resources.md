# Startup resource verification

The ordinary `CatSystem2.initialize` path uses the existing World/configuration,
NativeFileStorage and integer/real MT owners. PE input is data only; it never
opens a native process. Only the two registered ABIs are enabled.

| Input               | Current behavior                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP/v_code`        | Exact owned native XML text bytes via `nativeXMLTextBytes`, without Unicode re-encoding, trim or entity substitution; explicit ABI narrow encoding (74 CP932, 76 UTF-8), first NUL. An absent element requires own reviewed ABI `defaultCodeBytes`; an unknown default is diagnosed. The original 260-byte field overflow is diagnosed at 260 bytes, not truncated.                                                                                          |
| `KEY_CODE/KEY`      | Missing, zero-size, failed backing read, or size >512 retains `open_cs2`. For 1..511 bytes XOR CD, then use first NUL. Empty effective key and original size512 unsafe domain are diagnosed. No 56-byte modern limit; only first72 bytes can affect this schedule.                                                                                                                                                                                           |
| `V_CODE/DATA`       | Missing skips compare. Present zero-size/read error fails. Decrypt two LE32 words per block into size+8 zeros, no IV/padding removal. Nonaligned input leaves output zero. Game compares C bytes; this SDK wrapper unconditionally writes `open_cs2\0` over output before comparison. That difference is explicit ABI data, not inherited by unknown versions.                                                                                               |
| `V_CODE2/DATA`      | Same real lookup/read/decrypt and failure behavior; no invented Settings+262 state because current decrypted JS VFS has no consumer. Encrypted KIF remains rejected independently.                                                                                                                                                                                                                                                                           |
| `cs2_debug_key.dat` | Relative filename: Game uses its original UTF16 literal, SDK its original ANSI literal. Metadata checks the same saved-record-first/GameFiles lookup namespace as file reads, including untimed loose files. Only an actual64-byte record is read. An absent, differently sized, unreadable or short record produces false. The first16 of the32 actual integer draws form a binary64-byte LE32 Blowfish key; decrypted16 words must equal the last16 draws. |

Author verification precedes key selection/schedule and both code resources.
The current virtual C: Windows-directory/volume gates succeed; the two callers
use CRC without volume serial. Their MSB `04C11DB7` CRC starts FFFFFFFF and
complements **after each byte**, including the public `@@--cs2-debug-key--@@`
suffix. It seeds both canonical streams, consumes exactly32 integer draws,
then resets both streams from another local-clock sample before checking file
metadata. The same32 words remain local to that check: there is no replay,
second stream or new checkpoint state. Credential key bytes include NUL and all64
bytes participate; neither CString truncation nor a56-byte cap applies. Exact
validation updates the existing authorMode and returns its boolean. Invalid
credentials produce false; a caller-set authorMode does not bypass verification.
Only file-read I/O exceptions follow that false branch; malformed metadata/byte
providers and cipher errors propagate. A valid author bypasses only the V_CODE
comparison, so key and V_CODE/V_CODE2 resource failures still propagate. No prior
MT snapshot is restored to erase these effects.

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
has no encrypted KIF consumer or claim of native execution/dynamic startup
equivalence. The public authored64-byte credential vectors use the already
validated canonical MT as an explicit input dependency, the independently checked
CRC fixtures, and one batch of the designer C reference for ciphertext. A key
with an internal NUL and a separately encrypted last-word mismatch are included;
normal tests need no compiler, private credential or original executable.

The native XML byte owner/handle codec was closed independently before this
consumer was connected. SDK FA40 and its Unicode-equivalent CP932 EEEF remain
different CRC inputs; Game UTF-8 also reaches CRC as its original normalized
bytes. The derived `text` view is never used to regenerate startup code bytes.
Element-name alias lookup is outside that text ownership proof.

`APP/v_code` defaults are separate from the public `KEY_CODE` fallback and the
SDK decrypted-output overwrite. Neither proves this Settings default. The current
registered data does not specify `startup.verification.defaultCodeBytes`, so its
ordinary entry requires an explicit APP value. A future reviewed default is a
JSON byte array, preserving narrow aliases and the first NUL without a Unicode
roundtrip; an empty array is a known empty default, and an omitted field is unknown.
The registered profiles and native slots are unchanged. Owned test startup
creators explicitly author their public APP bytes; actual mounted game XML is
never injected or rewritten to bypass a missing default. This restriction does
not claim that either original engine lacks a compiled default.
