// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { readKCS, bitsFloat } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-particle-attachment-golden.json', import.meta.url)),
);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const arrays = (owner) =>
  Buffer.concat(
    ['quads', 'backupQuads', 'positions', 'bases', 'rotations', 'scales', 'visibility'].map((key) =>
      Buffer.from(owner[key].buffer, owner[key].byteOffset, owner[key].byteLength),
    ),
  );
for (const build of golden.builds) {
  test(`${build.profile} own live Particle attachment queries retain raw words, complete data and cold continuation`, async () => {
    for (const input of build.cases) {
      const c = input.configuration,
        code = kcsProgram(input.instructions);
      new DataView(code.buffer, code.byteOffset).setUint16(8, input.table, true);
      const script = await readKCS(code),
        attachment = {
          base: c.slice(48, 51).map(bitsFloat),
          pos: c.slice(52, 55).map(bitsFloat),
          baseWords: c.slice(48, 51),
          posWords: c.slice(52, 55),
          registrationWord: c[56],
        },
        options = {
          profile: build.profile,
          attachment: (id) => (id === 7 ? attachment : null),
          attachmentDevicePresent: () => !c[57],
          count: c[0],
          fps: c[1],
          screenWidth: c[2],
          screenHeight: c[3],
          width: bitsFloat(c[4]),
          height: bitsFloat(c[5]),
          attachPlane: c[11] | 0,
          priority: bitsFloat(c[12]),
          near: bitsFloat(c[13]),
        };
      const owner = new ParticleScriptInstance(script, options),
        m = owner.machine,
        expected = input.expected;
      Object.assign(owner, { frame: c[6], before: c[7], now: c[8], active: !!c[9] });
      new Uint32Array(owner.registers.buffer).set(c.slice(16, 48));
      for (const [address, word] of golden.initialWords) m.store(address, word);
      for (const [address, word] of Object.entries(input.memoryWrites)) m.store(+address, word);
      if (c[14]) owner.quads.set(m.memory.subarray(128, 240), owner.now * 112);
      assert.equal(hash(arrays(owner)), expected.arraysBeforeSha256, input.name);
      const random = owner.random.snapshot(),
        graph = structuredClone(attachment);
      m.start();
      const result = m.run();
      assert.equal(result.status, expected.actorReturn ? 'yielded' : 'halted', input.name);
      assert.equal(m.pc, expected.pc, input.name);
      assert.equal(m.sp, expected.sp, input.name);
      assert.equal(m.fp, expected.fp, input.name);
      assert.equal(hash(m.memory), expected.localSha256, input.name);
      assert.equal(hash(arrays(owner)), expected.arraysAfterSha256, input.name);
      assert.equal(+owner.active, +!!expected.active, input.name);
      assert.equal(owner.blendMode, expected.blendMode, input.name);
      assert.equal(
        hash(new Uint8Array(owner.registers.buffer)),
        expected.registersSha256,
        input.name,
      );
      assert.deepEqual(owner.random.snapshot(), random, input.name);
      assert.deepEqual(attachment, graph, input.name);
      const saved = await deserializeCheckpoint(await serializeCheckpoint(owner.snapshot())),
        clone = new ParticleScriptInstance(script, options);
      clone.restore(saved);
      assert.equal(hash(arrays(clone)), hash(arrays(owner)), input.name);
      assert.deepEqual(clone.snapshot(), owner.snapshot(), input.name);
      owner.machine.start();
      clone.machine.start();
      owner.machine.run();
      clone.machine.run();
      assert.deepEqual(clone.snapshot(), owner.snapshot(), input.name);
    }
  });
  test(`${build.profile} live Particle requires an explicit graph mapping and complete models`, async () => {
    for (const id of [47, 48, 49]) {
      const code = kcsProgram([
        ...[32, 36, 40].slice(0, id === 47 ? 0 : id === 48 ? 2 : 3).map((n) => [37, n]),
        [43, id, (id === 47 ? 0 : id === 48 ? 2 : 3) * 4],
        [59],
      ]);
      new DataView(code.buffer, code.byteOffset).setUint16(8, 2, true);
      const options = {
        profile: build.profile,
        count: 1,
        width: 64,
        height: 32,
        screenWidth: 1280,
        screenHeight: 720,
        attachPlane: 7,
      };
      const owner = new ParticleScriptInstance(await readKCS(code), options);
      owner.machine.store(32, 0xdeadbeef);
      assert.throws(
        () => owner.update(0),
        /Particle (attachment graph mapping is unavailable|position requires a live attachment graph)/,
      );
      assert.equal(owner.machine.load(32), 0xdeadbeef);
      const invalid = new ParticleScriptInstance(await readKCS(code), {
        ...options,
        attachment: () => ({ registrationWord: 0 }),
      });
      if (id !== 47) assert.throws(() => invalid.update(0), /requires a live attachment graph/);
    }
  });
}
