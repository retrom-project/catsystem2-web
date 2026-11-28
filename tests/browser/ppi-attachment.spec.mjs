// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { kcsProgram } from '../helpers.mjs';
import { routeGraphicsOracle } from '../fixtures/oracle-browser-routes.mjs';

for (const [profile, variable, prepare] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x4d0da0],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x5f6560],
])
  test(
    profile + ' native PPI attachment follows KX2 and survives loss of its graph',
    async ({ page }) => {
      const sdk = profile.startsWith('sdk-'),
        { CATSYSTEM2_EMOTE_DLL, CATSYSTEM2_PPI_FIXTURES } = process.env;
      test.skip(
        !process.env[variable] || !CATSYSTEM2_PPI_FIXTURES || (!sdk && !CATSYSTEM2_EMOTE_DLL),
      );
      test.setTimeout(180000);
      const golden = JSON.parse(
          await readFile(new URL('../fixtures/ppi-attachment-golden.json', import.meta.url)),
        ),
        rgba = new Uint8Array(64 * 64 * 4);
      for (let i = 0; i < rgba.length; i += 4) rgba.set([245, 20, 56, 255], i);
      const [exe, plugin, atlas] = await Promise.all([
        readFile(process.env[variable]),
        readFile(resolve(CATSYSTEM2_PPI_FIXTURES, golden.plugin)),
        encodeHG2({ width: 64, height: 64, rgba }, { crop: false }),
      ]);
      expect(createHash('sha256').update(plugin).digest('hex')).toBe(golden.pluginSHA256);
      const files = new Map([
        ['engine.exe', exe],
        [golden.plugin, plugin],
        ['question.hg2', atlas],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      ]);
      if (!sdk) files.set('emotedriver.dll', await readFile(CATSYSTEM2_EMOTE_DLL));
      await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
        route.fulfill({
          path: new URL('../fixtures/browser-native-world.mjs', import.meta.url).pathname,
          contentType: 'text/javascript',
        }),
      );
      await page.route('**/ppi-attachment-fixture/**', (route) => {
        const name = decodeURIComponent(
            new URL(route.request().url()).pathname.slice('/ppi-attachment-fixture/'.length),
          ),
          bytes = files.get(name);
        return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
      });
      await routeGraphicsOracle(page);
      await page.goto('/');
      const result = await page.evaluate(
        async ({ profile, names, plugin, prepare, crops, cropSize }) => {
          const { installGraphicsOracle } = await import(
            '/tests/fixtures/graphics-oracle-world.mjs'
          );
          const [
              { browserNativeWorld, placeBrowserNativePlane },
              { NativeGraphicsPacket },
              { floatBits },
            ] = await Promise.all([
              import('/tests/fixtures/browser-native-world.mjs'),
              import('/src/native/graphics-task.mjs'),
              import('/src/kcs.mjs'),
            ]),
            files = new Map(
              await Promise.all(
                names.map(async (name) => [
                  name,
                  new Uint8Array(
                    await (
                      await fetch('/ppi-attachment-fixture/' + encodeURIComponent(name))
                    ).arrayBuffer(),
                  ),
                ]),
              ),
            ),
            width = 320,
            height = 240,
            make = () =>
              browserNativeWorld({
                profile,
                files,
                width,
                height,
                storage: { read: async () => null, write: async () => true },
              }),
            world = make(),
            referenceWorld = installGraphicsOracle(make()),
            texture = world.configuration.fields.texture,
            digest = async (bytes) =>
              Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
                byte.toString(16).padStart(2, '0'),
              ).join(''),
            phases = [];
          texture.size.set([64, 64]);
          texture.grid.set([1, 1]);
          texture.bppY.set([1, 1]);
          texture.areas[0].set([0, 0, 1, 1]);
          referenceWorld.configuration.restore(world.configuration.snapshot());
          let fresh;
          try {
            await world.initialize('main.kcs');
            await referenceWorld.initialize('main.kcs');
            world.random.integer.seed(4357);
            world.random.real.seed(4357);
            const call = (current, id, args) =>
                current.runtime.native('main', id, args, current.main.machine, current.main),
              create = async (kind, name) => {
                world.main.machine.writeString(name, 128);
                const { value } = await call(world, 0x42, [
                  kind,
                  world.nativeTaskID(world.root),
                  128,
                ]);
                return world.resolveTaskID(value, world.main.id);
              },
              ground = await create(2, 'ground'),
              anchor = await create(2, 'KX2 anchor'),
              effect = await create(16, 'attached effect');
            await placeBrowserNativePlane(world, ground, {
              width,
              height,
              color: 0xff163456,
              priority: 1000,
            });
            await referenceWorld.objects.create({
              kind: 2,
              parent: referenceWorld.root,
              name: 'reference ground',
            });
            const referenceAnchor = await referenceWorld.objects.create({
              kind: 2,
              parent: referenceWorld.root,
              name: 'reference anchor',
            });
            const applyOne = async (
              current,
              anchor,
              base,
              position,
              shown,
              createModel = false,
            ) => {
              if (createModel)
                await placeBrowserNativePlane(current, anchor, {
                  width: 24,
                  height: 18,
                  color: 0xff405020,
                  priority: 1500,
                });
              const send = (message, values) =>
                current.sendEngine(anchor, current.main.id, message, 0, 0, {
                  payload: new NativeGraphicsPacket(values.map(floatBits)),
                });
              await send(49, base);
              await send(51, position);
              await send(57, [1, 0.25, 0, 0, -0.125, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
              await send(66, [1.25, 0.75, 1]);
              await current.sendEngine(anchor, current.main.id, 48, 0, Number(shown));
            };
            const apply = async (current, ...args) => {
              await applyOne(current, anchor, ...args);
              await applyOne(referenceWorld, referenceAnchor, ...args);
            };
            await apply(world, [7.25, 9.5, 1500], [142, 180, 0], true, true);

            const graph = world.graphics.graphHandle(anchor),
              nativeID = world.nativeTaskID(effect),
              machine = world.main.machine,
              registers = Array(32).fill(1);
            [registers[0], registers[1], registers[3]] = [160, 120, 100];
            machine.writeString(plugin, 160);
            machine.writeString('question.hg2', 192);
            registers.forEach((value, i) => machine.store(256 + 4 * i, floatBits(value)));
            const loaded = await call(world, 0x2b5, [nativeID, 160, 192, 1, floatBits(3000), 256]);
            const bank = (current) => current.particles.get(effect).bank,
              fields = (current) => {
                const instance = bank(current).instance;
                const bytes = new Uint8Array(32),
                  view = new DataView(bytes.buffer);
                view.setInt32(0, instance.attachPlane, true);
                [...instance.attachBase, ...instance.attachPos].forEach((value, n) =>
                  view.setFloat32(4 + n * 4, value, true),
                );
                view.setInt32(28, instance.attachDisp, true);
                return bytes;
              };
            let reference = fields(world);
            const originalFields = async (_current, graphID) => {
              const engine = referenceWorld.nativeEngine,
                p = engine.process,
                view = engine.features.get('graphics-platform').refs.view,
                shell = p.allocate(0x360, true),
                object = p.allocate(52, true),
                saved = p.registers();
              try {
                p.store(shell + 104, view);
                p.store(
                  shell + 812,
                  graphID === -1 ? -1 : referenceWorld.nativeTaskID(referenceAnchor),
                );
                p.write(object + 20, reference);
                // The mounted native plane origin selects the original graph getters.
                await engine.call(prepare, [object], shell, { task: ground });
                reference = p.read(object + 20, 32);
              } finally {
                p.writeRegisters(saved);
                p.free(object);
                p.free(shell);
              }
            };
            const renderVertices = async (current) => {
              let vertices;
              const gpu = current.stageRenderer.gpu,
                drawGeometry = gpu.drawGeometry;
              gpu.drawGeometry = function (geometry, image, options) {
                if (image === bank(current).image)
                  vertices = geometry.flatMap(({ vertices }) =>
                    vertices.flatMap((v) => [
                      floatBits(v.x),
                      floatBits(v.y),
                      floatBits(v.z),
                      floatBits(v.w),
                      v.color,
                      floatBits(v.u),
                      floatBits(v.v),
                    ]),
                  );
                return drawGeometry.call(this, geometry, image, options);
              };
              try {
                await current.stageRenderer.render(
                  current.graphics.stage,
                  null,
                  current.particles.drawItems(),
                );
              } finally {
                gpu.drawGeometry = drawGeometry;
              }
              return vertices;
            };
            const phase = async (current, name, action, { refresh = true, id = graph } = {}) => {
              if (refresh) await originalFields(current, id);
              await action();
              const currentBank = bank(current),
                p = currentBank.instance,
                row = {
                  name,
                  frame: p.frame,
                  before: p.before,
                  active: p.active,
                  attachment: [...fields(current)],
                  original: [...reference],
                  records: await digest(p.records()),
                };
              if (crops[name]) {
                row.vertices = await renderVertices(current);
                const gpu = current.stageRenderer.gpu;
                const pixels = gpu.pixels(),
                  [x, y] = crops[name];
                row.hash = await digest(pixels);
                row.crop = Array.from({ length: cropSize }, (_, i) => {
                  const at = ((y + i) * width + x) * 4;
                  return [...pixels.subarray(at, at + cropSize * 4)];
                }).flat();
              }
              phases.push(row);
            };

            await call(world, 0x1ab, [nativeID, graph]);
            await phase(world, 'init', () => call(world, 0x110, [nativeID]));
            await phase(world, 'exec0', () => world.tick());
            await phase(world, 'exec1', () => world.tick());
            // The normal JS projection is independent of plugin FPCW mutations.
            // Directed/extended precision remains in the original golden/oracle tests.
            const modes = [await renderVertices(world)];
            await apply(world, [13.5, 1.25, 1800], [211, 160, 5], false);
            await phase(world, 'hidden-move', () => world.tick());
            await apply(world, [4.25, 17, 1900], [81, 151, 7], true);
            await phase(world, 'stop-latest', () => call(world, 0x111, [nativeID]));
            await phase(world, 'restart', () => call(world, 0x110, [nativeID]));
            await phase(world, 'restart-exec0', () => world.tick());
            await world.sendEngine(anchor, world.main.id, 68, 0, 0);
            await referenceWorld.sendEngine(referenceAnchor, referenceWorld.main.id, 68, 0, 0);
            await phase(world, 'unloaded', () => world.tick());
            fresh = make();
            await fresh.restore(structuredClone(world.snapshot()));
            await phase(fresh, 'restore-absent', () => {}, { refresh: false });
            await phase(fresh, 'resume-absent', () => fresh.tick());
            await apply(fresh, [5.5, 11, 1700], [188, 177, 4], true, true);
            await phase(fresh, 'recreated', () => fresh.tick());
            await call(fresh, 0x1ab, [nativeID, 0]);
            await phase(fresh, 'detached', () => fresh.tick(), { id: -1 });
            return { graph, loaded, phases, modes };
          } finally {
            await referenceWorld.close();
            await fresh?.close();
            await world.close();
          }
        },
        {
          profile,
          names: [...files.keys()],
          plugin: golden.plugin,
          prepare,
          cropSize: golden.cropSize,
          crops: Object.fromEntries(
            golden.phases.filter((p) => p.origin).map((p) => [p.name, p.origin]),
          ),
        },
      );
      expect(result.graph).toBeGreaterThan(0);
      expect(result.loaded).toEqual({ control: 1, value: 1 });
      expect(result.phases.map(({ name }) => name)).toEqual(golden.phases.map(({ name }) => name));
      for (const [i, expected] of golden.phases.entries()) {
        const sample = result.phases[i];
        expect(sample.attachment, expected.name).toEqual(sample.original);
        expect([sample.frame, sample.before]).toEqual([expected.frame, expected.before]);
        expect(sample.active).toBe(expected.name !== 'stop-latest');
        expect(sample.records, expected.name).toBe(expected.recordSHA256);
        if (expected.origin) {
          const vertices = Buffer.from(expected.vertices, 'base64');
          expect(sample.vertices.length * 4).toBe(vertices.length);
          expect(sample.vertices, expected.name).toEqual(
            sample.vertices.map((_, word) => vertices.readUInt32LE(word * 4)),
          );
          expect(sample.crop, expected.name).toEqual(
            Array.from({ length: golden.cropSize ** 2 }, () => expected.rgba).flat(),
          );
        }
      }
      // The retained golden stores the original PC53 and directed-rounding
      // evidence. Engine-side JS deliberately uses the normal PC24 contract,
      // independent of a plug-in's cross-call FPCW mutations (phase2 decision).
      const normal = result.phases.find((phase) => phase.name === 'exec1').vertices;
      for (const vertices of result.modes) expect(vertices).toEqual(normal);
      const unloaded = result.phases.find((p) => p.name === 'unloaded');
      const restored = result.phases.find((p) => p.name === 'restore-absent');
      expect(restored.hash).toBe(unloaded.hash);
    },
  );
