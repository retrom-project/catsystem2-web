// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { imageOwnerFiles } from '../fixtures/image-owner-fixture.mjs';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(`${profile} original image owners share the complete view, GPU and restored Script lifetime`, async ({
    page,
  }) => {
    test.skip(
      !process.env[variable] || (!profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    );
    test.setTimeout(180000);
    const files = await imageOwnerFiles();
    files.set('engine.exe', new Uint8Array(await readFile(process.env[variable])));
    files.set('main.kcs', kcsProgram([[37, 1024], [43, 0x47, 4], [59]]));
    if (!profile.startsWith('sdk-'))
      files.set(
        'emotedriver.dll',
        new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
      );
    await page.route('**/image-owner-fixture/**', async (route) => {
      const name = decodeURIComponent(
          new URL(route.request().url()).pathname.slice('/image-owner-fixture/'.length),
        ),
        bytes = files.get(name);
      if (bytes)
        await route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from(bytes) });
      else await route.fulfill({ status: 404, body: '' });
    });
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, names }) => {
        const [
            { NativeWorld },
            { NativeConfiguration },
            { MotionLibrary },
            { ParticleRandom },
            { ParticlesGL },
          ] = await Promise.all([
            import('/web/transitional-entry.mjs'),
            import('/src/native/config.mjs'),
            import('/src/motion/library.mjs'),
            import('/src/ppi/random.mjs'),
            import('/src/render/particles-gl.mjs'),
          ]),
          files = new Map(
            await Promise.all(
              names.map(async (name) => [
                name,
                new Uint8Array(
                  await (
                    await fetch('/image-owner-fixture/' + encodeURIComponent(name))
                  ).arrayBuffer(),
                ),
              ]),
            ),
          ),
          gpus = [];
        const make = () => {
            const gpu = new ParticlesGL(640, 480),
              game = {
                width: 640,
                height: 480,
                index: new Map(names.map((name) => [name, {}])),
                has: (name) => files.has(name.toLowerCase()),
                names: (ext) => names.filter((n) => n.endsWith('.' + ext)),
                read: async (name) => files.get(name.toLowerCase()) ?? null,
                async require(name) {
                  const bytes = await this.read(name);
                  if (!bytes) throw new Error('Missing resource: ' + name);
                  return bytes;
                },
                readCategory(name, category) {
                  return this.read(this.resolveCategory(name, category));
                },
                resolveCategory: (name, category) =>
                  files.has(name.toLowerCase()) ? name : `@cat/${category}/${name}`,
              },
              random = new ParticleRandom(),
              configuration = new NativeConfiguration({ profile });
            gpus.push(gpu);
            Object.assign(configuration.screen, {
              width: 640,
              height: 480,
              currentWidth: 640,
              currentHeight: 480,
              virtualWidth: 640,
              virtualHeight: 480,
            });
            return new NativeWorld({
              game,
              images: {},
              host: { nativeGPU: () => gpu },
              profile,
              configuration,
              random,
              motionLibrary: new MotionLibrary(game, { profile, random }),
              storage: { read: async () => null, write: async () => true },
            });
          },
          world = make();
        let fresh;
        try {
          await world.initialize('main.kcs');
          const task = world.main,
            m = task.machine;
          m.writeString('probe.hg2', 256);
          const h = (await world.runtime.native('main', 0x2c6, [256], m, task)).value,
            images = await world.getNativeFeature('image-owners'),
            pointer = images.pointer(h),
            platform = await world.getNativeFeature('graphics-platform'),
            renderer = await world.getNativeFeature('renderer'),
            tm = await world.getNativeFeature('task-memory'),
            script = await tm.pointer(task.id),
            p = images.process;
          const initial = {
            loaded: h !== 0,
            ready: renderer.initialized,
            view:
              p.load(pointer + 4) === platform.refs.view &&
              p.load(script + 116) === platform.refs.view,
            list: p.load(script + 156) === images.refs.contexts.get(task.id).list,
            device: renderer.d3d.device === p.load(renderer.core + 308),
          };
          m.writeString('probe.hg2', 1024);
          const loadedBitmap = (await world.runtime.native('main', 0x6f, [1024], m, task)).value,
            copiedBitmap = (await world.runtime.native('main', 0x76, [loadedBitmap], m, task))
              .value,
            originalMemory = await world.getNativeFeature('bitmap-memory'),
            loadedWrapper = await originalMemory.wrapper(loadedBitmap),
            copiedWrapper = await originalMemory.wrapper(copiedBitmap),
            loadedPixels = await world.graphics.images.get(loadedBitmap).pixels(),
            copiedPixels = await world.graphics.images.get(copiedBitmap).pixels(),
            factory = {
              wrappers:
                p.allocations.get(loadedWrapper) === (profile.startsWith('sdk-') ? 276 : 536),
              copies:
                loadedWrapper !== copiedWrapper &&
                loadedPixels.every((v, i) => v === copiedPixels[i]),
              list: p.load(p.load(script + 152) + 4) === 2,
            };
          const bitmapHandle = world.graphics.images.create(2, 1, task.id),
            bitmaps = await world.getNativeFeature('bitmap-memory'),
            bitmap = world.graphics.images.get(bitmapHandle);
          await bitmap.fill(0, 0, 2, 1, 0x04010203);
          const bitmapPointer = await bitmaps.pointer(bitmapHandle),
            pristine = [...(await bitmap.pixels())],
            context = await bitmap.context(),
            frame = await bitmap.frame(),
            revision = bitmap.state.revision;
          await world.nativeEngine.call(
            p.load(profile.startsWith('sdk-') ? 0xb3c900 : 0xa2dd38),
            [0, 0, 0, 0],
          );
          const readOnly =
            (await bitmap.frame()) === frame &&
            bitmap.state.revision === revision &&
            JSON.stringify([...(await bitmap.pixels())]) === JSON.stringify(pristine);
          context.fillStyle = '#123456';
          context.fillRect(0, 0, 1, 1);
          bitmap.commitCanvas();
          const writable =
            JSON.stringify([...(await bitmap.pixels()).slice(0, 4)]) ===
            JSON.stringify([0x12, 0x34, 0x56, 255]);
          const child = await world.objects.create({
              kind: 12,
              parent: task.id,
              name: 'Image child',
            }),
            ci = world.objects.objects.get(child).implementation;
          await ci.loadScript('main.kcs');
          ci.machine.writeString('probe.hg2', 256);
          const childHandle = (
              await world.runtime.native('main', 0x2c6, [256], ci.machine, ci.task)
            ).value,
            childPointer = images.pointer(childHandle);
          await world.objects.release(child);
          const independent = images.pointer(h) === pointer && !p.allocations.has(childPointer);
          fresh = make();
          await fresh.restore(structuredClone(world.snapshot()));
          const restored = await fresh.getNativeFeature('image-owners'),
            fr = await fresh.getNativeFeature('renderer'),
            fm = fresh.main.machine;
          fm.bytes(768, 12).fill(0xa5);
          await fresh.runtime.native('main', 0x2c8, [h, 768, 772], fm, fresh.main);
          const restoredState = {
            samePointer: restored.pointer(h) === pointer,
            view: fr.view === renderer.view,
            ready: fr.initialized,
            size: [fm.load(768), fm.load(772), fm.load(776)],
            separateGPU: fr.d3d.gpu !== renderer.d3d.gpu,
          };
          const restoredBitmap = await fresh.getNativeFeature('bitmap-memory'),
            bitmapRestored =
              (await restoredBitmap.pointer(bitmapHandle)) === bitmapPointer &&
              JSON.stringify([
                ...(await fresh.graphics.images.get(bitmapHandle).pixels()).slice(0, 4),
              ]) === JSON.stringify([0x12, 0x34, 0x56, 255]);
          factory.restored =
            (await restoredBitmap.wrapper(loadedBitmap)) === loadedWrapper &&
            (await restoredBitmap.wrapper(copiedBitmap)) === copiedWrapper;
          await fresh.objects.objects
            .get(fresh.main.id)
            .implementation.loadScript('missing.kcs', { nativeLoad: true });
          factory.released =
            !restored.process.allocations.has(loadedWrapper) &&
            !restored.process.allocations.has(copiedWrapper);
          return {
            initial,
            independent,
            bitmap: { readOnly, writable, restored: bitmapRestored },
            factory,
            restored: restoredState,
            released: !restored.process.allocations.has(pointer),
            originalAlive: images.pointer(h) === pointer,
          };
        } finally {
          await fresh?.close({ flushFiles: false });
          await world.close({ flushFiles: false });
          for (const gpu of gpus) gpu.close();
        }
      },
      { profile, names: [...files.keys()] },
    );
    expect(result).toEqual({
      initial: { loaded: true, ready: true, view: true, list: true, device: true },
      independent: true,
      bitmap: { readOnly: true, writable: true, restored: true },
      factory: { wrappers: true, copies: true, list: true, restored: true, released: true },
      restored: {
        samePointer: true,
        view: true,
        ready: true,
        size: [4, 3, 0xa5a5a5a5],
        separateGPU: true,
      },
      released: true,
      originalAlive: true,
    });
  });
}
