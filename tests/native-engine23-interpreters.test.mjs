// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { bitsFloat, floatBits, readKCS } from '../src/kcs.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
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

test('2.6.1.23 Main sound geometry helpers preserve x87 result words through GCALL', async (t) => {
  const cases = [
    [51, [0x80000000], 0x3f800000],
    [51, [0x40490fdb], 0xbf800000],
    [51, [0x7149f2ca], 0x3ed3a9bb],
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
  for (const table of particles) {
    const closed = await guest(table, 38, [64, 68, 72, 76, 80]);
    assert.throws(() => closed.instance.update(0), /Unreviewed PTCL native .*\/38/);
    assert.equal(closed.instance.calls.size, 0);
    const wrongPTCL = await guest(table, 28, [64, 68]);
    assert.throws(() => wrongPTCL.instance.update(0), /requires 3 arguments, received 2/);
    assert.equal(wrongPTCL.instance.calls.size, 0);
  }
});
