// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';
import { encodeHG2 } from '../../src/formats/hg2.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} original screen-effect callbacks render every task and preserve a captured fade across a fresh World`, async ({
    page,
  }) => {
    test.skip(
      !process.env[variable] || (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    );
    test.setTimeout(180000);
    const files = new Map([
      ['engine.exe', new Uint8Array(await readFile(process.env[variable]))],
      ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
      [
        'effects.fes',
        new TextEncoder().encode(
          '#DEFINE\n#START\nnext WAIT\n#WAIT\n#DRAW\nrdraw 4 0 60000\n#WIPE\nrwipe 4 mask 0 60000\n#BREAK\nwbreak 4\n#WMOS\nrwmos 4\n#FMOS\nrfmos 4\n',
        ),
      ],
      ['dummy.kcs', kcsProgram([[59]])],
      [
        'mask.hg2',
        await encodeHG2(
          {
            width: 64,
            height: 48,
            rgba: Uint8Array.from({ length: 64 * 48 * 4 }, (_, i) =>
              i % 4 === 3 ? 255 : ((i >>> 2) % 64) * 4,
            ),
          },
          { crop: false },
        ),
      ],
    ]);
    if (!profile.startsWith('sdk-'))
      files.set(
        'emotedriver.dll',
        new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
      );
    const planeFixture = await readFile(
      new URL('../fixtures/browser-native-world.mjs', import.meta.url),
    );
    await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
      route.fulfill({ body: planeFixture, contentType: 'text/javascript' }),
    );
    await page.route('**/screen-effect-fixture/**', async (route) => {
      const name = decodeURIComponent(
          new URL(route.request().url()).pathname.slice('/screen-effect-fixture/'.length),
        ),
        bytes = files.get(name);
      await route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
    });
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names }) => {
        const [
            { NativeWorld },
            { NativeConfiguration },
            { MotionLibrary },
            { ParticleRandom },
            { StageRenderer },
            { NATIVE_SCREEN_EFFECT_LAYOUTS },
            { placeBrowserNativePlane },
            { ImageStore },
          ] = await Promise.all([
            import('/src/native/world.mjs'),
            import('/src/native/config.mjs'),
            import('/src/motion/library.mjs'),
            import('/src/ppi/random.mjs'),
            import('/src/render/stage.mjs'),
            import('/src/native/screen-effect.mjs'),
            import('/tests/fixtures/browser-native-world.mjs'),
            import('/src/formats/hg3.mjs'),
          ]),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(
                  await (
                    await fetch('/screen-effect-fixture/' + encodeURIComponent(name))
                  ).arrayBuffer(),
                ),
              ]),
            ),
          ),
          worlds = [];
        const make = () => {
            const width = 64,
              height = 48,
              canvas = new OffscreenCanvas(width, height),
              stageRenderer = new StageRenderer({
                canvas,
                ctx: canvas.getContext('2d'),
                begin() {
                  this.ctx.reset();
                },
              }),
              game = {
                width,
                height,
                index: new Map(names.map((n) => [n, {}])),
                names: (ext) => names.filter((n) => n.endsWith('.' + ext)),
                has: (name) => files.has(name.toLowerCase()),
                read: async (name) => files.get(name.toLowerCase()) ?? null,
                async require(name) {
                  const bytes = await this.read(name);
                  if (bytes === null) throw new Error('Missing ' + name);
                  return bytes;
                },
                resolveCategory(name, category) {
                  name = name.replaceAll('\\', '/').toLowerCase();
                  if (name.startsWith('@cat/')) name = name.split('/').slice(2).join('/');
                  const ext = { mot: 'kcs', fes: 'fes', kcs: 'kcs', image: 'hg2' }[category];
                  return files.has(name)
                    ? name
                    : ext && files.has(name + '.' + ext)
                      ? name + '.' + ext
                      : null;
                },
                async readCategory(name, category) {
                  const path = this.resolveCategory(name, category);
                  return path === null ? null : this.read(path);
                },
                async requireCategory(name, category) {
                  const bytes = await this.readCategory(name, category);
                  if (bytes === null) throw new Error('Missing ' + category + ' ' + name);
                  return bytes;
                },
              },
              random = new ParticleRandom(),
              configuration = new NativeConfiguration({ profile });
            Object.assign(configuration.screen, {
              width,
              height,
              currentWidth: width,
              currentHeight: height,
              virtualWidth: width,
              virtualHeight: height,
            });
            const world = new NativeWorld({
              game,
              profile,
              images: new ImageStore(game),
              host: {},
              configuration,
              random,
              motionLibrary: new MotionLibrary(game, { profile, random }),
              storage: {
                read: async () => null,
                write: async () => true,
                stat: async () => null,
                list: async () => [],
              },
            });
            world.stageRenderer = stageRenderer;
            worlds.push(world);
            return world;
          },
          world = make(),
          sample = (world) => [
            ...world.stageRenderer.gpu.pixels().slice((24 * 64 + 40) * 4, (24 * 64 + 41) * 4),
          ],
          render = (world) =>
            world.stageRenderer.render(world.graphics.stage, null, world.particles.drawItems());
        const hash = async (world) =>
          Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', world.stageRenderer.gpu.pixels())),
            (b) => b.toString(16).padStart(2, '0'),
          ).join('');
        let failure, result;
        try {
          await world.initialize('main.kcs');
          await world.tick();
          const planeID = await world.objects.create({
            kind: 2,
            parent: world.root,
            name: 'Authored background',
          });
          let planeColor = 0xff406080;
          const tint = async (color) => {
            planeColor = color;
            await world.sendEngine(planeID, world.main.id, 59, 1, color);
          };
          await placeBrowserNativePlane(world, planeID, {
            width: 64,
            height: 48,
            color: planeColor,
            priority: 300,
          });
          const patchID = await world.objects.create({
            kind: 2,
            parent: world.root,
            name: 'Authored foreground',
          });
          await placeBrowserNativePlane(world, patchID, {
            width: 12,
            height: 10,
            color: 0xff20b040,
            position: [4, 5, 0],
            priority: 61000,
          });
          await render(world);
          const baseline = sample(world),
            baselineHash = await hash(world),
            rows = [];
          const effects = await world.getNativeFeature('screen-effects'),
            capture = profile.startsWith('sdk-') ? 0x54d140 : 0x6760a0;
          const canvasPixels = () =>
              world.stageRenderer.renderer.ctx.getImageData(0, 0, 64, 48).data,
            displayed = new Uint8Array(canvasPixels()),
            p = world.nativeEngine.process;
          // The original outer-view pause gate applies even without an FX
          // callback. A submitted graph change must not erase the retained
          // backbuffer or present a replacement frame while this gate is set.
          p.store(effects.platform.refs.view + 12, 1);
          await tint(0xffa02040);
          await render(world);
          const paused = {
            callback: p.load(effects.platform.refs.view3D + 192),
            pixel: sample(world),
            hash: await hash(world),
            displayPreserved: canvasPixels().every((value, i) => value === displayed[i]),
          };
          p.store(effects.platform.refs.view + 12, 0);
          await tint(0xff406080);
          await render(world);
          for (const [kindString, abi] of Object.entries(NATIVE_SCREEN_EFFECT_LAYOUTS[profile])) {
            await world.nativeEngine.call(
              profile.startsWith('sdk-') ? 0x54cdf0 : 0x675ce0,
              [2],
              effects.platform.refs.view,
            );
            await world.nativeEngine.call(capture, [0, 0, 0x49742400], effects.platform.refs.view);
            const kind = Number(kindString),
              id = await world.objects.create({ kind, parent: world.root, name: 'Authored FX' }),
              task = world.objects.objects.get(id).implementation,
              p = world.nativeEngine.process,
              registered = p.load(effects.platform.refs.view3D + 192) === abi.callback,
              phases = [],
              stop = p.beforeInstruction(
                abi.callback,
                'authored screen-effect phase trace',
                (p) => {
                  const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
                  phases.push(p.load(sp + 8));
                },
              );
            try {
              await render(world);
              const inactive = {
                phases: [...phases],
                pixel: sample(world),
                hash: await hash(world),
              };
              phases.length = 0;
              if (kind === 36)
                await world.sendEngine(id, world.root, 380, 0, task.pointer + 120, {
                  nativePointer: true,
                });
              await world.sendEngine(
                id,
                world.root,
                {
                  35: 379,
                  36: 381,
                  37: 383,
                  38: 385,
                  39: 388,
                  50: 517,
                  51: 520,
                  52: 522,
                  57: 391,
                  58: 395,
                }[kind],
                0,
                1,
              );
              await render(world);
              rows.push({
                kind,
                registered,
                capability: p.load(task.pointer + 112),
                inactive,
                phases,
                pixel: sample(world),
              });
            } finally {
              stop();
              await world.objects.release(id);
            }
          }
          const id = await world.objects.create({
              kind: 34,
              parent: world.main.id,
              name: 'Authored effect FES',
            }),
            fes = world.objects.objects.get(id).implementation;
          await fes.load('effects', world.main);
          fes.player.root.invoke('DRAW');
          await fes.player.flush();
          await tint(0xffa02040);
          for (let i = 0; i < 3; i++) {
            await world.tick();
            await render(world);
          }
          const captured = sample(world),
            capturedHash = await hash(world),
            saved = structuredClone(world.snapshot()),
            fresh = make();
          const state = (current) => {
            const objects = current.objects.objects.get(id).implementation.player.root.objects,
              object = objects.find((o) => o.nativeType === 26),
              child = current.objects.objects.get(object.nativeTaskID)?.implementation,
              p = current.nativeEngine.process;
            return {
              frame: current.frame,
              object: [object.deleted, object.nativeObjectPointer, object.nativeTaskID],
              motionBusy: object.nativeMotionBusy,
              data: child
                ? [88, 100, 112, 116, 128, 132, 136, 260, 264].map((at) =>
                    p.load(child.pointer + at),
                  )
                : [],
            };
          };
          const before = state(world);
          await fresh.restore(saved);
          const after = state(fresh);
          const continuation = [];
          for (let i = 0; i < 8; i++) {
            await world.tick();
            await render(world);
            await fresh.tick();
            await render(fresh);
            continuation.push({
              original: sample(world),
              restored: sample(fresh),
              originalHash: await hash(world),
              restoredHash: await hash(fresh),
              a: state(world),
              b: state(fresh),
            });
          }
          const globalEffects = [];
          for (const [label, type] of [
            ['WIPE', 27],
            ['BREAK', 30],
            ['WMOS', 31],
            ['FMOS', 32],
            ['DRAW', 26],
          ]) {
            const from = sample(world),
              next = planeColor === 0xffa02040 ? 0xff406080 : 0xffa02040;
            fes.player.root.invoke(label);
            await fes.player.flush();
            const object = fes.player.root.objects.findLast(
                (o) => o.nativeType === type && !o.deleted,
              ),
              pointer = object?.nativeObjectPointer;
            if (!object) throw new Error('Native global ' + label + ' created no effect object');
            fes.player.root.invoke(label);
            await fes.player.flush();
            if (
              fes.player.root.objects.filter((o) => o.nativeType === type && !o.deleted).length !==
                1 ||
              object.nativeObjectPointer !== pointer
            )
              throw new Error('A live native global effect was replaced');
            await tint(next);
            const colors = [];
            for (let i = 0; i < 24; i++) {
              await world.tick();
              await render(world);
              colors.push(sample(world));
            }
            globalEffects.push({
              label,
              from,
              colors,
              deleted: object.deleted,
              initialized: object.nativeEffectInitialized,
              rawObjects: (await world.getNativeFeature('fes-objects')).objects.size,
            });
          }
          result = {
            baseline,
            baselineHash,
            paused,
            rows,
            captured,
            capturedHash,
            continuation,
            globalEffects,
            before,
            after,
            unsupported: [...fes.player.unsupportedCommands],
            errors: worlds.map((w) => w.stageRenderer.gpu.gl.getError()),
          };
        } catch (error) {
          failure = new Error(error.stack + ' ' + JSON.stringify(error.nativeFault));
        } finally {
          for (const current of worlds.toReversed())
            try {
              await current.close({ flushFiles: false });
            } catch (error) {
              failure ??= error;
            }
        }
        if (failure) throw failure;
        return result;
      },
      { profile, names: [...files.keys()] },
    );
    expect(result.baseline).toEqual([64, 96, 128, 255]);
    expect(result.paused).toEqual({
      callback: 0,
      pixel: result.baseline,
      hash: result.baselineHash,
      displayPreserved: true,
    });
    expect(result.rows).toHaveLength(10);
    for (const row of result.rows) {
      expect(row.capability, JSON.stringify(row)).toBe(1);
      if (row.registered) expect(row.inactive.phases, JSON.stringify(row)).toContain(0);
      expect(row.inactive.pixel, JSON.stringify(row)).toEqual(result.baseline);
      expect(row.inactive.hash, JSON.stringify(row)).toEqual(result.baselineHash);
      expect(row.phases, JSON.stringify(row)).toContain(5);
    }
    expect(result.captured).toEqual(result.baseline);
    expect(result.capturedHash).toEqual(result.baselineHash);
    expect(result.before.motionBusy).toBe(true);
    expect(result.after).toEqual(result.before);
    for (const row of result.continuation) {
      expect(
        row.restored,
        JSON.stringify({ row, before: result.before, after: result.after }),
      ).toEqual(row.original);
      expect(row.restoredHash).toEqual(row.originalHash);
    }
    expect(result.continuation.at(-1).original).toEqual([160, 32, 64, 255]);
    expect(result.continuation.some((row) => row.original[0] > 64 && row.original[0] < 160)).toBe(
      true,
    );
    for (const row of result.globalEffects) {
      expect(row.initialized, JSON.stringify(row)).toBe(true);
      expect(row.deleted, JSON.stringify(row)).toBe(true);
      expect(row.rawObjects, JSON.stringify(row)).toBe(1);
      expect(row.colors.at(-1)).not.toEqual(row.from);
    }
    expect(result.unsupported).toEqual([]);
    expect(result.errors).toEqual([0, 0]);
  });
