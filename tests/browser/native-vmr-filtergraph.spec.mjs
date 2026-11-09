// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { nativeM2Files } from '../fixtures/native-m2-fixture.mjs';
import { profiles } from '../fixtures/native-vmr-surface.mjs';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable, texture] of profiles.flatMap(([profile, variable]) =>
  [false, true].map((texture) => [profile, variable, texture]),
))
  test(`${profile} original Plane ${texture ? 'Texture Renderer' : 'VMR9'} plays and restores its mounted AVI`, async ({
    page,
  }) => {
    const gamePE = profile.startsWith('nekopara-');
    test.skip(
      !process.env[variable] || (gamePE && !process.env.CATSYSTEM2_EMOTE_DLL),
      'Requires the frozen engine and its imported driver',
    );
    test.setTimeout(90000);
    const [exe, avi, webm] = await Promise.all([
      readFile(process.env[variable]),
      readFile(new URL('../fixtures/native-plane-movie.avi', import.meta.url)),
      readFile(new URL('../fixtures/native-plane-movie.webm', import.meta.url)),
    ]);
    await page.route('**/test/engine.exe', (route) => route.fulfill({ body: exe }));
    if (gamePE) {
      const dll = await readFile(process.env.CATSYSTEM2_EMOTE_DLL);
      await page.route('**/test/emotedriver.dll', (route) => route.fulfill({ body: dll }));
    }
    const files = Object.fromEntries(
      Object.entries(gamePE ? nativeM2Files() : {}).map(([name, bytes]) => [name, [...bytes]]),
    );
    files['main.kcs'] = [...kcsProgram([[37, 1024], [43, 0x47, 4], [59]])];
    files['movie/clip.avi'] = [...avi];
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, files, gamePE, movie, texture }) => {
        const [
          { NativeWorld },
          { NativeConfiguration },
          { MotionLibrary },
          { ParticleRandom },
          { StageRenderer },
          { GameFiles, BlobFile },
          { BrowserNativeMovie },
          { nativeImageIdentity },
          { serializeCheckpoint, deserializeCheckpoint },
        ] = await Promise.all([
          import('/src/native/world.mjs'),
          import('/src/native/config.mjs'),
          import('/src/motion/library.mjs'),
          import('/src/ppi/random.mjs'),
          import('/src/render/stage.mjs'),
          import('/src/files.mjs'),
          import('/src/native/movie-browser.mjs'),
          import('/src/native/engine-process.mjs'),
          import('/src/checkpoint.mjs'),
        ]);
        const resources = new Map(
          Object.entries(files).map(([name, bytes]) => [
            name,
            new BlobFile(new Blob([Uint8Array.from(bytes)])),
          ]),
        );
        for (const name of gamePE ? ['engine.exe', 'emotedriver.dll'] : ['engine.exe'])
          resources.set(name, new BlobFile(await (await fetch('/test/' + name)).blob()));
        const xml =
          '<?xml version="1.0" encoding="UTF-8"?><document><SCREEN>' +
          '<width>64</width><height>64</height><v_width>64</v_width><v_height>64</v_height>' +
          '</SCREEN><INT><int00><name>kcs</name><ext>kcs</ext></int00>' +
          '<int01><name>movie</name><int>movie.int</int><ext>avi</ext><dir>movie</dir></int01>' +
          '<int02><name>veff</name><int>veff.int</int><ext>avi</ext><dir>movie</dir></int02></INT></document>';
        resources.set('startup.xml', new BlobFile(new Blob([xml])));
        const game = new GameFiles(resources);
        await game.open();
        const movieBytes = Uint8Array.from(movie),
          url = URL.createObjectURL(new Blob([movieBytes], { type: 'video/webm' })),
          sourceBytes = Uint8Array.from(files['movie/clip.avi']),
          sha256 = await nativeImageIdentity(sourceBytes),
          sidecar = {
            sourceIdentity: await game.fingerprint(),
            sourceSize: sourceBytes.length,
            sourceSha256: sha256,
            outputSha256: await nativeImageIdentity(movieBytes),
            mime: 'video/webm',
            url,
          },
          decoders = [];
        // A stale same-name sidecar cannot replace the bytes selected by the
        // original IFile. The valid converted copy has a qualified alias.
        game.media = {
          'movie.int/clip.avi': { ...sidecar, sourceSha256: '0'.repeat(64), url: '/wrong.webm' },
          'movie/clip.avi': sidecar,
        };
        const create = () => {
          const canvas = new OffscreenCanvas(64, 64),
            ctx = canvas.getContext('2d', { willReadFrequently: true }),
            stage = new StageRenderer({ canvas, ctx }),
            configuration = new NativeConfiguration({ profile }),
            random = new ParticleRandom(),
            gpu = stage.gpu;
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
            host: {
              nativeGPU: () => gpu,
              nativeLog() {},
              nativeMovie(_name, _owner, world) {
                const decoder = new BrowserNativeMovie({ game: world.game, timeout: 10000 });
                decoders.push(decoder);
                return decoder;
              },
            },
            storage: { read: async () => null, write: async () => true },
            random,
            motionLibrary: new MotionLibrary(game, { profile, random }),
          });
          world.stageRenderer = stage;
          return { world, gpu, stage, ctx };
        };
        const original = create();
        let fresh, repeated;
        try {
          await original.world.initialize('main.kcs');
          const attach = async (context) => {
            const { world } = context;
            const renderer = await world.getNativeFeature('renderer'),
              direct = world.nativeEngine.features.get('directshow');
            return { ...context, renderer, direct, p: renderer.process, d: renderer.d3d };
          };
          const first = await attach(original),
            { world, p, d } = first,
            plane = await world.objects.create({
              kind: 2,
              parent: world.root,
              name: 'movie plane',
            }),
            info = p.allocate(32, true),
            baseline = d.objects.size,
            eventBaseline =
              p === world.nativeEngine.process && world.nativeEngine.kernel.events.events.size;
          const command = (context, id, ...args) => {
            const { world } = context,
              task = world.main;
            return world.runtime.native('main', id, args, task.machine, task);
          };
          const lookup = texture ? 0x3dd : 0x2be;
          const load = (context, target, filename) => {
            const { world } = context;
            const bytes = new TextEncoder().encode(filename + '\0');
            world.main.machine.bytes(0x500, bytes.length).set(bytes);
            return command(context, texture ? 0x3dc : 0x2bd, world.nativeTaskID(target), 0x500);
          };
          await load(first, plane, 'missing');
          const direct = (first.direct = world.nativeEngine.features.get('directshow'));
          const rejected =
            direct.objects.size === 0 &&
            (await command(first, lookup, world.nativeTaskID(plane))).value === 0;
          let disabled;
          if (!texture) {
            world.configuration.setField('general.disableMovie', 1);
            await load(first, plane, 'clip');
            disabled = direct.objects.size === 0 && decoders.length === 0;
            world.configuration.setField('general.disableMovie', 0);
          }
          await load(first, plane, 'clip');
          await world.sendEngine(plane, world.main.id, 48, 0, 1);
          const graph = [...direct.objects.values()].find((record) => record.movie);
          if (!graph?.video)
            throw new Error(
              'Original Plane did not connect its movie graph: ' +
                JSON.stringify({
                  com: [...world.nativeEngine.kernel.calls].filter(([key]) =>
                    key.includes('ole32'),
                  ),
                  graph: graph && {
                    filename: graph.filename,
                    source: graph.source,
                    filter: graph.filter,
                  },
                  decode: decoders.length,
                }),
            );
          const graphID = graph.primary;
          const handle = (await command(first, lookup, world.nativeTaskID(plane))).value,
            stableHandle = (await command(first, lookup, world.nativeTaskID(plane))).value,
            otherHandle = (await command(first, texture ? 0x2be : 0x3dd, world.nativeTaskID(plane)))
              .value;
          const inspect = (context) => {
            const { direct, p, d, gpu } = context,
              record = direct.objects.get(graphID),
              filter = direct.objects.get(record.filter),
              vmr = filter && direct.vmr.record(filter.notify),
              target = p.load(
                p.load(vmr ? vmr.allocator + 16 : record.textureFilter - 12 + 388) + 20,
              ),
              decoded = d.frame(target),
              frame = texture
                ? decoded.rgba
                : gpu.pixels(d.gpuTarget(d.objects.get(target).surface)),
              pixel = (x, y) =>
                y >= decoded.height
                  ? null
                  : [...frame.slice((y * decoded.width + x) * 4, (y * decoded.width + x + 1) * 4)];
            return {
              mode: filter?.mode ?? 'texture',
              streams: filter?.streams ?? null,
              filename: record.filename,
              size: [record.video.width, record.video.height],
              textureFormat: d.textureData(target).format,
              decoderSurfaceFormat: vmr ? d.surfaceData(vmr.surfaces[0]).format : null,
              duration: Number(record.video.duration),
              digest: record.sha256,
              state: record.state,
              pin: record.source,
              notifyOwnedByMovie: Boolean(filter?.movieNotify),
              color: [pixel(4, 4), pixel(4, 18), pixel(4, 30)],
              presentCalls: d.calls.get(texture ? 'Texture9.LockRect' : 'Device9.StretchRect') ?? 0,
            };
          };
          const pause = (context) => context.direct.call(graph.interfaces.control, 8);
          const paused = await pause(first),
            frame = inspect(first),
            firstBoundMedia = decoders[0].source?.url === url;
          const videoSize = await direct.call(graph.interfaces.video, 34, info, info + 4);
          const [width, height] = [p.load(info), p.load(info + 4)];
          const wait = async (predicate) => {
            const deadline = performance.now() + 10000;
            while (!(await predicate())) {
              if (performance.now() >= deadline) throw new Error('Plane movie did not advance');
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          };
          world.movies.activate();
          const started = (await command(first, 0x10a, handle, 1)).value;
          await wait(async () => {
            await world.movies.settle();
            return direct.decoders.get(graphID).position() >= 2400000n;
          });
          const state = world.snapshot(),
            running = (await command(first, 0x10d, handle)).value,
            savedGraph = new Map(state.nativeEngine.features)
              .get('directshow')
              .objects.find(([id]) => id === graphID)[1],
            duringPlayback = inspect(first),
            stopped = (await command(first, 0x10b, handle)).value,
            stoppedState = (await command(first, 0x10d, handle)).value;
          await load(first, plane, 'missing');
          const replaced = !world.runtime.handles.records.has(handle);
          fresh = create();
          await fresh.world.restore(await deserializeCheckpoint(await serializeCheckpoint(state)));
          const second = await attach(fresh),
            restored = inspect(second),
            restoredHandle = (await command(second, lookup, fresh.world.nativeTaskID(plane))).value,
            restoredTime = (await command(second, 0x3e6, handle)).value;
          await fresh.world.movies.settle();
          const reopenedBeforeActivation = decoders.length !== 1;
          fresh.world.movies.activate();
          await wait(async () => {
            await fresh.world.movies.settle();
            return inspect(second).color[0][1] > 230;
          });
          const later = inspect(second),
            playingAtGreen = (await command(second, 0x10d, handle)).value;
          await second.stage.render(second.world.graphics.stage);
          const pixels = second.ctx.getImageData(0, 0, 64, 64).data,
            bounds = (channel) => {
              const area = [64, 64, -1, -1];
              for (let i = 0; i < 64 * 64; i++)
                if (pixels[i * 4 + channel] > 230) {
                  const x = i % 64,
                    y = i >> 6;
                  area[0] = Math.min(area[0], x);
                  area[1] = Math.min(area[1], y);
                  area[2] = Math.max(area[2], x);
                  area[3] = Math.max(area[3], y);
                }
              return area;
            },
            screen = [bounds(1), bounds(2)];
          await wait(async () => {
            await fresh.world.movies.settle();
            return (await command(second, 0x10d, handle)).value === 0;
          });
          const finishedRepeat = second.p.load(graph.movie + 392),
            stoppedAfterCompletion = (await command(second, 0x10b, handle)).value,
            boundMedia = [firstBoundMedia, decoders[1].source?.url === url];
          const released = [];
          for (const context of [first, second]) {
            await context.world.objects.release(plane);
            released.push({
              graph: context.direct.objects.size,
              decoder: context.direct.decoders.size,
              events: context.world.nativeEngine.kernel.events.events.size,
              vmr: context.direct.vmr.records.size,
              deviceObjects: context.d.objects.size,
              borrowed: context.world.runtime.handles.records.has(handle),
            });
          }
          const loopPlane = await second.world.objects.create({
            kind: 2,
            parent: second.world.root,
            name: 'repeat movie plane',
          });
          await load(second, loopPlane, 'clip');
          const loopHandle = (await command(second, lookup, second.world.nativeTaskID(loopPlane)))
              .value,
            loopMovie = second.world.runtime.handles.get(loopHandle, 'plane-movie'),
            loopStarted = (await command(second, 0x10a, loopHandle, 2)).value,
            thread = second.p.load(second.p.load(loopMovie + 388)),
            worker = (context) =>
              context.world.nativeEngine.features.get('engine-workers').threads.get(thread);
          await wait(async () => {
            await second.world.movies.settle();
            return worker(second)?.polling;
          });
          const loopGraph = [...second.direct.objects.values()].find(
              ({ movie }) => movie === loopMovie,
            ),
            rewindPosition = Number(loopGraph.position),
            replayedAt = Number(second.direct.decoders.get(loopGraph.primary).position() / 10000n),
            replayCount = second.p.load(loopMovie + 392),
            repeatState = second.world.snapshot(),
            loopStopped = (await command(second, 0x10b, loopHandle)).value;
          await second.world.objects.release(loopPlane);
          repeated = create();
          await repeated.world.restore(
            await deserializeCheckpoint(await serializeCheckpoint(repeatState)),
          );
          const third = await attach(repeated),
            parkedAfterRestore = worker(third)?.polling,
            restoredRepeat = third.p.load(loopMovie + 392);
          repeated.world.movies.activate();
          await wait(async () => {
            await repeated.world.movies.settle();
            return [...third.direct.objects.values()].some((movie) => movie.exhausted);
          });
          const parkedAfterSecondEnd = worker(third)?.polling,
            runningAfterSecondEnd = (await command(third, 0x10d, loopHandle)).value,
            joined = (await command(third, 0x10b, loopHandle)).value,
            stoppedThread = worker(third) === undefined && !third.p.load(loopMovie + 388);
          await third.world.objects.release(loopPlane);
          return {
            rejected,
            replaced,
            disabled,
            paused,
            frame,
            restored,
            duringPlayback,
            later,
            screen,
            handles: [handle, stableHandle, restoredHandle],
            otherHandle,
            transitions: [
              started,
              running,
              stopped,
              stoppedState,
              playingAtGreen,
              finishedRepeat,
              stoppedAfterCompletion,
            ],
            restoredTime,
            savedTime: Number(savedGraph.position / 10000n),
            reopenedBeforeActivation,
            digest: sha256,
            size: [videoSize, width, height],
            released,
            baseline,
            eventBaseline,
            boundMedia,
            closed: decoders.every((decoder) => decoder.source === null),
            errors: [original, fresh, repeated].map(({ gpu }) => gpu.gl.getError()),
            repeat: {
              loopStarted,
              loopStopped,
              replayedAt,
              rewindPosition,
              replayCount,
              parkedAfterRestore,
              restoredRepeat,
              parkedAfterSecondEnd,
              runningAfterSecondEnd,
              joined,
              stoppedThread,
              leaked: third.direct.objects.size || third.direct.vmr.records.size,
            },
          };
        } finally {
          for (const context of [repeated, fresh, original])
            if (context) {
              await context.world.close({ flushFiles: false });
              context.gpu.close();
            }
          URL.revokeObjectURL(url);
        }
      },
      { profile, files, gamePE, movie: [...webm], texture },
    );
    expect(result.rejected).toBe(true);
    expect(result.replaced).toBe(true);
    if (!texture) expect(result.disabled).toBe(true);
    expect(result.paused).toBe(0);
    expect(result.frame).toMatchObject({
      mode: texture ? 'texture' : 4,
      streams: texture ? null : 1,
      filename: texture ? 'veff.int/clip.avi' : 'movie.int/clip.avi',
      size: [32, 24],
      textureFormat: 21,
      decoderSurfaceFormat: texture ? null : 22,
      digest: result.digest,
      state: 1,
      notifyOwnedByMovie: !texture,
      presentCalls: 1,
    });
    expect(result.frame.duration).toBeGreaterThan(27000000);
    expect(result.frame.duration).toBeLessThan(29000000);
    expect(result.frame.color[0][0]).toBeGreaterThan(230);
    expect(result.frame.color[0][2]).toBeLessThan(20);
    expect(result.frame.color[1][2]).toBeGreaterThan(230);
    expect(result.frame.color[1][0]).toBeLessThan(20);
    expect(result.frame.color[2]).toEqual([0, 0, 0, texture ? 0 : 255]);
    expect(result.handles[0]).toBeGreaterThan(0);
    expect(result.handles).toEqual(new Array(3).fill(result.handles[0]));
    expect(result.otherHandle).toBe(0);
    expect(result.transitions).toEqual([1, 1, 1, 0, 1, 0, 0]);
    expect(result.restoredTime).toBeGreaterThanOrEqual(240);
    expect(result.restoredTime).toBeLessThan(result.frame.duration / 10000);
    expect(result.restoredTime).toBe(result.savedTime);
    expect(result.reopenedBeforeActivation).toBe(false);
    expect(result.restored).toEqual({ ...result.duringPlayback, presentCalls: 0 });
    expect(result.later.color[0][1]).toBeGreaterThan(230);
    expect(result.later.color[0][0]).toBeLessThan(20);
    expect(result.later.presentCalls).toBeGreaterThan(1);
    expect(result.screen).toEqual([
      [0, 0, 31, gamePE ? 11 : 10],
      [0, gamePE ? 14 : 13, 31, 23],
    ]);
    expect(result.size).toEqual([0, 32, 24]);
    expect(result.boundMedia).toEqual([true, true]);
    expect(result.released).toEqual(
      new Array(2).fill({
        graph: 0,
        decoder: 0,
        events: result.eventBaseline,
        vmr: 0,
        deviceObjects: result.baseline,
        borrowed: false,
      }),
    );
    expect(result.closed).toBe(true);
    expect(result.errors).toEqual([0, 0, 0]);
    expect(result.repeat.replayedAt).toBeLessThan(result.frame.duration / 10000);
    expect(result.repeat).toMatchObject({
      loopStarted: 1,
      loopStopped: 1,
      replayCount: 1,
      rewindPosition: 0,
      parkedAfterRestore: true,
      restoredRepeat: 1,
      parkedAfterSecondEnd: true,
      runningAfterSecondEnd: 1,
      joined: 1,
      stoppedThread: true,
      leaked: 0,
    });
  });
