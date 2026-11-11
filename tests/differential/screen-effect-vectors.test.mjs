// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  screenOracleWorld,
  ScreenVectorGPU,
  rawScreenVertices,
} from '../fixtures/screen-effects-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { screenEffectCases as cases } from '../fixtures/screen-effect-cases.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS screen-effect vectors match existing D3D oracle submissions',
    {
      skip:
        fixture.available &&
        (fixture.profile.startsWith('sdk-') || process.env.CATSYSTEM2_EMOTE_DLL)
          ? false
          : (fixture.reason ?? 'Missing private E-mote DLL'),
    },
    async (t) => {
      for (const [kind, init, start, params, frames] of cases)
        await t.test('kind ' + kind, async () => {
          const oracle = await screenOracleWorld(fixture),
            js = await dataWorld(fixture.profile),
            world = oracle.world,
            gpu = new ScreenVectorGPU();
          try {
            configureJS(js, gpu);
            const originalID = await world.objects.create({
                kind,
                parent: world.root,
                name: 'Authored FX',
              }),
              jsID = await js.objects.create({ kind, parent: js.root, name: 'Authored FX' });
            js.random.restore(world.random.snapshot());
            for (const [current, id] of [
              [world, originalID],
              [js, jsID],
            ]) {
              await current.sendEngine(id, current.root, init, 0, 0, {
                payload: new NativeGraphicsPacket(params),
              });
              await current.sendEngine(id, current.root, start, 0, 1);
            }
            assert.deepEqual(js.random.snapshot(), world.random.snapshot(), 'initial RNG');
            const expected = [];
            oracle.device.onDrawRaw = (raw) => expected.push(rawScreenVertices(raw));
            for (let frame = 0; frame < frames; frame++) {
              await world.tick();
              await js.tick();
              await oracle.effects.rendering.render(
                [],
                () => {},
                () => 0,
              );
              await js.screenEffects.rendering.render(
                [],
                () => {},
                () => 0,
              );
            }
            verifyVertices(gpu.draws, expected, 'kind ' + kind);
            assert.deepEqual(
              js.random.snapshot(),
              world.random.snapshot(),
              'kind ' + kind + ' RNG',
            );
            assert.equal(
              await js.sendEngine(jsID, js.root, 377),
              await world.sendEngine(originalID, world.root, 377),
            );
          } finally {
            await js.close();
            await world.close({ flushFiles: false });
          }
        });
    },
  );

function configureJS(world, gpu) {
  Object.assign(world.configuration.screen, {
    width: 65,
    height: 49,
    currentWidth: 65,
    currentHeight: 49,
  });
  world.graphics.view.configure({
    clientWidth: 65,
    clientHeight: 49,
    drawingRectangle: [0, 0, 65, 49],
  });
  world.graphics.d3dContext.depthStencilEnabled = true;
  world.stageRenderer.gpu = gpu;
  world.screenEffects.rendering.prepare(1);
}
function verifyVertices(actualBatches, expectedBatches, label) {
  assert.equal(actualBatches.length, expectedBatches.length, label + ' submissions');
  for (const [batch, vertices] of expectedBatches.entries()) {
    assert.equal(
      actualBatches[batch].length,
      vertices.length,
      label + ' batch ' + batch + ' vertices',
    );
    for (const [i, vertex] of vertices.entries()) {
      const actual = actualBatches[batch][i];
      assert.equal(actual.color, vertex.color, label + ' color ' + batch + '/' + i);
      for (const field of ['x', 'y', 'z', 'w', 'u', 'v']) {
        assert.ok(Number.isFinite(vertex[field]), 'finite authored vectors');
        const ordered = (n) => (n & 0x80000000 ? ~n >>> 0 : (n | 0x80000000) >>> 0);
        assert.ok(
          Math.abs(ordered(floatBits(actual[field])) - ordered(floatBits(vertex[field]))) <= 1,
          `${label} ${batch}/${i} ${field}: JS ${actual[field]} / oracle ${vertex[field]}`,
        );
      }
    }
  }
}
const golden = JSON.parse(
  await readFile(new URL('../fixtures/native-screen-effect-vectors.json', import.meta.url)),
);
test('JS screen geometry matches frozen two-ABI norm-PC24 vectors without private files', async () => {
  for (const record of golden.records) {
    const world = await dataWorld(record.profile),
      gpu = new ScreenVectorGPU();
    try {
      configureJS(world, gpu);
      const id = await world.objects.create({
        kind: record.kind,
        parent: world.root,
        name: 'Golden FX',
      });
      world.random.integer.seed(17);
      world.random.real.seed(17);
      await world.sendEngine(id, world.root, record.init, 0, 0, {
        payload: new NativeGraphicsPacket(record.params),
      });
      await world.sendEngine(id, world.root, record.start, 0, 1);
      for (let frame = 0; frame < record.frames; frame++) {
        await world.tick();
        await world.screenEffects.rendering.render(
          [],
          () => {},
          () => 0,
        );
      }
      const expected = record.draws.map((encoded) => {
        const bytes = Buffer.from(encoded, 'base64'),
          view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return Array.from({ length: bytes.length / 28 }, (_, i) =>
          Object.fromEntries(
            ['x', 'y', 'z', 'w', 'color', 'u', 'v'].map((field, j) => [
              field,
              field === 'color'
                ? view.getUint32(i * 28 + j * 4, true)
                : view.getFloat32(i * 28 + j * 4, true),
            ]),
          ),
        );
      });
      verifyVertices(gpu.draws, expected, record.profile + ' kind ' + record.kind);
    } finally {
      await world.close();
    }
  }
});
