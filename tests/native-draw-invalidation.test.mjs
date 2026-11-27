// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { floatBits } from '../src/kcs.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const profiles = [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
];
for (const profile of profiles)
  for (const retained of [false, true]) {
    const V = (n) => [0x13, n],
      call = (id, args, out) => [
        ...args.map((n) => [37, n]),
        [43, id, args.length * 4],
        ...(out === undefined ? [] : [[38, out]]),
      ],
      wait = () => call(71, [3968], 2360),
      bind = () =>
        call(retained ? 707 : 257, [
          V(68),
          7,
          V(retained ? 76 : 72),
          0,
          0,
          0,
          0,
          0,
          floatBits(1),
          floatBits(1),
          255,
          1,
          0,
        ]);
    const code = kcsProgram(
      [
        ...call(66, [1, V(64), 128], 60),
        ...call(66, [15, V(60), 128], 68),
        ...call(256, [V(68), 2, 2]),
        ...call(260, [V(68), 0, 0]),
        ...call(262, [V(68), 1]),
        ...(['rebellions-jp-engine-2.6.1.63', 'bokutomo-engine-2.6.1.67'].includes(profile)
          ? call(534, [V(68), 1])
          : []),
        ...call(112, [2, 2], 72),
        ...call(117, [V(72), 0, 0, 2, 2, 0xff204060]),
        ...wait(),
        ...bind(),
        ...call(340, [V(68)]),
        ...wait(),
        ...call(117, [V(72), 0, 0, 2, 2, 0xffa0c0e0]),
        ...wait(),
        ...call(340, [V(68)]),
        ...wait(),
        ...bind(),
        ...call(340, [V(68)]),
        ...wait(),
        ...call(258, [V(68), 7]),
        ...wait(),
        [59],
      ],
      [[128, 'Invalidation owner']],
    );
    const make = async (initialize = true) => {
      const w = await dataWorld(
        profile,
        { 'invalidation.kcs': code },
        {
          initialize,
          startup: parseNativeXML(
            encodeCP932(
              '<?xml version="1.0" encoding="Shift_JIS"?><document><SCREEN><width>8</width><height>8</height><v_width>8</v_width><v_height>8</v_height></SCREEN><TEXTURE><size><x>8</x><y>8</y></size><vt><x>1</x><y>1</y></vt><area00><sx>0</sx><sy>0</sy><dx>1</dx><dy>1</dy></area00><bpp32y>0</bpp32y><bpp16y>1</bpp16y><bpp>32</bpp></TEXTURE></document>',
            ),
          ),
        },
      );
      w.graphics.createLogicalDevice();
      return w;
    };
    async function close(w) {
      for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
      await w.close({ flushFiles: false });
    }
    async function next(w, t) {
      if (t.machine.waiting?.kind === 'message') await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
      else await w.runtime.scheduler.execute(t);
    }
    const draw = (w, t) =>
      w.objects.objects.get(w.resolveTaskID(t.machine.load(68), t.id)).implementation;
    async function pixels(w, t) {
      return [...(await w.graphics.images.get(draw(w, t).state.renderer.bitmap).pixels())];
    }
    test(
      profile +
        ' ' +
        (retained ? 'retained bitmap source' : 'direct bitmap entry') +
        ' requires explicit invalidation after pixel writes across independent cold',
      async () => {
        const w = await make();
        let source = 0;
        try {
          const t = await w.spawnScript('invalidation.kcs', {
            parent: w.main.id,
            initialExecute: false,
          });
          t.machine.store(64, w.nativeTaskID(t.id));
          const floor = t.machine.sp;
          await next(w, t);
          if (retained) {
            source = w.renderSources.create({
              bitmap: w.graphics.images.alias(t.machine.load(72)),
            });
            t.machine.store(76, source);
          }
          await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
          await w.sendEngine(t.id, t.id, 162, 0, 0);
          await next(w, t);
          const before = await pixels(w, t);
          assert.deepEqual(
            before,
            [32, 64, 96, 255, 32, 64, 96, 255, 32, 64, 96, 255, 32, 64, 96, 255],
          );
          await next(w, t);
          await w.objects.tick(1);
          await w.objects.drawTick(1);
          await next(w, t);
          assert.equal(t.machine.sp, floor);
          assert.deepEqual(
            await pixels(w, t),
            before,
            'a new bitmap generation is not an entry dirty notification',
          );
          const fresh = await make(false);
          try {
            await fresh.restore(
              await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
            );
            const restored = fresh.runtime.scheduler.tasks.get(t.id);
            assert.deepEqual(await pixels(fresh, restored), before);
            await next(fresh, restored);
            assert.deepEqual(
              await pixels(fresh, restored),
              [160, 192, 224, 255, 160, 192, 224, 255, 160, 192, 224, 255, 160, 192, 224, 255],
            );
            await next(fresh, restored);
            if (retained) await fresh.renderSources.release(source);
          } finally {
            await close(fresh);
          }
          await next(w, t);
          assert.deepEqual(
            await pixels(w, t),
            [160, 192, 224, 255, 160, 192, 224, 255, 160, 192, 224, 255, 160, 192, 224, 255],
          );
          await next(w, t);
          if (retained) {
            await w.renderSources.release(source);
            source = 0;
          }
        } finally {
          if (source && w.runtime.handles.records.has(source))
            await w.renderSources.release(source);
          await close(w);
        }
      },
    );
  }
