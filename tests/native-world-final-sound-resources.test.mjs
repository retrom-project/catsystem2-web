// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const V = (at) => [0x13, at],
  call = (id, args, out) => [
    ...args.map((v) => [37, v]),
    [43, id, args.length * 4],
    ...(out === undefined ? [] : [[38, out]]),
  ];
function labels(rows) {
  let pc = 0;
  const positions = new Map();
  for (const row of rows)
    if (typeof row === 'string') positions.set(row, pc);
    else pc += 1 + 5 * (row.length - 1);
  return rows
    .filter(Array.isArray)
    .map((row) => row.map((v) => (typeof v === 'string' ? positions.get(v) : v)));
}
const child = kcsProgram(
  labels([
    'wait',
    ...call(71, [240]),
    [39, 'wait'],
    [19, V(244), 0xffff0006],
    [39, 'wait'],
    ...call(156, [0]),
    ...call(68, [], 64),
    ...call(66, [2, V(64), 256], 68),
    [41, 'wait'],
  ]),
  [[256, 'callback child']],
);
const parent = (twoCallbacks) =>
  kcsProgram(
    [
      ...call(209, [512]),
      ...call(68, [], 64),
      ...call(66, [34, V(64), 256], 68),
      ...call(447, [V(68), 320]),
      ...call(66, [12, V(68), 384], 72),
      ...call(143, [V(72), 448, 0]),
      ...(twoCallbacks ? [...call(66, [12, V(68), 384], 76), ...call(143, [V(76), 448, 0])] : []),
      ...call(71, [240]),
      [59],
    ],
    [
      [256, 'ordinary FES'],
      [320, 'empty.fes'],
      [384, 'retirement Script'],
      [448, 'child.kcs'],
    ],
  );
const profiles = [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
];
const leaves = (error) => error.errors?.flatMap(leaves) ?? [error.message];

// These finite parsed callbacks isolate resource lifetime and allocation. The
// actual browser widget graph separately covers its real font/audio inputs;
// this fixture does not generate PCM or substitute an audio provider.
async function open(profile, { checkpoint, twoCallbacks = false, failCallback = false } = {}) {
  const w = await modernParticleMessageWorld(
    profile,
    {
      'main.kcs': parent(twoCallbacks),
      'child.kcs': child,
      'empty.fes': Buffer.from('#START\nnext WAIT\n#WAIT\n'),
    },
    { initialize: false },
  );
  if (checkpoint) await w.restore(checkpoint);
  else {
    await w.initialize('main.kcs');
    await w.objects.tick(2);
  }
  const soundID = w.objects.objects.get(w.root).implementation.sound,
    sound = w.sound.tasks.get(soundID),
    services = new Map([[soundID, sound]]),
    fesID = w.resolveTaskID(w.main.machine.load(68), w.main.id),
    events = [],
    created = [],
    native = w.runtime.native;
  assert(sound);
  w.runtime.native = async function (table, id, args, machine, task, ...rest) {
    const observed = table === 'main' && id === 156,
      top = observed ? w.engineMessages.closestTop(task.id) : null,
      actualSoundID = top?.implementation.sound,
      actualSound = w.sound.tasks.get(actualSoundID),
      event = observed
        ? {
            task: task.id,
            top: top.id,
            soundID: actualSoundID,
            recordPresent: w.objects.objects.has(actualSoundID),
            sameResource: !!actualSound && services.get(actualSoundID) === actualSound,
          }
        : null;
    if (event) events.push(event);
    const reply = await Reflect.apply(native, this, [table, id, args, machine, task, ...rest]);
    if (event) {
      event.reply = reply;
      if (failCallback) throw new Error('authored failure after normal Sound release');
    }
    if (table === 'main' && id === 66 && w.disposalRequested) created.push(reply.value);
    return reply;
  };
  return { w, soundID, sound, services, fesID, events, created };
}
function cleaned(w) {
  assert(w.closed);
  assert.equal(w.objects.objects.size, 0);
  assert.equal(w.sound.tasks.size, 0);
  assert.equal(w.runtime.handles.records.size, 0);
}
for (const profile of profiles) {
  test(
    profile + ' final parsed callbacks keep their actual Top Sound resource until completion',
    async () => {
      const { w, soundID, events, created } = await open(profile);
      await w.close({ flushFiles: false });
      assert.deepEqual(
        events.map(({ recordPresent, sameResource, reply }) => [
          recordPresent,
          sameResource,
          reply,
        ]),
        [[false, true, { control: 2 }]],
      );
      assert.equal(created.length, 1);
      assert.notEqual(created[0], soundID);
      cleaned(w);
      await w.close({ flushFiles: false });
      assert.equal(events.length, 1);
    },
  );
}
for (const profile of profiles.slice(3)) {
  test(profile + ' independent cold restores Sound ownership before final callbacks', async () => {
    const original = await open(profile),
      saved = await deserializeCheckpoint(await serializeCheckpoint(original.w.snapshot()));
    await original.w.close({ flushFiles: false });
    const fresh = await open(profile, { checkpoint: saved });
    assert.notEqual(fresh.sound, original.sound);
    await fresh.w.close({ flushFiles: false });
    assert.equal(fresh.events.length, 1);
    assert.equal(fresh.events[0].recordPresent, false);
    assert.equal(fresh.events[0].sameResource, true);
    cleaned(fresh.w);
  });
}
test('ordinary FES retirement keeps using its still-live Sound task', async () => {
  const { w, fesID, events } = await open(profiles[4]);
  try {
    await w.runtime.native('main', 67, [w.nativeTaskID(fesID)], w.main.machine, w.main);
    await w.objects.tick(3);
    assert.equal(events.length, 1);
    assert.equal(events[0].recordPresent, true);
    assert.equal(events[0].sameResource, true);
    assert(!w.objects.objects.has(fesID));
  } finally {
    await w.close({ flushFiles: false });
  }
  cleaned(w);
});
test('independent typed Tops retain their own Sound resources without changing native identity', async () => {
  const { w, services, events, created } = await open(profiles[4]),
    top = await w.objects.create({ kind: 1, parent: null, name: 'independent Top' }),
    soundID = w.objects.objects.get(top).implementation.sound;
  services.set(soundID, w.sound.tasks.get(soundID));
  const base = await w.objects.create({ kind: 0, parent: top, name: 'ordinary owner Base' });
  await w.spawnScript('child.kcs', { parent: base, initialExecute: true });
  await w.close({ flushFiles: false });
  assert.equal(events.length, 2);
  assert.deepEqual(new Set(events.map((event) => event.top)), new Set([w.root, top]));
  assert(events.every(({ recordPresent, sameResource }) => !recordPresent && sameResource));
  assert.equal(created.length, 2);
  assert(created.every((id) => !services.has(id)));
  cleaned(w);
});
test('a Sound service missing before shutdown still fails its ordinary guard', async () => {
  const { w, soundID } = await open(profiles[4]);
  await w.objects.release(soundID);
  await assert.rejects(
    w.runtime.native('main', 156, [0], w.main.machine, w.main),
    /Native base task does not expose its sound task/,
  );
  await assert.rejects(w.close({ flushFiles: false }), (error) => {
    assert(leaves(error).includes('Native base task does not expose its sound task'));
    return true;
  });
  cleaned(w);
});
test('failed parsed callbacks still release Sound resources and concurrent closes share rejection', async () => {
  const { w, events } = await open(profiles[4], { twoCallbacks: true, failCallback: true }),
    results = await Promise.allSettled([
      w.close({ flushFiles: false }),
      w.close({ flushFiles: false }),
    ]);
  assert(results.every(({ status }) => status === 'rejected'));
  assert.equal(results[0].reason, results[1].reason);
  assert(leaves(results[0].reason).includes('authored failure after normal Sound release'));
  assert.equal(events.length, 2);
  assert(events.every(({ recordPresent, sameResource }) => !recordPresent && sameResource));
  cleaned(w);
  await w.close({ flushFiles: false });
  assert.equal(events.length, 2);
});
