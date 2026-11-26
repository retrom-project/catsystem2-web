// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { BrowserNativeMovie } from '../src/native/movie-browser.mjs';
import { nativeABI, validateABI } from '../src/native/abi/index.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { floatBits } from '../src/kcs.mjs';
import { NativeHapPlayback } from '../src/native/movie-hap-playback.mjs';

const sdk = 'sdk-4.01-engine-2.6.1.74';
const game = 'nekopara-vol3-engine-2.6.1.76';
const clip = () => readFile(new URL('./fixtures/native-plane-movie.hap', import.meta.url));
function loader(mode = 0) {
  return kcsProgram(
    [
      [37, 21],
      [37, 2048],
      [43, mode ? 0x3dc : 0x2bd, 8],
      [37, 21],
      [43, mode ? 0x3dd : 0x2be, 4],
      [43, 0x41, 0],
    ],
    [[2048, 'clip.hap']],
  );
}
async function fixture(profile = sdk, options = {}) {
  const world = await dataWorld(
    profile,
    { 'clip.hap': await clip(), 'load.kcs': loader(), ...options.files },
    options,
  );
  const plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: 21 });
  return { world, plane, task: world.objects.objects.get(plane).implementation };
}
function recordIO(world) {
  const read = world.game.read,
    calls = [];
  world.game.read = function (...args) {
    calls.push(args[0]);
    return read.apply(this, args);
  };
  return calls;
}

for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
])
  test(`${profile} Plane video keeps existing models until its MPEG decoder opens`, async (t) => {
    const program = kcsProgram([
        [37, 0x29f34710],
        [37, 21],
        [37, 256],
        [43, 701, 8],
        [37, 21],
        [43, 702, 4],
        [59],
      ]),
      source = Uint8Array.of(0, 0, 1, 0xba, 0x21, 0, 1),
      world = await dataWorld(profile, { 'load.kcs': program, 'movies.int/試験.mpg': source });
    t.after(() => world.close({ flushFiles: false }));
    world.game.nativeResources = {
      entries: [{ name: 'movie', archive: 'movies.int', directory: 'media', extension: 'mpg' }],
    };
    const plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: 21 }),
      owner = world.graphics.get(plane),
      base = await world.objects.create({ kind: 6, parent: world.root, nativeID: 22 }),
      draw = await world.objects.create({ kind: 15, parent: world.root, nativeID: 23 }),
      pixels = Uint8Array.of(37, 51, 67, 83, 101, 159, 181, 193);
    let allowed = false,
      opens = 0,
      closes = 0;
    world.host.nativeMovie = (filename, id) => ({
      open(name, input) {
        assert.equal(filename, 'movies.int/試験.MPG');
        assert.equal(name, filename);
        assert.equal(id, plane);
        assert.deepEqual(input.bytes, source);
        opens++;
        return allowed;
      },
      close() {
        closes++;
      },
      configure() {},
      metadata: () => ({ width: 2, height: 1, duration: 200n, alpha: false }),
      frameStamp: () => 11,
      decodedFrame: () => ({ width: 2, height: 1, rgba: pixels }),
    });
    const run = async (name) => {
        const task = await world.spawnScript('load.kcs', {
            parent: world.root,
            initialExecute: false,
          }),
          machine = task.machine,
          floor = machine.sp;
        machine.writeString(name, 256);
        await world.runtime.scheduler.execute(task);
        assert.equal(machine.sp, floor + 8);
        assert.equal(machine.load(floor), 0x29f34710);
        return machine.load(floor + 4);
      },
      call = (id, args) => world.runtime.native('main', id, args, world.main.machine, world.main);
    await world.sendEngine(plane, world.root, 42, 0, 0, {
      payload: new NativeGraphicsPacket([0, 0, 0, floatBits(4), floatBits(3), 0, 0, 0xff123456]),
    });
    const graph = owner.graph;
    assert.equal(await run('試験.MPG'), 0);
    assert.equal(owner.graph, graph);
    assert.equal(opens, 0);
    world.graphics.createLogicalDevice();
    owner.state.vramType = 2;
    assert.equal(await run('試験.MPG'), 0);
    assert.equal(owner.graph, graph);
    assert.equal(opens, 0);
    owner.state.vramType = 1;
    assert.equal(await run('not-present'), 0);
    assert.equal(owner.graph, graph);
    assert.equal(opens, 0);
    assert.equal(await run('試験.MPG'), 0);
    assert.equal(owner.graph, graph);
    assert.deepEqual([opens, closes], [1, 1]);
    assert.equal(world.movies.sessions.size, 0);
    assert.deepEqual(await call(701, [0, 0xffffffff]), { control: 2 });
    await assert.rejects(
      call(702, [world.nativeTaskID(draw)]),
      /requires a Top, Plane or BasePlane/,
    );
    assert.deepEqual(await call(702, [0]), { control: 1, value: 0 });
    assert.deepEqual(await call(702, [world.nativeTaskID(base)]), { control: 1, value: 0 });
    assert.deepEqual(await call(702, [0xf002713c]), { control: 1, value: 0 });
    await assert.rejects(run('unreviewed.avi'), /Unreviewed media type/);
    assert.equal(owner.graph, graph);
    allowed = true;
    const previous = world.configuration.fields.general.disableMovie;
    world.configuration.fields.general.disableMovie = true;
    const handle = await run('試験.MPG'),
      record = world.movies.get(handle);
    world.configuration.fields.general.disableMovie = previous;
    assert.ok(handle);
    assert.equal(record.owner, plane);
    assert.equal(record.prepared, true);
    assert.deepEqual([owner.graph.type, owner.graph.width, owner.graph.height], [3, 2, 1]);
    const frame = await world.planeMovies.retainedFrame(owner.graph.movie);
    assert.deepEqual(frame.rgba, Uint8ClampedArray.of(37, 51, 67, 255, 101, 159, 181, 255));
    assert.deepEqual(await call(702, [21]), { control: 1, value: handle });
    assert.equal(world.movies.renderGate, 0);
    await world.objects.release(plane);
    assert.deepEqual(await call(702, [21]), { control: 1, value: 0 });
    assert.deepEqual([opens, closes], [2, 2]);
    assert.equal(world.runtime.handles.records.has(handle), false);
    assert.equal(world.runtime.handles.records.has(record.bitmap), false);
  });

test('ordinary Plane movie GCALLs keep a real decoded frame, borrowed controls and cold aliases without original CPU', async () => {
  const first = await fixture(),
    { world, plane, task } = first;
  let fresh;
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    assert.equal(script.status, 'yielded');
    const handle = script.machine.load(script.machine.sp - 4);
    assert.ok(handle > 0);
    const record = world.runtime.handles.get(handle, 'plane-movie');
    assert.equal(record.owner, plane);
    assert.equal(record.prepared, true);
    assert.equal(record.running, false);
    assert.deepEqual([record.width, record.height], [32, 24]);
    assert.equal(task.graph.movie.handle, handle);
    const frame = await world.planeMovies.frame(task.graph.movie);
    assert.deepEqual([frame.width, frame.height], [32, 32]);
    assert.deepEqual([...frame.rgba.subarray(0, 4)], [247, 32, 16, 255]);
    assert.deepEqual([...frame.rgba.subarray(24 * 32 * 4, 24 * 32 * 4 + 4)], [0, 0, 0, 255]);
    const call = (id, args) => world.runtime.native('main', id, args, script.machine, script);
    assert.deepEqual(await call(0x10a, [handle, 2]), { control: 1, value: 1 });
    assert.equal(record.repeat, 2);
    assert.equal(record.running, true);
    assert.equal(world.movies.renderGate, 0, 'renderless movies do not take the fullscreen gate');
    const saved = structuredClone(world.snapshot());
    fresh = await dataWorld(
      sdk,
      { 'clip.hap': await clip(), 'load.kcs': loader() },
      { initialize: false },
    );
    const reads = recordIO(fresh);
    await fresh.restore(structuredClone(saved));
    assert.ok(reads.every((name) => name === 'case.kcs' || name === 'load.kcs'));
    assert.deepEqual(fresh.snapshot(), saved, 'cold restore needs no warm frame or media read');
    assert.equal(fresh.movies.sessions.size, 0);
    const restored = fresh.graphics.tasks.get(plane),
      restoredFrame = await fresh.planeMovies.retainedFrame(restored.graph.movie);
    assert.deepEqual(restoredFrame.rgba, frame.rgba);
    assert.notEqual(restoredFrame.rgba, frame.rgba);
    assert.equal(world.runtime.calls.get('main:701'), 1);
    assert.equal(
      fresh.runtime.calls.get('main:701') ?? 0,
      0,
      'restore never replays the loader GCALL',
    );
    await assert.rejects(call(0x10c, [handle]), /Plane owns/);
    await assert.rejects(call(0x3e4, [handle, 1]), /no video window/);
    await world.objects.release(plane);
    assert.equal(world.runtime.handles.records.has(handle), false);
    assert.equal(
      fresh.runtime.handles.records.has(handle),
      true,
      'old close cannot release the fresh borrower',
    );
    assert.deepEqual(
      (await fresh.planeMovies.retainedFrame(restored.graph.movie)).rgba,
      restoredFrame.rgba,
    );
    assert.deepEqual(
      (await fresh.planeMovies.frame(restored.graph.movie)).rgba,
      restoredFrame.rgba,
    );
    assert.equal(
      reads.filter((name) => name === 'clip.hap').length,
      1,
      'first actual frame reopens the immutable source once',
    );
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('ordinary effect movies preserve decoded alpha and distinguish disabled, missing and failed borrowed objects', async () => {
  for (const profile of [sdk, game]) {
    const { world, task } = await fixture(profile);
    try {
      const m = world.main.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, world.main);
      const reads = recordIO(world);
      let formats = 0;
      const format = world.runtime.services.formatBytes;
      world.runtime.services.formatBytes = function (...args) {
        formats++;
        return format.apply(this, args);
      };
      assert.deepEqual(await call(0x2bd, [0, 0xffffffff]), { control: 2 });
      assert.equal(formats, 0, 'target zero skips formatting');
      assert.deepEqual(await call(0x2be, [0]), { control: 1, value: 0 });
      world.configuration.fields.general.disableMovie = true;
      m.bytes(2048, 9).set(new TextEncoder().encode('clip.hap\0'));
      await call(0x2bd, [21, 2048]);
      assert.deepEqual(await call(0x2be, [21]), { control: 1, value: 0 });
      assert.equal(reads.length, 0, 'disabled standard movie never opens its source');
      await call(0x3dc, [21, 2048]);
      const handle = (await call(0x3dd, [21])).value;
      assert.ok(handle > 0, 'effect loader does not use the fullscreen disable gate');
      assert.deepEqual(
        await call(0x2be, [21]),
        { control: 1, value: 0 },
        'mode-specific registry query',
      );
      const record = world.runtime.handles.get(handle, 'plane-movie');
      if (profile === sdk) {
        assert.equal(record.prepared, true);
        const frame = await world.planeMovies.frame(task.graph.movie);
        assert.deepEqual([...frame.rgba.subarray(0, 4)], [247, 32, 16, 0]);
        assert.deepEqual([...frame.rgba.subarray(8 * 4, 8 * 4 + 4)], [247, 32, 16, 84]);
        assert.deepEqual([...frame.rgba.subarray(24 * 32 * 4, 24 * 32 * 4 + 4)], [0, 0, 0, 0]);
      } else {
        assert.equal(record.prepared, false, 'Game retains its failed Hap registration behavior');
        assert.equal(record.bitmap, 0);
        assert.deepEqual(await call(0x10a, [handle, 1]), { control: 1, value: 0 });
      }
      m.bytes(2048, 12).set(new TextEncoder().encode('missing.hap\0'));
      await call(0x3dc, [21, 2048]);
      assert.deepEqual(await call(0x3dd, [21]), { control: 1, value: 0 });
      assert.equal(
        world.runtime.handles.records.has(handle),
        false,
        'replacement invalidates the borrower',
      );
      assert.equal(task.graph, null);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  }
  const { world, task } = await fixture(sdk, { files: { 'clip.hap': Uint8Array.of(1, 2, 3) } });
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const handle = script.machine.load(script.machine.sp - 4),
      record = world.movies.get(handle);
    assert.ok(handle > 0, 'an existing source with a failed graph remains borrowable');
    assert.equal(record.prepared, false);
    assert.equal(await world.planeMovies.frame(task.graph.movie), null);
    assert.equal(world.movies.sessions.size, 0);
  } finally {
    await world.close();
  }
});

test('ordinary Plane movie owner close during source I/O prevents late handles, graphs and decoder revival', async () => {
  const { world, plane, task } = await fixture();
  let deliver, entered;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  const source = await clip(),
    read = world.game.read;
  world.game.read = function (name) {
    if (name === 'clip.hap') {
      entered();
      return new Promise((resolve) => {
        deliver = resolve;
      });
    }
    return read.call(this, name);
  };
  try {
    const script = await world.spawnScript('load.kcs');
    const loading = world.runtime.scheduler.execute(script);
    const rejected = assert.rejects(loading, /owner closed during media I\/O/);
    await reading;
    assert.throws(() => world.snapshot(), /settled media I\/O/);
    await world.objects.release(plane);
    deliver(source);
    await rejected;
    assert.equal(task.graph, null);
    assert.equal(world.graphics.tasks.has(plane), false);
    assert.equal(world.movies.sessions.size, 0);
    assert.equal(
      [...world.runtime.handles.records.values()].some((r) => r.type === 'plane-movie'),
      false,
    );
    assert.equal(
      world.objects.objects.has(script.id),
      true,
      'borrowed calling Script is not released',
    );
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});

test('Plane Hap registration declares the fixed-path ANSI conversion for every registered profile', () => {
  for (const [profile, ansi] of [
    [sdk, true],
    [game, false],
  ]) {
    assert.equal(nativeABI(profile).capabilities.hapMovieAnsiDriverPath, ansi);
    for (const value of [undefined, 1, 'true']) {
      const broken = structuredClone(nativeABI(profile));
      if (value === undefined) delete broken.capabilities.hapMovieAnsiDriverPath;
      else broken.capabilities.hapMovieAnsiDriverPath = value;
      assert.throws(() => validateABI(broken), /Invalid ABI/);
    }
  }
  assert.throws(() => nativeABI('sdk-unregistered'), /Unregistered/);
});

test('ordinary borrowed movie playback uses the decoder clock for repeat, raw position and independent owner release', async () => {
  const { world, plane, task } = await fixture();
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const handle = script.machine.load(script.machine.sp - 4),
      call = (id, args) => world.runtime.native('main', id, args, script.machine, script);
    const record = world.movies.get(handle),
      bitmap = record.bitmap;
    assert.deepEqual(await call(0x10a, [handle, 2]), { control: 1, value: 1 });
    await call(0x1a1, [handle, 50]);
    assert.equal(record.volume, 50);
    assert.equal(record.decibels, -1000);
    world.clock.advance(1);
    assert.deepEqual(await call(0x3e6, [handle]), { control: 1, value: 1000 });
    const stableFrame = await world.planeMovies.frame(task.graph.movie);
    world.clock.advance(1);
    const nextFrame = await world.planeMovies.frame(task.graph.movie);
    assert.equal(
      nextFrame,
      stableFrame,
      'one bounded texture object follows the actual bitmap revision',
    );
    assert.deepEqual([...nextFrame.rgba.subarray(0, 4)], [16, 248, 32, 255]);
    assert.equal(record.bitmap, bitmap);
    world.clock.advance(1);
    await world.movies.settle();
    assert.equal(record.repeat, 1);
    assert.equal(record.running, true);
    assert.deepEqual(await call(0x3e6, [handle]), { control: 1, value: 0 });
    for (let i = 0; i < 3; i++) world.clock.advance(1);
    await world.movies.settle();
    assert.equal(record.repeat, 0);
    assert.equal(record.running, false);
    assert.deepEqual(await call(0x3e6, [handle]), { control: 1, value: 3000 });
    await world.objects.release(plane);
    assert.equal(world.runtime.handles.records.has(handle), false);
    assert.equal(world.runtime.handles.records.has(bitmap), false);
    assert.equal(world.movies.sessions.size, 0);
    assert.equal(world.objects.objects.has(script.id), true);
  } finally {
    await world.close();
  }
});

test('Plane cold media validates the immutable bytes on first consumption and keeps its retained frame on failure', async () => {
  const { world, plane } = await fixture();
  let fresh;
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const saved = structuredClone(world.snapshot());
    fresh = await dataWorld(
      sdk,
      { 'load.kcs': loader(), 'clip.hap': Uint8Array.of(1, 2, 3) },
      { initialize: false },
    );
    await fresh.restore(structuredClone(saved));
    assert.deepEqual(fresh.snapshot(), saved);
    const source = fresh.graphics.tasks.get(plane).graph.movie,
      before = await fresh.planeMovies.retainedFrame(source);
    await assert.rejects(fresh.planeMovies.frame(source), /source differs/);
    assert.deepEqual(fresh.snapshot(), saved);
    assert.equal(fresh.movies.sessions.size, 0);
    assert.equal(await fresh.planeMovies.retainedFrame(source), before);
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('ordinary Plane model replacement retires the movie borrower and its bitmap before accepting the new graph', async () => {
  const { world, plane, task } = await fixture();
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const handle = script.machine.load(script.machine.sp - 4),
      record = world.movies.get(handle),
      bitmap = world.graphics.images.get(record.bitmap),
      dataHandle = bitmap.dataHandle,
      decoder = world.movies.session(handle);
    await world.planeMovies.frame(task.graph.movie);
    await world.sendEngine(plane, script.id, 42, 0, 0, {
      payload: new NativeGraphicsPacket([0, 0, 0, floatBits(4), floatBits(3), 0, 0, 0xff123456]),
    });
    assert.equal(task.graph.type, 2);
    assert.deepEqual([task.graph.width, task.graph.height], [4, 3]);
    assert.equal(world.runtime.handles.records.has(handle), false);
    assert.equal(world.runtime.handles.records.has(record.bitmap), false);
    assert.equal(world.runtime.handles.records.has(dataHandle), false);
    assert.equal(world.movies.sessions.size, 0);
    assert.equal(world.planeMovies.frames.size, 0);
    assert.equal(decoder.clip, null);
    assert.equal(world.objects.objects.has(script.id), true);
    assert.deepEqual(await world.runtime.native('main', 0x2be, [21], script.machine, script), {
      control: 1,
      value: 0,
    });
  } finally {
    await world.close();
  }
});

test('ordinary Plane decoder input retains the actual native stream selection instead of sidecar audio defaults', async () => {
  const cases = [
    ['native-plane-movie.webm', 'clip.webm', false, sdk],
    ['native-plane-movie-vp8.webm', 'clip.webm', true, sdk],
    ['native-plane-movie.ogv', 'clip.ogv', true, game],
    ['native-plane-movie.wmv', 'clip.wmv', true, game],
  ];
  for (const [fixtureName, filename, audioEnabled, profile] of cases) {
    const source = new Uint8Array(
        await readFile(new URL('./fixtures/' + fixtureName, import.meta.url)),
      ),
      { world, task } = await fixture(profile, { files: { [filename]: source } }),
      sentinel = new Error('controlled decoder boundary'),
      seen = [];
    let closes = 0;
    world.host.nativeMovie = (name, owner, current) => {
      assert.equal(name, '@cat/movie/' + filename);
      assert.equal(owner, task.record.id);
      assert.equal(current, world);
      return {
        open(name, stream) {
          seen.push({ name, stream });
          throw sentinel;
        },
        close() {
          closes++;
        },
        seek() {
          throw new Error('unused decoder seek');
        },
      };
    };
    try {
      await assert.rejects(
        world.planeMovies.load(task, 0, [0, 0, 0], '@cat/movie/' + filename),
        (error) => error === sentinel,
      );
      assert.equal(seen.length, 1);
      assert.equal(seen[0].stream.audioEnabled, audioEnabled);
      assert.deepEqual(seen[0].stream.bytes, source);
      assert.equal(closes, 1);
      assert.equal(world.movies.sessions.size, 0);
      assert.equal(
        [...world.runtime.handles.records.values()].some((r) => r.type === 'plane-movie'),
        false,
      );
    } finally {
      await world.close();
    }
  }
});

test('ordinary movie draw delegates the real top-down Graph vertices and padded UVs exactly once', async () => {
  const { world, task } = await fixture();
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const submissions = [];
    await task.drawGPU({
      drawGeometry(...args) {
        submissions.push(args);
      },
    });
    assert.equal(submissions.length, 1);
    const [triangles, frame, options] = submissions[0],
      vertices = triangles.flatMap((triangle) => triangle.vertices);
    assert.deepEqual(
      [
        Math.min(...vertices.map((v) => v.x)),
        Math.max(...vertices.map((v) => v.x)),
        Math.min(...vertices.map((v) => v.y)),
        Math.max(...vertices.map((v) => v.y)),
      ],
      [0, 32, 0, 24],
    );
    assert.deepEqual(
      [
        Math.min(...vertices.map((v) => v.u)),
        Math.max(...vertices.map((v) => v.u)),
        Math.min(...vertices.map((v) => v.v)),
        Math.max(...vertices.map((v) => v.v)),
      ],
      [0, 1, 0, 0.75],
    );
    assert.deepEqual([...frame.rgba.subarray(0, 4)], [247, 32, 16, 255]);
    assert.deepEqual([...frame.rgba.subarray(20 * 32 * 4, 20 * 32 * 4 + 4)], [16, 24, 247, 255]);
    assert.equal(options.context, world.graphics.d3dContext);
    assert.equal(frame, await world.planeMovies.retainedFrame(task.graph.movie));
  } finally {
    await world.close();
  }
});

test('ordinary movie Run publishes its running word before the delegated host Promise settles', async () => {
  const { world } = await fixture();
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const handle = script.machine.load(script.machine.sp - 4),
      adapter = world.movies.session(handle),
      play = adapter.play;
    let finish,
      calls = 0;
    adapter.play = function (...args) {
      calls++;
      const original = play.apply(this, args);
      return new Promise((resolve) => {
        finish = () => resolve(original);
      });
    };
    const pending = world.movies.play(handle, 3);
    assert.equal(
      world.movies.get(handle).running,
      true,
      'Run sets its word before entering the asynchronous host',
    );
    assert.equal(calls, 1);
    finish();
    assert.equal(await pending, 1);
    assert.equal(world.movies.get(handle).repeat, 3);
    assert.equal(calls, 1);
  } finally {
    await world.close();
  }
});

test('cold running Plane Stop rebinds and seeks its real decoder without an extra Run', async () => {
  const { world, plane } = await fixture();
  let fresh;
  const methods = Object.fromEntries(
    ['open', 'seek', 'play', 'stop'].map((name) => [name, NativeHapPlayback.prototype[name]]),
  );
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const handle = script.machine.load(script.machine.sp - 4);
    await world.runtime.native('main', 0x10a, [handle, 2], script.machine, script);
    const saved = structuredClone(world.snapshot());
    fresh = await dataWorld(
      sdk,
      { 'clip.hap': await clip(), 'load.kcs': loader() },
      { initialize: false },
    );
    await fresh.restore(structuredClone(saved));
    assert.deepEqual(fresh.snapshot(), saved);
    assert.equal(fresh.movies.sessions.size, 0);
    const calls = [];
    for (const [name, original] of Object.entries(methods))
      NativeHapPlayback.prototype[name] = function (...args) {
        calls.push(name);
        return original.apply(this, args);
      };
    const reply = await fresh.runtime.native(
      'main',
      0x10b,
      [handle],
      fresh.main.machine,
      fresh.main,
    );
    assert.deepEqual(reply, { control: 1, value: 1 });
    assert.deepEqual(calls, ['open', 'seek', 'stop']);
    assert.equal(fresh.movies.get(handle).running, false);
    assert.equal(fresh.movies.get(handle).repeat, 2);
    assert.equal(fresh.graphics.tasks.get(plane).graph.movie.handle, handle);
    assert.equal(fresh.frame, saved.frame);
    assert.deepEqual(world.snapshot(), saved, 'fresh Stop leaves the source World running');
  } finally {
    for (const [name, original] of Object.entries(methods))
      NativeHapPlayback.prototype[name] = original;
    await fresh?.close();
    await world.close();
  }
});

test('effect borrower window mode zero keeps the actual movie variant, alpha and cold owner', async () => {
  const { world, plane, task } = await fixture(sdk, { files: { 'load.kcs': loader(1) } });
  let fresh;
  try {
    const script = await world.spawnScript('load.kcs');
    await world.runtime.scheduler.execute(script);
    const handle = script.machine.load(script.machine.sp - 4),
      call = (id, args) => world.runtime.native('main', id, args, script.machine, script);
    assert.equal(task.graph.movie.mode, 1);
    assert.equal((await world.planeMovies.frame(task.graph.movie)).rgba[3], 0);
    assert.deepEqual(await call(0x3e4, [handle, 0]), { control: 2 });
    assert.deepEqual(await call(0x3dd, [21]), { control: 1, value: handle });
    await call(0x10a, [handle, 1]);
    world.clock.advance(4);
    assert.equal(
      (await world.planeMovies.frame(task.graph.movie)).rgba[3],
      0,
      'a window mode change must not force effect RGB opaque',
    );
    const record = world.movies.get(handle);
    assert.equal(record.mode, 0, 'the actual kcVideo window mode word still changes');
    assert.equal(record.planeMode, 1);
    const saved = structuredClone(world.snapshot());
    fresh = await dataWorld(
      sdk,
      { 'clip.hap': await clip(), 'load.kcs': loader(1) },
      { initialize: false },
    );
    await fresh.restore(structuredClone(saved));
    assert.deepEqual(fresh.snapshot(), saved);
    assert.equal(fresh.frame, saved.frame);
    assert.equal(fresh.movies.sessions.size, 0);
    assert.equal(
      (await fresh.planeMovies.retainedFrame(fresh.graphics.tasks.get(plane).graph.movie)).rgba[3],
      0,
    );
    assert.equal(fresh.movies.get(handle).mode, 0);
    assert.equal(fresh.movies.get(handle).planeMode, 1);
  } finally {
    await fresh?.close();
    await world.close();
  }
});

test('browser close after an already-ready seek range cannot install a late seek or write media time', async () => {
  const previous = globalThis.document,
    video = new EventTarget(),
    add = video.addEventListener;
  let at = 0,
    writes = 0,
    seekListeners = 0;
  Object.assign(video, {
    style: {},
    readyState: 2,
    seekable: { length: 1, start: () => 0, end: () => 3 },
    pause() {},
    load() {},
    remove() {},
    removeAttribute() {},
    addEventListener(name, ...args) {
      if (name === 'seeked') seekListeners++;
      return add.call(this, name, ...args);
    },
  });
  Object.defineProperty(video, 'currentTime', {
    get: () => at,
    set(value) {
      at = value;
      writes++;
      queueMicrotask(() => video.dispatchEvent(new Event('seeked')));
    },
  });
  globalThis.document = { createElement: () => video };
  try {
    const decoder = new BrowserNativeMovie({ game: {}, width: 64, height: 48 }),
      seeking = assert.rejects(decoder.seek(10000000n), /closed/);
    await decoder.close();
    await seeking;
    assert.equal(writes, 0);
    assert.equal(seekListeners, 0);
    assert.equal(decoder.source, null);
  } finally {
    globalThis.document = previous;
  }
});

test('browser movie close releases a source that arrives after the owning decoder closed', async () => {
  const previous = globalThis.document;
  const video = new EventTarget();
  Object.assign(video, {
    style: {},
    src: '',
    pause() {},
    remove() {},
    removeAttribute(name) {
      this[name] = '';
    },
    canPlayType() {
      return 'probably';
    },
    load() {
      if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
    },
  });
  globalThis.document = { createElement: () => video };
  let supply,
    released = 0;
  const game = {
    movieSource: () =>
      new Promise((resolve) => {
        supply = resolve;
      }),
  };
  try {
    const decoder = new BrowserNativeMovie({ game, width: 64, height: 48 });
    const opening = decoder.open('owned.webm');
    await decoder.close();
    supply({
      url: 'blob:owned-delayed-source',
      release() {
        released++;
      },
    });
    assert.equal(await opening, false);
    assert.equal(released, 1);
    assert.equal(video.src, '');
    assert.equal(decoder.source, null);
    await decoder.close();
    assert.equal(released, 1);
  } finally {
    globalThis.document = previous;
  }
});

test('browser movie close rejects pending frame and seek waits without a late callback', async () => {
  const previous = globalThis.document,
    video = new EventTarget();
  Object.assign(video, {
    style: {},
    readyState: 0,
    currentTime: 0,
    seekable: { length: 0 },
    pause() {},
    load() {},
    remove() {},
    removeAttribute() {},
  });
  globalThis.document = { createElement: () => video };
  try {
    const decoder = new BrowserNativeMovie({ game: {}, width: 64, height: 48 }),
      frame = assert.rejects(decoder.decodedFrame(), /closed while awaiting a frame/),
      seek = assert.rejects(decoder.seek(10000000n), /closed while awaiting a seek range/);
    await decoder.close();
    await Promise.all([frame, seek]);
    video.dispatchEvent(new Event('loadeddata'));
    video.dispatchEvent(new Event('seeked'));
    assert.equal(decoder.frameCanvas, null);
    assert.equal(decoder.source, null);
  } finally {
    globalThis.document = previous;
  }
});

test('2.6.1.67 MPEG borrower controls resume cold at saved position and release by Plane ownership', async () => {
  const profile = 'bokutomo-engine-2.6.1.67',
    source = Uint8Array.of(0, 0, 1, 0xba, 0x21, 0, 1),
    pixels = Uint8Array.of(37, 51, 67, 83, 101, 159, 181, 193),
    program = kcsProgram(
      [[37, 21], [37, 256], [43, 701, 8], [37, 21], [43, 702, 4], [37, 240], [43, 71, 4], [59]],
      [[256, 'clip']],
    );
  const make = async (initialize = true) => {
    const world = await dataWorld(
        profile,
        { 'load.kcs': program, 'movies.int/clip.mpg': source },
        { initialize },
      ),
      events = [],
      sessions = [];
    world.game.nativeResources = {
      entries: [{ name: 'movie', archive: 'movies.int', directory: 'media', extension: 'mpg' }],
    };
    world.host.nativeMovie = (filename, id) => {
      let at = 0n;
      const session = {
        open(name, input) {
          assert.equal(name, filename);
          assert.deepEqual(input.bytes, source);
          events.push(['open', id]);
          return true;
        },
        metadata: () => ({ width: 2, height: 1, duration: 200n, alpha: false }),
        frameStamp: () => at,
        decodedFrame: () => ({ width: 2, height: 1, rgba: pixels }),
        position: () => at,
        configure() {},
        play() {
          events.push(['play']);
          return true;
        },
        stop() {
          events.push(['stop']);
          return true;
        },
        seek(value) {
          events.push(['seek', value]);
          at = value;
        },
        close() {
          events.push(['close']);
        },
        setPosition(value) {
          at = value;
        },
      };
      sessions.push(session);
      return session;
    };
    return { world, events, sessions };
  };
  const first = await make(),
    { world } = first;
  let fresh;
  try {
    world.graphics.createLogicalDevice();
    const plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: 21 }),
      script = await world.spawnScript('load.kcs', { initialExecute: false, parent: world.root });
    await world.runtime.scheduler.execute(script);
    const machine = script.machine,
      handle = machine.load(machine.sp - 4),
      record = world.movies.get(handle),
      call = (id, args) => world.runtime.native('main', id, args, machine, script);
    assert.ok(handle);
    assert.equal(record.owner, plane);
    assert.equal(world.movies.renderGate, 0);
    assert.deepEqual(await call(266, [handle, 2]), { control: 1, value: 1 });
    assert.deepEqual(await call(269, [handle]), { control: 1, value: 1 });
    first.sessions[0].setPosition(90n);
    const dto = structuredClone(world.snapshot());
    fresh = await make(false);
    await fresh.world.restore(structuredClone(dto));
    assert.deepEqual(fresh.world.snapshot(), dto);
    assert.deepEqual(fresh.events, []);
    assert.equal(fresh.world.runtime.calls.get('main:701') ?? 0, 0);
    const task = fresh.world.main,
      invoke = (id, args) => fresh.world.runtime.native('main', id, args, task.machine, task);
    assert.deepEqual(await invoke(267, [handle]), { control: 1, value: 1 });
    assert.deepEqual(fresh.events, [['open', plane], ['seek', 90n], ['stop']]);
    assert.equal(fresh.world.movies.get(handle).running, false);
    await world.close({ flushFiles: false });
    assert.equal(fresh.world.runtime.handles.records.has(handle), true);
    await assert.rejects(invoke(268, [handle]), /Plane owns/);
    const bitmap = fresh.world.movies.get(handle).bitmap;
    await fresh.world.objects.release(plane);
    assert.equal(fresh.world.runtime.handles.records.has(handle), false);
    assert.equal(fresh.world.runtime.handles.records.has(bitmap), false);
    assert.equal(fresh.events.filter((e) => e[0] === 'close').length, 1);
    assert.equal(fresh.world.movies.renderGate, 0);
    assert.equal(world.nativeEngine, undefined);
    assert.equal(fresh.world.nativeEngine, undefined);
  } finally {
    await fresh?.world.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});
