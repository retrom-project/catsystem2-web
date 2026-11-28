// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EmoteModel, contentDefaults } from '../src/emote/model.mjs';
import { drawList, stateAt, pointToRoot } from '../src/emote/draw-list.mjs';
import { EmoteRuntime } from '../src/emote/runtime.mjs';
import { Stage } from '../src/stage.mjs';
export function modelFixture() {
  return new EmoteModel({
    resource: () => new Uint8Array(16).fill(255),
    root: {
      id: 'motion',
      source: {
        tex: {
          texture: { width: 2, height: 2, pixel: { resource: 0 } },
          icon: { dot: { width: 2, height: 2, left: 0, top: 0, originX: 1, originY: 1 } },
        },
      },
      object: {
        body: {
          motion: {
            base: {
              lastTime: 61,
              layer: [
                {
                  label: 'image',
                  type: 0,
                  frameList: [
                    {
                      time: 0,
                      type: 2,
                      content: { mask: 2, src: 'tex', icon: 'dot', coord: [0, 0, 0] },
                    },
                    { time: 61, type: 0 },
                  ],
                },
              ],
            },
          },
        },
      },
      metadata: {
        base: { chara: 'body', motion: 'base' },
        variableList: [],
        timelineControl: [{ label: '初期化', variableList: [{ label: 'empty', frameList: [] }] }],
      },
    },
  });
}
test('E-mote layer interpolation retains transforms and honors end keys', () => {
  const layer = {
    frames: [
      { time: 0, type: 3, content: { ...contentDefaults, x: 0 } },
      { time: 10, type: 2, content: { ...contentDefaults, x: 100 } },
      { time: 20, type: 0, content: contentDefaults },
    ],
  };
  assert.equal(stateAt(layer, 5).x, 50);
  assert.equal(stateAt(layer, 15).x, 100);
  assert.equal(stateAt(layer, 20), null);
});
test('E-mote Bézier deformation composes through ancestor transforms', () => {
  const patch = Array.from({ length: 16 }, (_, i) => [(i % 4) / 3, Math.floor(i / 4) / 3]).flat();
  const nodes = [
    { transform: [1, 0, 0, 1, 10, 20], parent: -1, box: [0, 0, 1, 1] },
    { transform: [2, 0, 0, 2, 0, 0], parent: 0, box: [0, 0, 100, 100], mesh: patch },
  ];
  const [x, y] = pointToRoot(nodes, 1, 25, 50);
  assert.ok(Math.abs(x - 60) < 1e-8);
  assert.ok(Math.abs(y - 120) < 1e-8);
});
test('character metadata animation never advances the pose root into its invisible end key', async () => {
  const model = modelFixture(),
    face = {
      blinks: [],
      lips: [],
      chains: {},
      patterns: {},
      materials: {},
      inertiaLR: [],
      inertiaUD: [],
      inertiaFromChange: [],
    };
  const pose = {
    model: 'synthetic',
    variables: {},
    codes: {},
    bodyCodes: {},
    face,
    body: face,
    scaleX: 1,
    scaleY: 1,
    positionX: -320,
    positionY: -240,
    scaleOffsetX: 0,
    scaleOffsetY: 0,
  };
  const runtime = new EmoteRuntime({}, { pose: () => pose }, null);
  runtime.models.set('synthetic', model);
  const stage = new Stage(640, 480, Number);
  stage.actor(0).model = 'actor';
  await runtime.prepare(stage);
  stage.frame = 1000;
  const drawing = runtime.drawing(stage, 0);
  assert.equal(drawing.list.items.length, 1);
  assert.equal(drawing.alpha, 1);
  assert.deepEqual(model.resting(), {});
});
test('draw lists retain atlas/icon placement and deterministic layer order', () => {
  const model = modelFixture(),
    list = drawList(model, {}, 0, [1, 0, 0, 1, 100, 200]);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].texture, 0);
  assert.deepEqual(pointToRoot(list.nodes, list.items[0].node, 0, 0), [100, 200]);
});
