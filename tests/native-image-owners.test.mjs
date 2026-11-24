// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageOwnerFixture } from './fixtures/image-owner-fixture.mjs';
import { imageOwnerFiles } from './fixtures/image-owner-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { floatBits } from '../src/kcs.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, kcsProgram, hg3 } from './helpers.mjs';
import { defaultFESWorld } from './fixtures/default-fes-world.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { installImageOwnerOracle } from './fixtures/image-owner-oracle-world.mjs';

test('2.6.1.67 KCS owns CP932 image layers, their bitmap metadata and pixel edits', async (t) => {
  const owner = [0x13, 80],
    generated = [0x13, 84],
    empty = [0x13, 88],
    rgba = Uint8Array.from({ length: 24 }, (_, index) => [17, 34, 51, 255][index % 4]),
    program = (calls, strings = []) =>
      kcsProgram(
        [
          [37, 0x3e4d5c61],
          ...calls.flatMap(([id, args, out]) => [
            ...args.map((word) => [37, word]),
            [43, id, args.length * 4],
            ...(out === undefined ? [] : [[38, out]]),
          ]),
          [59],
        ],
        strings,
      ),
    world = await dataWorld('bokutomo-engine-2.6.1.67', {
      '試験.hg3': hg3(3, 2, rgba),
      'load.kcs': program(
        [
          [710, [256], 80],
          [710, [288], 84],
          [733, [2, 1], 88],
        ],
        [
          [256, '試験.hg3'],
          [288, 'missing.hg3'],
        ],
      ),
      'geometry.kcs': program([
        [712, [owner, 128, 132]],
        [712, [empty, 136, 140]],
        [718, [owner, 11, 12], 192],
        [719, [owner, -3, 5], 196],
        [720, [owner, -7, 9], 200],
        [714, [owner, 144, 148]],
        [715, [owner, 152, 156]],
        [717, [owner, 160, 164], 204],
        [717, [empty, 168, 172], 208],
        [724, [owner, 0x10007, 220, 224, 228, 232, 236], 212],
        [724, [owner, 8, 220, 224, 228, 232, 236], 216],
      ]),
      'color.kcs': program([
        [713, [owner, 200, 100, 50]],
        [737, [owner, 3]],
        [728, [owner, 16]],
        [736, [generated, 1, 0, 1, 1, 0xff224466]],
        [737, [generated, 3]],
      ]),
      'resize.kcs': program([
        [719, [owner, 0, 0], 192],
        [718, [owner, 3, 2], 196],
        [730, [owner, 6, 4]],
        [726, [owner, 1, 1]],
      ]),
      'release.kcs': program([
        [711, [owner]],
        [711, [generated]],
        [711, [0]],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    load = await world.spawnScript('load.kcs', { parent, initialExecute: false }),
    execute = async (name) => {
      const task =
          name === 'load.kcs'
            ? load
            : await world.spawnScript(name, { parent, initialExecute: false }),
        m = task.machine,
        floor = m.sp;
      if (name !== 'load.kcs') {
        m.store(80, source);
        m.store(84, target);
        m.store(88, emptyImage);
        m.store(136, 0x9c158fc7);
        m.store(140, 0x9c158fc7);
        m.store(168, 0x9c158fc7);
        m.store(172, 0x9c158fc7);
      }
      await world.runtime.scheduler.execute(task);
      assert.equal(m.sp, floor + 4);
      assert.equal(m.load(floor), 0x3e4d5c61);
      return m;
    };
  const m = await execute('load.kcs'),
    source = m.load(80),
    target = m.load(88),
    emptyImage = world.imageOwners.add(0, load.id, []),
    record = world.imageOwners.get(source),
    images = world.graphics.images,
    bitmap = images.get(record.bitmap),
    targetBitmap = images.get(world.imageOwners.get(target).bitmap);
  assert.equal(m.load(84), 0);
  assert.equal(record.owner, load.id);
  assert.deepEqual(await bitmap.pixels(), new Uint8ClampedArray(rgba));
  bitmap.state.attributes = [{ id: 7, rect: [10, -20, 30, -40], color: 0xff800123 }];
  const geometry = await execute('geometry.kcs');
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => geometry.load(128 + i * 4) | 0),
    [3, 2, 0, 0, 11, 12, -3, 5, -7, 9, 0x9c158fc7 | 0, 0x9c158fc7 | 0],
  );
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => geometry.load(192 + i * 4)),
    [1, 1, 1, 1, 0, 1, 0],
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, i) => geometry.load(220 + i * 4)),
    [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123],
  );
  await execute('color.kcs');
  assert.deepEqual(
    (await bitmap.pixels()).subarray(0, 4),
    Uint8ClampedArray.of(221, 221, 230, 255),
  );
  assert.deepEqual(await targetBitmap.pixels(), Uint8ClampedArray.of(0, 0, 0, 0, 34, 68, 102, 255));
  assert.equal(bitmap.state.mask, 16);
  await execute('resize.kcs');
  const resized = images.get(record.bitmap);
  assert.deepEqual([resized.width, resized.height], [6, 4]);
  assert.ok(resized.state.revision > 1);
  await execute('release.kcs');
  assert.equal(world.runtime.handles.records.has(source), false);
  assert.equal(world.runtime.handles.records.has(target), false);
});

test('23 Script resolves a base image and owns its decoded and generated canvases', async (t) => {
  const rgba = Uint8Array.of(17, 34, 51, 255, 1, 2, 3, 255),
    world = await defaultFESWorld('grisaia-jp-engine-2.6.1.23', {
      'probe.hg3': hg3(2, 1, rgba),
    });
  t.after(() => world.close());
  const { main, runtime, imageOwners, graphics } = world,
    { machine } = main,
    call = (id, args) => runtime.native('main', id, args, machine, main);
  machine.writeString(',,probe,3', 96);
  assert.deepEqual(await call(598, [96, 144]), { control: 1, value: 1 });
  assert.equal(machine.string(144), 'probe');
  const source = (await call(710, [144])).value,
    sourceBitmap = imageOwners.get(source).bitmap,
    target = (await call(733, [3, 1])).value,
    targetBitmap = imageOwners.get(target).bitmap;
  assert.equal(imageOwners.get(source).owner, main.id);
  assert.notEqual(sourceBitmap, targetBitmap);
  assert.deepEqual(await graphics.images.get(sourceBitmap).pixels(), Uint8ClampedArray.from(rgba));
  assert.deepEqual(await call(714, [source, 176, 180]), { control: 2 });
  assert.deepEqual([machine.load(176), machine.load(180)], [2, 1]);
  const loaded = graphics.images.get(sourceBitmap);
  Object.assign(loaded.state, {
    offsetX: -4,
    offsetY: 6,
    baseX: -2,
    baseY: 3,
    attributes: [{ id: 7, rect: [10, -20, 30, -40], color: 0xff800123 }],
  });
  assert.deepEqual(await call(717, [source, 176, 180]), { control: 1, value: 1 });
  assert.deepEqual([machine.load(176) | 0, machine.load(180)], [-2, 3]);
  await call(715, [source, 176, 180]);
  assert.deepEqual([machine.load(176) | 0, machine.load(180)], [-4, 6]);
  const fields = [192, 196, 200, 204, 208];
  assert.deepEqual(await call(724, [source, 0x10007, ...fields]), { control: 1, value: 1 });
  assert.deepEqual(
    fields.map((at) => machine.load(at)),
    [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123],
  );
  const empty = imageOwners.add(0, main.id, []);
  assert.deepEqual(await call(712, [empty, 176, 180]), { control: 2 });
  assert.deepEqual([machine.load(176), machine.load(180)], [0, 0]);
  Object.assign(loaded.state, { offsetX: 0, offsetY: 0 });
  await call(713, [source, 200, 100, 100]);
  assert.equal((await loaded.pixels())[0], 34);
  await call(730, [source, 4, 2]);
  await call(714, [source, 176, 180]);
  assert.deepEqual([machine.load(176), machine.load(180)], [4, 2]);
  const resized = graphics.images.get(imageOwners.get(source).bitmap),
    revision = resized.state.revision;
  await call(726, [source, 1, 1]);
  assert.ok(resized.state.revision > revision);
  assert.deepEqual(await call(736, [target, 1, 0, 1, 1, 0xff224466]), { control: 2 });
  assert.deepEqual(
    (await graphics.images.get(targetBitmap).pixels()).subarray(4, 8),
    Uint8ClampedArray.of(34, 68, 102, 255),
  );
  await call(737, [target, 3]);
  assert.deepEqual(
    (await graphics.images.get(targetBitmap).pixels()).subarray(4, 8),
    Uint8ClampedArray.of(221, 187, 153, 255),
  );
  const drawID = await world.objects.create({ kind: 15, parent: world.root }),
    draw = graphics.drawTasks.get(drawID),
    drawTarget = world.nativeTaskID(drawID),
    key = (world.nativeTaskID(main.id) | (3 << 16)) >>> 0,
    one = floatBits(1);
  await call(256, [drawTarget, 8, 6]);
  assert.deepEqual(
    await call(732, [drawTarget, 3, target, one, one, 0, 0, 0, one, one, 511, 1, 0]),
    { control: 2 },
  );
  assert.deepEqual(draw.entry(key).position, [1, 1]);
  assert.equal(draw.entry(key).alpha, 255);
  const retained = world.retainedDraw.record(draw, key);
  assert.deepEqual(await call(625, [drawTarget, 3, 0]), { control: 2 });
  assert.equal(world.renderSources.get(retained.source).enabled, 0);
  assert.deepEqual(await call(728, [source, 16]), { control: 2 });
  assert.equal(resized.state.mask, 16);
  assert.deepEqual(await call(711, [source]), { control: 2 });
  assert.equal(runtime.handles.records.has(source), false);
  assert.equal(imageOwners.get(target).bitmap, targetBitmap);
});

test('63 Script image owners load, query, resize, fill and release their own bitmaps', async (t) => {
  const rgba = Uint8Array.from({ length: 24 }, (_, index) => [17, 34, 51, 255][index % 4]),
    world = await defaultFESWorld('rebellions-jp-engine-2.6.1.63', {
      'probe.hg3': hg3(3, 2, rgba),
    });
  t.after(() => world.close());
  const { main, runtime, imageOwners, graphics } = world,
    m = main.machine,
    native = (id, args) => runtime.native('main', id, args, m, main);
  m.writeString('probe,1,2', 128);
  assert.deepEqual(await native(598, [128, 160]), { control: 1, value: 1 });
  assert.equal(m.string(160), 'probe');
  const { value: source } = await native(710, [160]),
    owner = imageOwners.get(source),
    size = () => [m.load(192), m.load(196)];
  assert.equal(owner.owner, main.id);
  assert.deepEqual(await graphics.images.get(owner.bitmap).pixels(), Uint8ClampedArray.from(rgba));
  const bitmap = graphics.images.get(owner.bitmap);
  bitmap.state.baseX = -3;
  bitmap.state.baseY = 4;
  assert.deepEqual(await native(717, [source, 192, 196]), { control: 1, value: 1 });
  assert.deepEqual(size(), [0xfffffffd, 4]);
  bitmap.state.attributes = [{ id: 7, rect: [10, -20, 30, -40], color: 0xff800123 }];
  const outputs = Array.from({ length: 5 }, (_, index) => 512 + index * 4);
  assert.deepEqual(await native(724, [source, 0x10007, ...outputs]), { control: 1, value: 1 });
  assert.deepEqual(
    outputs.map((at) => m.load(at)),
    [10, 0xffffffec, 30, 0xffffffd8, 0xff800123],
  );
  assert.deepEqual(await native(724, [source, 8, ...outputs]), { control: 1, value: 0 });
  assert.equal(m.load(outputs[0]), 10);
  await native(714, [source, 192, 196]);
  assert.deepEqual(size(), [3, 2]);
  assert.deepEqual(await native(728, [source, 16]), { control: 2 });
  assert.equal(bitmap.state.mask, 16);
  await native(728, [source, 0]);
  assert.deepEqual(await native(713, [source, 200, 100, 50]), { control: 2 });
  assert.deepEqual((await bitmap.pixels()).subarray(0, 4), Uint8ClampedArray.of(34, 34, 25, 255));
  assert.deepEqual(await native(737, [source, 3]), { control: 2 });
  assert.deepEqual(
    (await bitmap.pixels()).subarray(0, 4),
    Uint8ClampedArray.of(221, 221, 230, 255),
  );
  assert.deepEqual(await native(723, [source, 90]), { control: 2 });
  assert.deepEqual(await native(727, [source, 1]), { control: 2 });
  await native(714, [source, 192, 196]);
  assert.deepEqual(size(), [2, 3]);
  await native(730, [source, 6, 4]);
  await native(714, [source, 192, 196]);
  assert.deepEqual(size(), [6, 4]);
  const resized = graphics.images.get(owner.bitmap),
    revision = resized.state.revision;
  assert.deepEqual(await native(726, [source, 1, 1]), { control: 2 });
  assert.equal(resized.width, 6);
  assert.ok(resized.state.revision > revision);
  const { value: target } = await native(733, [2, 1]),
    targetBitmap = imageOwners.get(target).bitmap;
  assert.deepEqual(await native(736, [target, 0, 0, 2, 1, 0xff224466]), { control: 2 });
  assert.deepEqual(await native(737, [target, 3]), { control: 2 });
  assert.deepEqual(
    await graphics.images.get(targetBitmap).pixels(),
    Uint8ClampedArray.of(0x22, 0x44, 0x66, 255, 0x22, 0x44, 0x66, 255),
  );
  const drawID = await world.objects.create({ kind: 15, parent: main.id });
  const draw = graphics.drawTasks.get(drawID);
  const drawTarget = world.nativeTaskID(drawID);
  await native(256, [drawTarget, 8, 6]);
  await native(260, [drawTarget, 0, 0]);
  const args = [drawTarget, 1, target, 0, 0, 0, 0, 0, floatBits(1), floatBits(1), 512, 1, 0];
  assert.deepEqual(await native(731, args), { control: 2 });
  const key = (world.nativeTaskID(main.id) | (1 << 16)) >>> 0;
  assert.equal(draw.entry(key).alpha, 255);
  args[3] = floatBits(1);
  assert.deepEqual(await native(732, args), { control: 2 });
  assert.deepEqual(draw.entry(key).position, [1, 0]);
  await native(711, [source]);
  await native(711, [target]);
  const drawn = graphics.images.get(draw.entry(key).image);
  assert.deepEqual(
    (await drawn.pixels()).subarray(0, 4),
    Uint8ClampedArray.of(0x22, 0x44, 0x66, 255),
  );
  await native(258, [drawTarget, 1]);
  assert.equal(draw.entry(key), undefined);
  assert(!runtime.handles.records.has(source));
  assert(!runtime.handles.records.has(targetBitmap));
});

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} image owners decode raw pixels, attributes and composed ANM resources`,
    { skip: !process.env[variable] },
    async () => {
      const f = await imageOwnerFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        m = f.machine,
        p = f.process,
        call = (id, args) => f.images.apply(id, args, m, { id: 1 });
      try {
        m.writeString('probe.hg2', 256);
        const h = (await call(0x2c6, [256])).value,
          owner = f.images.pointer(h),
          bitmap = p.load(p.load(owner + 12)),
          original = [];
        assert.ok(h);
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 4; x++) {
            const at = await f.engine.call(
                profile.startsWith('sdk-') ? 0x5638e0 : 0x68cd70,
                [x, y],
                bitmap,
              ),
              pixel = p.read(at, 4);
            original.push(pixel[2], pixel[1], pixel[0], pixel[3]);
          }
        assert.deepEqual(
          original,
          Array.from({ length: 48 }, (_, i) => (i * 37 + 19) & 255),
        );
        m.bytes(768, 24).fill(0xa5);
        await call(0x2c8, [h, 768, 772]);
        assert.deepEqual([m.load(768), m.load(772), m.load(776)], [4, 3, 0xa5a5a5a5]);
        await call(0x2e0, [h, 0, 0, 4, 3, 0xff123456]);
        const first = await f.engine.call(
          profile.startsWith('sdk-') ? 0x5638e0 : 0x68cd70,
          [0, 0],
          bitmap,
        );
        assert.deepEqual(p.read(first, 4), Uint8Array.of(0x56, 0x34, 0x12, 0xff));
        for (const name of ['attr.hg3', 'anim.hg2', 'composite,1,2.hg2']) {
          m.writeString(name, 256);
          const next = (await call(0x2c6, [256])).value;
          assert.ok(next, name);
          if (name === 'attr.hg3') {
            const data = p.load(p.load(f.images.pointer(next) + 12)),
              first = p.load(p.load(p.load(data + 72))),
              attributeData = p.load(first + 20),
              released = [],
              stop = p.observeFree((address) => {
                if (address === first || address === attributeData) released.push(address);
              });
            try {
              assert.deepEqual(await call(0x2d5, [next, next]), { control: 1, value: 1 });
            } finally {
              stop();
            }
            assert.deepEqual(
              released,
              [],
              'self-copy keeps the native attribute node and its payload',
            );
            m.bytes(768, 24).fill(0xa5);
            assert.equal((await call(0x2d4, [next, 0x10007, 768, 772, 776, 780, 784])).value, 1);
            assert.deepEqual(
              Array.from({ length: 5 }, (_, i) => m.load(768 + i * 4)),
              [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123],
            );
            assert.equal(m.load(788), 0xa5a5a5a5);
          }
          await call(0x2c7, [next]);
        }
        const prior = f.handles.records.size;
        m.writeString('missing.hg2', 256);
        assert.equal((await call(0x2c6, [256])).value, 0);
        assert.equal(f.handles.records.size, prior);
        assert.equal((await call(0x2d5, [0, 0x41414141])).value, 1);
        assert.equal((await call(0x2d5, [0x41414141, 0])).value, 1);
        assert.equal((await call(0x2d5, [h, h])).value, 1);
        m.nativeArgumentBase = 3000;
        m.store(3000, h);
        await call(0x2c7, []);
        assert.equal(p.allocations.has(owner), false);
        assert.throws(() => f.images.pointer(h), /released/);
      } finally {
        await f.engine.close();
      }
    },
  );
  test(
    `${profile} original image ownership and retained references survive a fresh process`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        f = await imageOwnerFixture(bytes, profile),
        fresh = await imageOwnerFixture(bytes, profile);
      try {
        f.machine.writeString('probe.hg2', 256);
        const h = (await f.images.apply(0x2c6, [256], f.machine, { id: 17 })).value,
          pointer = f.images.pointer(h),
          retain = profile.startsWith('sdk-') ? 0x5e1d20 : 0x740e70;
        await f.engine.call(retain, [], pointer);
        assert.equal(f.process.load(pointer), 2);
        const snapshot = structuredClone({
          engine: f.engine.snapshot(),
          handles: f.handles.snapshot(),
          machine: f.machine.snapshot(),
        });
        fresh.engine.restore(snapshot.engine);
        fresh.handles.restore(snapshot.handles);
        fresh.machine.restore(snapshot.machine);
        assert.equal(fresh.images.pointer(h), pointer);
        assert.equal(fresh.process.load(pointer), 2);
        await fresh.images.releaseOwner(17);
        assert.equal(fresh.process.load(pointer), 1);
        assert.equal(fresh.process.allocations.has(pointer), true);
        assert.throws(() => fresh.images.pointer(h), /released/);
        assert.equal(f.process.load(pointer), 2);
        assert.equal(f.images.pointer(h), pointer);
        await fresh.engine.call(fresh.images.releaseAddress, [], pointer);
        assert.equal(fresh.process.allocations.has(pointer), false);
        await fresh.images.releaseOwner(17, { dispose: true });
        assert.equal(fresh.images.refs.contexts.has(17), false);
        assert.equal(f.images.refs.contexts.has(17), true);
      } finally {
        await fresh.engine.close();
        await f.engine.close();
      }
    },
  );
  test(
    `${profile} original World image owners use their original view and release on failed Script reload`,
    {
      skip:
        !process.env[variable] ||
        (!profile.startsWith('sdk-') &&
          'Full game World uses the real GPU in browser/native-image-owners.spec.mjs'),
    },
    async () => {
      const executable = new Uint8Array(await readFile(process.env[variable])),
        files = Object.fromEntries(await imageOwnerFiles());
      if (!profile.startsWith('sdk-'))
        files['emotedriver.dll'] = new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
      const make = () => {
          const game = memoryGame({
              ...files,
              'engine.exe': executable,
              'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
            }),
            configuration = new NativeConfiguration({ profile }),
            random = new ParticleRandom();
          Object.assign(configuration.screen, {
            width: 640,
            height: 480,
            currentWidth: 640,
            currentHeight: 480,
            virtualWidth: 640,
            virtualHeight: 480,
          });
          game.readCategory = (name, category) => game.read(game.resolveCategory(name, category));
          game.resolveCategory = (name, category) =>
            game.has(name) ? name : `@cat/${category}/${name}`;
          return installImageOwnerOracle(
            new NativeWorld({
              game,
              images: {},
              host: {},
              profile,
              configuration,
              random,
              motionLibrary: new MotionLibrary(game, { profile, random }),
              storage: { read: async () => null, write: async () => true },
            }),
          );
        },
        world = make();
      let fresh;
      try {
        await world.initialize('main.kcs');
        const task = world.main,
          m = task.machine;
        m.writeString('probe.hg2', 256);
        const h = (await world.runtime.native('main', 0x2c6, [256], m, task)).value,
          owners = await world.getNativeFeature('image-owners'),
          pointer = owners.pointer(h),
          platform = await world.getNativeFeature('graphics-platform'),
          renderer = await world.getNativeFeature('renderer'),
          tm = await world.getNativeFeature('task-memory'),
          script = await tm.pointer(task.id),
          p = world.nativeEngine.process;
        assert.ok(h);
        assert.equal(renderer.initialized, true);
        assert.equal(p.load(script + 116), platform.refs.view);
        assert.equal(p.load(pointer + 4), platform.refs.view);
        // Original Script owns this exact list. Default JS owners have no PE list.
        assert.equal(
          p.load(script + 156),
          world.nativeEngine.features.get('image-owners').refs.contexts.get(task.id).list,
        );
        const child = await world.objects.create({
            kind: 12,
            parent: task.id,
            name: 'Image child',
          }),
          ci = world.objects.objects.get(child).implementation;
        await ci.loadScript('main.kcs');
        ci.machine.writeString('probe.hg2', 256);
        const ch = (await world.runtime.native('main', 0x2c6, [256], ci.machine, ci.task)).value;
        assert.notEqual(owners.pointer(ch), pointer);
        await world.objects.release(child);
        assert.equal(owners.pointer(h), pointer);
        assert.throws(() => owners.pointer(ch), /released/);
        const saved = structuredClone(world.snapshot());
        fresh = make();
        await fresh.restore(saved);
        const ro = await fresh.getNativeFeature('image-owners');
        assert.equal(ro.pointer(h), pointer);
        const fm = fresh.main.machine;
        fm.bytes(768, 12).fill(0xa5);
        await fresh.runtime.native('main', 0x2c8, [h, 768, 772], fm, fresh.main);
        assert.deepEqual([fm.load(768), fm.load(772), fm.load(776)], [4, 3, 0xa5a5a5a5]);
        await fresh.objects.objects
          .get(fresh.main.id)
          .implementation.loadScript('missing.kcs', { nativeLoad: true });
        assert.equal(fresh.nativeEngine.process.allocations.has(pointer), false);
        assert.throws(() => ro.pointer(h), /released/);
        assert.equal(owners.pointer(h), pointer);
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
}
