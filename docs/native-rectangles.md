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
