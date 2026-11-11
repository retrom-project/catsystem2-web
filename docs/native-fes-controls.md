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

## Phase 7 semantic models

`fes-control-model.mjs` and `control-task-model.mjs` are independently verified
JavaScript models. They are not yet the default FES or task-40/41/42 entry:
the original execution and consumer projections above remain counted until
that integration is removed. No rendering or World migration is credited here.

The FES model separates authored control geometry from its `pos`/`getpos` value,
keeps constructor priority10 distinct from explicit priority+20, and retains
the TYPE/PRI_P/rectangle/VRAM type gates and separate pending flags. Common
lifetime, graph identity and alpha-only MOT state keep their existing owners.
Load/range/query packets are borrowed buffers reused per object.

`ControlTaskModel(kind, service, state?)` owns numeric/input state and emits
explicit services for rendering, skin selection, bounds, notifications and
release. The integrating adapter owns decoded geometry, resource handles,
real child task IDs, input capture and actual Draw/plane entries. A restored
model emits no load, reset or replayed FES event. Its snapshot retains drag
anchors, unsnapped pixel, last value and the control's independent repeat timer.

The model preserves these original distinctions:

- SCROLL page recomputation resets the task value; SCROLL2 preserves value and
  pixel while rebuilding its thumb. Slider range assignment does not rebuild.
- SCROLL/SCROLL2 truncate their step before multiplication; slider multiplies
  before division. Minima do not gain an invented offset correction.
- Drag reports quantized values while retaining the current pixel. Release
  snaps again without FES27, so the task value can differ from its last notified
  FES value. It does not create another input capture.
- SCROLL held repeat starts at+30 then advances its independent timer by5 once
  per task visit. It does not run a catch-up loop or share Input's repeat state.
- Display, enable, focus, source/button gates and skin state are separate.
  SCROLL2's verified selectors in both registered ABIs ignore the stored table.
  Each ABI records the explicit state-direct skin policy.

The original pixel threshold loop has an exact constant-time form. For positive
range N, let B be the signed int32 product100×travel, s=trunc(B/N), and
h=trunc(s/2). Every checked threshold h+k×s, 0≤k<N, lies between0 and B because
N×abs(s)≤abs(B); it cannot wrap. A failed first comparison gives0; with s≤0 a
successful comparison givesN; with positive s the result is
min(N,floor((pixel100−h)/s)+1). The final unused threshold increment has no effect.
This preserves the signed multiplication and ties without a range-sized loop.
Native division faults and abs(INT_MIN) remain explicit errors.

`tests/control-model.test.mjs` reuses independent authored geometry and recorded
numeric/notification observations, checks fresh model/graph restoration and
packet reuse, and compares representative boundary cases to a BigInt
transcription of the original short loop. Set
`CATSYSTEM2_EXTENDED_CONTROL_MODEL=1` to run the optional8,064-case boundary
matrix. The default uses a small representative set.

Remaining D7 work is the resource/skin composer, canonical task receiver,
World/lifetime wiring, precise FES driver flag-consumption order, sleep masking,
and actual pixel/new-World acceptance. Missing mandatory SCROLL metadata must
remain an error; it cannot become zero geometry or a fake successful task.

## JavaScript World resource tasks

`JSControlTask` connects the independent interaction model to actual World
kind40/41/42 tasks, HG resources, retained Draw entries, kind6 Input areas and
SCROLL kind2 planes. SCROLL preserves its five wrappers, including an empty
decoration wrapper when frame200 has no metadata. SCROLL2 composes the original
cap/middle/cap pixels and optional alpha overlay; SLIDER decodes the selected
state. The registered ABI owns the reviewed SCROLL2 state-direct skin policy.
No selector is inferred from a game name or profile prefix.

The canonical receiver preserves unwritten output words on handled mutations
and delegates unknown/Base messages to the existing Base service. Direction
queries write their numeric result. Actual area messages drive capture, drag,
release, focus and held repeat. Notifications use World task identities while
retained keys use the owning Top's native task route. FES semantic handles are
kept separate.

A checkpoint saves source bytes, decoded/composed handles, actual child IDs and
interaction state. New World restoration reuses those resources and input
captures without loading files, recreating children or replaying events. Exact
CPU pixels, geometry, task state, ownership release and continuation are
covered for both registered engines by27 short public cases and24 independently
recorded original resource states. No pixel tolerance was added.

The service currently has an explicit fixture installer; normal installation
and the high-level FES13..15 driver still use their counted old implementation.
Their coordinated default factory switch, definition application and ordered
flag consumption remain D7 integration work.
