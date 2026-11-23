// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { bitsFloat, floatBits, readKCS } from '../src/kcs.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  sentinel = 0x297be903,
  particles = ['particle-v1', 'particle-v2'];

async function guest(table, id, args = [], options = {}) {
  const bytes = kcsProgram([
    [37, sentinel],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  header.setUint16(8, table === 'particle-v2' ? 2 : table === 'particle-v1' ? 1 : 0, true);
  const script = await readKCS(bytes),
    instance =
      table === 'generic'
        ? new MotionInstance(script, { profile, ...options })
        : new ParticleScriptInstance(script, {
            profile,
            count: 1,
            width: 128,
            height: 64,
            screenWidth: 1280,
            screenHeight: 720,
            fps: 30,
            ...options,
          }),
    machine = instance.machine;
  if (table !== 'generic') assert.equal(instance.table, table);
  const floor = machine.sp;
  return {
    instance,
    machine,
    run: (control, expected, frame = 27) => {
      instance.update(frame);
      assert.equal(machine.sp, floor + (control === 1 ? 8 : 4));
      assert.equal(machine.load(floor), sentinel);
      if (control === 1) {
        const word = machine.load(floor + 4);
        if (expected === 'nan') assert(Number.isNaN(bitsFloat(word)));
        else assert.equal(word, expected);
      }
      if (control === 4) assert.equal(instance.active, false);
    },
  };
}

test('2.6.1.23 MOT and both PTCL tables run their shared scalar bodies through GCALL', async () => {
  for (const [mot, ptcl, args, expected] of [
    [1, 6, [floatBits(Math.PI / 2)], 0x3f800000],
    [1, 6, [0x80000000], 0x80000000],
    [8, 13, [floatBits(-1.5)], 0xbf800000],
    [8, 13, [floatBits(-0.5)], 0x80000000],
    [9, 14, [0x80000000], 0],
    [9, 14, [0xff812345], 0x7fc12345],
    [9, 14, [0x80000001], 1],
    [10, 15, [floatBits(-1.25)], 0xc0000000],
    [12, 17, [floatBits(6.25)], 0x40200000],
    [12, 17, [0x80000000], 0x80000000],
    [14, 19, [floatBits(180)], 0x40490fdb],
    [14, 19, [0x7f7fffff], 0x7c8efa35],
    [15, 20, [0x40490fdb], 0x43340000],
    [15, 20, [0x7bbb3ee6], 0x7ea7a18e],
    [15, 20, [0x80000000], 0x80000000],
    [16, 21, [0x80000000], 0x80000000],
    [17, 42, [floatBits(4294967296)], 0],
    [17, 42, [floatBits(4294967808)], 512],
    [17, 42, [floatBits(-4294967808)], 0xfffffe00],
    [17, 42, [floatBits(-1.5)], 0xffffffff],
    [17, 42, [floatBits(2 ** 63)], 0],
    [17, 42, [0x7f800000], 0],
    [41, 41, [10, 20, 0, 4, 2].map(floatBits), 0x41700000],
    [41, 41, [10, 20, 0, 4, 4].map(floatBits), 0x41a00000],
    [41, 41, [-0, 20, 0, 4, -1].map(floatBits), 0x80000000],
    [41, 41, [10, 20, 0, 4, NaN].map(floatBits), 'nan'],
  ]) {
    for (const [table, id] of [['generic', mot], ...particles.map((table) => [table, ptcl])]) {
      const { run } = await guest(table, id, args);
      run(1, expected);
    }
  }
});

test('2.6.1.23 MOT and PTCL trigonometry preserve the original exceptional result words', async () => {
  for (const [mot, ptcl, args, expected] of [
    [2, 7, [0x80000000], 0x3f800000],
    [2, 7, [0x40490fdb], 0xbf800000],
    [2, 7, [0x7149f2ca], 0x3ed3a9bb],
    [2, 7, [0x7f800000], 0xffc00000],
    [3, 8, [0x80000000], 0x80000000],
    [3, 8, [0x7149f2ca], 0xc00cf6bc],
    [3, 8, [0xff800000], 0xffc00000],
    [4, 9, [0xbf800000], 0xbfc90fdb],
    [4, 9, [0x80000000], 0x80000000],
    [4, 9, [0x40000000], 0xffc00000],
    [4, 9, [0xff852038], 0xffc52038],
    [5, 10, [0xbf800000], 0x40490fdb],
    [5, 10, [0x3f800000], 0],
    [5, 10, [0x40000000], 0xffc00000],
    [6, 11, [0x7f800000], 0x3fc90fdb],
    [6, 11, [0xff800000], 0xbfc90fdb],
    [6, 11, [0x80000000], 0x80000000],
    [7, 12, [0x3f800000, 0x40000000], 0x3eed6338],
    [7, 12, [0x80000000, 0x80000000], 0xc0490fdb],
    [7, 12, [0x7f800000, 0x3f800000], 0x3fc90fdb],
    [7, 12, [0x7f800000, 0xff800000], 0xffc00000],
    [7, 12, [0xffc00010, 0x7fc01000], 0x7fc01000],
    [7, 12, [0xffc00010, 0x7fc00010], 0x7fc00010],
    [7, 12, [0x3f800000, 0xff800123], 0xffc00123],
  ]) {
    for (const [table, id] of [['generic', mot], ...particles.map((table) => [table, ptcl])]) {
      const { run } = await guest(table, id, args);
      run(1, expected);
    }
  }
});

test('2.6.1.23 MOT and PTCL integer draws share and restore the integer RNG state', async () => {
  const random = new ParticleRandom(4357, 7),
    real = random.real.snapshot();
  for (const [table, id, expected] of [
    ['generic', 39, 0xaae64ac3],
    ['particle-v1', 33, 0x5e7c47da],
    ['particle-v2', 33, 0xb98e8121],
  ]) {
    const { run } = await guest(table, id, [], { random });
    run(1, expected);
  }
  const restored = new ParticleRandom(0);
  restored.restore(random.snapshot());
  const { run } = await guest('generic', 39, [], { random: restored });
  run(1, 0xb010f327);
  for (let i = 4; i < 623; i++) restored.rand();
  run(1, 0x23219742);
  const next = await guest('particle-v2', 33, [], { random: restored });
  next.run(1, 0x3e44719d);
  assert.deepEqual(restored.real.snapshot(), real);
});

test('2.6.1.23 PTCL emits raw frame, viewport and per-particle values', async () => {
  for (const table of particles) {
    const current = await guest(table, 1);
    current.run(1, 27);
    const before = await guest(table, 2);
    before.run(1, 0xffffffff);
    before.run(1, 27, 31);
    const fps = await guest(table, 4);
    fps.run(1, 30);
    for (const [frame, rate, expected] of [
      [0, 120, 0],
      [0x80000000, 120, 0x80000000],
      [0xffffffff, 30, 0xffffffff],
      [1, 0, 1],
      [60, 30, 30],
      [0x40000001, 120, 0x80000000],
      [0x7fffffff, 120, 1],
    ]) {
      const velocity = await guest(table, 3, [frame], { fps: rate });
      velocity.run(1, expected);
    }
    const viewport = await guest(table, 5, [64, 72]);
    viewport.machine.bytes(60, 20).fill(0xad);
    viewport.run(2);
    assert.deepEqual(
      [60, 64, 68, 72, 76].map((offset) => viewport.machine.load(offset)),
      [0xadadadad, 1280, 0xadadadad, 720, 0xadadadad],
    );
    const max = await guest(table, 40, [], { count: 3 });
    max.run(1, 2);
    const index = await guest(table, 36, [], { count: 3 });
    index.run(1, 2);
    assert.equal(index.instance.calls.get(36), 3);
  }
});

test('2.6.1.23 PTCL moves owned positions, quads and registers and enforces control boundaries', async () => {
  for (const table of particles) {
    const xyz = [-2.75, 11.5, -0];
    const setter = await guest(table, 27, xyz.map(floatBits));
    setter.instance.positions.fill(77);
    setter.run(2);
    assert.deepEqual([...setter.instance.positions], [...xyz, 0]);
    const getter = await guest(table, 28, [64, 68, 76]);
    getter.instance.positions.set([...xyz, 77]);
    getter.machine.bytes(60, 24).fill(0xa7);
    getter.run(2);
    assert.deepEqual(
      [60, 64, 68, 72, 76, 80].map((offset) => getter.machine.load(offset)),
      [0xa7a7a7a7, floatBits(xyz[0]), floatBits(xyz[1]), 0xa7a7a7a7, 0x80000000, 0xa7a7a7a7],
    );

    const quad = Uint8Array.from({ length: 112 }, (_, i) => (0xfe - i * 7) & 255);
    const getQuad = await guest(table, 30, [64]);
    getQuad.instance.quads.set(quad);
    getQuad.machine.bytes(63, 114).fill(0xc5);
    getQuad.run(2);
    assert.deepEqual(getQuad.machine.bytes(63, 114), Uint8Array.of(0xc5, ...quad, 0xc5));
    const setQuad = await guest(table, 31, [64]);
    const backupQuad = setQuad.instance.backupQuads.slice();
    setQuad.machine.bytes(64, 112).set(quad);
    setQuad.run(2);
    assert.deepEqual(setQuad.instance.quads, quad);
    assert.deepEqual(setQuad.instance.backupQuads, backupQuad);

    const registers = Array.from({ length: 32 }, (_, i) => i / 4 - 2);
    const getRegisters = await guest(table, 35, [64], { registers });
    getRegisters.machine.bytes(63, 130).fill(0xcb);
    getRegisters.run(2);
    assert.deepEqual(
      registers.map((_, i) => getRegisters.machine.load(64 + i * 4)),
      registers.map(floatBits),
    );
    assert.equal(getRegisters.machine.load(63, 1), 0xcb);
    assert.equal(getRegisters.machine.load(192, 1), 0xcb);

    const show = await guest(table, 39, [1, 0xfffffff9], { count: 3 });
    show.run(2);
    assert.deepEqual([...show.instance.visibility], [1, -7, 1]);
    const outOfRange = await guest(table, 39, [0xffffffff, 0], { count: 3 });
    outOfRange.run(2);
    assert.deepEqual([...outOfRange.instance.visibility], [1, 1, 1]);
    const exit = await guest(table, 32, [], { count: 2 });
    exit.run(4);
    assert.equal(exit.instance.calls.get(32), 2);
  }
});

test('2.6.1.23 PTCL v2 alone admits the blend-mode word', async () => {
  for (const [mode, expected] of [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 0],
    [0xffffffff, 0],
  ]) {
    const state = await guest('particle-v2', 50, [mode]);
    state.instance.blendMode = 3;
    state.run(2);
    assert.equal(state.instance.blendMode, expected);
  }
  const original = await guest('particle-v1', 50, [1]);
  assert.throws(() => original.instance.update(0), /Unreviewed PTCL native .*particle-v1\/50/);
  assert.equal(original.instance.blendMode, 0);
  assert.equal(original.instance.calls.size, 0);
});

test('2.6.1.23 MOT and PTCL retain their unresolved guards and exact arities', async () => {
  for (const args of [[], [64, 1, 2, 3]]) {
    const unreviewed = await guest('generic', 23, args);
    assert.throws(() => unreviewed.instance.update(0), /Unrecovered MOT native .*:17/);
    assert.equal(unreviewed.instance.calls.size, 0);
  }
  const wrongMOT = await guest('generic', 1);
  assert.throws(() => wrongMOT.instance.update(0), /expects 1 arguments, got 0/);
  assert.equal(wrongMOT.instance.calls.size, 0);
  for (const table of particles) {
    const closed = await guest(table, 34);
    assert.throws(() => closed.instance.update(0), /Unreviewed PTCL native .*\/34/);
    assert.equal(closed.instance.calls.size, 0);
    const wrongPTCL = await guest(table, 28, [64, 68]);
    assert.throws(() => wrongPTCL.instance.update(0), /requires 3 arguments, received 2/);
    assert.equal(wrongPTCL.instance.calls.size, 0);
  }
});
