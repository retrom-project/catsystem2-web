// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const f = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk63-fes-named-private.json', import.meta.url)),
  ),
  target = new Set([631, 632, 664, 665, 666, 667, 668, 882, 883]),
  bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
async function open(initialize = true) {
  const inputs = Object.fromEntries(f.inputs.map(({ name, bytes: data }) => [name, bytes(data)])),
    w = await modernParticleMessageWorld(f.profile, inputs, {
      initialize,
      startup: parseXML(new TextDecoder().decode(inputs['startup.xml'])),
    });
  w.graphics.createLogicalDevice();
  return w;
}
for (const coldAt of [null, ...f.cold])
  test(`SDK63 named/private FES real parsed suppliers and colored consumers${coldAt === null ? '' : ' cold ' + coldAt}`, async () => {
    let w = await open(),
      parent = await w.spawnScript('registry-parent', { initialExecute: false }),
      phase = 0;
    const calls = [],
      packets = [];
    const child = (i) => {
      const id = w.resolveTaskID(parent.machine.load(i ? 48 : 44), parent.id);
      return { id, task: w.runtime.scheduler.tasks.get(id), record: w.objects.objects.get(id) };
    };
    const fes = (i) => {
      const s = child(i);
      const record =
        s.task && w.objects.objects.get(w.resolveTaskID(s.task.machine.load(44), s.id));
      return record?.kind === 34 ? record : null;
    };
    const role = (nativeID) => {
      for (const [i, name] of [
        [0, 'A'],
        [1, 'B'],
      ])
        if (child(i).task?.machine.load(44) === nativeID) return name;
      return nativeID;
    };
    function observe() {
      const dispatch = w.runtime.scheduler.dispatch.bind(w.runtime.scheduler);
      w.runtime.scheduler.dispatch = async (table, id, args, m, task, ...rest) => {
        const r = await dispatch(table, id, args, m, task, ...rest);
        if (table === 'main' && target.has(id))
          calls.push({
            phase,
            caller: child(0).id === task.id ? 'writer' : 'reader',
            id,
            args: [role(args[0]), ...args.slice(1)],
            control: r.control,
            written: r.control === 1,
            ...(r.control === 1 ? { value: r.value } : {}),
          });
        return r;
      };
      const send = w.sendNativeEngine.bind(w);
      w.sendNativeEngine = function (to, sender, message, a, b, context = {}) {
        if (message === 338)
          packets.push({
            phase,
            type: 'create36',
            bytes: Buffer.from(context.payload.bytes(a, 36)).toString('base64'),
            objectType: b,
          });
        if (message === 339)
          packets.push({
            phase,
            type: 'apply256x2',
            header: context.payload.string(a),
            row: context.payload.string(b),
          });
        return send(to, sender, message, a, b, context);
      };
    }
    async function compare() {
      const row = f.nativeRows.find((r) => r.phase === phase);
      for (let i = 0; i < 2; i++) {
        const s = child(i);
        assert.equal(Boolean(s.record), phase < 7);
        if (!s.record) continue;
        if (row?.children[i].words)
          assert.deepEqual(
            Array.from({ length: 13 }, (_, j) => s.task.machine.load(160 + 4 * j)),
            row.children[i].words,
          );
        const bank = w.runtime.variableBank(s.record, false);
        assert.equal(
          bank.context(s.id).words[0],
          i ? (phase < 2 ? 0 : 47) : phase ? 17 : 0,
          'two real Script registrations retain distinct private data',
        );
        const record = fes(i),
          active = phase >= (i ? 2 : 1) && phase < 5;
        assert.equal(Boolean(record), active, 'started FES retires before its supplier');
        if (!record) continue;
        const impl = record.implementation,
          core = impl.player;
        assert.equal(impl.runEnabled, true);
        assert.equal(core.nativeCoreGeneration, !i && phase >= 3 ? 2 : 1);
        assert.equal(core.root.collection.count('marker'), 2);
        assert.equal(core.root.collection.lookup('marker', 1).index, 1);
        assert.equal(core.root.collection.lookup('live').type, 'CPLANE');
        assert.equal(
          bank.context(impl.variableContextKey()).words[0],
          i ? 47 : phase === 1 ? 17 : phase === 2 ? 10 : 0,
        );
        assert.equal(core.root.resultValue, phase === 4 ? 0 : i ? 101 : phase === 2 ? 10 : 100);
        const dictionary = impl.nativeDictionary.snapshot();
        assert.equal(dictionary.length, 1);
        assert.deepEqual(Array.from(dictionary[0].key), [139, 164, 151, 76, 146, 108]);
        assert.equal(dictionary[0].value, i ? 31 : phase >= 3 ? 41 : 21);
      }
      if (f.rootSteps[phase].draw) {
        const draws = [];
        for (const item of w.graphics.tasks.values())
          if (item.record.kind === 2)
            await item.drawGPU({
              drawGeometry(triangles) {
                draws.push(triangles.map((t) => t.vertices.slice(0, 3)));
              },
            });
        assert.deepEqual(
          draws,
          f.draws.filter((r) => r.phase === phase).map((r) => r.triangles),
          'actual CPLANE driver and Root/View colored triangle consumer',
        );
      }
    }
    try {
      observe();
      for (phase = 0; phase < f.rootSteps.length; phase++) {
        const cues = f.rootSteps[phase];
        for (const [key, value] of Object.entries(cues)) {
          if (key === 'draw') continue;
          const task = key === 'parent' ? parent : child(key === 'writer' ? 0 : 1).task;
          assert.equal(
            (
              await w.runtime.native(
                'main',
                70,
                [w.nativeTaskID(task.id), f.tag, value, 0],
                parent.machine,
                parent,
              )
            ).value,
            1,
            'actual parent namespace queues a four-word copied packet',
          );
        }
        await w.objects.update(w.root, 700 + phase);
        if (cues.draw) await w.objects.drawTick(700 + phase);
        await compare();
        if (phase === coldAt) {
          const id = parent.id,
            snapshot = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
          await w.close({ flushFiles: false });
          w = await open(false);
          await w.restore(snapshot);
          parent = w.runtime.scheduler.tasks.get(id);
          observe();
          await compare();
        }
      }
      assert.deepEqual(
        calls,
        f.calls,
        'all nine original wrapper forms preserve control and actual writeback',
      );
      assert.deepEqual(
        packets,
        f.packets,
        'literal type/name/count packet and argv1-twice row semantics',
      );
      assert.equal(
        [...w.graphics.tasks.values()].filter((item) => item.record.kind === 2).length,
        0,
        'all dynamic CPLANE owners are released',
      );
      for (const id of target)
        assert.equal(nativeABI(f.profile).tables.main.entries[id].status, 'recovered');
      for (const id of [658, 659])
        assert.equal(nativeABI(f.profile).tables.main.entries[id].status, 'unknown');
    } finally {
      await w.close({ flushFiles: false });
    }
  });
