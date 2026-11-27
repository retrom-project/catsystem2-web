// SPDX-License-Identifier: MPL-2.0
// Current JavaScript consumer controls only. Full native Application publication
// still requires its original Core thread and platform critical-section ownership.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-input-key-consumer.json', import.meta.url)),
);
const startup =
  '<?xml version="1.0" encoding="Shift_JIS"?><document><SCREEN><width>64</width><height>64</height><v_width>64</v_width><v_height>64</v_height></SCREEN><KEYCUSTOMIZE><key00><name>NormalKeyboard</name><keyboard1>65</keyboard1><rep_keyboard1>0</rep_keyboard1></key00></KEYCUSTOMIZE><INT><int00><name>kcs</name><int>scripts.int</int><ext>kcs</ext><dir>scripts-loose</dir></int00><int01><name>fes</name><int>tables.int</int><ext>fes</ext><dir>tables-loose</dir></int01></INT></document>';
const V = (at) => [0x13, at],
  call = (id, args, out) => [
    ...args.map((v) => [37, v]),
    [43, id, args.length * 4],
    ...(out === undefined ? [] : [[38, out]]),
  ];
const F = (n) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n);
  return b.readUInt32LE();
};
const strings = [
  [256, 'KeyPlane'],
  [320, 'IndependentOne'],
  [384, 'IndependentTwo'],
  [448, 'input-waiter'],
];
const plane = V(64),
  w1 = V(72),
  w2 = V(76),
  self = V(44);
const phases = [
  [
    ...call(209, [512]),
    ...call(68, [], 44),
    ...call(66, [2, self, 256], 64),
    ...call(66, [12, self, 320], 72),
    ...call(66, [12, self, 384], 76),
    ...call(143, [w1, 448, 0]),
    ...call(143, [w2, 448, 0]),
    ...call(79, [plane, F(12), F(10), 0xff203040]),
    ...call(95, [plane, 0x21]),
    ...call(110, [plane, w1]),
    ...call(108, [plane, 0]),
  ],
  [],
  [],
  [],
  [...call(110, [plane, w2])],
  [],
  [],
  [...call(99, [plane])],
  [...call(95, [plane, 0x21]), ...call(110, [plane, w1]), ...call(108, [plane, 0])],
  [],
  [...call(67, [plane])],
  [],
];
function labels(rows) {
  const at = new Map();
  let pc = 0;
  for (const r of rows)
    if (typeof r === 'string') at.set(r, pc);
    else pc += 1 + 5 * (r.length - 1);
  return rows
    .filter(Array.isArray)
    .map((r) => r.map((v) => (typeof v === 'string' ? at.get(v) : v)));
}
const program = kcsProgram(
  labels([
    ...phases.flatMap((p, i) => [...p, 'wait' + i, [37, 1000], [43, 71, 4], [39, 'wait' + i]]),
    [59],
  ]),
  strings,
);
const inputs = {
  'startup.xml': Buffer.from(startup),
  'config/startup.xml': Buffer.from(startup),
  'scripts.int': kif([
    ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
    ['input-g2.kcs', program],
    ['input-waiter.kcs', Buffer.from(golden.receiverProgram, 'base64')],
  ]),
  'tables.int': kif([
    ['first.fes', Buffer.from('#START\nnext IDLE\n#IDLE\n')],
    ['second.fes', Buffer.from('#START\nnext IDLE\n#IDLE\n')],
  ]),
};
async function open(profile, initialize = true) {
  const w = await modernParticleMessageWorld(profile, inputs, {
    initialize,
    startup: parseXML(startup),
  });
  w.graphics.createLogicalDevice();
  if (initialize) w.inputBindings = new NativeInputBindings(w.input, w.configuration);
  return w;
}
const event = (w, down) => w.inputBindings.keyboard({ code: 'KeyA', keyCode: 65 }, down);
function observe(w, caller) {
  return [72, 76].map((at) => {
    const id = w.resolveTaskID(caller.machine.load(at), caller.id),
      t = w.runtime.scheduler.tasks.get(id);
    assert(t);
    const count = t.machine.load(64);
    assert(count <= 24);
    return {
      id,
      count,
      keys: Array.from({ length: count }, (_, i) =>
        Array.from({ length: 4 }, (_, j) => t.machine.load(128 + 32 * i + 4 * j)),
      ).filter((p) => p[1] === 0xffff0003 || p[1] === 0xffff0004),
    };
  });
}
for (const profile of ['rebellions-jp-engine-2.6.1.63', 'bokutomo-engine-2.6.1.67'])
  for (const coldAt of [null, ...Array.from({ length: 12 }, (_, i) => i)])
    test(profile + ' current keyboard to independent parsed callbacks ' + coldAt, async () => {
      let w = await open(profile),
        t;
      try {
        assert.equal(w.nativeTaskID(w.root), 0, 'current primary Root is explicitly native0');
        t = await w.spawnScript('input-g2', { initialExecute: false });
        await w.runtime.native('main', 209, [512], t.machine, t);
        let taskID = t.id;
        for (let i = 0; i < 12; i++) {
          if (i === 0) await w.objects.update(t.id, 100);
          else {
            w.input.pointer(3, 3);
            if ([2, 5, 8].includes(i)) event(w, true);
            if ([3, 6, 9].includes(i)) event(w, false);
            w.inputBindings.sample();
            await w.objects.tick(100 + i);
            const packet = new Uint32Array([w.nativeTaskID(w.main.id), i, 0, 0]);
            await w.sendEngine(t.id, w.main.id, 172, 0, 0, {
              payload: {
                load: (at) => packet[at >>> 2],
                store: (at, v) => {
                  packet[at >>> 2] = v;
                },
              },
            });
          }
          if (i === coldAt) {
            const s = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
            await w.close({ flushFiles: false });
            w = await open(profile, false);
            await w.restore(s);
            t = w.runtime.scheduler.tasks.get(taskID);
          }
        }
        const rows = observe(w, t);
        assert.notEqual(rows[0].id, rows[1].id);
        assert(rows[0].keys.some((p) => p[1] === 0xffff0003));
        assert(rows[0].keys.some((p) => p[1] === 0xffff0004));
        assert(rows[1].keys.some((p) => p[1] === 0xffff0004));
        assert.equal(w.input.regions.length, 0);
      } finally {
        await w.close({ flushFiles: false });
      }
    });

for (const profile of ['rebellions-jp-engine-2.6.1.63', 'bokutomo-engine-2.6.1.67'])
  test(
    profile +
      ' current binding consumer reload and Core replacement retain the Device through cold',
    async () => {
      let w = await open(profile),
        caller;
      try {
        caller = await w.spawnScript('input-g2', { initialExecute: false });
        await w.runtime.native('main', 209, [512], caller.machine, caller);
        await w.objects.update(caller.id, 100);
        await w.objects.tick(101);
        const c = async (id, args) => w.runtime.native('main', id, args, caller.machine, caller),
          raw = (at) => caller.machine.load(at),
          nativeCaller = w.nativeTaskID(caller.id);
        const w2 = w.resolveTaskID(raw(76), caller.id),
          oldMachine = w.runtime.scheduler.tasks.get(w2).machine;
        await c(143, [raw(76), 448, 0]);
        assert.notEqual(w.runtime.scheduler.tasks.get(w2).machine, oldMachine);
        caller.machine.writeString('normal input Core', 512);
        const fes = (await c(66, [34, nativeCaller, 512])).value;
        caller.machine.writeString('first', 576);
        await c(447, [fes, 576]);
        const device = w.inputBindings;
        caller.machine.writeString('second', 576);
        await c(447, [fes, 576]);
        assert.equal(w.inputBindings, device);
        await c(110, [raw(64), raw(76)]);
        await w.objects.tick(102);
        const snapshot = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
          id = caller.id;
        await w.close({ flushFiles: false });
        w = await open(profile, false);
        await w.restore(snapshot);
        caller = w.runtime.scheduler.tasks.get(id);
        assert.notEqual(w.inputBindings, device);
        assert.equal(w.nativeTaskID(w.root), 0);
        assert.equal(w.configuration.keys.rows[0].keyboard[0], 65);
        assert.notEqual(w.runtime.scheduler.tasks.get(w2).machine, oldMachine);
        event(w, true);
        w.inputBindings.sample();
        await w.objects.tick(103);
        event(w, false);
        w.inputBindings.sample();
        await w.objects.tick(104);
        w.inputBindings.sample();
        await w.objects.tick(105);
        const rows = observe(w, caller);
        assert.equal(rows[0].keys.length, 0);
        assert(rows[1].keys.some((p) => p[1] === 0xffff0003));
        assert(rows[1].keys.some((p) => p[1] === 0xffff0004));
        await c(67, [caller.machine.load(64)]);
        await c(67, [fes]);
        w.inputBindings.sample();
        await w.objects.tick(106);
        assert.equal(w.input.regions.length, 0);
      } finally {
        await w.close({ flushFiles: false });
        assert.equal(w.objects.objects.size, 0);
      }
    },
  );
