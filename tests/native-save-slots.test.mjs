// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NATIVE_FES_SAVE_COMMANDS } from '../src/native/save-slots.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { saveSlotFixture, SaveSlotFiles } from './fixtures/save-slots-fixture.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    `${profile} original FES save scan with an empty context uses the virtual drive root`,
    { skip: !process.env[variable] },
    async () => {
      const fixture = await saveSlotFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
          { directory: '' },
        ),
        { slots, instance, engine, files, globals, handles } = fixture;
      try {
        engine.kernel.cwd = 'working/subdirectory';
        await slots.command(instance, 'newsave', 'newsave 850 0 2');
        assert.equal(globals.get(850), 0xffffffff);
        const file = new NativeGlobalFile(1729);
        file.write(0, Uint8Array.of(13, 10, 0));
        const handle = handles.add('global-file', file);
        await slots.command(instance, 'datasave', `datasave 1 ${handle}`);
        assert.deepEqual([...files.files.keys()], ['save0001.dat']);
        const saved = await NativeGlobalFile.fromFile(await files.read('save0001.dat'));
        assert.equal(saved.tag, 1729);
        await slots.command(instance, 'newsave', 'newsave 850 0 2');
        assert.equal(globals.get(850), 1);
        assert.equal(engine.kernel.path('local.dat'), 'working/subdirectory/local.dat');
      } finally {
        await engine.close();
      }
    },
  );
  test(
    `${profile} original FES save commands share CSS data, slot dates and file lifecycle`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const fixture = await saveSlotFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { slots, instance, handles, files, globals, strings } = fixture,
        command = async (source) => {
          const result = await slots.command(instance, source.split(' ')[0], source);
          assert.equal(result, 0);
        },
        save = async (slot, tag, data) => {
          const file = new NativeGlobalFile(tag);
          file.write(10, Uint8Array.of(...data, 0));
          const handle = handles.add('global-file', file);
          await command(`datasave ${slot} ${handle}`);
          assert.deepEqual(file.read(10), Uint8Array.of(...data, 0));
          handles.release(handle, 'global-file');
          return file;
        },
        load = async (slot) =>
          NativeGlobalFile.fromFile(
            await files.read(`authored/save${String(slot).padStart(4, '0')}.dat`),
          );
      try {
        assert.equal(NATIVE_FES_SAVE_COMMANDS.length, 11);
        await command('datasave 0');
        await command('datasave 0 0');
        assert.equal(files.files.size, 0);
        await save(1, 2024, [65, 66]);
        assert.equal((await load(1)).tag, 2024);
        await command('saveexist 1 5');
        assert.equal(globals.get(5), 1);
        await command('saveexist 1 5 2024');
        assert.equal(globals.get(5), 1);
        await command('saveexist 1 5 2025 2030');
        assert.equal(globals.get(5), 0xffffffff);
        await command('saveexist 9 5');
        assert.equal(globals.get(5), 0);
        await command('saveget_str 1 10 8');
        assert.equal(strings.get(8), 'AB');
        await command('saveget_str 99 10 8');
        await command('saveget_str 1 999 8');
        assert.equal(strings.get(8), 'AB', 'missing file/entry preserves string');
        const before = await files.stat('authored/save0001.dat');
        files.time += 123456;
        await command('saveapend_str 1 10 (日本語 name)');
        assert.deepEqual(
          await files.stat('authored/save0001.dat'),
          before,
          'string annotation preserves file date',
        );
        const appended = (await load(1)).read(10),
          expected = encodeCP932('(日本語 name)');
        assert.equal(appended.length, expected.length + 4);
        assert.deepEqual(appended.slice(0, expected.length + 1), Uint8Array.of(...expected, 0));
        await command('saveget_str 1 10 8');
        assert.deepEqual(strings.getBytes(8), expected);
        await command('saveget_date 1 11 12 13 14 15 16');
        assert.deepEqual(
          [11, 12, 13, 14, 15, 16].map((id) => globals.get(id)),
          [2024, 4, 12, 15, 24, 36],
        );
        await command('saveget_date 99 11 12 13 14 15 16');
        assert.equal(globals.get(11), 2024, 'missing date preserves destinations');
        await save(3, 300, [67]);
        files.time += 1000;
        await save(4, 400, [68]);
        await command('newsave 20 1 4');
        assert.equal(globals.get(20), 4, 'range end is inclusive');
        await command('newsave 20 5 4');
        assert.equal(globals.get(20), 0xffffffff);
        await files.setTimes('authored/save0003.dat', { modifiedMs: files.time });
        await command('newsave 20 1 4');
        assert.equal(globals.get(20), 3, 'equal latest dates retain first scanned slot');
        globals.set(30, 0x12345678);
        await command('sortsave 30 3 3');
        assert.equal(globals.get(30), 0x12345678, 'single-element range does not write');
        await files.setTimes('authored/save0003.dat', { modifiedMs: files.time - 500 });
        await command('sortsave 30 1 4');
        assert.deepEqual(
          [30, 31, 32, 33].map((id) => globals.get(id)),
          [4, 3, 1, 2],
        );
        await command('sortsave2 40 4 1 3');
        assert.deepEqual(
          [40, 41, 42].map((id) => globals.get(id)),
          [4, 3, 1],
        );
        await command('savecopy 4 5');
        assert.equal((await load(5)).tag, 400);
        await command('savecopy 4 8');
        await files.setAttributes('authored/save0008.dat', 1);
        await command('savedelete 8');
        assert.equal(
          await files.read('authored/save0008.dat'),
          null,
          'original deletion clears READONLY first',
        );
        await command('saveexchg 1 5');
        assert.equal((await load(1)).tag, 400);
        assert.equal((await load(5)).tag, 2024);
        await command('saveexchg 5 6');
        assert.equal(await files.read('authored/save0005.dat'), null);
        assert.equal((await load(6)).tag, 2024);
        await command('savedelete 6');
        await command('savedelete 6');
        assert.equal(await files.read('authored/save0006.dat'), null);
        await assert.rejects(() => slots.command(instance, 'dataload', 'dataload 1'), /Unknown/);
        const handle = handles.add('unrelated', {});
        await assert.rejects(() => command(`datasave 2 ${handle}`), /expected global-file/);
      } finally {
        await fixture.engine.close();
      }
    },
  );
  test(
    `${profile} KCS save-object binding writes native CSS and a fresh system client restores its banks`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable])),
        files = new SaveSlotFiles(),
        make = async () => {
          const game = memoryGame({
              'main.kcs': kcsProgram([
                [37, 128],
                [43, 0xd1, 4],
                [60],
                [37, 2048],
                [43, 0x47, 4],
                [59],
              ]),
              'save.fes': encodeCP932(
                '#START\nnext WAIT\n#WAIT\n#SAVE\ndatasave 7 _SAVEOBJ_\nsaveexist 7 11 0xabc\nnext WAIT\n',
              ),
            }),
            random = new ParticleRandom(),
            configuration = new NativeConfiguration({ profile }),
            world = new NativeWorld({
              game,
              profile,
              configuration,
              random,
              images: {},
              host: {},
              storage: files,
              motionLibrary: new MotionLibrary(game, { profile, random }),
            });
          const engine = await NativeEngineProcess.open({
            bytes: exe,
            profile,
            configuration,
            ...files.options(),
          });
          new NativeGlobalStringsBridge(engine, world.globalStrings);
          world.nativeEngine = engine;
          world.nativeEngineLoading = Promise.resolve(engine);
          await world.initialize('main.kcs');
          world.main.context.contextName = 'authored';
          world.main.context.contextNameBytes = encodeCP932('authored');
          return world;
        },
        invoke = (world, id, args) =>
          world.runtime.native(
            'main',
            id,
            args,
            world.main.machine,
            world.main,
            world.runtime.scheduler,
          ),
        first = await make();
      let fresh;
      try {
        const bank = first.runtime.variableBank(first.main, false),
          strings = first.runtime.stringBank(first.main);
        bank.set(7, 0x12345678);
        strings.setBytes(17, encodeCP932('保存した値'));
        const handle = (await invoke(first, 0xee, [0xabc])).value;
        assert.equal(
          (await invoke(first, 0xf0, [handle, 0x20, first.nativeTaskID(first.main.id), 0, 128]))
            .value,
          1,
        );
        assert.equal((await invoke(first, 0xf3, [handle, 0x30])).value, 1);
        const id = await first.objects.create({ kind: 34, parent: first.main.id }),
          task = first.objects.objects.get(id).implementation;
        await task.load('save', first.main);
        await invoke(first, 0x1c3, [first.nativeTaskID(id), handle]);
        assert.equal(task.player.saveObject, handle);
        assert.equal(first.objects.objects.get(id).context.contextName, 'authored');
        task.player.root.invoke('SAVE');
        for (let i = 0; i < 3; i++) await task.tick();
        assert.equal(bank.get(11), 1);
        const bytes = await files.read('authored/save0007.dat');
        assert.ok(bytes);
        assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x535343);
        assert.equal((await NativeGlobalFile.fromFile(bytes)).tag, 0xabc);
        bank.set(7, 0);
        strings.set(17, 'changed');
        fresh = await make();
        fresh.main.machine.writeString('save0007.dat', 4096);
        const loaded = (await invoke(fresh, 0xf7, [4096])).value;
        assert.notEqual(loaded, 0, 'system KCS opens its context-relative CSS file');
        assert.equal(
          (await invoke(fresh, 0xfa, [loaded, 0x20, fresh.nativeTaskID(fresh.main.id), 0])).value,
          1,
        );
        assert.equal((await invoke(fresh, 0xfd, [loaded, 0x30])).value, 1);
        assert.equal(fresh.runtime.variableBank(fresh.main, false).get(7), 0x12345678);
        assert.equal(fresh.runtime.stringBank(fresh.main).get(17), '保存した値');
        assert.equal(fresh.objects.objects.get(fresh.main.id).scriptStringDirty, 1);
        assert.equal(bank.get(7), 0, 'fresh system restore never changes the first runtime');
        await invoke(fresh, 0xf6, [loaded]);
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
}
