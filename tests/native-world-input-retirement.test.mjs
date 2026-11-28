// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const leaves = (e) => e.errors?.flatMap(leaves) ?? [e.message];
const V = (at) => [0x13, at],
  call = (id, args, out) => [
    ...args.map((v) => [37, v]),
    [43, id, args.length * 4],
    ...(out === undefined ? [] : [[38, out]]),
  ];
function labels(rows) {
  const labels = new Map();
  let pc = 0;
  for (const r of rows)
    if (typeof r === 'string') labels.set(r, pc);
    else pc += 1 + 5 * (r.length - 1);
  return rows
    .filter(Array.isArray)
    .map((r) => r.map((v) => (typeof v === 'string' ? labels.get(v) : v)));
}
const child = kcsProgram(
  labels([
    'wait',
    ...call(71, [240]),
    [39, 'wait'],
    [19, V(244), 0xffff0006],
    [39, 'wait'],
    ...call(105, [V(0x80000020), 0]),
    [41, 'wait'],
  ]),
);
const F = (n) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n);
  return b.readUInt32LE();
};
const parent = (twoCallbacks) =>
  kcsProgram(
    [
      ...call(209, [512]),
      ...call(68, [], 64),
      ...call(66, [34, V(64), 256], 68),
      ...call(447, [V(68), 320]),
      ...call(66, [12, V(68), 384], 72),
      ...call(143, [V(72), 448, 0]),
      ...(twoCallbacks ? [...call(66, [12, V(68), 384], 80), ...call(143, [V(80), 448, 0])] : []),
      ...call(66, [2, V(68), 512], 76),
      [37, V(76)],
      [38, 0x80000020],
      ...call(79, [V(76), F(12), F(10), 0xff203040]),
      ...call(95, [V(76), 0x21]),
      ...call(110, [V(76), V(72)]),
      ...call(71, [1000]),
      [59],
    ],
    [
      [256, 'ordinary FES'],
      [320, 'empty.fes'],
      [384, 'normal retirement callback'],
      [448, 'child.kcs'],
      [512, 'normal input Plane'],
    ],
  );

const profiles = [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
];
async function open(profile, { checkpoint, twoCallbacks = false, failFirstCallback = false } = {}) {
  const w = await modernParticleMessageWorld(
    profile,
    {
      'main.kcs': parent(twoCallbacks),
      'child.kcs': child,
      'empty.fes': Buffer.from('#START\nnext IDLE\n#IDLE\n'),
    },
    { initialize: false },
  );
  w.graphics.createLogicalDevice();
  if (checkpoint) await w.restore(checkpoint);
  else {
    await w.initialize('main.kcs');
    await w.objects.tick(2);
  }
  const main = w.main,
    fesID = w.resolveTaskID(main.machine.load(68), main.id),
    childID = w.resolveTaskID(main.machine.load(72), main.id),
    planeID = w.resolveTaskID(main.machine.load(76), main.id),
    inputID = w.objects.objects.get(w.root).implementation.input;
  assert(w.runtime.scheduler.tasks.get(childID).machine.waiting);
  assert(w.inputFor(planeID)?.message);
  const events = [],
    native = w.runtime.native;
  w.runtime.native = async function (table, id, args, machine, task, ...rest) {
    if (table !== 'main' || id !== 105)
      return Reflect.apply(native, this, [table, id, args, machine, task, ...rest]);
    const row = {
      task: task.id,
      inputTaskLive: w.objects.objects.has(inputID),
      inputStateLive: !!w.inputFor(planeID),
    };
    events.push(row);
    try {
      row.reply = await Reflect.apply(native, this, [table, id, args, machine, task, ...rest]);
      if (failFirstCallback && events.length === 1)
        throw new Error('authored failure after actual Plane disable');
      return row.reply;
    } catch (error) {
      row.error = error.message;
      throw error;
    }
  };
  return { w, fesID, childID, planeID, inputID, events };
}
for (const profile of profiles) {
  test(
    profile +
      ' final Root retains only its real Input service for late parsed retirement callbacks',
    async () => {
      const { w, events, planeID } = await open(profile);
      await w.close({ flushFiles: false });
      assert.equal(events.length, 1);
      assert.equal(events[0].inputTaskLive, false);
      assert.equal(events[0].inputStateLive, true);
      assert.deepEqual(events[0].reply, { control: 2 });
      assert.equal(w.objects.objects.size, 0);
      assert.equal(w.runtime.handles.records.size, 0);
      assert.equal(w.input.regions.length, 0);
      assert.equal(w.inputFor(planeID), null);
      await w.close({ flushFiles: false });
      assert.equal(events.length, 1);
    },
  );
  test(profile + ' ordinary FES retirement uses the still-live Input task', async () => {
    const { w, fesID, events } = await open(profile);
    try {
      await w.runtime.native('main', 67, [w.nativeTaskID(fesID)], w.main.machine, w.main);
      await w.objects.tick(3);
      assert.equal(events.length, 1);
      assert.equal(events[0].inputTaskLive, true);
      assert.equal(events[0].inputStateLive, true);
      assert.deepEqual(events[0].reply, { control: 2 });
      assert(!w.objects.objects.has(fesID));
    } finally {
      await w.close({ flushFiles: false });
    }
  });
  test(profile + ' a missing Input before host cleanup is still rejected', async () => {
    const { w, inputID, planeID } = await open(profile);
    await w.objects.release(inputID);
    await assert.rejects(
      w.runtime.native('main', 105, [w.nativeTaskID(planeID), 0], w.main.machine, w.main),
      /Native plane input enable service is unavailable/,
    );
    await assert.rejects(w.close({ flushFiles: false }), (error) => {
      assert(leaves(error).includes('Native plane input enable service is unavailable'));
      return true;
    });
    assert(w.closed);
    assert.equal(w.objects.objects.size, 0);
    assert.equal(w.inputFor(planeID), null);
  });
}
test('concurrent final World closes share one actual retirement pass', async () => {
  const { w, events } = await open(profiles[4]);
  await Promise.all([w.close({ flushFiles: false }), w.close({ flushFiles: false })]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].reply, { control: 2 });
  assert(w.closed);
  assert.equal(w.objects.objects.size, 0);
});
for (const profile of profiles.slice(3)) {
  test(
    profile + ' independent cold restores real Input ownership before final retirement',
    async () => {
      const first = await open(profile),
        originalInput = first.w.inputFor(first.planeID),
        saved = await deserializeCheckpoint(await serializeCheckpoint(first.w.snapshot()));
      await first.w.close({ flushFiles: false });
      const fresh = await open(profile, { checkpoint: saved });
      assert.notEqual(fresh.w.inputFor(fresh.planeID), originalInput);
      await fresh.w.close({ flushFiles: false });
      assert.equal(fresh.events.length, 1);
      assert.equal(fresh.events[0].inputTaskLive, false);
      assert.equal(fresh.events[0].inputStateLive, true);
      assert.deepEqual(fresh.events[0].reply, { control: 2 });
      assert(fresh.w.closed);
      assert.equal(fresh.w.objects.objects.size, 0);
      assert.equal(fresh.w.runtime.handles.records.size, 0);
      assert.equal(fresh.w.input.regions.length, 0);
      assert.equal(fresh.w.inputFor(fresh.planeID), null);
    },
  );
  test(
    profile + ' failed callback preserves sibling retirement and one shared close rejection',
    async () => {
      const { w, events, planeID } = await open(profile, {
        twoCallbacks: true,
        failFirstCallback: true,
      });
      const results = await Promise.allSettled([
        w.close({ flushFiles: false }),
        w.close({ flushFiles: false }),
      ]);
      assert(results.every((r) => r.status === 'rejected'));
      assert.equal(results[0].reason, results[1].reason);
      assert.deepEqual(leaves(results[0].reason), ['authored failure after actual Plane disable']);
      assert.equal(events.length, 2);
      assert.notEqual(events[0].task, events[1].task);
      assert(events.every((row) => !row.inputTaskLive && row.inputStateLive));
      assert(events.every((row) => row.reply.control === 2));
      assert.equal(events[1].error, undefined);
      assert(w.closed);
      assert.equal(w.objects.objects.size, 0);
      assert.equal(w.runtime.handles.records.size, 0);
      assert.equal(w.input.regions.length, 0);
      assert.equal(w.inputFor(planeID), null);
      await w.close({ flushFiles: false });
      assert.equal(events.length, 2);
    },
  );
}
