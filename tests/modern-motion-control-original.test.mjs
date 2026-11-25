// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MotionInstance } from '../src/motion/instance.mjs';
import { readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { nativeRandomCases } from './fixtures/random-cases.mjs';
import { fixtureRandom, randomStateBytes } from './fixtures/random-state.mjs';

const control = JSON.parse(
    await readFile(new URL('./fixtures/modern-motion-control-golden.json', import.meta.url)),
  ),
  randomGolden = JSON.parse(
    await readFile(new URL('./fixtures/random-golden.json', import.meta.url)),
  ),
  bytes = (text) => Uint8Array.from(Buffer.from(text, 'base64')),
  hash = (data) => createHash('sha256').update(data).digest('hex');
for (const build of control.builds) {
  test(`${build.profile} actual Motion receiver/VM exit pairs retain whole owner and cold state`, async () => {
    for (const input of build.cases) {
      const script = await readKCS(kcsProgram(input.instructions)),
        owner = new MotionInstance(script, { profile: build.profile });
      owner.shared.set(bytes(input.sharedBefore));
      const random = owner.random.snapshot(),
        result = owner.run();
      assert.equal(result.status, input.actorReturn ? 'yielded' : 'halted', input.name);
      assert.equal(owner.activeWord, input.active, input.name);
      assert.equal(owner.machine.pc, input.pc, input.name);
      assert.equal(owner.machine.sp, input.sp, input.name);
      assert.equal(owner.machine.fp, input.fp, input.name);
      assert.deepEqual(owner.shared, bytes(input.sharedAfter), input.name);
      assert.deepEqual(owner.machine.memory, bytes(input.localAfter), input.name);
      assert.deepEqual(owner.random.snapshot(), random, input.name);
      const state = await deserializeCheckpoint(await serializeCheckpoint(owner.snapshot())),
        clone = new MotionInstance(script, { profile: build.profile });
      clone.restore(state);
      owner.run();
      clone.run();
      assert.deepEqual(clone.snapshot(), owner.snapshot(), input.name);
    }
  });
  test(`${build.profile} integer/real MT callers ignore tails without changing their own full-state contract`, async () => {
    for (const input of nativeRandomCases(build.profile).filter((c) => c.table === 'generic')) {
      const expected = randomGolden.profiles[build.profile].cases[input.name];
      assert(expected);
      for (const tail of [[], [0xdeadbeef], [0xdeadbeef, 0x7f800001]]) {
        const code = [[37, 0x36eb67a5]];
        for (let i = 0; i < input.repeat; i++)
          code.push(
            ...tail.map((word) => [37, word]),
            [43, input.id, tail.length * 4],
            [38, [0x13, 512]],
          );
        code.push([59]);
        const script = await readKCS(kcsProgram(code)),
          owner = new MotionInstance(script, {
            profile: build.profile,
            random: fixtureRandom(input.initial),
          }),
          before = owner.shared.slice();
        owner.run();
        assert.equal(owner.machine.load(512), expected.value, input.name);
        assert.equal(owner.machine.sp, 4100, input.name);
        const local = new Uint8Array(owner.machine.memory.length),
          view = new DataView(local.buffer);
        view.setUint32(512, expected.value, true);
        view.setUint32(4096, 0x36eb67a5, true);
        view.setUint32(4100, expected.value, true);
        if (tail.length === 2) view.setUint32(4104, tail[1], true);
        assert.deepEqual(owner.machine.memory, local, input.name);
        assert.deepEqual(owner.shared, before, input.name);
        for (const [name, state] of Object.entries(randomStateBytes(owner.random)))
          assert.equal(hash(state), expected.memory[name], input.name + '/' + name);
        const snapshot = await deserializeCheckpoint(await serializeCheckpoint(owner.snapshot())),
          clone = new MotionInstance(script, {
            profile: build.profile,
            random: fixtureRandom(input.initial),
          });
        clone.restore(snapshot);
        clone.run();
        owner.run();
        assert.deepEqual(clone.snapshot(), owner.snapshot(), input.name);
      }
    }
  });
}
