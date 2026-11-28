// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const profiles = ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74'];
async function fixture(profile, initialize = true) {
  // A real message loop rearms after both idle and cursor notifications.
  const files = {
      'main.kcs': kcsProgram([
        [37, 256],
        [43, 0x47, 4],
        [41, 0],
      ]),
    },
    game = memoryGame(files),
    random = new ParticleRandom(19, 23),
    state = { answer: false, actions: [], scriptEvents: [], trace: [] },
    world = new NativeWorld({
      profile,
      game,
      random,
      images: {},
      configuration: new NativeConfiguration({ profile }),
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
      host: {
        async nativeWindowAction(action, owner) {
          assert.equal(owner, world);
          assert.ok(['confirm-close', 'hide', 'close'].includes(action.type));
          state.actions.push({
            type: action.type,
            cursorVisible: world.input.cursorVisible,
            idleFrames: world.input.idleFrames,
            quitRequested: !!world.quitRequested,
            scripts: [...world.objects.objects.values()]
              .filter((r) => r.kind === 12)
              .map((r) => [r.id, r.scriptEnabled]),
          });
          state.trace.push(['action', action.type]);
          return action.type === 'confirm-close' ? state.answer : undefined;
        },
      },
    });
  world.ensureNativeEngine = () => {
    throw new Error('normal window event attempted original process');
  };
  if (initialize) await world.initialize('main.kcs');
  return { world, files, state };
}
function observeScripts({ world, state }) {
  for (const record of world.objects.objects.values()) {
    if (record.kind !== 12) continue;
    const implementation = record.implementation,
      original = implementation.message;
    implementation.message = async function (words, context, output) {
      if ([22, 158, 162].includes(words[1])) {
        state.scriptEvents.push({ id: record.id, words: [...words], flags: context.flags });
        state.trace.push(['script', record.id, words[1]]);
      }
      return original.call(this, words, context, output);
    };
  }
}
function enabled(world, id) {
  const record = world.objects.objects.get(id);
  return [record.scriptEnabled, record.implementation.machine.executionMode];
}

test('2.6.1.63 Main9 routes cancelled confirmation and direct close through native window messages', async () => {
  const current = await fixture('rebellions-jp-engine-2.6.1.63'),
    { world, state } = current,
    task = world.main,
    call = (value) => world.runtime.native('main', 9, [value], task.machine, task);
  try {
    observeScripts(current);
    assert.deepEqual(await call(1), { control: 2 });
    assert.deepEqual(world.windowMessages, [{ message: 0x10, wParam: 0, lParam: 0 }]);
    await world.tick();
    assert.deepEqual(
      state.actions.map(({ type }) => type),
      ['confirm-close'],
    );
    assert(!world.quitRequested);
    assert.deepEqual(await call(0), { control: 2 });
    assert.deepEqual(world.windowMessages, [{ message: 0x433, wParam: 0, lParam: 0 }]);
    await world.tick();
    assert.deepEqual(
      state.actions.map(({ type }) => type),
      ['confirm-close', 'hide', 'close'],
    );
    assert(state.scriptEvents.some((event) => event.words[1] === 162));
    assert(world.quitRequested);
    assert.deepEqual(world.windowMessages, []);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('normal window preparation resets real Input idle state before a cancelled close request', async () => {
  for (const profile of profiles) {
    const current = await fixture(profile),
      { world, state } = current;
    try {
      observeScripts(current);
      const input = world.objects.objects.get(world.root).implementation.input;
      await world.sendEngine(input, world.main.id, 142, 1, 2);
      world.input.pointer(25, 35);
      await world.tick();
      await world.tick();
      await world.tick();
      assert.equal(world.input.cursorVisible, false);
      assert.equal(world.input.idleFrames, 2);
      assert.ok(state.scriptEvents.some((e) => e.words[1] === 22 && e.words[3] === 0));
      assert.deepEqual(enabled(world, world.main.id), [1, 1]);
      world.window.post(0x111, 40002);
      await world.tick();
      assert.deepEqual(
        state.actions.map((a) => a.type),
        ['confirm-close'],
      );
      assert.equal(state.actions[0].cursorVisible, true);
      assert.equal(state.actions[0].idleFrames, 0);
      assert.equal(state.actions[0].quitRequested, false);
      const preparation = state.scriptEvents.filter((e) => e.words[1] === 158);
      assert.ok(preparation.length > 0);
      for (const event of preparation) {
        assert.deepEqual(event.words, [0, 158, 0, 1]);
        assert.equal(event.flags, 0);
      }
      assert.equal(world.input.cursorVisible, true);
      assert.equal(world.input.idleFrames, 1);
      assert.deepEqual(enabled(world, world.main.id), [1, 1]);
      assert.equal(world.quitRequested, undefined);
      assert.equal(world.closed, undefined);
      assert.deepEqual(world.windowMessages, []);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  }
});

test('pending normal window commands restore without replay and disable only fresh Scripts before close', async () => {
  for (const profile of profiles) {
    const source = await fixture(profile),
      fresh = await fixture(profile, false);
    try {
      const branch = await source.world.objects.create({
          kind: 0,
          parent: source.world.root,
          name: 'Nonmatching parent',
        }),
        child = await source.world.spawnScript('main.kcs', { parent: branch }),
        ids = [source.world.main.id, child.id];
      source.world.window.post(0x111, 40002);
      const pending = source.world.snapshot(),
        immutable = structuredClone(pending),
        restores = [],
        reads = [],
        rngCalls = [],
        expectedReads =
          nativeABI(profile).plugins.emoteDriver === 'native'
            ? ['main.kcs', 'm2view.cnf']
            : ['main.kcs'];
      const trap = (object, name) => {
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        restores.push(() =>
          descriptor ? Object.defineProperty(object, name, descriptor) : delete object[name],
        );
        object[name] = () => {
          throw new Error(`restore replayed ${name}`);
        };
      };
      for (const method of ['read', 'require']) {
        const original = fresh.world.game[method],
          descriptor = Object.getOwnPropertyDescriptor(fresh.world.game, method);
        restores.push(() => Object.defineProperty(fresh.world.game, method, descriptor));
        fresh.world.game[method] = async (name) => {
          assert.equal(name, expectedReads[reads.length], 'only immutable program/M2 revalidation');
          reads.push(name);
          const bytes = await original.call(fresh.world.game, name);
          if (name === 'main.kcs') assert.deepEqual(bytes, fresh.files['main.kcs']);
          else assert.equal(bytes, null);
          return bytes;
        };
      }
      trap(fresh.world.window, 'command');
      trap(fresh.world.window, 'sendEvent');
      trap(fresh.world.runtime, 'native');
      for (const name of ['integer', 'real']) {
        const stream = fresh.world.random[name],
          descriptor = Object.getOwnPropertyDescriptor(stream, 'nextUint32');
        restores.push(() =>
          descriptor
            ? Object.defineProperty(stream, 'nextUint32', descriptor)
            : delete stream.nextUint32,
        );
        stream.nextUint32 = () => {
          rngCalls.push(name);
          throw new Error('restore consumed RNG');
        };
      }
      try {
        await fresh.world.restore(pending);
      } finally {
        for (const restore of restores.reverse()) restore();
      }
      assert.deepEqual(reads, expectedReads);
      assert.deepEqual(rngCalls, []);
      assert.deepEqual(source.state.actions, []);
      assert.deepEqual(fresh.state.actions, []);
      const restored = fresh.world.snapshot();
      for (const field of [
        'frame',
        'clock',
        'runtime',
        'objects',
        'configuration',
        'globalStrings',
        'random',
        'inputBindings',
        'windowMessages',
      ])
        assert.deepEqual(restored[field], pending[field], `fresh ${field} before any warm tick`);
      assert.notEqual(
        fresh.world.main.machine.memory.buffer,
        source.world.main.machine.memory.buffer,
      );
      for (const id of ids) assert.deepEqual(enabled(fresh.world, id), [1, 1]);
      observeScripts(fresh);
      await source.world.close({ flushFiles: false });
      source.world.window.post(0x111, 40002);
      await source.world.processWindowMessages();
      assert.deepEqual(source.world.windowMessages, []);
      assert.deepEqual(source.state.actions, []);
      assert.deepEqual(fresh.world.windowMessages, pending.windowMessages);
      for (const id of ids) assert.deepEqual(enabled(fresh.world, id), [1, 1]);
      fresh.state.answer = true;
      await fresh.world.tick();
      assert.deepEqual(
        fresh.state.actions.map((a) => a.type),
        ['confirm-close', 'hide', 'close'],
      );
      assert.deepEqual(
        fresh.state.actions[1].scripts,
        ids.map((id) => [id, 1]),
      );
      assert.deepEqual(
        fresh.state.actions[2].scripts,
        ids.map((id) => [id, 0]),
      );
      const disabled = fresh.state.scriptEvents.filter((e) => e.words[1] === 162);
      assert.deepEqual(new Set(disabled.map((e) => e.id)), new Set(ids));
      for (const event of disabled) {
        assert.deepEqual(event.words, [0, 162, 0, 0]);
        assert.equal(event.flags, 0);
      }
      const hide = fresh.state.trace.findIndex((e) => e[0] === 'action' && e[1] === 'hide'),
        close = fresh.state.trace.findIndex((e) => e[0] === 'action' && e[1] === 'close');
      for (const [i, event] of fresh.state.trace.entries())
        if (event[0] === 'script' && event[2] === 162) assert.ok(hide < i && i < close);
      assert.equal(fresh.state.actions[2].quitRequested, true);
      for (const id of ids) assert.deepEqual(enabled(fresh.world, id), [0, 0]);
      assert.equal(fresh.world.objects.objects.get(branch).scriptEnabled, undefined);
      assert.equal(fresh.world.quitRequested, true);
      assert.equal(fresh.world.running, false);
      assert.equal(fresh.world.frameSettled, null);
      assert.equal(fresh.world.nativeEngine, undefined);
      assert.equal(source.world.closed, true);
      await fresh.world.close({ flushFiles: false });
      assert.equal(fresh.world.closed, true);
      assert.equal(fresh.world.objects.objects.size, 0);
      assert.equal(fresh.world.runtime.scheduler.tasks.size, 0);
      assert.deepEqual(fresh.world.windowMessages, []);
      assert.deepEqual(
        pending,
        immutable,
        'source close and fresh consumption preserve the checkpoint',
      );
    } finally {
      await source.world.close({ flushFiles: false });
      await fresh.world.close({ flushFiles: false });
    }
  }
});
