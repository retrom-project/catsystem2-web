// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const evidence = JSON.parse(
  await readFile(
    new URL('./fixtures/native-cross-build-script-notifications.json', import.meta.url),
  ),
);
const cases = evidence.profiles.map((row) => [row.profile, row.raw]);
const V = (at) => [0x13, at],
  call = (id, args, out) => [
    ...args.map((v) => [37, v]),
    [43, id, args.length * 4],
    ...(out === undefined ? [] : [[38, out]]),
  ];
const setup = [
  ...call(68, [], 64),
  ...call(66, [1, V(64), 256], 68),
  ...call(66, [12, V(64), 320], 72),
  ...call(143, [V(72), 384, 0]),
];
const waitPC = setup.reduce((n, row) => n + 1 + (row.length - 1) * 5, 0);
const parent = kcsProgram(
  [...setup, ...call(71, [512]), [41, waitPC]],
  [
    [256, 'separate Top'],
    [320, 'parsed recipient'],
    [384, 'recipient.kcs'],
  ],
);
const recipient = kcsProgram([
  [37, 240],
  [43, 71, 4],
  [41, 0],
]);
async function open(profile, checkpoint) {
  const w = await modernParticleMessageWorld(
    profile,
    { 'main.kcs': parent, 'recipient.kcs': recipient },
    { initialize: false },
  );
  if (checkpoint) await w.restore(checkpoint);
  else {
    await w.initialize('main.kcs');
    await w.objects.tick(2);
  }
  const m = w.main.machine,
    top = w.resolveTaskID(m.load(68), w.main.id),
    script = w.resolveTaskID(m.load(72), w.main.id);
  assert.equal(w.objects.objects.get(top).kind, 1);
  assert.equal(w.objects.objects.get(script).kind, 12);
  assert(w.runtime.scheduler.tasks.get(script).machine.waiting);
  const events = [],
    dispatch = w.engineMessages.dispatchNative;
  w.engineMessages.dispatchNative = async function (
    sender,
    target,
    message,
    first,
    second,
    context,
  ) {
    events.push({ sender, target, message, first, second, flags: context.flags ?? 0 });
    return Reflect.apply(dispatch, this, [sender, target, message, first, second, context]);
  };
  return { w, top, script, events };
}
async function verify(h, expected) {
  const { w, top, script, events } = h;
  for (const id of [script, top])
    for (const native of [570, 571, 572]) {
      const before = w.runtime.scheduler.tasks.get(script).machine.pc;
      assert.deepEqual(
        await w.runtime.native(
          'main',
          native,
          native === 571 ? [w.nativeTaskID(id), 0] : [w.nativeTaskID(id)],
          w.main.machine,
          w.main,
        ),
        { control: 2 },
      );
      assert.equal(
        w.runtime.scheduler.tasks.get(script).machine.pc,
        before,
        'ignored notification is not callback delivery',
      );
    }
  assert.deepEqual(
    events.map((e) => e.message),
    [...expected, ...expected],
  );
  assert(events.every((e) => e.first === 0 && e.second === 0 && e.flags === 0));
  assert.deepEqual(
    events.map((e) => e.target),
    [...new Array(3).fill(w.nativeTaskID(script)), ...new Array(3).fill(w.nativeTaskID(top))],
  );
}
for (const [profile, expected] of cases) {
  test(
    profile + ' sends its own raw notification namespace to actual loaded Script and factory Top',
    async () => {
      const h = await open(profile);
      try {
        await verify(h, expected);
      } finally {
        await h.w.close({ flushFiles: false });
      }
    },
  );
  test(
    profile +
      ' cold continuation retains ordinary recipient identity and native notification selectors',
    async () => {
      const first = await open(profile),
        saved = await deserializeCheckpoint(await serializeCheckpoint(first.w.snapshot()));
      await first.w.close({ flushFiles: false });
      const fresh = await open(profile, saved);
      try {
        await verify(fresh, expected);
      } finally {
        await fresh.w.close({ flushFiles: false });
      }
    },
  );
  test(
    profile + ' unproved owned Plane recipients stay guarded before any Script notification',
    async () => {
      const h = await open(profile);
      try {
        h.w.main.machine.writeString('other owned class', 640);
        const plane = await h.w.runtime.native(
          'main',
          66,
          [2, h.w.nativeTaskID(h.w.main.id), 640],
          h.w.main.machine,
          h.w.main,
        );
        h.events.length = 0;
        for (const id of [570, 571, 572])
          await assert.rejects(
            h.w.runtime.native(
              'main',
              id,
              id === 571 ? [plane.value, 0] : [plane.value],
              h.w.main.machine,
              h.w.main,
            ),
            /qualified Top or Script recipient/,
          );
        assert.equal(h.events.length, 0);
      } finally {
        await h.w.close({ flushFiles: false });
      }
    },
  );
}
