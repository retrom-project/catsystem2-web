// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  screenOracleWorld,
  ScreenVectorGPU,
  authoredScreenFrame,
  authorOracleCaptures,
} from '../fixtures/screen-effects-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { floatBits } from '../../src/kcs.mjs';
const probes = [
  { kind: 39, variant: 0, duration: 8 },
  { kind: 39, variant: 1, duration: 8 },
  { kind: 39, variant: 0, duration: 0 },
  { kind: 50, variant: 0, duration: 8 },
  { kind: 50, variant: 1, duration: 11 },
  { kind: 51, variant: 0, duration: 8 },
  { kind: 51, variant: 1, duration: 8 },
];
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' private screen working textures match integer oracle pixels',
    {
      skip:
        fixture.available &&
        (fixture.profile.startsWith('sdk-') || process.env.CATSYSTEM2_EMOTE_DLL)
          ? false
          : (fixture.reason ?? 'Missing private E-mote DLL'),
    },
    async (t) => {
      for (const probe of probes)
        await t.test(JSON.stringify(probe), async () => {
          const oracle = await screenOracleWorld(fixture),
            world = oracle.world,
            js = await dataWorld(fixture.profile),
            gpu = new ScreenVectorGPU(),
            old = authoredScreenFrame(),
            next = authoredScreenFrame(65, 49, true);
          let fresh;
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
            js.stageRenderer.gpu = gpu;
            js.graphics.d3dContext.depthStencilEnabled = true;
            await oracle.commands.apply(0x35a, [2], world.main.machine, world.main);
            authorOracleCaptures(oracle, [old, next]);
            js.screenEffects.rendering.prepare(2);
            js.screenEffects.rendering.captures.forEach((id, i) =>
              js.stageRenderer.writeSurface(id, i ? next : old),
            );
            const ids = [];
            for (const current of [world, js])
              ids.push(
                await current.objects.create({
                  kind: probe.kind,
                  parent: current.root,
                  name: 'Authored screen pixels',
                }),
              );
            let lastCommand;
            const invoke = (current, id, args) => {
              lastCommand = id;
              return current === world
                ? oracle.commands.apply(id, args, world.main.machine, world.main)
                : js.runtime.native('main', id, args, js.main.machine, js.main);
            };
            const setupErrors = [];
            for (const [index, current] of [world, js].entries()) {
              try {
                const target = current.nativeTaskID(ids[index]),
                  d = probe.duration,
                  lo = floatBits(0),
                  hi = floatBits(60000);
                if (probe.kind === 39) {
                  const mask = current.graphics.images.create(4, 3, current.main.id),
                    image = current.graphics.images.get(mask),
                    pixels = await image.pixels();
                  for (let i = 0; i < 12; i++)
                    pixels.set([i * 11, i * 7, (i * 23) & 255, 255], i * 4);
                  await image.changed();
                  await invoke(current, probe.variant ? 0x389 : 0x212, [target, d, lo, hi, mask]);
                  await current.graphics.images.release(mask);
                } else
                  await invoke(current, probe.kind === 50 ? 0x355 : 0x358, [
                    target,
                    d,
                    lo,
                    hi,
                    4,
                    probe.variant,
                    0,
                  ]);
                if (probe.kind === 50) await invoke(current, 0x356, [target]);
                await invoke(
                  current,
                  probe.kind === 39 ? 0x213 : probe.kind === 50 ? 0x357 : 0x359,
                  [target, 1],
                );
              } catch (error) {
                setupErrors[index] = { command: lastCommand, message: error.message };
              }
            }
            if (setupErrors.length) {
              t.diagnostic(JSON.stringify(setupErrors));
              assert.equal(
                setupErrors[1]?.command,
                setupErrors[0]?.command,
                'invalid-input command',
              );
              return;
            }
            let reference, actual;
            oracle.device.onDraw = (command) => {
              if (command.type === 'triangles' && command.texture)
                reference = oracle.device.frame(command.texture).rgba.slice();
            };
            const draw = js.screenEffects.rendering.drawFrame.bind(js.screenEffects.rendering);
            js.screenEffects.rendering.drawFrame = (frame, ...args) => {
              actual = frame.rgba?.slice();
              return draw(frame, ...args);
            };
            for (let frame = 1; frame <= 10; frame++) {
              await world.tick();
              await js.tick();
              let originalError, jsError;
              try {
                await oracle.effects.rendering.render(
                  [],
                  () => {},
                  () => 0,
                );
              } catch (error) {
                originalError = error;
              }
              try {
                await js.screenEffects.rendering.render(
                  [],
                  () => {},
                  () => 0,
                );
              } catch (error) {
                jsError = error;
              }
              if (originalError || jsError) {
                assert.equal(
                  Boolean(jsError),
                  Boolean(originalError),
                  'both execution paths must expose the same invalid-input failure',
                );
                t.diagnostic(
                  'invalid-input failure ' + originalError?.message + ' / ' + jsError?.message,
                );
                break;
              }
              assert.ok(reference && actual, 'both paths submit their private texture');
              const different = actual.findIndex((value, i) => value !== reference[i]);
              assert.equal(
                different,
                -1,
                'frame ' +
                  frame +
                  ' RGBA mismatch at ' +
                  different +
                  ', JS ' +
                  [...actual.slice(different, different + 16)] +
                  ', oracle ' +
                  [...reference.slice(different, different + 16)],
              );
              assert.equal(
                await js.sendEngine(ids[1], js.root, 377),
                await world.sendEngine(ids[0], world.root, 377),
                'frame ' + frame + ' activity',
              );
              if (frame === 4) {
                fresh = await dataWorld(fixture.profile, {}, { initialize: false });
                await fresh.restore(structuredClone(js.snapshot()));
                fresh.stageRenderer.gpu = new ScreenVectorGPU();
              } else if (fresh) {
                await fresh.tick();
                await fresh.screenEffects.rendering.render(
                  [],
                  () => {},
                  () => 0,
                );
                const source = js.objects.objects.get(ids[1]).implementation,
                  restored = fresh.objects.objects.get(ids[1]).implementation;
                assert.deepEqual(restored.state, source.state, 'fresh World task state');
                for (const id of source.state.work)
                  assert.deepEqual(
                    fresh.stageRenderer.surfacePixels(id),
                    js.stageRenderer.surfacePixels(id),
                    'fresh World working pixels',
                  );
              }
            }
          } finally {
            await fresh?.close();
            await js.close();
            await world.close({ flushFiles: false });
          }
        });
    },
  );
