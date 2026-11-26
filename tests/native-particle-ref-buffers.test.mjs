// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleRefBuffers, particleRefBufferRequests } from '../src/ppi/abi.mjs';
import { NativeBufferMemory, NativeBufferAllocationError } from '../src/native/buffer-memory.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { kcsProgram } from './helpers.mjs';
import { scriptParticles } from '../src/ppi/geometry.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-particle-ref-buffer-golden.json', import.meta.url)),
  ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

class ControlledRefHeap extends NativeBufferMemory {
  constructor(failureAt) {
    super();
    this.failureAt = failureAt;
    this.requests = [];
  }
  allocate(size) {
    this.requests.push(size);
    if (!this.failureAt || this.requests.length === this.failureAt)
      throw new NativeBufferAllocationError('Controlled original HeapAlloc failure');
    const address = super.allocate(size);
    this.view(address, size).fill(0xa5);
    return address;
  }
}

test('RefBuffer requests use DWORD products without allocating the requested large payloads', () => {
  for (const row of golden.requestCases.filter((r) => r.count !== 3)) {
    const count = row.count;
    const memory = new ControlledRefHeap(0),
      owner = new ParticleRefBuffers(count, { memory });
    assert.deepEqual(memory.requests, row.bytes);
    assert.equal(memory.regions.size, 0);
    assert(Object.values(owner.snapshot().fields).every((value) => value === null));
    owner.close();
  }
  for (const count of [-1, 1.5, 0x100000000])
    assert.throws(() => particleRefBufferRequests(count), /DWORD/);
});

test('Partial allocation preserves the other owners and only read bytes require initialization', async () => {
  const memory = new ControlledRefHeap(7),
    owner = new ParticleRefBuffers(3, { memory });
  assert.deepEqual(memory.requests, [340, 340, 52, 52, 52, 52, 16, 28, 16]);
  assert.equal(owner.get('visibility'), null);
  assert.throws(() => owner.span('visibility', 0, 4), /allocation is missing/);
  assert.throws(() => owner.span('positions', 0, 12, true), /uninitialized/);
  const position = owner.span('positions', 0, 16);
  new Uint32Array(position.buffer, position.byteOffset, 4).set([
    0xff812345, 0x80000000, 0x3f800000, 0,
  ]);
  owner.mark('positions', 0, 16);
  assert.deepEqual(
    [...new Uint32Array(position.buffer, position.byteOffset, 4)],
    [0xff812345, 0x80000000, 0x3f800000, 0],
  );
  assert.equal(owner.span('positions', 0, 12, true), position);
  assert.throws(() => owner.span('positions', 16, 12, true), /uninitialized/);
  for (const offset of [20, 48, 76, 104]) owner.mark('quads', offset, 8);
  assert.throws(() => owner.span('quads', 0, 112, true), /uninitialized/);
  const quad = owner.span('quads', 0, 112),
    bytes = Uint8Array.from({ length: 112 }, (_, i) => (i * 29 + 17) & 255);
  quad.set(bytes);
  owner.mark('quads', 0, 112);
  owner.copy('backupQuads', 'quads');
  quad.fill(0, 0, 112);
  owner.copy('quads', 'backupQuads');
  assert.deepEqual(owner.get('quads').subarray(0, 112), bytes);
  owner.span('quads', 0, 112, true);
  assert.throws(() => owner.span('backupQuads', 112, 112, true), /uninitialized/);
  const state = await deserializeCheckpoint(await serializeCheckpoint(owner.snapshot()));
  const freshMemory = new ControlledRefHeap(0),
    fresh = new ParticleRefBuffers(3, { memory: freshMemory, snapshot: state });
  assert.deepEqual(fresh.snapshot(), state);
  assert.deepEqual(
    freshMemory.requests,
    [],
    'cold owners reserve saved bytes without retrying allocation outcomes',
  );
  fresh.span('positions', 0, 12, true);
  assert.throws(() => fresh.span('positions', 16, 12, true), /uninitialized/);
  fresh.get('quads')[0] ^= 255;
  assert.notDeepEqual(fresh.get('quads'), owner.get('quads'));
  fresh.close();
  owner.close();
  owner.close();
  assert.equal(freshMemory.regions.size, 0);
  assert.equal(memory.regions.size, 0);
  assert.throws(() => owner.get('quads'), /released/);
});

test('RefBuffer construction propagates programming errors and releases preceding owners', () => {
  const memory = new NativeBufferMemory(),
    allocate = memory.allocate.bind(memory);
  let calls = 0;
  memory.allocate = (size) => {
    if (++calls === 3) throw new TypeError('Bad allocator caller');
    return allocate(size);
  };
  assert.throws(() => new ParticleRefBuffers(3, { memory }), /Bad allocator caller/);
  assert.equal(memory.regions.size, 0);
});

for (const build of golden.builds)
  test(`${build.version} real Particle owners allow defined byte writes and reads after a partial allocation failure and cold restore`, async () => {
    for (const row of build.cases) {
      const files = {
          [row.input.programName]: Buffer.from(row.input.script, 'base64'),
          [row.input.textureName]: Buffer.from(row.input.texture, 'base64'),
        },
        world = await modernParticleMessageWorld(build.profile, files),
        memory = new ControlledRefHeap(row.failureAt);
      world.particles.host.refBufferMemory = memory;
      try {
        world.graphics.createLogicalDevice();
        const id = await world.objects.create({ kind: 16, parent: world.root }),
          task = world.particles.get(id),
          packet = new NativeGraphicsPacket(new Array(0x290 / 4).fill(0));
        packet.bytes(4, 128).set(encodeCP932(row.input.programName + '\0'));
        packet.bytes(132, 128).set(encodeCP932(row.input.textureName + '\0'));
        packet.store(260, 3);
        packet.store(264, row.input.priorityWord);
        for (let i = 0; i < 32; i++) packet.store(268 + i * 4, 0x3f800000 + i);
        assert.equal(
          await world.sendEngine(id, world.main.id, 314, 0, 0, { payload: packet }),
          NATIVE_UNWRITTEN_WORD,
        );
        assert.deepEqual(
          memory.requests,
          row.requests.map((r) => r.bytes),
        );
        const instance = task.bank.instance,
          machine = instance.machine;
        assert.equal(instance.refBuffers.get(row.failureAt === 1 ? 'quads' : 'visibility'), null);
        assert.equal(task.bank.loaded, true);
        assert.equal(task.active, false);
        machine.bytes(128, 112).set(Buffer.from(row.input.partialData.rawQuad, 'base64'));
        for (const call of row.calls) {
          if (['uninitialized-position-read', 'write-position'].includes(call.label))
            for (const at of [512, 516, 520]) machine.store(at, 0xcccccccc);
          if (call.label === 'overwrite-quad')
            machine.bytes(128, 112).set(Buffer.from(row.input.partialData.replacement, 'base64'));
          machine.bytes(4096, 128).fill(0);
          call.words.forEach((word, i) => machine.store(4096 + i * 4, word));
          assert.equal(hash(machine.memory), call.beforeLocal, call.label + ' before');
          if (call.classification === 'capture-only-uninitialized-source') {
            const before = machine.memory.slice();
            assert.throws(() => instance.native(call.id, call.words, machine), /uninitialized/);
            assert.deepEqual(machine.memory, before);
            continue;
          }
          const result = instance.native(call.id, call.words, machine);
          assert.equal(result.control, call.control, call.label);
          assert.equal(Object.hasOwn(result, 'value') ? result.value : 0xcccccccc, call.out);
          assert.equal(hash(machine.memory), call.afterLocal, call.label + ' after');
          const fresh = await modernParticleMessageWorld(build.profile, files, {
              initialize: false,
            }),
            freshHeap = new ControlledRefHeap(0);
          try {
            fresh.particles.host.refBufferMemory = freshHeap;
            fresh.graphics.createLogicalDevice();
            await fresh.restore(
              await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
            );
            const copy = fresh.particles.get(id).bank.instance;
            assert.deepEqual(copy.snapshot(), instance.snapshot());
            assert.deepEqual(freshHeap.requests, []);
            if (call.label === 'read-written-position')
              assert.doesNotThrow(() => copy.refBuffers.span('positions', 0, 12, true));
          } finally {
            await fresh.close({ flushFiles: false });
            assert.equal(freshHeap.regions.size, 0);
          }
        }
        if (row.failureAt === 1)
          assert.throws(() => instance.vertices(0), /quads allocation is missing/);
        else {
          assert.doesNotThrow(() => instance.vertices(0));
          assert.throws(() => scriptParticles(instance), /bases bytes are uninitialized/);
        }
        await world.sendEngine(id, world.main.id, 315);
        assert.equal(task.active, true);
        instance.refBuffers.span('positions', 0, 12, true);
        await world.sendEngine(id, world.main.id, 317);
        assert.equal(task.bank, null);
        assert.equal(memory.regions.size, 0);
        assert.equal(world.particles.textures.owned.size, 0);
      } finally {
        await world.close({ flushFiles: false });
        assert.equal(memory.regions.size, 0);
      }
    }
  });

for (const build of golden.builds)
  test(`${build.version} actual Main KCS preserves the large-count failed bank and cold state without dense allocation`, async () => {
    const input = build.cases[0].input,
      row = golden.requestCases.find((r) => r.version === build.version && r.count === 1000001),
      call = (id, args, output) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        ...(output === undefined ? [] : [[38, output]]),
      ],
      files = {
        [input.programName]: Buffer.from(input.script, 'base64'),
        [input.textureName]: Buffer.from(input.texture, 'base64'),
        'source.kcs': kcsProgram(
          [
            ...call(271, [0x700, 1024, 1056, row.count, 0, 1280], 64),
            ...call(272, [0x700]),
            ...call(274, [0x700], 68),
            [59],
          ],
          [
            [1024, input.programName],
            [1056, input.textureName],
          ],
        ),
      },
      world = await modernParticleMessageWorld(build.profile, files),
      memory = new ControlledRefHeap(0);
    let fresh;
    try {
      world.particles.host.refBufferMemory = memory;
      world.graphics.createLogicalDevice();
      const id = await world.objects.create({ kind: 16, parent: world.root, nativeID: 0x700 }),
        source = await world.spawnScript('source.kcs');
      await world.runtime.scheduler.execute(source);
      assert.equal(source.status, 'finished');
      assert.equal(source.machine.load(64), 1);
      assert.equal(source.machine.load(68), 1);
      const task = world.particles.get(id),
        instance = task.bank.instance;
      assert.equal(task.active, true);
      assert.equal(task.bank.loaded, true);
      assert.equal(instance.count, row.count);
      assert.equal(instance.native(40, [], instance.machine).value, row.count - 1);
      assert.deepEqual(memory.requests, row.bytes);
      assert.equal(memory.regions.size, 0);
      assert(Object.values(instance.refBuffers.snapshot().fields).every((value) => value === null));
      fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      const freshHeap = new ControlledRefHeap(0);
      fresh.particles.host.refBufferMemory = freshHeap;
      fresh.graphics.createLogicalDevice();
      await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())));
      assert.deepEqual(fresh.particles.get(id).bank.instance.snapshot(), instance.snapshot());
      assert.deepEqual(freshHeap.requests, []);
      assert.equal(freshHeap.regions.size, 0);
      await world.sendEngine(id, world.main.id, 317);
      assert.equal(task.bank, null);
      assert.equal(memory.regions.size, 0);
      assert.equal(world.particles.textures.owned.size, 0);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
