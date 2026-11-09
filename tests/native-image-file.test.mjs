// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageFileFixture, IMAGE_FILE_LAYOUTS } from './fixtures/image-file-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} ANM presence uses real files, original basename aliases and the original table's first insertion`,
    { skip: !process.env[variable] },
    async () => {
      const f = await imageFileFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        m = f.machine,
        query = async (source, at = 0) => {
          m.writeString(source, at);
          const before = [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
          f.requests.length = 0;
          const reply = await f.feature.apply(0x1ae, [at], m, { id: 1 });
          assert.deepEqual(
            [m.memory, m.shared, ...m.blocks],
            before,
            'query preserves all VM bytes',
          );
          return reply;
        };
      try {
        f.files.set('source.hg3', Uint8Array.of(1, 2, 3));
        assert.deepEqual(await query('source.hg3'), { control: 1, value: 0 });
        assert.deepEqual(f.requests, ['source.anm'], 'an image file does not satisfy ANM presence');
        f.files.set('empty.anm', new Uint8Array());
        f.files.set('broken.anm', Uint8Array.of(0xff));
        assert.equal((await query('empty.hg3')).value, 1, 'zero-length ANM counts as present');
        assert.equal((await query('broken.bmp')).value, 1, 'presence does not decode the payload');

        await f.table('source\tfallback\r\nsource\tmissing\r\n');
        f.files.set('fallback.anm', new Uint8Array());
        assert.deepEqual(await query('DIR/SOURCE.HG3'), { control: 1, value: 1 });
        assert.deepEqual(f.requests, ['DIR/SOURCE.anm', 'fallback.anm']);
        const block = m.allocate(128);
        for (const at of [0, 512, 4608, 0x80000020, block + 32])
          assert.equal((await query('second/source.bmp', at)).value, 1);
        assert.equal(
          (await query('source,1,0.hg3')).value,
          0,
          'selectors remain part of the basename',
        );
        f.files.set('source.anm', Uint8Array.of(7));
        assert.equal((await query('source.hg3')).value, 1);
        assert.deepEqual(
          f.requests,
          ['source.anm'],
          'a direct hit does not consult fallback files',
        );
        f.files.delete('source.anm');
        await f.table('source\tmissing\r\nsource\tfallback\r\n');
        assert.equal(
          (await query('source.hg3')).value,
          0,
          'duplicate keys preserve the first value',
        );
        assert.deepEqual(f.requests, ['source.anm', 'missing.anm']);
        await f.table('SOURCE\tfallback\r\n');
        assert.equal(
          (await query('source.hg3')).value,
          0,
          'table keys are not normalized on insertion',
        );

        f.files.set('item_07.anm', new Uint8Array());
        m.store(16, 7);
        assert.equal((await query('item_%02d[G16]')).value, 1, 'the original KCS formatter runs');
        m.writeString('empty.hg3', 0x80000020);
        assert.equal(
          (await query('%s[H32]')).value,
          1,
          'recursive formatting reads live shared memory',
        );
        const allocations = [...f.process.allocations];
        for (let i = 0; i < 25; i++) assert.equal((await query('empty.hg3')).value, 1);
        assert.deepEqual(
          [...f.process.allocations],
          allocations,
          'all original temporary IFiles are released',
        );
      } finally {
        await f.close();
      }
    },
  );

test(
  'SDK World loads anmtable.csv through its original view and restores the same independently owned map',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      layout = IMAGE_FILE_LAYOUTS[profile],
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      files = {
        'engine.exe': executable,
        'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
        'anmtable.csv': encodeCP932('source\tfallback\r\n'),
        'fallback.anm': new Uint8Array(),
        'direct.anm': Uint8Array.of(0xff),
      },
      make = () => {
        const game = memoryGame(files),
          random = new ParticleRandom(),
          requests = [],
          read = game.read;
        game.read = async (name) => {
          requests.push(name);
          return read(name);
        };
        const world = new NativeWorld({
          game,
          profile,
          random,
          images: {},
          host: {},
          configuration: new NativeConfiguration({ profile }),
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
        return { world, requests };
      },
      original = make(),
      world = original.world,
      query = async (world, source) => {
        world.main.machine.writeString(source, 512);
        return world.runtime.native('main', 0x1ae, [512], world.main.machine, world.main);
      };
    let fresh;
    try {
      await world.initialize('main.kcs');
      assert.deepEqual(await query(world, 'source.hg3'), { control: 1, value: 1 });
      assert.equal((await query(world, 'direct.hg3')).value, 1);
      assert.equal((await query(world, 'second.hg3')).value, 0);
      const platform = await world.getNativeFeature('graphics-platform'),
        p = world.nativeEngine.process,
        view = platform.refs.view,
        map = p.load(view + layout.mapOffset),
        memory = await world.getNativeFeature('task-memory');
      assert.notEqual(map, 0, 'the original view constructor owns the loaded table');
      assert.equal(p.load((await memory.pointer(world.main.id)) + 116), view);
      assert(original.requests.some((name) => name.endsWith('anmtable.csv')));

      const restored = make();
      fresh = restored.world;
      await fresh.restore(structuredClone(world.snapshot()));
      const restoredPlatform = await fresh.getNativeFeature('graphics-platform'),
        fp = fresh.nativeEngine.process;
      assert.equal(restoredPlatform.refs.view, view);
      assert.equal(
        fp.load(view + layout.mapOffset),
        map,
        'fresh process retains the actual map pointer',
      );
      assert.equal((await query(fresh, 'source.hg3')).value, 1);
      assert.equal(
        restored.requests.some((name) => name.endsWith('anmtable.csv')),
        false,
        'restore does not rerun the view constructor or reload its table',
      );
      const source = encodeCP932('second\tfallback\r\n'),
        input = fp.allocate(source.length + 1, true);
      try {
        fp.write(input, source);
        assert.equal(await fresh.nativeEngine.call(layout.mapLoad, [input, source.length], map), 1);
      } finally {
        fp.free(input);
      }
      assert.equal((await query(fresh, 'second.hg3')).value, 1);
      assert.equal(
        (await query(world, 'second.hg3')).value,
        0,
        'the original map remains independent',
      );
      assert.equal((await query(world, 'source.hg3')).value, 1);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
