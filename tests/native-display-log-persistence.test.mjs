// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NATIVE_EXE_PROFILES } from '../oracle/executable-catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../oracle/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../oracle/global-strings-bridge.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { installFESProjectionOracle } from '../oracle/fes-projection-world.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { scene } from './fixtures/fes-log-model.mjs';

test('23 native load rebuilds displayed backlog only through the saved scene position', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23', {
    'history.cst': scene([
      [
        [33, '名前'],
        [32, '本文'],
        [48, 'voice line.ogg'],
      ],
      [[32, '先の台詞']],
    ]),
    'line.ogg': Uint8Array.of(1),
  });
  t.after(() => world.close());
  world.game.resolveCategory = (name, category) =>
    category === 'scene' && !name.endsWith('.cst') ? name + '.cst' : name;
  const { main, runtime } = world,
    { machine } = main,
    call = (id, args = []) => runtime.native('main', id, args, machine, main),
    log = (await call(696)).value,
    cursor = (await call(323)).value,
    model = runtime.handles.get(log, 'display-log');
  machine.writeString('history.cst', 48);
  machine.writeString('voice', 80);
  machine.writeString('paragraph', 96);
  assert.deepEqual(await call(329, [cursor, 48, 1]), { control: 1, value: 1 });
  assert.deepEqual(await call(699, [log, cursor, 80, 96]), { control: 2 });
  assert.equal(model.blocks.length, 1);
  assert.equal(model.blocks[0][0] & 7, 7);
  const rows = model.rows.map(({ first }) => new TextDecoder('shift_jis').decode(first));
  assert.ok(rows.join('').includes('本文'));
  assert.ok(!rows.join('').includes('先の台詞'));
  assert.deepEqual(await call(699, [log, 0, 80, 96]), { control: 2 });
  assert.equal(model.blocks.length, 1);
});

test('23 CSS log wrappers preserve the four native sections and independent ownership', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23');
  t.after(() => world.close());
  const { main, runtime } = world,
    call = (id, args = []) => runtime.native('main', id, args, main.machine, main),
    source = (await call(696)).value,
    target = (await call(696)).value,
    file = (await call(238, [3])).value,
    entry = 250,
    model = runtime.handles.get(source, 'display-log');
  model.blockBase = 11;
  model.rowBase = 12;
  const reply = (value) => ({ control: 1, value });
  assert.deepEqual(await call(850, [file, entry, 0]), reply(0));
  assert.deepEqual(await call(850, [file, entry, source]), reply(1));
  const bytes = runtime.handles.get(file, 'global-file').read(entry),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => view.getUint32(4 * i, true)),
    [24, 28, 32, 36, 11, 12],
  );
  assert.deepEqual(await call(851, [file, entry + 1, target]), reply(0));
  assert.deepEqual(await call(851, [file, entry, target]), reply(1));
  model.blockBase = 30;
  const copy = runtime.handles.get(target, 'display-log');
  assert.deepEqual([copy.blockBase, copy.rowBase], [11, 12]);
});

for (const [profile, fixture] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    `${profile} saves the original display log to a CSS entry and reloads it in a fresh World`,
    { skip: !process.env[fixture] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[fixture])),
        game = memoryGame({ 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) }),
        files = new Map(),
        storage = {
          read: async (name) => files.get(name) ?? null,
          write: async (name, bytes) => (files.set(name, bytes.slice()), true),
        };
      const make = async () => {
        const random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        const world = installFESProjectionOracle(
          new NativeWorld({
            game,
            images: {},
            host: {},
            profile,
            configuration,
            random,
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage,
          }),
        );
        const engine = await NativeEngineProcess.open({ bytes, profile, configuration });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return world;
      };
      const original = await make(),
        invoke = (world, id, args = []) =>
          world.runtime.native('main', id, args, world.main.machine, world.main),
        ok = { control: 1, value: 1 },
        miss = { control: 1, value: 0 },
        tag = 0x30;
      let fresh;
      try {
        await original.initialize('main.kcs');
        const m = original.main.machine,
          fileHandle = (await invoke(original, 0xee, [0x1234])).value,
          file = original.runtime.handles.get(fileHandle, 'global-file'),
          handle = (await invoke(original, 0x2b8)).value,
          logs = await original.getNativeFeature('display-logs');
        for (const [i, message] of [
          'Authored first line.',
          '長いテキストと日本語の台詞',
        ].entries()) {
          m.writeString('authored-scene', 64);
          m.writeString('名前', 128);
          m.writeString(message, 256);
          await invoke(original, 0x3d1, [handle, 64, i, 128, 256, i, 1, i + 5]);
        }
        const lines = await logs.lines(handle);
        const projection = await original.getNativeFeature('display-log-projection');
        assert.ok(lines.length >= 2);
        assert.deepEqual(await invoke(original, 0x352, [0, tag, handle]), miss);
        assert.deepEqual(await invoke(original, 0x352, [fileHandle, tag, 0]), miss);
        assert.deepEqual(await invoke(original, 0x352, [fileHandle, tag, handle]), ok);
        const engine = original.nativeEngine,
          p = engine.process,
          table = NATIVE_EXE_PROFILES[profile].tables.main.va,
          argv = p.allocate(12, true),
          out = p.allocate(4, true),
          guest = (id, args) => {
            args.forEach((n, i) => p.store(argv + i * 4, n));
            p.store(out, 0xcccccccc);
            return engine.call(p.load(table + id * 4), [0, 0, argv, out]);
          };
        let nativeFile = 0;
        try {
          assert.equal(await guest(0xee, [0x1234]), 1);
          nativeFile = p.load(out);
          assert.ok(nativeFile);
          assert.equal(await guest(0x352, [nativeFile, tag, await projection.prepare(handle)]), 1);
          assert.equal(p.load(out), 1);
          const structure = p.load(nativeFile);
          assert.deepEqual(p.read(p.load(structure), p.load(structure + 8)), file.payload());
          const target = (await invoke(original, 0x2b8)).value;
          try {
            assert.equal(
              await guest(0x353, [nativeFile, tag + 1, await projection.prepare(target)]),
              1,
            );
            assert.equal(p.load(out), 0);
            assert.equal(
              await guest(0x353, [nativeFile, tag, await projection.prepare(target)]),
              1,
            );
            assert.equal(p.load(out), 1);
            assert.deepEqual(
              await logs.lines(target),
              [],
              'consumer loads cannot mutate JS authority',
            );
            await invoke(original, 0x353, [fileHandle, tag, target]);
            assert.deepEqual(await logs.lines(target), lines);
          } finally {
            await invoke(original, 0x2b9, [target]);
          }
        } finally {
          if (nativeFile) await guest(0xf6, [nativeFile]);
          p.free(argv);
          p.free(out);
        }
        m.writeString('slot01.dat', 512);
        assert.deepEqual(await invoke(original, 0xf5, [fileHandle, 512]), ok);
        assert.deepEqual(files.get('slot01.dat'), await file.file());
        await invoke(original, 0x2b9, [handle]);
        fresh = await make();
        await fresh.restore(structuredClone(original.snapshot()));
        const reopened = (await invoke(fresh, 0xf7, [512])).value,
          mounted = fresh.runtime.handles.get(reopened, 'global-file'),
          target = (await invoke(fresh, 0x2b8)).value,
          loaded = await fresh.getNativeFeature('display-logs');
        assert.deepEqual(mounted.payload(), file.payload());
        assert.deepEqual(await invoke(fresh, 0x353, [reopened, tag + 1, target]), miss);
        assert.deepEqual(await invoke(fresh, 0x353, [reopened, tag, 0]), miss);
        assert.deepEqual(await invoke(fresh, 0x353, [reopened, tag, target]), ok);
        assert.deepEqual(await loaded.lines(target), lines);
        mounted.write(tag + 2, Uint8Array.of(24));
        await assert.rejects(invoke(fresh, 0x353, [reopened, tag + 2, target]), /display.log/i);
        assert.deepEqual(await loaded.lines(target), lines);
      } finally {
        await fresh?.close({ flushFiles: false });
        await original.close({ flushFiles: false });
      }
    },
  );

test('2.6.1.67 log GCALLs store six-word CP932 blocks and rebuild through the saved Scene cursor', async (t) => {
  const log = [0x13, 80],
    target = [0x13, 84],
    cursor = [0x13, 88],
    file = [0x13, 92],
    command = (calls) =>
      kcsProgram(
        [
          [37, 0xa0182de0],
          ...calls.flatMap(([id, args, result]) => [
            ...args.map((arg) => [37, arg]),
            [43, id, args.length * 4],
            ...(result === undefined ? [] : [[38, result]]),
          ]),
          [59],
        ],
        [
          [320, 'story.cst'],
          [352, '声'],
          [384, '一'],
          [416, '二'],
          [448, '三'],
          [480, 'voice'],
          [512, 'paragraph'],
        ],
      ),
    world = await dataWorld('bokutomo-engine-2.6.1.67', {
      'story.cst': scene([
        [
          [33, '役＠声'],
          [32, '原版本文'],
          [48, 'voice line.ogg'],
        ],
        [[32, '先の台詞']],
      ]),
      'line.ogg': Uint8Array.of(1),
      'log-create.kcs': command([
        [696, [], 80],
        [696, [], 84],
        [323, [], 88],
        [238, [88], 92],
      ]),
      'log-store.kcs': command([
        [785, [log, 2]],
        [698, [log, 320, 1, 352, 384, 0, 0]],
        [698, [log, 320, 2, 352, 416, 1, 0]],
        [698, [log, 320, 2, 352, 448, 0, 0]],
        [698, [log, 320, 3, 352, 448, 0, 0]],
        [700, [log, 128, 1]],
        [700, [log, 160, -1]],
        [850, [file, 250, log], 96],
        [850, [file, 251, 0], 100],
        [876, [log]],
      ]),
      'log-restore.kcs': command([
        [851, [file, 251, target], 96],
        [851, [file, 250, target], 100],
        [700, [target, 128, 1]],
        [697, [log]],
      ]),
      'log-rebuild.kcs': command([
        [329, [cursor, 320, 1], 96],
        [699, [target, cursor, 480, 512]],
        [697, [0]],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const { runtime } = world,
    { fields } = world.configuration;
  Object.assign(fields.log, {
    nameFirst: '',
    nameLast: '',
    dispName: true,
    nameline: true,
    nameindent: 0,
    col: 40,
  });
  world.game.resolveCategory = (name, category) =>
    category === 'scene' && !name.endsWith('.cst') ? name + '.cst' : name;
  const run = async (name, handles = []) => {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      { machine } = task,
      floor = machine.sp;
    handles.forEach((word, i) => machine.store(80 + i * 4, word));
    machine.store(160, 0xaabbccdd);
    await runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0xa0182de0);
    return machine;
  };
  const created = await run('log-create.kcs'),
    handles = [80, 84, 88, 92].map((at) => created.load(at)),
    model = runtime.handles.get(handles[0], 'display-log');
  assert.equal(model.limit, 100);
  const stored = await run('log-store.kcs', handles);
  assert.equal(stored.string(128), '声');
  assert.equal(stored.load(160), 0xaabbcc00);
  assert.deepEqual([stored.load(96), stored.load(100)], [1, 0]);
  assert.deepEqual(
    [model.blocks.length, model.rows.length, model.blockBase, model.rowBase],
    [0, 0, 1, 2],
  );

  const bytes = runtime.handles.get(handles[3], 'global-file').read(250),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    word = (at) => view.getUint32(at, true);
  assert.deepEqual(
    [word(0), word(4), word(8), word(12), word(16), word(20)],
    [24, 38, 90, 122, 1, 2],
  );
  assert.deepEqual(
    Array.from({ length: 13 }, (_, i) => word(38 + i * 4)),
    [2, 7, 0, 2, 2, 3, 0, 3, 0, 3, 4, 5, 0],
  );
  assert.equal(word(90), 4);
  assert.equal(word(122), 1);

  const loaded = await run('log-restore.kcs', handles),
    copy = runtime.handles.get(handles[1], 'display-log');
  assert.deepEqual([loaded.load(96), loaded.load(100), loaded.string(128)], [0, 1, '声']);
  assert.equal(runtime.handles.records.has(handles[0]), false);
  assert.deepEqual(
    copy.blocks.map((block) => block[6]),
    [0xffffffff, 0xffffffff],
  );
  const rebuilt = await run('log-rebuild.kcs', handles);
  assert.equal(rebuilt.load(96), 1);
  assert.equal(copy.blocks[0][0] & 7, 7);
  assert.deepEqual(
    copy.rows.map((row) => new TextDecoder('shift_jis').decode(row.first)),
    ['声', '原版本文'],
  );
});
