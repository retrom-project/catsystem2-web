// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const profiles = [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
];
const value = (at) => [0x13, at];
const call = (id, args, output) => [
  ...args.map((v) => [37, v]),
  [43, id, args.length * 4],
  ...(output === undefined ? [] : [[38, output]]),
];
const words = (at, data) =>
  data.flatMap((v, i) => [
    [37, v],
    [38, at + i * 4],
  ]);
function text(at, input) {
  const bytes = Buffer.alloc(Math.ceil((input.length + 1) / 4) * 4);
  bytes.write(input);
  return words(
    at,
    Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32LE(i * 4)),
  );
}
function labelled(rows) {
  const labels = new Map();
  let pc = 0;
  for (const row of rows)
    if (typeof row === 'string') labels.set(row, pc);
    else pc += 1 + 5 * (row.length - 1);
  return rows
    .filter(Array.isArray)
    .map((row) => row.map((v) => (typeof v === 'string' ? labels.get(v) : v)));
}
const receiver = kcsProgram(
  labelled([
    ...words(100, [0, 0, 0, 0]),
    ...words(240, [0, 0, 0, 0]),
    'wait',
    ...call(71, [240]),
    [39, 'wait'],
    ...[0, 1, 2, 3].flatMap((i) => [
      [37, value(240 + 4 * i)],
      [38, 100 + 4 * i],
    ]),
    ...words(244, [0xabcd0001]),
    [41, 'wait'],
  ]),
);
const sender = kcsProgram(
  labelled([
    ...call(209, [512]),
    ...call(68, [], 64),
    ...text(256, 'namespace recipient'),
    ...text(320, 'recipient.kcs'),
    ...call(66, [12, value(64), 256], 68),
    ...call(143, [value(68), 320, 1]),
    'ready',
    ...call(71, [200]),
    [39, 'ready'],
    ...call(69, [value(68), 0x11, 0x11223344, 0x55667788], 128),
    ...call(70, [value(68), 0x21, 0x1234, 0x5678], 132),
    ...call(70, [value(68), 0x22, 0x2345, 0x6789], 136),
    'wait',
    ...call(71, [240]),
    [41, 'wait'],
  ]),
);
const selfQueue = kcsProgram(
  labelled([
    ...call(68, [], 64),
    ...call(69, [value(64), 0x10, 0, 0], 124),
    ...call(70, [value(64), 1, 0, 0], 128),
    'wait',
    ...call(71, [240]),
    [41, 'wait'],
  ]),
);
const inputs = { 'sender.kcs': sender, 'recipient.kcs': receiver, 'self-queue.kcs': selfQueue };
for (const profile of profiles) {
  test(`${profile} parsed initialExecute self messages retain canonical results and queue through cold`, async () => {
    let world = await modernParticleMessageWorld(profile, inputs);
    try {
      let task = await world.spawnScript('self-queue.kcs', {
        parent: world.root,
        initialExecute: true,
      });
      const id = task.id,
        nativeID = world.nativeTaskID(id);
      assert.equal(task.machine.load(124), 0, 'active direct self is not a queued message');
      assert.equal(task.machine.load(128), 1, 'actual Main70 writes its ordinary result');
      assert.deepEqual(task.messages, [[nativeID, 1, 0, 0]]);
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await modernParticleMessageWorld(profile, inputs, { initialize: false });
      await world.restore(state);
      task = world.runtime.scheduler.tasks.get(id);
      assert.deepEqual(task.messages, [[nativeID, 1, 0, 0]]);
      await world.objects.update(world.root, 1);
      assert.deepEqual(
        Array.from({ length: 4 }, (_, i) => task.machine.load(240 + 4 * i)),
        [nativeID, 1, 0, 0],
      );
      assert.equal(task.messages.length, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} parsed direct recipient and copied FIFO survive cold without becoming a raw query`, async () => {
    let world = await modernParticleMessageWorld(profile, inputs);
    try {
      const caller = await world.spawnScript('sender.kcs', {
        parent: world.root,
        initialExecute: true,
      });
      let frame = 0;
      for (; !caller.machine.waiting && frame < 8; frame++)
        await world.objects.update(world.root, frame + 1);
      assert(caller.machine.waiting, 'ordinary Root continuations reach the sender wait');
      const callerID = caller.id,
        targetID = world.resolveTaskID(caller.machine.load(68), callerID),
        nativeCaller = world.nativeTaskID(callerID);
      let recipient = world.runtime.scheduler.tasks.get(targetID);
      assert(recipient.machine.waiting, 'real loaded recipient has armed its separate wait');
      const packet = new Uint32Array([world.nativeTaskID(world.main.id), 1, 0, 0]);
      const payload = {
        load: (p) => packet[p >>> 2],
        store: (p, v) => {
          packet[p >>> 2] = v;
        },
      };
      await world.sendEngine(callerID, world.main.id, 172, 0, 0, { payload });
      assert.deepEqual(
        [128, 132, 136].map((p) => caller.machine.load(p)),
        [1, 1, 1],
      );
      assert.deepEqual(
        [100, 104, 108, 112].map((p) => recipient.machine.load(p)),
        [nativeCaller, 0x11, 0x11223344, 0x55667788],
      );
      assert.deepEqual(recipient.messages, [
        [nativeCaller, 0x21, 0x1234, 0x5678],
        [nativeCaller, 0x22, 0x2345, 0x6789],
      ]);
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await modernParticleMessageWorld(profile, inputs, { initialize: false });
      await world.restore(state);
      recipient = world.runtime.scheduler.tasks.get(targetID);
      const deliveries = [],
        receive = recipient.machine.receiveMessage.bind(recipient.machine);
      recipient.machine.receiveMessage = (message) => {
        deliveries.push([...message]);
        return receive(message);
      };
      await world.objects.update(world.root, frame + 1);
      await world.objects.update(world.root, frame + 2);
      assert.deepEqual(deliveries, [
        [nativeCaller, 0x21, 0x1234, 0x5678],
        [nativeCaller, 0x22, 0x2345, 0x6789],
      ]);
      assert.deepEqual(
        [100, 104, 108, 112].map((p) => recipient.machine.load(p)),
        [nativeCaller, 0x22, 0x2345, 0x6789],
      );
      const direct = new Uint32Array([nativeCaller, 0x99, 0x1a2b, 0x3c4d]);
      const reply = await world.sendEngine(targetID, callerID, 172, 0, 0, {
        payload: {
          load: (p) => direct[p >>> 2],
          store: (p, v) => {
            direct[p >>> 2] = v;
          },
        },
      });
      assert.equal(reply, 1);
      assert.equal(
        direct[1],
        0xabcd0001,
        'the actual VM callback publishes its reply tag into the owned packet',
      );
      assert.equal(recipient.messages.length, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} actual external raw Scene query keeps its mapped writes and unwritten result`, async () => {
    const world = await modernParticleMessageWorld(profile, inputs);
    try {
      const task = world.main,
        raw = nativeABI(profile).messages.channels.taskQueries?.canonical
          ? mapABIMessage(profile, 'taskQueries', 'canonical', 175, 12)
          : 175;
      task.machine.store(200, 0x11223344);
      task.machine.store(204, 0x55667788);
      const result = await world.sendNativeEngine(
        world.nativeTaskID(task.id),
        task.id,
        raw,
        200,
        204,
        { machine: task.machine },
      );
      assert.equal(result, NATIVE_UNWRITTEN_WORD);
      assert.deepEqual([task.machine.load(200), task.machine.load(204)], [0, 0]);
      assert.equal(task.messages.length, 0);
      assert.equal(nativeABI(profile).tables.main.entries[70].status, 'recovered');
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('a non-Script recipient still cannot synthesize a message result word', async () => {
  const world = await modernParticleMessageWorld('sdk-4.01-engine-2.6.1.74', inputs);
  try {
    const id = await world.objects.create({ kind: 6, parent: world.root, name: 'plain Base' });
    await assert.rejects(
      world.runtime.native(
        'main',
        70,
        [world.nativeTaskID(id), 1, 0, 0],
        world.main.machine,
        world.main,
      ),
      /KCS script message result has no initialized 32-bit output word/,
    );
    assert(world.objects.objects.has(id));
    assert.equal(world.main.messages.length, 0);
  } finally {
    await world.close({ flushFiles: false });
  }
});
