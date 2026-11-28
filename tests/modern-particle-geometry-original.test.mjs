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
  await readFile(new URL('./fixtures/modern-particle-geometry-golden.json', import.meta.url)),
);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const arrays = (owner) =>
  Buffer.concat(
    ['quads', 'backupQuads', 'positions', 'bases', 'rotations', 'scales', 'visibility'].map((key) =>
      Buffer.from(owner[key].buffer, owner[key].byteOffset, owner[key].byteLength),
    ),
  );
for (const build of golden.builds) {
  test(`${build.profile} own Particle geometry GCALLs retain raw words and complete data through cold continuation`, async () => {
    for (const input of build.cases) {
      const c = input.configuration,
        code = kcsProgram(input.instructions);
      const header = new DataView(code.buffer, code.byteOffset);
      header.setUint16(8, input.table, true);
      header.setUint32(32, input.dataBytes, true);
      header.setUint32(36, input.stackBytes, true);
      const script = await readKCS(code),
        options = {
          profile: build.profile,
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
      input.quad?.forEach((word, i) => m.store(128 + i * 4, word));
      if (c[14]) owner.quads.set(m.memory.subarray(128, 240), owner.now * 112);
      assert.equal(hash(arrays(owner)), expected.arraysBeforeSha256, input.name);
      const random = owner.random.snapshot();
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
}
