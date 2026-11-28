// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-particle-external.json', import.meta.url)),
  ),
  marker = 0x23532669;
const startup = Buffer.from(
  '<?xml version="1.0" encoding="Shift_JIS"?><document><INT><int00><name>ptcl</name><int>ptcl.int</int><ext>kcs</ext></int00><int01><name>image</name><int>images.int</int><ext>hg3</ext></int01></INT></document>',
);
const files = {
  'ptcl.int/probe.kcs': Buffer.from(golden.programBase64, 'base64'),
  'external.kcs': kcsProgram(
    [
      [37, marker],
      [43, 76, 0],
      [38, 44],
      ...golden.initialRegisters.flatMap((word, i) => [
        [37, word],
        [38, 1024 + i * 4],
      ]),
      ...golden.rows.flatMap((r) => [
        ...r.before,
        ...r.args.map((a) => [37, a]),
        [43, r.id, r.args.length * 4],
        ...(r.resultAddress === null ? [] : [[38, r.resultAddress]]),
        [43, 65, 0],
      ]),
      [37, 240],
      [43, 71, 4],
      [59],
    ],
    [
      [256, 'Normal graphics tail'],
      [320, 'probe'],
      [384, 'resource-image'],
      [448, 'external-source'],
    ],
  ),
};
async function world(initialize = true, extraFiles = {}) {
  const w = await dataWorld(golden.profile, { ...files, ...extraFiles }, { initialize });
  w.game.nativeResources = new NativeResources(parseNativeXML(startup, 'Shift_JIS'));
  w.graphics.createLogicalDevice();
  return w;
}
const string = (bytes, at, count) => {
  const part = bytes.subarray(at, at + count),
    end = part.indexOf(0);
  return new TextDecoder('shift_jis').decode(end < 0 ? part : part.subarray(0, end));
};
function packet(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    script: string(bytes, 4, 128),
    image: string(bytes, 132, 128),
    count: view.getUint32(260, true),
    priority: view.getUint32(264, true),
    registers: Array.from({ length: 32 }, (_, i) => view.getUint32(268 + i * 4, true)),
    externalFlag: view.getUint32(396, true),
    extraName: string(bytes, 400, 256),
  };
}
function compareBank(w, task, row) {
  const id = w.resolveTaskID(task.machine.load(40), task.id),
    particle = w.particles.get(id),
    bank = particle?.bank;
  if (!bank) return;
  assert.equal(Number(particle.active), row.active, row.label + ' active');
  assert.equal(bank.count, 2);
  assert.equal(bank.priority, 0);
  assert.equal(bank.externalDraw, true);
  assert.equal(bank.nativeAtlas.pointer, 0);
  if (row.id === 669 && row.args[0][1] === 40) {
    assert.equal(bank.program, row.packet.script);
    assert.equal(bank.extraName, row.packet.extraName);
    assert.deepEqual(
      [...new Uint32Array(bank.registers.buffer, bank.registers.byteOffset, 32)],
      row.packet.registers,
    );
  }
}
test('SDK23 Main669 real factory/VM packets preserve external source metadata, replacement and cold ownership', async (t) => {
  const w = await world();
  t.after(() => w.close({ flushFiles: false }));
  const task = await w.spawnScript('external.kcs', { parent: w.main.id, initialExecute: false }),
    floor = task.machine.sp;
  const wire = [],
    send = w.sendNativeEngine.bind(w);
  w.sendNativeEngine = (target, sender, message, wp, lp, context) => {
    if (message === 285) wire.push(packet(context.payload.bytes(0, 0x290).slice()));
    return send(target, sender, message, wp, lp, context);
  };
  for (const [index, row] of golden.rows.entries()) {
    await w.runtime.scheduler.execute(task);
    assert.equal(task.machine.load(floor), marker);
    assert.equal(task.machine.sp, floor + 4);
    if (row.result !== null)
      assert.equal(task.machine.load(row.resultAddress), row.result, row.label + ' result');
    if (row.id === 669)
      assert.deepEqual(wire.at(-1), row.packet, row.label + ' complete defined packet');
    compareBank(w, task, row);
    if (row.id === 669 && row.args[0][1] === 40) {
      const fresh = await world(false);
      try {
        await fresh.restore(structuredClone(w.snapshot()));
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        compareBank(fresh, restored, row);
        for (let next = index + 1; next < golden.rows.length; next++) {
          await fresh.runtime.scheduler.execute(restored);
          assert.equal(restored.machine.load(floor), marker);
          compareBank(fresh, restored, golden.rows[next]);
        }
        await fresh.objects.tick(100);
        assert.equal(fresh.particles.host.banks.size, 0);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  await w.objects.tick(100);
  assert.equal(w.particles.host.banks.size, 0);
});
test('the new external loader remains protected in other SDKs and for unreviewed receiver kinds', async (t) => {
  const w = await world();
  t.after(() => w.close({ flushFiles: false }));
  const task = w.main,
    m = task.machine;
  m.writeString('probe', 320);
  m.writeString('resource-image', 384);
  m.writeString('external-source', 448);
  m.bytes(1024, 128).fill(0);
  const draw = await w.objects.create({ kind: 15, parent: w.main.id });
  await assert.rejects(
    w.runtime.native('main', 669, [w.nativeTaskID(draw), 320, 384, 2, 1024, 448], m, task),
    /receiver kind/,
  );
  assert.equal(
    nativeABI('nekopara-vol3-engine-2.6.1.76').tables.main.entries[669].status,
    'unknown',
  );
  assert.equal(
    nativeABI('rebellions-jp-engine-2.6.1.63').tables.main.entries[669].status,
    'unknown',
  );
});

test('external packet names retain their defined bytes beyond the filename fields through cold restore', async (t) => {
  const name = 'x'.repeat(192),
    input = {
      'long-name.kcs': kcsProgram(
        [
          [37, marker],
          [43, 76, 0],
          [38, 44],
          ...Array.from({ length: 32 }, (_, i) => [
            [37, 0],
            [38, 1024 + i * 4],
          ]).flat(),
          ...[16, [0x13, 44], 256].map((word) => [37, word]),
          [43, 66, 12],
          [38, 40],
          ...[[0x13, 40], 320, 384, 2, 1024, 448].map((word) => [37, word]),
          [43, 669, 24],
          [38, 192],
          [43, 65, 0],
          [59],
        ],
        [
          [256, 'External name'],
          [320, 'probe'],
          [384, 'resource-image'],
          [448, name],
        ],
      ),
    },
    w = await world(true, input);
  t.after(() => w.close({ flushFiles: false }));
  const task = await w.spawnScript('long-name.kcs', { parent: w.main.id, initialExecute: false });
  await w.runtime.scheduler.execute(task);
  const id = w.resolveTaskID(task.machine.load(40), task.id);
  assert.equal(task.machine.load(192), 1);
  assert.equal(w.particles.get(id).bank.extraName, name);
  const fresh = await world(false, input);
  try {
    await fresh.restore(structuredClone(w.snapshot()));
    assert.equal(fresh.particles.get(id).bank.extraName, name);
  } finally {
    await fresh.close({ flushFiles: false });
  }
});
