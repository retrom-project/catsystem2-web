# Compiled content database objects

The native range `2E6..340` contains four separate object families, together
exposing **85 interfaces**. Slots `311..316` are unrelated log, math, view,
movie and configuration functions; they are not operations on the 620-byte
object at the start of the range.

[The implementation](../src/native/content-databases.mjs) executes each profile's
complete original wrappers and data helpers. Names such as “question” and
“mission” are project descriptions inferred from the `Q/A1..A4`, `GENRE_*`,
`CLIENT/REWARD/COND` and related resource fields. Catalog operations whose
business meaning is not independently established retain their native ID in
the descriptive name.

| Family                 | Native IDs         | Owner bytes | Resource and persistent state                                                     |
| ---------------------- | ------------------ | ----------: | --------------------------------------------------------------------------------- |
| Question/configuration | 2E6..30A           |         620 | Grouped questions, named text configurations, active pools, members and counters  |
| Name selection         | 30B..310, 33D..340 |          12 | Name-to-value registration, 19-column selection rows and mutable working list     |
| General KCDB reader    | 317..31A           |          16 | Schema, fixed-width rows and unconverted column bytes                             |
| Mission/conditions     | 31B..33C           |          20 | Compiled records, completion/availability state and twenty character-stat records |

The independent 80-byte index/flag database exposed by `365..` is documented
[separately](native-databases.md). It is not an interchangeable object type.

## Resource and object contracts

KCDB files use a compressed schema and fixed-width record payload. The question
loader consumes `G_A/G_B/G_C`, `ID`, `IMG`, `Q` and four answer fields.
Its text configuration loader retains the original section parser, options,
member/partner sets, genre ranges and exclusions. Loading a configuration and
rebuilding the pool are separate operations. Question selection retains the
original counter ordering and random draw; copying text, incrementing counters
or resetting member flags are separate native operations.

Selection tables read `TBL` and `P00..P18`. Names are registered before the
table is loaded. A name's registered value, a table ID, a working-list index and
the consumed/high-bit markers are distinct values. The original parser and
mutation helpers determine trimming, duplicate and missing-name behavior.

The general reader accepts an arbitrary compiled schema. `319` copies at most
four bytes into a zero-initialized result word; larger fields produce zero.
`31A` copies the complete declared field width to its VM destination and returns
that width. It does not turn a fixed byte field into a newly terminated string.
The byte-level field semantics preserve CP932, other encodings and invalid byte
sequences without a text round trip.

Mission records retain level limits, dependency keys, condition parameter
vectors, character sets, priority, four question-table names and twenty `PTnn`
fields. Availability, selection, completion and elapsed updates are separate
operations. The original condition switch covers codes 0, 1, 2, 3, 10, 11, 20,
21, 30, 40 and 41; unknown codes retain the original behavior. Character
statistics use twenty six-word records. The adapter does not infer a generic
JavaScript quest policy from those fields.

## Ownership and saving

Each opaque `content-database` handle stores the family and original owner
pointer. All trees, vectors, strings and state remain in the single shared
engine process. Family checks protect the browser handle boundary; resource
parsing and native index checks still run in the original code. Missing or
invalid resources retain each wrapper's own success, empty-owner or failure
behavior. One family's failure is not used as another family's default.

Question `2FF/300` and mission `337/338` serialize to **raw PE pointers**;
they do not translate these pointers as KCS addresses. They interoperate with
heap natives `341..344` and CSS global-file entries:

- Question state has a 12-byte header and 88-byte records. Each record retains a
  64-byte database filename, question ID and five state words. Bytes following
  the filename's terminator are not written by the original exporter.
- Mission state has a 36-byte offset/size/count header, 24-byte mission records,
  28-byte indexed character records and a final total word. The original import
  helper validates its byte count and updates the existing resource records.

A World checkpoint saves the shared process once, then restores the same four
owner identities and VM arenas. CSS loading creates resources normally and
imports their serializable progress. These paths share authoritative state;
a World snapshot does not replace the system script's native save object.

## Shared random state

[Native random memory](../src/native/random-memory.mjs) binds both canonical
`NativeMT19937` streams directly to the reviewed original globals. JavaScript
`rand/frand` and original PE draws immediately observe the same words and cursor.
There is no call-boundary state copy. The integer and real streams remain
independent. Providers acquire fresh views after WASM growth, survive fresh
process restoration and detach while preserving state on process close.

SDK seed/draw functions and globals were recovered independently from its image.
Both profiles' original seed functions and main `21/22` wrappers are tested
against interleaved JavaScript draws over four seeds and multiple 624-word
twists. The original unseeded index 625 selects the native default seed 4357.

## Verification

`scripts/verify-native-content-databases.mjs` executes **2,117 complete wrapper
calls and 20,734 comparisons per profile**, **41,468 comparisons** total. It
covers all 85 interfaces and compares complete VM/shared/block memory, every
live original allocation, raw serialization buffers, and both original RNG
states and cursors.

The authored resources exercise question/configuration parsing and selection,
all mission condition codes listed above, valid and out-of-range selectors,
registration duplicates, empty/missing/bad-magic resources, local/stack/shared/
extended VM destinations, adjacent GCALL words, completion/statistics changes,
reset behavior and both serialized formats. Original wrappers, parser,
conditions, containers and state serializers execute without replacement.
The mounted resource/filesystem service and reviewed CRT allocator remain
explicit host boundaries.

Four optional two-profile World tests check all four object types, independent
release, original question/mission export through `341/343/F5`, fresh CSS
`F7/344` import and fresh-World pointer identity, state and random continuation.
Question-output buffers are explicitly prefilled so unwritten filename padding
is compared as caller-owned bytes rather than a fabricated constant.

This evidence does not enumerate every possible resource, question sequence or
condition combination. Original unchecked buffer overruns and the wider game's
gallery, recollection, save UI and presentation acceptance are not claimed by
these family tests.
