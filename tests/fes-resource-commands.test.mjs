// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESResourceCommands } from '../src/native/fes-resource-commands.mjs';
import { initializeFESImage } from '../src/native/fes-image-driver.mjs';
import { initializeFESControl } from '../src/native/fes-control-model.mjs';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { hg3 } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

function fixture(types, soundLoadParameters = true) {
  const calls = [],
    objects = types.map((type) => {
      if (type === null) return null;
      const object = { nativeType: type };
      if ([1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22].includes(type)) initializeFESImage(object);
      if (type >= 13 && type <= 15) initializeFESControl(object);
      return object;
    }),
    collection = { count: () => objects.length, lookup: (_name, index) => objects[index] },
    commands = new FESResourceCommands(
      {},
      {
        collection,
        images: { selectTable: (object, selectors) => calls.push([object.nativeType, selectors]) },
        setImageFile: (object, file) => calls.push(['image', object.nativeType, file]),
        loadSound: (_object, ...args) => calls.push(['sound', ...args]),
        loadM2: (_object, file) => calls.push(['m2', file]),
        soundLoadParameters,
      },
    );
  let next = 0;
  const context = {
    text(i) {
      calls.push(['text', i]);
      return 'authored';
    },
    argument(i) {
      calls.push(['argument', i]);
      return next++;
    },
  };
  return {
    calls,
    objects,
    command: (args, index = -1) =>
      commands.command('load', { name: 'items', index }, args, context),
  };
}

test('load reads each live object in order, stops at a hole and preserves the SOUND reread', async () => {
  const f = fixture([2, 9, 1, 13, 33, null, 2]);
  await f.command(['file', 'counter', 'frames']);
  assert.deepEqual(f.calls, [
    ['text', 0],
    ['argument', 1],
    ['image', 2, 'authored'],
    ['text', 0],
    ['argument', 1],
    ['argument', 1],
    ['argument', 2],
    ['sound', 'authored', 2, 3],
    ['text', 0],
    ['argument', 1],
    ['text', 0],
    ['argument', 1],
    ['text', 0],
    ['argument', 1],
    ['m2', 'authored'],
  ]);
  assert.equal(f.objects[0].idIndex, 0);
  assert.equal(f.objects[2].file, '', 'CIMAGE has no admitted FILE setter');
  assert.equal(f.objects[3].file, 'authored');
  assert.equal(f.objects[3].filePending, true);
  assert.equal(f.objects[6].idTableChanged, true);
});

test('SDK load keeps its generic ID evaluation but has no extra SOUND parameters', async () => {
  const f = fixture([9], false);
  await f.command(['file', 'counter', 'unread']);
  assert.deepEqual(f.calls, [
    ['text', 0],
    ['argument', 1],
    ['sound', 'authored', 0, 0],
  ]);
  const g = fixture([9]);
  await g.command(['file']);
  assert.deepEqual(g.calls, [
    ['text', 0],
    ['sound', 'authored', 0, 60],
  ]);
});

test('load selects all five table families without string evaluation or widening their selector counts', async () => {
  const f = fixture([16, 17, 18, 19, 20]);
  await f.command(['a', 'b', 'c', 'd']);
  assert.deepEqual(
    f.calls.filter(([kind]) => typeof kind === 'number'),
    [
      [16, [0, 1]],
      [17, [2, 3]],
      [18, [4, 5, 6, 7]],
      [19, [8, 9, 10, 11]],
      [20, [12, 13, 14, 15]],
    ],
  );
  assert.ok(f.calls.every(([kind]) => kind !== 'text'));
  const empty = fixture([16, 17, 18, 20]);
  await empty.command([]);
  assert.deepEqual(empty.calls, [
    [16, [0, 0]],
    [17, [0, 0]],
    [18, [0, 0, 0, 0]],
    [20, []],
  ]);
  const limited = fixture([19, 20]);
  await limited.command(Array.from({ length: 18 }, () => 'value'));
  assert.equal(limited.calls.filter(([kind]) => kind === 'argument').length, 32);
});

const bytes = (text) => new TextEncoder().encode(text),
  pixel = Uint8Array.of(17, 34, 51, 255, 68, 85, 102, 255, 119, 136, 153, 255, 170, 187, 204, 255);
for (const profile of profiles) {
  test(`${profile} ordinary load publishes IMAGE and table pixels and restores without source resources`, async () => {
    const source =
        '#DEFINE\nIMAGE picture\nBGTABLE table\n#OBJECT FILE POS PRI DISP\npicture first 3,4 60000 1\n#OBJECT TABLE POS PRI DISP\ntable names 8,4 60001 1\n#START\nnext IDLE\n#IDLE\n#LOAD\npicture load second\ntable load 0 1\nbreak\n',
      names = new Uint8Array(132);
    new DataView(names.buffer).setUint32(0, 1, true);
    names.set(encodeCP932('first'), 4);
    names.set(encodeCP932('second'), 36);
    const world = await defaultFESWorld(profile, {
      'screen.fes': bytes(source),
      names: names,
      'first.hg3': hg3(2, 2, new Uint8Array(16).fill(255)),
      'second.hg3': hg3(2, 2, pixel),
    });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      await h.task.player.notify('LOAD');
      await h.task.syncObjects();
      for (const name of ['picture', 'table']) {
        const object = h.instance.byKey.get(name),
          bitmap = world.graphics.images.get(h.instance.runtime.images.currentBitmap(object));
        assert.equal(object.file, 'second');
        assert.deepEqual(await bitmap.pixels(), new Uint8ClampedArray(pixel));
      }
      const expected = new Uint8ClampedArray(128 * 96 * 4);
      for (const x of [3, 8])
        for (let row = 0; row < 2; row++)
          expected.set(pixel.subarray((1 - row) * 8, (2 - row) * 8), ((4 + row) * 128 + x) * 4);
      assert.deepEqual(await drawPixels(world, h.surface), expected);
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      await fresh.restore(structuredClone(world.snapshot()));
      assert.deepEqual(await drawPixels(fresh, h.surface), expected);
      const runtime = fresh.objects.objects.get(h.id).implementation.player.root.runtime;
      assert.deepEqual(runtime.snapshot(), h.instance.runtime.snapshot());
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
