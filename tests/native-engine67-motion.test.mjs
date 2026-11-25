// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { floatBits, readKCS } from '../src/kcs.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { decodeMotionRecords } from '../src/motion/checkpoint.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67',
  managerWord = [0x13, 80],
  motionWord = [0x13, 84],
  flags = 0x81fe0032;

test('2.6.1.67 KCS loads formatted MOT entries and replaces their native F32 register bank', async (t) => {
  const world = await dataWorld(profile, {
    'owned-7.kcs': kcsProgram([[59]]),
    'add.kcs': motionProgram([
      [304, [0, 128, 192, 2, 224, 3, 17], 88],
      [304, [managerWord, 128, 192, 2, 224, 3, 17], 84],
      [304, [managerWord, 160, 0xffffffff, 0, 0xffffffff, 0, 17], 92],
      [535, [managerWord, 128, 0xffffffff, 0, 0xffffffff, 0, 19, 11], 96],
    ]),
    'replace.kcs': motionProgram([
      [306, [managerWord, 0, 0xffffffff, 7]],
      [306, [managerWord, motionWord, 192, 1]],
    ]),
    'clear.kcs': motionProgram([[306, [managerWord, motionWord, 0xffffffff, 0]]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const owner = world.runtime.services.motion.create(world.main.id),
    { manager } = world.runtime.handles.get(owner, 'motion-manager'),
    run = async (name, handle = 0) => {
      const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
        m = task.machine;
      m.store(80, owner);
      m.store(84, handle);
      m.writeString('owned-%d[G512]', 128);
      m.writeString('missing', 160);
      m.store(512, 7);
      m.store(192, name === 'add.kcs' ? 0x7f812345 : 0xff812345);
      m.store(196, 0x80000000);
      m.bytes(224, 3).set([2, 4, 8]);
      const stack = m.sp;
      await world.runtime.scheduler.execute(task);
      assert.equal(m.sp, stack + 4);
      assert.equal(m.load(stack), 0xa0263136);
      return m;
    };
  const task = await run('add.kcs'),
    handle = task.load(84),
    record = manager.records.get(handle),
    instance = record.instance,
    { registers, extraData } = MOTION_ABI,
    words = () =>
      Array.from({ length: 3 }, (_, i) => instance.view.getUint32(registers + i * 4, true));
  assert.equal(handle, 1);
  assert.deepEqual([task.load(88), task.load(92), manager.records.size], [0, 0, 2]);
  const delayed = manager.records.get(task.load(96));
  assert.equal(delayed.group, 19);
  assert.equal(delayed.instance.delay, 11);
  assert.equal(delayed.instance.view.getUint32(MOTION_ABI.registers, true), 0);
  assert.equal(record.group, 17);
  assert.equal(instance.script.name, 'owned-7');
  assert.deepEqual(words(), [0x7fc12345, 0x80000000, 0]);
  assert.deepEqual(
    instance.machine.bytes(instance.view.getUint32(extraData, true), 3),
    Uint8Array.of(2, 4, 8),
  );
  await run('replace.kcs', handle);
  assert.deepEqual(words(), [0xffc12345, 0, 0]);
  await run('clear.kcs', handle);
  assert.deepEqual(words(), [0, 0, 0]);
  assert.equal(instance.activeWord, 1);
});

function motionProgram(steps) {
  return kcsProgram([
    [37, 0xa0263136],
    ...steps.flatMap(([id, args, result]) => [
      ...args.map((arg) => [37, arg]),
      [43, id, args.length * 4],
      ...(result === undefined ? [] : [[38, result]]),
    ]),
    [59],
  ]);
}

test('2.6.1.67 Motion matrix calls preserve native fallback, SSE2 products and forward aliases', async () => {
  const affine = [
      1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
    ].map(floatBits),
    general = [
      1.31, 0.17, -0.571, 0.08, 0.31, 0.92, -0.222, 1.222, -1.034, 0.7, -2.1, 1.07, -17.125, 8.25,
      19.11, 0.675,
    ].map(floatBits),
    angles = [1.3125, -0.357, 0.089999999].map(floatBits),
    left = 0x80000043,
    right = 128,
    fromHex = (data) => data.split(' ').map((word) => Number.parseInt(word, 16));
  const outputs = new Map([
    [
      23,
      fromHex(
        '3f757ca1 beab60b0 3f3d4167 00000000 be977cd3 3eb03e1f 3eb2e6fd 00000000 3e73de06 bfd1b66f 3f984625 00000000 4198305f 4022e481 c0033162 3f800000',
      ),
    ],
    [
      24,
      fromHex(
        '3f900000 3e800000 3f000000 00000000 be000000 3f000000 be800000 00000000 3f000000 3f200000 3ff00000 00000000 41948000 c107b646 c03a3d71 3f800000',
      ),
    ],
    [
      25,
      fromHex(
        '3fbd0000 bdb6c8b4 3d3851eb 00000000 be280000 be36c8b4 bcb851eb 00000000 3f280000 be647ae1 3e2ccccc 00000000 41b52000 4039a3d7 be8a3d70 3f800000',
      ),
    ],
    [
      26,
      fromHex(
        '3f800000 00000000 00000000 00000000 00000000 3f800000 00000000 00000000 00000000 00000000 3f800000 00000000 00000000 00000000 00000000 3f800000',
      ),
    ],
    [
      29,
      fromHex(
        '3f84624c 3f4570a4 bfdfba5e 3f6e3540 3e7fbe78 3e870a3e 3ef88312 3eaac083 bf8b851f 3ffc7ae1 c08b9374 4033d70b 40c1c8b6 3fcdc294 418ae979 c131570a',
      ),
    ],
    [
      30,
      fromHex(
        'be3d70a0 3da3d70a 3f891687 bda3d70a bedeb852 bed70a3e bce56040 bf9c6a7f 3fc45a1d bd999998 407e6666 bf88f5c3 42098000 c1830000 c1b0e148 3ea66666',
      ),
    ],
  ]);
  const write = (machine, address, words) =>
      words.forEach((word, index) => machine.store(address + index * 4, word)),
    read = (machine, address, count = 16) =>
      Array.from({ length: count }, (_, index) => machine.load(address + index * 4));
  const motion = async (id, words, options) =>
    new MotionInstance(await readKCS(motionProgram([[id, words]])), { profile, ...options });
  const run = (instance) => {
    assert.equal(instance.update(0).status, 'halted');
    assert.equal(instance.machine.pop(), 0xa0263136);
    assert.equal(instance.machine.sp, instance.machine.floor);
  };
  for (const [id, expected] of outputs) {
    const argumentsFor = (address) => {
      if (id === 26) return [address];
      if (id >= 29) return [address, right];
      return [address, ...angles];
    };
    const instance = await motion(id, argumentsFor(left)),
      { machine } = instance;
    machine.store(left - 4, 0xce5852f0);
    machine.store(left + 64, 0xce5852f0);
    write(machine, left, affine);
    write(machine, right, general);
    run(instance);
    assert.deepEqual(read(machine, left), expected, `Generic ${id}`);
    assert.deepEqual(read(machine, right), general, `Generic ${id} reference`);
    assert.equal(machine.load(left - 4), 0xce5852f0);
    assert.equal(machine.load(left + 64), 0xce5852f0);
    if (id > 26) continue;
    const selected = new Uint32Array(affine),
      usingCurrent = await motion(id, argumentsFor(0xffffffff), {
        calculations: { matrix: new Uint8Array(selected.buffer) },
      });
    run(usingCurrent);
    assert.deepEqual([...selected], expected, `Generic ${id} current matrix`);
  }
  for (const id of [28, 30]) {
    const instance = await motion(id, [68, 64]),
      { machine } = instance;
    write(
      machine,
      64,
      Array.from({ length: 18 }, (_, index) => floatBits(index * 2 + 1)),
    );
    run(instance);
    assert.deepEqual(
      read(machine, 68),
      Array.from({ length: 16 }, (_, index) => floatBits(id === 28 ? 1 : index + 2)),
    );
    assert.equal(machine.load(132), floatBits(35));
  }
  const malformed = await motion(23, [64]),
    guarded = await motion(0, [64]);
  assert.throws(() => malformed.update(0), /expects 4 arguments/);
  assert.throws(() => guarded.update(0), /Unrecovered MOT native .*:0/);
});

test('2.6.1.67 Motion vector calls preserve x87 result words and native operand aliases', async () => {
  const left = 64,
    right = 0x80000000,
    parentCanary = 0x7da9be21;
  const samples = [
    {
      id: 32,
      args: [left + 4, left],
      before: [1, 3, 5, 7, 9].map(floatBits),
      after: [4, 9, 16, 25].map(floatBits),
    },
    {
      id: 33,
      args: [left + 4, left],
      before: [1, 3, 5, 7, 9].map(floatBits),
      after: [2, 3, 4, 5].map(floatBits),
    },
    {
      id: 32,
      args: [left, right],
      before: [0x7f812345, 0xffc43210, 0x7f800000, 0x80000000],
      source: [0xff812348, 0x7f825482, 0xff800000, 0x80000000],
      after: [0xffc12348, 0xffc43210, 0xffc00000, 0x80000000],
    },
    {
      id: 33,
      args: [left, right],
      before: [0x7f812345, 0xffc43210, 0x7f800000, 0x80000000],
      source: [0xff812348, 0x7f825482, 0xff800000, 0x80000000],
      after: [0xffc12348, 0xffc43210, 0x7f800000, 0],
    },
    { id: 34, args: [left], before: [1, 2, 3, 4].map(floatBits), reply: 0x40af456f },
    { id: 35, args: [left], before: Array(4).fill(0x1a000000), reply: 2 },
    { id: 34, args: [left], before: [0xffc40212, 0x7f800042, 0, 0], reply: 0xffc40212 },
    { id: 35, args: [left], before: [0x7f800042, 0xffc40212, 0, 0], reply: 0xffc40212 },
    {
      id: 36,
      args: [left, left + 4],
      before: [2, -3, 4, 0.5].map(floatBits),
      after: [-6, 9, -12, -1.5].map(floatBits),
    },
    {
      id: 36,
      args: [left, right],
      before: [0x7fc12345, 0x7f800000, 0xff820234, 0x80000000],
      source: [0xffc91234],
      after: Array(4).fill(0xffc91234),
    },
  ];
  for (const { id, args, before, source = [], after = before, reply } of samples) {
    const program = await readKCS(
        motionProgram([[id, args, reply === undefined ? undefined : 160]]),
      ),
      instance = new MotionInstance(program, { profile }),
      { machine } = instance;
    before.forEach((word, index) => machine.store(left + index * 4, word));
    source.forEach((word, index) => machine.store(right + index * 4, word));
    machine.store(args[0] + 16, parentCanary);
    if (reply !== undefined) machine.store(160, parentCanary);
    assert.equal(instance.update(0).status, 'halted');
    assert.equal(machine.pop(), 0xa0263136);
    assert.equal(machine.sp, machine.floor);
    assert.deepEqual(
      after.map((_, index) => machine.load(args[0] + index * 4)),
      after,
    );
    assert.equal(machine.load(args[0] + 16), parentCanary);
    if (reply !== undefined) assert.equal(machine.load(160), reply);
  }
});

test('2.6.1.67 MOT rotations retain the selector-2 quaternion and independent axis normalization', async () => {
  const matrix = [
      1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
    ].map(floatBits),
    reference = [
      1.31, 0.17, -0.571, 0.08, 0.31, 0.92, -0.222, 1.222, -1.034, 0.7, -2.1, 1.07, -17.125, 8.25,
      19.11, 0.675,
    ].map(floatBits),
    angles = [1.3125, -0.357, 0.089999999].map(floatBits),
    expected = {
      43: '3f1d7783 3f00b4e0 bf791fc4 00000000 bede4fc2 3ebcc468 3d77efce 00000000 3fcafd42 3fa3e9ea bd1b9268 00000000 408229ba c0e5af4a c18b9a48 3f800000',
      44: '3f07c10d 3f80cf2f bf087b7b 00000000 bebf8f3b be20997f becf0ec4 00000000 bee4eab6 3ffd7a13 3e3f0b64 00000000 4192ca12 406315c6 c09a833e 3f800000',
    };
  for (const id of [43, 44]) {
    const address = 0x80000043,
      args = id === 43 ? [address, ...angles] : [address, 128, 256],
      instance = new MotionInstance(await readKCS(motionProgram([[id, args]])), { profile }),
      { machine } = instance;
    for (const [at, words] of [
      [address, matrix],
      [128, reference],
      [256, angles],
    ])
      words.forEach((word, i) => machine.store(at + i * 4, word));
    machine.bytes(address - 1, 1)[0] = 0x91;
    machine.bytes(address + 64, 1)[0] = 0x7a;
    assert.equal(instance.update(0).status, 'halted');
    assert.equal(machine.pop(), 0xa0263136);
    assert.equal(machine.sp, machine.floor);
    assert.deepEqual(
      Array.from({ length: 16 }, (_, i) => machine.load(address + i * 4)),
      expected[id].split(' ').map((word) => Number.parseInt(word, 16)),
    );
    assert.equal(machine.bytes(address - 1, 1)[0], 0x91);
    assert.equal(machine.bytes(address + 64, 1)[0], 0x7a);
    assert.deepEqual(
      reference.map((_, i) => machine.load(128 + i * 4)),
      reference,
    );
    assert.deepEqual(
      angles.map((_, i) => machine.load(256 + i * 4)),
      angles,
    );
  }
});

test('2.6.1.67 MOT inverse uses the native SSE reciprocal and current-matrix fallback', async () => {
  const matrix = [
      1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
    ].map(floatBits),
    expected = (
      '3f7fffff be124924 be924924 00000000 3dcccccc 3fd99999 3e4ccccc 00000000 ' +
      'be999999 bf075074 3f0af8af 00000000 c18ab333 416b0ea0 4102ea0e 3f7fffff'
    )
      .split(' ')
      .map((word) => Number.parseInt(word, 16));
  for (const address of [64, 0x80000043, 0xffffffff]) {
    const selected = new Uint32Array(matrix),
      instance = new MotionInstance(await readKCS(motionProgram([[27, [address]]])), {
        profile,
        calculations: { matrix: new Uint8Array(selected.buffer) },
      }),
      { machine } = instance;
    if (address !== 0xffffffff) {
      matrix.forEach((word, i) => machine.store(address + i * 4, word));
      machine.bytes(address - 1, 1)[0] = 0x91;
      machine.bytes(address + 64, 1)[0] = 0x7a;
    }
    assert.equal(instance.update(0).status, 'halted');
    assert.equal(machine.pop(), 0xa0263136);
    assert.equal(machine.sp, machine.floor);
    assert.deepEqual(
      address === 0xffffffff
        ? [...selected]
        : expected.map((_, i) => machine.load(address + i * 4)),
      expected,
    );
    if (address !== 0xffffffff) {
      assert.deepEqual([...selected], matrix);
      assert.equal(machine.bytes(address - 1, 1)[0], 0x91);
      assert.equal(machine.bytes(address + 64, 1)[0], 0x7a);
    }
  }
  for (const words of [Array(16).fill(0), [0x7f801234, ...matrix.slice(1)]]) {
    const instance = new MotionInstance(await readKCS(motionProgram([[27, [64]]])), { profile });
    words.forEach((word, i) => instance.machine.store(64 + i * 4, word));
    instance.update(0);
    assert.deepEqual(
      words.map((_, i) => instance.machine.load(64 + i * 4)),
      words,
    );
  }
});

test('2.6.1.67 MOT normalization preserves the native SSE seed correction and special words', async () => {
  const cases = [
    [
      [0x3f800000, 0, 0, 0],
      [0x3f7fffff, 0, 0, 0],
    ],
    [[1, 2, 3, 4].map(floatBits), [0x3e3af4b9, 0x3ebaf4b9, 0x3f0c378b, 0x3f3af4b9]],
    [[0, 0x80000000, 0, 0x80000000], Array(4).fill(0xffc00000)],
    [[1, 2, 3, 4], Array(4).fill(0xffc00000)],
    [[0x7f7fffff, 0, 0, 0], Array(4).fill(0xffc00000)],
    [
      [0x7fc12345, 0xff801234, 0, 0],
      [0x7fc12345, 0xffc01234, 0x7fc12345, 0x7fc12345],
    ],
  ];
  for (const address of [64, 0x80000001]) {
    for (const [before, after] of cases) {
      const instance = new MotionInstance(await readKCS(motionProgram([[31, [address]]])), {
          profile,
        }),
        { machine } = instance;
      before.forEach((word, i) => machine.store(address + i * 4, word));
      machine.bytes(address - 1, 1)[0] = 0x91;
      machine.bytes(address + 16, 1)[0] = 0x7a;
      assert.equal(instance.update(0).status, 'halted');
      assert.equal(machine.pop(), 0xa0263136);
      assert.equal(machine.sp, machine.floor);
      assert.deepEqual(
        after.map((_, i) => machine.load(address + i * 4)),
        after,
      );
      assert.equal(machine.bytes(address - 1, 1)[0], 0x91);
      assert.equal(machine.bytes(address + 16, 1)[0], 0x7a);
    }
  }
});

test('2.6.1.67 MOT vector transforms preserve physical SSE2 NaNs and aliased source words', async () => {
  const matrix = [1, 1, 1, 1, 33554432, 0, 0, 0, 1, 0, 0, 0, -33554432, 0, 0, 0].map(floatBits),
    samples = [
      { before: [1, 1, 1, 1].map(floatBits), after: [0, 1, 1, 1].map(floatBits) },
      {
        before: [0x7fc12345, 0x7f800000, 0xff820234, 0x80000000],
        after: Array(4).fill(0x7fc12345),
      },
      {
        before: [0x7f800000, 0, 0xff820234, 0x80000000],
        after: Array(4).fill(0xffc20234),
      },
      {
        before: [0x7f800000, 0xff800000, 0, 0],
        after: Array(4).fill(0xffc00000),
      },
    ];
  for (const { before, after } of samples) {
    const instance = new MotionInstance(await readKCS(motionProgram([[37, [64, 0x80000001]]])), {
        profile,
      }),
      { machine } = instance;
    before.forEach((word, i) => machine.store(64 + i * 4, word));
    matrix.forEach((word, i) => machine.store(0x80000001 + i * 4, word));
    machine.store(60, 0xce5852f0);
    machine.store(80, 0xce5852f0);
    assert.equal(instance.update(0).status, 'halted');
    assert.equal(machine.pop(), 0xa0263136);
    assert.equal(machine.sp, machine.floor);
    assert.deepEqual(
      after.map((_, i) => machine.load(64 + i * 4)),
      after,
    );
    assert.equal(machine.load(60), 0xce5852f0);
    assert.equal(machine.load(80), 0xce5852f0);
    assert.deepEqual(
      matrix.map((_, i) => machine.load(0x80000001 + i * 4)),
      matrix,
    );
  }
  const aliased = new MotionInstance(await readKCS(motionProgram([[37, [80, 64]]])), { profile });
  matrix.forEach((word, i) => aliased.machine.store(64 + i * 4, word));
  assert.equal(aliased.update(0).status, 'halted');
  assert.deepEqual(
    Array.from({ length: 4 }, (_, i) => aliased.machine.load(80 + i * 4)),
    Array(4).fill(floatBits(33554432)),
  );
});

test('2.6.1.67 motion GCALLs own a manager, identity matrix, flags, members and release', async (t) => {
  const world = await dataWorld(profile, {
    'motion-create.kcs': motionProgram([
      [207, [128]],
      [294, [], 80],
      [586, [0, 0xffffffff]],
      [586, [managerWord, flags]],
    ]),
    'motion-unlink.kcs': motionProgram([
      [297, [managerWord, motionWord]],
      [298, [managerWord, 0x81234abc]],
    ]),
    'motion-clear.kcs': motionProgram([
      [296, [0]],
      [296, [managerWord]],
    ]),
    'motion-release.kcs': motionProgram([
      [295, [0]],
      [295, [managerWord]],
    ]),
    'fixture.kcs': kcsProgram([[59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const execute = async (name, manager = 0, motion = 0) => {
    const task = await world.spawnScript(name, { initialExecute: false });
    const { machine } = task;
    const floor = machine.sp;
    machine.store(80, manager);
    machine.store(84, motion);
    machine.bytes(127, 66).fill(0x42);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0xa0263136);
    return task;
  };
  const created = await execute('motion-create.kcs');
  const { machine } = created;
  const identity = new DataView(
    machine.bytes(128, 64).buffer,
    machine.bytes(128, 64).byteOffset,
    64,
  );
  assert.deepEqual(
    Array.from({ length: 16 }, (_, i) => identity.getFloat32(i * 4, true)),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  );
  assert.equal(machine.load(127, 1), 0x42);
  assert.equal(machine.load(192, 1), 0x42);
  const handle = machine.load(80),
    record = world.runtime.handles.get(handle, 'motion-manager'),
    manager = record.manager,
    script = await manager.loadScript('fixture');
  assert.equal(record.owner, created.id);
  assert.equal(manager.flags, flags);
  const removed = manager.add(script, { group: 17, startTick: 1 });
  manager.add(script, { group: 0x81234abc, startTick: 1 });
  const remaining = manager.add(script, { group: 17, startTick: 1 });
  manager.update(1);
  await execute('motion-unlink.kcs', handle, removed);
  assert.deepEqual([...manager.records.keys()], [remaining]);
  await execute('motion-clear.kcs', handle);
  assert.equal(manager.records.size, 0);
  assert.equal(manager.flags, flags);
  await execute('motion-release.kcs', handle);
  assert.equal(world.runtime.handles.records.has(handle), false);
});

test('2.6.1.67 motion GCALLs transfer complete base and working register blocks', async (t) => {
  const blocks = [
      [128, 192, 3],
      [140, 204, 3],
      [152, 216, 3],
      [256, 448, 16],
      [164, 228, 3],
      [0, 240, 1],
      [176, 320, 3],
      [188, 336, 3],
      [0, 352, 1],
    ],
    incoming = (block, index) =>
      index === 5 || index === 8 ? 0xab582100 + index : [0x23, block[0]],
    inputs = blocks.map(incoming),
    outputs = blocks.map((block) => [0x23, block[1]]),
    world = await dataWorld(profile, {
      'set-base.kcs': motionProgram([
        [299, [0, ...inputs]],
        [299, [managerWord, ...inputs]],
      ]),
      'get-base.kcs': motionProgram([[300, [managerWord, ...outputs]]]),
      'set-working.kcs': motionProgram([[301, [managerWord, ...inputs]]]),
      'get-working.kcs': motionProgram([
        [302, [managerWord, ...outputs.slice(0, -1), 0xffffffff]],
        [302, [managerWord, ...outputs]],
      ]),
      'commit.kcs': motionProgram([
        [303, [managerWord]],
        [303, [0]],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const h = world.runtime.services.motion.create(world.main.id);
  const expected = (seed, index, length) =>
    Array.from({ length }, (_, word) =>
      index === 5 || index === 8 ? 0xab582100 + index : seed + index * 256 + word,
    );
  const execute = async (name, seed = null) => {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      { machine } = task,
      floor = machine.sp;
    machine.store(80, h);
    if (seed !== null)
      blocks.forEach(([address, , length], index) => {
        if (address)
          expected(seed, index, length).forEach((word, i) => machine.store(address + i * 4, word));
      });
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0xa0263136);
    return machine;
  };
  const check = (machine, seed) =>
    blocks.forEach(([, address, length], index) => {
      assert.deepEqual(
        expected(seed, index, length),
        Array.from({ length }, (_, i) => machine.load(address + i * 4)),
      );
    });
  await execute('set-base.kcs', 0xa1231000);
  await execute('set-working.kcs', 0xad2ed000);
  check(await execute('get-base.kcs'), 0xa1231000);
  check(await execute('get-working.kcs'), 0xad2ed000);
  await execute('commit.kcs');
  check(await execute('get-base.kcs'), 0xad2ed000);
});

test('2.6.1.67 motion checkpoints read a live adjacent frame and restore compact CSS entries', async (t) => {
  const file = [0x13, 88],
    world = await dataWorld(profile, {
      'create-checkpoint.kcs': motionProgram([
        [315, [managerWord], 84],
        [315, [0], 96],
      ]),
      'save-checkpoint.kcs': motionProgram([
        [316, [motionWord, 132], 96],
        [387, [file, 41, motionWord], 100],
        [387, [file, 42, 0], 104],
      ]),
      'load-checkpoint.kcs': motionProgram([
        [388, [file, 42, managerWord, 200], 96],
        [388, [file, 41, managerWord, 200], 100],
        [317, [motionWord]],
        [317, [0]],
      ]),
      'walk.kcs': kcsProgram([[59]]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const registry = world.runtime.services.motion,
    src = registry.create(world.main.id),
    dst = registry.create(world.main.id),
    manager = registry.get(src),
    script = await manager.loadScript('walk'),
    registerWords = Uint8Array.of(0x34, 0x12, 0xc0, 0x7f),
    extra = Uint8Array.of(1, 9, 7);
  manager.add(script, { registerWords, extra, group: 9, delay: 3, startTick: 100 });
  const nativeFile = await world.runtime.native('main', 238, [88], world.main.machine, world.main);
  const execute = async (name, manager, checkpoint = 0) => {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      { machine } = task,
      floor = machine.sp;
    machine.store(80, manager);
    machine.store(84, checkpoint);
    machine.store(88, nativeFile.value);
    machine.store(floor + 8, 125);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0xa0263136);
    return machine;
  };
  const created = await execute('create-checkpoint.kcs', src),
    checkpoint = created.load(84),
    original = world.runtime.handles.get(checkpoint, 'motion-checkpoint').bytes,
    view = new DataView(original.buffer);
  assert.equal(created.load(96), 0);
  assert.deepEqual(
    [0, 4, 8, 44, 48, 1072, 1076, 1080].map((at) => view.getUint32(at, true)),
    [1087, 1, 1079, 9, 0x7fc01234, 3, 25, 3],
  );
  assert.deepEqual([...original.subarray(1084)], [...extra]);
  const saved = await execute('save-checkpoint.kcs', src, checkpoint);
  assert.deepEqual(
    [96, 100, 104].map((at) => saved.load(at)),
    [1, 1, 0],
  );
  const packet = world.runtime.handles.get(nativeFile.value, 'global-file').read(41),
    [record] = decodeMotionRecords(packet, profile);
  assert.equal(record.name, 'walk.kcs');
  assert.equal(record.elapsed, 32);
  const loaded = await execute('load-checkpoint.kcs', dst, checkpoint);
  assert.equal(loaded.load(96), 0);
  const fresh = registry.get(dst),
    [motion] = fresh.records.values();
  assert.equal(motion.startTick, 168);
  assert.equal(motion.group, 9);
  assert.equal(motion.instance.delay, 3);
  assert.equal(world.runtime.handles.get(loaded.load(100), 'motion-checkpoint').owner, dst);
  assert.throws(() => world.runtime.handles.get(checkpoint, 'motion-checkpoint'), /released/);
});

test('2.6.1.67 motion playback retains unsigned timing, shift, raw active words and skip selection', async (t) => {
  const secondWord = [0x13, 88],
    play = (speed, frame, defer = 0) => [
      [308, [managerWord, speed]],
      [307, [managerWord, frame, defer], 96],
    ],
    world = await dataWorld(profile, {
      'defer.kcs': motionProgram(play(0x3fc00000, 100, 1)),
      'start.kcs': motionProgram([
        [305, [managerWord, 0, 100]],
        [305, [managerWord, secondWord, 102]],
        [312, [managerWord, motionWord]],
        ...play(0x3fc00000, 103),
      ]),
      'update.kcs': motionProgram(play(0x3fc00000, 104)),
      'query.kcs': motionProgram([
        [309, [managerWord, motionWord], 96],
        [309, [managerWord, 0], 100],
        [310, [managerWord, 17], 104],
        [310, [managerWord, 99], 108],
        [311, [managerWord], 112],
        [311, [0], 116],
      ]),
      'group.kcs': motionProgram([[313, [managerWord, 23]]]),
      'all.kcs': motionProgram([[314, [managerWord]]]),
      'finish.kcs': motionProgram([[440, [managerWord], 96]]),
      'last-frame.kcs': motionProgram(play(0x33800000, 0xffffffff, 1)),
      'motion.kcs': kcsProgram([
        [21, [0x13, 0x80000000 + MOTION_ABI.pos], [0x13, 0x80000000 + MOTION_ABI.frame]],
        [21, [0x13, 0x80000000 + MOTION_ABI.active], 0x81366521],
        [59],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const registry = world.runtime.services.motion,
    h = registry.create(world.main.id),
    manager = registry.get(h),
    script = await manager.loadScript('motion'),
    first = manager.add(script, { group: 17, delay: 6 }),
    second = manager.add(script, { group: 23 }),
    firstRecord = manager.records.get(first),
    secondRecord = manager.records.get(second),
    execute = async (name) => {
      const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
        { machine } = task,
        floor = machine.sp;
      machine.store(80, h);
      machine.store(84, first);
      machine.store(88, second);
      await world.runtime.scheduler.execute(task);
      assert.equal(machine.sp, floor + 4);
      assert.equal(machine.load(floor), 0xa0263136);
      return machine;
    };
  assert.equal((await execute('defer.kcs')).load(96), 0);
  assert.equal(firstRecord.startTick, 0);
  assert.equal(manager.speed, 1.5);
  assert.equal((await execute('start.kcs')).load(96), 1);
  assert.deepEqual(
    [firstRecord, secondRecord].map((record) => [
      record.startTick,
      record.instance.frame,
      record.instance.skip,
    ]),
    [
      [100, 0, true],
      [102, 2, false],
    ],
  );
  assert.equal(firstRecord.instance.activeWord, 1);
  await execute('update.kcs');
  const query = await execute('query.kcs');
  assert.deepEqual(
    [96, 100, 104, 108, 112, 116].map((at) => query.load(at)),
    [0x81366521, 0, 1, 0, 1, 0],
  );
  await execute('group.kcs');
  assert.equal(secondRecord.instance.skip, true);
  const third = manager.records.get(manager.add(script, { group: 99 }));
  await execute('all.kcs');
  assert.equal(third.instance.skip, true);
  assert.equal((await execute('last-frame.kcs')).load(96), 1);
  assert.equal(third.startTick, 0);
  assert.equal(third.instance.frame, 256);
  assert.equal((await execute('finish.kcs')).load(96), 1);
  assert.equal(new DataView(manager.working.buffer).getUint32(MOTION_ABI.pos, true), 0xffffffff);
  assert.equal(third.instance.frame, 256);
  assert.equal(third.instance.activeWord, 0x81366521);
  manager.clear();
  assert.equal((await execute('finish.kcs')).load(96), 0);
});

// Full original Main GCALL words, including hardware-range and live-stack cases.
const originalMatrixCalls = [
  {
    id: 204,
    label: 'raw angle 0 5f000000',
    args: [64, 1593835520, 0, 0],
    initialize: [
      [64, 1067953684],
      [68, 1043207291],
      [72, 3205639438],
      [76, 1034147594],
      [80, 1050589266],
      [84, 1064011039],
      [88, 3194180600],
      [92, 1067215487],
      [96, 3213122077],
      [100, 1060320051],
      [104, 3221644902],
      [108, 1065940419],
      [112, 3246981120],
      [116, 1090781184],
      [120, 1100538184],
      [124, 1059900621],
    ],
    expected: [
      2143289344, 2143289344, 2143289344, 2143289344, 2143289344, 2143289344, 2143289344,
      2143289344, 2143289344, 2143289344, 2143289344, 2143289344, 2143289344, 2143289344,
      2143289344, 2143289344,
    ],
  },
  {
    id: 662,
    label: 'raw angle 0 7fc12f00',
    args: [64, 2143366912, 0, 0],
    initialize: [
      [64, 1067953684],
      [68, 1043207291],
      [72, 3205639438],
      [76, 1034147594],
      [80, 1050589266],
      [84, 1064011039],
      [88, 3194180600],
      [92, 1067215487],
      [96, 3213122077],
      [100, 1060320051],
      [104, 3221644902],
      [108, 1065940419],
      [112, 3246981120],
      [116, 1090781184],
      [120, 1100538184],
      [124, 1059900621],
    ],
    expected: [
      2143366912, 2143366912, 2143366912, 0, 2143366912, 2143366912, 2143366912, 0, 2143366912,
      2143366912, 2143366912, 0, 0, 0, 0, 1065353216,
    ],
  },
  {
    id: 205,
    label: 'fallback matrix ffffffff',
    args: [4294967295, 1050673152, 3221225472, 1063256064],
    initialize: [
      [4294967040, 1067953684],
      [4294967044, 1043207291],
      [4294967048, 3205639438],
      [4294967052, 1034147594],
      [4294967056, 1050589266],
      [4294967060, 1064011039],
      [4294967064, 3194180600],
      [4294967068, 1067215487],
      [4294967072, 3213122077],
      [4294967076, 1060320051],
      [4294967080, 3221644902],
      [4294967084, 1065940419],
      [4294967088, 3246981120],
      [4294967092, 1090781184],
      [4294967096, 1100538184],
      [4294967100, 1059900621],
    ],
    expected: [
      1068163399, 1008981776, 3204465033, 1034147594, 1060183736, 3217232494, 1062790496,
      1067215487, 3207797408, 3216527852, 3214210498, 1065940419, 3246870528, 1088212173,
      1100847842, 1059900621,
    ],
  },
  {
    id: 206,
    label: 'raw parameter 1',
    args: [64, 1, 1, 1],
    initialize: [
      [64, 1067953684],
      [68, 1043207291],
      [72, 3205639438],
      [76, 1034147594],
      [80, 1050589266],
      [84, 1064011039],
      [88, 3194180600],
      [92, 1067215487],
      [96, 3213122077],
      [100, 1060320051],
      [104, 3221644902],
      [108, 1065940419],
      [112, 3246981120],
      [116, 1090781184],
      [120, 1100538184],
      [124, 1059900621],
    ],
    expected: [
      1, 0, 2147483649, 1034147594, 0, 1, 0, 1067215487, 2147483649, 1, 2147483650, 1065940419,
      2147483665, 8, 19, 1059900621,
    ],
  },
  {
    id: 204,
    label: 'rotation destination aliases live GCALL arguments',
    args: [788, 1050673152, 3199649972, 1035489772],
    initialize: [
      [788, 788],
      [792, 1050673152],
      [796, 3199649972],
      [800, 1035489772],
      [804, 1050589266],
      [808, 1064011039],
      [812, 3194180600],
      [816, 1067215487],
      [820, 3213122077],
      [824, 1060320051],
      [828, 3221644902],
      [832, 1065940419],
      [836, 3246981120],
      [840, 1090781184],
      [844, 1100538184],
      [848, 1059900621],
    ],
    expected: [
      1018413712, 1053970049, 3195149655, 1035489772, 1045060051, 1064772081, 1041480104,
      1067215487, 3207617487, 1067491304, 3221056530, 1065940419, 3249383841, 1019687424,
      1098884362, 1059900621,
    ],
  },
];

test('2.6.1.67 Main matrix calls retain original raw words and live argument aliases', async (t) => {
  const files = Object.fromEntries(
    originalMatrixCalls.map((row, index) => {
      const program = motionProgram([[row.id, row.args]]);
      if (row.label.includes('aliases')) new DataView(program.buffer).setUint32(32, 784, true);
      return [`matrix-${index}.kcs`, program];
    }),
  );
  const world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  for (const [index, row] of originalMatrixCalls.entries()) {
    const task = await world.spawnScript(`matrix-${index}.kcs`, { initialExecute: false }),
      m = task.machine,
      floor = m.sp,
      current = new DataView(world.calculations.matrix.buffer);
    for (const [at, word] of row.initialize)
      if (at >= 0xffffff00) current.setUint32(at & 255, word, true);
      else m.store(at, word);
    await world.runtime.scheduler.execute(task);
    assert.equal(m.sp, floor + 4);
    assert.equal(m.pop(), 0xa0263136);
    assert.deepEqual(
      row.expected.map((_, i) =>
        row.args[0] === 0xffffffff ? current.getUint32(i * 4, true) : m.load(row.args[0] + i * 4),
      ),
      row.expected,
      row.label,
    );
  }
});

test('2.6.1.67 zero-word Motion XYZ rotation reads the live mapped stack after each axis', async () => {
  const program = kcsProgram([[43, 23, 0], [59]]);
  new DataView(program.buffer).setUint32(32, 788, true);
  const instance = new MotionInstance(await readKCS(program), { profile }),
    m = instance.machine,
    words = [
      788, 0x3ea00000, 0xbeb6c8b4, 0x3db851ec, 0x3e9eb852, 0x3f6b851f, 0xbe6353f8, 0x3f9c6a7f,
      0xbf845a1d, 0x3f333333, 0xc0066666, 0x3f88f5c3, 0xc1890000, 0x41040000, 0x4198e148,
      0x3f2ccccd,
    ];
  words.forEach((word, i) => m.store(788 + i * 4, word));
  m.store(784, 0x36eb67a5);
  assert.equal(instance.run().status, 'halted');
  assert.equal(m.sp, 788);
  assert.equal(m.load(784), 0x36eb67a5);
  assert.deepEqual(
    words.map((_, i) => m.load(788 + i * 4)),
    [
      0x3cb3c290, 0x3ed24e81, 0xbe721d57, 0x3db851ec, 0x3e4a59d3, 0x3f7721f1, 0x3e13b9a8,
      0x3f9c6a7f, 0xbf305bcf, 0x3fa09fe8, 0xbffd6c12, 0x3f88f5c3, 0xc1ada9a1, 0x3cc73200,
      0x417fa50a, 0x3f2ccccd,
    ],
  );
});
