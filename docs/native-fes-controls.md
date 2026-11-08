# Native FES scroll and slider controls

FES SCROLL, SCROLL2 and SLIDER execute their mounted engine's original object
constructor, definition parser, built-in commands and frame driver. Their
children are actual native tasks 40, 41 and 42. The original task code creates
the button planes, retained bitmap entries, drag arithmetic and repeat timer;
JavaScript supplies task routing, input, files and bitmap presentation.

| Object / task | Game object / driver / task constructor | SDK object / driver / task constructor |
| ------------- | --------------------------------------- | -------------------------------------- |
| SCROLL / 40   | `74D120` / `662580` / `62E7A0`          | `5ED570` / `531F70` / `505B80`         |
| SCROLL2 / 41  | `74D740` / `662220` / `630CF0`          | `5EDB60` / `531C10` / `5080C0`         |
| SLIDER / 42   | `74DE60` / `6627F0` / `632710`          | `5EE250` / `5321E0` / `5099C0`         |

Each original task remains in its Top's native ID namespace. Its Base packet
receiver supplies inherited messages and preserves an untouched result word.
FES message 27 updates the matching object's value and executes `SCRL_P`;
message 28 executes `FOCUS` or `UNFOCUS`. These notifications select the receiving
FES's private context and may immediately execute object queries. They do not
use the browser's separate hit-test fallback.

SCROLL's image includes the 1000, 1001 and 1002 metadata frames used to construct
its track. Missing metadata can leave original temporary geometry undefined;
the adapter does not invent a track. Its original release path can quantize
the task's position without notifying the FES source object. Values synchronize
through the actual notification and driver paths.

Custom SUBCOMMAND motion runs the original KCS motion VM on the control's own
motion state. That state is not a graphic plane's KX2 record. Object delay,
active queries, explicit stop, frame update and the same-frame start use the
original object virtual methods. Shared process snapshots own the raw task,
motion VM and renderer descriptor bytes once. FES records retain their object
and child-task identities; restoring into a fresh World resumes an in-progress
drag or motion.

`tests/native-controls.test.mjs` uses independently authored multi-frame HG2
images, areas, FES and KCS scripts. With each frozen PE mounted it checks the
three original constructors and Base messages, header/driver application,
horizontal and vertical dragging, focus/value events, SCROLL's held-arrow
repeat, sleep/wake, active motion and destruction. It compares retained pixels
and subsequent state after fresh-process restore during a drag and motion.
This exercises real executable regions; it is not a claim of complete visual
acceptance for every authored control skin or every FES object type.

Primary references are the official [SCROLL](https://cs2.suki.jp/manual/fes/code/o_scroll.html),
[SCROLL2](https://cs2.suki.jp/manual/fes/code/o_scroll2.html) and
[SLIDER](https://cs2.suki.jp/manual/fes/code/o_slider.html) contracts.
Executable bytes, decompilation and raw traces remain in ignored local storage.
