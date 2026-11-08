// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { KCSScheduler } from '../src/kcs/scheduler.mjs';
import { readKCS, nativeReply } from '../src/kcs.mjs';

test('standalone Script scheduler drains packets appended during the same frame', async () => {
  const program = await readKCS(
    kcsProgram([[37, 128], [43, 0x47, 4], [43, 0, 0], [37, 128], [43, 0x47, 4], [59]]),
  );
  const scheduler = new KCSScheduler({
      load: async () => program,
      native: (_table, id, args, machine, task) => {
        if (id === 0x47) return machine.waitMessage(args[0]);
        assert.equal(id, 0);
        scheduler.post(task.id, [7, 0x2222, 3, 4]);
        return nativeReply(2);
      },
    }),
    task = await scheduler.spawn('authored.kcs', { abi: 'main' });
  await scheduler.execute(task);
  scheduler.post(task.id, [7, 0x1111, 3, 4]);
  await scheduler.tick();
  assert.equal(task.machine.load(132), 0x2222);
  assert.equal(task.status, 'finished');
  assert.deepEqual(task.messages, []);
});
test('known empty word natives push the fresh GCALL sentinel and retain diagnostics after restore', async () => {
  const game = memoryGame({
      'main.kcs': kcsProgram([
        [37, 7],
        [43, 6, 4],
        [43, 0x8c, 0],
        [43, 0x41, 0],
        [43, 0x8e, 0],
        [43, 0x225, 0],
        [59],
      ]),
    }),
    events = [],
    make = async () => {
      const { NativeRuntime } = await import('../src/native/runtime.mjs');
      return new NativeRuntime({
        profile: 'sdk-4.01-engine-2.6.1.74',
        read: (name) => game.read(name),
        services: { diagnostic: (e) => events.push(e) },
      });
    },
    runtime = await make(),
    task = await runtime.spawn('main.kcs');
  await runtime.tick();
  assert.deepEqual([task.machine.load(4096), task.machine.load(4100)], [7, 0xcccccccc]);
  const fresh = await make();
  await fresh.restore(structuredClone(runtime.snapshot()));
  await fresh.tick();
  assert.deepEqual(
    [
      fresh.scheduler.tasks.get(task.id).machine.load(4104),
      fresh.scheduler.tasks.get(task.id).machine.load(4108),
    ],
    [0xcccccccc, 0xcccccccc],
  );
  assert.deepEqual(
    events.map((e) => e.id),
    [0x8c, 0x8e, 0x225],
  );
  assert.equal(
    events.every((e) => e.type === 'native-result-sentinel' && e.task === task.id),
    true,
  );
  assert.throws(() => nativeReply(1), /32-bit result/);
});

for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74']) {
  const make = () => {
    const game = memoryGame({
        'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
        'other.kcs': kcsProgram([[37, 1088], [43, 0x47, 4], [59]]),
      }),
      random = new ParticleRandom();
    return new NativeWorld({
      game,
      images: {},
      host: {},
      profile,
      configuration: new NativeConfiguration({ profile }),
      random,
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
    });
  };
  test(`${profile} Script enable modes retain deferred packets while paused and restore independent debugger state`, async () => {
    const world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        record = world.objects.objects.get(task.id),
        packet = { load: (at) => [3, 0x4321, 7, 9][at / 4] };
      await world.sendEngine(task.id, task.id, 162);
      assert.equal(record.scriptEnabled, 0);
      assert.equal(task.machine.executionMode, 0);
      await world.sendEngine(task.id, task.id, 173, 0, 0, { payload: packet });
      await world.tick();
      assert.equal(task.messages.length, 1);
      assert.equal(task.machine.load(1028), 0);
      await world.sendEngine(task.id, task.id, 166, 0x12345678, 0xaabbccdd);
      await world.sendEngine(task.id, task.id, 170, 0, 19);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(task.id),
        rt = fresh.main;
      assert.equal(restored.scriptEnabled, 0);
      assert.equal(restored.scriptDebugCallback, 0x12345678);
      assert.equal(rt.machine.debugHook, 19);
      await fresh.sendEngine(task.id, task.id, 161, fresh.nativeTaskID(task.id), 0);
      assert.equal(rt.machine.executionMode, 0);
      await fresh.tick();
      assert.equal(rt.machine.load(1028), 0x4321);
      assert.equal(rt.status, 'finished');
      assert.equal(restored.scriptEnabled, 1);
      await fresh.sendEngine(task.id, task.id, 161, fresh.nativeTaskID(task.id), 1);
      await fresh.tick();
      assert.equal(restored.scriptEnabled, 0);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });
  test(`${profile} Script context notification owns its VM text and descends through its subtree`, async () => {
    const world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        child = await world.spawnScript('other.kcs', { parent: task.id });
      task.machine.writeString('authored context', 64);
      assert.equal(await world.sendEngine(task.id, task.id, 330, 37, 64), 1);
      assert.equal(task.context.contextName, 'authored context');
      assert.equal(child.context.contextName, 'authored context');
      const packet = task.messages.at(-1);
      assert.equal(packet[1], 0xffff0010);
      assert.equal(packet[2], 37);
      assert.equal(task.machine.string(packet[3]), 'authored context');
      task.machine.writeString('changed source', 64);
      assert.equal(task.machine.string(packet[3]), 'authored context');
      const sibling = await world.spawnScript('other.kcs', { parent: world.root }),
        grandchild = await world.spawnScript('other.kcs', { parent: child.id }),
        raw = Uint8Array.of(0x81, 0x30, 0xfa, 0x40, 0);
      child.machine.bytes(64, raw.length).set(raw);
      await world.sendEngine(child.id, child.id, 330, 0, 64);
      assert.equal(task.context.contextName, 'authored context');
      assert.equal(sibling.context.contextName, '');
      for (const recipient of [child, grandchild]) {
        await world.sendEngine(recipient.id, task.id, 25, 0, 160);
        assert.deepEqual(task.machine.bytes(160, raw.length), raw);
      }
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      assert.equal(fresh.main.machine.string(fresh.main.messages[0][3]), 'authored context');
      await fresh.tick();
      assert.equal(fresh.main.machine.load(1028), 0xffff0010);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });
  test(`${profile} source location before its first debug opcode remains undefined`, async () => {
    const world = make();
    try {
      await world.initialize('main.kcs');
      const task = world.main;
      task.machine.store(128, 0xcafebabe);
      await assert.rejects(world.sendEngine(task.id, task.id, 167, 128, 0), /uninitialized/);
      assert.equal(task.machine.load(128), 0xcafebabe);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} task notification natives keep Top, Script and missing-target routing`, async () => {
    const world = make();
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        before = task.machine.pc,
        trace = [],
        send = world.sendNativeEngine.bind(world);
      world.sendNativeEngine = async (...args) => {
        const result = await send(...args);
        trace.push([args.slice(0, 5), result]);
        return result;
      };
      for (const [id, message] of [
        [0x23a, 442],
        [0x23b, 445],
        [0x23c, 444],
      ])
        for (const target of [0, world.nativeTaskID(task.id), 0xffffffff]) {
          const result = await world.runtime.native(
            'main',
            id,
            id === 0x23b ? [target, 0] : [target],
            task.machine,
            task,
          );
          assert.deepEqual(result, { control: 2 });
          assert.deepEqual(trace.at(-1), [[target, task.id, message, 0, 0], NATIVE_UNWRITTEN_WORD]);
        }
      assert.equal(task.machine.pc, before);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} Script reload retains its scene and bank resources while releasing automatic MOT managers`, async () => {
    const world = make();
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine,
        record = world.objects.objects.get(task.id),
        call = (id, args) => world.runtime.native('main', id, args, m, task);
      await call(0xdb, []);
      const handle = task.context.sceneData,
        data = world.runtime.sceneData(task);
      data.history.markSeen('authored', 9);
      const manager = world.runtime.services.motion.create(task.id),
        other = world.runtime.services.motion.create(null);
      await record.implementation.loadScript('other.kcs');
      const reloaded = record.implementation.task;
      assert.equal(reloaded.context.sceneData, handle);
      assert.equal(world.runtime.sceneData(reloaded), data);
      assert.equal(data.history.seenValue('authored'), 9);
      assert.equal(world.runtime.handles.records.has(manager), false);
      assert.equal(world.runtime.handles.records.has(other), true);
      await world.objects.release(task.id);
      assert.equal(world.runtime.handles.records.has(handle), false);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} failed and successful reloads retain the same queue through a fresh World`, async () => {
    const world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const caller = world.main,
        task = await world.spawnScript('other.kcs', { parent: world.root });
      [caller.id, 0x12345678, 8, 9].forEach((word, i) => caller.machine.store(128 + i * 4, word));
      await world.sendEngine(task.id, caller.id, 173, 0, 128);
      caller.machine.writeString('missing.kcs', 64);
      await world.sendEngine(task.id, caller.id, 160, 0, 64);
      const record = world.objects.objects.get(task.id);
      assert.equal(record.implementation.machine, null);
      assert.equal(record.scriptMessages.length, 1);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(task.id),
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = async (name) =>
        name === 'other.kcs' ? kcsProgram([[37, 1152], [43, 0x47, 4], [59]]) : read(name);
      await restored.implementation.loadScript('other.kcs', {
        initialExecute: true,
        nativeLoad: true,
      });
      assert.equal(restored.implementation.task.messages, restored.scriptMessages);
      await fresh.tick();
      assert.equal(restored.implementation.machine.load(1156), 0x12345678);
      assert.equal(restored.implementation.task.status, 'finished');
      assert.deepEqual(restored.scriptMessages, []);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });
  test(`${profile} reload and restore keep a shared range backed by its original caller VM`, async () => {
    const world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const caller = world.main,
        target = await world.spawnScript('other.kcs', { parent: world.root }),
        record = world.objects.objects.get(target.id);
      caller.machine.store(256, 0xabcdef01);
      await world.sendEngine(target.id, caller.id, 171, 16, 256);
      await record.implementation.loadScript('other.kcs');
      const m = record.implementation.machine;
      assert.equal(m.shared.length, 16);
      assert.equal(m.load(0x80000000), 0xabcdef01);
      m.store(0x80000004, 0x12345678);
      assert.equal(caller.machine.load(260), 0x12345678);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(target.id).implementation.machine;
      restored.store(0x80000008, 0x76543210);
      assert.equal(fresh.main.machine.load(264), 0x76543210);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });
  test(`${profile} Script string dirty words belong to callers even when their string bank is shared`, async () => {
    const world = make();
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        child = await world.spawnScript('other.kcs', { parent: task.id }),
        m = task.machine,
        query = async (owner, clear = 0) => {
          await world.sendEngine(owner.id, task.id, 178, clear, 128);
          return m.load(128);
        };
      assert.equal(task.context.stringBank, child.context.stringBank);
      m.writeString('shared text', 64);
      await world.runtime.native('main', 0x114, [0, 64], m, task);
      assert.equal(await query(task), 1);
      assert.equal(await query(child), 0);
      const file = (await world.runtime.native('main', 0xee, [0], m, task)).value;
      await world.runtime.native('main', 0xf3, [file, 7], m, task);
      assert.equal(await query(task, 1), 1);
      assert.equal(await query(task), 0);
      assert.equal(
        (await world.runtime.native('main', 0xfd, [file, 7], child.machine, child)).value,
        1,
      );
      assert.equal(await query(child, 1), 1);
      assert.equal(await query(task), 0);
      assert.equal(await world.sendEngine(child.id, task.id, 175, 132, 136), NATIVE_UNWRITTEN_WORD);
      assert.equal(m.load(132), 0);
      assert.equal(m.load(136), 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
