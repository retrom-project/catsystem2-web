// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { floatBits } from '../src/kcs.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const pixels = Uint8Array.of(11, 43, 89, 255, 151, 7, 53, 255);
async function make(profile, initialize = true) {
  const world = await dataWorld(profile, {}, { initialize });
  world.game.width = 8;
  world.game.height = 6;
  return world;
}
async function surface(world) {
  const id = await world.objects.create({
    kind: 15,
    parent: world.main.id,
    name: 'source lifetime',
  });
  await world.sendEngine(id, world.main.id, 279, 8, 6);
  await world.sendEngine(id, world.main.id, 283, 0, 0);
  return world.graphics.drawTasks.get(id);
}
function fields(kind, input) {
  const words = Array(15).fill(0);
  words[kind] = input;
  [1, 1, 0, 0, 0, 1, 1].forEach((n, i) => (words[4 + i] = floatBits(n)));
  words[11] = 255;
  words[12] = 1;
  return words;
}
async function bitmap(world) {
  const id = world.graphics.images.create(2, 1, world.main.id),
    value = world.graphics.images.get(id);
  (await value.pixels()).set(pixels);
  await value.changed();
  return id;
}
function handles(world, type) {
  return [...world.runtime.handles.records].filter(([, r]) => r.type === type).map(([id]) => id);
}
function absent(world, values, reason) {
  for (const id of values) assert.equal(world.runtime.handles.records.has(id), false, reason);
}

for (const profile of profiles) {
  test(`${profile} borrowed slot2 survives remove, rebind and fresh World until its owner's last release`, async () => {
    const world = await make(profile);
    let fresh;
    try {
      const draw = await surface(world),
        original = await bitmap(world),
        originalData = world.graphics.images.get(original).dataHandle,
        source = await world.retainedDraw.fromBitmap(original),
        sourceBitmap = world.renderSources.get(source).bitmap;
      assert.notEqual(sourceBitmap, original);
      assert.equal(world.graphics.images.get(sourceBitmap).dataHandle, originalData);
      assert.equal(world.renderSources.get(source).refs, 1);
      await world.retainedDraw.bind(draw, 7, fields(2, source));
      assert.equal(world.renderSources.get(source).refs, 2);
      const oldDrawBitmap = draw.entry(7).image;
      await draw.remove(7);
      assert.equal(
        world.renderSources.get(source).refs,
        1,
        'remove releases exactly its borrowed retain',
      );
      absent(world, [oldDrawBitmap], 'Draw releases only its own bitmap wrapper');
      assert.deepEqual(
        await world.graphics.images.get(sourceBitmap).pixels(),
        new Uint8ClampedArray(pixels),
      );
      await world.retainedDraw.bind(draw, 9, fields(2, source));
      assert.equal(world.renderSources.get(source).refs, 2);
      await world.graphics.images.release(original);
      assert.equal(world.runtime.handles.records.has(original), false);
      fresh = await make(profile, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.graphics.drawTasks.get(draw.record.id);
      assert.equal(fresh.retainedDraw.record(restored, 9).source, source);
      assert.equal(fresh.renderSources.get(source).refs, 2);
      assert.equal(fresh.graphics.images.get(sourceBitmap).dataHandle, originalData);
      await restored.remove(9);
      assert.equal(fresh.renderSources.get(source).refs, 1);
      await fresh.renderSources.release(source);
      absent(
        fresh,
        [source, sourceBitmap, originalData],
        'last owner releases the source and final bitmap backing',
      );
      await draw.remove(9);
      assert.equal(world.renderSources.get(source).refs, 1);
      await world.renderSources.release(source);
      absent(
        world,
        [source, sourceBitmap, originalData],
        'original World has independent last-owner cleanup',
      );
      assert.ok(!world.nativeEngine);
      assert.ok(!fresh.nativeEngine);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  for (const kind of [0, 1, 3])
    test(`${profile} owned slot${kind} removes all internally created source refs while preserving the external input`, async () => {
      const world = await make(profile);
      try {
        const draw = await surface(world),
          inputBitmap = kind === 1 ? 0 : await bitmap(world);
        let input = inputBitmap,
          data;
        if (kind === 1) {
          const bytes = await encodeHG2({ width: 2, height: 1, rgba: pixels }, { crop: false });
          input = world.runtime.imageDataBuffers.handle(
            world.runtime.imageDataBuffers.createPointer(bytes),
          );
          data = world.runtime.imageDataBuffers;
        } else if (kind === 3)
          input = world.imageOwners.add(
            inputBitmap,
            world.main.id,
            [2, 1, 2, 1, 0, 0, 0, 0, 4, 1, 1],
          );
        const external = new Set(handles(world, 'bitmap')),
          externalData = new Set(handles(world, 'bitmap-data'));
        await world.retainedDraw.bind(draw, 7, fields(kind, input));
        const source = world.retainedDraw.record(draw, 7).source,
          state = world.renderSources.get(source),
          ownedBitmaps = handles(world, 'bitmap').filter((id) => !external.has(id)),
          ownedData = handles(world, 'bitmap-data').filter((id) => !externalData.has(id));
        assert.equal(state.refs, 1, 'internally created source is owned by the single Draw record');
        await draw.remove(7);
        absent(
          world,
          [source, ...ownedBitmaps, ...ownedData],
          'remove releases every internally owned wrapper and backing',
        );
        assert.equal(
          world.runtime.handles.records.has(input),
          true,
          'external input remains independently owned',
        );
        if (kind === 1) {
          assert.ok(data.data(data.pointer(input)).length);
          data.release(input);
        } else if (kind === 3) await world.imageOwners.release(input);
        else await world.graphics.images.release(input);
        absent(
          world,
          [input, inputBitmap],
          'external owner can release its final input exactly once',
        );
        assert.ok(!world.nativeEngine);
      } finally {
        await world.close();
      }
    });
}
