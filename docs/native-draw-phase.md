# Native task draw prelude

The existing World frame runs all task logic, then NativeObjects.drawTick.
A normal active task that has not requested destruction can implement
`beforeDrawChildren(effectiveFrame, context)`. Its result is awaited before the
existing live child walk. The derived drawTick remains after the children.
Tasks without this optional method add no await before their existing walk.

After the hook completes, the same record must still occupy its task ID, be active,
and have no destruction request. Otherwise that suspended visit stops. Releasing
a task and reusing its numeric ID cannot resume the old record. The existing
already-destroyed/logic-stub draw branch, detached-root qualification, signed route
order, clocks, registration gates and child traversal implementation are unchanged.

World supplies the same explicit W1 context object to logic, the prelude and draw.
Its executorEntry remains live across an awaited prelude and expires at the usual
frame settlement. The generic walk does not create an executor or interpret a
sender/frame number as one. A hook error propagates through the existing World
frame cleanup and frameSettled safe point.

CatSystem2.render delegates to StageRenderer projection and presentation. It does
not enter NativeObjects.drawTick, so repeated render-only calls do not run task
preludes or advance CPU Update/RNG/time. Node projection-provider tests exercise
the actual render methods, without claiming physical GPU or pixel validation.
This scheduling seam does not install an EFK callback, enable kind 61, or change
manager/device reset behavior, D6 display gates, ABI or checkpoint state.
