// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_UNWRITTEN_WORD, nativeEngineWord } from '../src/native/engine-message.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  engineMessageFixture,
  engineMessageWorld,
  engineMessageCases,
  messageMemory,
  messageMemoryBase,
  prepareEngineMessageCase,
  engineMessageModelState,
  prepareEngineMessageOperation,
} from './fixtures/engine-message-fixture.mjs';

const golden = JSON.parse(
    await fs.readFile(new URL('fixtures/engine-message-golden.json', import.meta.url)),
  ),
  game = 'nekopara-vol3-engine-2.6.1.76',
  sdk = 'sdk-4.01-engine-2.6.1.74',
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const profile of golden.profiles)
  test(`complete task routing and Base/Top results match the original ${profile.profile}`, async () => {
    const results = [];
    for (const operations of engineMessageCases(profile.profile)) {
      const fixture = await engineMessageFixture(profile.profile),
        memory = messageMemory(),
        context = { payload: memory },
        replies = [];
      await prepareEngineMessageCase(fixture, operations);
      for (const operation of operations) {
        prepareEngineMessageOperation(fixture, operation);
        const { sender, target, message, w, l, taskL, flags } = operation;
        context.flags = flags;
        const reply = await fixture.messages.dispatchNative(
          sender,
          target,
          message,
          w,
          taskL ?? l,
          context,
        );
        replies.push({
          ...reply,
          result: reply.result === NATIVE_UNWRITTEN_WORD ? 'unwritten' : reply.result,
        });
      }
      results.push({
        replies,
        state: engineMessageModelState(fixture),
        memorySHA256: hash(memory.data),
        files: [...fixture.files].map(([name, bytes]) => [name, hash(bytes)]),
        visits: fixture.visits,
      });
    }
    assert.equal(results.length, profile.total);
    assert.equal(hash(JSON.stringify(results)), profile.resultsSHA256);
  });

test('task messages distinguish routing, handling and output initialization without losing their context', async () => {
  const { world, messages } = await engineMessageFixture(game),
    context = { marker: {} },
    seen = [];
  const task = world.objects.objects.get(4),
    original = task.implementation.message;
  task.implementation.message = (words, incoming) => {
    seen.push(incoming);
    return original(words, incoming);
  };
  assert.deepEqual(await messages.dispatch(4, 3, 17, 0, 0, context), {
    routed: true,
    handled: true,
    result: NATIVE_UNWRITTEN_WORD,
  });
  assert.equal(seen[0], context);
  assert.equal(context.nativeUnhandled, false);
  assert.deepEqual(await messages.dispatch(4, 3, 999, 0, 0, context), {
    routed: true,
    handled: false,
    result: NATIVE_UNWRITTEN_WORD,
  });
  assert.equal(context.nativeUnhandled, true);
  assert.deepEqual(await messages.dispatch(99, 3, 13, 0, 0, context), {
    routed: false,
    handled: false,
    result: NATIVE_UNWRITTEN_WORD,
  });
  assert.equal(await messages.send(0, 3, 13), NATIVE_UNWRITTEN_WORD);
  assert.throws(
    () => nativeEngineWord(NATIVE_UNWRITTEN_WORD, 'root type'),
    /root type.*initialized/,
  );
  assert.throws(() => nativeEngineWord(undefined), /initialized/);
  assert.throws(() => nativeEngineWord(null), /initialized/);
  assert.equal(nativeEngineWord(-1), 0xffffffff);
  assert.equal(await messages.send(4, 3, 23), 0xffffffff);
  task.state = 'releasing';
  assert.equal(await messages.send(4, 3, 13), 0);
  task.state = 'active';
  assert.equal(await messages.send(4, 3, 24, 0, -7), NATIVE_UNWRITTEN_WORD);
  assert.equal(await messages.send(4, 3, 23), 0xfffffff9);
});

test('nested Tops retain separate native IDs while the owning Root excludes itself from its registry', async () => {
  const { world, messages } = await engineMessageFixture(game),
    records = world.objects.objects;
  assert.equal(records.get(0).namespace, null);
  assert.equal(records.get(5).namespace, 0);
  assert.equal(records.get(6).namespace, 5);
  assert.equal(records.get(1).nativeID, 1);
  assert.equal(records.get(6).nativeID, 0);
  assert.equal(records.get(7).nativeID, 1);
  assert.equal(messages.resolve(3, 0), 0);
  assert.equal(messages.resolve(6, 0), 6);
  assert.equal(messages.resolve(6, 1), 7);
  assert.equal(messages.resolve(3, 5), 5);
  assert.equal(messages.resolve(6, 99), null);
  assert.equal(await messages.send(0, 3, 33, 0), 0);
  assert.equal(await messages.send(0, 3, 33, 5), 1);
  assert.equal(await messages.send(5, 6, 33, 5), 0);
  assert.equal(await messages.send(5, 6, 34), 0);
  assert.equal(await messages.send(5, 6, 35), 1);
  assert.deepEqual(messages.creation(3), { nativeID: 6, namespace: 0, frameRate: 60 });
  assert.deepEqual(messages.creation(6), { nativeID: 4, namespace: 5, frameRate: 60 });
});

test('Root shared bytes remain live and restore VM references against the new task memory', async () => {
  const fixture = await engineMessageFixture(sdk),
    memory = messageMemory(),
    context = { payload: memory };
  fixture.world.objects.machine = (id) => (id === 3 ? memory : null);
  await fixture.messages.send(0, 3, 30, 4, messageMemoryBase + 256, context);
  const root = fixture.world.objects.objects.get(0);
  assert.deepEqual(root.sharedDataRef, {
    kind: 'vm',
    taskID: 3,
    address: messageMemoryBase + 256,
    length: 4,
  });
  memory.data[256] = 0x9a;
  assert.equal(root.implementation.sharedData[0], 0x9a);
  const state = structuredClone(fixture.world.objects.snapshot()),
    next = engineMessageWorld(sdk),
    restoredMemory = messageMemory();
  restoredMemory.data.set(memory.data);
  next.world.objects.machine = (id) => (id === 3 ? restoredMemory : null);
  await next.world.objects.restore(state);
  restoredMemory.data[256] = 0x5a;
  assert.equal(next.world.objects.objects.get(0).implementation.sharedData[0], 0x5a);
  assert.equal(root.implementation.sharedData[0], 0x9a);
  const process = { read: (address, count) => memory.bytes(address, count).slice() };
  next.world.nativeEngine = { process };
  const payload = { bytes: (...args) => process.read(...args) };
  await next.messages.send(0, 3, 30, 4, messageMemoryBase + 256, { payload, nativePointer: true });
  memory.data[256] = 0x4c;
  assert.equal(next.world.objects.objects.get(0).implementation.sharedData[0], 0x4c);
  await next.messages.send(0, 3, 30, 0, 0x12345678, { payload, nativePointer: true });
  assert.equal(next.world.objects.objects.get(0).sharedDataRef.address, 0x12345678);
  assert.equal(next.world.objects.objects.get(0).implementation.sharedData.length, 0);
});

test('live ordered-map broadcasting visits new later siblings and preserves predecessors for the next send', async () => {
  const operations = [...engineMessageCases(game)].find((operations) => operations[0].dynamic),
    fixture = await engineMessageFixture(game),
    context = { payload: messageMemory(), flags: 1 };
  await prepareEngineMessageCase(fixture, operations);
  await fixture.messages.dispatchNative(3, 3, 222, 0, 0, context);
  assert.deepEqual(fixture.visits, [3, 4, 10]);
  assert.equal(fixture.messages.resolve(3, 2), 11);
  assert.equal(fixture.messages.resolve(0, 2), 2);
  assert.equal(fixture.world.objects.queue.length, 0);
  fixture.visits.length = 0;
  await fixture.messages.dispatchNative(3, 3, 222, 0, 0, context);
  assert.deepEqual(fixture.visits, [3, 11, 4, 10]);
});

test('factory pointer identity is normalized to a native task ID and all new Tops own their input/sound IDs', async () => {
  const fixture = await engineMessageFixture(game),
    context = { payload: messageMemory() };
  const created = await fixture.messages.dispatchNative(3, 3, 1, 1, messageMemoryBase, context);
  assert.equal(created.result, 6);
  const id = fixture.messages.resolve(3, created.result),
    record = fixture.world.objects.objects.get(id);
  assert.equal(id, 10);
  assert.equal(record.parent, 3);
  assert.equal(record.namespace, 0);
  assert.equal(await fixture.messages.send(id, 3, 34), 0);
  assert.equal(await fixture.messages.send(id, 3, 35), 1);
  assert.equal(context.nativeNewTask, undefined);
});

test('released native task IDs are reused without removing their surviving ancestor routes', async () => {
  const { world, messages } = await engineMessageFixture(game);
  await world.objects.release(4);
  assert.equal(messages.resolve(0, 4), null);
  assert.equal(messages.resolve(0, 3), 3);
  assert.equal(messages.allocateNativeID(0), 6);
  await world.objects.tick(1);
  assert.equal(messages.allocateNativeID(0), 4);
  const next = await world.objects.create({ kind: 0, parent: 3, name: 'replacement' });
  assert.equal(next, 4);
  assert.equal(world.objects.objects.get(next).nativeID, 4);
  assert.equal(messages.resolve(0, 4), next);
  const state = structuredClone(world.objects.snapshot()),
    restored = engineMessageWorld(game);
  await restored.world.objects.restore(state);
  assert.deepEqual(
    [...restored.messages.registry(restored.world.objects.objects.get(0))],
    [...messages.registry(world.objects.objects.get(0))],
  );
  assert.equal(restored.messages.resolve(6, 0), 6);
});

test('unregister retains NULL entries until the separate frame sweep, including matching ancestor keys', async () => {
  const { world, messages } = await engineMessageFixture(game),
    root = world.objects.objects.get(0),
    nested = world.objects.objects.get(5),
    sound = world.objects.objects.get(7);
  messages.unregister(sound, { erase: false });
  assert.equal(messages.registry(nested).get(1), null);
  // The native helper follows parent pointers; it does not stop at Top.
  assert.equal(messages.registry(root).get(1), null);
  assert.equal(await messages.send(0, 3, 33, 1), 1);
  assert.equal(messages.resolve(3, 1), null);
  assert.equal(messages.allocateNativeID(0), 6);
  messages.pruneNullRoutes(root);
  assert.equal(await messages.send(0, 3, 33, 1), 0);
  assert.equal(messages.allocateNativeID(0), 1);
  assert.equal(messages.registry(nested).has(1), true);
  messages.pruneNullRoutes(nested);
  assert.equal(messages.allocateNativeID(5), 1);
});

test('enclosed messages reset decoded flags without changing caller bytes or ordinary message flags', async () => {
  for (const profile of [game, sdk])
    for (const envelope of [11, 12]) {
      const world = await dataWorld(profile);
      try {
        const branch = await world.objects.create({
            kind: 0,
            parent: world.root,
            name: 'Nonmatching parent',
          }),
          nested = await world.spawnScript('case.kcs', { parent: branch }),
          scripts = [world.main, nested],
          seen = [],
          data = new Uint8Array(24),
          view = new DataView(data.buffer),
          innerFlags = 0xa5a5f00d,
          outerFlags = 0x13572468;
        [0x11111111, 0x22222222, 162, 0x33333333, 0x44444444, innerFlags].forEach((word, i) =>
          view.setUint32(i * 4, word, true),
        );
        const callerBytes = data.slice(),
          payload = {
            load: (at) => view.getUint32(at, true),
            bytes: (at, count) => data.subarray(at, at + count),
          },
          context = { payload, flags: outerFlags };
        for (const script of scripts) {
          const record = world.objects.objects.get(script.id),
            implementation = record.implementation,
            original = implementation.message;
          assert.equal(record.scriptEnabled, 1);
          implementation.message = async function (words, incoming, output) {
            const observation = {
              id: record.id,
              words: [...words],
              context: incoming,
              flags: incoming.flags,
            };
            seen.push(observation);
            observation.result = await original.call(this, words, incoming, output);
            return observation.result;
          };
        }
        const reply = await world.engineMessages.dispatch(
          world.root,
          world.main.id,
          envelope,
          envelope === 12 ? 12 : 0,
          0,
          context,
        );
        // Real Script receivers have run before observing the protocol field.
        for (const script of scripts) {
          const record = world.objects.objects.get(script.id);
          assert.equal(record.scriptEnabled, 0);
          assert.equal(record.implementation.machine.executionMode, 0);
        }
        assert.equal(context.flags, 0);
        const received = seen.filter((entry) => entry.words[1] === 162);
        assert.deepEqual(
          new Set(received.map((entry) => entry.id)),
          new Set(scripts.map((script) => script.id)),
        );
        for (const entry of received) {
          assert.equal(entry.context, context);
          assert.equal(entry.flags, 0);
          assert.equal(entry.result, NATIVE_UNWRITTEN_WORD);
          assert.deepEqual(entry.words, [
            world.nativeTaskID(world.main.id),
            162,
            0x33333333,
            0x44444444,
          ]);
        }
        // The unfiltered walk also visits the real no-audio Sound receiver.
        assert.equal(reply.result, envelope === 11 ? 0 : NATIVE_UNWRITTEN_WORD);
        assert.deepEqual(data, callerBytes);
        assert.equal(view.getUint32(20, true), innerFlags);
        const ordinary = { flags: outerFlags },
          direct = await world.engineMessages.dispatch(
            world.main.id,
            world.main.id,
            17,
            0,
            0,
            ordinary,
          );
        assert.equal(ordinary.flags, outerFlags);
        assert.equal(direct.result, NATIVE_UNWRITTEN_WORD);
        const last = seen.at(-1);
        assert.equal(last.context, ordinary);
        assert.equal(last.flags, outerFlags);
        assert.equal(last.words[1], 17);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close({ flushFiles: false });
      }
    }
});

test('ordinary Game D0 formats the actual header packet, pushes its native zero and restores without a file or replay', async () => {
  const source = kcsProgram(
    [[37, 0x13579bdf], [37, 73], [38, 512], [37, 256], [43, 0xd0, 4], [43, 0x41, 0], [59]],
    [[256, '木-%d[G512].css']],
  );
  new DataView(source.buffer).setUint16(8, 2, true);
  const writes = [],
    storage = {
      read: async () => null,
      write: async (name) => {
        writes.push(name);
        return true;
      },
    },
    first = await dataWorld(game, { 'case.kcs': source }, { initialize: false, storage }),
    fresh = await dataWorld(game, { 'case.kcs': source }, { initialize: false, storage }),
    packets = [],
    restoredPackets = [];
  const observe = (world, output) => {
    const send = world.sendNativeEngine;
    world.sendNativeEngine = function (target, sender, message, w, l, context) {
      if (message === 36)
        output.push({
          target,
          sender,
          message,
          w,
          l,
          flags: context.flags,
          filename: [...context.payload.bytes(l, encodeCP932('木-73.css\0').length)],
        });
      return send.call(this, target, sender, message, w, l, context);
    };
  };
  observe(first, packets);
  observe(fresh, restoredPackets);
  try {
    await first.initialize('case.kcs');
    const machine = first.main.machine;
    assert.deepEqual(packets, [
      {
        target: 0,
        sender: first.main.id,
        message: 36,
        w: 0x20000,
        l: 0,
        flags: 0,
        filename: [...encodeCP932('木-73.css\0')],
      },
    ]);
    assert.equal(machine.load(machine.sp - 4), 0);
    assert.equal(machine.load(machine.sp - 8), 0x13579bdf);
    assert.equal(
      writes.some((name) => name.endsWith('.css')),
      false,
    );
    assert.equal(first.nativeEngine, undefined);
    const dto = structuredClone(first.snapshot());
    let draws = 0;
    for (const stream of [fresh.random.integer, fresh.random.real]) {
      const next = stream.nextUint32;
      stream.nextUint32 = function (...args) {
        draws++;
        return next.apply(this, args);
      };
    }
    await fresh.restore(structuredClone(dto));
    assert.deepEqual(fresh.snapshot(), dto);
    assert.deepEqual(restoredPackets, []);
    assert.equal(draws, 0);
    assert.deepEqual(
      await fresh.runtime.native('main', 0xd0, [256], fresh.main.machine, fresh.main),
      { control: 1, value: 0 },
    );
    assert.equal(restoredPackets.length, 1);
    assert.deepEqual(restoredPackets[0], packets[0]);
    assert.equal(
      writes.some((name) => name.endsWith('.css')),
      false,
    );
  } finally {
    await fresh.close();
    await first.close();
  }
  const unknown = await dataWorld(sdk);
  try {
    assert.throws(
      () => unknown.runtime.native('main', 109, [0], unknown.main.machine, unknown.main),
      (error) => error.details?.id === 109 && error.details.profile === sdk,
    );
    assert.equal(unknown.nativeEngine, undefined);
  } finally {
    await unknown.close();
  }
});

test('enclosed graphics packets reject unwritten operands while replacing ignored padding', async () => {
  for (const profile of [game, sdk])
    for (const envelope of [11, 12]) {
      const world = await dataWorld(profile);
      try {
        const record = world.objects.objects.get(world.main.id),
          original = record.implementation.message,
          seen = [];
        record.implementation.message = function (words, context, output) {
          seen.push({ words: [...words], context, flags: context.flags });
          return original.call(this, words, context, output);
        };
        for (const index of [2, 3, 4]) {
          const words = [0x11111111, 0x22222222, 162, 0x80000000, 0xffffffff, 0xa5a5f00d];
          words[index] = undefined;
          const payload = new NativeGraphicsPacket(words, { unwritten: [index] }),
            before = structuredClone(world.snapshot()),
            context = { payload, flags: 0x13572468 };
          await assert.rejects(
            world.engineMessages.dispatch(
              world.root,
              world.main.id,
              envelope,
              envelope === 12 ? 12 : 0,
              0,
              context,
            ),
            /Enclosed message.*initialized 32-bit output word/,
          );
          assert.deepEqual(world.snapshot(), before);
          assert.deepEqual(seen, []);
          assert.equal(record.scriptEnabled, 1);
          assert.equal(context.flags, 0x13572468);
          assert.deepEqual(
            Array.from({ length: 6 }, (_, i) => payload.load(i * 4)),
            words,
          );
        }
        const words = [undefined, undefined, 162, 0x80000000, 0xffffffff, undefined],
          payload = new NativeGraphicsPacket(words, { unwritten: [0, 1, 5] }),
          reads = [],
          context = {
            flags: 0x13572468,
            payload: {
              load(at) {
                reads.push(at);
                return payload.load(at);
              },
            },
          };
        await world.engineMessages.dispatch(
          world.root,
          world.main.id,
          envelope,
          envelope === 12 ? 12 : 0,
          0,
          context,
        );
        assert.equal(record.scriptEnabled, 0);
        assert.equal(record.implementation.machine.executionMode, 0);
        assert.equal(seen.length, 1);
        assert.deepEqual(seen[0].words, [
          world.nativeTaskID(world.main.id),
          162,
          0x80000000,
          0xffffffff,
        ]);
        assert.equal(seen[0].context, context);
        assert.equal(seen[0].flags, 0);
        assert.deepEqual(
          [...new Set(reads)].sort((a, b) => a - b),
          [0, 4, 8, 12, 16, 20],
        );
        assert.deepEqual(
          Array.from({ length: 6 }, (_, i) => payload.load(i * 4)),
          words,
        );
        const short = new DataView(new ArrayBuffer(20));
        await assert.rejects(
          world.engineMessages.dispatch(world.root, world.main.id, envelope, 0, 0, {
            payload: { load: (at) => short.getUint32(at, true) },
          }),
          RangeError,
        );
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close({ flushFiles: false });
      }
    }
});

test('ordinary SDK D0 writes its live task tree before the result push and restores VM address aliases without replay', async () => {
  const program = kcsProgram(
      [
        [43, 0x41, 0],
        [37, 0x13579bdf],
        [37, 256],
        [43, 0xd0, 4],
        [38, 400],
        [43, 0x41, 0],
        [37, 256],
        [43, 0xd0, 4],
        [38, 404],
        [43, 0x41, 0],
        [59],
      ],
      [[256, '木-%d[G512].css']],
    ),
    header = new DataView(program.buffer),
    files = new Map(),
    writes = [],
    storage = {
      read: async (name) => files.get(name) ?? null,
      write: async (name, bytes) => {
        writes.push(name);
        if (name.endsWith('denied.css')) return false;
        files.set(name, bytes.slice());
        return true;
      },
    };
  header.setUint16(8, 0x83ff, true);
  header.setUint16(10, 0x1234, true);
  const first = await dataWorld(sdk, { 'case.kcs': program }, { initialize: false, storage }),
    fresh = await dataWorld(sdk, { 'case.kcs': program }, { initialize: false, storage }),
    calls = [];
  try {
    await first.initialize('case.kcs');
    const task = first.main,
      m = task.machine,
      root = first.objects.objects.get(first.root),
      original = root.implementation.message,
      shared = Uint8Array.of(11, 22, 33, 44, 55);
    root.implementation.message = function (words, context, ...rest) {
      if ([15, 16, 34].includes(words[1])) calls.push({ words: [...words], flags: context.flags });
      return original.call(this, words, context, ...rest);
    };
    m.bytes(64, shared.length).set(shared);
    await first.sendEngine(first.root, task.id, 30, shared.length, 64, { payload: m });
    const leaf = await first.objects.create({ kind: 0, parent: task.id, name: 'Leaf' });
    m.store(512, 73);
    m.store(400, 0xa5a5a5a5);
    m.store(404, 0xa5a5a5a5);
    await first.runtime.scheduler.execute(task);
    assert.equal(task.status, 'yielded');
    assert.equal(m.pc, 51);
    assert.equal(m.load(400), 0);
    assert.equal(m.load(m.sp - 4), 0x13579bdf);
    assert.deepEqual(
      calls.map(({ words, flags }) => [words[0], words[1], words[2], flags]),
      [
        [first.nativeTaskID(task.id), 34, 0x83ff1234, 0],
        [0, 15, 0, 0],
        [0, 16, 0, 0],
      ],
    );
    assert.equal(calls[2].words[3], 20);
    const css = files.get('./木-73.css');
    assert.ok(css instanceof Uint8Array);
    const word = (at) => new DataView(css.buffer, css.byteOffset).getUint32(at, true),
      name = (at) => {
        const bytes = css.subarray(at + 16, at + 48);
        return new TextDecoder('shift_jis').decode(bytes.subarray(0, bytes.indexOf(0)));
      },
      scriptAt = 20 + 60 + shared.length + 60;
    assert.deepEqual([0, 4, 8, 12, 16].map(word), [0x535343, css.length - 20, 0x83ff1234, 0, 0]);
    assert.equal(name(20), 'BASE TASK');
    assert.deepEqual(
      [48, 52, 56].map((n) => word(20 + n)),
      [0, 3, shared.length],
    );
    assert.deepEqual(css.subarray(80, 85), shared);
    assert.equal(name(85), 'INPUT TASK');
    assert.equal(name(scriptAt), 'case.kcs');
    const address = word(scriptAt + 68),
      memory = first.runtime.imageDataBuffers.process;
    assert.deepEqual(
      [48, 52, 56, 60, 64, 72, 76, 80, 84].map((n) => word(scriptAt + n)),
      [
        first.nativeTaskID(task.id),
        1,
        m.shared.length,
        34,
        m.memory.length,
        m.data.length + 4,
        m.floor,
        m.fp,
        m.switchValue,
      ],
    );
    assert.equal(word(scriptAt + 88 + 400), 0xa5a5a5a5);
    assert.equal(word(scriptAt + 88 + 512), 73);
    assert.equal(name(scriptAt + 88 + m.memory.length), 'Leaf');
    assert.equal(word(scriptAt + 88 + m.memory.length + 48), first.nativeTaskID(leaf));
    assert.equal(css.length, scriptAt + 88 + m.memory.length + 60);
    await first.sendEngine(task.id, task.id, 163, 0, 128, { payload: m });
    assert.equal(m.load(128), address);
    assert.equal(memory.view(address, m.memory.length).buffer, m.memory.buffer);
    memory.store(address + 512, 81);
    assert.equal(m.load(512), 81);
    m.store(512, 73);
    assert.equal(memory.load(address + 512), 73);
    const dto = structuredClone(first.snapshot()),
      beforeWrites = [...writes],
      restoredCalls = [];
    let draws = 0;
    for (const stream of [fresh.random.integer, fresh.random.real]) {
      const next = stream.nextUint32;
      stream.nextUint32 = function (...args) {
        draws++;
        return next.apply(this, args);
      };
    }
    const dispatch = fresh.sendNativeEngine;
    fresh.sendNativeEngine = function (...args) {
      restoredCalls.push(args[2]);
      return dispatch.apply(this, args);
    };
    await fresh.restore(structuredClone(dto));
    assert.deepEqual(fresh.snapshot(), dto);
    assert.deepEqual(writes, beforeWrites);
    assert.deepEqual(restoredCalls, []);
    assert.equal(draws, 0);
    const restored = fresh.main,
      fm = fresh.runtime.imageDataBuffers.process;
    assert.equal(
      fm.view(address, restored.machine.memory.length).buffer,
      restored.machine.memory.buffer,
    );
    fm.store(address + 512, 99);
    assert.equal(restored.machine.load(512), 99);
    assert.equal(m.load(512), 73);
    await fresh.runtime.scheduler.execute(restored);
    assert.equal(restored.machine.load(404), 0);
    assert.ok(files.has('./木-99.css'));
    assert.equal(m.load(404), 0xa5a5a5a5);
    restored.machine.writeString('denied.css', 256);
    assert.deepEqual(await fresh.runtime.native('main', 0xd0, [256], restored.machine, restored), {
      control: 1,
      value: 0,
    });
    assert.equal(files.has('./denied.css'), false);
    assert.equal(first.nativeEngine, undefined);
    assert.equal(fresh.nativeEngine, undefined);
    await fresh.objects.release(restored.id);
    assert.equal(fm.contains(address, 1), false);
    assert.equal(memory.contains(address, 1), true);
  } finally {
    await fresh.close({ flushFiles: false });
    await first.close({ flushFiles: false });
  }
});
