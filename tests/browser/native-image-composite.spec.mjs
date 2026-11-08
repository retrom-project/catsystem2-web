// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';
import { authoredHG3 } from '../fixtures/hg3.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} original selector composition reaches the native view GPU and restores independently`, async ({
    page,
  }) => {
    test.skip(
      !process.env[variable] || (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    );
    test.setTimeout(180000);
    const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, at) =>
        at % 4 === 3 ? 255 : (at * 37 + 19) & 255,
      ),
      files = new Map([
        ['engine.exe', await readFile(process.env[variable])],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
        [
          'x_1.hg3',
          authoredHG3([
            { width: 3, height: 2, rgba: rgba.map((v, at) => (at % 4 === 3 ? v : 17)) },
          ]),
        ],
        ['x_02.hg3', authoredHG3([{ width: 3, height: 2, rgba }])],
      ]);
    if (!profile.startsWith('sdk-'))
      files.set('emotedriver.dll', await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
    const helper = await readFile(new URL('../fixtures/browser-native-world.mjs', import.meta.url));
    await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
      route.fulfill({ body: helper, contentType: 'text/javascript' }),
    );
    await page.route('**/image-composite-fixture/**', (route) => {
      const name = decodeURIComponent(
          new URL(route.request().url()).pathname.slice('/image-composite-fixture/'.length),
        ),
        bytes = files.get(name);
      return route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
    });
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names, expected }) => {
        const { browserNativeWorld } = await import('/tests/fixtures/browser-native-world.mjs'),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(
                  await (
                    await fetch('/image-composite-fixture/' + encodeURIComponent(name))
                  ).arrayBuffer(),
                ),
              ]),
            ),
          ),
          make = () => {
            const w = browserNativeWorld({
                profile,
                files,
                storage: { read: async () => null, write: async () => true },
              }),
              t = w.configuration.fields.texture;
            // Explicit mounted-category boundary. The original game helper still
            // performs its narrow-to-wide basename read and original IFile calls.
            w.game.nativeResources = { resolve: (name) => name };
            t.size.set([64, 64]);
            t.grid.set([1, 1]);
            t.bppY.set([0, 1]);
            t.areas[0].set([0, 0, 1, 1]);
            t.bpp = 32;
            return w;
          },
          world = make(),
          worlds = [world],
          render = (w) => w.stageRenderer.render(w.graphics.stage, null, w.particles.drawItems()),
          pixels = (w) =>
            new Uint8Array(w.stageRenderer.renderer.ctx.getImageData(0, 0, 64, 48).data),
          equal = (a, b, label) => {
            if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error(label);
          };
        try {
          await world.initialize('main.kcs');
          const planeID = await world.objects.create({
              kind: 2,
              parent: world.root,
              name: 'Native composite VRAM surface',
            }),
            plane = world.graphics.get(planeID),
            { MOTION_ABI, setMotionVector } = await import('/src/motion/abi.mjs');
          plane.makeGraph({ type: 1, width: 64, height: 48, vram: true });
          setMotionVector(plane.graph.kx2, MOTION_ABI.base, [0, 0, 300]);
          plane.state.shown = true;
          plane.sync();
          await render(world);
          const before = pixels(world),
            task = world.main,
            m = task.machine;
          m.writeString('x,1,2.hg3', 512);
          // Caller-stack input for this authored case is zero. Product execution
          // does not clear stack bytes or repair the game's original overread.
          const p = world.nativeEngine.process;
          p.zero(p.stackTop - 0x6000, 0x6000);
          const h = (await world.runtime.native('main', 0x1cc, [512], m, task)).value;
          equal(
            await world.graphics.images.get(h).pixels(),
            expected,
            'original CPU composite colors',
          );
          await world.runtime.native('main', 0x73, [0, 5, 7, 3, 2, h, 0, 0, 3, 2], m, task);
          await render(world);
          const after = pixels(world),
            changed = [];
          for (let y = 0; y < 48; y++)
            for (let x = 0; x < 64; x++) {
              const at = (y * 64 + x) * 4;
              if (after.slice(at, at + 4).some((v, i) => v !== before[at + i]))
                changed.push([x, y, ...after.slice(at, at + 4)]);
            }
          if (changed.length !== 6)
            throw new Error('Original composite upload changed ' + changed.length + ' pixels');
          const colors = (rows) => rows.map((r) => r.join(',')).sort(),
            expectedColors = [];
          for (let at = 0; at < expected.length; at += 4)
            expectedColors.push(expected.slice(at, at + 4));
          equal(
            colors(changed.map((row) => row.slice(2))),
            colors(expectedColors),
            'actual GPU composite colors',
          );
          const fresh = make();
          worlds.push(fresh);
          await fresh.restore(structuredClone(world.snapshot()));
          equal(
            await fresh.graphics.images.get(h).pixels(),
            expected,
            'fresh original bitmap pixels',
          );
          await render(fresh);
          equal(pixels(fresh), after, 'fresh original GPU pixels');
          await fresh.runtime.native('main', 0x72, [h], fresh.main.machine, fresh.main);
          equal(
            await world.graphics.images.get(h).pixels(),
            expected,
            'source explicit reference remains live',
          );
          return { changed: changed.length };
        } finally {
          for (const w of worlds.reverse()) await w.close({ flushFiles: false });
        }
      },
      { profile, names: [...files.keys()], expected: [...rgba] },
    );
    expect(result.changed).toBe(6);
  });
