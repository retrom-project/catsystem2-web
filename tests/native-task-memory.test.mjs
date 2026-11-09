// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeTaskMemory } from '../src/native/task-memory.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { KCSScheduler } from '../src/kcs/scheduler.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineMessages } from '../src/native/engine-message.mjs';

test('Root and Script prefixes acquire the same ready renderer view without creating a feature', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), {
      profile: 'nekopara-vol3-engine-2.6.1.76',
    }),
    p = engine.process,
    records = new Map(),
    world = { objects: { objects: records, machine: () => null } },
    memory = new NativeTaskMemory(engine, world),
    view = p.allocate(16, true),
    renderer = { initialized: false };
  engine.features.set('renderer', renderer);
  engine.features.set('graphics-platform', { refs: { view } });
  try {
    for (const [id, kind, offset] of [
      [1, 1, 104],
      [2, 12, 116],
      [3, 0, 104],
    ]) {
      const record = { id, kind, parent: null, name: 'authored prefix', frameRate: 60 },
        pointer = p.allocate(0x400, true);
      records.set(id, record);
      memory.bind(record, pointer);
      p.store(pointer + offset, 0x12345678);
      await memory.sync(record);
      assert.equal(p.load(pointer + offset), 0x12345678);
      renderer.initialized = true;
      await memory.sync(record);
      assert.equal(p.load(pointer + offset), kind ? view : 0x12345678);
      renderer.initialized = false;
    }
  } finally {
    await engine.close();
  }
});

test('native calls see the current ancestor and its World fields after a prefix is rebound', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    records = new Map(),
    world = { objects: { objects: records, machine: () => null } },
    memory = new NativeTaskMemory(engine, world);
  try {
    // Put leaves before their ancestors so the native preparation discovers
    // shared prefixes both recursively and in its active-task pass.
    for (const [id, parent] of [
      [3, 2],
      [4, 2],
      [2, 1],
      [1, null],
    ]) {
      const record = { id, parent, kind: 0, state: 'active', userValue: 7 };
      records.set(id, record);
      memory.bind(record, p.allocate(128, true));
    }
    const a = memory.refs.entries.get(3).pointer,
      b = memory.refs.entries.get(4).pointer,
      inspect = p.trap('read and change an authored native prefix', 3, ([a, b, expected]) => {
        const parent = p.load(a + 12),
          root = p.load(parent + 12);
        assert.equal(p.load(b + 12), parent);
        assert.equal(root, expected);
        const result = p.load(root + 92);
        p.store(root + 92, 0xffffffff);
        return result;
      }),
      oldRoot = memory.refs.entries.get(1).pointer;
    assert.equal(await engine.call(inspect, [a, b, oldRoot]), 7);
    assert.equal(p.load(oldRoot + 92), 0xffffffff);
    assert.equal(await engine.call(inspect, [a, b, oldRoot]), 7);

    const newRoot = p.allocate(128, true);
    records.get(1).userValue = 83;
    memory.unbind(1);
    memory.bind(records.get(1), newRoot);
    assert.equal(await engine.call(inspect, [a, b, newRoot]), 83);
    assert.equal(p.load(oldRoot + 92), 0xffffffff);
  } finally {
    await engine.close();
  }
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`the shared raw Base packet receiver uses the canonical graph and preserves unwritten output in ${profile}`, async () => {
    const engine = new NativeEngineProcess(await loadUnicorn(), { profile }),
      p = engine.process,
      records = new Map(),
      world = { profile, objects: { objects: records, machine: () => null } },
      protocol = new NativeEngineMessages(world),
      parent = {
        id: 100,
        nativeID: 0,
        kind: 0,
        flags: 42,
        parent: null,
        name: 'parent',
        exitCode: -1,
      },
      child = {
        id: 101,
        nativeID: 5,
        kind: 0,
        flags: 99,
        parent: null,
        name: 'child',
        exitCode: -1,
      };
    world.base = (record) => protocol.base(record);
    world.resolveTaskID = (nativeID, sender) => protocol.resolve(sender, nativeID);
    for (const record of [parent, child]) {
      records.set(record.id, record);
      record.implementation = protocol.base(record);
    }
    const memory = new NativeTaskMemory(engine, world),
      base = profile.startsWith('sdk-') ? 0x4b9360 : 0x5dd130,
      receiver = p.allocate(0x400, true),
      childPointer = p.allocate(0x400, true),
      packet = p.allocate(24, true),
      out = p.allocate(4, true),
      dump = p.allocate(256, true);
    p.map(base & ~4095, 4096, 'authored Base entry');
    memory.installBaseReceiver();
    memory.bind(parent, receiver);
    memory.bind(child, childPointer);
    const call = async (message, w = 0, l = 0) => {
      [0, 0, message, w, l, 0].forEach((word, i) => p.store(packet + i * 4, word));
      const result = await p.callAsync(base, [packet, out], receiver);
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0, p.stackTop);
      return result;
    };
    try {
      p.store(out, 0x12345678);
      assert.equal(await call(17), 0);
      assert.equal(p.load(out), 0x12345678);
      assert.equal(await call(999), 1);
      assert.equal(p.load(out), 0x12345678);
      assert.equal(await call(13), 0);
      assert.equal(p.load(out), 42);
      assert.equal(await call(24, 0, -123), 0);
      assert.equal(p.load(out), 42);
      assert.equal(parent.exitCode, -123);
      assert.equal(p.load(receiver + 80), -123 >>> 0);
      assert.equal(await call(23), 0);
      assert.equal(p.load(out), -123 >>> 0);
      assert.equal(await call(29, 0, 777), 0);
      assert.equal(parent.userValue, 777);
      assert.equal(p.load(receiver + 92), 777);
      assert.equal(await call(2, child.nativeID, childPointer), 0);
      assert.equal(child.parent, parent.id);
      assert.equal(p.load(childPointer + 12), receiver);
      assert.equal(await call(2, child.nativeID, childPointer), 0);
      assert.equal(p.load(out), 0);
      p.store(out, 0x12345678);
      const creationContext = { nativeNewTask: child.id };
      assert.equal(
        await engine.call(
          base,
          [packet, out],
          receiver,
          memory.messageOptions(parent, creationContext),
        ),
        0,
      );
      assert.equal(p.load(out), 0x12345678);
      assert.equal(creationContext.nativeUnhandled, false);
      assert.equal(await call(15), 0);
      assert.equal(p.load(out), 120);
      assert.equal(await call(16, 0, dump), 0);
      assert.equal(p.load(out), 120);
      assert.equal(p.string(dump + 16), 'parent');
      assert.equal(p.string(dump + 60 + 16), 'child');
      assert.equal(p.load(dump + 52), 1);
      assert.equal(p.load(dump + 60 + 48), child.nativeID);
      assert.equal(await call(3), 0);
      assert.equal(parent.destroyRequested, true);
      assert.equal(p.load(receiver + 84), 1);
      records.delete(parent.id);
      p.store(receiver + 84, 0);
      assert.equal(await call(3), 0);
      assert.equal(p.load(receiver + 84), 1);
    } finally {
      await engine.close();
    }
  });

test('native task memory keeps one VM/shared/block arena and preserves shared-buffer aliases', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    shared = new Uint8Array(16),
    script = { data: new Uint8Array(16), stackSize: 16, codeSize: 1 },
    first = new KCSMachine(script, () => {}, shared),
    second = new KCSMachine(script, () => {}, shared),
    machines = new Map([
      [1, first],
      [2, second],
    ]),
    world = { objects: { objects: new Map(), machine: (id) => machines.get(id) } },
    memory = new NativeTaskMemory(engine, world),
    p = engine.process;
  try {
    const block = first.allocate(16),
      a = memory.mapMachine(1, first),
      b = memory.mapMachine(2, second);
    assert.equal(a.shared.pointer, b.shared.pointer);
    assert.equal(memory.guestAddress(1, first, block + 4, 4), a.blocks[0].pointer + 4);
    const bridge = new NativeKCSMemory(p, first, a);
    assert.equal(p.load(bridge.pointer + 20), a.memory.pointer);
    assert.equal(p.load(bridge.pointer + 40), a.shared.pointer);
    p.store(a.memory.pointer + 8, 0x12345678);
    p.store(a.blocks[0].pointer + 4, 0x89abcdef);
    bridge.close();
    assert.equal(first.load(8), 0x12345678);
    assert.equal(first.load(block + 4), 0x89abcdef);
    assert.equal(p.allocations.has(a.memory.pointer), true);
    const originalShared = b.shared.pointer;
    first.shared = new Uint8Array(32);
    memory.mapMachine(1, first);
    assert.notEqual(a.shared.pointer, originalShared);
    assert.equal(b.shared.pointer, originalShared);
    assert.equal(p.allocations.has(originalShared), true);
    p.store(b.shared.pointer, 9);
    p.store(a.shared.pointer, 17);
    memory.afterCall();
    assert.equal(second.shared[0], 9);
    assert.equal(first.shared[0], 17);
    assert.equal(memory.refs.arenas.size, 5);
    const vm = memory.vmPointer(1),
      persistent = new NativeKCSMemory(p, first, a);
    assert.equal(persistent.pointer, vm);
    persistent.close();
    assert.equal(memory.vmPointer(1), vm);
    assert.equal(p.allocations.has(vm), true);
    assert.equal(p.load(vm + 20), a.memory.pointer);
    assert.equal(p.load(vm + 40), a.shared.pointer);
    const head = p.load(p.load(vm + 48)),
      node = p.load(head);
    assert.equal(p.load(node + 8), a.blocks[0].pointer);
  } finally {
    await engine.close();
  }
});

test('zero-byte native VM blocks retain distinct non-NULL payload identities', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    machine = new KCSMachine({ data: new Uint8Array(16), stackSize: 16, codeSize: 1 }, () => {}),
    world = { objects: { objects: new Map(), machine: () => machine } },
    memory = new NativeTaskMemory(engine, world);
  try {
    machine.allocate(0);
    machine.allocate(0);
    const mapping = memory.mapMachine(1, machine),
      pointers = mapping.blocks.map((block) => block.pointer);
    assert.ok(pointers.every((pointer) => pointer > 0));
    assert.notEqual(pointers[0], pointers[1]);
    assert.deepEqual(
      mapping.blocks.map((block) => block.capacity),
      [0, 0],
    );
    for (const pointer of pointers) {
      assert.equal(engine.process.allocations.get(pointer - 4), 4);
      assert.equal(engine.process.load(pointer - 4), 1);
      assert.equal(engine.kernel.heaps.get(1).blocks.has(pointer - 4), true);
    }
    memory.releaseMachine(1);
    for (const pointer of pointers) {
      assert.equal(engine.process.allocations.has(pointer - 4), false);
      assert.equal(engine.kernel.heaps.get(1).blocks.has(pointer - 4), false);
    }
  } finally {
    await engine.close();
  }
});

for (const [profile, path, decrement] of [
  ['sdk-4.01-engine-2.6.1.74', process.env.CATSYSTEM2_SDK_EXE, 0x575e10],
  ['nekopara-vol3-engine-2.6.1.76', process.env.CATSYSTEM2_ENGINE_EXE, 0x6a4b00],
])
  test(
    `${profile} retained VM payloads share the original heap and release through the original decrement function`,
    { skip: !path },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(path)),
        }),
        world = { objects: { objects: new Map(), machine: () => machine } },
        memory = new NativeTaskMemory(engine, world),
        p = engine.process;
      let machine;
      try {
        for (const size of [0, 1, 17, 1024]) {
          machine = new KCSMachine(
            { data: new Uint8Array(16), stackSize: 16, codeSize: 1 },
            () => {},
          );
          machine.allocate(size);
          const mapping = memory.mapMachine(1, machine),
            pointer = mapping.blocks[0].pointer,
            allocation = pointer - 4;
          p.store(allocation, 2);
          if (size === 1024) await memory.close();
          else memory.releaseMachine(1);
          assert.equal(p.load(allocation), 1);
          assert.equal(p.allocations.has(allocation), true);
          assert.equal(engine.kernel.heaps.get(1).blocks.has(allocation), true);
          await engine.call(decrement, [pointer]);
          assert.equal(p.allocations.has(allocation), false);
          assert.equal(engine.kernel.heaps.get(1).blocks.has(allocation), false);
        }
      } finally {
        await engine.close();
      }
    },
  );

test('Top device IDs remain in the raw prefix while later siblings are being destroyed', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    root = {
      id: 100,
      nativeID: 7,
      parent: null,
      kind: 1,
      frameRate: 60,
      sharedData: new Uint8Array(),
      implementation: { input: 101, sound: 102 },
    },
    records = new Map([
      [100, root],
      [101, { nativeID: 8 }],
      [102, { nativeID: 9 }],
    ]),
    world = { objects: { objects: records, machine: () => null } },
    memory = new NativeTaskMemory(engine, world),
    pointer = engine.process.allocate(0x400, true);
  try {
    memory.bind(root, pointer);
    await memory.sync(root);
    assert.equal(engine.process.load(pointer + 120), 8);
    assert.equal(engine.process.load(pointer + 124), 9);
    records.delete(101);
    records.delete(102);
    await memory.sync(root);
    assert.equal(engine.process.load(pointer + 120), 8);
    assert.equal(engine.process.load(pointer + 124), 9);
  } finally {
    await engine.close();
  }
});

for (const [profile, fixture] of [
  ['sdk-4.01-engine-2.6.1.74', process.env.CATSYSTEM2_SDK_EXE],
  ['nekopara-vol3-engine-2.6.1.76', process.env.CATSYSTEM2_ENGINE_EXE],
])
  test(
    `replacing an owned common prefix runs its original destructor without destroying the canonical task in ${profile}`,
    { skip: !fixture },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(fixture)),
        }),
        p = engine.process,
        record = {
          id: 7,
          nativeID: 3,
          kind: 0,
          flags: 42,
          parent: null,
          name: 'owned prefix',
          frameRate: 60,
          state: 'active',
          destroyRequested: false,
        },
        records = new Map([[record.id, record]]),
        world = { profile, objects: { objects: records, machine: () => null } },
        protocol = new NativeEngineMessages(world);
      world.base = (entry) => protocol.base(entry);
      record.implementation = protocol.base(record);
      const memory = new NativeTaskMemory(engine, world),
        name = p.allocate(32, true),
        replacement = p.allocate(0x400, true);
      p.write(name, new TextEncoder().encode('replacement\0'));
      try {
        const original = await memory.pointer(record.id);
        await memory.call(
          profile.startsWith('sdk-') ? 0x4b8cd0 : 0x5dcab0,
          [record.nativeID, name, record.frameRate],
          replacement,
        );
        record.implementation.pointer = replacement;
        assert.equal(await memory.pointer(record.id), replacement);
        assert.equal(record.destroyRequested, false);
        assert.equal(p.allocations.has(original), false);
        assert.equal(memory.worldID(original), undefined);
        assert.equal(memory.worldID(replacement), record.id);
        assert.equal(p.load(replacement + 64), 42);
        // This replacement is another independently constructed original Base,
        // so transfer its destruction ownership back to the common-prefix view.
        memory.refs.entries.get(record.id).owned = true;
      } finally {
        p.free(name);
        await engine.close();
      }
    },
  );

test('external VM shared aliases keep their original native pointer through growth and nested execution', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    data = p.allocate(16, true),
    record = { id: 1, sharedDataRef: { kind: 'engine', address: data, length: 16 } },
    machine = new KCSMachine({ data: new Uint8Array(16), stackSize: 16, codeSize: 1 }, () => {}),
    world = { objects: { objects: new Map([[1, record]]), machine: () => machine } },
    memory = new NativeTaskMemory(engine, world),
    mapping = memory.mapMachine(1, machine),
    bridge = new NativeKCSMemory(p, machine, mapping);
  let large;
  try {
    assert.equal(mapping.shared.pointer, data);
    assert.equal(mapping.shared.external, true);
    assert.equal(memory.refs.arenas.has(data), false);
    machine.store(0x80000000, 7);
    assert.equal(p.load(data), 7);
    const retained = machine.bytes(0x80000000, 16),
      code = p.allocate(32, true);
    p.write(code, [0x83, 0x05, ...u32(data), 2, 0xa1, ...u32(data), 0xc3]);
    assert.equal(p.call(code), 9);
    assert.equal(machine.load(0x80000000), 9);
    large = p.uc._malloc(p.uc.HEAPU8.byteLength);
    assert.ok(large);
    assert.equal(retained.byteLength, 0);
    machine.store(0x80000000, 11);
    assert.equal(p.load(data), 11);
    assert.equal(p.call(code), 13);
    bridge.close();
    assert.equal(machine.load(0x80000000), 13);
    assert.equal(p.allocations.has(data), true);
    await memory.close();
    assert.equal(p.allocations.has(data), true);
  } finally {
    if (large) p.uc._free(large);
    await engine.close();
  }
});

const u32 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];

test('runtime shared ranges and default machines use one live RAM arena, including new tasks', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    scheduler = new KCSScheduler({ shared: new Uint8Array(64), native() {} }),
    script = { data: new Uint8Array(16), stackSize: 16, codeSize: 1 },
    first = scheduler.add(script, { id: 1, name: 'one', abi: 'main' }),
    second = scheduler.add(script, { id: 2, name: 'two', abi: 'main' }),
    record = { id: 2, sharedDataRef: { kind: 'runtime', address: 8, length: 16 } },
    world = {
      runtime: { scheduler },
      objects: {
        objects: new Map([[2, record]]),
        machine: (id) => scheduler.tasks.get(id)?.machine,
      },
    },
    memory = new NativeTaskMemory(engine, world);
  try {
    const a = memory.mapMachine(1, first.machine),
      b = memory.mapMachine(2, second.machine),
      c = scheduler.add(script, { id: 3, name: 'three', abi: 'main' }),
      shared = memory.refs.runtimeShared;
    assert.equal(a.shared.pointer, shared.pointer);
    assert.equal(b.shared.pointer, shared.pointer + 8);
    assert.equal(b.shared.external, true);
    assert.equal(scheduler.shared.length, 64);
    second.machine.store(0x80000000, 42);
    assert.equal(first.machine.load(0x80000008), 42);
    assert.equal(c.machine.load(0x80000008), 42);
    p.store(shared.pointer + 8, 99);
    assert.equal(c.machine.load(0x80000008), 99);
    assert.equal(
      new DataView(scheduler.shared.buffer, scheduler.shared.byteOffset, 64).getUint32(8, true),
      99,
    );
    memory.afterCall();
    assert.equal(second.machine.load(0x80000000), 99);
    assert.equal(memory.mapMachine(3, c.machine).shared.pointer, shared.pointer);
    assert.equal(
      [...memory.refs.arenas.keys()].filter((pointer) => pointer === shared.pointer).length,
      1,
    );
  } finally {
    await engine.close();
  }
});
