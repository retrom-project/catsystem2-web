# Native screen effects

The two frozen engine profiles execute their original constructors, task receivers,
frame handlers, effect callbacks and view renderer. The browser supplies the shared
D3D9 device, graph enumeration and presentation surface. No effect is replaced by a
Canvas fade or an effect-specific JavaScript curve.

| Native task | Effect      | Game constructor | SDK constructor |
| ----------- | ----------- | ---------------- | --------------- |
| 35          | Blur        | `5F6EC0`         | `4D1700`        |
| 36          | Mosaic      | `5F7710`         | `4D1F50`        |
| 37          | Shade       | `5F82D0`         | `4D2B10`        |
| 38          | Draw        | `5F8FA0`         | `4D37E0`        |
| 39          | Wipe        | `5F9610`         | `4D3E50`        |
| 50          | Wipe mosaic | `5FA430`         | `4D4C50`        |
| 51          | Fade mosaic | `5FC310`         | `4D6AF0`        |
| 52          | Break       | `5FDCA0`         | `4D8320`        |
| 57          | Page flip   | `5FF0F0`         | `4D9770`        |
| 58          | Cube flip   | `600340`         | `4DA9C0`        |

Task identity belongs to its native Top namespace. Constructors register the same
Base task route used by KCS engine messages; a direct World handle is not substituted
for a native task ID. SDK effect messages have two separate numbering ranges, rather
than a single offset from the game profile.

`NativeScreenEffectRenderer` calls the original outer view frame function
(`675EE0` / `54CFF0`). Both ordinary frames and frames with an effect callback use
the actual shared D3D backbuffer. The host graph submission invalidates the native
manager's client rectangle; the original view retains its pause and dirty gates.
The original inner renderer controls callback phases, depth ranges, capture targets,
clears and Present. The outer renderer performs recording after Present.

The GPU begins these frames without clearing retained color, depth or stencil.
Only original D3D calls clear native targets. Canvas cursor overlays are drawn after
presentation and do not become backbuffer pixels.

FES `RDRAW`, `RWIPE`, `WBREAK`, `RWMOS` and `RFMOS` use their original object
constructors and the common definition parser. Initial allocation uses the original
FES resource list; frame drivers and deletion use that same per-interpreter list.
Global `rdraw`, `rwipe`, `wbreak`, `rwmos` and `rfmos` execute their original command
handlers, including target preparation/capture, category resolution, MOT scheduling,
the guard against a second live object, completion and deletion. They do not select a
JavaScript transition by game or object name.

The wide game category helper `5D3B30` shares the mounted `NativeResources` resolver
with the narrow helper. Its original classifier reads startup INT records directly
and does not call the narrow helper. Extension detection treats a trailing period as
an existing extension. SDK uses its independently recovered CP932 category helper.

`tests/native-screen-effect.test.mjs` covers all ten task receivers in both profiles,
untouched output words, actual constructor capability gates, separate FES allocation
lists, cleanup and fresh-process restoration. `tests/native-engine-files.test.mjs`
compares complete destination buffers from the unmodified game wide filename helper
with the host boundary, including Japanese paths, explicit paths and failure.

`tests/browser/native-screen-effect.spec.mjs` mounts either frozen executable and,
for the game profile, the supplied E-mote DLL. It exercises all ten callback tasks,
all five FES global transitions, an authored HG2 mask, repeated live requests and
reusing an object name after completion. A captured fade has matching whole-frame
RGBA hashes for each subsequent frame in a fresh World. It also checks ordinary
frames with no effect callback: the original outer-view pause gate preserves both
the backbuffer and displayed pixels.

These checks do not establish every effect parameter combination or a separate
Wine final-screen oracle. The compatibility matrix keeps these FES rows partial
until the remaining parameter and object-command coverage is accepted. The
standalone CST `ScenePlayer` screen commands are a separate contract; this native
task implementation does not upgrade their matrix rows.

Public command descriptions remain in the official
[FES rdraw](https://cs2.suki.jp/manual/fes/reference/cn/rdraw.html) and
[FES rwipe](https://cs2.suki.jp/manual/fes/reference/cn/rwipe.html) documentation.
Raw executable captures and probe outputs stay in ignored local storage.
