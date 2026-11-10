# Domain 5 implementation review

The phase-5 starting inventory had 30 `unknown` implementation slots. They
already had recovered semantic names; uncertainty concerned receiver ownership
and executable delegation, not the name or signature. Both frozen main tables
now use the independently owned JS image/text receivers. All 30 entries carry
an explicit phase-5 review in their ABI data.

| ID  | Meaning                   | Both-ABI conclusion                                 |
| --- | ------------------------- | --------------------------------------------------- |
| F1  | image.saveEntry           | JS global-file serializer reads owned bitmap bytes. |
| FB  | image.loadEntry           | JS decoder creates owned bitmap bytes.              |
| 263 | text.defaultConfiguration | Canonical config packet, JS text receiver.          |
| 264 | text.configure            | JS writer initialization, packet size checked.      |
| 265 | text.updateConfiguration  | JS reconfiguration and restart semantics.           |
| 266 | text.appendFormatted      | Raw formatter bytes, one expansion, JS source.      |
| 267 | text.clear                | JS records/pixels/clocks reset.                     |
| 268 | text.remaining            | Exact cached/dirty/page-aware JS count.             |
| 269 | text.finish               | JS reveal at unsigned frame -1.                     |
| 26A | text.mark                 | Explicit JS marker, incremental state preserved.    |
| 26B | text.setPageLimit         | JS page limit and restart.                          |
| 26C | text.setImageFont         | Direct JS buffer bytes; no PE descriptor needed.    |
| 26D | text.setCharacterImage    | JS character-to-selector map.                       |
| 2B7 | text.setSpeed             | JS clock rebase.                                    |
| 374 | text.remainingPage        | JS page-bounded remaining count.                    |

The image implementations are
[`image-persistence.mjs`](../src/native/image-persistence.mjs) and the text
implementations are [`text-task.mjs`](../src/native/text-task.mjs),
[`text-core.mjs`](../src/native/text-core.mjs) and
[`text-legacy.mjs`](../src/native/text-legacy.mjs). Normal World registration,
receiver creation and feature factories are traced by `scripts/b-migration.mjs`.
Sending arbitrary text messages to another task type remains the general
message-transport contract, owned by domain 8; it does not make the text parser
an EXE implementation.

F1/FB can receive views of D6/D7-owned rendering targets. That view is a
registered consumer output, distinct from an owned JS script bitmap. It does
not change JS bitmap authority. The remaining consumer representations and
removal phases are listed in `b-migration.json`.

## Receiver and transport evidence

The complete original 13 later text wrappers are exercised by
`scripts/verify-native-text.mjs`: 208 inputs per ABI, 416 comparisons of control,
return and semantic message payload. `26C` now reads the canonical JS buffer
store. The receiver consumes the source reference only when a writer exists,
after accepting a copied image-font resource; an uninitialized/missing receiver
leaves the source untouched. A public Node regression explicitly makes any EXE
projection request fail. Deferred resource bytes and pixels are tested against
the original image-font engines separately.

`tests/differential/native-text-wrappers-js.test.mjs` compares all 21 task-8
wrappers for both ABIs, including raw configuration lists, formatting, control,
query payloads and missing receivers. Wrapper `86` transports a terminated
16-bit CP932-code list (including sign-extended single bytes), not a narrow
C string. The task-8 receiver intentionally leaves messages 114/115 unhandled;
the wrappers still send the original packet and return control 2. A missing
receiver's unwritten `81` query has no stable scalar result and is excluded
from scalar equality; successful receiver queries and `187`'s initialized
zero output remain covered. No original task-8 feature was invented.

Layout, fonts, reveal, state sequences, NV task messages, pixel arithmetic and
checkpoints are covered by the differential families described in
[native text](native-text.md). CPU pixels and integer positions use tolerance 0.
The original GDI platform boundary and private fixtures remain explicit.

No domain-5 slot is retained as unsupported or excused as unreachable. The
former 30 unknowns are implemented; the four stale image-view review notes are
closed by their registered D6/D7 ownership boundary.
