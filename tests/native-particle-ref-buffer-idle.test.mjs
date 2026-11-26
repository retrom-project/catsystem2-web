// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NativeBufferMemory, NativeBufferAllocationError } from '../src/native/buffer-memory.mjs';
import { ParticleRefBuffers } from '../src/ppi/abi.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(
      new URL('./fixtures/modern-particle-ref-buffer-idle-golden.json', import.meta.url),
    ),
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
    if (this.requests.length === this.failureAt)
      throw new NativeBufferAllocationError('Controlled original RefBuffer allocation failure');
    const address = super.allocate(size);
    this.view(address, size).fill(0xa5);
    return address;
  }
}
async function loadedWorld(build, row) {
  const files = {
      [row.input.programName]: Buffer.from(row.input.script, 'base64'),
      [row.input.textureName]: Buffer.from(row.input.texture, 'base64'),
    },
    world = await modernParticleMessageWorld(build.profile, files),
    memory = new ControlledRefHeap(row.failureAt);
  world.particles.host.refBufferMemory = memory;
  world.graphics.createLogicalDevice();
  const id = await world.objects.create({ kind: 16, parent: world.root }),
    task = world.particles.get(id),
    packet = new NativeGraphicsPacket(new Array(0x290 / 4).fill(0));
  packet.bytes(4, 128).set(encodeCP932(row.input.programName + '\0'));
  packet
    .bytes(132, 128)
    .set(encodeCP932((row.input.reloadTextureName ?? row.input.textureName) + '\0'));
  packet.store(260, 3);
  packet.store(264, row.input.priorityWord);
  packet.store(396, Number(row.input.externalDraw ?? false));
  for (let i = 0; i < 32; i++) packet.store(268 + i * 4, 0x3f800000 + i);
  await world.sendEngine(id, world.main.id, 314, 0, 0, { payload: packet });
  await world.sendEngine(id, world.main.id, 315);
  return { world, files, memory, id, task };
}
for (const build of golden.builds)
  test(`${build.version} true idle KCS, sorting ownership and partial aux consumers survive independent cold restore`, async () => {
    for (const row of build.cases) {
      const { world, files, memory, id, task } = await loadedWorld(build, row);
      let fresh;
      try {
        const instance = task.bank.instance,
          expected = row.expected;
        assert.deepEqual(memory.requests, row.requests);
        if ([3, 4, 9].includes(row.failureAt))
          assert.throws(
            () => world.particles.host.updateBank(task.key, 1000),
            new RegExp(
              { 3: 'bases', 4: 'positions', 9: 'sortIndices' }[row.failureAt] +
                ' allocation is missing',
            ),
          );
        else world.particles.host.updateBank(task.key, 1000);
        assert.equal(
          hash(instance.machine.memory),
          expected.localSha256,
          row.name + ' full VM local',
        );
        if (row.failureAt !== 4)
          for (const name of ['pc', 'sp', 'fp'])
            assert.equal(instance.machine[name], expected[name], row.name + ' ' + name);
        for (const name of ['frame', 'before', 'now'])
          assert.equal(instance[name], expected[name], row.name + ' ' + name);
        assert.equal(Number(instance.active), expected.active);
        assert.equal(task.bank.clockStart, expected.clockStart);
        assert.equal(task.bank.clockLast, expected.clockLast);
        if (![1, 3, 4].includes(row.failureAt))
          for (const [i, name] of [
            'quads',
            'backupQuads',
            'positions',
            'bases',
            'rotations',
            'scales',
            'visibility',
          ].entries())
            assert.equal(
              hash(
                new Uint8Array(
                  instance[name].buffer,
                  instance[name].byteOffset,
                  instance[name].byteLength,
                ),
              ),
              expected.buffers[i],
              row.name + ' ' + name,
            );
        const state = instance.refBuffers.snapshot();
        if ([1, 3, 4].includes(row.failureAt)) {
          assert.equal(
            instance.refBuffers.get({ 1: 'quads', 3: 'bases', 4: 'positions' }[row.failureAt]),
            null,
          );
          if (row.failureAt !== 4) {
            assert.deepEqual(state.known.positions, [[0, 48]]);
            assert.equal(
              hash(
                new Uint8Array(
                  instance.positions.buffer,
                  instance.positions.byteOffset,
                  instance.positions.byteLength,
                ),
              ),
              expected.buffers[2],
            );
          } else assert.deepEqual(state.known.bases, []);
          if (row.failureAt === 3) assert.deepEqual(state.known.depthPairs, [[4, 8]]);
          if (row.failureAt === 1) {
            assert.equal(instance.externalDraw, true);
            assert.equal(instance.width, null);
            assert.equal(instance.priority, null);
            assert.equal(instance.nativeDrawOrder(), undefined);
            assert.equal(Object.hasOwn(state.fields, 'depthPairs'), false);
          }
        } else if (row.failureAt === 8) {
          assert.equal(state.fields.depthPairs, null);
          assert.deepEqual(state.known.sortIndices, []);
          assert.throws(() => instance.nativeDrawOrder(), /sortIndices bytes are uninitialized/);
          task.bank.alpha = 0;
          assert.deepEqual((await world.particles.host.drawBatch(task.bank)).geometry, []);
        } else if (row.failureAt === 9) {
          assert.deepEqual(state.known.depthPairs, [[0, 8]]);
          assert.deepEqual(
            state.fields.depthPairs.subarray(0, 8),
            new Uint8Array(Buffer.from(expected.depthPairs, 'base64')).subarray(0, 8),
          );
          assert.equal(state.fields.sortIndices, null);
        } else {
          assert.deepEqual(
            state.fields.depthPairs,
            new Uint8Array(Buffer.from(expected.depthPairs, 'base64')),
          );
          assert.deepEqual(
            new Uint8Array(state.fields.sortIndices.buffer),
            new Uint8Array(Buffer.from(expected.sortOffsets, 'base64')),
          );
          assert.deepEqual(
            instance.nativeDrawOrder().map((r) => r.index),
            row.name === 'equal' ? [1, 0, 2] : [0, 1, 2],
          );
          assert.equal((await world.particles.host.drawBatch(task.bank)).geometry.length, 3);
        }
        fresh = await modernParticleMessageWorld(build.profile, files, { initialize: false });
        const heap = new ControlledRefHeap(1);
        heap.reserve(256, new Uint8Array(256));
        fresh.particles.host.refBufferMemory = heap;
        fresh.graphics.createLogicalDevice();
        await fresh.restore(
          await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
        );
        const copy = fresh.particles.get(id).bank.instance;
        assert.deepEqual(copy.snapshot(), instance.snapshot());
        assert.deepEqual(heap.requests, [], 'cold restore never retries saved failures');
        if (row.failureAt === 10) {
          assert.notEqual(
            copy.refBuffers.entries.get('depthPairs').pointer,
            instance.refBuffers.entries.get('depthPairs').pointer,
          );
          assert.deepEqual(copy.nativeDrawOrder(), instance.nativeDrawOrder());
          world.particles.host.updateBank(task.key, 1001);
          fresh.particles.host.updateBank(task.key, 1001);
          assert.deepEqual(copy.snapshot(), instance.snapshot());
          assert.deepEqual(
            await fresh.particles.host.drawBatch(fresh.particles.get(id).bank),
            await world.particles.host.drawBatch(task.bank),
          );
        }
        await world.sendEngine(id, world.main.id, 317);
        assert.equal(memory.regions.size, 0);
        assert.equal(task.bank, null);
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
        assert.equal(memory.regions.size, 0);
      }
    }
  });

test('sorting checkpoint validates references before reserving any region', () => {
  const owner = new ParticleRefBuffers(3),
    state = owner.snapshot();
  state.fields.sortIndices[0] = 4;
  state.known.sortIndices = [[0, 4]];
  const memory = new NativeBufferMemory();
  assert.throws(
    () => new ParticleRefBuffers(3, { memory, snapshot: state }),
    /invalid sorting reference/,
  );
  assert.equal(memory.regions.size, 0);
  state.fields.sortIndices[0] = 0;
  state.references = null;
  assert.throws(() => new ParticleRefBuffers(3, { memory, snapshot: state }), /pointer references/);
  assert.equal(memory.regions.size, 0);
  owner.close();
});

for (const build of golden.builds)
  test(`${build.version} draw consumes stored order, skips hidden vectors and returns before all alpha-zero reads`, async () => {
    for (const row of build.drawCases) {
      const { world, memory, task } = await loadedWorld(build, { ...row, failureAt: 10 });
      try {
        world.particles.host.updateBank(task.key, 1000);
        // Match the own live view getter, independently from client pixels.
        world.game.width = row.projection.width;
        world.game.height = row.projection.height;
        const instance = task.bank.instance,
          read = instance.requireBuffer.bind(instance),
          consumed = [];
        instance.requireBuffer = (name, ...args) => {
          consumed.push(name);
          return read(name, ...args);
        };
        const batch = await world.particles.host.drawBatch(task.bank),
          expected = row.draws[0].commands.flatMap((c) => c.triangles ?? []),
          actual = batch.geometry.flatMap(({ vertices: v }) => [
            [v[0], v[1], v[2]],
            [v[2], v[1], v[3]],
          ]);
        assert.deepEqual(actual, expected);
        if (row.visibility === 'hidden') assert.deepEqual([...new Set(consumed)], ['visibility']);
        else assert.equal(batch.geometry.length, 3);
        assert.equal(row.draws[1].alpha, 0);
        assert.equal(row.draws[1].result, 0);
        assert.deepEqual(row.draws[1].bufferReads, {});
        task.bank.alpha = 0;
        instance.nativeDrawOrder = () => {
          throw Error('Alpha-zero draw read sorting state');
        };
        instance.requireBuffer = () => {
          throw Error('Alpha-zero draw consumed a data buffer');
        };
        assert.deepEqual((await world.particles.host.drawBatch(task.bank)).geometry, []);
      } finally {
        await world.close({ flushFiles: false });
        assert.equal(memory.regions.size, 0);
      }
    }
  });
