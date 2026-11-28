// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(
    new URL('./fixtures/native-cross-build-configuration-checkpoint.json', import.meta.url),
  ),
);
const marker = 0xa176c1c2;
for (const f of fixture.cases)
  for (const cold of [null, ...f.cold])
    test(`current SDK${f.version} configuration owner checkpoint${cold === null ? '' : ' cold ' + cold}`, async () => {
      const files = Object.fromEntries(
        f.inputs.map(({ name, bytes }) => [name, Uint8Array.from(Buffer.from(bytes, 'base64'))]),
      );
      const open = async (initialize) =>
        modernParticleMessageWorld(f.profile, files, {
          initialize,
          startup: parseXML(new TextDecoder().decode(files['startup.xml'])),
        });
      let w = await open(true),
        owner = await w.spawnScript('config-owner', { initialExecute: false }),
        phase = 0;
      const frees = [];
      function observe() {
        const dispatch = w.runtime.scheduler.dispatch.bind(w.runtime.scheduler);
        w.runtime.scheduler.dispatch = async (...args) => {
          const before = args[3]?.blockIDs?.length;
          const reply = await dispatch(...args);
          if (args[0] === 'main' && args[1] === 28 && args[4].id === owner.id) {
            assert.equal(reply.value, 1, 'owned block release succeeds');
            assert.equal(
              args[3].blockIDs.length,
              before - 1,
              'release removes that owned allocation',
            );
            frees.push(phase);
          }
          return reply;
        };
      }
      const words = (m, at, n) => Array.from({ length: n }, (_, i) => m.load(at + 4 * i));
      async function compare() {
        const record = w.objects.objects.get(owner.id),
          n = f.thin ? 1 : 4;
        assert.equal(!!record, phase < n);
        if (!record) return;
        const m = owner.machine;
        assert.equal(m.load(128), 128);
        assert.equal(m.load(140), 3);
        assert.equal(m.load(144), 0);
        assert.equal(m.load(160), 129);
        assert.equal(m.string(1024), 'max=128 log=3 author=0');
        assert.equal(w.configuration.variableCount, 128);
        assert.equal(w.configuration.getField('scene.staticLog'), 3);
        if (f.thin) return;
        assert.deepEqual(words(m, 880, 7), [0, 7, 46, 9, 7, marker, marker]);
        assert.equal(m.load(152), 1);
        assert.equal(m.load(156), 0);
        const sizes = nativeABI(f.profile).configuration.blockSizes;
        if (phase >= 1) {
          const expected = new Uint8Array(5628),
            view = new DataView(expected.buffer);
          [phase >= 2 ? 20 : 25, 30, 40, 50, 1].forEach((v, i) => view.setUint32(i * 4, v, true));
          assert.deepEqual(w.configuration.blocks[0], expected);
          assert.equal(
            new DataView(w.configuration.blocks[1].buffer).getUint32(0, true),
            phase >= 2 ? 2 : 4,
          );
          assert.equal(
            new DataView(w.configuration.blocks[2].buffer).getUint32(0, true),
            phase >= 2 ? 1 : 0,
          );
          assert.deepEqual(
            [...w.configuration.blocks[3]],
            [255, 255, 255, 100, 1, 0, 0, 0, 1, 0, 0, 0],
          );
          assert.equal(m.load(192), 35);
          assert.equal(m.string(1152), 'live=25 speed=4');
          if (phase < 3) {
            view.setUint32(0, 25, true);
            assert.deepEqual(
              m.bytes(m.load(68), 5628),
              expected,
              'earlier copied owner remains independent',
            );
            if (phase === 2) {
              view.setUint32(0, 20, true);
              assert.deepEqual(m.bytes(m.load(76), 5628), expected);
            }
          }
        }
        if (phase >= 2) {
          assert.equal(m.load(204), 30);
          assert.equal(m.string(1216), 'old=25 new=20');
        }
        if (phase === 3) {
          const expected = new Uint8Array(5628),
            v = new DataView(expected.buffer);
          [20, 30, 40, 50, 1].forEach((x, i) => v.setUint32(i * 4, x, true));
          expected.set(w.configuration.blocks[1]);
          expected.set(w.configuration.blocks[2]);
          expected.set(w.configuration.blocks[3]);
          assert.deepEqual(
            m.bytes(576, 80),
            expected.subarray(0, 80),
            'four legitimate alias destinations retain native copy order',
          );
        }
        if (f.version === '76') {
          assert.equal(m.load(168), 1);
          assert.equal(m.load(172), 1);
          assert.equal(m.load(184), 1723);
          assert.equal(m.string(1664), '1723');
          assert.equal(m.string(1536), phase === 3 ? 'jp' : 'en');
          if (phase === 3) {
            assert.equal(m.load(216), 2735);
            assert.equal(m.string(1728), '2735');
          }
          for (const id of [361, 533])
            assert.equal(
              nativeABI(f.profile).tables.main.entries[id].status,
              'unknown',
              'unproved modern preference/application behavior stays guarded',
            );
        }
        assert.deepEqual(sizes, [
          5628,
          f.version === '76' ? 72 : 60,
          f.version === '76' ? 32 : 28,
          12,
        ]);
      }
      try {
        observe();
        const n = f.thin ? 1 : 4;
        for (phase = 0; phase <= n; phase++) {
          if (phase && phase < n && ['63', '67'].includes(f.version))
            assert.equal(
              (
                await w.runtime.native(
                  'main',
                  70,
                  [w.nativeTaskID(owner.id), fixture.tag, phase, 0],
                  owner.machine,
                  owner,
                )
              ).value,
              1,
            );
          if (phase === n)
            await w.runtime.native('main', 67, [w.nativeTaskID(owner.id)], owner.machine, owner);
          await w.objects.update(w.root, 700 + phase);
          await compare();
          if (phase === cold) {
            const id = owner.id,
              snapshot = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
            await w.close({ flushFiles: false });
            w = await open(false);
            await w.restore(snapshot);
            owner = w.runtime.scheduler.tasks.get(id);
            observe();
            await compare();
          }
        }
        if (!f.thin) assert.deepEqual(frees, [1, 2, 3, 3]);
      } finally {
        await w.close({ flushFiles: false });
      }
    });
