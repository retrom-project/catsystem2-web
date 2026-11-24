# SDK 2.6.1.74 Plane and Input commands

The table below describes the fixed SDK executable and its ordinary GCALL
surface. The raw message IDs are from the original Plane and BasePlane
receivers. Logical World message IDs share the base offset defined in the ABI.

|   Main | Raw message | Outcome                                                                                              |
| -----: | ----------: | ---------------------------------------------------------------------------------------------------- |
|     80 |          43 | Release the current Graph. Mode 1 can create an empty renderer Graph.                                |
|     83 |          66 | Release the Graph and clear both size fields. Remove the input registration if it tracked the Graph. |
| 86, 87 |      59, 60 | Write the selected model or texture pose through two or three VM output pointers.                    |
|     89 |          59 | Return the model base depth as a float word.                                                         |
|     91 |          52 | Stop inheriting the parent pose.                                                                     |
|     94 |          61 | Clamp signed alpha to 0–255 and combine it with the current Graph RGB.                               |
|     96 |          70 | Copy four button states and attach the Input region to the model geometry.                           |
|     97 |          71 | Select the texture pose by the low halfword and update the independent blocked bit.                  |
|     98 |          72 | Return the active phase with bit 31 set when blocked.                                                |
|     99 |          88 | Clear the registered Input receiver.                                                                 |
|    102 |          75 | Store the frame selector and send raw 45 to the selected target.                                     |
|    103 |          76 | Store the complete frame attribute word.                                                             |
|    109 |          93 | Query the Root's Input owner and return its source word.                                             |
|    110 |          94 | Store the raw Input receiver word.                                                                   |

The original pose wrappers use flags 1 and copy raw float words. Zero
targets skip the pose outputs. With a nonzero target, ordinary World requires
an initialized reply and valid output spans before writing to the caller.
Aliased pointers receive successive components. The original empty-Graph and
alpha paths require an available renderer owner. A Plane without a Graph
leaves its alpha state unset. The Input query uses raw 134, which converts
source 16 to 2 and copies all other values. It returns zero on a routing miss.

The button initializer copies 48 VM bytes and retains any existing Input
registration. It derives a new rectangle from the model pose and virtual
viewport. A selection changes the texture pose while retaining its depth.
Hover and key events use the same four states. The linked hint uses the
Input rectangle and its own rendered size. An absent model can leave
registration geometry unwritten, so World requires an attached model when
creating a region. A nonzero button-state target must reply with a word.

The original wrappers and both receiver types were exercised with a live
task registry fixture and sampled renderer boundaries. Ordinary production
KCS tests use Plane and BasePlane objects, the native variable and result
buffers, and the Input owner through the World. See
[the VM tests](../tests/native-engine74-plane.test.mjs).

## Prepared 2.6.1.76 Plane button receivers

The prepared executable uses raw 72, 73 and 74 for Main 96–98. Its own
BasePlane registration sends raw 126 to Input with the model bounds. Its
button states use the same separate texture transform and linked hint as
the fixed SDK. Raw 68 drops Input when the Plane tracks its Graph. Raw 77
stores and hides the hint by sending raw 47. Raw 78 stores its enable word.
The original wrapper, Plane and BasePlane were exercised separately with
sampled renderer and explicit Input recipient boundaries.
