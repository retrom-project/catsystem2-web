# JavaScript RECT interfaces

The five main-table RECT operations execute synchronously in JavaScript, using
VM memory and JS-owned bitmap dimensions. Rectangles are half-open, signed 32-bit
left/top/right/bottom bounds. Empty means left >= right or top >= bottom.
No EXE, bitmap-memory wrapper or transitional call is required.

| ID   | Arguments                                     | Control/result                                | Game handler | SDK handler |
| ---- | --------------------------------------------- | --------------------------------------------- | ------------ | ----------- |
| `D6` | VM rectangle                                  | `2`, clear all four words                     | `644E60`     | `52AA50`    |
| `D7` | VM destination rectangle, VM source rectangle | `2`, union into destination                   | `644D00`     | `52A8F0`    |
| `D8` | VM rectangle, bitmap or NULL, x, y            | `2`, union bitmap extent into destination     | `644DA0`     | `52A990`    |
| `D9` | VM rectangle                                  | `1`, empty flag                               | `644F40`     | `52AB30`    |
| `DA` | VM rectangle, left, top, right, bottom        | `2`, intersect destination with inline bounds | `644EB0`     | `52AAA0`    |

`D7` and `DA` copy their inputs into local RECTs before writing the VM
destination. A source that partially overlaps the destination consequently
uses the original words. An empty intersection becomes four zero words. Union
ignores an empty input and produces four zeros if both inputs are empty.
The wrapper discards the platform union/intersection BOOL and returns void.

`D8` reads the JS bitmap handle's physical width and height, ignoring canvas size and offsets.
A NULL image wrapper or a wrapper without a bitmap contributes zero width and
height. The original x+width and y+height additions wrap as DWORD arithmetic
before USER32 interprets the resulting signed edges. No JavaScript bounds or
overflow normalization replaces those instructions.

VM address zero denotes the beginning of the VM data region. It is passed
through the original translator; it is not treated as a NULL rectangle.
Data, stack, shared memory and extension blocks use the same live memory
mapping as other original native calls. These interfaces own no rectangle
state beyond the caller's VM memory and add no bitmap copy or separate pixel
authority.

`verify-native-rectangles.mjs` executes **4,048 complete wrappers and 20,306
comparisons per frozen executable**, or **40,612 comparisons** across both
profiles. It checks frozen table slots, controls, untouched void results,
result canaries, entire VM regions and image metadata. Authored cases cover
signed integer limits, arithmetic wrap, empty/inverted rectangles, unaligned
and overlapping addresses, all VM regions, NULL images, empty image wrappers,
and adjacent GCALL words when the supplied argument array is shorter.
USER32 and authored image records are explicit boundaries of that probe.

`native-rectangle-oracle.py` separately measures **748** authored USER32 cases
in the pinned isolated Wine environment. Public tests compare complete RECT
outputs, BOOLs and canaries for both signed/empty inputs and aliased API
destinations. Additional tests execute both original wrapper families and a
full SDK World with an actual persistent image wrapper. A fresh World retains
VM rectangles and the original image pointer; changes to its VM and image
metadata leave the source World independent. Raw engine output and reports
remain in ignored local storage.

Independent JS-versus-original GCALL and public golden cases are in
`tests/fixtures/view-rectangle-cases.mjs`; every VM byte, return word, control,
logical handle and task state compares exactly. Authored bitmap dimensions are
projected into original read-only image records on the oracle side. The original
facade and exhaustive original-only probes remain under `oracle/rectangles.mjs`.

## SDK63 and SDK67 normal typed callers

SDK63 Main214–217 now run after each exact build's real CRT, resource host,
Script/Main143 VM and existing software View initialization. Each primary group
uses 22 target and nine dependency/bootstrap GCALLs with independent 16-byte
signed/empty RECTs. Main216 borrows a real Main112 bitmap's dimensions and
Main114 releases it; the group adds no rendering or pixel authority. Existing
748-case Wine results qualify the shared USER32 leaf separately from the new
original wrapper/translation/control and untouched-byte observations.

The initial SDK63 primary record declares bitmap sizes from constructor input;
it does not observe their physical fields. A separate one-target witness reads
those fields and uses an empty destination so Main216 output exposes both actual
7x5 dimensions. SDK67's primary group includes this direct metadata observation
and empty-destination form. Eight SDK63 and seven SDK67 fresh current World
continuations compare all RECT bytes and live bitmap dimensions. Overlap, foreign
owners and additional layouts are outside this group; the old authored bitmap
projection evidence is not promoted to true ownership qualification. Native
GAME_SAVE/CSS and the existing internal owner codecs are unchanged.
