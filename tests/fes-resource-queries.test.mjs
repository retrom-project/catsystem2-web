// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESResourceCommands } from '../src/native/fes-resource-commands.mjs';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { imageOwnerFiles } from './fixtures/image-files.mjs';
import { append } from './fixtures/fes-log-model.mjs';
import { hg3 } from './helpers.mjs';

function fixture(types) {
  const events = [],
    objects = types.map((type, index) => (type === null ? null : { nativeType: type, index })),
    instance = { setGlobal: (index, value) => events.push(['write', index, value]) },
    commands = new FESResourceCommands(instance, {
      collection: { count: () => objects.length, lookup: (_name, index) => objects[index] },
      bitmap: (object) => ({
        state: { attributes: [{ id: 7, rect: [object.index, 2, 3, 4], color: 0xff123456 }] },
      }),
      stringID: (object, id) => {
        events.push(['string', object.index, id]);
        return object.index + 100;
      },
      logStringID: (object, row, id) => {
        events.push(['log', object.index, row, id]);
        return object.index + 200;
      },
      redraw: (object) => events.push(['redraw', object.index]),
    });
  return {
    events,
    command: (verb, args, argument = (i) => args[i]) =>
      commands.command(verb, { name: 'items', index: -1 }, args, {
        argument: (i) => {
          events.push(['argument', i]);
          return argument(i);
        },
      }),
  };
}

test('attr evaluates all indices before selection, keeps its exact type gate and stops on a hole', async () => {
  const f = fixture([11, 2, null, 25]);
  await f.command('attr', ['7', '10', '-1', '12', '13', '14']);
  assert.deepEqual(f.events, [
    ...Array.from({ length: 6 }, (_, i) => ['argument', i]),
    ['write', 10, 1],
    ['write', 12, 3],
    ['write', 13, 4],
    ['write', 14, 0xff123456],
  ]);
  const empty = fixture([2]);
  await empty.command('attr', []);
  assert.deepEqual(empty.events, []);
  await empty.command('attr', [65544, 1]);
  assert.deepEqual(empty.events, [], 'missing attribute leaves outputs untouched');
});

test('strid skips holes and preserves shared sentinel caches across mixed STRING and LOG classes', async () => {
  const f = fixture([29, 21, null, 24, 37, 38]);
  await f.command('strid', ['7', '8', '9']);
  assert.deepEqual(f.events, [
    ['argument', 0],
    ['argument', 1],
    ['string', 1, 7],
    ['write', 8, 101],
    ['argument', 0],
    ['log', 3, 7, 7],
    ['write', 8, 203],
    ['string', 4, 7],
    ['write', 8, 104],
    ['log', 5, 7, 7],
    ['write', 8, 205],
  ]);
  const sentinel = fixture([21, 21]);
  let calls = 0;
  await sentinel.command('strid', ['id', 'out'], () => (calls++ < 2 ? -1 : 6));
  assert.deepEqual(sentinel.events, [
    ['argument', 0],
    ['argument', 1],
    ['string', 0, -1],
    ['argument', 0],
    ['argument', 1],
    ['string', 1, 6],
    ['write', 6, 101],
  ]);
});

test('redraw ignores all arguments and only marks live NVSTRING objects across holes', async () => {
  const f = fixture([29, null, 21, 29, 37, 24]);
  await f.command('redraw', ['unread']);
  assert.deepEqual(f.events, [
    ['redraw', 0],
    ['redraw', 3],
  ]);
});

const bytes = (source) => new TextEncoder().encode(source);
for (const profile of profiles) {
  test(`${profile} default attr, text/LOG strid and deferred NV redraw share World authorities through fresh restore`, async () => {
    const source =
        '#DEFINE\nIMAGE picture\nDIFIMAGE duplicate\nSTRING label\nNVSTRING nv\nLOGSTRING history\n#OBJECT FILE POS PRI DISP\npicture attr 50,40 60000 1\n#OBJECT POS PRI DISP\nduplicate 70,40 60004 1\n#OBJECT SIZE PRI DISP\nlabel 24,16 60001 1\nnv 24,16 60002 1\n#OBJECT COUNT POS2 SIZE2 PRI\nhistory 1 area:0 area:0 60003\n#START\nlabel layout size 4\nlabel str A\\id7:41;\\id7:99;B\nlabel draw\nnv str NV\nnv draw\nnext IDLE\n#IDLE\n#BIND\nduplicate refex $1\nhistory setlog $0\nhistory pos 0\nhistory layout size 4\nhistory disp 1\nbreak\n#QUERY\npicture attr 7 10 11 12 13 14\nduplicate attr 7 20 21 22 23 24\nlabel strid 7 6\nhistory strid 0 7 7\nbreak\n#REDRAW\nnv redraw\nbreak\n',
      ownerFiles = await imageOwnerFiles(),
      world = await defaultFESWorld(profile, {
        'screen.fes': bytes(source),
        'attr.hg3': ownerFiles.get('@cat/image/attr.hg3'),
        'area.hg3': hg3(24, 16, new Uint8Array(24 * 16 * 4)),
      });
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const logHandle = world.displayLogs.create(h.id),
        log = world.displayLogs.get(logHandle);
      append(world.displayLogs, log, 'H\\id7:82;I');
      world.main.machine.writeString('attr.hg3', 256);
      const external = (
        await world.runtime.native('main', 0x2c6, [256], world.main.machine, world.main)
      ).value;
      h.instance.setGlobal(1, external);
      h.instance.setGlobal(0, logHandle);
      await h.task.player.notify('BIND');
      await world.runtime.native('main', 0x2c7, [external], world.main.machine, world.main);
      await h.task.syncObjects();
      await h.task.tick();
      await h.task.syncObjects();
      await h.task.player.notify('QUERY');
      assert.equal(h.task.player.globals[6], 41);
      assert.equal(h.task.player.globals[7], 82);
      assert.deepEqual(
        [10, 11, 12, 13, 14].map((i) => h.task.player.globals[i] >>> 0),
        [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123],
      );
      assert.deepEqual(
        [20, 21, 22, 23, 24].map((i) => h.task.player.globals[i] >>> 0),
        [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123],
      );
      const nv = h.instance.byKey.get('nv'),
        task = world.graphics.get(nv.nativeTaskID),
        writer = await task.writer(),
        frame = writer.frame();
      await h.task.player.notify('REDRAW');
      assert.equal(nv.nativeTextState.redraw, true);
      const pending = structuredClone(world.snapshot()),
        pixels = await drawPixels(world, h.surface);
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      await fresh.restore(pending);
      const root = fresh.objects.objects.get(h.id).implementation.player.root,
        restoredNV = root.byKey.get('nv'),
        messages = [],
        restoredTask = fresh.graphics.get(restoredNV.nativeTaskID),
        send = restoredTask.message.bind(restoredTask);
      restoredTask.message = (words, context) => {
        messages.push(words[1]);
        return send(words, context);
      };
      assert.equal(restoredNV.nativeTextState.redraw, true);
      await root.runtime.sync();
      assert.equal(restoredNV.nativeTextState.redraw, false);
      assert.ok(messages.includes(506), 'the queued request reaches actual NV task operation17');
      assert.deepEqual((await restoredTask.writer()).frame(), frame);
      assert.deepEqual(await drawPixels(fresh, h.surface), pixels);
      await fresh.objects.objects.get(h.id).implementation.player.notify('QUERY');
      assert.equal(root.player.globals[6], 41);
      assert.equal(root.player.globals[7], 82);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
