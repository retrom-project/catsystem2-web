// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { readKCS, floatBits } from '../src/kcs.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const caller = 'sdk-call.kcs';
const sentinel = 0xe8a7b319;

async function guest(code, { services = {}, initial = () => {} } = {}) {
  const bytes = kcsProgram([[37, sentinel], ...code, [59]]);
  const runtime = new NativeRuntime({ profile, read: async () => bytes, services });
  const task = await runtime.spawn(caller);
  initial(task.machine);
  return { task, runtime };
}

async function result(code, options) {
  const { task, runtime } = await guest(code, options);
  await runtime.tick();
  const { machine } = task;
  assert.equal(task.status, 'finished');
  assert.equal(machine.sp, machine.floor + 8, 'control 1 pushes exactly one word');
  const value = machine.pop();
  assert.equal(machine.pop(), sentinel);
  return value;
}

test('fixed 2.6.1.23 clock wrapper returns the current DWORD and handles rollover', async () => {
  const entry = nativeABI(profile).tables.main.entries[4];
  assert.equal(entry.signature.argumentWords, 0);
  assert.equal(entry.signature.resultWritten, true);
  let now = 0xfffffff0;
  const clock = new NativeSystemClock({ now: () => now });
  const services = { clock: () => clock.now() };
  assert.equal(await result([[43, 4, 0]], { services }), 0xfffffff0);
  now = 0x23;
  assert.equal(await result([[43, 4, 0]], { services }), 0x23);
});

test('fixed 2.6.1.23 integer parser consumes a CP932 format string from the guest frame', async () => {
  const entry = nativeABI(profile).tables.main.entries[25];
  assert.equal(entry.signature.argumentWords, 1);
  assert.equal(entry.signature.resultWritten, true);
  assert.deepEqual(entry.parameters[0].type, {
    addressSpace: 'vm',
    direction: 'in',
    kind: 'pointer',
    target: { kind: 'format-string', encoding: 'CP932' },
  });
  const cases = [
    ['-0xabcDtail', 0xffff5433],
    ['0X80invalid', 128],
    ['42.5', 0],
    [' 7', 0],
    ['4294967297', 1],
    ['0xFFFFFFFF', 0xffffffff],
    ['-2147483648', 0x80000000],
    ['+106;', 106],
    ['12日', 12],
    ['１２', 0],
    ['1e3', 1],
  ];
  for (const [text, word] of cases)
    assert.equal(
      await result(
        [
          [61, 256],
          [43, 25, 4],
        ],
        {
          initial: (machine) => machine.writeString(text, machine.fp + 256),
        },
      ),
      word,
      text,
    );
  assert.equal(
    await result(
      [
        [61, 256],
        [43, 25, 4],
      ],
      {
        initial: (machine) => {
          machine.store(128, 9);
          machine.writeString('-%d[G128]', machine.fp + 256);
        },
      },
    ),
    0xfffffff7,
  );
});

test('fixed 2.6.1.23 weekday uses signed century arithmetic from three guest words', async () => {
  const entry = nativeABI(profile).tables.main.entries[786];
  assert.equal(entry.signature.argumentWords, 3);
  assert.equal(entry.signature.resultWritten, true);
  const cases = [
    [2000, 2, 29, 2],
    [1900, 3, 1, -3],
    [2026, 11, 24, 2],
    [-1, 1, 1, 6],
    [0, 1, 1, 0],
    [-444, 11, 0, -4],
    [99999999, 1, 1, -2],
    [1, -1, -20, 3],
    [0x7fffffff, 0x7fffffff, 0x7fffffff, 5],
    [-0x80000000, -0x80000000, -0x80000000, 5],
  ];
  for (const [year, month, day, word] of cases)
    assert.equal(
      await result([...[64, 68, 72].map((address) => [37, [0x13, address]]), [43, 786, 12]], {
        initial: (machine) => {
          machine.store(64, year);
          machine.store(68, month);
          machine.store(72, day);
        },
      }),
      word >>> 0,
      [year, month, day].join('/'),
    );
});

test('fixed 2.6.1.23 clock, integer and weekday check arity and mapped string addresses', async () => {
  const cases = [
    [4, [0], /expects 0 arguments/],
    [25, [], /expects 1 arguments/],
    [25, [0xffffffff], /KCS memory ffffffff/],
    [786, [2026, 11], /expects year, month and day/],
  ];
  for (const [id, args, error] of cases) {
    const { runtime, task } = await guest([
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
    ]);
    await assert.rejects(runtime.tick(), error);
    assert.equal(task.status, 'failed');
    assert.equal(task.machine.sp, task.machine.floor + 4);
    assert.equal(task.machine.pop(), sentinel);
  }
});

const call = (id, args) => [...args.map((arg) => [37, arg]), [43, id, args.length * 4]];
const storeResult = (address) => [38, [0x13, address]];

function renderWorld() {
  const game = memoryGame({}),
    random = new ParticleRandom();
  return new NativeWorld({
    profile,
    game,
    random,
    host: {},
    images: {},
    configuration: new NativeConfiguration({ profile }),
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true },
  });
}

async function runRenderGuest(world, source, setup) {
  const program = await readKCS(kcsProgram([[37, sentinel], ...source, [59]]));
  const task = world.runtime.scheduler.add(program, {
    name: 'sdk-bitmap.kcs',
    abi: 'main',
  });
  setup?.(task);
  for (let frame = 0; frame < 20 && task.status !== 'finished'; frame++) await world.runtime.tick();
  assert.equal(task.status, 'finished');
  assert.equal(task.machine.sp, task.machine.floor + 4);
  assert.equal(task.machine.pop(), sentinel);
  return task;
}

test('fixed 2.6.1.23 owned bitmap helpers preserve sizes, offsets and RGBA through the VM', async () => {
  const world = renderWorld(),
    handle = [0x13, 512],
    task = await runRenderGuest(
      world,
      [
        ...call(112, [2, 1]),
        storeResult(512),
        ...call(117, [handle, 0, 0, 2, 1, 0xad997f63]),
        ...call(119, [handle, 520, 524]),
        ...call(372, [handle, 40, 30]),
        storeResult(528),
        ...call(373, [handle, -9, 12]),
        storeResult(532),
        ...call(363, [handle, 536, 540]),
        ...call(119, [handle, 544, 544]),
        ...call(369, [handle, 0x7f69ebac]),
        ...call(119, [0, 548, 552]),
        ...call(363, [0, 556, 560]),
        ...call(372, [0, 40, 30]),
        storeResult(564),
        ...call(373, [0, 1, 1]),
        storeResult(568),
        ...call(369, [0, 0]),
      ],
      ({ machine }) => machine.bytes(520, 52).fill(0xab),
    );
  const { machine } = task;
  assert.deepEqual(
    Array.from({ length: 13 }, (_, n) => machine.load(520 + n * 4)),
    [2, 1, 1, 1, 0xfffffff7, 12, 1, 0, 0, 0, 0, 0, 0],
  );
  const bitmap = world.graphics.images.get(machine.load(512));
  assert.deepEqual([bitmap.state.canvasWidth, bitmap.state.canvasHeight], [40, 30]);
  assert.deepEqual([...(await bitmap.pixels())], [63, 117, 66, 86, 63, 117, 66, 86]);
  const table = nativeABI(profile).tables.main.entries;
  for (const [id, count, resultWritten] of [
    [119, 3, false],
    [363, 3, false],
    [369, 2, false],
    [372, 3, true],
    [373, 3, true],
  ])
    assert.deepEqual(
      [table[id].signature.argumentWords, table[id].signature.resultWritten],
      [count, resultWritten],
    );
});

test('fixed 2.6.1.23 image owners update independent geometry and preserve null and empty-owner returns', async () => {
  const world = renderWorld(),
    handle = [0x13, 512],
    emptyOwner = [0x13, 516],
    task = await runRenderGuest(
      world,
      [
        ...call(733, [3, 2]),
        storeResult(512),
        ...call(718, [handle, 50, 33]),
        storeResult(544),
        ...call(719, [handle, -24, 22]),
        storeResult(548),
        ...call(720, [handle, -5, 6]),
        storeResult(552),
        ...call(718, [0, -1, -2]),
        storeResult(556),
        ...call(719, [emptyOwner, 14, 15]),
        storeResult(560),
        ...call(720, [0, -1, -2]),
        storeResult(564),
        ...call(712, [handle, 568, 572]),
        ...call(714, [handle, 576, 580]),
        ...call(715, [handle, 584, 588]),
      ],
      (task) => task.machine.store(516, world.imageOwners.add(0, task.id, [])),
    );
  const { machine } = task,
    record = world.imageOwners.get(machine.load(512)),
    bitmap = world.graphics.images.get(record.bitmap);
  assert.deepEqual([bitmap.state.baseX, bitmap.state.baseY], [-5, 6]);
  assert.deepEqual(
    Array.from({ length: 12 }, (_, n) => machine.load(544 + n * 4)),
    [1, 1, 1, 1, 0, 1, 3, 2, 50, 33, 0xffffffe8, 22],
  );
  const table = nativeABI(profile).tables.main.entries;
  for (const id of [718, 719, 720])
    assert.deepEqual(
      [table[id].signature.argumentWords, table[id].signature.resultWritten],
      [3, true],
    );
});

test('fixed 2.6.1.23 bitmap queries reject unmapped outputs and image ownership mismatch', async () => {
  const world = renderWorld();
  await assert.rejects(
    runRenderGuest(world, call(119, [0, 0xffffffff, 128])),
    /KCS memory ffffffff/,
  );
  const bitmap = world.graphics.images.create(1, 1, 2);
  await assert.rejects(runRenderGuest(world, call(718, [bitmap, 10, 20])), /image-owner/);
  assert.deepEqual(
    [world.graphics.images.get(bitmap).width, world.graphics.images.get(bitmap).height],
    [1, 1],
  );
});

test('fixed 2.6.1.23 Main, Motion and both Particle tables share the original integer stream', async () => {
  const random = new ParticleRandom(4357);
  assert.equal(await result([[43, 33, 0]], { services: { random } }), 0xaae64ac3);
  const motion = new MotionInstance(await readKCS(kcsProgram([[43, 39, 0], [59]])), {
    profile,
    random,
  });
  motion.run();
  assert.equal(motion.machine.pop(), 0x5e7c47da);
  for (const [version, expected] of [
    [0x10000, 0xb98e8121],
    [0x20000, 0xb010f327],
  ]) {
    const p = await randomParticle(version, random, [[43, 33, 0]]);
    p.update(0);
    assert.equal(p.machine.pop(), expected);
  }
  assert.equal(random.integer.index, 4);
  assert.equal(random.real.index, 624);
});

async function randomParticle(scriptVersion, random, code) {
  const bytes = kcsProgram([...code, [59]]);
  new DataView(bytes.buffer).setUint16(8, scriptVersion >>> 16, true);
  const script = await readKCS(bytes);
  return new ParticleScriptInstance(script, {
    profile,
    random,
    count: 1,
    width: 8,
    height: 8,
    screenWidth: 64,
    screenHeight: 48,
  });
}

test('fixed 2.6.1.23 real GCALLs apply x87 high-word rounding without consuming the integer stream', async () => {
  const random = new ParticleRandom(4357);
  random.real.nextUint32();
  const before = random.snapshot();
  const expected = 0x3f27383a;
  const restore = () => {
    random.restore(before);
    random.real.index = 192;
  };
  restore();
  assert.equal(await result([[43, 34, 0]], { services: { random } }), expected);
  restore();
  const motion = new MotionInstance(await readKCS(kcsProgram([[43, 40, 0], [59]])), {
    profile,
    random,
  });
  motion.run();
  assert.equal(motion.machine.pop(), expected);
  for (const version of [0x10000, 0x20000]) {
    restore();
    const p = await randomParticle(version, random, [[43, 34, 0]]);
    p.update(0);
    assert.equal(p.machine.pop(), expected);
    assert.equal(random.real.index, 193);
    const wrongWidth = await randomParticle(version, random, [
      [37, sentinel],
      [43, 34, 4],
    ]);
    assert.throws(() => wrongWidth.update(0), /requires 0 arguments/);
    assert.equal(random.real.index, 193);
  }
  assert.deepEqual(random.integer.snapshot(), before.integer);
  restore();
  assert.equal(
    floatBits(random.frand()),
    0x3f27383b,
    'default random conversion preserves its original result',
  );
});
