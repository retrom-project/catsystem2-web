// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNativeTouchState, pollNativeTouch } from '../src/native/input-touch.mjs';
import { nativeRectangleUnion } from '../src/native/windows-rectangles.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import {
  ordinaryStartupGame,
  StartupCanvas,
  startupEnvironment,
} from './fixtures/ordinary-startup.mjs';

test('63 Main285 combines all four sources from the caller-owned Input task', async (t) => {
  const world = await dataWorld('rebellions-jp-engine-2.6.1.63', {
    'case.kcs': kcsProgram([[59]]),
  });
  t.after(() => world.close());
  const { main, input, runtime } = world,
    call = () => runtime.native('main', 285, [12], main.machine, main);
  assert.deepEqual(await call(), { control: 1, value: 0 });
  for (const [slot, source] of [2, 4, 8, 16].entries()) input.key(12, true, source, slot);
  input.key(11, true, 1);
  assert.deepEqual(await call(), { control: 1, value: 30 });
  input.key(12, false, 4, 1);
  assert.deepEqual(await call(), { control: 1, value: 26 });
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  const create = () => {
    const game = memoryGame({
        'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]], [[64, 'authored text']]),
      }),
      random = new ParticleRandom(),
      configuration = new NativeConfiguration({ profile });
    return new NativeWorld({
      game,
      images: {},
      host: { inputText: () => null },
      profile,
      configuration,
      random,
      storage: { read: async () => null, write: async () => true },
      motionLibrary: new MotionLibrary(game, { profile, random }),
    });
  };
  test(`${profile} cursor wrappers preserve mapped-empty filenames, hotspots and visibility outputs`, async () => {
    const world = create(),
      images = [];
    world.host.nativeCursorImageChanged = async (...args) => {
      images.push(args);
      return 1;
    };
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        call = (id, args) => world.runtime.native('main', id, args, task.machine, task);
      task.machine.writeString('cursor_日本', 64);
      assert.deepEqual(await call(0x18b, [64, 0xffffffff, 0x8000]), { control: 2 });
      assert.deepEqual(images.pop(), ['cursor_日本', 65535, 32768, world]);
      task.machine.store(0, 0, 1);
      await call(0x18b, [0, 0, 0]);
      assert.deepEqual(images.pop(), ['', 0, 0, world]);
      world.input.cursorVisible = false;
      assert.equal((await call(0x18c, [])).value, 0);
      world.input.cursorVisible = true;
      assert.equal((await call(0x18c, [])).value, 1);
      if (profile.startsWith('sdk-')) {
        await call(0x18b, [0xffffffff, 0, 0]);
        assert.deepEqual(images.pop(), [null, 0, 0, world]);
      } else await assert.rejects(call(0x18b, [0xffffffff, 0, 0]), /uninitialized/);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} native input wrappers resolve the caller Top and retain independent captures after restore`, async () => {
    const world = create();
    let restored;
    try {
      await world.initialize('main.kcs');
      const top = await world.objects.create({ kind: 1, nativeID: 0 }),
        inner = await world.spawnScript('main.kcs', { parent: top }),
        outerInput = world.inputFor(world.main.id),
        innerInput = world.inputFor(inner.id),
        call = (task, id, args) => world.runtime.native('main', id, args, task.machine, task);
      assert.equal(outerInput, world.input);
      assert.notEqual(innerInput, outerInput);
      assert.equal(world.nativeTaskID(inner.id), world.nativeTaskID(world.main.id));
      for (const [task, priority] of [
        [world.main, 7],
        [inner, 11],
      ]) {
        [10, 20, 80, 90].forEach((n, i) => task.machine.store(128 + i * 4, n));
        await call(task, 0x90, [0x12345678, priority, 128, 5]);
      }
      assert.deepEqual(
        outerInput.regions.map((r) => [r.owner, r.priority, r.bounds]),
        [[world.main.id, 7, [10, 20, 80, 90]]],
      );
      assert.deepEqual(
        innerInput.regions.map((r) => [r.owner, r.priority, r.bounds]),
        [[inner.id, 11, [10, 20, 80, 90]]],
      );
      innerInput.key(12, true, 8, 2);
      assert.equal((await call(inner, 0x11d, [12])).value, 8);
      assert.equal((await call(world.main, 0x11d, [12])).value, 0);
      innerInput.pulses[12] = 5;
      assert.equal((await call(inner, 0x11d, [12])).value, 1);
      assert.equal(innerInput.pulses[12], 1);
      innerInput.regions[0].active = 1;
      assert.deepEqual(await call(inner, 0x11e, []), { control: 2 });
      assert.equal(innerInput.regions[0].active, 0);
      assert.deepEqual(
        [innerInput.previousX, innerInput.previousY, innerInput.forceCursor],
        [-1, -1, true],
      );
      await call(inner, 0x193, [2, 0]);
      assert.equal(innerInput.enabled[2], 0);
      assert.equal(outerInput.enabled[2], 1);
      innerInput.captures[4] = inner.id;
      innerInput.held[16] = 23;
      outerInput.pointer(31, 47);
      await call(world.main, 0x95, [192, 196]);
      assert.deepEqual([world.main.machine.load(192), world.main.machine.load(196)], [31, 47]);
      await call(inner, 0x97, [64]);
      assert.equal((await call(inner, 0x98, [])).value, 2);
      await call(inner, 0x99, [256]);
      assert.equal(inner.machine.string(256), 'authored text');
      assert.equal(outerInput.text, '');
      restored = create();
      await restored.restore(structuredClone(world.snapshot()));
      const savedInner = restored.inputFor(inner.id);
      assert.notEqual(savedInner, restored.input);
      assert.equal(savedInner.captures[4], inner.id);
      assert.equal(savedInner.held[16], 23);
      assert.equal(savedInner.enabled[2], 0);
      assert.equal(restored.input.enabled[2], 1);
      assert.equal(savedInner.text, 'authored text');
      await call(inner, 0x91, []);
      assert.equal(innerInput.regions.length, 0);
      assert.equal(outerInput.regions.length, 1);
    } finally {
      await world.close({ flushFiles: false });
      await restored?.close({ flushFiles: false });
    }
  });
  test(`${profile} the shared browser device and separate Top timers resume in a fresh world`, async () => {
    const world = create();
    let restored;
    try {
      world.inputBindings = new NativeInputBindings(world.input, world.configuration);
      await world.initialize('main.kcs');
      const top = await world.objects.create({ kind: 1, parent: world.root }),
        inner = await world.spawnScript('main.kcs', { parent: top }),
        row = world.configuration.keys.rows[2];
      row.enabled = 1;
      row.keyboard.set([13, 0, 0, 0]);
      world.inputBindings.key('keyboard', 13, true);
      world.inputBindings.sample();
      world.input.pointer(25, 35);
      await world.tick();
      assert.equal(world.input.held[8], 1);
      assert.equal(world.inputFor(inner.id).held[8], 1);
      assert.deepEqual([world.inputFor(inner.id).x, world.inputFor(inner.id).y], [25, 35]);
      world.inputBindings.key('keyboard', 13, false);
      restored = create();
      await restored.restore(structuredClone(world.snapshot()));
      assert.notEqual(restored.inputBindings, world.inputBindings);
      assert.deepEqual(restored.inputBindings.snapshot(), world.inputBindings.snapshot());
      for (const current of [world, restored]) {
        current.inputBindings.sample();
        await current.tick();
        // The original window device keeps sampled presses until the first
        // InputTask's frame-end copy. A later Top sees that copy this frame.
        assert.equal(current.input.held[8], 2);
        assert.equal(current.inputFor(inner.id).held[8], 0);
        current.inputBindings.sample();
        await current.tick();
        assert.equal(current.input.held[8], 0);
      }
      assert.deepEqual(restored.input.snapshot(), world.input.snapshot());
      assert.deepEqual(restored.inputFor(inner.id).snapshot(), world.inputFor(inner.id).snapshot());
    } finally {
      await world.close({ flushFiles: false });
      await restored?.close({ flushFiles: false });
    }
  });
}

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} ordinary Core touch gestures preserve the real device state across cold restore`, async () => {
    const environment = startupEnvironment(),
      players = [],
      observations = new Map();
    let opens = 0;
    const create = async (touch, checkpoint) => {
      const game = await ordinaryStartupGame(profile, {
          sound: false,
          startup: `<APP><touch>${touch}</touch></APP>`,
        }),
        player = new CatSystem2({
          game,
          canvas: new StartupCanvas(),
          audioContext: { currentTime: 0, close: async () => {} },
          nativeProfile: profile,
          randomSeed: 77,
          uiLanguage: 0x409,
          transitionalExe: {
            open() {
              opens++;
              throw new Error('Ordinary touch attempted original CPU execution');
            },
          },
        }),
        original = player.createNativeWorld;
      players.push(player);
      player.createNativeWorld = function (...args) {
        const world = original.apply(this, args),
          inputTask = world.inputTask,
          rows = [];
        observations.set(world, rows);
        world.inputTask = function (...parameters) {
          const implementation = inputTask.apply(this, parameters),
            service = implementation.inputState.services,
            poll = service.poll;
          service.poll = function (...pollArgs) {
            const result = poll.apply(this, pollArgs);
            result.then(
              () =>
                rows.push({
                  sampled: world.inputBindings.sampled.slice(),
                  live: world.inputBindings.live.slice(),
                  bitmap: world.inputBindings.mouseState.slice(),
                  repeat: world.inputBindings.repeat.slice(),
                  activation: world.inputBindings.pointerActivation,
                }),
              () => {},
            );
            return result;
          };
          return implementation;
        };
        return world;
      };
      await player.initialize(checkpoint ? { checkpoint } : undefined);
      return player;
    };
    try {
      const player = await create(3),
        world = player.world,
        row = world.configuration.keys.rows[27],
        contact = (id, phase, x = 20, y = 30) => player.touchContact(id, x, y, phase),
        last = () => observations.get(world).at(-1);
      assert.equal(world.configuration.getField('application.touch'), 3);
      row.enabled = 1;
      row.touch.set([0xf4, 0xf5, 0xf9, 0]);
      row.mouse.fill(0);
      row.rep_touch.set([13, 17, 19, 0]);
      contact(7, 'down');
      await player.step();
      assert.equal(last().activation, true);
      contact(7, 'up');
      await player.step();
      assert.deepEqual(Array.from(last().sampled.slice(108, 112)), [0, 0, 0, 0]);
      for (const id of [7, 9]) contact(id, 'down');
      await player.step();
      for (const id of [7, 9]) contact(id, 'up');
      await player.step();
      assert.deepEqual(Array.from(last().sampled.slice(108, 112)), [2, 0, 0, 0]);
      assert.equal(last().bitmap[7] & (1 << 20), 1 << 20);
      assert.equal(last().repeat[27], 13);
      assert.equal(world.inputBindings.live[108], 0);
      assert.equal(world.inputBindings.mouseState[7] & (1 << 20), 0);
      for (const id of [7, 9, 11]) contact(id, 'down');
      await player.step();
      for (const id of [7, 9, 11]) contact(id, 'up');
      await player.step();
      assert.deepEqual(Array.from(last().sampled.slice(108, 112)), [0, 2, 0, 0]);
      contact(7, 'down', 20, 30);
      contact(7, 'move', 20.5, 30);
      await player.step();
      const checkpoint = await player.snapshot(),
        originalRandom = world.random.snapshot(),
        fresh = await create(3, structuredClone(checkpoint)),
        copy = fresh.world;
      assert.deepEqual(await fresh.snapshot(), checkpoint);
      assert.equal(observations.get(copy).length, 0, 'Restore must not poll or recognize touch');
      assert.notEqual(copy.inputBindings.contacts, world.inputBindings.contacts);
      assert.notEqual(copy.inputBindings.touchState, world.inputBindings.touchState);
      assert.deepEqual(copy.random.snapshot(), originalRandom);
      fresh.touchContact(7, 21, 30, 'up');
      await fresh.step();
      assert.deepEqual(
        Array.from(observations.get(copy).at(-1).sampled.slice(108, 112)),
        [0, 0, 2, 0],
      );
      assert.deepEqual(world.random.snapshot(), originalRandom);
      assert.equal(
        world.inputBindings.contacts.size,
        1,
        'Fresh contact must not change the source',
      );
      contact(7, 'up', 21, 30);
      await player.step();
      assert.deepEqual(await fresh.snapshot(), await player.snapshot());
      await player.dispose();
      assert.equal(world.closed, true);
      fresh.touchContact(8, 22, 30, 'down');
      await fresh.step();
      assert.equal(copy.inputBindings.contacts.has(8), true);
      assert.equal(world.inputBindings.contacts.size, 0);
      const inputRecord = copy.objects.objects.get(
          copy.objects.objects.get(copy.root).implementation.input,
        ),
        control = (message, l = 0) =>
          copy.sendEngine(inputRecord.id, copy.main.id, message, 0, l, { flags: 0 });
      await control(156, 0);
      assert.equal(copy.inputBindings.touchHoldEnabled, 0);
      await control(155);
      assert.equal(copy.inputBindings.touchActive, false);
      assert.equal(copy.inputBindings.touchState.slots.size, 0);
      await control(156, 1);
      assert.equal(copy.inputBindings.touchHoldEnabled, 3);
      // A reset discards the physical ID mapping, not the manager or key masks.
      fresh.touchContact(8, 22, 30, 'up');
      await fresh.step();
      assert.equal(copy.inputBindings.touchState.slots.size, 0);
      const absent = await create(0),
        absentWorld = absent.world,
        absentInput = absentWorld.objects.objects.get(
          absentWorld.objects.objects.get(absentWorld.root).implementation.input,
        );
      absentWorld.configuration.setField('application.touch', 5);
      await absentWorld.sendEngine(absentInput.id, absentWorld.main.id, 156, 0, 1, { flags: 0 });
      absent.touchContact(1, 5, 6, 'down');
      await absent.step();
      assert.equal(absentWorld.inputBindings.touchHoldEnabled, 5);
      assert.equal(
        absentWorld.inputBindings.touchState.manager,
        null,
        'Late enable must not construct a missing startup manager',
      );
      assert.equal(opens, 0);
      for (const current of players) assert.equal(current.world.nativeEngine, undefined);
    } finally {
      for (const player of players.reverse()) await player.dispose();
      environment.restore();
    }
  });
}

test('ordinary touch direction results preserve all registered numeric codes and the unresolved code15', () => {
  const cases = [
    [
      [
        [1, 4],
        [1, 2],
        [1, 1],
      ],
      4,
    ],
    [
      [
        [1, 1],
        [1, 3],
        [1, 4],
      ],
      5,
    ],
    [
      [
        [4, 1],
        [2, 1],
        [1, 1],
      ],
      6,
    ],
    [
      [
        [1, 1],
        [3, 1],
        [4, 1],
      ],
      7,
    ],
    [
      [
        [1, 1],
        [4, 1],
        [1, 1],
      ],
      8,
    ],
    [
      [
        [4, 1],
        [1, 1],
        [4, 1],
      ],
      9,
    ],
    [
      [
        [1, 1],
        [1, 4],
        [1, 1],
      ],
      10,
    ],
    [
      [
        [1, 4],
        [1, 1],
        [1, 4],
      ],
      11,
    ],
    [
      [
        [2, 1],
        [1, 1],
        [4, 1],
        [2, 1],
      ],
      12,
    ],
    [
      [
        [1, 2],
        [1, 1],
        [1, 4],
        [1, 2],
      ],
      13,
    ],
    [
      [
        [1, 1],
        [4, 1],
        [2.5, 1],
      ],
      15,
    ],
  ];
  for (const [path, expected] of cases) {
    const state = createNativeTouchState(1),
      events = path.map(([x, y], index) => ({
        id: 33,
        x,
        y,
        phase: index === 0 ? 'down' : index === path.length - 1 ? 'up' : 'move',
      })),
      result = pollNativeTouch(state, events, 1);
    assert.equal(result.code, expected);
    assert.equal(result.activation, true);
    assert.equal(events.length, 0);
    assert.equal(state.slots.size, 0);
    assert.equal(pollNativeTouch(state, [], 1).code, expected === 15 ? 15 : 0);
  }
});

test('ordinary touch uses the shared signed rectangle union against pinned independent Wine vectors', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-rectangles-golden.json', import.meta.url)),
    ),
    cases = golden.cases.filter((row) => row.operation === 'UnionRect');
  assert.equal(cases.length, 363);
  for (const [index, row] of cases.entries()) {
    const a = row.a.slice(),
      b = row.b.slice();
    assert.deepEqual(
      nativeRectangleUnion(a, b).map((word) => word >>> 0),
      row.output.slice(1, 5),
      'whole signed result/' + index,
    );
    assert.deepEqual(a, row.a);
    assert.deepEqual(b, row.b);
  }
});

test('ordinary Core blur fully releases touch recognizers while retaining the original manager and current gate', async () => {
  const environment = startupEnvironment();
  let opens = 0;
  try {
    for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
      const players = [];
      const create = async (touch) => {
        const player = new CatSystem2({
          game: await ordinaryStartupGame(profile, {
            sound: false,
            startup: `<APP><touch>${touch}</touch></APP>`,
          }),
          canvas: new StartupCanvas(),
          audioContext: { currentTime: 0, close: async () => {} },
          nativeProfile: profile,
          randomSeed: 77,
          transitionalExe: {
            open() {
              opens++;
              throw new Error('Blur must not open original CPU');
            },
          },
        });
        players.push(player);
        await player.initialize();
        return player;
      };
      try {
        const player = await create(3),
          world = player.world,
          bindings = player.inputBindings,
          row = world.configuration.keys.rows[27],
          samples = [],
          service = world.input.services,
          poll = service.poll;
        row.enabled = 1;
        row.touch.set([0xf4, 0, 0, 0]);
        row.mouse.fill(0);
        service.poll = function (...args) {
          const result = poll.apply(this, args);
          result.then(
            () => samples.push(bindings.sampled[108]),
            () => {},
          );
          return result;
        };
        player.touchContact(99, 20, 30, 'down');
        await player.step();
        assert.equal(bindings.touchState.slots.get(99), 0);
        assert.equal(bindings.touchState.manager.one.armed, true);
        world.configuration.setField('application.touch', 0);
        // web/app's blur handler calls this exact public owner operation.
        bindings.releaseAll();
        assert.equal(bindings.touchHoldEnabled, 3);
        assert.notEqual(bindings.touchState.manager, null);
        assert.equal(bindings.touchState.slots.size, 0);
        assert.equal(bindings.touchState.manager.points.length, 0);
        for (const name of ['three', 'unused', 'two', 'stroke', 'one']) {
          assert.equal(bindings.touchState.manager[name].armed, false);
          assert.equal(bindings.touchState.manager[name].result, 0);
          assert.equal(bindings.touchState.manager[name].available, 1);
        }
        assert.equal(bindings.contacts.size, 0);
        assert.equal(bindings.touchEvents.length, 0);
        player.touchContact(200, 20, 30, 'down');
        await player.step();
        assert.equal(bindings.touchState.slots.get(200), 0);
        assert.equal(bindings.touchState.manager.two.armed, false);
        player.touchContact(200, 20, 30, 'up');
        await player.step();
        assert.equal(samples.at(-1), 0);
        for (const id of [201, 202]) player.touchContact(id, 20, 30, 'down');
        await player.step();
        for (const id of [201, 202]) player.touchContact(id, 20, 30, 'up');
        await player.step();
        assert.equal(samples.at(-1), 2);
        assert.equal(bindings.live[108], 0);
        const absent = await create(0);
        absent.world.configuration.setField('application.touch', 5);
        await absent.world.input.services.touchHold(1);
        absent.inputBindings.releaseAll();
        assert.equal(absent.inputBindings.touchHoldEnabled, 5);
        assert.equal(absent.inputBindings.touchState.manager, null);
        assert.equal(opens, 0);
      } finally {
        for (const player of players.reverse()) await player.dispose();
      }
    }
  } finally {
    environment.restore();
  }
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} ordinary pointer-only requests require explicit original ownership without changing owned VM data`, async () => {
    const world = await dataWorld(profile),
      features = [];
    try {
      const feature = world.getNativeFeature;
      world.getNativeFeature = function (...args) {
        features.push(args[0]);
        return feature.apply(this, args);
      };
      const task = world.main,
        machine = task.machine,
        call = (id, args, caller = task) =>
          world.runtime.native('main', id, args, caller.machine, caller),
        physical = /explicit original-engine ownership/;
      machine.store(0, 0x73abcdef);
      machine.store(4, 0x19badace);
      await assert.rejects(world.input.message(91, 0, 0, { payload: machine }), physical);
      await assert.rejects(call(0x4a, [0]), physical);
      const top = await world.objects.create({
          kind: 1,
          nativeID: 1,
          name: 'Pointer boundary Top',
        }),
        inner = await world.spawnScript('case.kcs', { parent: top });
      assert.equal(world.objects.objects.get(top).nativeID, 1);
      await assert.rejects(call(0x191, [1], inner), physical);
      await assert.rejects(
        world.sendEngine(task.id, task.id, 174, 0, 0, { payload: machine }),
        physical,
      );
      world.runtime.sceneData(task, true);
      assert.ok(task.context.sceneData);
      await assert.rejects(
        world.sendEngine(task.id, task.id, 175, 0, 4, { payload: machine }),
        physical,
      );
      await assert.rejects(call(0x23b, [world.nativeTaskID(task.id), 0x60000000]), physical);
      assert.equal(machine.load(0), 0x73abcdef);
      assert.equal(machine.load(4), 0x19badace);
      assert.deepEqual(
        features,
        [],
        'Normal requests must fail before acquiring an original feature',
      );
      const address = world.runtime.vmDataAddress(task.id, machine),
        memory = world.runtime.imageDataBuffers.process,
        packets = [],
        send = world.sendNativeEngine;
      assert.equal(memory.contains(address, 4), true);
      world.sendNativeEngine = function (...args) {
        packets.push(args.slice(0, 5));
        return send.apply(this, args);
      };
      assert.deepEqual(await call(0x23b, [world.nativeTaskID(task.id), address]), { control: 2 });
      assert.deepEqual(packets.at(-1), [world.nativeTaskID(task.id), task.id, 445, 0, 0x73abcdef]);
      assert.deepEqual(features, []);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
