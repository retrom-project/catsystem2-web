// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(`${profile} screenshots and recorded BMP frames use the actual ordinary native backbuffer and restore independently`, async ({
    page,
  }) => {
    test.skip(
      !process.env[variable] || (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    );
    test.setTimeout(180000);
    const files = new Map([
      ['engine.exe', await readFile(process.env[variable])],
      ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
    ]);
    if (!profile.startsWith('sdk-'))
      files.set('emotedriver.dll', await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
    const helper = await readFile(new URL('../fixtures/browser-native-world.mjs', import.meta.url));
    await page.route('**/tests/fixtures/browser-native-world.mjs', (route) =>
      route.fulfill({ body: helper, contentType: 'text/javascript' }),
    );
    await page.route('**/capture-fixture/**', async (route) => {
      const name = decodeURIComponent(
          new URL(route.request().url()).pathname.slice('/capture-fixture/'.length),
        ),
        bytes = files.get(name);
      await route.fulfill(bytes ? { body: Buffer.from(bytes) } : { status: 404, body: '' });
    });
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names }) => {
        const { browserNativeWorld, placeBrowserNativePlane } = await import(
            '/tests/fixtures/browser-native-world.mjs'
          ),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(
                  await (await fetch('/capture-fixture/' + encodeURIComponent(name))).arrayBuffer(),
                ),
              ]),
            ),
          ),
          saved = new Map(),
          normalize = (name) => name.replaceAll('\\', '/').toLowerCase(),
          storage = {
            read: async (name) => saved.get(normalize(name))?.slice() ?? null,
            write: async (name, bytes) => {
              saved.set(normalize(name), bytes.slice());
              return true;
            },
            stat: async (name) =>
              saved.has(normalize(name))
                ? { size: saved.get(normalize(name)).length, attributes: 32 }
                : null,
            list: async () =>
              [...saved].map(([name, bytes]) => ({ name, size: bytes.length, attributes: 32 })),
          },
          make = () => browserNativeWorld({ profile, files, storage }),
          world = make(),
          worlds = [world],
          equal = (a, b, label) => {
            const at = a.findIndex((v, i) => v !== b[i]);
            if (a.length !== b.length || at >= 0)
              throw new Error(
                label +
                  ' differs ' +
                  JSON.stringify({
                    lengths: [a.length, b.length],
                    at,
                    actual: [...a.slice(Math.max(0, at - 4), at + 12)],
                    expected: [...b.slice(Math.max(0, at - 4), at + 12)],
                  }),
              );
          },
          render = (world) =>
            world.stageRenderer.render(world.graphics.stage, null, world.particles.drawItems()),
          pixels = (world) =>
            new Uint8Array(world.stageRenderer.renderer.ctx.getImageData(0, 0, 64, 48).data);
        let output, failure;
        try {
          await world.initialize('main.kcs');
          const task = world.main,
            m = task.machine,
            call = (id, args) => world.runtime.native('main', id, args, m, task),
            backgroundID = await world.objects.create({
              kind: 2,
              parent: world.root,
              name: 'Capture background',
            });
          await placeBrowserNativePlane(world, backgroundID, {
            width: 64,
            height: 48,
            color: 0xff204060,
            priority: 300,
          });
          const patchID = await world.objects.create({
            kind: 2,
            parent: world.root,
            name: 'Asymmetric capture patch',
          });
          await placeBrowserNativePlane(world, patchID, {
            width: 12,
            height: 10,
            color: 0xffc03050,
            position: [4, 5, 0],
            priority: 61000,
          });
          await render(world);
          const displayed = pixels(world),
            imageHandle = (await call(0x71, [])).value,
            bitmap = world.graphics.images.get(imageHandle),
            original = new Uint8Array(await bitmap.pixels()),
            memory = await world.getNativeFeature('bitmap-memory'),
            pointer = await memory.pointer(imageHandle),
            platform = await world.getNativeFeature('graphics-platform'),
            p = world.nativeEngine.process;
          // Original 67FCB0 copies top-down D3D rows into the native bottom-up
          // bitmap without flipping. main71 therefore exposes the mirrored
          // logical image; the original recording branch flips it explicitly.
          const expectedScreenshot = new Uint8Array(displayed.length);
          for (let y = 0; y < 48; y++)
            expectedScreenshot.set(
              displayed.subarray(y * 64 * 4, (y + 1) * 64 * 4),
              (47 - y) * 64 * 4,
            );
          equal(original, expectedScreenshot, 'original screenshot row orientation');
          const kernels = world.nativeEngine.features.get('raster-kernels'),
            enabled = kernels?.enabled;
          let unaccelerated;
          try {
            if (kernels) kernels.enabled = false;
            unaccelerated = (await call(0x71, [])).value;
            equal(
              new Uint8Array(await world.graphics.images.get(unaccelerated).pixels()),
              original,
              'unaccelerated original screenshot',
            );
          } finally {
            if (kernels) kernels.enabled = enabled;
            if (unaccelerated) await world.graphics.images.release(unaccelerated);
          }
          const displayGate = profile.startsWith('sdk-') ? 124 : 156;
          p.store(platform.refs.view + displayGate, 1);
          const gdiShot = (await call(0x71, [])).value;
          equal(
            new Uint8Array(await world.graphics.images.get(gdiShot).pixels()),
            expectedScreenshot,
            'original GDI window capture pixels',
          );
          await world.graphics.images.release(gdiShot);
          p.store(platform.refs.view + displayGate, 0);
          const { initializeNativeStartupMenu } = await import(
            '/src/native/engine-startup-menu.mjs'
          );
          const { initializeNativeLanguage } = await import('/src/native/engine-language.mjs');
          await initializeNativeLanguage(world.nativeEngine);
          await initializeNativeStartupMenu(world.nativeEngine);
          const saveBitmap = async () => {
            world.window.post(0x111, 0x10000 | 40030);
            try {
              await world.processWindowMessages();
            } catch (error) {
              throw new Error(
                'Native menu capture failed: ' +
                  JSON.stringify({
                    message: error.message,
                    fault: error.nativeFault,
                    trace: error.trace,
                  }),
                { cause: error },
              );
            }
          };
          world.configuration.authorMode = 0;
          await saveBitmap();
          if (saved.size) throw new Error('Disabled menu capture wrote a file');
          const previous = Uint8Array.of(12, 45, 78);
          saved.set('cap0000.bmp', previous);
          world.configuration.authorMode = 1;
          await saveBitmap();
          world.configuration.authorMode = 0;
          const numbered = saved.get('cap0001.bmp');
          if (!numbered)
            throw new Error('Original menu did not write its first free BMP: ' + [...saved.keys()]);
          equal(saved.get('cap0000.bmp'), previous, 'existing menu capture');
          const decodedMenu = await createImageBitmap(new Blob([numbered], { type: 'image/bmp' })),
            menuCanvas = new OffscreenCanvas(64, 48),
            menuContext = menuCanvas.getContext('2d');
          menuContext.drawImage(decodedMenu, 0, 0);
          decodedMenu.close();
          equal(
            new Uint8Array(menuContext.getImageData(0, 0, 64, 48).data),
            displayed,
            'menu BMP pixels',
          );
          const before = original.slice();
          await bitmap.fill(0, 0, 1, 1, 0xff123456);
          equal(pixels(world), displayed, 'independent captured bitmap');
          const child = await world.spawnScript('main.kcs', { parent: world.root }),
            childImage = (await world.runtime.native('main', 0x71, [], child.machine, child)).value,
            childPointer = await memory.pointer(childImage);
          await world.objects.objects
            .get(child.id)
            .implementation.loadScript('missing.kcs', { nativeLoad: true });
          if (p.allocations.has(childPointer) || !p.allocations.has(pointer))
            throw new Error('Screenshot automatic Script ownership was lost on failed reload');
          await world.objects.release(child.id);
          m.writeString('capture', 256);
          const directory = p.allocate(16, true);
          world.nativeEngine.kernel.writeString(directory, 'capture', true);
          try {
            const mkdir = world.nativeEngine.kernel.resolve({
              dll: 'KERNEL32.dll',
              name: 'CreateDirectoryW',
            });
            if (!(await world.nativeEngine.call(mkdir, [directory, 0])))
              throw new Error('Authored output directory was not created');
          } finally {
            p.free(directory);
          }
          await call(0x1b9, [23, 256, 99]);
          if ((await call(0x235, [])).value !== 23 || (await call(0x236, [])).value !== 99)
            throw new Error('Native recording state was not set');
          await render(world);
          const counter = (await call(0x236, [])).value,
            entries = [...saved],
            file = entries.find(([name]) => name.endsWith('capture_0000000099.bmp'));
          if (!file)
            throw new Error(
              'Original recorder did not write its BMP: ' + entries.map(([name]) => name).join(','),
            );
          if (file[1][0] !== 66 || file[1][1] !== 77)
            throw new Error('Recorder output is not a BMP');
          const decoded = await createImageBitmap(new Blob([file[1]], { type: 'image/bmp' })),
            canvas = new OffscreenCanvas(64, 48),
            ctx = canvas.getContext('2d');
          ctx.drawImage(decoded, 0, 0);
          decoded.close();
          equal(
            new Uint8Array(ctx.getImageData(0, 0, 64, 48).data),
            displayed,
            'original BMP pixels',
          );
          const snapshot = structuredClone(world.snapshot()),
            fresh = make();
          worlds.push(fresh);
          await fresh.restore(snapshot);
          const ft = fresh.main,
            fm = ft.machine,
            invoke = (id, args) => fresh.runtime.native('main', id, args, fm, ft),
            restored = fresh.graphics.images.get(imageHandle),
            freshMemory = await fresh.getNativeFeature('bitmap-memory');
          if ((await freshMemory.pointer(imageHandle)) !== pointer)
            throw new Error('Captured bitmap pointer changed after restore');
          equal(
            new Uint8Array(await restored.pixels()),
            new Uint8Array(await bitmap.pixels()),
            'captured bitmap after fresh restore',
          );
          const freshShot = (await invoke(0x71, [])).value;
          equal(
            new Uint8Array(await fresh.graphics.images.get(freshShot).pixels()),
            before,
            'restored device backbuffer before a new frame',
          );
          const freshPlatform = await fresh.getNativeFeature('graphics-platform');
          fresh.nativeEngine.process.store(freshPlatform.refs.view + displayGate, 1);
          await render(fresh);
          const freshCounter = (await invoke(0x236, [])).value;
          const gdiFrame = [...saved].find(([name]) => name.endsWith('capture_0000000100.bmp'));
          if (!gdiFrame) throw new Error('Original GDI recorder did not produce its next frame');
          const gdiDecoded = await createImageBitmap(
            new Blob([gdiFrame[1]], { type: 'image/bmp' }),
          );
          ctx.clearRect(0, 0, 64, 48);
          ctx.drawImage(gdiDecoded, 0, 0);
          gdiDecoded.close();
          equal(
            new Uint8Array(ctx.getImageData(0, 0, 64, 48).data),
            displayed,
            'GDI recorded BMP pixels',
          );
          if ((await call(0x236, [])).value !== counter)
            throw new Error('Fresh recording changed the old native view');
          await invoke(0x1b9, [23, 256, 0xffffffff]);
          await render(fresh);
          const wrapped = (await invoke(0x236, [])).value;
          if (
            wrapped !== 0 ||
            ![...saved.keys()].some((name) => name.endsWith('capture_-000000001.bmp'))
          )
            throw new Error('Original signed filename/DWORD recording counter wrap was lost');
          await invoke(0x1b9, [0, 256, 0]);
          await call(0x1b9, [0, 256, 0]);
          await fresh.graphics.images.release(freshShot);
          await fresh.graphics.images.release(imageHandle);
          if (fresh.nativeEngine.process.allocations.has(pointer))
            throw new Error('Captured bitmap leaked after final release');
          if (!p.allocations.has(pointer))
            throw new Error('Fresh bitmap release changed the old owner');
          p.store(platform.refs.view + 52, 0);
          const gated = (await call(0x71, [])).value;
          p.store(platform.refs.view + 52, 1);
          output = {
            size: [bitmap.width, bitmap.height],
            counter,
            freshCounter,
            wrapped,
            gated,
            asymmetric: [...displayed.slice((5 * 64 + 4) * 4, (5 * 64 + 4) * 4 + 4)],
            saved: entries.filter(([name]) => name.startsWith('capture/')).length,
          };
        } catch (error) {
          failure = error;
        }
        for (const world of worlds.reverse())
          try {
            await world.close({ flushFiles: false });
          } catch (error) {
            failure ??= error;
          }
        if (failure?.nativeFault)
          throw new Error(failure.message + ': ' + JSON.stringify(failure.nativeFault), {
            cause: failure,
          });
        if (failure) throw failure;
        return output;
      },
      { profile, names: [...files.keys()] },
    );
    expect(result).toEqual({
      size: [64, 48],
      counter: 100,
      freshCounter: 101,
      wrapped: 0,
      gated: 0,
      asymmetric: [192, 48, 80, 255],
      saved: 1,
    });
  });
