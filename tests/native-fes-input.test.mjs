// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESInput } from '../src/native/fes-input.mjs';
import { NativeInput } from '../src/native/input.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { installNativeGraphics } from '../src/native/graphics.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { memoryGame } from './helpers.mjs';
import { defaultFESWorld, loadDefaultFES, drawPixels } from './fixtures/default-fes-world.mjs';

async function fixture(source) {
  const objects = new NativeObjects(),
    game = memoryGame({ 'screen.fes': new TextEncoder().encode(source) }),
    world = {
      objects,
      game,
      configuration: {
        fields: {
          texture: {
            size: Uint32Array.of(1024, 1024),
            grid: Uint32Array.of(1, 1),
            bppY: Uint32Array.of(0, 1),
            bpp: 32,
            areas: Array.from({ length: 8 }, (_, i) =>
              Uint32Array.from(i ? [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff] : [0, 0, 1, 1]),
            ),
          },
        },
      },
      runtime: { handles: new NativeHandles(), register() {} },
      base: () => ({
        message: ([, id]) => {
          if (id === 3) return 1;
          throw new Error(`Unexpected engine message ${id}`);
        },
      }),
    };
  world.input = new NativeInput({
    dispatch: (id, message, w, l) => world.sendEngine(id, 1, message, w, l),
  });
  world.inputFor = () => world.input;
  world.input.pointer(0, 0, 1);
  world.sendEngine = (id, sender, message, w, l, context = {}) =>
    objects.objects.get(id).implementation.message([sender, message, w, l], context);
  world.nativeTaskID = (id) => id;
  world.sendNativeEngine = (...args) => world.sendEngine(...args);
  installNativeGraphics(world);
  objects.register(1, () => ({
    message() {
      return 1;
    },
  }));
  const root = await objects.create({ kind: 1 });
  objects.register(34, (record) => {
    const input = new FESInput(record, world);
    return { input, player: null, message: (words, context) => input.message(words, context) };
  });
  const owner = await objects.create({ kind: 34, parent: root }),
    record = objects.objects.get(owner),
    player = new FESPlayer(game, {}),
    input = record.implementation.input;
  await player.start('screen');
  player.root.runtimeID = owner;
  record.implementation.player = player;
  await input.tick();
  await player.step();
  await input.sync();
  return { world, owner, record, player, input };
}

test('FES low button and every object own separate native tasks with independent priorities and bounds', async () => {
  const { world, input, owner, player } = await fixture(
    '#DEFINE\nBUTTON a[2]\n#OBJECT POS SIZE PRI ENABLE DISP\na[0] 10,20 30,40 7 1 1\na[1] 60,20 30,40 9 0 0\n#START\nnext WAIT\n#WAIT\n',
  );
  const low = world.objects.objects.get(input.state.lowButton);
  assert.deepEqual([low.kind, low.parent, world.input.get(low.id).priority], [6, owner, 1]);
  assert.equal(input.state.buttons.length, 2);
  const a = input.state.buttons.map(([key, id]) => ({
    key,
    task: world.objects.objects.get(id),
    region: world.input.get(id),
  }));
  assert.deepEqual(
    a.map((v) => [
      v.task.kind,
      v.task.parent,
      v.region.priority,
      v.region.bounds,
      v.region.enabled,
    ]),
    [
      [6, owner, 107, [10, 20, 40, 60], true],
      [6, owner, 109, [60, 20, 90, 60], false],
    ],
  );
  assert.equal(player.root.byKey.get('a[0]').nativeInputTaskID, a[0].task.id);
  await input.priority(400);
  assert.equal(world.input.get(low.id).priority, 400);
  await input.priority(-1);
  assert.equal(world.input.get(low.id).priority, 1);
});

test('native FES hover, press and release preserve the object task mapping and dispatch distinct events', async () => {
  const { world, input, player } = await fixture(
    '#DEFINE\nBUTTON a[2]\n#OBJECT POS SIZE ENABLE DISP\na[0] 10,20 30,40 1 1\na[1] 60,20 30,40 1 1\n#START\nnext WAIT\n#WAIT\n#a.FOCUS\n$1=@+10\n#a.PUSH_L\n$2=@+20\n#a.RELEASE_L\n$3=@+30\n#a.UNFOCUS\n$4=@+40\n',
  );
  world.input.pointer(15, 25);
  await world.input.hover();
  assert.equal(input.state.focus, 'a[0]');
  assert.equal(player.globals[1], 10);
  world.input.source = 2;
  const a0 = input.state.buttons[0][1],
    a1 = input.state.buttons[1][1];
  await world.graphics.send(a0, 1, 4, 0, 1);
  assert.equal(player.globals[2], 20);
  // A release retains the object pressed even after another object gains focus.
  await input.message([a1, 64, a1, 1]);
  await world.graphics.send(a0, 1, 4, 0, 0);
  assert.equal(player.globals[3], 30);
  assert.equal(input.state.focus, 'a[1]');
  assert.equal(player.globals[4], 40);
});

test('native image buttons expose the registered input bounds for navigation and public geometry', async () => {
  const { world, player, input } = await fixture(
    '#DEFINE\nBUTTON a\n#OBJECT POS SIZE ENABLE DISP\na 10,20 30,40 1 1\n#START\nnext WAIT\n#WAIT\n',
  );
  const object = player.root.byKey.get('a');
  player.nativeImages = { supports: (value) => value === object };
  object.x = 0;
  object.y = 0;
  assert.deepEqual(player.root.rect(object), { x: 10, y: 20, w: 30, h: 40 });
  await input.warp(object);
  assert.deepEqual([world.input.x, world.input.y], [10, 20]);
});

test('native KEYBLOCK input searches adjacent cells and does not invent geometric keyboard links', async () => {
  const { world, input, player } = await fixture(
    '#KEYBLOCK\n0 2,2 -1,-1,-1,-1\n#DEFINE\nBUTTON a[3]\n#OBJECT POS SIZE ENABLE DISP KEYBLOCK\na[0] 10,10 20,20 1 1 0,0,0\na[1] 40,10 20,20 0 1 0,1,0\na[2] 40,40 20,20 1 1 0,1,1\n#START\na[0] noact\nnext WAIT\n#WAIT\n',
  );
  await input.move('right');
  assert.equal(input.state.focus, 'a[0]');
  await input.move('right');
  assert.equal(input.state.focus, 'a[2]');
  assert.deepEqual(player.mouse, { x: 40, y: 40 });
  assert.deepEqual([world.input.x, world.input.y], [40, 40]);
  assert.equal(player.root.pushRight, player.root.byKey.get('a[0]').handle);
  assert.equal(await input.move('right'), false);
});

test('FES task messages resolve native button numbers in the receiving Top namespace', async () => {
  const { world, input, player } = await fixture(
    '#DEFINE\nBUTTON a\n#OBJECT POS SIZE ENABLE DISP\na 10,10 20,20 1 1\n#START\nnext WAIT\n#WAIT\n#a.FOCUS\n$1=7\n#a.TOUCH\n$2=9\n',
  );
  const id = input.state.buttons[0][1],
    nativeID = id + 4096;
  world.resolveTaskID = (value, receiver) => {
    assert.equal(receiver, input.record.id);
    return value === nativeID ? id : null;
  };
  await input.message([nativeID, 64, nativeID, 1], { nativeSenderWorldID: id });
  assert.equal(input.state.focus, 'a');
  assert.equal(player.globals[1], 7);
  await input.message([nativeID, 65, nativeID, 0], { nativeSenderWorldID: id });
  assert.equal(player.globals[2], 9);
  await input.message([nativeID, 64, nativeID + 1, 1], { nativeSenderWorldID: id });
  assert.equal(input.state.focus, null);
});

test('FES input checkpoint retains task identities and closing removes its registrations', async () => {
  const { world, input, record } = await fixture(
    '#DEFINE\nBUTTON a\n#OBJECT POS SIZE ENABLE DISP\na 10,10 20,20 1 1\n#START\nnext WAIT\n#WAIT\n',
  );
  const saved = input.snapshot(),
    fresh = new FESInput(record, world);
  fresh.restore(saved);
  assert.deepEqual(fresh.snapshot(), saved);
  assert.notEqual(fresh.state.buttons, saved.buttons);
  await fresh.close();
  assert.equal(world.input.regions.length, 0);
});

test('sendbtn controls the native propagation result when an input event has no script handler', async () => {
  const { world, player, input } = await fixture(
    '#DEFINE\nBUTTON a\n#OBJECT POS SIZE ENABLE DISP\na 10,10 20,20 1 1\n#START\nnext WAIT\n#WAIT\n',
  );
  const id = input.state.buttons[0][1];
  await input.focus('a');
  player.root.execute('sendbtn 0');
  assert.equal(await world.graphics.send(id, 1, 4, 0, 1), 0);
  player.root.execute('sendbtn 1');
  assert.equal(await world.graphics.send(id, 1, 4, 0, 1), 1);
  const saved = player.snapshot();
  assert.equal(saved.root.inputPropagation, 1);
});

test('FES sleep hides retained entries and plane tasks while preserving authored display and input state', async () => {
  const source =
      '#DEFINE\nBUTTON a\nCIMAGE red\nPLANE panel\n#OBJECT POS SIZE ENABLE DISP PRI\na 0,0 2,2 1 1 100\n#OBJECT SIZE COLOR DISP PRI\nred 2,2 4294901760 1 60000\n#OBJECT SIZE DISP\npanel 2,2 1\n#START\nnext WAIT\n#WAIT\n#_FES_SLEEP_\n$1=7\nbreak\n#_FES_WAKE_\n$1=9\nbreak\n',
    world = await defaultFESWorld('nekopara-vol3-engine-2.6.1.76', {
      'screen.fes': new TextEncoder().encode(source),
    });
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const { player, input } = h.task,
      panel = h.instance.byKey.get('panel'),
      buttonID = input.state.buttons[0][1];
    assert.deepEqual([...(await drawPixels(world, h.surface)).subarray(0, 4)], [255, 0, 0, 255]);
    const record = world.objects.objects.get(h.id);
    await world.graphics.setFESSleep(record, player, 1);
    assert.equal(player.globals[1], 7);
    assert.equal(h.instance.byKey.get('red').disp, true);
    assert.equal(h.instance.byKey.get('a').enable, true);
    assert.equal(world.inputFor(h.id).get(buttonID).enabled, false);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, false);
    assert.equal(input.snapshot().sleeping, true);
    assert.deepEqual([...(await drawPixels(world, h.surface)).subarray(0, 4)], [0, 0, 0, 0]);
    await world.graphics.setFESSleep(record, player, 0);
    assert.equal(player.globals[1], 9);
    assert.equal(world.inputFor(h.id).get(buttonID).enabled, true);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, true);
    assert.deepEqual([...(await drawPixels(world, h.surface)).subarray(0, 4)], [255, 0, 0, 255]);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});

test('FES mouse variables use its Top input outside-window gate and virtual coordinate outputs', async () => {
  const { world, input, player } = await fixture('#START\nnext WAIT\n#WAIT\n'),
    secondary = new NativeInput({
      services: { screenToVirtual: (x, y) => [2 * x - 8, y / 2 - 3] },
    });
  world.input.pointer(99, 99, 1);
  world.inputFor = (id) => {
    assert.equal(id, input.record.id);
    return secondary;
  };
  secondary.pointer(12, 20, 1);
  await input.updateMouse();
  assert.deepEqual(player.mouse, { x: 16, y: 7 });
  secondary.pointer(12, 20, 0);
  await input.updateMouse();
  assert.deepEqual(player.mouse, { x: -2147483648, y: -2147483648 });
});
