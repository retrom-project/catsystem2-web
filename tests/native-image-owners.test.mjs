// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageOwnerFixture } from './fixtures/image-owner-fixture.mjs';
import { imageOwnerFiles } from './fixtures/image-owner-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

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
    `${profile} World image owners use the original view and release on failed Script reload`,
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
          return new NativeWorld({
            game,
            images: {},
            host: {},
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
          owners = await world.getNativeFeature('image-owners'),
          pointer = owners.pointer(h),
          platform = await world.getNativeFeature('graphics-platform'),
          renderer = await world.getNativeFeature('renderer'),
          tm = await world.getNativeFeature('task-memory'),
          script = await tm.pointer(task.id),
          p = owners.process;
        assert.ok(h);
        assert.equal(renderer.initialized, true);
        assert.equal(p.load(script + 116), platform.refs.view);
        assert.equal(p.load(pointer + 4), platform.refs.view);
        assert.equal(p.load(script + 156), owners.refs.contexts.get(task.id).list);
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
        assert.equal(ro.process.allocations.has(pointer), false);
        assert.throws(() => ro.pointer(h), /released/);
        assert.equal(owners.pointer(h), pointer);
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
}
