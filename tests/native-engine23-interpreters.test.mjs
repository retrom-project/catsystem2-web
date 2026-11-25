// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSMachine, bitsFloat, floatBits, readKCS } from '../src/kcs.mjs';
import { MOTION_ABI, setMotionVector } from '../src/motion/abi.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { PTCL_ABI } from '../src/ppi/abi.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
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
    [2, 7, [0x7149f2ca], 0x3e87e35a],
    [2, 7, [0x7f800000], 0xffc00000],
    [3, 8, [0x80000000], 0x80000000],
    [3, 8, [0x7149f2ca], 0xc0687dd4],
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

test('2.6.1.23 Main and both PTCL versions publish the words of their shared scalar handlers', async (t) => {
  const cases = [
    [50, 6, [0x5f000000], 0x3f780bd8],
    [51, 7, [0x5f000000], 0x3e7d44ae],
    [52, 8, [0x80000000], 0x80000000],
    [52, 8, [0x5f000000], 0x407ab8bf],
    [52, 8, [0x7f7fffff], 0xc087d565],
    [52, 8, [0xff800000], 0xffc00000],
    [53, 9, [0x3f800000], 0x3fc90fdb],
    [53, 9, [0x80000000], 0x80000000],
    [53, 9, [0x40000000], 0xffc00000],
    [53, 9, [0xff801235], 0xffc01235],
    [55, 11, [0x3f800000], 0x3f490fdb],
    [55, 11, [0xff800000], 0xbfc90fdb],
    [56, 13, [0xbf000000], 0x80000000],
    [56, 13, [0x7f801269], 0x7fc01269],
    [58, 15, [0xbf000000], 0xbf800000],
    [58, 15, [0x80000000], 0x80000000],
    [59, 16, [0xc1c80000, 0x27b9e727], 0xa6a9ae0c],
    [59, 16, [0xc0000000, 0x40000000], 0x80000000],
    [59, 16, [0x80000000, 0x40000000], 0],
    [59, 16, [0x3f800000, 0], 0xffc00000],
    [59, 16, [0x7fc11234, 0xff801234], 0x7fc11234],
    [60, 17, [0x40c80000], 0x40200000],
    [60, 17, [0xbf800000], 0xffc00000],
    [60, 17, [0x7f7fffff], 0x5f7fffff],
    [61, 18, [0x3f8ccccd, 0x40a00000], 0x3fce2533],
    [61, 18, [0xbf800000, 0xff800000], 0x3f800000],
    [61, 18, [0xff801234, 0], 0xffc01234],
    [321, 43, [0x3f800000, 0x40800000], 0x3f800000],
    [321, 43, [0x40000000, 0x40800000], 0x80000000],
    [321, 43, [0xc1c80000, 0x27b9e727], 0x3f69a8ea],
    [321, 43, [0x8bb44e07, 0x4ce1489d], 0x00199c6e],
    [321, 43, [0xc1c80000, 0xff801235], 0x7fc01235],
  ];
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([
      [37, sentinel],
      ...cases.flatMap(([id, , args]) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
      ]),
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { machine } = world.main,
    expected = [sentinel, ...cases.map(([, , , result]) => result)],
    first = machine.sp - expected.length * 4;
  assert.deepEqual(
    expected.map((_, i) => machine.load(first + i * 4)),
    expected,
  );
  for (const [main, ptcl, args, result] of cases) {
    assert(world.runtime.calls.has(`main:${main}`));
    for (const table of particles) {
      const { run } = await guest(table, ptcl, args);
      run(1, result);
    }
  }
  for (const table of particles) {
    const badWidth = await guest(table, 18, [0x3f000000]);
    assert.throws(() => badWidth.instance.update(27), /PTCL pow requires 2 arguments/);
    assert.equal(badWidth.instance.calls.size, 0);
  }
});

test('2.6.1.23 Main and Particle report the owning task frame rate as a full word', async (t) => {
  const script = kcsProgram([[37, sentinel], [43, 7, 0], [59]]);
  const world = await dataWorld(profile, { 'fps.kcs': script });
  t.after(() => world.close({ flushFiles: false }));
  for (const fps of [15, 60, 120, 0xffffffff]) {
    const parent = await world.objects.create({ kind: 1, frameRate: fps }),
      { machine } = await world.spawnScript('fps.kcs', { parent, initialExecute: true });
    assert.equal(machine.load(machine.sp - 8), sentinel);
    assert.equal(machine.load(machine.sp - 4), fps);
    for (const table of particles) {
      const { run } = await guest(table, 4, [], { fps });
      run(1, fps);
    }
  }
});

test('2.6.1.23 Main sound geometry helpers preserve x87 result words through GCALL', async (t) => {
  const cases = [
    [51, [0x80000000], 0x3f800000],
    [51, [0x40490fdb], 0xbf800000],
    [51, [0x7149f2ca], 0x3e87e35a],
    [51, [0x7f800000], 0xffc00000],
    [54, [0xbf800000], 0x40490fdb],
    [54, [0], 0x3fc90fdb],
    [54, [0x3f800000], 0],
    [54, [0x40000000], 0xffc00000],
    [54, [0xff852038], 0xffc52038],
    [57, [0xc0400000], 0x40400000],
    [57, [0x80000000], 0],
    [57, [0x80000001], 1],
    [57, [0xff812345], 0x7fc12345],
    [397, [0x3f800000, 0x40000000], 0x3eed6338],
    [397, [0x80000000, 0x80000000], 0xc0490fdb],
    [397, [0x7f800000, 0xff800000], 0xffc00000],
    [397, [0xffc00010, 0x7fc01000], 0x7fc01000],
    [397, [0xffc00010, 0x7fc00010], 0x7fc00010],
    [397, [0x3f800000, 0xff800123], 0xffc00123],
  ];
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([
      [37, sentinel],
      ...cases.flatMap(([id, args]) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
      ]),
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { machine } = world.main,
    expected = [sentinel, ...cases.map(([, , result]) => result)],
    first = machine.sp - expected.length * 4;
  assert.deepEqual(
    expected.map((_, i) => machine.load(first + i * 4)),
    expected,
  );
  assert.equal(world.runtime.calls.get('main:51'), 4);
  assert.equal(world.runtime.calls.get('main:54'), 5);
  assert.equal(world.runtime.calls.get('main:57'), 4);
  assert.equal(world.runtime.calls.get('main:397'), 6);
});

test('2.6.1.23 Main power and logarithm follow the selected native CRT and x87 output', async (t) => {
  const cases = [
      [61, [0x3f8ccccd, 0x40a00000], 0x3fce2533],
      [61, [0xc0000000, 0x40400000], 0xc1000000],
      [61, [0xbf800000, 0x3f000000], 0xffc00000],
      [61, [0xbf800000, 0x7f800000], 0x3f800000],
      [61, [0xbf800000, 0xff800000], 0x3f800000],
      [61, [0x7f801234, 0], 0x7fc01234],
      [61, [0xff801234, 0x80000000], 0xffc01234],
      [61, [0x7fc65432, 0], 0x7fc65432],
      [61, [1, 0x3f800000], 1],
      [61, [0x7f7fffff, 0x40400000], 0x7f800000],
      [461, [0x3f800000], 0],
      [461, [0x42c80000], 0x40000000],
      [461, [1], 0xc23369f4],
      [461, [0], 0xff800000],
      [461, [0x80000000], 0xff800000],
      [461, [0x7f800000], 0x7f800000],
      [461, [0xff800000], 0xffc00000],
      [461, [0x7f801234], 0x7fc01234],
      [461, [0xff801234], 0xffc01234],
    ],
    world = await dataWorld(profile, {
      'case.kcs': kcsProgram([
        [37, sentinel],
        ...cases.flatMap(([id, args]) => [
          ...args.map((word) => [37, word]),
          [43, id, args.length * 4],
        ]),
        [59],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const { machine } = world.main,
    expected = [sentinel, ...cases.map(([, , word]) => word)];
  assert.equal(machine.sp, machine.floor + expected.length * 4);
  assert.deepEqual(
    expected.map((_, i) => machine.load(machine.floor + i * 4)),
    expected,
  );
  assert.equal(world.runtime.calls.get('main:61'), 10);
  assert.equal(world.runtime.calls.get('main:461'), 9);
});

test('2.6.1.23 remainder preserves the original CRT classification and FPREM result', async () => {
  for (const [args, expected] of [
    [[0xbf800000, 0x3f000000], 0x80000000],
    [[0x80000000, 0x3f800000], 0],
    [[0xc0e00000, 0x40000000], 0xbf800000],
    [[0x40e00000, 0xc0000000], 0x3f800000],
    [[0x7f7fffff, 0x40400000], 0],
    [[0x80000001, 0x7f7fffff], 0x80000001],
    [[0x3f800000, 0x80000001], 0],
    [[0x3f800000, 0x7f800000], 0xffc00000],
    [[0x3f800000, 0x80000000], 0xffc00000],
    [[0x7f800000, 0x3f800000], 0xffc00000],
    [[0x3f800000, 0xff800123], 0xffc00123],
    [[0xffc00122, 0x7fc00123], 0x7fc00123],
  ]) {
    for (const [table, id] of [['generic', 11], ...particles.map((table) => [table, 16])]) {
      const { run } = await guest(table, id, args);
      run(1, expected);
    }
  }
});

test('2.6.1.23 MOT and PTCL triangle waves share the ordered x87 quarter branches', async () => {
  for (const [left, right, expected] of [
    [0x80000000, 0x41000000, 0],
    [0x3f800000, 0x41000000, 0x3f000000],
    [0x40000000, 0x41000000, 0x3f800000],
    [0x40400000, 0x41000000, 0x3f000000],
    [0x40800000, 0x41000000, 0x80000000],
    [0xc0a00000, 0xc1000000, 0xbf000000],
    [0x40c00000, 0x41000000, 0xbf800000],
    [0x40e00000, 0x41000000, 0xbf000000],
    [0x41000000, 0x41000000, 0],
    [0x3f800000, 0x7f800000, 0xbf800000],
    [0x7f800000, 0x3f800000, 0xbf800000],
    [0xff812345, 0x41000000, 0],
    [0x3f800000, 0xff812345, 0x7fc12345],
    [0, 0, 0xffc00000],
    [1, 2, 0xffc00000],
    [2, 5, 0x80000000],
  ]) {
    for (const [table, id] of [['generic', 42], ...particles.map((table) => [table, 43])]) {
      const { run } = await guest(table, id, [left, right]);
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

const matrixAddress = 0x80000000 + MOTION_ABI.matrix;
const identityWords = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map(floatBits);
const rotationAngles = [0.2, -0.7, 1.1].map(floatBits);
const rotationWords = [
  1051828412, 1060011905, 1059384179, 0, 3211687569, 1051276864, 1041996022, 0, 3185568410,
  3207011861, 1061152139, 0, 0, 0, 0, 1065353216,
];
function matrixWords(bytes, offset = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
}

test('2.6.1.23 MOT writes identity and XYZ rotation only to the addressed matrix', async () => {
  const calculations = { matrix: new Uint8Array(64).fill(0x45) };
  for (const address of [0, matrixAddress]) {
    for (const [id, input, expected] of [
      [26, new Array(16).fill(0x7fa03119), identityWords],
      [23, identityWords, rotationWords],
    ]) {
      const { instance, machine, run } = await guest(
        'generic',
        id,
        id === 26 ? [address] : [address, ...rotationAngles],
        { calculations },
      );
      input.forEach((word, i) => machine.store(address + i * 4, word));
      machine.store(address + 64, sentinel);
      if (address) machine.store(address - 4, sentinel);
      run(2);
      assert.equal(instance.active, true);
      assert.deepEqual(matrixWords(machine.bytes(address, 64)), expected);
      assert.equal(machine.load(address + 64), sentinel);
      if (address) assert.equal(machine.load(address - 4), sentinel);
      assert.deepEqual([...calculations.matrix], new Array(64).fill(0x45));
    }
  }
  const truncated = await guest('generic', 26, [0x80000000 + MOTION_ABI.sharedSize - 4], {
    calculations,
  });
  assert.throws(() => truncated.instance.update(0), /KCS memory .*\+64/);
  assert.deepEqual([...calculations.matrix], new Array(64).fill(0x45));
  const unowned = await guest('generic', 26, [0xffffffff]);
  assert.throws(() => unowned.instance.update(0), /KCS memory ffffffff\+1/);
});

test('2.6.1.23 Main and restored MOT managers share one current matrix per world', async () => {
  const address = 0xffffffff;
  const files = {
    'current.kcs': kcsProgram([
      [37, address],
      ...rotationAngles.map((word) => [37, word]),
      [43, 23, 16],
      [59],
    ]),
    'mapped.kcs': kcsProgram([
      [37, matrixAddress],
      [43, 26, 4],
      [37, matrixAddress],
      ...rotationAngles.map((word) => [37, word]),
      [43, 23, 16],
      [59],
    ]),
  };
  const original = await dataWorld(profile, files),
    restored = await dataWorld(profile, files, { initialize: false });
  const call = (world, id, args) =>
    world.runtime.native('main', id, args, world.main.machine, world.main);
  try {
    assert.deepEqual(call(original, 207, [address]), { control: 2 });
    const add = async (name) => {
      const { value: manager } = call(original, 294, []);
      original.main.machine.writeString(name, 32);
      const { value: motion } = await call(original, 304, [manager, 32, 0, 0, 0, 0, 0]);
      assert.equal(motion, 1);
      return manager;
    };
    const current = await add('current');
    const mapped = await add('mapped');
    await restored.restore(structuredClone(original.snapshot()));
    assert.deepEqual(await call(restored, 307, [mapped, 1390, 0]), { control: 1, value: 1 });
    assert.deepEqual(
      matrixWords((await restored.runtime.services.motion.get(mapped)).working, MOTION_ABI.matrix),
      rotationWords,
    );
    assert.deepEqual(matrixWords(restored.calculations.matrix), identityWords);
    assert.deepEqual(call(original, 307, [current, 1390, 0]), { control: 1, value: 1 });
    assert.deepEqual(matrixWords(original.calculations.matrix), rotationWords);
    assert.deepEqual(matrixWords(restored.calculations.matrix), identityWords);
    assert.deepEqual(await call(restored, 307, [current, 1390, 0]), { control: 1, value: 1 });
    assert.deepEqual(matrixWords(restored.calculations.matrix), rotationWords);
  } finally {
    await original.close({ flushFiles: false });
    await restored.close({ flushFiles: false });
  }
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

test('2.6.1.23 PTCL rotates, translates and scales only the native quad components', async () => {
  const address = 128,
    stride = PTCL_ABI.vertex.size,
    input = [
      [1, 2, 3, -0].map(floatBits),
      [3, 4, -5, 2].map(floatBits),
      [-5, 0, 0.5, 1].map(floatBits),
      [0, 0, 0, 0].map(floatBits),
    ];
  input[1][3] = 0xff802345;
  for (const table of particles) {
    for (const [id, args, first, fourthWords] of [
      [
        22,
        [floatBits(Math.PI / 2)],
        [0x3f800000, 0x40400000, 0xc0000001],
        [0x80000000, 0xffc02345],
      ],
      [
        23,
        [floatBits(Math.PI / 2)],
        [0xc0400000, 0x40000000, 0x3f7ffffe],
        [0x80000000, 0xffc02345],
      ],
      [
        24,
        [floatBits(Math.PI / 2)],
        [0x40000000, 0xbf800001, 0x40400000],
        [0x80000000, 0xffc02345],
      ],
      [25, [4, -2, 1].map(floatBits), [5, 0, 4].map(floatBits), [0, 0xffc02345]],
      [26, [-2, 3, 4].map(floatBits), [-2, 6, 12].map(floatBits), [0x80000000, 0xff802345]],
    ]) {
      const { machine, instance, run } = await guest(table, id, [address, ...args]);
      machine.store(address - 4, sentinel);
      machine.store(address + PTCL_ABI.quadSize, sentinel);
      const tail = [0xaabbccee, 0x7f800238, 0xff801234];
      input.forEach((row, vertex) =>
        [...row, ...tail].forEach((word, i) =>
          machine.store(address + vertex * stride + i * 4, word),
        ),
      );
      run(2);
      assert.equal(instance.calls.get(id), 1);
      assert.deepEqual(
        first.map((_word, i) => machine.load(address + i * 4)),
        first,
      );
      assert.deepEqual(
        fourthWords.map((_word, i) => machine.load(address + i * stride + 12)),
        fourthWords,
      );
      for (let vertex = 0; vertex < 4; vertex++)
        assert.deepEqual(
          tail.map((_word, i) => machine.load(address + vertex * stride + 16 + i * 4)),
          tail,
        );
      assert.equal(machine.load(address - 4), sentinel);
      assert.equal(machine.load(address + PTCL_ABI.quadSize), sentinel);
    }
  }
  const mixed = await guest('particle-v2', 25, [address, 0x7f801234, 0, 0]);
  mixed.machine.store(address, 0xffc43210);
  mixed.run(2);
  assert.equal(mixed.machine.load(address), 0xffc43210);
  const signaling = 0xffa43210,
    largeQuiet = 0xffe43210,
    smallQuiet = 0x7fc00010;
  const rotated = await guest('particle-v2', 24, [address, smallQuiet]);
  rotated.machine.store(address, signaling);
  rotated.run(2);
  assert.equal(rotated.machine.load(address), largeQuiet);
  assert.equal(rotated.machine.load(address + 4), smallQuiet);
  const translated = await guest('particle-v2', 25, [address, smallQuiet, smallQuiet, smallQuiet]);
  for (const offset of [0, 4, 8]) translated.machine.store(address + offset, signaling);
  translated.run(2);
  assert.deepEqual(
    [0, 4, 8].map((offset) => translated.machine.load(address + offset)),
    [largeQuiet, smallQuiet, smallQuiet],
  );
  const scaled = await guest('particle-v2', 26, [address, smallQuiet, smallQuiet, smallQuiet]);
  for (let vertex = 0; vertex < 4; vertex++)
    for (const offset of [0, 4, 8])
      scaled.machine.store(address + vertex * stride + offset, signaling);
  scaled.run(2);
  assert.deepEqual(
    Array.from({ length: 4 }, (_, vertex) =>
      [0, 4, 8].map((offset) => scaled.machine.load(address + vertex * stride + offset)),
    ),
    [
      [smallQuiet, largeQuiet, smallQuiet],
      [largeQuiet, largeQuiet, largeQuiet],
      [largeQuiet, largeQuiet, largeQuiet],
      [largeQuiet, smallQuiet, smallQuiet],
    ],
  );
  const sharedAddress = 0x80000000;
  const shortest = await guest('particle-v1', 24, [sharedAddress, 0], {
    shared: new Uint8Array(100).fill(0xa5),
  });
  shortest.run(2);
  const short = await guest('particle-v1', 24, [sharedAddress + 1, 0], {
    shared: new Uint8Array(100).fill(0xa5),
  });
  assert.throws(() => short.instance.update(0), /KCS memory .*\+100/);
  assert.equal(short.machine.load(sharedAddress), 0xa5a5a5a5);
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

test('2.6.1.23 PTCL v2 backs up and restores every owned quad', async () => {
  const sequence = [
      [37, sentinel],
      [37, 0x80000000],
      [43, 45, 4],
      [37, 64],
      [43, 31, 4],
      [37, 0xffffffff],
      [43, 44, 4],
      [59],
    ],
    code = kcsProgram(sequence);
  new DataView(code.buffer).setUint16(8, 2, true);
  const instance = new ParticleScriptInstance(await readKCS(code), {
      profile,
      count: 3,
      width: 16,
      height: 32,
      screenWidth: 1280,
      screenHeight: 720,
    }),
    machine = instance.machine,
    floor = machine.sp;
  assert.deepEqual(instance.backupQuads, instance.quads);
  const live = instance.quads.map((_, index) => 19 + index * 31);
  instance.quads.set(live);
  instance.backupQuads.fill(0xc3);
  machine.bytes(64, PTCL_ABI.quadSize).fill(0xdf);
  machine.start();
  assert.equal(machine.run().status, 'halted');
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), sentinel);
  assert.deepEqual(instance.quads, live);
  assert.deepEqual(instance.backupQuads, live);
  assert.deepEqual(
    [...instance.calls],
    [
      [45, 1],
      [31, 1],
      [44, 1],
    ],
  );
  assert(machine.bytes(64, PTCL_ABI.quadSize).every((byte) => byte === 0xdf));
  for (const id of [44, 45]) {
    const empty = await guest('particle-v2', id, [0x80000007], { count: 0 });
    empty.machine.start();
    assert.equal(empty.machine.run().status, 'halted');
    assert.equal(empty.instance.quads.length, 0);
    const wrongWidth = await guest('particle-v2', id);
    assert.throws(() => wrongWidth.run(2), /requires 1 arguments/);
    const oldTable = await guest('particle-v1', id, [0]);
    assert.throws(() => oldTable.run(2), /Unreviewed PTCL native/);
  }
});

test('2.6.1.23 PTCL v2 publishes the attachment word and validates both base outputs', async () => {
  for (const word of [0xffffffff, 0, 101, 0x80000000, 0xffff1234]) {
    const { run } = await guest('particle-v2', 46, [], {
      attachPlane: word,
      attachment: () => assert.fail('The attachment ID does not resolve a graph'),
    });
    run(1, word);
  }
  const options = {
    attachPlane: 101,
    attachment: () => ({ base: [-0, -0.375, 9], pos: [1, 2, 3] }),
    shared: new Uint8Array(12).fill(0x97),
  };
  const owned = await guest('particle-v2', 48, [64, 0x80000004], options);
  owned.run(2);
  assert.equal(owned.machine.load(64), floatBits(-0));
  assert.equal(owned.machine.load(0x80000004), floatBits(-0.375));
  assert.equal(owned.machine.load(0x80000000), 0x97979797);
  const aliased = await guest('particle-v2', 48, [64, 64], options);
  aliased.run(2);
  assert.equal(aliased.machine.load(64), floatBits(-0.375));
  const detached = await guest('particle-v2', 48, [64, 68], {
    ...options,
    attachmentDevicePresent: () => false,
    attachment: () => assert.fail('A detached device does not resolve a graph'),
  });
  detached.machine.bytes(63, 10).fill(0xdf);
  detached.run(2);
  assert.deepEqual([...detached.machine.bytes(63, 10)], [0xdf, ...new Array(8).fill(0), 0xdf]);
  const invalid = await guest('particle-v2', 48, [64, 0x80000009], options);
  invalid.machine.store(64, sentinel);
  assert.throws(() => invalid.run(2), /KCS memory 80000009\+4/);
  assert.equal(invalid.machine.load(64), sentinel);
  const stale = await guest('particle-v2', 48, [64, 68], {
    ...options,
    attachment: () => null,
  });
  stale.machine.store(64, sentinel);
  assert.throws(() => stale.run(2), /requires a live attachment graph/);
  assert.equal(stale.machine.load(64), sentinel);
});

test('2.6.1.23 PTCL v2 reads raw Plane registration words through Main and Particle GCALL', async (t) => {
  const code = kcsProgram([[37, sentinel], [43, 47, 0], [59]]);
  new DataView(code.buffer).setUint16(8, 2, true);
  const world = await dataWorld(profile, { 'visible.kcs': code });
  t.after(() => world.close({ flushFiles: false }));
  const call = async (id, args) => {
    const program = await readKCS(
      kcsProgram([
        [37, sentinel],
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        [59],
      ]),
    );
    const task = { ...world.main, io: null };
    const machine = (task.machine = new KCSMachine(program, {
      native: (number, words, caller) =>
        world.runtime.scheduler.native(task, number, words, caller),
    }));
    const floor = machine.sp;
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), sentinel);
  };
  const planeID = 101,
    parentID = 121,
    parent = await world.objects.create({ kind: 2, parent: world.root, nativeID: parentID }),
    plane = await world.objects.create({ kind: 2, parent, nativeID: planeID }),
    owner = world.graphics.get(plane),
    particle = await world.objects.create({ kind: 16, parent: world.root }),
    task = world.particles.get(particle),
    host = world.particles.host,
    make = (target) => call(79, [target, floatBits(8), floatBits(4), 0xff117799]),
    show = (target, word) => call(92, [target, word]),
    display = (word) => world.sendNativeEngine(planeID, world.main.id, 48, 0, word),
    first = 0xffd138ab;
  const device = world.graphics.createLogicalDevice();
  await make(planeID);
  task.state.attachment = planeID;
  const bank = await task.load({ family: 'script', program: 'visible', count: 1, priority: 0 });
  host.start(bank.key);
  const machine = bank.instance.machine;
  const floor = machine.sp;
  let frame = 0;
  const read = () => {
    host.updateBank(bank.key, frame++);
    assert.equal(machine.sp, floor + 8);
    const result = machine.pop();
    assert.equal(machine.pop(), sentinel);
    return result;
  };
  assert.equal(read(), 0);
  await show(planeID, first);
  assert.equal(read(), first);
  await show(planeID, 7);
  assert.equal(read(), first);
  await display(0);
  assert.equal(read(), 0);
  await display(0x80000000);
  assert.equal(read(), 0x80000000);
  device.retire();
  await show(planeID, 0);
  assert.equal(read(), 0);
  world.graphics.createLogicalDevice();
  assert.equal(read(), 0x80000000);
  await show(planeID, 0);
  assert.equal(read(), 0);
  await make(parentID);
  await show(parentID, 0x758903ab);
  owner.state.inheritPosition = true;
  await show(planeID, 1);
  assert.equal(read(), 0x758903ab);
  world.graphics.get(parent).unload();
  await show(planeID, 0);
  assert.equal(read(), 0x758903ab);
  const checkpoint = owner.snapshot();
  owner.restore(checkpoint);
  assert.equal(read(), 0x758903ab);
  delete checkpoint.graph.registrationWord;
  owner.restore(checkpoint);
  assert.throws(read, /Particle attachment registration word is unavailable/);
  owner.unload();
  assert.equal(read(), 0);
});

test('2.6.1.23 both Particle tables write only the current quad UV words and publish x87 distance', async () => {
  for (const table of particles) {
    const maybeUnused = [0xd2ddef88, 0xdba829fa],
      samples = [
        {
          args: [floatBits(2.5), maybeUnused[0], floatBits(5.5), maybeUnused[1]],
          width: 8,
          height: 16,
          words: [1 / 4, 1 / 8, 5 / 8, 1 / 8, 1 / 4, 5 / 16, 5 / 8, 5 / 16].map(floatBits),
        },
        {
          args: [0x3bf6238d, 0, 0xc36c4d47, 0],
          width: bitsFloat(0x7e1cb111),
          height: bitsFloat(0x5d19b73c),
          first: 0x8066fdbe,
        },
      ];
    for (const { args, width, height, words, first } of samples) {
      const { instance, run } = await guest(table, 29, args, { width, height });
      const quad = new Uint32Array(instance.quads.buffer);
      quad.fill(sentinel);
      run(2);
      const uv = [...quad].filter((_, i) => i % 7 >= 5);
      if (words) assert.deepEqual(uv, words);
      else assert.equal(uv[0], first);
      assert([...quad].filter((_, i) => i % 7 < 5).every((word) => word === sentinel));
    }
    for (const [args, expected] of [
      [[0, 0, 0, ...[3, 4, 12].map(floatBits)], 0x41500000],
      [[0x4b189680, 0xc0000000, 0, 0xc0400000, 0x41400000, 0x4b189680], 0x4b57cab9],
      [[0xff801234, 0, 0, 0, 0, 0], 0xffc01234],
    ]) {
      const { run } = await guest(table, 37, args);
      run(1, expected);
    }
    for (const [id, argumentWords] of [
      [29, 4],
      [37, 6],
    ]) {
      const wrong = await guest(table, id, new Array(argumentWords - 1).fill(0));
      assert.throws(
        () => wrong.instance.update(0),
        new RegExp(`requires ${argumentWords} arguments`),
      );
      assert.equal(wrong.instance.calls.size, 0);
    }
    const debug = await guest(table, 0, [64]);
    assert.throws(() => debug.instance.update(0), /Unreviewed PTCL native .*\/0/);
  }
});

test('2.6.1.23 PTCL v2 reads its live Plane base and position through the particle task', async (t) => {
  const base = [80, 84],
    position = [64, 68, 72],
    code = kcsProgram([
      ...base.map((at) => [37, at]),
      [43, 48, 8],
      ...position.map((at) => [37, at]),
      [43, 49, 12],
      [59],
    ]);
  new DataView(code.buffer, code.byteOffset, code.byteLength).setUint16(8, 2, true);
  const world = await dataWorld(profile, { 'position.kcs': code });
  t.after(() => world.close({ flushFiles: false }));
  const planeID = 101,
    plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: planeID }),
    owner = world.graphics.get(plane),
    particle = await world.objects.create({ kind: 16, parent: world.root }),
    task = world.particles.get(particle),
    host = world.particles.host;
  task.state.attachment = planeID;
  owner.makeGraph({ type: 2, width: 2, height: 2 });
  setMotionVector(owner.graph.kx2, MOTION_ABI.base, [-2, 3.25, 5000]);
  setMotionVector(owner.graph.kx2, MOTION_ABI.pos, [1.375, -0, -12.25]);
  const bank = await task.load({ family: 'script', program: 'position', count: 1, priority: 0 }),
    machine = bank.instance.machine,
    read = () => [...base, ...position].map((at) => machine.load(at)),
    expected = [-2, 3.25, 1.375, -0, -12.25].map(floatBits);
  const device = world.graphics.createLogicalDevice();
  host.start(bank.key);
  host.updateBank(bank.key, 0);
  assert.deepEqual(read(), expected);
  device.retire();
  host.updateBank(bank.key, 1);
  assert.deepEqual(read(), [0, 0, 0, 0, 0]);
  world.graphics.createLogicalDevice();
  host.updateBank(bank.key, 2);
  assert.deepEqual(read(), expected);
  await world.objects.release(plane);
  assert.throws(() => host.updateBank(bank.key, 3), /requires a live attachment graph/);
  assert.deepEqual(read(), expected);
});

test('2.6.1.23 PTCL v2 only writes its three position words after validating every output', async () => {
  const noSource = await guest('particle-v2', 49, [64, 68, 72]);
  noSource.machine.bytes(63, 14).fill(0x7b);
  noSource.run(2);
  assert.deepEqual([...noSource.machine.bytes(63, 14)], [0x7b, ...new Array(12).fill(0), 0x7b]);
  const options = {
    attachPlane: 101,
    attachment: () => ({ pos: [-0, -0.375, 5.75] }),
    shared: new Uint8Array(12).fill(0x97),
  };
  const alias = await guest('particle-v2', 49, [64, 0x80000004, 64], options);
  alias.run(2);
  assert.equal(alias.machine.load(64), floatBits(5.75));
  assert.equal(alias.machine.load(0x80000004), floatBits(-0.375));
  assert.equal(alias.machine.load(0x80000000), 0x97979797);
  const invalid = await guest('particle-v2', 49, [64, 0x80000004, 0x80000009], options);
  invalid.machine.store(64, sentinel);
  assert.throws(() => invalid.run(2), /KCS memory 80000009\+4/);
  assert.equal(invalid.machine.load(64), sentinel);
  assert.equal(invalid.machine.load(0x80000004), floatBits(-0.375));
});

test('2.6.1.23 MOT uses the original PC24 rotation order through GCALL', async () => {
  const shared = 0x80000203,
    input = [
      1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
    ],
    angles = [1.3125, -0.357, 0.089999999].map(floatBits),
    ypr = [
      0x3f1d7780, 0x3f00b4e0, 0xbf791fca, 0, 0xbede4fc4, 0x3ebcc468, 0x3d77efec, 0, 0x3fcafd45,
      0x3fa3e9eb, 0xbd1b92f8, 0, 0x408229b2, 0xc0e5af4a, 0xc18b9a4b, 0x3f800000,
    ],
    relative = [
      0x3f9fd165, 0xbd2ea94f, 0xbe06eb5a, 0, 0xbe2faa8a, 0xbd29824c, 0xbf0b829c, 0, 0x3fae7827,
      0x3fc13234, 0xbe11b3d2, 0, 0x41503cd6, 0xc147b22f, 0x40dc59af, 0x3f800000,
    ];
  for (const [id, args, expected] of [
    [43, [shared, ...angles], ypr],
    [44, [shared, shared, 64], relative],
  ]) {
    const { instance, machine, run } = await guest('generic', id, args);
    machine.bytes(shared - 1, 66).fill(0xa3);
    input.forEach((value, i) => machine.store(shared + i * 4, floatBits(value)));
    angles.forEach((value, i) => machine.store(64 + i * 4, value));
    run(2);
    assert.deepEqual(
      expected.map((_, i) => machine.load(shared + i * 4)),
      expected,
    );
    assert.equal(machine.load(shared - 1, 1), 0xa3);
    assert.equal(machine.load(shared + 64, 1), 0xa3);
    assert.equal(instance.frame, 27);
    assert.equal(instance.active, true);
  }
  const invalid = await guest('generic', 44, [shared, 0xffffffff, 64]);
  invalid.machine.bytes(shared, 64).fill(0x63);
  const before = invalid.machine.bytes(shared, 64).slice();
  assert.throws(() => invalid.run(2), /KCS memory ffffffff\+64/);
  assert.deepEqual(invalid.machine.bytes(shared, 64), before);
  const nonFinite = await guest('generic', 43, [shared, 0x7f800000, ...angles.slice(1)]);
  nonFinite.machine.bytes(shared, 64).set(before);
  assert.throws(() => nonFinite.run(2), /scalar FSINCOS range/);
  assert.deepEqual(nonFinite.machine.bytes(shared, 64), before);
});

test('2.6.1.23 Main writes the local YPR matrix without reading the previous owner', async (t) => {
  const args = [64, ...[1.3125, -0.357, 0.089999999].map(floatBits)];
  const world = await dataWorld(
    profile,
    {
      'case.kcs': kcsProgram([
        [37, sentinel],
        ...args.map((word) => [37, word]),
        [43, 662, 16],
        [59],
      ]),
    },
    { initialize: false },
  );
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.runtime.spawn('case.kcs'),
    machine = task.machine,
    expected = [
      0x3e6568c0, 0x3dac772a, 0xbf788f4f, 0, 0xbeb80b7c, 0x3f6ee366, 0xbb038640, 0, 0x3f67e6f3,
      0x3eb2ed14, 0x3e751280, 0, 0, 0, 0, 0x3f800000,
    ];
  machine.bytes(63, 66).fill(0x76);
  machine.store(64, 0xffc00000);
  await world.runtime.tick();
  assert.equal(task.status, 'finished');
  assert.equal(machine.sp, machine.floor + 4);
  assert.equal(machine.load(machine.floor), sentinel);
  assert.deepEqual(
    expected.map((_, i) => machine.load(64 + i * 4)),
    expected,
  );
  assert.equal(machine.load(63, 1), 0x76);
  assert.equal(machine.load(128, 1), 0x76);
});

test('2.6.1.23 Main applies matrix operations to the mapped or current record', async (t) => {
  const world = await dataWorld(profile, {}, { initialize: false });
  t.after(() => world.close({ flushFiles: false }));
  const current = world.calculations.matrix,
    source = [
      1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
    ].map(floatBits),
    operands = [-1.125, 0.25, 13.4375].map(floatBits);
  const cases = [
    [
      204,
      0xffffffff,
      [
        0x3e8ba3f7, 0x3f98928c, 0xbe937476, 0, 0xbe233b79, 0xbe51cb7c, 0xbf02b86e, 0, 0xbf9323ac,
        0x3fd70684, 0x3de7e78f, 0, 0x4183ced3, 0x411ee3d5, 0x3fca7e98, 0x3f800000,
      ],
    ],
    [205, 0, [...source.slice(0, 12), 0x41810000, 0xc0fc0000, 0x41270000, 0x3f800000]],
    [
      206,
      67,
      [
        0xbfa20000, 0x3d800000, 0x40d70000, 0, 0x3e100000, 0x3e000000, 0xc0570000, 0, 0xbf100000,
        0x3e200000, 0x41c99000, 0, 0xc19b4000, 0xc0020000, 0xc2214000, 0x3f800000,
      ],
    ],
  ];
  for (const [id, address, expected] of cases) {
    const args = [address, ...operands],
      script = await readKCS(
        kcsProgram([[37, sentinel], ...args.map((word) => [37, word]), [43, id, 16], [59]]),
      ),
      task = world.runtime.scheduler.add(script, { name: 'matrix.kcs', abi: 'main' }),
      { machine } = task,
      output = address === 0xffffffff ? current : machine.bytes(address, 64),
      values = new DataView(output.buffer, output.byteOffset, output.byteLength);
    current.fill(0x24);
    source.forEach((value, i) => values.setUint32(i * 4, value, true));
    await world.runtime.tick();
    assert.equal(task.status, 'finished');
    assert.equal(machine.sp, machine.floor + 4);
    assert.equal(machine.load(machine.floor), sentinel);
    assert.deepEqual(
      expected.map((_, i) => values.getUint32(i * 4, true)),
      expected,
    );
    if (address !== 0xffffffff) assert.deepEqual(current, new Uint8Array(64).fill(0x24));
  }
});

test('2.6.1.23 MOT retains raw arithmetic and overlapping component order', async () => {
  for (const [args, expected] of [
    [[0x40000000, 0x40400000], 0x41000000],
    [[0xff801234, 0x80000000], 0xffc01234],
  ]) {
    const power = await guest('generic', 13, args);
    power.run(1, expected);
  }

  const rotation = await guest('generic', 19, [64, 68, 72, 0x5f000000]);
  rotation.machine.store(64, floatBits(1));
  rotation.run(2);
  assert.deepEqual(
    [64, 68, 72].map((address) => rotation.machine.load(address)),
    [0x3e7d44ae, 0, 0x3f780bd8],
  );

  for (const [id, factors, expected] of [
    [21, [4, 5, 6], 18],
    [22, [2, -1, 4], -24],
  ]) {
    const alias = await guest('generic', id, [64, 64, 64, ...factors.map(floatBits)]);
    alias.machine.store(64, floatBits(3));
    alias.machine.store(68, sentinel);
    alias.run(2);
    assert.equal(alias.machine.load(64), floatBits(expected));
    assert.equal(alias.machine.load(68), sentinel);
  }

  const invalid = await guest('generic', 21, [64, 68, 0xffffffff, ...[1, 2, 3].map(floatBits)]);
  invalid.machine.store(64, sentinel);
  invalid.machine.store(68, sentinel);
  assert.throws(() => invalid.run(2), /KCS memory/);
  assert.deepEqual(
    [64, 68].map((address) => invalid.machine.load(address)),
    [sentinel, sentinel],
  );
});

test('2.6.1.23 both interpreters use the original matrix and vector memory contracts', async (t) => {
  const world = await dataWorld(profile, {}, { initialize: false });
  t.after(() => world.close({ flushFiles: false }));
  const copy = await guest('generic', 28, [68, 64], { calculations: world.calculations });
  for (let i = 0; i < 17; i++) copy.machine.store(64 + i * 4, 0x7930f7a1 + i);
  copy.run(2);
  for (let i = 0; i < 17; i++) assert.equal(copy.machine.load(64 + i * 4), 0x7930f7a1);

  const original = [
    1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
  ].map(floatBits);
  const inverted = [
    1065353216, 3188869413, 3197258021, 0, 1036831949, 1071225242, 1045220557, 0, 3197737370,
    3204927605, 1057683632, 0, 3247092531, 1097535137, 1090710031, 1065353216,
  ];
  const activeMatrix = world.calculations.matrix,
    matrix = new DataView(activeMatrix.buffer, activeMatrix.byteOffset, 64);
  const initialize = () => original.forEach((word, i) => matrix.setUint32(i * 4, word, true));
  const invert = await guest('generic', 27, [0xffffffff], { calculations: world.calculations });
  initialize();
  invert.run(2);
  assert.deepEqual(
    inverted.map((_, i) => matrix.getUint32(i * 4, true)),
    inverted,
  );

  const mainScript = await readKCS(
    kcsProgram([[37, sentinel], [37, 0xffffffff], [43, 350, 4], [59]]),
  );
  const main = world.runtime.scheduler.add(mainScript, { name: 'inverse.kcs', abi: 'main' });
  initialize();
  await world.runtime.tick();
  assert.equal(main.status, 'finished');
  assert.equal(main.machine.sp, main.machine.floor + 4);
  assert.equal(main.machine.pop(), sentinel);
  assert.deepEqual(
    inverted.map((_, i) => matrix.getUint32(i * 4, true)),
    inverted,
  );

  const translated = await guest('generic', 24, [0xffffffff, ...[2, -3, 4].map(floatBits)], {
    calculations: world.calculations,
  });
  const identityWords = Array.from({ length: 16 }, (_, i) => floatBits(Number(i % 5 === 0)));
  identityWords.forEach((word, i) => matrix.setUint32(i * 4, word, true));
  translated.run(2);
  assert.deepEqual(
    [12, 13, 14, 15].map((i) => matrix.getUint32(i * 4, true)),
    [2, -3, 4, 1].map(floatBits),
  );

  const scaled = await guest('generic', 25, [97, ...[-2, 3, 0.5].map(floatBits)], {
    calculations: world.calculations,
  });
  identityWords.forEach((word, i) => scaled.machine.store(97 + i * 4, word));
  scaled.run(2);
  assert.deepEqual(
    [0, 5, 10, 15].map((i) => scaled.machine.load(97 + i * 4)),
    [-2, 3, 0.5, 1].map(floatBits),
  );

  const lengths = await guest('generic', 34, [96]);
  [8192, 0, 2, 2].forEach((value, i) => lengths.machine.store(96 + i * 4, floatBits(value)));
  lengths.run(1, floatBits(8192));
  const unbounded = await guest('generic', 30, [64, 0xffffffff]);
  unbounded.machine.bytes(64, 64).fill(0x83);
  assert.throws(() => unbounded.run(2), /KCS memory/);
  assert.deepEqual(unbounded.machine.bytes(64, 64), new Uint8Array(64).fill(0x83));
  const transform = await guest('generic', 37, [64, 192]);
  transform.machine.store(64, 0x7f800001);
  assert.throws(() => transform.run(2), /requires finite matrix and vector operands/);
  assert.equal(transform.machine.load(64), 0x7f800001);
});

test('2.6.1.23 PTCL writes the four viewport words in order in both tables', async () => {
  const local = 64,
    shared = 0x80000100,
    options = {
      width: 0,
      height: 0,
      screenWidth: 641,
      screenHeight: 481,
      priority: 9,
      shared: new Uint8Array(512),
      attachment: () => assert.fail('Viewport query attempted attachment lookup'),
    };
  for (const table of particles) {
    for (const [z, outputs, expected] of [
      [
        floatBits(31),
        [0, 0x80000000, local, shared],
        [0x411eb860, 0x40ee1480, 0x441d851e, 0x43ec47ae],
      ],
      [
        floatBits(31),
        [local, local + 2, shared, shared + 2],
        [0x1480b860, 0x40ee1480, 0x47ae851e, 0x43ec47ae],
      ],
      [0xffc5aa22, [local, local, shared, shared], Array(4).fill(0xffc5aa22)],
      [0x7f800000, [local, local, local, local], Array(4).fill(0xffc00000)],
    ]) {
      const { instance, machine, run } = await guest(table, 38, [z, ...outputs], options);
      machine.store(local + 6, sentinel);
      machine.store(shared + 6, sentinel);
      const quad = instance.quads.slice();
      run(2);
      assert.deepEqual(
        outputs.map((address) => machine.load(address)),
        expected,
      );
      assert.equal(machine.load(local + 6), sentinel);
      assert.equal(machine.load(shared + 6), sentinel);
      assert.deepEqual(instance.quads, quad);
      assert.equal(instance.active, true);
    }
    const invalid = await guest(table, 38, [0, local, shared, 448, 0xffffffff], options);
    invalid.machine.store(local, sentinel);
    assert.throws(() => invalid.run(2), /KCS memory ffffffff\+4/);
    assert.equal(invalid.machine.load(local), sentinel);
  }
});

test('2.6.1.23 MOT and PTCL retain their unresolved guards and exact arities', async () => {
  for (const [id, expected] of [
    [23, 4],
    [26, 1],
  ]) {
    const wrongMatrix = await guest('generic', id);
    assert.throws(
      () => wrongMatrix.instance.update(0),
      new RegExp(`expects ${expected} arguments, got 0`),
    );
    assert.equal(wrongMatrix.instance.calls.size, 0);
  }
  const wrongMOT = await guest('generic', 1);
  assert.throws(() => wrongMOT.instance.update(0), /expects 1 arguments, got 0/);
  assert.equal(wrongMOT.instance.calls.size, 0);
  const v1Attachment = await guest('particle-v1', 49, [64, 68, 72]);
  assert.throws(() => v1Attachment.instance.update(0), /Unreviewed PTCL native .*\/49/);
  assert.equal(v1Attachment.instance.calls.size, 0);
  const wrongAttachment = await guest('particle-v2', 49, [64, 68]);
  assert.throws(() => wrongAttachment.instance.update(0), /requires 3 arguments, received 2/);
  assert.equal(wrongAttachment.instance.calls.size, 0);
  for (const table of particles) {
    const wrongViewport = await guest(table, 38, [64, 68, 72, 76]);
    assert.throws(() => wrongViewport.instance.update(0), /requires 5 arguments, received 4/);
    assert.equal(wrongViewport.instance.calls.size, 0);
    const wrongPTCL = await guest(table, 28, [64, 68]);
    assert.throws(() => wrongPTCL.instance.update(0), /requires 3 arguments, received 2/);
    assert.equal(wrongPTCL.instance.calls.size, 0);
  }
});
