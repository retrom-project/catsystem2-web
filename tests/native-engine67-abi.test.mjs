// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCP932, floatBits, readKCS } from '../src/kcs.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67';

async function run(instructions, diagnostic) {
  const runtime = new NativeRuntime({
    profile,
    read: async () => kcsProgram(instructions),
    services: { diagnostic },
  });
  const task = await runtime.spawn('abi-probe.kcs');
  return { runtime, task, machine: task.machine };
}

test('2.6.1.67 Main stubs preserve their original three result behaviors', async () => {
  const table = nativeABI(profile).tables.main.entries;
  const noops = table.filter((entry) => entry.status === 'reserved');
  const zeros = table.filter((entry) => entry.status === 'constant-zero');
  const unwritten = [140, 142, 549].map((id) => table[id]);
  assert.equal(noops.length, 80);
  assert.equal(zeros.length, 19);
  const cases = [...noops, ...zeros, ...unwritten];
  const markerAddress = (index) => 512 + index * 4;
  const resultAddress = (index) => 1024 + index * 4;
  const marker = 0x82345678;

  // The fixed scripts exercise ignored calls with zero to seven argument words.
  for (let words = 0; words <= 7; words++) {
    const instructions = cases.flatMap((entry, index) => [
      [37, marker],
      ...Array.from({ length: words }, (_, word) => [37, 0xffa0b000 + word]),
      [43, entry.id, words * 4],
      ...(entry.status === 'reserved' ? [] : [[38, resultAddress(index)]]),
      [38, markerAddress(index)],
    ]);
    const diagnostics = [];
    const { runtime, task, machine } = await run([...instructions, [59]], (event) =>
      diagnostics.push(event),
    );
    machine.bytes(1024, cases.length * 4).fill(0xa5);
    machine.store(508, 0x3b46d32d);
    const stack = machine.sp;
    await runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, stack);
    assert.equal(machine.load(508), 0x3b46d32d);
    for (const [index, entry] of cases.entries()) {
      const noResult = entry.status === 'reserved';
      const zero = entry.status === 'constant-zero';
      assert.equal(runtime.calls.get(`main:${entry.id}`), 1);
      assert.equal(entry.signature.argumentWords, null);
      assert.equal(entry.signature.parameters.kind, 'ignored');
      assert.equal(entry.signature.resultWritten, zero);
      assert.deepEqual(entry.controlCodes, noResult ? [2] : [1]);
      assert.equal(machine.load(markerAddress(index)), marker);
      assert.equal(
        machine.load(resultAddress(index)),
        noResult ? 0xa5a5a5a5 : zero ? 0 : NATIVE_RESULT_SENTINEL,
      );
    }
    assert.equal(diagnostics.length, 3);
    assert.ok(diagnostics.every((event) => event.type === 'native-result-sentinel'));
  }
});

test('2.6.1.67 GCALL still rejects the adjacent unreviewed native slot', async () => {
  const { runtime, task } = await run([[37, 17], [37, 18], [37, 19], [43, 935, 12], [59]]);
  await assert.rejects(
    () => runtime.scheduler.execute(task),
    (error) => {
      assert.ok(error instanceof UnsupportedKCSNative);
      assert.equal(error.details.profile, profile);
      assert.equal(error.details.table, 'main');
      assert.equal(error.details.id, 935);
      assert.deepEqual(error.details.args, [17, 18, 19]);
      return true;
    },
  );
});

const scalarCases = [
  { ids: [50, 1, 6], args: [0x3f000000], result: 0x3ef57744 },
  { ids: [50, 1, 6], args: [0x80000000], result: 0x80000000 },
  { ids: [50, 1, 6], args: [0xff852038], result: 0xffc52038 },
  { ids: [51, 2, 7], args: [0x3f000000], result: 0x3f60a940 },
  { ids: [51, 2, 7], args: [0x7f800000], result: 0xffc00000 },
  { ids: [52, 3, 8], args: [0x3f000000], result: 0x3f0bda7b },
  { ids: [52, 3, 8], args: [0x80000000], result: 0x80000000 },
  { ids: [53, 4, 9], args: [0x3f000000], result: 0x3f060a92 },
  { ids: [53, 4, 9], args: [0x40000000], result: 0xffc00000 },
  { ids: [54, 5, 10], args: [0x3f000000], result: 0x3f860a92 },
  { ids: [54, 5, 10], args: [0xbf800000], result: 0x40490fdb },
  { ids: [55, 6, 11], args: [0x3f000000], result: 0x3eed6338 },
  { ids: [55, 6, 11], args: [0xff800000], result: 0xbfc90fdb },
  { ids: [57, 9, 14], args: [0x80000000], result: 0 },
  { ids: [57, 9, 14], args: [0xff812345], result: 0x7fc12345 },
  { ids: [62, 14, 19], args: [floatBits(180)], result: 0x40490fdb },
  { ids: [62, 14, 19], args: [0x7f7fffff], result: 0x7c8efa35 },
  { ids: [63, 15, 20], args: [0x7bbb3ee6], result: 0x7ea7a18e },
  { ids: [63, 15, 20], args: [0x80000000], result: 0x80000000 },
  { ids: [64, 16, 21], args: [0xffffffe3], result: 29 },
  { ids: [64, 16, 21], args: [0x80000000], result: 0x80000000 },
  { ids: [318, 41, 41], args: [10, 20, 0, 4, 2].map(floatBits), result: 0x41700000 },
  { ids: [318, 41, 41], args: [-0, 20, 0, 4, -1].map(floatBits), result: 0x80000000 },
  { ids: [318, 41, 41], args: [10, 20, 0, 4, 4].map(floatBits), result: 0x41a00000 },
  { ids: [319, 17, 42], args: [floatBits(4294967808)], result: 512 },
  { ids: [319, 17, 42], args: [floatBits(-1.5)], result: 0xffffffff },
  { ids: [319, 17, 42], args: [floatBits(2 ** 63)], result: 0 },
];

function scalarProgram(column) {
  return [
    [37, 0x82345678],
    ...scalarCases.flatMap(({ ids, args }) => [
      ...args.map((word) => [37, word]),
      [43, ids[column], args.length * 4],
    ]),
    [59],
  ];
}

function assertScalarOutput(machine) {
  const expected = [0x82345678, ...scalarCases.map(({ result }) => result)];
  const offset = machine.sp - expected.length * 4;
  assert.deepEqual(
    expected.map((_, index) => machine.load(offset + index * 4)),
    expected,
  );
}

test('2.6.1.67 Main scalar GCALLs write the original x87 and integer words', async (t) => {
  const world = await dataWorld(profile, { 'case.kcs': kcsProgram(scalarProgram(0)) });
  t.after(() => world.close({ flushFiles: false }));
  assertScalarOutput(world.main.machine);
});

for (const [table, version, column] of [
  ['generic', 0, 1],
  ['particle-v1', 1, 2],
  ['particle-v2', 2, 2],
]) {
  test(`2.6.1.67 ${table} scalar GCALLs use the original conversion and rounding words`, async () => {
    const bytes = kcsProgram(scalarProgram(column));
    new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, version, true);
    const script = await readKCS(bytes);
    const instance =
      version === 0
        ? new MotionInstance(script, { profile })
        : new ParticleScriptInstance(script, {
            profile,
            count: 1,
            width: 16,
            height: 16,
            screenWidth: 1280,
            screenHeight: 720,
          });
    if (version) assert.equal(instance.table, table);
    instance.update(19);
    assertScalarOutput(instance.machine);
  });
}

test('2.6.1.67 copies an opaque word and yields for one guest frame', async () => {
  const { runtime, task, machine } = await run([
    [37, 0xf31c5ba9],
    [43, 6, 4],
    [43, 65, 0],
    [37, 0xe6a8b101],
    [59],
  ]);
  const floor = machine.sp;
  await runtime.scheduler.execute(task);
  assert.equal(task.status, 'yielded');
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xf31c5ba9);
  await runtime.tick();
  assert.equal(task.status, 'finished');
  assert.equal(machine.sp, floor + 8);
  assert.equal(machine.load(floor + 4), 0xe6a8b101);
});

test('2.6.1.67 Script load GCALL binds shared memory and only suspends for immediate execution', async (t) => {
  const child = [0x13, 80],
    parentProgram = (runNow) =>
      kcsProgram(
        [[37, child], [37, 160], [37, runNow], [43, 143, 12], [37, 0xa134bd12], [38, 96], [59]],
        [[160, 'child.kcs']],
      ),
    world = await dataWorld(profile, {
      'deferred.kcs': parentProgram(0),
      'immediate.kcs': parentProgram(1),
      'child.kcs': kcsProgram([[37, 0x9123456a], [38, 96], [59]]),
    });
  t.after(() => world.close({ flushFiles: false }));
  for (const [name, immediate] of [
    ['deferred.kcs', false],
    ['immediate.kcs', true],
  ]) {
    const caller = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      id = await world.objects.create({ kind: 12, parent: caller.id }),
      marker = 0x8721d6aa;
    caller.machine.store(80, world.nativeTaskID(id));
    caller.machine.store(96, marker);
    caller.machine.store(0x80000030, 0xc33b9100);
    const floor = caller.machine.sp;
    await world.runtime.scheduler.execute(caller);
    assert.equal(caller.machine.sp, floor);
    const target = world.runtime.scheduler.tasks.get(id);
    assert.equal(target.name, 'child.kcs');
    assert.equal(target.machine.load(0x80000030), 0xc33b9100);
    assert.equal(target.machine.halted, immediate);
    assert.equal(target.machine.load(96), immediate ? 0x9123456a : 0);
    assert.equal(caller.machine.load(96), immediate ? marker : 0xa134bd12);
    assert.equal(caller.status, immediate ? 'yielded' : 'finished');
    if (immediate) {
      await world.runtime.tick();
      assert.equal(caller.machine.load(96), 0xa134bd12);
    }
  }
});

test('2.6.1.67 existing MOT triangle GCALL follows the four ordered x87 quarters', async () => {
  const args = [
    [0, 0],
    [1, 0x3f000000],
    [3, 0x3f000000],
    [4, 0x80000000],
    [6, 0xbf800000],
    [8, 0],
  ];
  const script = await readKCS(
    kcsProgram([
      ...args.flatMap(([phase]) => [
        [37, floatBits(phase)],
        [37, floatBits(8)],
        [43, 42, 8],
      ]),
      [59],
    ]),
  );
  const motion = new MotionInstance(script, { profile });
  const floor = motion.machine.sp;
  motion.update(19);
  assert.equal(motion.machine.sp, floor + args.length * 4);
  assert.deepEqual(
    args.map((_, index) => motion.machine.load(floor + index * 4)),
    args.map(([, result]) => result),
  );
});

const scriptInputPackets = [
  [4, 0xffff0001, 0xb11e, 0xc77e, NATIVE_UNWRITTEN_WORD],
  [9, 0xffff0003, 0xb11e, 0xc77e, 0],
  [10, 0xffff0004, 0xb11e, 0xc77e, 0],
  [18, 0xffff0016, 0, 0, NATIVE_UNWRITTEN_WORD],
  [22, 0xffff0014, 0, 0xc77e, 1],
  [64, 0xffff0005, 0xb11e, 0xc77e, NATIVE_UNWRITTEN_WORD],
  [65, 0xffff0017, 0xb11e, 0xc77e, 1],
  [446, 0xffff0015, 0, 0xc77e, NATIVE_UNWRITTEN_WORD],
];

test('2.6.1.67 Script receives exact live input packets and keeps unhandled base messages out', async (t) => {
  const queued = [19, 20, 21];
  const program = kcsProgram([
    ...[...scriptInputPackets, ...queued].flatMap((_, index) => [
      [37, 512 + index * 16],
      [43, 71, 4],
    ]),
    [59],
  ]);
  const world = await dataWorld(profile, { 'case.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const task = world.main;
  const sender = await world.objects.create({ kind: 2, parent: task.id });
  const source = world.nativeTaskID(sender);
  for (const raw of [30, 31]) {
    const reply = await world.engineMessages.dispatch(task.id, sender, raw, 0xb11e, 0xc77e);
    assert.equal(reply.handled, false);
    assert.equal(reply.result, NATIVE_UNWRITTEN_WORD);
    assert.equal(task.machine.waiting?.address, 512);
  }
  for (const [index, [id, code, w, l, result]] of scriptInputPackets.entries()) {
    const start = 512 + index * 16;
    const reply = await world.engineMessages.dispatch(task.id, sender, id, 0xb11e, 0xc77e);
    assert.equal(reply.handled, true);
    assert.equal(reply.result, result);
    assert.deepEqual(
      Array.from({ length: 4 }, (_, word) => task.machine.load(start + word * 4)),
      [id === 18 ? 0xffffffff : source, code, w, l],
    );
  }
  for (const id of queued) {
    const reply = await world.engineMessages.dispatch(task.id, sender, id, 0xb11e, 0xc77e);
    assert.deepEqual(reply, { routed: true, handled: true, result: 1 });
  }
  const expected = queued.map((_, index) => [source, 0xffff0011 + index, 0, 0]);
  assert.deepEqual(task.messages, expected);
  assert.equal(task.machine.waiting?.address, 512 + scriptInputPackets.length * 16);
  await world.tick();
  assert.deepEqual(task.messages, []);
  for (const [index, packet] of expected.entries()) {
    const start = 512 + (scriptInputPackets.length + index) * 16;
    assert.deepEqual(
      Array.from({ length: 4 }, (_, word) => task.machine.load(start + word * 4)),
      packet,
    );
  }
  assert.equal(task.status, 'finished');
});

test('2.6.1.67 Plane input GCALLs update the active region, latch and receiver', async (t) => {
  const plane1 = [0x13, 80];
  const plane2 = [0x13, 84];
  const receiver = [0x13, 88];
  const calls = [
    [79, [plane1, floatBits(4), floatBits(3), 0xffffffff]],
    [79, [plane2, floatBits(4), floatBits(3), 0xffffffff]],
    [104, [plane1, 0, 0, 4, 3, 23, 0]],
    [104, [plane2, 0, 0, 4, 3, 23, 0]],
    [105, [plane1, 1]],
    [105, [plane2, 1]],
    [106, [plane2, 1]],
    [106, [plane1, 0x80000021]],
    [108, [plane1, 0x81200305]],
    [110, [plane1, receiver]],
  ];
  const program = kcsProgram([
    [37, 0xf217d9e3],
    ...calls.flatMap(([id, args]) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
    ]),
    [59],
  ]);
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'plane-input.kcs': program,
  });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id;
  const caller = await world.objects.create({ kind: 12, parent });
  const script = world.objects.objects.get(caller).implementation;
  const first = await world.objects.create({ kind: 2, parent: caller });
  const second = await world.objects.create({ kind: 2, parent: caller });
  const destination = await world.objects.create({ kind: 12, parent });
  await script.loadScript('plane-input.kcs');
  const { task } = script;
  const { machine } = task;
  const floor = machine.sp;
  for (const [position, id] of [
    [80, first],
    [84, second],
    [88, destination],
  ])
    machine.store(position, world.nativeTaskID(id));
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xf217d9e3);
  assert.equal(world.input.get(first).active, 0x80000021);
  assert.equal(world.input.get(second).active, 0);
  assert.equal(world.objects.objects.get(first).implementation.state.changed, 0x81200305);
  assert.equal(
    world.objects.objects.get(first).implementation.state.receiver,
    world.nativeTaskID(destination),
  );
});

test('2.6.1.67 task GCALLs use owned VM transfer, clocks and Script exit words', async (t) => {
  const remote = [0x13, 80];
  const words = [0xfeedcace, 0x10203040, 0x8a2ea583];
  const queued = [0x77733166, 0xe72a63fe, 0x19c68229];
  const calls = [
    [4, [], 112],
    [5, [], 116],
    [76, [], 120],
    [69, [remote, ...words], 124],
    [70, [remote, ...queued], 128],
    [73, [remote, 176, 5, 180]],
    [72, [remote, 176, 5, 192]],
    [453, [0xf131bd90]],
  ];
  const callerProgram = kcsProgram([
    [37, 0xff1112ad],
    ...calls.flatMap(([id, args, result]) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      ...(result === undefined ? [] : [[38, result]]),
    ]),
    [59],
  ]);
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'transfer.kcs': callerProgram,
    'receiver.kcs': kcsProgram([[37, 128], [43, 71, 4], [37, 144], [43, 71, 4], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id;
  const caller = await world.spawnScript('transfer.kcs', { parent, initialExecute: false });
  const receiver = await world.spawnScript('receiver.kcs', { parent, initialExecute: true });
  const record = world.objects.objects.get(caller.id);
  const { machine } = caller;
  const payload = Uint8Array.of(0x81, 0x23, 0, 0xf1, 0xff);
  const floor = machine.sp;
  world.runtime.services.clock = () => 0x100000012;
  record.effectiveFrame = 0xfffffff4;
  record.pausedFrames = 7;
  machine.store(80, world.nativeTaskID(receiver.id));
  machine.bytes(180, payload.length).set(payload);
  machine.bytes(191, 7).fill(0x5f);
  receiver.machine.bytes(175, 7).fill(0x4f);
  await world.runtime.scheduler.execute(caller);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xff1112ad);
  assert.deepEqual(
    [112, 116, 120, 124, 128].map((at) => machine.load(at)),
    [0x12, 0xffffffed, world.nativeTaskID(parent), 1, 1],
  );
  assert.deepEqual(machine.bytes(191, 7), Uint8Array.of(0x5f, ...payload, 0x5f));
  assert.deepEqual(receiver.machine.bytes(175, 7), Uint8Array.of(0x4f, ...payload, 0x4f));
  const sender = world.nativeTaskID(caller.id);
  const packet = (at) =>
    Array.from({ length: 4 }, (_, word) => receiver.machine.load(at + word * 4));
  assert.deepEqual(packet(128), [sender, ...words]);
  assert.deepEqual(receiver.messages, [[sender, ...queued]]);
  assert.equal(record.exitCode, 0xf131bd90 | 0);
  await world.tick();
  assert.equal(receiver.status, 'finished');
  assert.deepEqual(packet(144), [sender, ...queued]);
});

test('2.6.1.67 Script GCALLs use the owned variable bank and context bytes', async (t) => {
  const name = '接続';
  const program = kcsProgram([
    [37, 0x88ea0da3],
    [37, 4],
    [43, 209, 4],
    [37, 3],
    [37, 0xf812aa00],
    [43, 211, 8],
    [37, 3],
    [43, 210, 4],
    [38, 80],
    [37, 4],
    [43, 210, 4],
    [38, 84],
    [37, 0xffffffff],
    [43, 210, 4],
    [38, 88],
    [37, 0xa7a91991],
    [43, 212, 4],
    [37, 128],
    [43, 454, 4],
    [59],
  ]);
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'variable-context.kcs': program,
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('variable-context.kcs', { context: { contextName: name } });
  const { machine } = task;
  machine.bytes(127, 7).fill(0x5f);
  const sp = machine.sp;
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, sp + 4);
  assert.equal(machine.load(sp), 0x88ea0da3);
  assert.deepEqual(
    [80, 84, 88].map((at) => machine.load(at)),
    [0xf812aa00, 0, 0],
  );
  assert.equal(world.runtime.variableBank(task, false).contextValue, 0xa7a91991);
  assert.deepEqual(machine.bytes(127, 7), Uint8Array.of(0x5f, ...encodeCP932(name), 0, 0x5f));
});

test('2.6.1.67 configuration GCALLs project two output words without changing invalid ranges', async (t) => {
  const calls = [
    [790, [0, 1, 80, 84], 112],
    [790, [0x80000000, 1, 88, 92], 116],
    [790, [0, 8, 96, 100], 120],
    [790, [1, 0xffffffff, 96, 100], 124],
    [739, [104, 108]],
  ];
  const world = await dataWorld(profile, {
    'configuration.kcs': kcsProgram([
      [37, 0x51a71a7b],
      ...calls.flatMap(([id, args, result]) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        ...(result === undefined ? [] : [[38, result]]),
      ]),
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('configuration.kcs');
  const { machine } = task;
  const floor = machine.sp;
  world.configuration.variableRanges.local.set([11, 29], 2);
  world.configuration.variableRanges.global.set([517, 43], 2);
  world.graphics.view.configure({
    virtualWidth: 800,
    virtualHeight: 600,
    clientWidth: 1600,
    clientHeight: 900,
    deviceOffset: [20.75, -11.25],
    deviceScale: 1.5,
    windowShift: [3, -2],
  });
  machine.bytes(96, 8).fill(0x5f);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0x51a71a7b);
  const wordsAt = (...addresses) => addresses.map((at) => machine.load(at));
  assert.deepEqual(wordsAt(80, 84, 88, 92, 96, 100), [11, 29, 517, 43, 0x5f5f5f5f, 0x5f5f5f5f]);
  assert.deepEqual(
    wordsAt(104, 108).map((word) => word | 0),
    [4, -3],
  );
  assert.deepEqual(wordsAt(112, 116, 120, 124), [1, 1, 0, 0]);
});

test('2.6.1.67 fullscreen GCALLs read the setting and preserve unused coordinate output', async (t) => {
  const program = kcsProgram([
    [37, 0x781a2bcd],
    [43, 741, 0],
    [38, 80],
    [37, 84],
    [37, 88],
    [43, 740, 8],
    [59],
  ]);
  const world = await dataWorld(profile, { 'fullscreen.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const screen = world.configuration.screen;
  screen.fullHeight = 720;
  screen.virtualHeight = 600;
  screen.multiWindowPosition = 0x81234567;
  world.graphics.view.configure({
    virtualWidth: 800,
    virtualHeight: 600,
    clientWidth: 800,
    clientHeight: 600,
    deviceOffset: [10, -20],
    deviceScale: 1,
    windowShift: [2, 3],
    drawingRectangle: [0, 0, 800, 560],
  });
  for (const [fullscreen, mode, expected] of [
    [0, 0, [0, -12, 557]],
    [1, 1, [0x81234567, -12, 737]],
    [1, 2, [0x81234567, 0, 600]],
    [1, 3, [0x81234567, 0, 405]],
  ]) {
    screen.fullscreen = fullscreen;
    screen.fullPosition = mode;
    const task = await world.spawnScript('fullscreen.kcs');
    const { machine } = task;
    const floor = machine.sp;
    machine.store(88, 405);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0x781a2bcd);
    assert.deepEqual([machine.load(80), machine.load(84) | 0, machine.load(88) | 0], expected);
  }
});

test('2.6.1.67 narrow GCALLs append bytes and write the original result words', async (t) => {
  const calls = [
    [15, [128, 160], 80],
    [16, [128, 192], 84],
    [17, [128], 88],
    [19, [224, 256], 92],
    [21, [288, 320], 96],
    [25, [352], 100],
    [25, [384], 104],
  ];
  const program = kcsProgram(
    [
      [37, 0xf1910080],
      ...calls.flatMap(([id, args, result]) => [
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        [38, result],
      ]),
      [59],
    ],
    [
      [128, '猫'],
      [160, '/log/'],
      [192, '100%%'],
      [224, 'A'],
      [256, 'B'],
      [288, 'NaMe'],
      [320, 'NAME'],
      [352, '-0x2ag'],
      [384, '5tail'],
    ],
  );
  const world = await dataWorld(profile, { 'narrow-strings.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('narrow-strings.kcs');
  const { machine } = task;
  const floor = machine.sp;
  machine.bytes(139, 5).fill(0x5a);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xf1910080);
  assert.deepEqual(
    [80, 84, 88, 92, 96, 100, 104].map((at) => machine.load(at)),
    [128, 128, 11, 1, 0, 0xffffffd6, 5],
  );
  assert.deepEqual(
    machine.bytes(128, 14),
    Uint8Array.of(...encodeCP932('猫/log/100%'), 0, 0, 0x5a),
  );
});

test('2.6.1.67 string expansion uses the existing Script bank and writes two terminators', async (t) => {
  const expanded = encodeCP932('猫+$str2/z:/$strQ');
  const world = await dataWorld(profile, {
    'case.kcs': kcsProgram([[59]]),
    'strings.kcs': kcsProgram(
      [
        [37, 0x89541afb],
        [37, 7],
        [37, 192],
        [43, 276, 8],
        [37, 0xffffffff],
        [37, 224],
        [43, 276, 8],
        [37, 42],
        [37, 256],
        [43, 276, 8],
        [37, 44],
        [37, 288],
        [43, 276, 8],
        [37, 44],
        [37, 320],
        [43, 277, 8],
        [38, 84],
        [37, 7],
        [37, 352],
        [43, 277, 8],
        [38, 88],
        [37, 128],
        [43, 278, 4],
        [59],
      ],
      [
        [128, '$str7+$str-1/$str0x2a:$str44/$strQ'],
        [192, '猫'],
        [224, '$str2'],
        [256, 'z'],
        [288, ''],
        [320, 'old'],
        [352, 'old'],
      ],
    ),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { runtime, task: plain } = await run([[37, 128], [43, 278, 4], [59]]);
  const plainWord = encodeCP932('plain $strQ');
  plain.machine.writeStringBytes(plainWord, 128);
  plain.machine.bytes(128 + plainWord.length + 1, 2).fill(0x7f);
  await runtime.scheduler.execute(plain);
  assert.equal(runtime.stringBank(plain, false), null);
  assert.deepEqual(
    plain.machine.bytes(128, plainWord.length + 3),
    Uint8Array.of(...plainWord, 0, 0, 0x7f),
  );

  const { runtime: unownedRuntime, task: unowned } = await run([[37, 128], [43, 278, 4], [59]]);
  unowned.machine.writeString('$str7', 128);
  await assert.rejects(
    () => unownedRuntime.scheduler.execute(unowned),
    /Native string expansion requires the caller string bank/,
  );

  const task = await world.spawnScript('strings.kcs', { initialExecute: false });
  const { machine } = task;
  const floor = machine.sp;
  const tail = machine.load(128 + expanded.length + 2, 1);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0x89541afb);
  assert.deepEqual(machine.bytes(128, expanded.length + 3), Uint8Array.of(...expanded, 0, 0, tail));
  assert.deepEqual([machine.load(84), machine.load(88)], [0, 1]);
  assert.equal(machine.string(320), '');
  assert.equal(machine.string(352), '猫');
});

test('2.6.1.67 Draw GCALLs copy, clear and force the owned pixel surface', async (t) => {
  const target = [0x13, 80];
  const pixels = [23, 47, 89, 255];
  const program = (id, args = [target]) =>
    kcsProgram([
      [37, 0xd714a16b],
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      [59],
    ]);
  const world = await dataWorld(profile, {
    'copy.kcs': program(455, [target, [0x13, 84]]),
    'render.kcs': program(340),
    'clear.kcs': program(341),
    'force.kcs': program(342),
  });
  t.after(() => world.close({ flushFiles: false }));
  const texture = world.configuration.fields.texture;
  texture.size.set([64, 64]);
  texture.grid.set([1, 1]);
  texture.bppY.set([0, 1]);
  texture.areas[0].set([0, 0, 1, 1]);
  texture.bpp = 32;
  const owner = world.main;
  const id = await world.objects.create({ kind: 15, parent: owner.id });
  const nativeID = world.nativeTaskID(id);
  const targetDraw = world.graphics.drawTasks.get(id);
  await world.runtime.native('main', 256, [nativeID, 2, 2], owner.machine, owner);
  await world.runtime.native('main', 260, [nativeID, 0, 0], owner.machine, owner);
  await world.runtime.native('main', 262, [nativeID, 1], owner.machine, owner);
  const image = world.graphics.images.create(1, 1, owner.id);
  const source = world.graphics.images.get(image);
  (await source.pixels()).set(pixels);
  await source.changed();
  const execute = async (name, handle = 0) => {
    const task = await world.spawnScript(name);
    const { machine } = task;
    const stack = machine.sp;
    machine.store(80, nativeID);
    machine.store(84, handle);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, stack + 4);
    assert.equal(machine.load(stack), 0xd714a16b);
  };
  await execute('copy.kcs', image);
  assert.equal(targetDraw.state.baseVisible, true);
  assert.notEqual(targetDraw.state.baseImage, image);
  assert.deepEqual(
    Array.from(await world.graphics.images.get(targetDraw.state.baseImage).pixels()),
    pixels,
  );
  await execute('render.kcs');
  const rendered = await world.graphics.images.get(targetDraw.state.renderer.bitmap).pixels();
  assert.ok(
    rendered.some(
      (_, offset) =>
        offset % 4 === 0 && pixels.every((value, channel) => rendered[offset + channel] === value),
    ),
    'Expected the owned color in the ordinary Draw output',
  );
  await execute('copy.kcs');
  await execute('clear.kcs');
  assert.equal(targetDraw.state.baseVisible, false);
  assert.deepEqual(targetDraw.state.renderer.items, []);
  await world.runtime.native('main', 262, [nativeID, 0], owner.machine, owner);
  await execute('force.kcs');
  assert.equal(targetDraw.state.enabled, 0);
  assert.deepEqual(
    Array.from((await world.graphics.images.get(world.graphics.vramHandle).pixels()).slice(0, 4)),
    [0, 0, 0, 0],
  );
});

test('2.6.1.67 Input GCALLs target the owned Root input, gate keys and restore all DWORDs', async (t) => {
  const world = await dataWorld(profile, {
    'input-disable.kcs': kcsProgram([
      [37, 0xa2683243],
      [37, 0],
      [43, 401, 4],
      [37, 2],
      [37, 0],
      [43, 403, 8],
      [37, 79],
      [37, 0x82345678],
      [43, 403, 8],
      [59],
    ]),
    'input-reset.kcs': kcsProgram([
      [37, 0xa2683243],
      [43, 404, 0],
      [37, 0x92345678],
      [43, 401, 4],
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const run = async (name) => {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      floor = task.machine.sp;
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.sp, floor + 4);
    assert.equal(task.machine.load(floor), 0xa2683243);
  };
  await run('input-disable.kcs');
  assert.equal(world.input.cursorEnabled, 0);
  assert.equal(world.input.enabled[79], 0x82345678);
  world.input.key(2, true, 1);
  await world.input.tick(1);
  assert.equal(world.input.held[8], 0);
  await run('input-reset.kcs');
  await world.input.tick(2);
  assert.equal(world.input.held[8], 1);
  assert.equal(world.input.cursorEnabled, 0x92345678);
  assert.deepEqual([...world.input.enabled], Array(80).fill(1));
});

test('2.6.1.67 task notification GCALLs deliver exact raw packets in the caller namespace', async (t) => {
  const world = await dataWorld(profile, {
    'send.kcs': kcsProgram([
      [37, 0xa9173e32],
      [37, 0],
      [43, 572, 4],
      [37, [0x13, 84]],
      [43, 570, 4],
      [37, [0x13, 84]],
      [37, [0x13, 88]],
      [43, 571, 8],
      [37, [0x13, 84]],
      [37, 0],
      [43, 571, 8],
      [37, 0xffffffef],
      [43, 572, 4],
      [37, 0xfe86085d],
      [43, 577, 4],
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('send.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    trace = [],
    send = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = async (...args) => {
    const result = await send(...args);
    trace.push({ args: args.slice(0, 5), result });
    return result;
  };
  const { machine } = task,
    floor = machine.sp,
    target = world.nativeTaskID(world.main.id),
    pointer = world.runtime.imageDataBuffers.process.allocate(4);
  world.runtime.imageDataBuffers.process.store(pointer, 0x888c0fea);
  machine.store(84, target);
  machine.store(88, pointer);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xa9173e32);
  assert.deepEqual(
    trace.map(({ args }) => args),
    [
      [0, task.id, 426, 0, 0],
      [target, task.id, 424, 0, 0],
      [target, task.id, 427, 0, 0x888c0fea],
      [target, task.id, 427, 0, 0],
      [0xffffffef, task.id, 426, 0, 0],
      [0, task.id, 38, 0, 0xfe86085d],
    ],
  );
  assert.ok(trace.every(({ result }) => result === NATIVE_UNWRITTEN_WORD));
  assert.equal(world.objects.objects.get(world.root).implementation.field, 0xfe86085d);
  world.runtime.imageDataBuffers.process.free(pointer);
});

test('2.6.1.67 Input GCALLs collect four physical sources and clear region activity', async (t) => {
  const world = await dataWorld(profile, {
    'input-query.kcs': kcsProgram([
      [37, 0xaefec213],
      [37, 12],
      [43, 285, 4],
      [38, 80],
      [43, 286, 0],
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { input } = world,
    region = input.register({ owner: world.main.id, bounds: [5, 10, 40, 45] }),
    task = await world.spawnScript('input-query.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    floor = task.machine.sp;
  [2, 16, 128, 4096].forEach((source, device) => input.key(12, true, source, device));
  input.get(region.owner).active = 0x312;
  input.previousX = 17;
  input.previousY = 38;
  input.forceCursor = false;
  await world.runtime.scheduler.execute(task);
  assert.equal(task.machine.load(80), 0x1092);
  assert.equal(task.machine.sp, floor + 4);
  assert.equal(task.machine.load(floor), 0xaefec213);
  assert.equal(region.active, 0);
  assert.deepEqual([input.previousX, input.previousY, input.forceCursor], [-1, -1, true]);
});

test('2.6.1.67 narrow string GCALLs preserve native byte aliases and character boundaries', async () => {
  const { runtime, task, machine } = await run([
    [37, 0xfa9232f2],
    ...[
      [43, [416, 320, 352]],
      [42, [480, 416, 1], 80],
      [42, [512, 416, 99], 84],
      [44, [544, 416, 0, -1]],
      [45, [576, 384, 448, 640]],
      [45, [704, 704, 448, 640]],
      [47, [768], 88],
      [48, [800], 92],
      [49, [768, 832], 96],
      [49, [768, 864], 100],
      [49, [768, 896], 104],
    ].flatMap(([id, args, output]) => [
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
      ...(output === undefined ? [] : [[38, output]]),
    ]),
    [59],
  ]);
  const floor = machine.sp;
  machine.bytes(416, 232).fill(0xa5);
  machine.writeString('a(b,(:c)),終', 320);
  machine.writeString(',', 352);
  machine.writeString('x-a-a-尾', 384);
  machine.writeString('a', 448);
  machine.writeString('写', 640);
  machine.writeString('a-tail', 704);
  machine.bytes(768, 5).set([0x81, 0x5c, 0x5c, 65, 0]);
  machine.writeString('二文字', 800);
  machine.writeString('\\', 832);
  machine.writeString('absent', 864);
  machine.writeString('', 896);
  await runtime.scheduler.execute(task);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xfa9232f2);
  assert.equal(machine.string(480), '(b,(:c))');
  assert.deepEqual(machine.bytes(512, 3), Uint8Array.of(0, 0, 0xa5));
  assert.equal(machine.string(544), 'a (b,(:c)) 終 ');
  assert.equal(machine.string(576), 'x-写-写-尾');
  assert.deepEqual(machine.bytes(704, 4), Uint8Array.of(0, 0, 0x74, 0x61));
  assert.deepEqual(
    [80, 84, 88, 92, 96, 100, 104].map((at) => machine.load(at)),
    [1, 0, 3, 3, 2, 4, 0],
  );
});

test('2.6.1.67 Main519 selects a space token through its live CP932 group scanner', async () => {
  const { runtime, task, machine } = await run([
    ...[
      [320, 256, 1, 80],
      [352, 256, 0xffffffff, 84],
      [384, 384, 0, 88],
      [416, 0xffffffff, 0, 92],
    ].flatMap(([destination, source, index, output]) => [
      [37, destination],
      [37, source],
      [37, index],
      [43, 519, 12],
      [38, output],
    ]),
    [59],
  ]);
  machine.bytes(320, 112).fill(0xa5);
  machine.writeString('a(b (:中 d)) 尾', 256);
  machine.writeString('alias', 384);
  const stack = machine.sp;
  await runtime.scheduler.execute(task);
  assert.equal(machine.sp, stack);
  assert.deepEqual(
    machine.bytes(320, 14),
    Uint8Array.of(...encodeCP932('(b (:中 d))'), 0, 0, 0xa5),
  );
  assert.deepEqual(
    [80, 84, 88, 92].map((at) => machine.load(at)),
    [1, 0, 0, 0],
  );
  assert.deepEqual(machine.bytes(352, 3), Uint8Array.of(0, 0xa5, 0xa5));
  assert.deepEqual(machine.bytes(384, 3), Uint8Array.of(0, 0x6c, 0x69));
  assert.deepEqual(machine.bytes(416, 3), Uint8Array.of(0, 0xa5, 0xa5));
});

test('2.6.1.67 KCS guest allocation and copying retain byte ranges and forward MMX overlap', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    ...(at === undefined ? [] : [[38, at]]),
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(27, [0], 80),
    ...call(27, [8], 84),
    ...call(35, [320, [0x13, 84], 8]),
    ...call(36, [[0x13, 84], 0x123456cb, 4]),
    ...call(35, [328, [0x13, 84], 8]),
    ...call(28, [[0x13, 84]], 88),
    ...call(28, [[0x13, 84]], 92),
    ...call(35, [352, 0xffffffff, 1]),
    ...call(35, [0xffffffff, 352, 1]),
    ...call(35, [0xffffffff, 0xffffffff, 0]),
    ...call(35, [385, 384, 16]),
    ...call(35, [417, 416, 12]),
    ...call(35, [449, 448, 11]),
    [59],
  ]);
  m.bytes(320, 40).fill(0xa5);
  for (const at of [384, 416, 448]) m.bytes(at, 17).set(Array.from({ length: 17 }, (_, i) => i));
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.equal(m.load(80), 0xffffffff);
  assert.equal(m.load(84), m.memory.length);
  assert.deepEqual([m.load(88), m.load(92)], [1, 0]);
  assert.deepEqual(m.bytes(320, 8), new Uint8Array(8));
  assert.deepEqual(m.bytes(328, 8), Uint8Array.of(0xcb, 0xcb, 0xcb, 0xcb, 0, 0, 0, 0));
  assert.deepEqual(m.bytes(352, 3), Uint8Array.of(0xa5, 0xa5, 0xa5));
  assert.deepEqual(
    m.bytes(384, 17),
    Uint8Array.of(0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 9, 10, 11, 12, 13, 14, 15),
  );
  assert.deepEqual(m.bytes(416, 13), Uint8Array.of(0, 0, 1, 2, 3, 3, 5, 6, 7, 7, 9, 10, 11));
  assert.deepEqual(m.bytes(448, 12), Uint8Array.of(0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
});

test('2.6.1.67 KCS argument expressions return a bounded list and raw space offsets', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    [38, at],
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(539, [256, 512, 2], 80),
    ...call(539, [288, 544, 3], 84),
    ...call(539, [320, 576, 1], 88),
    ...call(539, [320, 580, 0xffffffff], 92),
    ...call(539, [0xffffffff, 608, 1], 96),
    ...[0, 1, 2, 3, 4, 0xffffffff].flatMap((index, i) => call(540, [352, index], 100 + i * 4)),
    [59],
  ]);
  runtime.variableBank(task).initialize(4);
  m.writeString('[1+2,0x10,9]', 256);
  m.writeString('[3-6]', 288);
  m.writeString('1-3*4', 320);
  m.writeString('猫\t犬  A ', 352);
  m.bytes(512, 104).fill(0xa5);
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    Array.from({ length: 11 }, (_, i) => m.load(80 + i * 4)),
    [2, 3, 1, 0, 0, 0, 7, 9, 0xffffffff, 0xffffffff, 0xffffffff],
  );
  assert.deepEqual(
    [512, 516, 520].map((at) => m.load(at)),
    [3, 16, 0xa5a5a5a5],
  );
  assert.deepEqual(
    [544, 548, 552, 556].map((at) => m.load(at)),
    [3, 4, 5, 0xa5a5a5a5],
  );
  assert.deepEqual(
    [576, 580, 608].map((at) => m.load(at)),
    [0xfffffff5, 0xa5a5a5a5, 0xa5a5a5a5],
  );
});

test('2.6.1.67 KCS variable owner evaluates, backs up bytes, and addresses its selected private context', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    ...(at === undefined ? [] : [[38, at]]),
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(212, [15]),
    ...call(213, [320], 80),
    ...call(213, [0xffffffff], 84),
    ...call(609, []),
    ...call(211, [0, 7]),
    ...call(211, [1, 8]),
    ...call(211, [2, 9]),
    ...call(610, []),
    ...call(210, [0], 88),
    ...call(210, [1], 92),
    ...call(210, [2], 96),
    ...call(659, [511, 0xfedcba98]),
    ...call(659, [512, 0xbeef]),
    ...call(659, [0xffffffff, 0xdead]),
    ...call(658, [511], 100),
    ...call(658, [512], 104),
    ...call(658, [0xffffffff], 108),
    [59],
  ]);
  const bank = runtime.variableBank(task);
  bank.initialize(8);
  bank.words.set([100, 200, 300]);
  bank.registerContext('unselected');
  bank.registerContext('active');
  m.writeString('$0+@%', 320);
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => m.load(80 + i * 4)),
    [115, 0, 100, 200, 9, 0xfedcba98, 0, 0],
  );
  assert.equal(bank.context('unselected').words[511], 0);
  assert.equal(bank.context('active').words[511], 0xfedcba98);
  assert.equal(bank.context('active').words[0], 0);
});

test('2.6.1.67 KCS formatted string calls preserve CP932 widths and live truncation', async () => {
  const call = (id, words, at) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    ...(at === undefined ? [] : [[38, at]]),
  ];
  const {
    runtime,
    task,
    machine: m,
  } = await run([
    ...call(18, [256], 80),
    ...call(20, [896, 1024], 84),
    ...call(22, [416, 448], 88),
    ...call(23, [288, 2], 92),
    ...call(24, [320, 2], 96),
    ...call(26, [352], 100),
    ...call(37, [624, 1234567, 1]),
    ...call(37, [656, -999, 1]),
    ...call(38, [513, 512, 544, 7], 104),
    ...call(38, [576, 608, 688, 12], 108),
    ...call(39, [720, 608, 752, 12], 112),
    ...call(40, [256], 116),
    ...call(40, [784], 120),
    ...call(40, [0xffffffff], 124),
    [59],
  ]);
  m.bytes(512, 293).fill(0xa5);
  m.writeString('猫a', 256);
  m.writeString('猫a', 288);
  m.writeString('猫ab', 320);
  m.writeString('-12.5D-1rest', 352);
  m.writeString('aBc', 416);
  m.writeString('ABC', 448);
  m.writeString('abcd', 512);
  m.writeString('', 544);
  m.writeString('one\ttwo', 608);
  m.writeString('\\t', 688);
  m.writeString('\\\t', 752);
  m.writeStringBytes(Uint8Array.of(0x81, 0x7f), 784);
  m.writeString('C', 896);
  m.writeString('A'.repeat(1024) + 'D', 1024);
  const stack = m.sp;
  await runtime.scheduler.execute(task);
  assert.equal(m.sp, stack);
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => m.load(80 + i * 4)),
    [3, 3, 0, 0, 3, floatBits(-1.25), 5, 3, 3, 1, 0, 0],
  );
  assert.deepEqual(m.bytes(288, 4), Uint8Array.of(0, 0, 97, 0));
  assert.deepEqual(m.bytes(320, 5), Uint8Array.of(...encodeCP932('猫a'), 0, 0));
  assert.deepEqual(m.bytes(624, 13), Uint8Array.of(...encodeCP932('+1,234,567'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(656, 7), Uint8Array.of(...encodeCP932('-999'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(512, 9), Uint8Array.of(...encodeCP932('aaaaaa'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(576, 6), Uint8Array.of(...encodeCP932('one'), 0, 0, 0xa5));
  assert.deepEqual(m.bytes(720, 6), Uint8Array.of(...encodeCP932('one'), 0, 0, 0xa5));
});

test('2.6.1.67 KCS common Base commands reset the exit word and pause the designated task', async (t) => {
  const command = (id, words) => [...words.map((word) => [37, word]), [43, id, words.length * 4]],
    target = [0x13, 80],
    world = await dataWorld(profile, {
      'hold.kcs': kcsProgram([
        [37, 0x9753bf24],
        ...command(651, [target]),
        ...command(694, [target, 0x80234567]),
        ...command(694, [999999, 0x100]),
        [59],
      ]),
      'resume.kcs': kcsProgram([...command(694, [target, 0]), [59]]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const pausedID = await world.objects.create({ kind: 2, parent: world.main.id }),
    paused = world.objects.objects.get(pausedID),
    untouched = world.objects.objects.get(
      await world.objects.create({ kind: 2, parent: world.main.id }),
    );
  paused.exitCode = 85;
  untouched.exitCode = 15;
  const run = async (script) => {
    const task = await world.spawnScript(script, { parent: world.main.id, initialExecute: false });
    task.machine.store(80, world.nativeTaskID(pausedID));
    const stack = task.machine.sp;
    await world.runtime.scheduler.execute(task);
    return { task, stack };
  };
  const { task, stack } = await run('hold.kcs');
  assert.equal(task.machine.sp, stack + 4);
  assert.equal(task.machine.load(stack), 0x9753bf24);
  assert.equal(paused.exitCode, -1);
  assert.equal(paused.userValue, 0x80234567);
  assert.equal(untouched.exitCode, 15);
  assert.equal(untouched.userValue, 0);
  await run('resume.kcs');
  assert.equal(paused.userValue, 0);
});

test('2.6.1.67 KCS Plane restore relays the VRAM selector and formats both notification packets', async (t) => {
  const target = [0x13, 80],
    command = (id, words) => [...words.map((word) => [37, word]), [43, id, words.length * 4]],
    world = await dataWorld(profile, {
      'restore.kcs': kcsProgram([
        [37, 0x283e9da1],
        ...command(653, [target, 0x80234567]),
        ...command(654, [target, 96, 128]),
        ...command(655, [target, 160]),
        ...command(653, [0, 7]),
        [59],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const id = await world.objects.create({ kind: 2, parent: world.main.id }),
    plane = world.graphics.get(id),
    task = await world.spawnScript('restore.kcs', { parent: world.main.id, initialExecute: false }),
    machine = task.machine,
    stack = machine.sp,
    receiver = plane.message.bind(plane),
    packets = [];
  plane.message = (words, context) => {
    const [, message, w, l] = words;
    if (message === 85 || message === 86) {
      const size = message === 85 ? 512 : 256;
      packets.push({ message, w, l, bytes: context.payload.bytes(0, size).slice() });
    }
    return receiver(words, context);
  };
  machine.store(80, world.nativeTaskID(id));
  machine.writeString('背景', 96);
  machine.writeString('復帰', 128);
  machine.writeString('', 160);
  const original = structuredClone(plane.state);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.sp, stack + 4);
  assert.equal(machine.load(stack), 0x283e9da1);
  assert.deepEqual(plane.state, { ...original, vramType: 0x80234567 });
  const pair = new Uint8Array(512);
  pair.set(encodeCP932('背景'));
  pair.set(encodeCP932('復帰'), 256);
  assert.deepEqual(packets, [
    { message: 85, w: 0, l: 256, bytes: pair },
    { message: 86, w: 0, l: 0, bytes: new Uint8Array(256) },
  ]);
});
