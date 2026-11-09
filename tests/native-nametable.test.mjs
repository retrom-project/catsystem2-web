// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nameTableFixture, nameTableFiles } from './fixtures/name-table-fixture.mjs';
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
    `${profile} name table original parser, exact aliases, fields and filename substitution use one owner`,
    { skip: !process.env[variable] },
    async () => {
      const f = await nameTableFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        m = f.machine,
        call = (id, args) => f.tables.apply(id, args, m, { id: 1 });
      try {
        m.writeString('names.tsv', 256);
        const h = (await call(0x279, [256])).value,
          pointer = f.tables.pointer(h);
        assert.equal(f.process.allocations.get(pointer), 4);
        m.writeString('Alias', 512);
        assert.equal(
          (await call(0x27b, [h, 512])).value,
          profile.startsWith('sdk-') ? 0xffffffff : 0,
        );
        m.writeString('alias', 512);
        assert.equal((await call(0x27b, [h, 512])).value, 0xffffffff);
        m.writeString('Same', 512);
        assert.equal(
          (await call(0x27b, [h, 512])).value,
          profile.startsWith('sdk-') ? 0xffffffff : 0,
        );
        assert.equal((await call(0x27c, [h, 0])).value, 7);
        m.bytes(1024, 64).fill(0xa5);
        assert.equal((await call(0x27d, [h, 0, 1024])).value, 1);
        assert.equal(m.string(1024), '猫');
        assert.equal(m.load(1027, 1), 0xa5);
        assert.equal((await call(0x27e, [h, 0, 0, 1024])).value, 1);
        assert.equal(m.string(1024), 'bg*.hg2');
        assert.equal((await call(0x27e, [h, 0, 2, 1024])).value, 0);
        assert.equal(m.string(1024), 'bg*.hg2');
        m.writeString('bg001.hg2,1,2', 512);
        assert.equal((await call(0x280, [h, 0, 512, 1024])).value, 1);
        assert.equal(m.string(1024), 'bg*.hg2-001-bg001.hg2,1,2-,1,2');
        assert.equal((await call(0x27f, [h, 0, 512])).value, 0);
        assert.equal((await call(0x27c, [0])).value, 0xffffffff);
        assert.equal((await call(0x280, [0])).value, 0);
        for (const name of ['empty.tsv', 'missing.tsv']) {
          m.writeString(name, 256);
          assert.equal((await call(0x279, [256])).value, 0);
        }
        m.writeString('header.tsv', 256);
        const empty = (await call(0x279, [256])).value;
        assert.ok(empty);
        assert.equal((await call(0x27c, [empty, 0])).value, 0xffffffff);
        await call(0x27a, [empty]);
        m.nativeArgumentBase = 3000;
        m.store(3000, h);
        await call(0x27a, []);
        assert.equal(f.process.allocations.has(pointer), false);
        await assert.rejects(call(0x27c, [h, 0]), /released/);
      } finally {
        await f.engine.close();
      }
    },
  );
  test(
    `${profile} restored name tables retain original pointers and independent ownership`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        f = await nameTableFixture(bytes, profile),
        fresh = await nameTableFixture(bytes, profile);
      try {
        f.machine.writeString('names.tsv', 256);
        const h = (await f.tables.apply(0x279, [256], f.machine, { id: 1 })).value,
          pointer = f.tables.pointer(h),
          saved = structuredClone({
            engine: f.engine.snapshot(),
            handles: f.handles.snapshot(),
            machine: f.machine.snapshot(),
          });
        fresh.engine.restore(saved.engine);
        fresh.handles.restore(saved.handles);
        fresh.machine.restore(saved.machine);
        assert.equal(fresh.tables.pointer(h), pointer);
        assert.equal((await fresh.tables.apply(0x27c, [h, 0], fresh.machine, { id: 1 })).value, 7);
        await fresh.tables.apply(0x27a, [h], fresh.machine, { id: 1 });
        assert.equal(fresh.process.allocations.has(pointer), false);
        assert.equal(f.tables.pointer(h), pointer);
      } finally {
        await fresh.engine.close();
        await f.engine.close();
      }
    },
  );
}

test(
  'SDK World name-table registration, live VM bytes and restored aliases use the original parser',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      files = Object.fromEntries(nameTableFiles()),
      profile = 'sdk-4.01-engine-2.6.1.74',
      make = () => {
        const game = memoryGame({
            ...files,
            'engine.exe': bytes,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        game.resolveCategory = (name, category) =>
          game.has(name) ? name : `@cat/${category}/${name}`;
        game.readCategory = (name, category) => game.read(game.resolveCategory(name, category));
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
      const m = world.main.machine;
      m.writeString('names.tsv', 256);
      const h = (await world.runtime.native('main', 0x279, [256], m, world.main)).value,
        feature = await world.getNativeFeature('name-tables'),
        pointer = feature.pointer(h);
      assert.ok(h);
      m.writeString('猫', 512);
      assert.equal((await world.runtime.native('main', 0x27b, [h, 512], m, world.main)).value, 0);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const fm = fresh.main.machine;
      fm.bytes(1024, 32).fill(0xa5);
      assert.equal(
        (await fresh.runtime.native('main', 0x27d, [h, 0, 1024], fm, fresh.main)).value,
        1,
      );
      assert.equal(fm.string(1024), '猫');
      assert.equal(fm.load(1027, 1), 0xa5);
      await fresh.runtime.native('main', 0x27a, [h], fm, fresh.main);
      assert.equal(
        (await fresh.getNativeFeature('name-tables')).process.allocations.has(pointer),
        false,
      );
      assert.equal(feature.pointer(h), pointer);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
