// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk63-67-motion-secondary-golden.json', import.meta.url)),
  ),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const offsets = { manager: 64, clock: 68, active: 72, rebound: 76 };
const instructions = [
  [37, 0x63a7952f],
  ...golden.init.flatMap(([at, word]) => [
    [37, word],
    [38, at],
  ]),
  ...golden.rows.flatMap((r, i) => [
    ...r.args.map((x) => [37, typeof x === 'string' ? [0x13, offsets[x]] : x]),
    [43, r.id, r.args.length * 4],
    ...(r.out
      ? [[38, offsets[r.out]]]
      : r.id === 309 || r.id === 307 || r.id === 310 || r.id === 311 || r.id === 440
        ? [[38, 96]]
        : []),
    ...(i < golden.rows.length - 1
      ? [
          [37, 240],
          [43, 71, 4],
        ]
      : []),
  ]),
  [59],
];
async function open(build, initialize = true) {
  return dataWorld(
    build.profile,
    {
      'secondary.kcs': kcsProgram(instructions),
      ...Object.fromEntries(Object.entries(golden.motions).map(([n, s]) => [n, bytes(s)])),
    },
    { initialize },
  );
}
async function compare(w, t, expected, id) {
  if (expected.out) assert(t.machine.load(offsets[expected.out]));
  else if (expected.control === 1)
    assert.equal(t.machine.load(96), expected.result, expected.label + ' result');
  assert.equal(t.machine.load(t.machine.floor), 0x63a7952f, 'stack sentinel/control');
  if (!expected.state) {
    assert(!w.runtime.handles.records.has(id));
    return;
  }
  const m = await w.runtime.services.motion.get(id),
    s = expected.state;
  assert.deepEqual(m.base, bytes(s.base), expected.label + ' base');
  if (s.working) assert.deepEqual(m.readBank(true), bytes(s.working), expected.label + ' working');
  for (const key of ['nextHandle', 'speedWord', 'flags'])
    assert.equal(m[key], s[key], expected.label + ' ' + key);
  assert.equal(m.records.size, s.records.length);
  for (const r of s.records) {
    const a = m.records.get(r.handle),
      i = a.instance;
    assert.equal(a.startTick, r.start, expected.label + ' start');
    assert.equal(a.group, r.group);
    assert.equal(i.script.recordName, r.name);
    const shared = i.shared.slice();
    if (!r.ran) shared.fill(0, 0, 148);
    assert.deepEqual(shared, bytes(r.shared), expected.label + ' known MOT shared ' + r.handle);
    for (const key of ['pc', 'sp', 'fp'])
      assert.equal(i.machine[key], r[key], expected.label + ' ' + key);
    if (r.local) assert.deepEqual(i.machine.bytes(64, 8), bytes(r.local));
  }
}
for (const b of golden.builds)
  for (const coldAt of [null, 4, 8, 13, 18, 21, 28, 31, 34])
    test(
      'SDK' +
        b.version +
        ' actual secondary/clock record chain' +
        (coldAt === null ? '' : ' cold after ' + coldAt),
      async () => {
        let w = await open(b),
          t = await w.spawnScript('secondary.kcs', { parent: w.main.id, initialExecute: false }),
          manager;
        try {
          for (let k = 0; k < b.rows.length; k++) {
            if (t.machine.waiting?.kind === 'message')
              await w.runtime.scheduler.send(t.id, [240, 0, 0, 0]);
            else await w.runtime.scheduler.execute(t);
            if (k === 0) manager = t.machine.load(64);
            await compare(w, t, b.rows[k], manager);
            if (k === coldAt) {
              const id = t.id,
                state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
              await w.close({ flushFiles: false });
              w = await open(b, false);
              await w.restore(state);
              t = w.runtime.scheduler.tasks.get(id);
              await compare(w, t, b.rows[k], manager);
            }
          }
        } finally {
          await w.close({ flushFiles: false });
        }
      },
    );
