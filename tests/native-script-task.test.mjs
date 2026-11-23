// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { KCSScheduler } from '../src/kcs/scheduler.mjs';
import { readKCS, nativeReply } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

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

for (const profile of ['rebellions-jp-engine-2.6.1.63', 'grisaia-jp-engine-2.6.1.23'])
  test(`${profile} main Script load binds live shared memory and relays a four-word packet`, () =>
    verifyScriptLoad(profile));

async function verifyScriptLoad(profile) {
  const world = await dataWorld(
    profile,
    {
      'caller.kcs': kcsProgram([
        [37, 240],
        [43, 71, 4],
        [41, 0],
      ]),
      'worker.kcs': kcsProgram([[37, 512], [43, 71, 4], [45], [37, 544], [43, 71, 4], [59]]),
    },
    { initialize: false },
  );
  try {
    const task = await world.initialize('caller.kcs'),
      m = task.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, task),
      worker = await world.objects.create({ kind: 12, parent: task.id, name: 'worker' }),
      workerID = world.nativeTaskID(worker);
    m.writeString('worker.kcs', 256);
    assert.deepEqual(await call(143, [workerID, 256, 0]), { control: 2 });
    const child = world.runtime.scheduler.tasks.get(worker);
    assert.equal(child.name, 'worker.kcs');
    assert.equal(child.machine.shared.buffer, m.shared.buffer);
    await world.runtime.scheduler.execute(child);
    assert.deepEqual(await call(69, [workerID, 0x4321, 7, 9]), { control: 1, value: 1 });
    assert.deepEqual(
      [512, 516, 520, 524].map((at) => child.machine.load(at)),
      [world.nativeTaskID(task.id), 0x4321, 7, 9],
    );
  } finally {
    await world.close({ flushFiles: false });
  }
}
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'grisaia-jp-engine-2.6.1.23'])
  test(`${profile} empty word natives push the fresh GCALL sentinel after restore`, () =>
    verifyEmptyWords(profile));

async function verifyEmptyWords(profile) {
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
        profile,
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
}

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
      const pointer = (await world.runtime.native('main', 0x341, [4], task.machine, task)).value;
      world.runtime.imageDataBuffers.process.store(pointer, 0xdeadbeef);
      await world.runtime.native(
        'main',
        0x23b,
        [world.nativeTaskID(task.id), pointer],
        task.machine,
        task,
      );
      assert.equal(trace.at(-1)[0][4], 0xdeadbeef);
      assert.ok(!world.nativeEngine);
      await world.runtime.native('main', 0x342, [pointer], task.machine, task);
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
  test(`${profile} Script data addresses validate cold references and release the real VM alias on reload and close`, async () => {
    const world = make(),
      fresh = make();
    for (const owner of [world, fresh])
      owner.ensureNativeEngine = () => {
        throw new Error('Ordinary Script data address attempted original CPU');
      };
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        machine = task.machine,
        record = world.objects.objects.get(task.id),
        memory = world.runtime.imageDataBuffers.process;
      await world.sendEngine(task.id, task.id, 163, 0, 128, { payload: machine });
      const address = machine.load(128);
      assert.equal(world.runtime.vmDataAddress(task.id, machine), address);
      memory.store(address + 512, 0xa1234567);
      assert.equal(machine.load(512), 0xa1234567);
      const dto = structuredClone(world.snapshot()),
        reads = [],
        read = world.game.read;
      world.game.read = function (...args) {
        reads.push(args);
        return read.apply(this, args);
      };
      for (const corrupt of [
        (ref) => {
          ref.memoryID++;
        },
        (ref) => {
          ref.taskID += 1000;
        },
        (ref) => {
          ref.length++;
        },
        (ref) => {
          ref.extra = 1;
        },
      ]) {
        const bad = structuredClone(dto.runtime),
          ref = bad.imageDataBuffers.memory.regions.find(([at]) => at === address)[1];
        corrupt(ref);
        await assert.rejects(world.runtime.restore(bad), /Native|native/);
        assert.deepEqual(world.snapshot(), dto);
      }
      const overlap = structuredClone(dto.runtime);
      overlap.imageDataBuffers.memory.regions.push(overlap.imageDataBuffers.memory.regions[0]);
      await assert.rejects(world.runtime.restore(overlap), /Overlapping|match/);
      assert.deepEqual(world.snapshot(), dto);
      assert.deepEqual(reads, []);
      await fresh.restore(structuredClone(dto));
      assert.deepEqual(fresh.snapshot(), dto);
      const restored = fresh.main.machine,
        fm = fresh.runtime.imageDataBuffers.process;
      assert.equal(fresh.runtime.vmDataAddress(task.id, restored), address);
      restored.store(512, 0x87654321);
      assert.equal(fm.load(address + 512), 0x87654321);
      assert.equal(machine.load(512), 0xa1234567);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
      await record.implementation.loadScript('other.kcs');
      const next = record.implementation.machine;
      assert.notEqual(next.memoryID, machine.memoryID);
      assert.equal(memory.contains(address), false);
      assert.throws(
        () => world.runtime.vmDataAddress(task.id, machine),
        /actual owning interpreter/,
      );
      await world.sendEngine(task.id, task.id, 163, 0, 128, { payload: next });
      const replacement = next.load(128);
      memory.store(replacement + 512, 123);
      assert.equal(next.load(512), 123);
      assert.equal(machine.load(512), 0xa1234567);
      await world.objects.release(task.id);
      assert.equal(memory.contains(replacement), false);
      assert.equal(next.load(512), 123, 'removing the borrowed address does not destroy VM bytes');
      assert.equal(fm.contains(address), true);
    } finally {
      await fresh.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
}
