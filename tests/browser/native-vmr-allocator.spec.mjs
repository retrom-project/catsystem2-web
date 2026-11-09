// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { nativeM2Files } from '../fixtures/native-m2-fixture.mjs';
import { profiles } from '../fixtures/native-vmr-surface.mjs';
import { kcsProgram } from '../helpers.mjs';

const samples = (index) =>
  Array.from({ length: 32 }, (_, i) => {
    const x = i % 4,
      y = i >> 2;
    return x >= 3 || y >= 5
      ? [0, 0, 0, 255]
      : [0x11 + x * 0x12 + index * 0x41, 0x31 + y * 0x13, 0x44 + y * 3 + x * 0x21, 255];
  }).flat();

for (const [profile, variable, ctor] of profiles)
  test(`${profile} original VMR9 negotiates, presents, restores and frees its allocated surfaces`, async ({
    page,
  }) => {
    const gamePE = profile.startsWith('nekopara-');
    test.skip(
      !process.env[variable] || (gamePE && !process.env.CATSYSTEM2_EMOTE_DLL),
      'Requires the frozen engine and its imported driver',
    );
    test.setTimeout(90000);
    const files = Object.fromEntries(
      Object.entries(gamePE ? nativeM2Files() : {}).map(([name, bytes]) => [name, [...bytes]]),
    );
    files['main.kcs'] = [...kcsProgram([[37, 1024], [43, 0x47, 4], [59]])];
    const executable = await readFile(process.env[variable]);
    await page.route('**/test/engine.exe', (route) => route.fulfill({ body: executable }));
    if (gamePE) {
      const driver = await readFile(process.env.CATSYSTEM2_EMOTE_DLL);
      await page.route('**/test/emotedriver.dll', (route) => route.fulfill({ body: driver }));
    }
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, files, gamePE, ctor, frames }) => {
        const [
          { NativeWorld },
          { NativeConfiguration },
          { MotionLibrary },
          { ParticleRandom },
          { ParticlesGL },
        ] = await Promise.all([
          import('/src/native/world.mjs'),
          import('/src/native/config.mjs'),
          import('/src/motion/library.mjs'),
          import('/src/ppi/random.mjs'),
          import('/src/render/particles-gl.mjs'),
        ]);
        const resources = new Map(
          Object.entries(files).map(([name, bytes]) => [name, Uint8Array.from(bytes)]),
        );
        for (const name of gamePE ? ['engine.exe', 'emotedriver.dll'] : ['engine.exe'])
          resources.set(name, new Uint8Array(await (await fetch('/test/' + name)).arrayBuffer()));
        const game = {
          width: 64,
          height: 64,
          index: new Map([...resources.keys()].map((name) => [name, {}])),
          has: (name) => resources.has(name.toLowerCase()),
          names: (extension) =>
            [...resources.keys()].filter((name) => name.endsWith('.' + extension)),
          read: async (name) => resources.get(name.toLowerCase()) ?? null,
          async require(name) {
            const bytes = await this.read(name);
            if (!bytes) throw new Error('Authored VMR fixture resource is absent: ' + name);
            return bytes;
          },
          resolveCategory(name, category) {
            let file = name.toLowerCase().replaceAll('\\', '/');
            if (category === 'kcs' && !file.endsWith('.kcs')) file += '.kcs';
            if (category === 'm2psb' && !file.endsWith('.psb')) file += '.psb';
            return resources.has(file) ? file : null;
          },
          async readCategory(name, category) {
            const resolved = this.resolveCategory(name, category);
            return resolved ? this.read(resolved) : null;
          },
        };
        const create = () => {
          const configuration = new NativeConfiguration({ profile }),
            gpu = new ParticlesGL(64, 64),
            random = new ParticleRandom();
          for (const field of [
            'width',
            'height',
            'currentWidth',
            'currentHeight',
            'virtualWidth',
            'virtualHeight',
          ])
            configuration.setField('screen.' + field, 64);
          const world = new NativeWorld({
            game,
            profile,
            configuration,
            images: {},
            host: { nativeGPU: () => gpu, nativeLog() {} },
            storage: { read: async () => null, write: async () => true },
            random,
            motionLibrary: new MotionLibrary(game, { profile, random }),
          });
          return { world, gpu };
        };
        const original = create();
        let fresh;
        try {
          await original.world.initialize('main.kcs');
          const attach = async (context) => {
            const renderer = await context.world.getNativeFeature('renderer'),
              vmr = await context.world.getNativeFeature('vmr9');
            return Object.assign(context, { vmr, renderer, p: renderer.process, d: renderer.d3d });
          };
          const { vmr, p, d, renderer } = await attach(original),
            notify = vmr.create(),
            allocator = p.allocate(0xb0, true),
            lock = p.allocate(8, true),
            info = p.allocate(72, true),
            baseline = d.objects.size,
            deviceRefs = d.objects.get(d.device).references,
            cookie = 0x10674528;
          await renderer.engine.call(ctor, [], allocator);
          const slots = [3, 4, 5, 6].map((index) => p.load(p.load(allocator) + index * 4));
          const results = [
            await vmr.call(notify, 3, cookie, allocator),
            await vmr.call(allocator, 6, notify),
            await vmr.initialize(notify, { width: 3, height: 5, count: 3, minimum: 2 }),
            await vmr.start(notify),
          ];
          const surfaceState = ({ vmr, d, p }) => {
            const record = vmr.record(notify);
            return {
              identity: [
                record.allocator,
                record.presenter,
                record.device,
                record.monitor,
                record.cookie,
              ],
              presenterAddress: p.load(p.load(record.presenter) + 20),
              refs: p.load(allocator + 72),
              surfaces: record.surfaces.map((pointer) => {
                const data = d.surfaceData(pointer);
                return [
                  pointer,
                  data.width,
                  data.height,
                  data.format,
                  d.objects.get(pointer).references,
                ];
              }),
            };
          };
          const upload = async ({ vmr, p }, index, rgba) => {
            const surface = vmr.record(notify).surfaces[index];
            const status = await vmr.call(surface, 13, lock, 0, 0);
            if (status) throw new Error('Authored decoder LockRect failed ' + status.toString(16));
            const pixels = p.load(lock + 4),
              pitch = p.load(lock);
            for (let y = 0; y < 5; y++)
              for (let x = 0; x < 3; x++) {
                const i = (y * 4 + x) * 4;
                p.write(pixels + y * pitch + x * 4, [rgba[i + 2], rgba[i + 1], rgba[i], 0x21]);
              }
            const unlocked = await vmr.call(surface, 14);
            if (unlocked)
              throw new Error('Authored decoder UnlockRect failed ' + unlocked.toString(16));
            return vmr.present(notify, index, info);
          };
          const frame = ({ d, p, gpu }) => {
            const target = p.load(p.load(allocator + 16) + 20);
            return {
              guest: [...d.frame(target).rgba],
              gpu: [...gpu.pixels(d.gpuTarget(d.objects.get(target).surface))],
            };
          };
          const initial = surfaceState(original);
          results.push(await upload(original, 0, frames[0]));
          const firstFrame = frame(original),
            snapshot = structuredClone(original.world.snapshot());
          fresh = create();
          await fresh.world.restore(snapshot);
          await attach(fresh);
          const restored = surfaceState(fresh),
            restoredFrame = frame(fresh);
          results.push(await upload(original, 2, frames[1]), await upload(fresh, 2, frames[1]));
          const secondFrames = [frame(original), frame(fresh)];
          results.push(await fresh.vmr.call(notify, 5, fresh.d.device, fresh.d.monitor));
          const renegotiated = surfaceState(fresh);
          results.push(await upload(fresh, 1, frames[0]));
          const renegotiatedFrame = frame(fresh);
          results.push(
            await fresh.vmr.terminate(notify),
            await fresh.vmr.initialize(notify, { width: 3, height: 5, flags: 8 }),
            await fresh.vmr.start(notify),
            await upload(fresh, 0, frames[1]),
          );
          const fallback = {
            kind: fresh.d.surfaceData(fresh.vmr.record(notify).surfaces[0]).kind,
            frame: frame(fresh),
          };
          const cleaned = [];
          for (const { vmr, d, p } of [original, fresh]) {
            results.push(await vmr.call(notify, 2), await vmr.call(allocator, 2));
            cleaned.push({
              references: d.objects.get(d.device).references === deviceRefs,
              objects: d.objects.size === baseline,
              allocations: !p.allocations.has(allocator) && !p.allocations.has(notify),
            });
          }
          return {
            results,
            slots,
            initial,
            restored,
            renegotiated,
            firstFrame,
            restoredFrame,
            secondFrames,
            renegotiatedFrame,
            fallback,
            cleaned,
            identities: [allocator, allocator + 4, d.device, d.monitor, cookie],
            errors: [original.gpu.gl.getError(), fresh.gpu.gl.getError()],
          };
        } finally {
          for (const context of [fresh, original])
            if (context) {
              await context.world.close({ flushFiles: false });
              context.gpu.close();
            }
        }
      },
      { profile, files, gamePE, ctor, frames: [samples(0), samples(1)] },
    );
    expect(result.results).toEqual(new Array(17).fill(0));
    expect(result.errors).toEqual([0, 0]);
    expect(result.slots).toEqual(
      gamePE ? [0x686420, 0x686af0, 0x686340, 0x6861b0] : [0x55cf00, 0x55d5d0, 0x55ce20, 0x55cc90],
    );
    expect(result.initial.identity).toEqual(result.identities);
    expect(result.initial.presenterAddress).toBe(gamePE ? 0x6867d0 : 0x55d2b0);
    expect(result.initial.refs).toBe(3);
    expect(result.initial.surfaces.map(([, ...descriptor]) => descriptor)).toEqual(
      new Array(3).fill([4, 8, 22, 2]),
    );
    expect(result.restored).toEqual(result.initial);
    expect(result.renegotiated.surfaces.map(([, ...descriptor]) => descriptor)).toEqual(
      new Array(3).fill([4, 8, 22, 2]),
    );
    const first = { guest: samples(0), gpu: samples(0) },
      second = { guest: samples(1), gpu: samples(1) };
    expect(result.firstFrame).toEqual(first);
    expect(result.restoredFrame).toEqual(first);
    expect(result.secondFrames).toEqual([second, second]);
    expect(result.renegotiatedFrame).toEqual(first);
    expect(result.fallback).toEqual({ kind: 'Surface9', frame: second });
    expect(result.cleaned).toEqual(
      new Array(2).fill({ references: true, objects: true, allocations: true }),
    );
  });
