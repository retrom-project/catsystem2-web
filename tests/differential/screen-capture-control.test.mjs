// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { screenOracleWorld, ScreenVectorGPU } from '../fixtures/screen-effects-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { floatBits } from '../../src/kcs.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' capture limits and empty preparation match the oracle sequence',
    {
      skip:
        fixture.available &&
        (fixture.profile.startsWith('sdk-') || process.env.CATSYSTEM2_EMOTE_DLL)
          ? false
          : (fixture.reason ?? 'Missing private E-mote DLL'),
    },
    async () => {
      const oracle = await screenOracleWorld(fixture),
        world = oracle.world,
        js = await dataWorld(fixture.profile),
        r = js.screenEffects.rendering;
      try {
        Object.assign(js.configuration.screen, {
          width: 65,
          height: 49,
          currentWidth: 65,
          currentHeight: 49,
        });
        js.graphics.view.configure({
          clientWidth: 65,
          clientHeight: 49,
          drawingRectangle: [0, 0, 65, 49],
        });
        js.stageRenderer.gpu = new ScreenVectorGPU();
        const call = (current, id, args) =>
            current === world
              ? oracle.commands.apply(id, args, world.main.machine, world.main)
              : js.runtime.native('main', id, args, js.main.machine, js.main),
          captureState = () => {
            const p = world.nativeEngine.process,
              metadata = p.load(oracle.effects.platform.refs.renderer + 1560);
            return [Boolean(metadata), metadata ? p.load(metadata + 20) : 0];
          },
          equal = (label) =>
            assert.deepEqual([r.prepared, r.captures.length], captureState(), label);
        r.prepare(1);
        for (const count of [0, 1, 2, 3, -1]) {
          assert.deepEqual(await call(js, 0x35a, [count]), await call(world, 0x35a, [count]));
          equal('prepare ' + count);
        }
        for (const current of [world, js]) {
          const id = await current.objects.create({
            kind: 39,
            parent: current.root,
            name: 'Release captures',
          });
          await current.objects.release(id);
        }
        equal('released shared targets');
        for (const current of [world, js]) await call(current, 0x35a, [0]);
        equal('prepared zero targets');
        assert.equal(r.prepared, true);
        assert.deepEqual(
          await call(js, 0x35b, [0, floatBits(0), floatBits(60000)]),
          await call(world, 0x35b, [0, floatBits(0), floatBits(60000)]),
          'zero-slot capture is a no-op',
        );
        for (const current of [world, js]) {
          current.configuration.fields.general.renderTargetCount = 4;
          await call(current, 0x35a, [3]);
        }
        equal('configured three targets');
        assert.equal(r.captures.length, 3);
        for (const current of [world, js])
          await call(current, 0x35b, [2, floatBits(0), floatBits(60000)]);
        equal('third target capture');
        for (const current of [world, js]) {
          current.configuration.fields.general.renderTargetCount = 0;
          await call(current, 0x35a, [1]);
        }
        equal('disabled allocation preserves existing targets');
      } finally {
        await js.close();
        await world.close({ flushFiles: false });
      }
    },
  );
