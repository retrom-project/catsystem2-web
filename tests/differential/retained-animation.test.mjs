// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { RetainedAnimation } from '../../src/native/retained-animation.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { NativeRandomMemory } from '../../src/native/random-memory.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { renderSourceFixture } from '../fixtures/render-sources-fixture.mjs';

function program(instructions) {
  const bytes = new Uint8Array(32 + instructions.length * 68),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x004d4e41, true);
  view.setUint32(8, instructions.length, true);
  instructions.forEach(([opcode, ...operands], i) => {
    view.setUint32(32 + i * 68, opcode, true);
    operands.forEach((operand, j) => {
      const [mode, word] = Array.isArray(operand) ? operand : [0, operand];
      view.setUint32(36 + i * 68 + j * 8, mode, true);
      view.setUint32(40 + i * 68 + j * 8, word, true);
    });
  });
  return bytes;
}
const programs = [
  program([
    [1, 0, 2, 2],
    [12, [1, 0]],
    [13, 1],
    [14, [1, 0], -3],
    [16, 0, 3],
    [17, 0, 1],
    [11, 1],
    [4, 0, 0],
    [5, 1, 1, 10],
    [12, 99],
    [6, 1, 2, 12],
    [12, 99],
    [7, 2, 1, 14],
    [12, 99],
    [8, 1, 2, 16],
    [12, 99],
    [9, 2, 2, 18],
    [12, 99],
    [10, 2, 2, 20],
    [12, 99],
    [0, 1, 2, 2],
    [2, 0, 24],
    [15, 1, 1],
    [3, 21],
    [12, 77],
    [0, 2, 1, 1],
  ]),
  program([
    [1, 0, 3, 9],
    [12, [1, 0]],
    [0, 0, 1, 4],
    [3, 0],
  ]),
];
test('ANM keeps state across reset and rejects invalid bytecode without a silent substitute', () => {
  const a = new RetainedAnimation(
    program([
      [12, 42],
      [0, 0, 2, 2],
    ]),
    new ParticleRandom(),
  );
  a.setVariable(0, 17);
  a.setVariable(63, 0xffffffff);
  a.setVariable(64, 9);
  assert.equal(a.registers[0], 17);
  assert.equal(a.registers[63], 0xffffffff);
  a.start(10);
  assert.equal(a.step(10), true);
  assert.equal(a.output.alpha, 42);
  a.reset();
  assert.equal(a.registers[0], 17);
  assert.equal(a.baseFrame, 10);
  assert.equal(a.step(0xffffffff), true);
  const malformed = new RetainedAnimation(program([[12, [1, 64]]]), new ParticleRandom());
  assert.throws(() => malformed.step(1), /register/);
  const loop = new RetainedAnimation(program([[3, 0]]), new ParticleRandom());
  assert.throws(() => loop.step(1, 8), /budget/);
});
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' ANM 18 opcodes and shared RNG match the existing retained oracle',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const oracle = await renderSourceFixture(fixture.bytes, fixture.profile),
        rng = new ParticleRandom(17),
        randomMemory = new NativeRandomMemory(oracle.engine, rng),
        p = oracle.process,
        retained = oracle.retained;
      void randomMemory;
      try {
        for (const [index, bytes] of programs.entries()) {
          const jsRandom = new ParticleRandom(17),
            js = new RetainedAnimation(bytes, jsRandom),
            draw = { record: { id: 1 }, state: { renderer: { width: 8, height: 6 } } };
          rng.integer.seed(17);
          oracle.files.set('phase6.anm', bytes);
          const record = await retained.create(draw, index);
          assert.equal(p.load(record.pointer + 80), 0, 'retained constructor starts disabled');
          assert.equal(await retained.load(draw, index, 'phase6.anm'), true);
          const pointer = p.load(record.pointer + 72);
          js.start(10);
          await retained.call(retained.abi.start, [10], record.pointer, 1);
          await retained.call(retained.abi.enable, [1, 10], record.pointer, 1);
          for (const frame of [10, 11, 12, 14, 19, 20, 31]) {
            const changed = await retained.call(retained.abi.step, [frame], record.pointer, 1);
            const actual = js.step(frame);
            assert.equal(actual, Boolean(changed), index + ' changed ' + frame);
            assert.deepEqual(
              [js.startFrame, js.duration, js.pc >>> 0, js.baseFrame, js.maxFrameKey],
              [12, 16, 20, 24, 28].map((offset) => p.load(pointer + offset)),
              'ANM clocks',
            );
            assert.deepEqual(
              [...js.registers],
              Array.from({ length: 64 }, (_, i) => p.load(pointer + 32 + i * 4)),
            );
            assert.deepEqual(
              Object.values(js.output).map((v) => v >>> 0),
              [0, 1, 2, 3, 4].map((i) => p.load(pointer + 296 + i * 4)),
            );
            assert.deepEqual(jsRandom.snapshot(), rng.snapshot(), 'the shared MT stream');
          }
        }
      } finally {
        await oracle.engine.close();
      }
    },
  );
