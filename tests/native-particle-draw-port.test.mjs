// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NativeBufferMemory, NativeBufferAllocationError } from '../src/native/buffer-memory.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { defaultParticleFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-particle-draw-port-golden.json', import.meta.url)),
  ),
  hash = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(build, count = 3, memory) {
  const input = build.input,
    files = {
      [input.programName]: Buffer.from(input.script, 'base64'),
      [input.textureName]: Buffer.from(input.texture, 'base64'),
    },
    world = await modernParticleMessageWorld(build.profile, files);
  world.graphics.createLogicalDevice();
  if (memory) world.particles.host.refBufferMemory = memory;
  const id = await world.objects.create({ kind: 16, parent: world.root }),
    packet = new NativeGraphicsPacket(new Array(0x290 / 4).fill(0));
  packet.bytes(4, 128).set(encodeCP932(input.programName + '\0'));
  packet.bytes(132, 128).set(encodeCP932(input.textureName + '\0'));
  packet.store(260, count);
  packet.store(264, input.priorityWord);
  for (let i = 0; i < 32; i++) packet.store(268 + i * 4, 0x3f800000 + i);
  return { world, files, id, packet };
}
for (const build of golden.builds)
  test(`${build.version} default Particle rendering follows the own port through first idle, restart, reload and cold`, async () => {
    let { world, files, id, packet } = await fixture(build),
      clock = 1000,
      stale;
    try {
      for (const expected of build.phases) {
        const message = {
          'load-first': 314,
          'start-first': 315,
          'restart-while-active': 315,
          stop: 316,
          'start-after-stop': 315,
          'reload-while-active': 314,
          'start-after-reload': 315,
          release: 317,
        }[expected.label];
        if (message)
          await world.sendEngine(
            id,
            world.main.id,
            message,
            0,
            0,
            message === 314 ? { payload: packet } : undefined,
          );
        else world.particles.get(id).tick(clock++);
        const bank = world.particles.get(id).bank;
        if (!expected.portPresent) {
          assert.equal(bank, null);
          assert.deepEqual(world.particles.drawItems(), []);
          continue;
        }
        assert.equal(
          bank.nativeDrawEnabled,
          Boolean(expected.enabled),
          expected.label + ' port enable',
        );
        assert.equal(Number(bank.instance.active), expected.active, expected.label + ' active');
        const buffers = bank.instance.refBuffers.snapshot();
        for (const name of ['depthPairs', 'sortIndices'])
          assert.deepEqual(
            buffers.known[name],
            expected.known[name],
            expected.label + ' ' + name + ' initialized bytes',
          );
        if (expected.depthPairs)
          assert.deepEqual(
            buffers.fields.depthPairs,
            new Uint8Array(Buffer.from(expected.depthPairs, 'base64')),
            expected.label + ' full depth pairs',
          );
        if (expected.sortOffsets)
          assert.deepEqual(
            [...buffers.fields.sortIndices],
            expected.sortOffsets,
            expected.label + ' sorting references',
          );
        if (expected.localSha256)
          assert.equal(
            hash(bank.instance.machine.memory),
            expected.localSha256,
            expected.label + ' complete KCS local',
          );
        const items = world.particles.drawItems();
        assert.equal(
          items.length,
          Number(Boolean(expected.enabled) && Boolean(expected.active)),
          expected.label + ' default renderer items',
        );
        if (expected.label === 'idle-first') stale = items[0];
        if (expected.label === 'start-after-stop') {
          await stale.drawGPU({
            drawGeometry: () => assert.fail('stale GPU item must follow the disabled port'),
          });
          await stale.draw({});
          await world.particles.host.drawBank(bank.key, {
            drawGeometry: () => assert.fail('direct drawBank must follow the disabled port'),
          });
        }
        const draws = [];
        for (const item of items)
          await item.drawGPU({ drawGeometry: (geometry) => draws.push(geometry.length) });
        assert.deepEqual(
          draws,
          items.length ? [3] : [],
          expected.label + ' ordinary renderer leaf',
        );
        if (expected.label === 'start-first')
          await assert.rejects(
            world.particles.host.drawBatch(bank),
            /sortIndices bytes are uninitialized/,
            'direct unqualified consumer retains guard',
          );
        if (
          [
            'start-first',
            'idle-first',
            'start-after-stop',
            'reload-while-active',
            'idle-after-reload',
          ].includes(expected.label)
        ) {
          const snapshot = world.snapshot(),
            state = await deserializeCheckpoint(await serializeCheckpoint(snapshot));
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
          world.graphics.createLogicalDevice();
          await world.restore(state);
          assert.deepEqual(world.snapshot(), snapshot, expected.label + ' all cold state');
          assert.equal(
            world.particles.drawItems().length,
            items.length,
            expected.label + ' cold default eligibility',
          );
          if (expected.label === 'idle-first') stale = world.particles.drawItems()[0];
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const build of golden.builds)
  test(`${build.version} real FES start after its child's logic phase waits for the child's first idle`, async () => {
    const input = build.input,
      world = await defaultParticleFESWorld(build.profile, {
        'screen.fes': new TextEncoder().encode(
          `#DEFINE\nPARTICLE p\n#START\np init 0 authored authored.hg3 3 0\np start\nnext WAIT\n#WAIT\nbreak\nnext WAIT\n`,
        ),
        'ptcl/authored.kcs': Buffer.from(input.script, 'base64'),
        'authored.hg3': Buffer.from(input.texture, 'base64'),
      });
    try {
      const fes = await loadDefaultFES(world);
      await world.tick();
      const object = fes.instance.collection.lookup('p', 0),
        task = world.particles.get(object.particleResource.taskID),
        bank = task.bank;
      assert(bank?.started);
      assert.equal(bank.instance.hasFrame, false);
      assert.equal(bank.nativeDrawEnabled, false);
      assert.deepEqual(world.particles.drawItems(), []);
      await assert.rejects(
        world.particles.host.drawBatch(bank),
        /sortIndices bytes are uninitialized/,
      );
      await world.tick();
      assert.equal(bank.instance.hasFrame, true);
      assert.equal(bank.nativeDrawEnabled, true);
      const items = world.particles.drawItems();
      assert.equal(items.length, 1);
      let vertices = 0;
      await items[0].drawGPU({ drawGeometry: (geometry) => (vertices += geometry.length) });
      assert.equal(vertices, 3);
      const saved = world.particles.snapshot();
      delete saved.banks[0].nativeDrawEnabled;
      await assert.rejects(
        world.particles.restore(saved),
        /requires its native graph-port enable state/,
      );
      assert.equal(task.bank, bank, 'invalid checkpoint rejected before closing the current bank');
    } finally {
      await world.close({ flushFiles: false });
    }
  });
for (const build of golden.builds)
  test(`${build.version} zero-count port and enabled-but-unknown aux consumers stay distinct`, async () => {
    const zero = await fixture(build, 0);
    try {
      await zero.world.sendEngine(zero.id, zero.world.main.id, 314, 0, 0, { payload: zero.packet });
      await zero.world.sendEngine(zero.id, zero.world.main.id, 315);
      assert.equal(zero.world.particles.drawItems().length, 0);
      zero.world.particles.get(zero.id).tick(1000);
      assert.equal(zero.world.particles.drawItems().length, 1);
      assert.deepEqual(
        (await zero.world.particles.host.drawBatch(zero.world.particles.get(zero.id).bank))
          .geometry,
        [],
      );
    } finally {
      await zero.world.close({ flushFiles: false });
    }
    class MissingDepth extends NativeBufferMemory {
      calls = 0;
      allocate(size) {
        if (++this.calls === 8)
          throw new NativeBufferAllocationError('Controlled missing depth owner');
        return super.allocate(size);
      }
    }
    const partial = await fixture(build, 3, new MissingDepth());
    try {
      await partial.world.sendEngine(partial.id, partial.world.main.id, 314, 0, 0, {
        payload: partial.packet,
      });
      await partial.world.sendEngine(partial.id, partial.world.main.id, 315);
      assert.equal(partial.world.particles.drawItems().length, 0);
      partial.world.particles.get(partial.id).tick(1000);
      assert.equal(partial.world.particles.drawItems().length, 1);
      await assert.rejects(
        partial.world.particles
          .drawItems()[0]
          .drawGPU({ drawGeometry: () => assert.fail('unknown aux must not draw') }),
        /sortIndices bytes are uninitialized/,
      );
    } finally {
      await partial.world.close({ flushFiles: false });
    }
  });
