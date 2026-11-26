// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { floatBits } from '../src/kcs.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const call = (id, words = []) => [...words.map((word) => [37, word]), [43, id, words.length * 4]];
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} Particle queries read the current native graph through load, GCALL and cold restore`, async (t) => {
    const emitter = kcsProgram([
      ...call(47),
      [38, [0x13, 64]],
      ...call(48, [68, 72]),
      ...call(49, [76, 80, 84]),
      [59],
    ]);
    new DataView(emitter.buffer, emitter.byteOffset).setUint16(8, 2, true);
    const files = { 'ptcl/query.kcs': emitter },
      world = await dataWorld(profile, files);
    t.after(() => world.close({ flushFiles: false }));
    world.graphics.createLogicalDevice();
    const planeID = await world.objects.create({ kind: 2, parent: world.root }),
      emitterID = await world.objects.create({ kind: 16, parent: world.root }),
      plane = world.graphics.get(planeID),
      particle = world.particles.get(emitterID),
      graphID = world.nativeTaskID(planeID),
      targetID = world.nativeTaskID(emitterID),
      m = world.main.machine,
      task = world.main,
      native = (id, args) => world.runtime.native('main', id, args, m, task);
    const shape = new NativeGraphicsPacket(new Array(8).fill(0));
    [0, 0, 0, 16, 8].forEach((n, i) => shape.store(i * 4, floatBits(n)));
    await world.sendEngine(planeID, task.id, 41, 0, 0, { payload: shape });
    const view = new DataView(plane.graph.kx2.buffer, plane.graph.kx2.byteOffset),
      base = [0x7f800123, 0x80000000, floatBits(33)],
      pos = [floatBits(44), 0xff800456, floatBits(66)];
    for (let i = 0; i < 3; i++) {
      view.setUint32(MOTION_ABI.base + i * 4, base[i], true);
      view.setUint32(MOTION_ABI.pos + i * 4, pos[i], true);
    }
    plane.setRegistrationEnabled(true, 0x81234567);
    m.writeString('query', 128);
    m.writeString('', 160);
    for (let i = 0; i < 32; i++) m.store(512 + i * 4, 0);
    assert.deepEqual(await native(0x10f, [targetID, 128, 160, 1, 0, 512]), {
      control: 1,
      value: 1,
    });
    assert.deepEqual(await native(0x1ab, [targetID, graphID]), { control: 2 });
    await native(0x110, [targetID]);
    const read = (p) => [64, 68, 72, 76, 80, 84].map((at) => p.bank.instance.machine.load(at));
    assert.equal(particle.bank.started, true);
    assert.equal(particle.bank.count, 1);
    assert.equal(particle.bank.instance.attachPlane, graphID);
    particle.tick(0);
    assert.equal(particle.bank.instance.calls.size, 3);
    assert.deepEqual(read(particle), [0x81234567, ...base.slice(0, 2), ...pos]);
    const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
      fresh = await dataWorld(profile, files, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    fresh.graphics.createLogicalDevice();
    await fresh.restore(state);
    const restored = fresh.particles.get(emitterID);
    restored.tick(1);
    assert.deepEqual(read(restored), read(particle));
    assert.deepEqual(fresh.graphics.attachment(graphID).baseWords, base);
    assert.deepEqual(fresh.graphics.attachment(graphID).posWords, pos);
    assert.equal(fresh.graphics.attachment(graphID).registrationWord, 0x81234567);
    const saved = restored.bank.instance.machine.memory.slice();
    await fresh.objects.release(planeID);
    assert.equal(fresh.graphics.attachment(graphID), null);
    assert.deepEqual(restored.bank.instance.machine.memory, saved);
  });
}
