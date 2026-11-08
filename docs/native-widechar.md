# Windows wide character output conversion

The engine and plugins share one `WideCharToMultiByte` import. The mounted
Japanese platform resolves ANSI, OEM and thread ANSI aliases to CP932 and
supports UTF-8 through code page 65001. The fixed binaries' direct converters
use flags zero. The SDK obtains its ANSI page from `GetACP`, and the game
passes CP932 directly. The CRT and plugin call sites can select a page through
their locale state, including calls that inspect the default-character flag.
Other code pages and CP932 `WC_COMPOSITECHECK` require separate caller evidence.

Positive source lengths consume exactly that many UTF-16 units, including any
embedded NUL. Negative lengths consume through the first NUL, including it.
Destination capacity zero queries the byte count without writing destination
bytes. Successful calls preserve last error. Equal source and destination
pointers fail with `ERROR_INVALID_PARAMETER`, as do a NULL source, a zero
source length, a negative capacity and a NULL destination with positive
capacity. UTF-8 requires NULL default-character arguments and accepts only
flags zero or `WC_ERR_INVALID_CHARS`. Invalid flag bits produce
`ERROR_INVALID_FLAGS`. These checks follow the documented Windows contract.
[Microsoft WideCharToMultiByte reference](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte).

CP932 reuses the measured NT ANSI mapping for each UTF-16 unit. Best-fit
mappings succeed without setting `lpUsedDefaultChar`.
`WC_NO_BEST_FIT_CHARS` substitutes the caller's default bytes for mappings that
fail a round trip. The fallback can be one or two bytes. Size queries update
the supplied BOOL, and an insufficient buffer can report a selected fallback
even when its complete byte sequence did not fit.
[NT ANSI mapping](native-registry.md).

The pinned Wine reference retains complete preceding characters on
`ERROR_INSUFFICIENT_BUFFER`. Its UTF-8 path converts valid surrogate pairs
together and substitutes U+FFFD for an unpaired unit. With
`WC_ERR_INVALID_CHARS`, a buffer large enough for the conversion can retain
those replacement bytes while the call returns zero and sets
`ERROR_NO_UNICODE_TRANSLATION`.
These write effects and error precedence come from the measured reference.
[Wine 8.0 Win32 locale implementation](https://github.com/wine-mirror/wine/blob/wine-8.0/dlls/kernelbase/locale.c),
[Wine 8.0 NT locale implementation](https://github.com/wine-mirror/wine/blob/wine-8.0/dlls/ntdll/locale.c).

`scripts/native-widechar-oracle.py` executes an authored i686 probe in the
pinned Japanese Wine image. Public tests compare 2,177 full output buffers,
return values, last errors and used-default words. Another 24 cases follow
the documented invalid-argument and invalid-flag rules where the Wine
reference can accept forbidden inputs. Two SHA-256 streams cover 131,072 CP932
and 139,264 UTF-8 conversions, including every single UTF-16 unit with and
without the respective flag, and a UTF-8 surrogate-pair boundary matrix.

Optional tests execute the complete original ANSI and UTF-8 caller pairs in
both mounted executables. The SDK uses `0x5782C0` and `0x577CE0`. The game uses
`0x6A6020` and `0x6A5300`, and five additional calls run its CRT converter at
`0x87EB68`. The tests observe the actual Win32 argument words and compare all
destination bytes, including the original UTF-8 wrapper's decision to skip
the write when its query reports insufficient space.
