// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { nativeReply } from '../src/kcs.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { memoryGame } from './helpers.mjs';

function compiled(instructions, strings = []) {
  const words = (value) => [
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  ];
  const code = instructions.flatMap(([op, ...args]) => [
    op,
    ...args.flatMap((arg) => {
      const [mode, value] = Array.isArray(arg) ? arg : [0x23, arg];
      return [mode, ...words(value)];
    }),
  ]);
  const table = [],
    text = [];
  for (const [address, value] of strings) {
    table.push(...words(strings.length * 8 + text.length), ...words(address));
    text.push(...new TextEncoder().encode(value), 0);
  }
  const body = Uint8Array.from([...code, ...table, ...text]);
  const header = [
    0x0053434b,
    2,
    0,
    52,
    code.length,
    52 + code.length,
    strings.length,
    table.length + text.length,
    512,
    1024,
    52 + body.length,
    0,
    Math.max(body.length, code.length * 2),
  ].flatMap(words);
  return Uint8Array.from([...header, ...deflateSync(body)]);
}
const profile = 'nekopara-vol3-engine-2.6.1.76';

test('the native runtime continues guest instructions after a FES request and across a later yield', async () => {
  const bytes = compiled(
    [
      [37, 0],
      [37, 64],
      [43, 0x1bf, 8],
      [37, 17],
      [43, 0x41, 0],
      [37, 20],
      [1, [0x63, 0], [0x63, 0]],
      [59],
    ],
    [[64, 'arbitrary-flow.fes']],
  );
  const runtime = new NativeRuntime({ profile, read: async () => bytes });
  const loaded = [];
  runtime.register('main', 0x1bf, (args, m) => {
    loaded.push(m.string(args[1]));
    return nativeReply(2);
  });
  const task = await runtime.spawn('main.kcs');
  await runtime.tick();
  assert.deepEqual(loaded, ['arbitrary-flow.fes']);
  assert.equal(task.status, 'yielded');
  assert.equal(task.machine.load(task.machine.sp - 4), 17);
  await runtime.tick();
  assert.equal(task.status, 'finished');
  assert.equal(task.machine.pop(), 37);
});

test('an unknown native reports its exact ABI, arguments and guest PC without inventing a result', async () => {
  const runtime = new NativeRuntime({
    profile,
    read: async () => compiled([[37, 7], [43, 0x189, 4], [59]]),
  });
  const task = await runtime.spawn('unknown.kcs');
  await assert.rejects(runtime.tick(), (error) => {
    assert.equal(error instanceof UnsupportedKCSNative, true);
    assert.deepEqual(
      {
        profile: error.details.profile,
        id: error.details.id,
        script: error.details.script,
        pc: error.details.pc,
        args: error.details.args,
      },
      { profile, id: 0x189, script: 'unknown.kcs', pc: 6, args: [7] },
    );
    return true;
  });
  assert.equal(task.status, 'failed');
  assert.equal(task.machine.sp, 512);
});

test('only verified reserved and constant-zero handlers receive the original empty behavior', async () => {
  const runtime = new NativeRuntime({
    profile,
    read: async () => compiled([[37, 77], [43, 0, 4], [43, 171, 0], [59]]),
  });
  const task = await runtime.spawn('reserved.kcs');
  await runtime.tick();
  assert.equal(task.machine.pop(), 0);
  assert.equal(task.machine.sp, 512);
  runtime.register('main', 0x1bf, () => nativeReply(1, 0));
  assert.throws(
    () => runtime.native('main', 0x1bf, [], task.machine, task, runtime.scheduler),
    /disagrees with the fixed ABI/,
  );
});

test('native XML browser I/O executes once, resumes inside the same frame, and its handle survives a runtime checkpoint', async () => {
  const bytes = compiled(
    [
      [37, 64],
      [43, 0x24e, 4],
      [21, [0x13, 16], [0x63, 0]],
      [60],
      [43, 0x41, 0],
      [37, [0x13, 16]],
      [37, 9],
      [37, 128],
      [43, 0x250, 12],
      [59],
    ],
    [
      [64, 'settings.xml'],
      [128, 'value'],
    ],
  );
  let reads = 0;
  const read = async (name) => {
    if (name === 'main.kcs') return bytes;
    assert.equal(name, 'settings.xml');
    reads++;
    return new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8"?><document><value>71</value></document>',
    );
  };
  const runtime = new NativeRuntime({ profile, read });
  const task = await runtime.spawn('main.kcs');
  await runtime.tick();
  assert.equal(runtime.scheduler.frame, 1);
  assert.equal(reads, 1);
  const restored = new NativeRuntime({ profile, read });
  await restored.restore(structuredClone(runtime.snapshot()));
  await restored.tick();
  assert.equal(restored.scheduler.tasks.get(task.id).machine.pop(), 71);
  assert.equal(reads, 1);
});

test('FES execkcs starts every requested script through its task host and resumes in the same frame', async () => {
  for (const name of ['call_config', 'an-unrelated-helper']) {
    const globals = {},
      calls = [];
    const player = new FESPlayer(
      memoryGame({
        'flow.fes': new TextEncoder().encode(
          `#START\nexeckcs ${name}\n$2=$1\nendkcs\n$3=7\nnext WAIT\n#WAIT\n`,
        ),
      }),
      {},
      {
        async startKCS(file) {
          await Promise.resolve();
          calls.push(file);
          globals[1] = 71;
          return 9;
        },
        endKCS(id) {
          calls.push(id);
        },
      },
      globals,
    );
    await player.start('flow');
    await player.step();
    await player.flush();
    assert.deepEqual(calls, [name, 9]);
    assert.equal(player.frameCount, 1);
    assert.equal(globals[2], 71);
    assert.equal(globals[3], 7);
    assert.equal(player.root.kcsTaskID, null);
    await player.step();
    assert.equal(globals[3], 7);
  }
});

const sdkProfile = 'sdk-4.01-engine-2.6.1.74';

function assertUnknownDiagnostic(error, runtime, id, args, task) {
  assert.ok(error instanceof UnsupportedKCSNative);
  assert.deepEqual(error.details, {
    profile: runtime.profile,
    table: 'main',
    id,
    task: task.id,
    script: task.name,
    pc: task.machine.pc,
    args,
    source: task.machine.debug,
  });
}

test('unknown admission precedes registered handlers and service preparation', async () => {
  const runtime = new NativeRuntime({
    profile: sdkProfile,
    read: async () => compiled([[59]], [[64, 'known semantic']]),
    services: { log: (value) => logs.push(value) },
  });
  const logs = [],
    task = await runtime.spawn('admission.kcs');
  let preparation = 0,
    handled = 0,
    error;
  Object.defineProperty(runtime.services, 'admissionProbe', {
    enumerable: true,
    get() {
      preparation++;
      return true;
    },
  });
  runtime.register('main', 262, () => {
    handled++;
    return nativeReply(2);
  });
  assert.equal(runtime.tables.get('main')[262].status, 'unknown');
  try {
    runtime.native('main', 262, [7, 1], task.machine, task, runtime.scheduler);
  } catch (failure) {
    error = failure;
  }
  assert.deepEqual(
    { rejected: error?.name, preparation, handled },
    { rejected: 'UnsupportedKCSNative', preparation: 0, handled: 0 },
  );
  assertUnknownDiagnostic(error, runtime, 262, [7, 1], task);
  assert.equal(runtime.tables.get('main')[1].status, 'recovered');
  assert.equal(nativeABI(sdkProfile).tables.main.entries[1].signature.review, 'needs-review');
  assert.deepEqual(runtime.native('main', 1, [64], task.machine, task, runtime.scheduler), {
    control: 2,
  });
  assert.deepEqual(logs, ['known semantic']);
  for (const [table, entries] of runtime.tables) {
    if (table === 'main') continue;
    let called = 0;
    const entry = entries[0],
      control = entry.controlCodes[0];
    assert.ok(['recovered', 'declared'].includes(entry.status));
    runtime.register(table, 0, () => {
      called++;
      return nativeReply(control, [1, 3].includes(control) ? 7 : undefined);
    });
    assert.equal(
      runtime.native(table, 0, [], task.machine, task, runtime.scheduler).control,
      control,
    );
    assert.equal(called, 1);
  }
  assert.throws(
    () => new NativeRuntime({ profile: 'unregistered', read: async () => null }),
    /Unregistered/,
  );
});

test('unknown admission precedes the main built-in fallback and resource services', async () => {
  let released = 0,
    preparation = 0,
    error;
  const runtime = new NativeRuntime({
    profile: sdkProfile,
    read: async () => compiled([[59]]),
    services: {
      objects: {
        release() {
          released++;
          return true;
        },
      },
    },
  });
  const task = await runtime.spawn('fallback.kcs');
  Object.defineProperty(runtime.services, 'admissionProbe', {
    enumerable: true,
    get() {
      preparation++;
      return true;
    },
  });
  assert.equal(runtime.tables.get('main')[0x43].status, 'unknown');
  assert.equal(runtime.handlers.has('main:67'), false);
  try {
    runtime.native('main', 0x43, [7], task.machine, task, runtime.scheduler);
  } catch (failure) {
    error = failure;
  }
  assert.deepEqual(
    { rejected: error?.name, preparation, released },
    { rejected: 'UnsupportedKCSNative', preparation: 0, released: 0 },
  );
  assertUnknownDiagnostic(error, runtime, 0x43, [7], task);
});
