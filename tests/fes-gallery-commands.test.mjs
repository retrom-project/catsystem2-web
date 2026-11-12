// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CGGallery, CGRegistry, readCGList } from '../src/gallery.mjs';
import { FESResourceCommands } from '../src/native/fes-resource-commands.mjs';
import { initializeFESImage, setFESImageFile } from '../src/native/fes-image-driver.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { saveSlotFixture } from './fixtures/save-slots-fixture.mjs';
import { hg3 } from './helpers.mjs';

const encode = (text) => new TextEncoder().encode(text);
function gallery() {
  const groups = [
      ['Opening', ['first', 'second']],
      ['Other', ['third']],
      ['Empty', ['']],
    ],
    bytes = new Uint8Array(
      12 + groups.reduce((size, [, variants]) => size + 72 + variants.length * 64, 0),
    ),
    view = new DataView(bytes.buffer);
  view.setUint32(8, groups.length, true);
  let at = 12;
  groups.forEach(([name, variants], index) => {
    view.setUint32(at, index + 1 === groups.length ? 0 : 72 + variants.length * 64, true);
    bytes.set(encode(name), at + 4);
    view.setUint32(at + 68, variants.length, true);
    at += 72;
    for (const variant of variants) {
      bytes.set(encode(variant), at);
      at += 64;
    }
  });
  const registry = new CGRegistry();
  registry.register('second');
  registry.register('third');
  const model = new CGGallery(readCGList(bytes), registry);
  model.listBytes = bytes;
  return model;
}
const operations = [
  ['loadlist', ['999', 'Opening', '1', '0'], 'second'],
  ['loadlist', ['999', '1', '0', '0'], 'first'],
  ['loadlist2', ['999', '1', '0', '0'], 'third'],
  ['loadlist2', ['999', 'Opening', '0', '0'], 'second'],
  ['loadlist', ['999', 'absent', '0', '0'], 'second'],
  ['loadlist', ['999', 'Opening', '9', '0'], 'second'],
  ['loadlist', ['999', 'Empty', '0', '0'], ''],
];

test('gallery commands retain numeric scratch selection, seen filtering, misses and successful empty strings', async () => {
  const object = { nativeType: 2 },
    instance = { cgGallery: gallery(), value: Number, soundArgument: (token) => token };
  initializeFESImage(object);
  const commands = new FESResourceCommands(instance, {
    collection: { lookup: () => object },
    setImageFile: setFESImageFile,
  });
  for (const [verb, args, file] of operations) {
    await commands.command(verb, { name: 'picture', index: 0 }, args);
    assert.equal(object.file, file);
    assert.equal(object.idIndex, 0);
  }
});

test('gallery commands gate the selection and list before token reads, then retain ignored-class evaluations', async () => {
  const events = [],
    object = { nativeType: 1 },
    instance = {
      cgGallery: gallery(),
      soundArgument(token) {
        events.push(['text', token]);
        return token;
      },
      value(token) {
        events.push(['value', token]);
        return Number(token);
      },
    },
    commands = new FESResourceCommands(instance, {
      collection: { lookup: () => object },
      setImageFile() {
        assert.fail('CIMAGE was admitted');
      },
    }),
    args = ['123', 'Opening', '0', '0'];
  await commands.command('loadlist', { name: 'picture', index: -1 }, args);
  assert.deepEqual(events, []);
  const saved = instance.cgGallery;
  instance.cgGallery = null;
  await commands.command('loadlist', { name: 'picture', index: 0 }, args);
  assert.deepEqual(events, []);
  instance.cgGallery = saved;
  await commands.command('loadlist', { name: 'picture', index: 0 }, args);
  assert.deepEqual(events, [
    ['text', '123'],
    ['value', '123'],
    ['text', 'Opening'],
    ['text', '0'],
    ['value', '0'],
    ['text', '0'],
    ['value', '0'],
  ]);
  events.length = 0;
  await commands.command('loadlist', { name: 'picture', index: 0 }, ['123', '1', '0', '0']);
  assert.deepEqual(
    events.at(-1),
    ['value', '0'],
    'numeric loadlist evaluates its last expanded scratch again',
  );
  assert.equal(events.filter(([kind]) => kind === 'text').length, 4);
});

for (const [profile, variable, construct] of [
  [profiles[0], 'CATSYSTEM2_SDK_EXE', 0x5ea7a0],
  [profiles[1], 'CATSYSTEM2_ENGINE_EXE', 0x74a170],
]) {
  test(
    `${profile} explicit original loadlist commands preserve the frozen filename/ID vectors`,
    { skip: !process.env[variable] },
    async () => {
      const f = await saveSlotFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        object = { nativeType: 2, type: 'IMAGE', baseName: 'picture', key: 'picture', index: 0 },
        abi = nativeABI(profile).fes;
      Object.assign(f.instance, {
        objects: [object],
        byKey: new Map([['picture', object]]),
        declaredGroups: { picture: 1 },
        cgGallery: gallery(),
      });
      f.runtime.registerType(2, {
        construct,
        size: abi.images[2].size,
        verbs: new Set(['loadlist', 'loadlist2']),
        syncObject() {},
      });
      try {
        for (const [verb, args, file] of operations) {
          assert.equal(await f.runtime.command(f.instance, object, verb, args), 0);
          assert.equal(f.engine.process.string(object.nativeObjectPointer + 680), file);
          assert.equal(f.engine.process.load(object.nativeObjectPointer + abi.imageIndexOffset), 0);
        }
      } finally {
        await f.engine.close();
      }
    },
  );
}

for (const profile of profiles) {
  test(`${profile} default gallery loads real image pixels and fresh World restores the current list and registry without gallery I/O`, async () => {
    const model = gallery(),
      file = new NativeGlobalFile();
    file.write(80, model.registry.write());
    const globalFile = await file.file(),
      pixel = Uint8Array.of(17, 34, 51, 255),
      source =
        '#DEFINE\nIMAGE picture\n#OBJECT FILE POS PRI DISP\npicture first 3,4 60000 1\n#START\ncgreg_init state.dat 80 gallery.bin\npicture loadlist 999 Opening 1 0\nnext IDLE\n#IDLE\n#SEEN\npicture loadlist2 999 Opening 0 0\nbreak\n',
      world = await defaultFESWorld(
        profile,
        {
          'screen.fes': encode(source),
          'gallery.bin': model.listBytes,
          'first.hg3': hg3(1, 1, Uint8Array.of(255, 255, 255, 255)),
          'second.hg3': hg3(1, 1, pixel),
        },
        {
          storage: {
            read: async (name) => (name === 'state.dat' ? globalFile : null),
            write: async () => true,
          },
        },
      );
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      assert.equal(h.instance.byKey.get('picture').file, 'second');
      const expected = new Uint8ClampedArray(128 * 96 * 4);
      expected.set(pixel, (4 * 128 + 3) * 4);
      assert.deepEqual(await drawPixels(world, h.surface), expected);
      const saved = structuredClone(world.snapshot());
      fresh = await defaultFESWorld(
        profile,
        {},
        {
          initialize: false,
          storage: {
            read: async () => {
              throw new Error('gallery restore reread persistence');
            },
            write: async () => true,
          },
        },
      );
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = async (name) => {
        if (name.endsWith('.kcs')) return read(name);
        throw new Error('gallery restore reread input ' + name);
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        root = task.player.root;
      assert.deepEqual(root.cgGallery.snapshot(), h.instance.cgGallery.snapshot());
      await task.player.notify('SEEN');
      await task.syncObjects();
      assert.equal(root.byKey.get('picture').file, 'second');
      assert.deepEqual(await drawPixels(fresh, h.surface), expected);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
