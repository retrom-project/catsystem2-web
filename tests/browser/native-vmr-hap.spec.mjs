// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { nativeM2Files } from '../fixtures/native-m2-fixture.mjs';
import { profiles } from '../fixtures/native-vmr-surface.mjs';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable] of profiles)
  for (const [texture, pcm] of profile.startsWith('sdk-')
    ? [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ]
    : [
        [false, false],
        [true, false],
      ])
    test(`${profile} original Hap5 ${texture ? 'Texture Renderer' : 'VMR9'} ${pcm ? 'plays AVI PCM on the shared audio device' : profile.startsWith('sdk-') ? 'plays through its Plane' : 'retains the native registration failure'}`, async ({
      page,
    }) => {
      const gamePE = profile.startsWith('nekopara-');
      test.skip(
        !process.env[variable] || (gamePE && !process.env.CATSYSTEM2_EMOTE_DLL),
        'Requires the frozen engine and its imported driver',
      );
      test.setTimeout(90000);
      const [engine, clip] = await Promise.all([
        readFile(process.env[variable]),
        readFile(
          new URL(`../fixtures/native-plane-movie${pcm ? '-hap-pcm' : ''}.hap`, import.meta.url),
        ),
      ]);
      await page.route('**/test/engine.exe', (route) => route.fulfill({ body: engine }));
      if (gamePE) {
        const dll = await readFile(process.env.CATSYSTEM2_EMOTE_DLL);
        await page.route('**/test/emotedriver.dll', (route) => route.fulfill({ body: dll }));
      }
      const files = Object.fromEntries(
        Object.entries(gamePE ? nativeM2Files() : {}).map(([name, bytes]) => [name, [...bytes]]),
      );
      files['main.kcs'] = [...kcsProgram([[37, 1024], [43, 0x47, 4], [59]])];
      files['movie/clip.hap'] = [...clip];
      await page.goto('/');
      const result = await page.evaluate(
        async ({ profile, gamePE, texture, pcm, files }) => {
          const [
            { NativeWorld },
            { NativeConfiguration },
            { MotionLibrary },
            { ParticleRandom },
            { StageRenderer },
            { GameFiles, BlobFile },
            { serializeCheckpoint, deserializeCheckpoint },
            { AudioMixer },
          ] = await Promise.all([
            import('/src/native/world.mjs'),
            import('/src/native/config.mjs'),
            import('/src/motion/library.mjs'),
            import('/src/ppi/random.mjs'),
            import('/src/render/stage.mjs'),
            import('/src/files.mjs'),
            import('/src/checkpoint.mjs'),
            import('/src/audio.mjs'),
          ]);
          const resources = new Map(
            Object.entries(files).map(([name, bytes]) => [
              name,
              new BlobFile(new Blob([Uint8Array.from(bytes)])),
            ]),
          );
          for (const name of gamePE ? ['engine.exe', 'emotedriver.dll'] : ['engine.exe'])
            resources.set(name, new BlobFile(await (await fetch('/test/' + name)).blob()));
          const category = (index, name) =>
            `<int${index}><name>${name}</name><int>${name}.int</int><ext>hap</ext><dir>movie</dir></int${index}>`;
          const xml =
            '<?xml version="1.0" encoding="UTF-8"?><document><SCREEN>' +
            '<width>64</width><height>64</height><v_width>64</v_width><v_height>64</v_height>' +
            '</SCREEN><INT><int00><name>kcs</name><ext>kcs</ext></int00>' +
            category('01', 'movie') +
            category('02', 'veff') +
            '</INT></document>';
          resources.set('startup.xml', new BlobFile(new Blob([xml])));
          const game = new GameFiles(resources);
          await game.open();
          const create = () => {
            let tick = 0;
            const canvas = new OffscreenCanvas(64, 64),
              ctx = canvas.getContext('2d', { willReadFrequently: true }),
              stage = new StageRenderer({ canvas, ctx }),
              configuration = new NativeConfiguration({ profile, uiLanguage: 0x0411 }),
              random = new ParticleRandom(),
              gpu = stage.gpu,
              audio = pcm ? new AudioContext({ sampleRate: 16000 }) : null;
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
              bootstrapOwner: {},
              images: {},
              host: { nativeGPU: () => gpu, nativeLog() {}, nativeTimeGetTime: () => tick },
              storage: { read: async () => null, write: async () => true },
              audio: pcm ? new AudioMixer(game, audio) : undefined,
              random,
              motionLibrary: new MotionLibrary(game, { profile, random }),
            });
            world.stageRenderer = stage;
            return {
              world,
              stage,
              ctx,
              gpu,
              audio,
              advance: (milliseconds) => (tick += milliseconds),
            };
          };
          const first = create();
          let fresh;
          try {
            const { world } = first;
            await world.initialize('main.kcs');
            const attach = async (context) => {
              const direct = await context.world.getNativeFeature('directshow');
              return Object.assign(context, {
                direct,
                p: direct.process,
                d: direct.engine.features.get('renderer').d3d,
              });
            };
            await attach(first);
            const plane = await world.objects.create({ kind: 2, parent: world.root, name: 'hap' }),
              native = world.nativeTaskID(plane),
              registration = [],
              driver = first.direct.hapDriver,
              install = driver.install.bind(driver);
            driver.install = (...args) => {
              const result = install(...args);
              registration.push([args[0], args[1], driver.path, args[4], result]);
              return result;
            };
            const call = ({ world }, id, ...args) =>
              world.runtime.native('main', id, args, world.main.machine, world.main);
            const loader = texture ? 0x3dc : 0x2bd,
              lookup = texture ? 0x3dd : 0x2be,
              filename = new TextEncoder().encode('clip\0');
            world.main.machine.bytes(0x500, filename.length).set(filename);
            const baseline = first.d.objects.size;
            await call(first, loader, native, 0x500);
            const graph = [...first.direct.objects.values()].find(({ movie }) => movie);
            const handle = (await call(first, lookup, native)).value;
            if (gamePE) {
              const movie = handle && world.runtime.handles.get(handle, 'plane-movie');
              await world.objects.release(plane);
              return {
                registration,
                opened: Boolean(graph?.video || (movie && first.p.load(movie))),
                removed: driver.path === null,
                decoded: first.direct.decoders.size,
                objects: first.direct.objects.size,
              };
            }
            if (!graph?.video || !graph.hap || !handle)
              throw new Error(
                'Original Hap5 graph did not connect: ' + JSON.stringify(registration),
              );
            await world.sendEngine(plane, world.main.id, 48, 0, 1);
            const inspect = async (context) => {
              const { direct, p, d, ctx, stage } = context,
                current = direct.objects.get(graph.primary),
                v = current.filter && direct.vmr.record(direct.objects.get(current.filter).notify),
                target = p.load(
                  p.load(v ? v.allocator + 16 : current.textureFilter - 12 + 388) + 20,
                ),
                frame = d.frame(target),
                locations = [
                  [4, 4],
                  [12, 4],
                  [20, 18],
                  [28, 18],
                ],
                pixels = locations.map(([x, y]) => [
                  ...frame.rgba.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4),
                ]);
              await stage.render(context.world.graphics.stage);
              const canvas = locations.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
              return { pixels, canvas, format: d.textureData(target).format };
            };
            const paused = await first.direct.call(graph.interfaces.control, 8),
              frame = await inspect(first);
            const decoder = (context) => context.direct.decoders.get(graph.primary);
            const wait = async (context, predicate) => {
              const deadline = performance.now() + 8000;
              for (;;) {
                await context.world.movies.settle();
                if (predicate()) return;
                if (performance.now() >= deadline) throw new Error('Hap5 movie did not advance');
                await new Promise((resolve) => setTimeout(resolve, 15));
              }
            };
            const monitor = (context) => {
              const audio = decoder(context).audio,
                analyser = context.audio.createAnalyser(),
                samples = [...audio.buffer.getChannelData(0).subarray(0, 8)].map((v) => v * 32768);
              analyser.fftSize = 2048;
              audio.gain.connect(analyser);
              return () => {
                const signal = new Float32Array(analyser.fftSize),
                  spectrum = new Float32Array(analyser.frequencyBinCount);
                analyser.getFloatTimeDomainData(signal);
                analyser.getFloatFrequencyData(spectrum);
                const bin = spectrum.reduce((best, db, i) => (db > spectrum[best] ? i : best), 0);
                return {
                  samples,
                  shared: audio.context === context.world.audio.context,
                  gain: audio.gain.gain.value,
                  amplitude: Math.max(...signal.map(Math.abs)),
                  hz: (bin * context.audio.sampleRate) / analyser.fftSize,
                };
              };
            };
            let firstPCM, freshPCM, devicePaused, stoppedPCM;
            const firstMonitor = pcm && monitor(first);
            if (pcm) {
              await call(first, 0x1a1, handle, 80);
              await first.audio.suspend();
            }
            world.movies.activate();
            const started = (await call(first, 0x10a, handle, 2)).value;
            first.advance(pcm ? 2000 : 500);
            await world.movies.settle();
            if (pcm) {
              devicePaused = (await call(first, 0x3e6, handle)).value;
              await first.audio.resume();
              await wait(first, () => decoder(first).position() >= 5000000n);
              firstPCM = firstMonitor();
            }
            const state = world.snapshot(),
              savedGraph = new Map(state.nativeEngine.features)
                .get('directshow')
                .objects.find(([id]) => id === graph.primary)[1],
              firstPosition = Number(savedGraph.position / 10000n),
              stopped = (await call(first, 0x10b, handle)).value,
              checkpoint = await serializeCheckpoint(state);
            if (pcm) stoppedPCM = decoder(first).audio.node === null;
            const released = async (context) => {
              await context.world.objects.release(plane);
              return [
                context.direct.hapDriver.path,
                context.direct.objects.size,
                context.direct.decoders.size,
                context.d.objects.size,
                context.world.nativeEngine.kernel.events.events.size,
                context.world.runtime.handles.records.has(handle),
              ];
            };
            const firstReleased = await released(first);
            fresh = create();
            await fresh.world.restore(await deserializeCheckpoint(checkpoint));
            await attach(fresh);
            const freshHandle = (await call(fresh, lookup, native)).value,
              freshPosition = (await call(fresh, 0x3e6, handle)).value,
              deferred = fresh.direct.decoders.size === 0,
              restoredDriver = fresh.direct.hapDriver.path;
            await fresh.audio?.resume();
            fresh.world.movies.activate();
            await fresh.world.movies.settle();
            if (pcm) {
              const freshMonitor = monitor(fresh);
              await wait(fresh, () => decoder(fresh).position() >= 17500000n);
              freshPCM = freshMonitor();
            } else {
              fresh.advance(1250);
              await fresh.world.movies.settle();
            }
            const later = await inspect(fresh),
              resumedPosition = (await call(fresh, 0x3e6, handle)).value;
            if (pcm) {
              await wait(fresh, () => fresh.p.load(graph.movie + 392) === 1);
            } else {
              fresh.advance(1500);
              await fresh.world.movies.settle();
            }
            await fresh.world.movies.settle();
            const afterRepeat = await inspect(fresh),
              repeatCount = fresh.p.load(graph.movie + 392),
              repeatPosition = (await call(fresh, 0x3e6, handle)).value;
            if (pcm) {
              await wait(fresh, () => fresh.direct.objects.get(graph.primary).exhausted);
            } else {
              fresh.advance(3000);
              await fresh.world.movies.settle();
            }
            const completed = fresh.direct.objects.get(graph.primary).exhausted,
              finalStopped = (await call(fresh, 0x10b, handle)).value,
              freshReleased = await released(fresh);
            return {
              registration,
              frame,
              later,
              afterRepeat,
              paused,
              started,
              stopped,
              finalStopped,
              duration: Number(graph.video.duration),
              handle: [handle, freshHandle],
              positions: [firstPosition, freshPosition, resumedPosition, repeatPosition],
              deferred,
              restoredDriver,
              repeatCount,
              completed,
              devicePaused,
              stoppedPCM,
              pcm: [firstPCM, freshPCM],
              released: [firstReleased, freshReleased],
              baseline,
            };
          } finally {
            for (const context of [fresh, first]) {
              if (!context) continue;
              await context.world.close({ flushFiles: false });
              context.gpu.close();
              await context.audio?.close();
            }
          }
        },
        { profile, gamePE, texture, pcm, files },
      );
      const [type, handler, path, flags, installed] = result.registration[0];
      expect([type, handler, flags, installed]).toEqual([0x63646976, 0x35706148, 2, 1]);
      expect(result.registration).toHaveLength(1);
      if (gamePE) {
        expect(path).toHaveLength(1);
        expect(result).toMatchObject({ opened: false, removed: true, decoded: 0, objects: 0 });
        return;
      }
      expect(path.replaceAll('\\', '/')).toMatch(/(?:^|\/)dsfilter\/HAPCODEC\.dll$/i);
      expect(result.restoredDriver).toBe(path);
      const rgba = (rgb, alpha) => [...rgb, texture ? alpha : 255],
        firstPixels = [
          rgba([247, 32, 16], 0),
          rgba([247, 32, 16], 84),
          rgba([16, 24, 247], 169),
          rgba([16, 24, 247], 255),
        ];
      expect(result.frame.pixels).toEqual(firstPixels);
      expect(result.frame.format).toBe(21);
      expect(result.later.pixels.slice(0, 2)).toEqual([
        rgba([16, 248, 32], 0),
        rgba([16, 248, 32], 84),
      ]);
      expect(result.afterRepeat).toEqual(result.frame);
      expect(result.frame.canvas[0]).toEqual(texture ? [0, 0, 0, 255] : firstPixels[0]);
      expect(result.frame.canvas[1]).toEqual(texture ? [81, 11, 5, 255] : firstPixels[1]);
      expect(result.frame.canvas[3]).toEqual(firstPixels[3]);
      expect([result.paused, result.started, result.stopped, result.finalStopped]).toEqual([
        0, 1, 1, 1,
      ]);
      expect(result.duration).toBe(30000000);
      expect(result.handle[1]).toBe(result.handle[0]);
      if (pcm) {
        const [saved, restored, resumed, repeated] = result.positions;
        expect(saved).toBeGreaterThanOrEqual(500);
        expect(restored).toBe(saved);
        expect(resumed).toBeGreaterThanOrEqual(1750);
        expect(repeated).toBeLessThan(500);
        expect(result.devicePaused).toBe(0);
        expect(result.stoppedPCM).toBe(true);
        for (const track of result.pcm) {
          expect(track.samples).toEqual([0, 704, 1387, 2029, 2610, 3114, 3525, 3830]);
          expect(track.shared).toBe(true);
          expect(track.gain).toBeCloseTo(0.691, 2);
          expect(track.amplitude).toBeGreaterThan(0.08);
          expect(track.amplitude).toBeLessThan(0.09);
          expect(Math.abs(track.hz - 440)).toBeLessThan(8);
        }
      } else {
        expect(result.positions).toEqual([500, 500, 1750, 0]);
      }
      expect(result.deferred).toBe(true);
      expect([result.repeatCount, result.completed]).toEqual([1, true]);
      expect(result.released).toEqual(new Array(2).fill([null, 0, 0, result.baseline, 0, false]));
    });
