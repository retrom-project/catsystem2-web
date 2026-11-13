// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPhysicalWorld } from './fixtures/effekseer/physical-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { floatBits } from '../src/kcs.mjs';
import {
  supportsNativeColoredBounds,
  nativeColoredBounds,
} from '../src/render/native-geometry.mjs';

const source = `#DEFINE
CPLANE fx
#OBJECT SIZE POS BASE PRI DISP COLOR
fx 10,6 8,9,0 0,0 10 1 0xff112233
#START
next IDLE
#IDLE
break
next IDLE
`;
const floats = (values) => new NativeGraphicsPacket(values.map(floatBits));
const send = (h, plane, id, w = 0, payload) =>
  h.world.sendEngine(plane.record.id, h.id, id, w, 0, payload ? { payload } : {});
async function drawHistory(plane) {
  const calls = [];
  for (const item of plane.trail.drawItems())
    await item.drawGPU({
      drawGeometry(geometry, frame) {
        assert.equal(geometry.length, 2);
        assert.ok(geometry.every((triangle) => triangle.vertices.length === 4));
        assert.ok(
          geometry.every((triangle) =>
            triangle.vertices.every(
              (vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y),
            ),
          ),
        );
        assert.equal(frame.width, 1);
        calls.push(geometry);
      },
    });
  return calls;
}

test('retained disabled trail remains drawable, outside colored bounds, and survives message42 replacement', async () => {
  const h = await openPhysicalWorld({ text: source });
  try {
    Object.assign(h.world.configuration.screen, { currentWidth: 80, currentHeight: 60 });
    h.world.graphics.view.configure({ clientWidth: 64, clientHeight: 48 });
    const plane = h.world.graphics.get(h.instance.collection.lookup('fx', 0).nativeTaskID),
      renderer = h.world.screenEffects.rendering,
      projection = h.world.graphics.projection();
    assert.equal(plane.graph.type, 2);
    assert.equal(plane.graph.registrationEnabled, true);
    await send(h, plane, 51, 0, floats([8, 9, 0]));
    renderer.collectDirty();
    assert.deepEqual(plane.graph.cachedBounds, [8, 9, 19, 16]);

    await send(
      h,
      plane,
      79,
      1,
      new NativeGraphicsPacket([
        1,
        1,
        255,
        floatBits(1),
        floatBits(1),
        floatBits(1),
        0,
        floatBits(0),
        floatBits(0),
        floatBits(0),
        floatBits(0),
        0,
        0,
      ]),
    );
    plane.drawTick();
    assert.equal(plane.state.trail.graphs.length, 1);
    assert.ok(
      (await drawHistory(plane)).length > 0,
      'actual configured history produces real geometry',
    );

    // The current restore boundary accepts retained history with sampling off.
    // This changes no geometry or MOT state, and the ordinary draw path stays live.
    const saved = plane.snapshot();
    saved.state.trail.enabled = false;
    plane.restore(saved);
    const retained = plane.state.trail,
      frozenHistory = structuredClone(retained.history),
      retainedGraphs = retained.graphs.slice(),
      oldRect = plane.state.rect.slice();
    plane.drawTick();
    assert.deepEqual(retained.history, frozenHistory, 'disabled trail stops sampling');
    assert.ok((await drawHistory(plane)).length > 0, 'disabled history still reaches drawGraph');

    const model = plane.graph,
      oldCache = model.cachedBounds.slice(),
      oldCurrent = [...renderer.dirtyCurrent];
    await send(h, plane, 51, 0, floats([24, 12, 0]));
    const supported = supportsNativeColoredBounds(model, plane.state, projection);
    let refused = false;
    try {
      nativeColoredBounds(model, plane.state, projection);
    } catch (error) {
      refused = /Unsupported ordinary plane dirty bounds domain/.test(error.message);
    }
    renderer.collectDirty();
    const cacheUnchanged = model.cachedBounds.every((n, i) => n === oldCache[i]),
      currentUnchanged = [...renderer.dirtyCurrent].every((n, i) => n === oldCurrent[i]);

    await send(
      h,
      plane,
      42,
      0,
      new NativeGraphicsPacket([0, 0, 0, floatBits(20), floatBits(12), 0, 0, 0xff445566]),
    );
    const afterDraws = await drawHistory(plane);
    assert.deepEqual(
      {
        supported,
        refused,
        cacheUnchanged,
        currentUnchanged,
        sameTrailOwner: plane.state.trail === retained,
        retainedRegistrations: retainedGraphs.every(
          (graph) => h.world.graphics.graphs.get(graph.nativeID) === graph,
        ),
        retainedStillDraws: afterDraws.length > 0,
        copiedPreviousRect: plane.graph.style.rect,
      },
      {
        supported: false,
        refused: true,
        cacheUnchanged: true,
        currentUnchanged: true,
        sameTrailOwner: true,
        retainedRegistrations: true,
        retainedStillDraws: true,
        copiedPreviousRect: oldRect,
      },
    );
    assert.deepEqual(plane.state.rect, [0, 0, 20, 12]);
    assert.equal(plane.graph.registrationEnabled, false);
    assert.deepEqual(plane.graph.cachedBounds, [0, 0, 0, 0]);
    assert.equal(plane.graph.boundsDirty, false);
  } finally {
    if (h.gpu.drawing) h.gpu.endNativeFrame();
    await h.world.close({ flushFiles: false });
  }
});
