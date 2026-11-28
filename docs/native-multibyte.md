# Windows multibyte input conversion

The engine and PPI share `MultiByteToWideChar` through the same platform
provider. The Japanese platform's ANSI, OEM and thread ANSI aliases use CP932;
CP_UTF8 uses its separate decoder. The import preserves signed input lengths,
the size-query path, raw UTF-16 units, and the last-error and output-buffer
effects of conversion. A negative input length takes the original
NUL-terminated path. Zero length, NULL input and a NULL destination with a
positive capacity fail without converting memory.

CP932 uses the Windows control and private-use mappings, including the original
default character for invalid byte pairs. Strict mode validates before writing.
Composite mode emits complete decomposed character groups. UTF8 retains the
reference platform's invalid-prefix consumption and UTF-16 output units.
Failure can leave a converted prefix in the destination. The pinned platform's
UTF8 writer can leave a final high surrogate when only one unit remains;
callers can query the required length before conversion. These observations
describe the reference platform, including its undersized-buffer behavior.

The public import rejects identical source/destination pointers, mutually
exclusive composition flags, and UTF8 flags other than zero or strict invalid
character checking. These cases follow the documented [Windows API
contract](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar)
when the pinned Wine implementation accepts a forbidden call. The companion
[wide character converter](native-widechar.md) handles UTF-16 to multibyte output.

`scripts/native-multibyte-oracle.py` records complete 128-byte output buffers
for 5,356 authored calls in the pinned Japanese Wine environment. Tests compare
2,972 applicable records, retaining canaries and last error, and separately
check the documented invalid-argument cases. Two complete-stream hashes cover
31,232 CP932 inputs (every single byte and lead/trail pair in both modes) and
152,880 UTF8 inputs (all single bytes/pairs and three/four-byte boundary
matrices, including truncated four-byte prefixes). Their records include
result, last error and the full output buffer. The fixture compresses trailing
canaries; the private report retains every original byte.

The original game ANSI file reader does not check a failed conversion before
using its filename scratch buffer. Its NULL-input regression therefore fixes
the test's initial scratch bytes. The adapter leaves the caller's bytes intact
on this failure; production does not initialize original guest scratch memory.
