# Binary gallery tables

All twelve main interfaces `195..1A0` use JS-owned binary tables. Resources resolve through the existing `fes` category. Handles retain independent byte arrays and their snapshots restore into a fresh World. [Implementation](../src/native/gallery-tables.mjs).

| IDs       | Resource | Behavior                                |
| --------- | -------- | --------------------------------------- |
| 195 / 196 | Variants | Load / release                          |
| 197 / 198 | Variants | Group count / file count                |
| 199 / 19A | Variants | First / second selection count          |
| 19B       | Variants | Compose filename and selector reference |
| 19C / 19D | Names    | Load / release                          |
| 19E / 19F | Names    | Row count / test a column               |
| 1A0       | Names    | Copy a column into VM memory            |

The two original native tables both dispatch `19F` to the three-word existence query and `1A0` to the four-word copy. Phase 4 corrected their previously reversed adapter and catalog declarations. The independent differential now reads the real native-table entry for every call.

Variants require exactly 86,400 bytes, comprising twenty groups of eight 540-byte records. Counts include nonzero presence words without compacting holes. Reference selection also checks the cached group and file counts, sixteen-selector bounds and signed stored choice counts. Nonzero mask bytes other than ASCII `0` overlay the first mask with the second mask. Internal empty positions become `0`, trailing empty positions disappear, and the original two trailing NUL writes are preserved. Rejected selections preserve output.

Name tables contain a DWORD row count and four 32-byte columns per 128-byte row. Row checks are signed and column checks unsigned. A leading zero marks an absent field. Copies follow the C string into later columns when necessary. Malformed strings crossing their allocation produce a diagnostic. Missing or wrong-sized variant files produce a valid empty table. Missing name files return zero.

Both ABI differential sequences compare controls, results, every VM byte, handle lifecycle and subsequent queries through independent dispatch. Pure JS tests restore table handles without an EXE and check ownership isolation. Historical full-parser verification remains available against the oracle facade. [Differential](../tests/differential/native-gallery-tables.test.mjs), [oracle facade](../oracle/gallery-tables.mjs).
