// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { nativeM2Files } from '../fixtures/native-m2-fixture.mjs';
import { profiles } from '../fixtures/native-vmr-surface.mjs';
import { kcsProgram } from '../helpers.mjs';

for (const [profile, variable, texture, format] of profiles.flatMap(([profile, variable]) =>
  [false, true].flatMap((texture) =>
    (texture ? ['avi', 'vp8', 'ogv', 'wmv'] : ['avi', 'vp8', 'vp9', 'ogv', 'wmv']).map((format) => [
      profile,
      variable,
      texture,
      format,
    ]),
  ),
))
  test(`${profile} original Plane ${texture ? 'Texture Renderer' : 'VMR9'} ${format === 'wmv' ? 'handles mounted' : 'plays and restores its mounted'} ${['avi', 'ogv', 'wmv'].includes(format) ? format.toUpperCase() : 'WebM ' + format.toUpperCase()}`, async ({
    page,
  }) => {
    const gamePE = profile.startsWith('nekopara-');
    test.skip(
      !process.env[variable] || (gamePE && !process.env.CATSYSTEM2_EMOTE_DLL),
      'Requires the frozen engine and its imported driver',
    );
    test.setTimeout(90000);
    const wmv = format === 'wmv',
      split = !wmv && format !== 'avi',
      ogg = format === 'ogv',
      extension = split && !ogg ? 'webm' : format;
    const [exe, source, converted] = await Promise.all([
      readFile(process.env[variable]),
      readFile(
        new URL(
          {
            avi: '../fixtures/native-plane-movie.avi',
            vp8: '../fixtures/native-plane-movie-vp8.webm',
            vp9: '../fixtures/native-plane-movie.webm',
            ogv: '../fixtures/native-plane-movie.ogv',
            wmv: '../fixtures/native-plane-movie.wmv',
          }[format],
          import.meta.url,
        ),
      ),
      readFile(
        new URL(
          ogg || wmv
            ? `../fixtures/native-plane-movie-${format}.mp4`
            : '../fixtures/native-plane-movie.webm',
          import.meta.url,
        ),
      ),
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
    files['movie/clip.' + extension] = [...source];
    if (split || wmv) files['movie/invalid.' + extension] = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 1];
    if (wmv && gamePE) {
      const badPacket = await readFile(
        new URL('../fixtures/native-plane-movie-wmv-packed.wmv', import.meta.url),
      );
      badPacket[Number(badPacket.readBigUInt64LE(16)) + 50 + 13] = 0x80;
      files['movie/invalid-packet.wmv'] = [...badPacket];
      const dataObject = Number(source.readBigUInt64LE(16)),
        end = dataObject + Number(source.readBigUInt64LE(dataObject + 16)),
        unindexed = Buffer.from(source.subarray(0, end));
      unindexed.writeBigUInt64LE(BigInt(end), 70);
      files['movie/unindexed.wmv'] = [...unindexed];
    }
    await page.goto('/');
    const result = await page.evaluate(
      async ({ profile, files, gamePE, movie, texture, extension, format }) => {
        const directWebM = extension === 'webm',
          ogg = format === 'ogv',
          wmv = format === 'wmv',
          split = directWebM || ogg;
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
          '<int01><name>movie</name><int>movie.int</int><ext>' +
          extension +
          '</ext><dir>movie</dir></int01>' +
          '<int02><name>veff</name><int>veff.int</int><ext>' +
          extension +
          '</ext><dir>movie</dir></int02></INT></document>';
        resources.set('startup.xml', new BlobFile(new Blob([xml])));
        const game = new GameFiles(resources);
        await game.open();
        const sourceBytes = Uint8Array.from(files['movie/clip.' + extension]),
          sha256 = await nativeImageIdentity(sourceBytes),
          decoders = [],
          diagnostics = [];
        let url;
        // A stale same-name sidecar cannot replace the bytes selected by the
        // original IFile. The valid converted copy has a qualified alias.
        if (!directWebM) {
          const movieBytes = Uint8Array.from(movie),
            mime = ogg || wmv ? 'video/mp4' : 'video/webm';
          url = URL.createObjectURL(new Blob([movieBytes], { type: mime }));
          const sidecar = {
            sourceIdentity: await game.fingerprint(),
            sourceSize: sourceBytes.length,
            sourceSha256: sha256,
            outputSha256: await nativeImageIdentity(movieBytes),
            mime,
            url,
          };
          game.media = {
            ['movie.int/clip.' + extension]: {
              ...sidecar,
              sourceSha256: '0'.repeat(64),
              url: '/wrong',
            },
            ['movie/clip.' + extension]: sidecar,
          };
          if (wmv && gamePE) {
            const unindexed = Uint8Array.from(files['movie/unindexed.wmv']);
            game.media['movie/unindexed.wmv'] = {
              ...sidecar,
              sourceSize: unindexed.length,
              sourceSha256: await nativeImageIdentity(unindexed),
            };
          }
        }
        const moduleReferences = (world) =>
          (ogg
            ? ['dsfoggdemux2.dll', 'dsftheoradecoder.dll', 'dsfvorbisdecoder.dll']
            : ['webmsplit.dll', 'vpxdecoder.dll', 'webmvorbisdecoder.dll']
          ).map((name) => world.nativeEngine.kernel.hostModules.modules.get(name).references);
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
              nativeDiagnostic(detail) {
                diagnostics.push(detail);
              },
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
        let fresh, repeated, audio;
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
          if (wmv && !gamePE) {
            await load(first, plane, 'clip');
            const handle = (await command(first, lookup, world.nativeTaskID(plane))).value,
              movie = handle && world.runtime.handles.get(handle, 'plane-movie');
            await world.objects.release(plane);
            return {
              unsupported: !movie || !p.load(movie),
              decoders: decoders.length,
              remaining: direct.objects.size,
              mediaModule: world.nativeEngine.kernel.hostModules.handle('wmvcore.dll'),
            };
          }
          let rejectedCodec, rejectedHandle, rejectedHandleReleased;
          if (split || wmv) {
            await load(first, plane, 'invalid');
            rejectedHandle = (await command(first, lookup, world.nativeTaskID(plane))).value;
            const rejectedMovie = world.runtime.handles.get(rejectedHandle, 'plane-movie');
            rejectedCodec = {
              filters: [...direct.objects.values()].map(({ interfaces, references, graph }) => [
                Object.keys(interfaces)[0],
                references,
                graph,
              ]),
              graph: p.load(rejectedMovie),
              running: (await command(first, 0x10d, rejectedHandle)).value,
              decoders: decoders.length,
              events: world.nativeEngine.kernel.events.events.size,
              taskMemory: world.nativeEngine.kernel.comMemory.snapshot(),
              moduleReferences: split ? moduleReferences(world) : null,
            };
          }
          let rejectedPacket;
          if (wmv) {
            await load(first, plane, 'invalid-packet');
            const invalid = (await command(first, lookup, world.nativeTaskID(plane))).value,
              pointer = world.runtime.handles.get(invalid, 'plane-movie');
            rejectedPacket = {
              graph: p.load(pointer),
              decoders: decoders.length,
              message: diagnostics.find(
                ({ type, filename }) =>
                  type === 'movie-codec-unavailable' && filename?.endsWith('invalid-packet.wmv'),
              )?.message,
            };
          }
          await load(first, plane, 'clip');
          if (split || wmv)
            rejectedHandleReleased = !world.runtime.handles.records.has(rejectedHandle);
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
          const windowsMedia = ({ direct, p }) => {
            const graph = direct.objects.get(graphID);
            if (!wmv) return null;
            const reader = direct.wmReader.filter(graph.wmFilter),
              loader = p.load(graph.movie + 424);
            return {
              filter: p.load(loader + 8) === graph.wmFilter && p.load(graph.wmFilter) === 0x8f0548,
              source: p.load(loader + 12) === reader.input && p.load(reader.input) === 0x8f03b4,
              pins: [...graph.wmPins.values()],
              rendered: graph.wmRendered.size,
              clock: reader.userClock,
              duration: Number(reader.duration),
              seekable: reader.seekable,
              streams: reader.streams.map(
                ({ number, kind, words, maxSample, compressed, allocate }) => [
                  number,
                  kind,
                  words[4],
                  maxSample,
                  compressed,
                  allocate,
                ],
              ),
            };
          };
          const wmTopology = windowsMedia(first),
            wmFilter = graph.wmFilter,
            wmStream = wmv && direct.wmReader.filter(wmFilter).input;
          const pinMediaType = async (context, pin) => {
            const { direct, p } = context,
              engine = context.world.nativeEngine,
              scratch = p.allocate(8, true),
              free = (pointer) =>
                engine.call(engine.resolve({ dll: 'OLE32.dll', name: 'CoTaskMemFree' }), [pointer]);
            let enumeration, type, format;
            try {
              if (await direct.call(pin, 12, scratch))
                throw new Error('Movie pin did not enumerate its media type');
              enumeration = p.load(scratch);
              if (
                (await direct.call(enumeration, 3, 1, scratch, scratch + 4)) ||
                p.load(scratch + 4) !== 1
              )
                throw new Error('Movie media type enumeration did not return one descriptor');
              type = p.load(scratch);
              format = p.load(type + 68);
              const words = Array.from({ length: 17 }, (_, i) => p.load(type + 4 * i)),
                length = words[16];
              return {
                major: words.slice(0, 4),
                subtype: words.slice(4, 8),
                format: words.slice(11, 15),
                length,
                identifier: format ? [...p.read(format, Math.min(length, 7))] : [],
                ...(format && words[11] === 0x05589f80 && length >= 36
                  ? { bitrate: p.load(format + 32) }
                  : {}),
                exhausted:
                  (await direct.call(enumeration, 3, 1, scratch, scratch + 4)) === 1 &&
                  p.load(scratch + 4) === 0 &&
                  p.load(scratch) === type,
              };
            } finally {
              if (format) await free(format);
              if (type) await free(type);
              if (enumeration) await direct.call(enumeration, 2);
              p.free(scratch);
            }
          };
          const splitFilters = async (context) => {
            if (!split) return null;
            const { direct, p } = context,
              record = direct.objects.get(graphID),
              filters = Object.values(record.splitFilters).map((id) => direct.objects.get(id)),
              [splitter] = filters,
              pins = splitter.pins.map((id) => direct.objects.get(id)),
              loader = p.load(record.movie + 424),
              scratch = p.allocate(4, true);
            let nativePeer;
            try {
              const status = await direct.call(record.source + 248, 6, scratch);
              nativePeer = status === 0 && p.load(scratch) === splitter.pins[0];
              if (status === 0) await direct.call(p.load(scratch), 2);
            } finally {
              p.free(scratch);
            }
            const types = [];
            if (ogg) for (const pin of pins) types.push(await pinMediaType(context, pin.primary));
            return {
              names: filters.map(({ name }) => name),
              tracks: pins
                .slice(1)
                .map(({ track: { type, codec, index } }) => ({ type, codec, index })),
              peers: pins
                .slice(1)
                .map(({ peer }) => direct.objects.get(direct.objects.get(peer).parentFilter).role),
              source: pins[0].peer === record.source + 248,
              nativePeer,
              filterIdentities: (ogg ? [24, 28, 32] : [24, 36, 40, 44, 48]).every(
                (offset, index) => p.load(loader + offset) === filters[index].primary,
              ),
              moduleReferences: moduleReferences(context.world),
              ...(ogg ? { types } : {}),
            };
          };
          const nativeWMTypes = async (context) => {
            const types = [];
            for (const pin of context.direct.objects.get(graphID).wmPins.keys())
              types.push(await pinMediaType(context, pin));
            return types;
          };
          const connectedFilters = await splitFilters(first),
            firstWMTypes = wmv && (await nativeWMTypes(first));
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
              duration: Number(record.wmDuration ?? record.video.duration),
              digest: record.sha256,
              state: record.state,
              ...(wmv ? { filterState: p.load(record.wmFilter + 8) } : {}),
              pin: record.source,
              notifyOwnedByMovie: Boolean(filter?.movieNotify),
              color: [pixel(4, 4), pixel(4, 18), pixel(4, 30)],
              presentCalls: d.calls.get(texture ? 'Texture9.LockRect' : 'Device9.StretchRect') ?? 0,
            };
          };
          const pause = (context) => context.direct.call(graph.interfaces.control, 8);
          const paused = await pause(first),
            frame = inspect(first),
            decoderUsesSource = async (decoder) =>
              directWebM
                ? decoder.source?.url.startsWith('blob:') &&
                  (await nativeImageIdentity(
                    new Uint8Array(await (await fetch(decoder.source.url)).arrayBuffer()),
                  )) === sha256
                : decoder.source?.url === url,
            firstBoundMedia = await decoderUsesSource(decoders[0]);
          const nativeSeek = async (context, record, times) => {
            const { p, direct, world } = context,
              scratch = p.allocate(64, true),
              [name, stream, attribute, type, length, iid, pinOut, position] = [
                scratch,
                scratch + 20,
                scratch + 24,
                scratch + 28,
                scratch + 32,
                scratch + 36,
                scratch + 52,
                scratch + 56,
              ],
              reader = direct.wmReader.filter(record.wmFilter),
              pin = record.wmPins.keys().next().value;
            let seeking = 0;
            try {
              world.nativeEngine.kernel.writeString(name, 'seekable', true);
              const getAttribute = async (capacity) => {
                p.write(stream, Uint8Array.of(0xff, 0xff));
                p.write(length, Uint8Array.of(capacity, 0));
                p.store(type, 0xcafed00d);
                p.store(attribute, 0x12345678);
                return [
                  await direct.call(
                    reader.interfaces.wmHeader,
                    5,
                    stream,
                    name,
                    type,
                    attribute,
                    length,
                  ),
                  p.read(stream, 2)[0],
                  p.load(type),
                  p.read(length, 2)[0],
                  p.load(attribute),
                ];
              };
              const reported = [await getAttribute(3), await getAttribute(4)];
              [0x36b73880, 0x11cfc2c8, 0x8000468b, 0x60ef6c5f].forEach((word, index) =>
                p.store(iid + index * 4, word),
              );
              if (await direct.call(pin, 0, iid, pinOut))
                throw new Error('Original Windows Media pin did not expose IMediaSeeking');
              seeking = p.load(pinOut);
              if (p.load(seeking) !== 0x8f080c)
                throw new Error('Windows Media pin returned a different IMediaSeeking interface');
              const observed = [];
              for (const time of times) {
                world.nativeEngine.kernel.write64(position, BigInt(time));
                const status = await direct.call(seeking, 14, position, 1, 0, 0);
                observed.push([
                  status,
                  p.load(record.wmFilter + 172),
                  reader.playing,
                  reader.clockRequest === null ? null : Number(reader.clockRequest),
                ]);
              }
              return { reported, observed };
            } finally {
              if (seeking) await direct.call(seeking, 2);
              p.free(scratch);
            }
          };
          const indexedSeek =
            wmv && (await nativeSeek(first, graph, [9000000, 28930001, 28940000, 0]));
          const videoSize = await direct.call(graph.interfaces.video, 34, info, info + 4);
          const [width, height] = [p.load(info), p.load(info + 4)];
          const wait = async (predicate) => {
            const deadline = performance.now() + 10000;
            while (!(await predicate())) {
              if (performance.now() >= deadline) throw new Error('Plane movie did not advance');
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          };
          let analyser;
          if (format === 'vp8' || ogg || wmv) {
            audio = new AudioContext({ sampleRate: 48000 });
            const source = audio.createMediaElementSource(decoders[0].video);
            analyser = audio.createAnalyser();
            analyser.fftSize = 4096;
            source.connect(analyser);
            analyser.connect(audio.destination);
            await audio.resume();
          }
          world.movies.activate();
          const started = (await command(first, 0x10a, handle, 1)).value;
          await wait(async () => {
            await world.movies.settle();
            return direct.decoders.get(graphID).position() >= 2400000n;
          });
          let decodedAudio;
          if (analyser) {
            const wave = new Float32Array(analyser.fftSize),
              spectrum = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(wave);
            analyser.getFloatFrequencyData(spectrum);
            const peak = spectrum.reduce((best, db, i) => (db > spectrum[best] ? i : best), 0);
            decodedAudio = {
              amplitude: Math.max(...wave.map(Math.abs)),
              hz: (peak * audio.sampleRate) / analyser.fftSize,
            };
          }
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
            const frame = inspect(second);
            return frame.color[0][1] > 230 && frame.presentCalls > 1;
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
          const freshFilters = await splitFilters(second),
            freshWM = windowsMedia(second),
            freshWMTypes = wmv && (await nativeWMTypes(second)),
            finishedRepeat = second.p.load(graph.movie + 392),
            stoppedAfterCompletion = (await command(second, 0x10b, handle)).value,
            boundMedia = [firstBoundMedia, await decoderUsesSource(decoders[1])];
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
              modulesReleased:
                !split || moduleReferences(context.world).every((references) => references === 1),
              ...(wmv
                ? {
                    nativeASFReleased:
                      !context.p.allocations.has(wmFilter - 12) &&
                      !context.p.allocations.has(wmStream - 12),
                  }
                : {}),
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
          let unindexedSeek;
          if (wmv) {
            const target = await third.world.objects.create({
              kind: 2,
              parent: third.world.root,
              name: 'unindexed movie plane',
            });
            await load(third, target, 'unindexed');
            const movie = [...third.direct.objects.values()].find(({ movie }) => movie);
            const pause = await third.direct.call(movie.interfaces.control, 8);
            unindexedSeek = { pause, ...(await nativeSeek(third, movie, [1, 0])) };
            await third.world.objects.release(target);
          }
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
            splitFilters: [connectedFilters, freshFilters],
            windowsMedia: [wmTopology, freshWM],
            windowsMediaTypes: [firstWMTypes, freshWMTypes],
            indexedSeek,
            unindexedSeek,
            rejectedCodec,
            rejectedPacket,
            rejectedHandleReleased,
            decodedAudio,
            muted: decoders.slice(0, 2).map(({ video }) => video.muted),
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
          await audio?.close();
          for (const context of [repeated, fresh, original])
            if (context) {
              await context.world.close({ flushFiles: false });
              context.gpu.close();
            }
          if (url) URL.revokeObjectURL(url);
        }
      },
      { profile, files, gamePE, movie: [...converted], texture, extension, format },
    );
    if (wmv && !gamePE) {
      expect(result).toEqual({ unsupported: true, decoders: 0, remaining: 0, mediaModule: 0 });
      return;
    }
    expect(result.rejected).toBe(true);
    expect(result.replaced).toBe(true);
    if (!texture) expect(result.disabled).toBe(true);
    expect(result.paused).toBe(0);
    expect(result.frame).toMatchObject({
      mode: texture ? 'texture' : 4,
      streams: texture ? null : 1,
      filename: `${texture ? 'veff' : 'movie'}.int/clip.${extension}`,
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
      [0, 0, 31, gamePE || format === 'vp8' ? 11 : 10],
      [0, gamePE ? 14 : 13, 31, 23],
    ]);
    expect(result.size).toEqual([0, 32, 24]);
    expect(result.boundMedia).toEqual([true, true]);
    if (wmv) {
      const topology = {
        filter: true,
        source: true,
        pins: [1, 2],
        rendered: 2,
        clock: true,
        duration: 28930000,
        seekable: true,
        streams: [
          [1, 'video', 0x32564d57, 2304, true, true],
          [2, 'audio', 0x161, 512, true, true],
        ],
      };
      expect(result.windowsMedia).toEqual([topology, topology]);
      expect(result.indexedSeek).toEqual({
        reported: [
          [0xc00d07d1, 0, 0xcafed00d, 4, 0x12345678],
          [0, 0, 3, 4, 1],
        ],
        observed: [
          [0, 9000000, true, 10000000],
          [0, 28930001, true, 29930001],
          [0xc00d002b, 28940000, false, null],
          [0, 0, true, 1000000],
        ],
      });
      expect(result.unindexedSeek).toEqual({
        pause: 0,
        reported: [
          [0xc00d07d1, 0, 0xcafed00d, 4, 0x12345678],
          [0, 0, 3, 4, 0],
        ],
        observed: [
          [0xc00d002b, 1, false, null],
          [0, 0, true, 1000000],
        ],
      });
      const type = (major, subtype, format, length, identifier) => {
        const tail = [0x00100000, 0xaa000080, 0x719b3800];
        return {
          major: [major, ...tail],
          subtype: [subtype, ...tail],
          format: [format, 0x11cec356, 0xaa0001bf, 0x5a595500],
          length,
          identifier,
          exhausted: true,
        };
      };
      expect(result.windowsMediaTypes[0]).toEqual([
        {
          ...type(0x73646976, 0x32564d57, 0x05589f80, 92, [0, 0, 0, 0, 0, 0, 0]),
          bitrate: 386155,
        },
        type(0x73647561, 0x161, 0x05589f81, 28, [0x61, 1, 1, 0, 0x80, 0xbb, 0]),
      ]);
      expect(result.windowsMediaTypes[1]).toEqual(result.windowsMediaTypes[0]);
      expect([result.frame.filterState, result.duringPlayback.filterState]).toEqual([1, 2]);
      expect(result.rejectedCodec).toEqual({
        filters: texture ? [] : [['filter', 1, 0]],
        graph: 0,
        running: 0,
        decoders: 0,
        events: result.eventBaseline,
        taskMemory: [],
        moduleReferences: null,
      });
      expect(result.rejectedHandleReleased).toBe(true);
      expect(result.rejectedPacket).toEqual({
        graph: 0,
        decoders: 0,
        message: 'Invalid ASF packet payload count',
      });
      expect(result.decodedAudio.amplitude).toBeGreaterThan(0.025);
      expect(result.decodedAudio.hz).toBeGreaterThan(420);
      expect(result.decodedAudio.hz).toBeLessThan(460);
    }
    if (split) {
      expect(result.rejectedCodec).toEqual({
        filters: texture ? [] : [['filter', 1, 0]],
        graph: 0,
        running: 0,
        decoders: 0,
        events: result.eventBaseline,
        taskMemory: [],
        moduleReferences: [1, 1, 1],
      });
      expect(result.rejectedHandleReleased).toBe(true);
      expect(result.muted).toEqual([format === 'vp9', format === 'vp9']);
      if (format === 'vp8' || ogg) {
        expect(result.decodedAudio.amplitude).toBeGreaterThan(0.025);
        expect(result.decodedAudio.hz).toBeGreaterThan(420);
        expect(result.decodedAudio.hz).toBeLessThan(460);
      }
      expect(result.splitFilters[0]).toMatchObject({
        names: ogg
          ? ['theora_splitter', 'theora_decoder', 'vorbisdecoder']
          : ['webm_splitter', 'webm_vxdecoder', 'webm_vorbisdecoder', 'AVI Dec', 'CS Converter'],
        tracks: ogg
          ? [
              { type: 1, codec: 'theora', index: 2580911609 },
              { type: 2, codec: 'vorbis', index: 2092013126 },
            ]
          : [
              { type: 1, codec: format === 'vp8' ? 'V_VP8' : 'V_VP9', index: 1 },
              ...(format === 'vp8' ? [{ type: 2, codec: 'A_VORBIS', index: 2 }] : []),
            ],
        peers: ogg ? ['theora', 'ogg-vorbis'] : format === 'vp8' ? ['vpx', 'vorbis'] : ['vpx'],
        source: true,
        filterIdentities: true,
        moduleReferences: [2, 2, 2],
        nativePeer: true,
      });
      expect(result.splitFilters[0]).toEqual(result.splitFilters[1]);
      if (ogg) {
        const packet = {
          major: [0x60891713, 0x4767c24f, 0xa06cc9b6, 0xfc38335b],
          subtype: [0xe436eb8e, 0x11ce524f, 0x2000539f, 0x70a70baf],
          format: [0x95388704, 0x42a9162c, 0x57c34981, 0xf9aa127c],
          exhausted: true,
        };
        expect(result.splitFilters[0].types).toEqual([
          {
            major: [0xe436eb83, 0x11ce524f, 0x2000539f, 0x70a70baf],
            subtype: [0xdd142c1e, 0x43810c1e, 0x2d0b4ea2, 0x8a09b680],
            format: [0, 0, 0, 0],
            length: 0,
            identifier: [],
            exhausted: true,
          },
          { ...packet, length: 42, identifier: [0x80, 116, 104, 101, 111, 114, 97] },
          { ...packet, length: 30, identifier: [1, 118, 111, 114, 98, 105, 115] },
        ]);
      }
    }
    expect(result.released).toEqual(
      new Array(2).fill({
        graph: 0,
        decoder: 0,
        events: result.eventBaseline,
        vmr: 0,
        deviceObjects: result.baseline,
        borrowed: false,
        modulesReleased: true,
        ...(wmv ? { nativeASFReleased: true } : {}),
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
