// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-fes-context-registry.json', import.meta.url)),
);
for (const f of fixture.cases)
  for (const cold of [null, ...f.cold])
    test(`SDK${f.version} actual parsed FES context/registry consumers${cold === null ? '' : ' cold ' + cold}`, async () => {
      const inputs = Object.fromEntries(
        f.inputs.map(({ name, bytes }) => [name, Uint8Array.from(Buffer.from(bytes, 'base64'))]),
      );
      const open = async (initialize) => {
        const w = await modernParticleMessageWorld(f.profile, inputs, {
          initialize,
          startup: parseXML(new TextDecoder().decode(inputs['startup.xml'])),
        });
        w.graphics.createLogicalDevice();
        return w;
      };
      let w = await open(true),
        parent = await w.spawnScript('context-parent', { initialExecute: false }),
        phase = 0;
      const force = [],
        wrapped = new WeakSet();
      function observe() {
        function wrap() {
          for (const draw of w.graphics.drawTasks.values())
            if (!wrapped.has(draw)) {
              wrapped.add(draw);
              const message = draw.message.bind(draw);
              draw.message = (words, ...rest) => {
                if (words[1] === 292) force.push(phase);
                return message(words, ...rest);
              };
            }
        }
        wrap();
        const dispatch = w.runtime.scheduler.dispatch.bind(w.runtime.scheduler);
        w.runtime.scheduler.dispatch = async (...args) => {
          const reply = await dispatch(...args);
          wrap();
          return reply;
        };
      }
      function child(i) {
        const id = w.resolveTaskID(parent.machine.load(i ? 48 : 44), parent.id);
        return { id, record: w.objects.objects.get(id), task: w.runtime.scheduler.tasks.get(id) };
      }
      async function compare() {
        const row = f.nativeRows[phase];
        for (let i = 0; i < row.children.length; i++) {
          const native = row.children[i],
            s = child(i);
          assert.equal(Boolean(s.record), native.alive, 'actual supplier lifetime');
          if (!native.alive) continue;
          assert.equal(s.task.machine.pc, native.pc);
          assert.deepEqual(
            Array.from({ length: 21 }, (_, n) => s.task.machine.load(160 + n * 4)),
            native.words,
          );
          assert.deepEqual(
            [...s.task.machine.bytes(1536, 32)],
            native.contextOut,
            'normal CP932 context publisher and inherited Main454 output',
          );
          const bank = w.runtime.variableBank(s.record, false);
          assert.equal(bank.context(s.id).words[0], f.currentPrivate[phase][i][0]);
          const record = w.objects.objects.get(w.resolveTaskID(s.task.machine.load(44), s.id));
          assert.equal(record?.kind === 34, Boolean(native.fes?.alive));
          if (record?.kind !== 34) continue;
          const impl = record.implementation,
            root = impl.player.root;
          assert.equal(impl.runEnabled, true);
          assert.equal(
            bank.context(impl.variableContextKey()).words[0],
            f.currentPrivate[phase][i][1],
          );
          if (!i) {
            assert.equal(impl.player.nativeCoreGeneration, phase >= 3 ? 2 : 1);
            assert.equal(root.collection.count('marker'), 2);
            assert.equal(root.collection.lookup('marker', 1).nativeType, 0);
            assert.equal(root.collection.lookup('live').nativeType, 3);
            assert.equal(root.collection.lookup('live').pri, 5000, 'real named PRI initializer');
          }
        }
        if ([2, 3].includes(phase)) {
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
            f.draws.filter((d) => d.phase === phase).map((d) => d.triangles),
            'actual CPLANE and original COM-memory geometry',
          );
        }
      }
      try {
        observe();
        await w.sendEngine(parent.id, parent.id, 26, 0, 1024, { payload: parent.machine });
        for (phase = 0; phase < f.nativeRows.length; phase++) {
          await w.objects.update(w.root, 700 + phase);
          if ([2, 3].includes(phase)) await w.objects.drawTick(700 + phase);
          await compare();
          if (phase === cold) {
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
        assert.deepEqual(force, f.forcePhases, 'real native Draw force receiver ordering');
        assert.equal(w.graphics.drawTasks.size, 0, 'all bound Draw owners released');
      } finally {
        await w.close({ flushFiles: false });
      }
    });
