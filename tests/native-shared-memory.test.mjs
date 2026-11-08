// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KCSScheduler } from '../src/kcs/scheduler.mjs';
import { readKCS, nativeReply } from '../src/kcs.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame, u32 } from './helpers.mjs';

// Each forced-growth test gets a fresh WASM heap. Growing one global test
// module repeatedly would exhaust its 32-bit address space by construction.
async function isolatedCPU() {
  let module;
  try {
    module = await import(new URL('../vendor/unicorn_x86.js', import.meta.url));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    module = await import(new URL('../.local/vendor/ppi/unicorn_x86.js', import.meta.url));
  }
  return module.default();
}

test('existing and new scheduler VMs follow one live runtime shared provider after growth and restore', async () => {
  const program = await readKCS(kcsProgram([[43, 0x41, 0], [59]])),
    make = () => new KCSScheduler({ load: async () => program, native: () => nativeReply(4) }),
    scheduler = make(),
    one = await scheduler.spawn('one.kcs', { abi: 'main' }),
    memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  scheduler.bindShared({ bytes: () => new Uint8Array(memory.buffer, 256, 64) });
  const two = await scheduler.spawn('two.kcs', { abi: 'main' });
  one.machine.store(0x80000004, 42);
  assert.equal(two.machine.load(0x80000004), 42);
  const old = one.machine.shared;
  memory.grow(1);
  assert.equal(old.length, 0);
  two.machine.store(0x80000008, 84);
  assert.equal(one.machine.load(0x80000008), 84);
  const fresh = make();
  await fresh.restore(structuredClone(scheduler.snapshot()));
  const other = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  new Uint8Array(other.buffer, 256, 64).set(fresh.shared);
  fresh.bindShared({ bytes: () => new Uint8Array(other.buffer, 256, 64) });
  fresh.tasks.get(one.id).machine.store(0x8000000c, 126);
  assert.equal(fresh.tasks.get(two.id).machine.load(0x8000000c), 126);
  assert.equal(new DataView(other.buffer).getUint32(268, true), 126);
});

function makeWorld(profile) {
  const game = memoryGame({
      'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
      'child.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
    }),
    random = new ParticleRandom(),
    configuration = new NativeConfiguration({ profile });
  return new NativeWorld({
    game,
    profile,
    configuration,
    random,
    images: {},
    host: {},
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
}
test('inline shared payloads retain their live span while task checkpoints own only that span', async () => {
  const world = makeWorld('nekopara-vol3-engine-2.6.1.76'),
    ram = new WebAssembly.Memory({ initial: 32 }),
    payload = { bytes: (at, length) => new Uint8Array(ram.buffer, at, length) };
  try {
    await world.initialize('main.kcs');
    await world.sendEngine(world.root, world.main.id, 32, 32, 256, { payload });
    const root = world.objects.objects.get(world.root);
    assert.equal(root.sharedDataRef, null);
    assert.equal(root.sharedData.buffer, ram.buffer);
    root.sharedData[1] = 17;
    assert.equal(new Uint8Array(ram.buffer)[257], 17);
    const saved = world.objects.snapshot().objects.find((record) => record.id === world.root);
    assert.equal(saved.sharedData.length, 32);
    assert.equal(saved.sharedData.buffer.byteLength, 32);
    assert.equal(Object.hasOwn(saved.data, 'sharedData'), false);
    new Uint8Array(ram.buffer)[257] = 19;
    assert.equal(root.sharedData[1], 19);
    assert.equal(saved.sharedData[1], 17);
  } finally {
    await world.close({ flushFiles: false });
  }
});
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(`${profile} overlapping inline Root spans retain one compact checkpoint backing`, async () => {
    const world = makeWorld(profile),
      ram = new WebAssembly.Memory({ initial: 32 }),
      payload = { bytes: (at, size) => new Uint8Array(ram.buffer, at, size) },
      setData = profile.startsWith('sdk-') ? 30 : 32;
    let fresh;
    try {
      await world.initialize('main.kcs');
      const other = await world.objects.create({
          kind: 1,
          parent: null,
          nativeID: 0,
          name: 'other Top',
        }),
        distant = await world.objects.create({
          kind: 1,
          parent: null,
          nativeID: 0,
          name: 'distant Top',
        });
      await world.sendEngine(world.root, world.main.id, setData, 32, 256, { payload });
      await world.sendEngine(other, world.main.id, setData, 32, 264, { payload });
      await world.sendEngine(distant, world.main.id, setData, 16, 4096, { payload });
      const root = world.objects.objects.get(world.root),
        second = world.objects.objects.get(other);
      root.sharedData[12] = 17;
      assert.equal(second.sharedData[4], 17);
      const snapshot = world.snapshot(),
        saved = snapshot.objects.objects,
        a = saved.find((record) => record.id === world.root).sharedData,
        b = saved.find((record) => record.id === other).sharedData,
        c = saved.find((record) => record.id === distant).sharedData;
      assert.equal(a.buffer, b.buffer);
      assert.equal(a.buffer.byteLength, 40);
      assert.equal(b.byteOffset - a.byteOffset, 8);
      assert.equal(c.buffer.byteLength, 16);
      assert.notEqual(c.buffer, a.buffer);
      fresh = makeWorld(profile);
      await fresh.restore(structuredClone(snapshot));
      const fr = fresh.objects.objects.get(world.root),
        fs = fresh.objects.objects.get(other);
      assert.equal(fr.sharedData.buffer, fs.sharedData.buffer);
      fr.implementation.sharedData[12] = 23;
      assert.equal(fs.implementation.sharedData[4], 23);
      assert.equal(second.sharedData[4], 17);
      assert.equal(b[4], 17);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });
  test(
    `${profile} Root prefix aliases retain raw pointers, overlapping spans and fresh-process RAM`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        world = makeWorld(profile),
        setData = profile.startsWith('sdk-') ? 30 : 32;
      let fresh,
        large = 0;
      try {
        await world.initialize('main.kcs');
        world.nativeEngine = await NativeEngineProcess.open({
          unicornFactory: isolatedCPU,
          bytes,
          profile,
          configuration: world.configuration,
        });
        world.nativeEngineLoading = Promise.resolve(world.nativeEngine);
        const engine = world.nativeEngine,
          p = engine.process,
          memory = await world.getNativeFeature('task-memory'),
          peer = await world.objects.create({
            kind: 1,
            parent: null,
            nativeID: 0,
            name: 'PE peer Top',
          }),
          hostA = await world.objects.create({
            kind: 1,
            parent: null,
            nativeID: 0,
            name: 'host A Top',
          }),
          hostB = await world.objects.create({
            kind: 1,
            parent: null,
            nativeID: 0,
            name: 'host B Top',
          }),
          address = p.allocate(64, true),
          payload = { bytes: (at, size) => p.view(at, size) },
          hostBytes = new Uint8Array(512),
          hostPayload = { bytes: (at, size) => hostBytes.subarray(at, at + size) };
        await world.sendEngine(world.root, world.main.id, setData, 32, address, { payload });
        await world.sendEngine(peer, world.main.id, setData, 32, address + 8, { payload });
        const a = await memory.pointer(world.root),
          b = await memory.pointer(peer);
        assert.equal(p.load(a + 112), address);
        assert.equal(p.load(b + 112), address + 8);
        assert.equal(world.objects.objects.get(world.root).sharedDataRef.kind, 'engine');
        await world.sendEngine(hostA, world.main.id, setData, 32, 256, { payload: hostPayload });
        await world.sendEngine(hostB, world.main.id, setData, 32, 264, { payload: hostPayload });
        const ha = await memory.pointer(hostA),
          hb = await memory.pointer(hostB),
          hostAddress = p.load(ha + 112),
          increment = (at, data) =>
            p.write(at, [0xa1, ...u32(data), 0x40, 0xa3, ...u32(data), 0xc3]);
        assert.equal(p.load(hb + 112), hostAddress + 8);
        increment(0x5200, address + 12);
        increment(0x5300, hostAddress + 12);
        p.store(address + 12, 7);
        assert.equal(await engine.call(0x5200), 8);
        assert.equal(world.objects.objects.get(peer).implementation.sharedData[4], 8);
        new DataView(hostBytes.buffer).setUint32(268, 9, true);
        assert.equal(await engine.call(0x5300), 10);
        assert.equal(hostBytes[268], 10);
        const hostRoot = world.objects.objects.get(hostA).implementation;
        new DataView(hostRoot.sharedData.buffer, hostRoot.sharedData.byteOffset, 32).setUint32(
          12,
          41,
          true,
        );
        hostBytes[272] = 23;
        assert.equal(
          await engine.call(0x5300),
          42,
          'unchanged host bytes cannot overwrite newer canonical RAM',
        );
        assert.equal(
          p.load(hostAddress + 16) & 255,
          23,
          'independent host changes merge with canonical RAM',
        );
        new DataView(hostBytes.buffer).setUint32(268, 43, true);
        assert.equal(await engine.call(0x5300), 44);
        const old = world.objects.objects.get(peer).implementation.sharedData,
          size = p.uc.HEAPU8.length;
        large = p.uc._malloc(size);
        assert.ok(p.uc.HEAPU8.length > size);
        assert.equal(old.length, 0);
        world.objects.objects.get(peer).implementation.sharedData[5] = 17;
        assert.equal(p.load(address + 12), 8 + 17 * 256);
        const snapshot = structuredClone(world.snapshot());
        fresh = makeWorld(profile);
        fresh.nativeEngine = await NativeEngineProcess.open({
          unicornFactory: isolatedCPU,
          bytes,
          profile,
          configuration: fresh.configuration,
        });
        fresh.nativeEngineLoading = Promise.resolve(fresh.nativeEngine);
        await fresh.restore(snapshot);
        const fm = await fresh.getNativeFeature('task-memory'),
          fp = fresh.nativeEngine.process;
        assert.equal(fp.load((await fm.pointer(peer)) + 112), address + 8);
        assert.equal(fp.load((await fm.pointer(hostB)) + 112), hostAddress + 8);
        fresh.objects.objects.get(peer).implementation.sharedData[4] = 19;
        assert.equal(fresh.objects.objects.get(world.root).implementation.sharedData[12], 19);
        assert.equal(p.load(address + 12) & 255, 8);
        assert.equal(await fresh.nativeEngine.call(0x5300), 45);
        assert.equal(fresh.objects.objects.get(hostB).implementation.sharedData[4], 45);
        assert.equal(hostBytes[268], 44);
      } finally {
        if (large && world.nativeEngine) world.nativeEngine.process.uc._free(large);
        await world.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
      }
    },
  );
  test(`${profile} shared references flatten self and cross-VM chains without following later source bindings`, async () => {
    const world = makeWorld(profile);
    let fresh;
    try {
      await world.initialize('main.kcs');
      const receiver = await world.spawnScript('child.kcs'),
        source = await world.spawnScript('child.kcs'),
        main = world.main,
        record = world.objects.objects.get(receiver.id);
      source.machine.store(256, 0x12345678);
      await world.sendEngine(receiver.id, source.id, 171, 32, 256);
      await world.sendEngine(receiver.id, receiver.id, 171, 16, 0x80000004);
      assert.deepEqual(record.sharedDataRef, {
        kind: 'vm',
        taskID: source.id,
        memoryID: source.machine.memoryID,
        address: 260,
        length: 16,
      });
      receiver.machine.store(0x80000000, 0xabcdef01);
      assert.equal(source.machine.load(260), 0xabcdef01);
      fresh = makeWorld(profile);
      await fresh.restore(structuredClone(world.snapshot()));
      fresh.runtime.scheduler.tasks.get(receiver.id).machine.store(0x80000004, 0x76543210);
      assert.equal(fresh.runtime.scheduler.tasks.get(source.id).machine.load(264), 0x76543210);
      await world.sendEngine(source.id, main.id, 171, 64, 0x80000100);
      await world.sendEngine(receiver.id, source.id, 171, 16, 0x80000008);
      assert.deepEqual(record.sharedDataRef, { kind: 'runtime', address: 264, length: 16 });
      await world.sendEngine(source.id, main.id, 171, 64, 512);
      receiver.machine.store(0x80000004, 0x13579bdf);
      assert.equal(
        new DataView(world.runtime.scheduler.shared.buffer).getUint32(268, true),
        0x13579bdf,
      );
      assert.equal(main.machine.load(516), 0);
      await world.sendEngine(main.id, main.id, 171, 16, 0x80000010);
      assert.deepEqual(world.objects.objects.get(main.id).sharedDataRef, {
        kind: 'runtime',
        address: 16,
        length: 16,
      });
      main.machine.store(0x80000004, 99);
      assert.equal(new DataView(world.runtime.scheduler.shared.buffer).getUint32(20, true), 99);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });
  test(`${profile} block-backed aliases keep allocation identity across compaction and diagnose released sources`, async () => {
    const world = makeWorld(profile);
    let fresh;
    try {
      await world.initialize('main.kcs');
      const source = world.main,
        target = await world.spawnScript('child.kcs'),
        m = source.machine,
        a = m.allocate(16),
        b = m.allocate(16),
        blockID = m.blockIDs[1];
      m.store(b + 4, 0x12345678);
      await world.sendEngine(target.id, source.id, 171, 8, b + 4);
      const record = world.objects.objects.get(target.id);
      assert.deepEqual(record.sharedDataRef, {
        kind: 'vm-block',
        taskID: source.id,
        memoryID: m.memoryID,
        blockID,
        offset: 4,
        length: 8,
      });
      assert.equal(m.free(a), true);
      assert.equal(target.machine.load(0x80000000), 0x12345678);
      fresh = makeWorld(profile);
      await fresh.restore(structuredClone(world.snapshot()));
      const ft = fresh.runtime.scheduler.tasks.get(target.id),
        fs = fresh.main;
      ft.machine.store(0x80000004, 0xabcdef01);
      assert.equal(fs.machine.load(fs.machine.memory.length + 8), 0xabcdef01);
      assert.equal(m.free(m.memory.length), true);
      assert.throws(() => target.machine.load(0x80000000), /released/);
      const replacement = m.allocate(16);
      m.store(replacement + 4, 99);
      assert.throws(() => target.machine.load(0x80000000), /released/);
      await world.sendEngine(target.id, source.id, 171, 8, 256);
      await world.objects.objects.get(source.id).implementation.loadScript('main.kcs');
      assert.throws(() => target.machine.load(0x80000000), /interpreter was replaced/);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });
  test(
    `${profile} Script171 and restored VMs alias real PE RAM during nested async calls`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        world = makeWorld(profile);
      let fresh,
        large = 0;
      try {
        await world.initialize('main.kcs');
        world.nativeEngine = await NativeEngineProcess.open({
          unicornFactory: isolatedCPU,
          bytes,
          profile,
          configuration: world.configuration,
        });
        world.nativeEngineLoading = Promise.resolve(world.nativeEngine);
        const engine = world.nativeEngine,
          p = engine.process,
          memory = await world.getNativeFeature('task-memory'),
          child = await world.spawnScript('child.kcs'),
          peer = await world.spawnScript('child.kcs'),
          address = p.allocate(64, true) + 16,
          outer = 0x5000,
          inner = 0x5100;
        p.store(address, 3);
        await world.sendEngine(child.id, world.main.id, 171, 32, address, {
          payload: p,
          nativePointer: true,
        });
        child.machine.store(0x80000004, 9);
        assert.equal(p.load(address + 4), 9);
        const callback = p.trap('authored nested Script shared RAM callback', 0, async () => {
          assert.equal(child.machine.load(0x80000000), 7);
          child.machine.store(0x80000000, 9);
          await Promise.resolve();
          assert.equal(await p.callFromHost(inner), 11);
          assert.equal(child.machine.load(0x80000000), 11);
          child.machine.store(0x80000000, 13);
        });
        p.write(inner, [0x83, 0x05, ...u32(address), 2, 0xa1, ...u32(address), 0xc3]);
        p.write(outer, [
          0xc7,
          0x05,
          ...u32(address),
          ...u32(7),
          0xe8,
          ...u32(callback - outer - 15),
          0xa1,
          ...u32(address),
          0xc3,
        ]);
        assert.equal(await p.callAsync(outer), 13);
        const old = child.machine.shared,
          size = p.uc.HEAPU8.length;
        large = p.uc._malloc(size);
        assert.ok(p.uc.HEAPU8.length > size);
        assert.equal(old.length, 0);
        assert.equal(child.machine.load(0x80000000), 13);
        await world.sendEngine(peer.id, child.id, 171, 16, 0x80000008);
        child.machine.store(0x80000008, 19);
        assert.equal(peer.machine.load(0x80000000), 19);
        await world.objects.objects.get(child.id).implementation.loadScript('child.kcs');
        assert.equal(child.id, world.runtime.scheduler.tasks.get(child.id).id);
        const reloaded = world.runtime.scheduler.tasks.get(child.id).machine,
          vm = memory.vmPointer(child.id);
        assert.equal(reloaded.load(0x80000000), 13);
        assert.equal(p.load(vm + 40), address);
        const mainVM = memory.vmPointer(world.main.id),
          runtimeBase = p.load(mainVM + 40);
        await world.sendEngine(child.id, world.main.id, 171, 16, 0x80000020);
        reloaded.store(0x80000004, 23);
        assert.equal(p.load(runtimeBase + 36), 23);
        assert.equal(p.load(memory.vmPointer(child.id) + 40), runtimeBase + 32);
        assert.equal(peer.machine.load(0x80000000), 19);
        const state = structuredClone(world.snapshot());
        fresh = makeWorld(profile);
        fresh.nativeEngine = await NativeEngineProcess.open({
          unicornFactory: isolatedCPU,
          bytes,
          profile,
          configuration: fresh.configuration,
        });
        fresh.nativeEngineLoading = Promise.resolve(fresh.nativeEngine);
        // Reconstruct the authored host ABI as well as guest memory. The original
        // process callback is never borrowed by the fresh process.
        fresh.nativeEngine.process.trap(
          'authored nested Script shared RAM callback',
          0,
          async () => {
            const fp = fresh.nativeEngine.process;
            assert.equal(fp.load(address), 7);
            fp.store(address, 9);
            await Promise.resolve();
            assert.equal(await fp.callFromHost(inner), 11);
            fp.store(address, 13);
          },
        );
        await fresh.restore(state);
        const restored = fresh.runtime.scheduler.tasks.get(peer.id).machine;
        restored.store(0x80000000, 29);
        assert.equal(fresh.nativeEngine.process.load(address + 8), 29);
        assert.equal(p.load(address + 8), 19);
        const fm = await fresh.getNativeFeature('task-memory');
        fm.vmPointer(world.main.id);
        fresh.runtime.scheduler.tasks.get(child.id).machine.store(0x80000004, 31);
        assert.equal(
          new DataView(
            fresh.runtime.scheduler.shared.buffer,
            fresh.runtime.scheduler.shared.byteOffset,
          ).getUint32(36, true),
          31,
        );
      } finally {
        if (large && world.nativeEngine) world.nativeEngine.process.uc._free(large);
        await world.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
      }
    },
  );
  test(
    `${profile} contiguous and block arenas retain physical identity through free, realloc, grow and restore`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        world = makeWorld(profile);
      let fresh,
        large = 0;
      try {
        await world.initialize('main.kcs');
        world.nativeEngine = await NativeEngineProcess.open({
          unicornFactory: isolatedCPU,
          bytes,
          profile,
          configuration: world.configuration,
        });
        world.nativeEngineLoading = Promise.resolve(world.nativeEngine);
        const p = world.nativeEngine.process,
          memory = await world.getNativeFeature('task-memory'),
          source = world.main,
          target = await world.spawnScript('child.kcs'),
          peer = await world.spawnScript('child.kcs'),
          m = source.machine;
        const sourceVM = memory.vmPointer(source.id),
          base = p.load(sourceVM + 20);
        await world.sendEngine(target.id, source.id, 171, 16, 256);
        const targetBase = p.load(memory.vmPointer(target.id) + 40);
        assert.equal(targetBase, base + 256);
        m.data[256] = 7;
        assert.equal(target.machine.load(0x80000000, 1), 7);
        target.machine.store(0x80000004, 0x12345678);
        assert.equal(
          new DataView(m.data.buffer, m.data.byteOffset).getUint32(260, true),
          0x12345678,
        );
        m.stack[0] = 11;
        assert.equal(p.load(base + m.data.length) & 255, 11);
        const a = m.allocate(16),
          b = m.allocate(16),
          c = m.allocate(16),
          ids = m.blockIDs;
        m.store(b + 4, 41);
        memory.vmPointer(source.id);
        const aBase = memory.guestAddress(source.id, m, a),
          bBase = memory.guestAddress(source.id, m, b);
        await world.sendEngine(peer.id, source.id, 171, 8, b + 4);
        assert.equal(p.load(memory.vmPointer(peer.id) + 40), bBase + 4);
        assert.equal(world.objects.objects.get(peer.id).sharedDataRef.kind, 'engine');
        assert.equal(m.free(a), true);
        memory.vmPointer(source.id);
        assert.deepEqual(m.blockIDs, [ids[1], ids[2]]);
        assert.equal(memory.guestAddress(source.id, m, m.memory.length), bBase);
        m.store(m.memory.length + 4, 43);
        assert.equal(peer.machine.load(0x80000000), 43);
        const before = m.blocks[0],
          oldData = m.data,
          size = p.uc.HEAPU8.length;
        large = p.uc._malloc(size);
        assert.ok(p.uc.HEAPU8.length > size);
        assert.equal(before.length, 0);
        assert.equal(oldData.length, 0);
        assert.equal(peer.machine.load(0x80000000), 43);
        assert.equal(m.load(m.memory.length + 4), 43);
        assert.equal(m.free(m.memory.length), true);
        memory.vmPointer(source.id);
        // Each live allocation now materializes its native list node at once;
        // the larger request covers both released payloads and those nodes.
        const d = m.allocate(64);
        memory.vmPointer(source.id);
        const dBase = memory.guestAddress(source.id, m, d);
        assert.equal(dBase, aBase, 'the existing PE allocator reuses the adjacent released arena');
        assert.ok(bBase + 12 <= dBase + 64);
        m.store(d + bBase - dBase + 4, 47);
        assert.equal(peer.machine.load(0x80000000), 47);
        assert.ok(!m.blockIDs.includes(ids[1]));
        assert.equal(c, m.memory.length + 32);
        const state = structuredClone(world.snapshot());
        fresh = makeWorld(profile);
        fresh.nativeEngine = await NativeEngineProcess.open({
          unicornFactory: isolatedCPU,
          bytes,
          profile,
          configuration: fresh.configuration,
        });
        fresh.nativeEngineLoading = Promise.resolve(fresh.nativeEngine);
        await fresh.restore(state);
        const fm = await fresh.getNativeFeature('task-memory'),
          fs = fresh.main.machine,
          fp = fresh.nativeEngine.process,
          restoredPeer = fresh.runtime.scheduler.tasks.get(peer.id).machine;
        assert.ok(fs.memoryBinding, 'restore returns an interpreter backed by its native arena');
        assert.ok(fs.blockStorage.every((block) => block.binding));
        fs.bytes(0, 5).fill(0xa5);
        fs.stack[0] = 0x6d;
        fs.bytes(fs.memory.length, 5).fill(0xb6);
        restoredPeer.bytes(0x80000000, 5).fill(0xc7);
        // First native entry must preserve writes made immediately after
        // restore, in every address domain, without a preparatory map call.
        assert.equal(fp.load(base) & 255, 0xa5);
        assert.equal(fp.load(base + fs.data.length) & 255, 0x6d);
        const restoredBlock = fm.refs.machines.get(source.id).blocks[0].pointer;
        assert.equal(fp.load(restoredBlock) & 255, 0xb6);
        assert.equal(fp.load(bBase + 4) & 255, 0xc7);
        fm.vmPointer(source.id);
        assert.deepEqual([...fs.bytes(0, 5)], [0xa5, 0xa5, 0xa5, 0xa5, 0xa5]);
        assert.equal(fs.stack[0], 0x6d);
        assert.deepEqual([...fs.bytes(fs.memory.length, 5)], [0xb6, 0xb6, 0xb6, 0xb6, 0xb6]);
        assert.deepEqual([...restoredPeer.bytes(0x80000000, 5)], [0xc7, 0xc7, 0xc7, 0xc7, 0xc7]);
        restoredPeer.store(0x80000000, 47);
        assert.equal(fs.memoryID, m.memoryID);
        assert.deepEqual(fs.blockIDs, m.blockIDs);
        assert.equal(restoredPeer.load(0x80000000), 47);
        restoredPeer.store(0x80000000, 53);
        assert.equal(fp.load(bBase + 4), 53);
        assert.equal(p.load(bBase + 4), 47);
        fresh.runtime.scheduler.tasks.get(target.id).machine.store(0x80000000, 59);
        assert.equal(fs.load(256), 59);
        assert.equal(fp.load(base + 256), 59);
        assert.equal(p.load(base + 256) & 255, 7);
        // A replaced source interpreter cannot retarget an existing physical
        // pointer. Its allocator may reuse that address, as in the original.
        await fresh.objects.objects.get(source.id).implementation.loadScript('child.kcs');
        assert.equal(
          fm.refs.machines.has(source.id),
          false,
          'reload releases the old VM immediately',
        );
        fm.vmPointer(source.id);
        assert.equal(fp.load(fm.vmPointer(target.id) + 40), targetBase);
        fp.store(targetBase, 61);
        assert.equal(fresh.runtime.scheduler.tasks.get(target.id).machine.load(0x80000000), 61);
        const owner = await fresh.spawnScript('child.kcs'),
          owned = owner.machine;
        fm.vmPointer(owner.id);
        assert.equal(owned.allocate(0), 0xffffffff);
        assert.equal(owned.blocks[0].length, 0);
        const regular = owned.allocate(8);
        await fresh.sendEngine(owner.id, owner.id, 171, 8, regular);
        assert.equal(owned.free(0x80000001), false);
        assert.equal(owned.free(0x80000000), true);
        assert.deepEqual(
          owned.blocks.map((block) => block.length),
          [0],
        );
        for (const size of [8, 0]) {
          // Supply a deliberately freed raw arena as the shared pointer, then
          // let the same allocator reuse it. The inverse translator must test
          // shared RAM before the newly inserted block, including a 0B block.
          const probe = fm.liveBuffer(null, new Uint8Array(size), { block: true }),
            address = probe.pointer;
          fm.freeVMBuffer(probe);
          await fresh.sendEngine(owner.id, owner.id, 171, Math.max(1, size), address, {
            nativePointer: true,
            payload: fp,
          });
          assert.equal(owned.allocate(size), 0x80000000);
          assert.equal(fm.refs.machines.get(owner.id).blocks.at(-1).pointer, address);
          assert.equal(owned.free(0x80000000), true);
          assert.deepEqual(
            owned.blocks.map((block) => block.length),
            [0],
          );
        }
        await fresh.objects.release(target.id);
        assert.equal(
          fm.refs.machines.has(target.id),
          false,
          'Script destruction releases its VM arena',
        );
        assert.equal(fresh.runtime.scheduler.tasks.has(target.id), false);
      } finally {
        if (large && world.nativeEngine) world.nativeEngine.process.uc._free(large);
        await world.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
      }
    },
  );
}
