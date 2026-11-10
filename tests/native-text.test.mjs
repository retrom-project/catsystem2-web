// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeTextWindows } from '../src/native/text-windows.mjs';
import { NativeFESTextLayout } from '../src/native/fes-text-layout.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeEngineMessages } from '../src/native/engine-message.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { installNativeBitmapMemory } from '../src/native/bitmap-memory.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacementsBridge } from '../src/native/script-replacements-bridge.mjs';
import { NativeSceneData } from '../src/native/scene-data.mjs';
import { NativeGraphics, installNativeGraphics } from '../src/native/graphics.mjs';
import { NativeGraphicsPlatform } from '../src/native/graphics-process.mjs';
import { NativeTextWriter } from '../src/native/text.mjs';
import { installNativeText, nativeText } from '../src/native/text-task.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { ImageStore } from '../src/formats/hg3.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { memoryGame, u32, translation, kcsProgram } from './helpers.mjs';

const glyphs = {
  measure: (_font, text) => ({
    width: text.length * 4,
    height: 8,
    ascent: 6,
    descent: 2,
    averageWidth: 4,
    maximumWidth: 8,
  }),
  glyph: () => ({
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 4,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};
function authoredLogScene() {
  const lines = [
      [0x21, 'AuthoredSpeaker'],
      [0x20, 'History message.'],
      [2, ''],
    ],
    offsets = [],
    strings = [];
  for (const [kind, source] of lines) {
    offsets.push(strings.length);
    strings.push(1, kind, ...encodeCP932(source), 0);
  }
  const body = Uint8Array.from([
    ...[
      8 + offsets.length * 4 + strings.length,
      1,
      8,
      8 + offsets.length * 4,
      lines.length,
      0,
      ...offsets,
    ].flatMap(u32),
    ...strings,
  ]);
  return Uint8Array.from([
    ...new TextEncoder().encode('CatScene'),
    ...u32(0),
    ...u32(body.length),
    ...body,
  ]);
}
test('bitmap uploads and text frames preserve the 54 cross-profile original row and clipping goldens', async () => {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-bitmap-upload-golden.json', import.meta.url),
        'utf8',
      ),
    ),
    p = new PE32Process(await loadUnicorn()),
    profile = 'sdk-4.01-engine-2.6.1.74',
    engine = { process: p, profile, refs: {}, patch() {}, registerFeature() {} },
    world = {
      profile,
      game: { width: 64, height: 64 },
      runtime: { handles: new NativeHandles() },
      configuration: {
        fields: {
          texture: {
            size: Uint32Array.of(64, 64),
            grid: Uint32Array.of(1, 1),
            bppY: Uint32Array.of(0, 1),
            bpp: 32,
            areas: Array.from({ length: 8 }, (_, i) =>
              Uint32Array.from(i ? [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff] : [0, 0, 1, 1]),
            ),
          },
        },
      },
    },
    bitmap = p.allocate(92, true),
    data = p.allocate(golden.bgra.length, true),
    writer = p.allocate(16, true);
  world.graphics = new NativeGraphics(world);
  const platform = new NativeGraphicsPlatform(engine, world);
  try {
    p.write(data, Uint8Array.from(golden.bgra));
    for (const [offset, value] of [
      [4, golden.size[0]],
      [8, golden.size[1]],
      [12, data],
      [20, golden.size[0] * 4],
      [24, 4],
    ])
      p.store(bitmap + offset, value);
    p.store(writer + 4, bitmap);
    const frame = new NativeTextWriter(
      { process: p, bindings: () => ({ bitmapAt: 4 }) },
      { pointer: writer, mode: 'cp932' },
    ).frame();
    assert.deepEqual([...frame.rgba], golden.rgba);
    for (const row of golden.cases) {
      p.store(bitmap + 36, row.offset[0]);
      p.store(bitmap + 40, row.offset[1]);
      await world.graphics.fill(0, 0, 64, 64, 0);
      assert.equal(
        await platform.copyBitmap(bitmap, ...row.source, ...row.destination),
        row.result,
      );
      const pixels = await world.graphics.images.get(world.graphics.vramHandle).pixels();
      assert.equal(
        createHash('sha256').update(pixels).digest('hex'),
        row.sha256,
        JSON.stringify(row),
      );
    }
    assert.equal(golden.cases.length, 54);
  } finally {
    platform.close();
    p.close();
  }
});
test('FES layout matches all 492 original authored records, including profile and dirty-flag distinctions', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('./fixtures/native-fes-text-layout-golden.json', import.meta.url),
      'utf8',
    ),
  );
  let count = 0;
  for (const { profile, type, cases } of fixture.profiles)
    for (const row of cases) {
      const layout = new NativeFESTextLayout({ profile, type }),
        expected = new Uint32Array(512);
      layout.apply(row.mode, row.args, Number, {
        font: 'Authored',
        weight: 400,
        frame: profile.startsWith('sdk-') ? 0 : 9,
      });
      for (const [index, value] of row.words) expected[index] = value;
      assert.deepEqual(
        [...new Uint32Array(layout.bytes.buffer)].slice(0, 450),
        [...expected].slice(0, 450),
        `${profile}/${type}/${row.mode}/${row.args}`,
      );
      assert.deepEqual(new NativeFESTextLayout(layout.snapshot()).snapshot(), layout.snapshot());
      count++;
    }
  assert.equal(count, 492);
});

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original text wrappers keep equal task numbers in separate Top namespaces`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const world = await fixture(
        profile,
        new Uint8Array(await readFile(process.env[variable])),
        '',
      );
      try {
        const protocol = new NativeEngineMessages(world);
        world.runtime.scheduler = { tasks: new Map() };
        world.base = (record) => protocol.base(record);
        world.objects.identity = ({ parent }) =>
          parent === null ? { nativeID: 0 } : protocol.creation(parent);
        world.nativeTaskID = (id) => world.objects.objects.get(id).nativeID;
        world.resolveTaskID = (id, sender) => protocol.resolve(sender, id);
        world.sendNativeEngine = async (id, sender, message, w, l, context = {}) =>
          (await protocol.dispatchNative(sender, id, message, w, l, context)).result;
        world.sendEngine = async (id, sender, message, w, l, context = {}) =>
          (await protocol.dispatch(id, sender, message, w, l, context)).result;
        world.objects.register(1, (record) => world.base(record));
        const topA = await world.objects.create({ kind: 1, name: 'Top A' }),
          a = await world.objects.create({ kind: 8, parent: topA, name: 'Text A' }),
          topB = await world.objects.create({ kind: 1, name: 'Top B' }),
          b = await world.objects.create({ kind: 8, parent: topB, name: 'Text B' }),
          runtime = await world.getNativeFeature('legacy-text');
        assert.notEqual(a, b);
        assert.equal(world.nativeTaskID(a), world.nativeTaskID(b));
        const font = await world.graphics.images.load('glyphs', 1);
        try {
          for (const [id, top, x] of [
            [a, topA, 0],
            [b, topB, 32],
          ]) {
            const machine = {
                memory: new Uint8Array(512),
                shared: new Uint8Array(),
                blocks: [],
                fp: 0,
              },
              view = new DataView(machine.memory.buffer),
              nativeID = world.nativeTaskID(id);
            for (const [offset, value] of [
              [0, x],
              [8, 32],
              [12, 64],
              [16, 4],
              [20, 1],
              [24, 16],
              [60, 128],
              [64, 0xffffff],
              [68, 1],
              [72, 1],
            ])
              view.setUint32(offset, value, true);
            machine.memory.set(encodeCP932('A\0'), 128);
            const task = { id: top };
            assert.equal((await runtime.apply(0x7b, [nativeID, 0, 256], machine, task)).control, 2);
            await runtime.apply(0x88, [nativeID, font], machine, task);
            await runtime.apply(0x89, [nativeID, 65, 0, 0, 2, 2], machine, task);
            await runtime.apply(0x7c, [nativeID, 128], machine, task);
            await runtime.apply(0x1c8, [nativeID, 0x12340000 | id], machine, task);
            assert.equal(
              world.engine.process.load(world.graphics.get(id).pointer + 1876),
              (0x12340000 | id) >>> 0,
            );
            assert.equal(
              (await runtime.apply(0x187, [nativeID], machine, task)).value,
              world.engine.process.load(world.graphics.get(id).pointer + 692),
            );
            await runtime.apply(0x85, [nativeID, 0xffffffff], machine, task);
            assert.ok(world.graphics.get(id).characters().length);
            assert.equal(world.engine.process.load(world.graphics.get(id).pointer + 4), nativeID);
          }
        } finally {
          world.graphics.images.release(font);
        }
        for (let frame = 1; frame <= 90; frame++) {
          await world.objects.tick(frame);
          await world.objects.drawTick(frame);
        }
        const machine = { memory: new Uint8Array(16), shared: new Uint8Array(), blocks: [], fp: 0 },
          p = world.engine.process,
          color = (id) => p.load(world.graphics.get(id).pointer + 1880),
          id = world.nativeTaskID(a);
        assert.equal(color(a), 0xff000000);
        assert.equal(color(b), 0xff000000);
        assert.deepEqual(await runtime.apply(0x22d, [id, 0xfedcba98], machine, { id: topA }), {
          control: 2,
        });
        await runtime.apply(0x22d, [id, 0x123456], machine, { id: topB });
        assert.equal(color(a), 0xfedcba98);
        assert.equal(color(b), 0x123456);
        for (const [id, top] of [
          [a, topA],
          [b, topB],
        ])
          assert.equal(
            (await runtime.apply(0x81, [world.nativeTaskID(id)], machine, { id: top })).value,
            1,
          );
        await world.sendNativeEngine(world.nativeTaskID(a), topA, 47, 0, 0);
        assert.equal(world.graphics.get(a).state.shown, false);
        assert.equal(world.graphics.get(b).state.shown, true);
        assert.ok(
          (await world.graphics.images.get(world.graphics.vramHandle).pixels()).some(
            (value, i) => i % 4 === 3 && value,
          ),
        );
        const data = new Uint8Array(256),
          layout = new DataView(data.buffer);
        for (const [offset, value] of [
          [8, 32],
          [12, 64],
          [16, 4],
          [20, 1],
          [24, 16],
          [60, 128],
          [64, 0xffffff],
          [68, 1],
          [72, 1],
          [88, 1],
        ])
          layout.setUint32(offset, value, true);
        data.set(encodeCP932('、ｱ\0'), 128);
        data.set(encodeCP932('A（\0'), 160);
        data.set(encodeCP932('BA、\0'), 192);
        const configVM = { ...machine, memory: data },
          legacy = (cmd, top, args) => runtime.apply(cmd, [id, ...args], configVM, { id: top });
        assert.deepEqual(await legacy(0x1a2, topA, [0, 128, 160]), { control: 2 });
        await legacy(0x7b, topB, [0, 128]);
        const configured = world.graphics.get(a).pointer + 708,
          lists = new DataView(p.read(configured, 1116).buffer);
        assert.deepEqual(p.read(configured, 96), data.slice(0, 96));
        assert.equal(lists.getUint32(96, true), 2);
        assert.deepEqual(
          [100, 102, 104].map((offset) => lists.getUint16(offset, true)),
          [0x8141, 0xffb1, 0],
        );
        assert.equal(lists.getUint32(612, true), 2);
        assert.deepEqual(
          [616, 618, 620].map((offset) => lists.getUint16(offset, true)),
          [0x41, 0x8169, 0],
        );
        assert.equal(p.load(world.graphics.get(b).pointer + 1320), 0);
        await legacy(0x7c, topA, [192]);
        await legacy(0x7c, topB, [192]);
        const rows = (id) => {
          const bytes = world.graphics.get(id).characters(),
            records = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          return Array.from({ length: bytes.length / 40 }, (_, i) => [
            records.getUint16(i * 40, true),
            records.getInt32(i * 40 + 12, true),
          ]);
        };
        assert.deepEqual(rows(a), [
          [0x42, 0],
          [0, 0],
          [0x41, 0],
          [0x8141, 16],
        ]);
        assert.deepEqual(rows(b), [
          [0x42, 0],
          [0x41, 0],
          [0, 0],
          [0x8141, 16],
        ]);
      } finally {
        await world.close();
      }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original display cache, history rebuild and LOGSTRING child tasks`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable]));
      for (const type of profile.startsWith('sdk-') ? ['LOGSTRING'] : ['LOGSTRING', 'LOGSTRING8']) {
        const source = `#DEFINE\n${type} history\n#OBJECT COUNT POS2 SIZE2 PRI VRAM\nhistory 2 area:7 area:7 60000 0,0\n#START\nnext WAIT\n#WAIT\n`,
          first = await fixture(profile, bytes, source),
          configuration = new NativeConfiguration({ profile });
        Object.assign(configuration.fields.texture, first.configuration.fields.texture);
        first.configuration = configuration;
        first.engine.attachConfiguration(configuration);
        first.engine.process.budget = 20000000;
        const variables = new NativeVariableBank(),
          strings = new NativeStringBank();
        variables.initialize(1024);
        first.runtime.variableBank = () => variables;
        first.runtime.stringBank = () => strings;
        const oldRead = first.game.readCategory;
        first.game.readCategory = async (name, category) =>
          category === 'scene'
            ? name.toLowerCase() === 'authoredscene'
              ? authoredLogScene()
              : name.toLowerCase() === 'authoredscene.cstl'
                ? translation(
                    ['ja', 'en'],
                    [
                      {
                        ja: ['名前', '日本語本文'],
                        en: ['TranslatedSpeaker', 'Localized history.'],
                      },
                    ],
                  )
                : null
            : oldRead
              ? oldRead(name, category)
              : first.game.requireCategory(name, category);
        let second;
        try {
          first.owner = await first.objects.create({ kind: 34 });
          await first.player.start('screen');
          first.player.root.runtimeID = first.owner;
          await first.graphics.syncFES(first.objects.objects.get(first.owner), first.player);
          const log = first.player.root.byKey.get('history'),
            children = first.player.root.objects.filter(
              (o) => o.nativeControlledByLog === log.handle,
            ),
            machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(8192)),
            task = { id: first.owner, context: {} },
            logs = await first.getNativeFeature('display-logs'),
            handle = (await logs.apply(0x2b8, [], machine, task)).value;
          assert.equal(children.length, type === 'LOGSTRING8' ? 4 : 2);
          for (const [at, text] of [
            [64, 'AuthoredScene'],
            [128, 'Speaker'],
            [256, 'Alpha.'],
          ])
            machine.memory.set(encodeCP932(text + '\0'), at);
          await logs.apply(0x2ba, [handle, 64, 0, 128, 256, 0, 1], machine, task);
          machine.memory.set(encodeCP932('Beta.\0'), 256);
          await logs.apply(0x3d1, [handle, 64, 1, 128, 256, 1, 1, 7], machine, task);
          const lines = (await logs.lines(handle)).map((b) =>
            new TextDecoder('shift_jis').decode(b),
          );
          assert(lines.some((line) => line.includes('Alpha.')));
          assert(lines.some((line) => line.includes('Beta.')));
          await first.text.log.command(first.player.root, log, 'setlog', [String(handle)], {
            index: 0,
          });
          await first.text.log.command(first.player.root, log, 'disp', ['1'], { index: 0 });
          await first.graphics.syncFES(first.objects.objects.get(first.owner), first.player);
          await first.text.log.command(first.player.root, log, 'max', ['27'], { index: 0 });
          assert.equal(first.player.root.global(27), lines.length);
          await first.text.log.command(first.player.root, log, 'lineinfo', ['0', '28', '29'], {
            index: 0,
          });
          assert.equal(first.player.strings[28], 'AuthoredScene');
          assert.equal(first.player.root.global(29), 0);
          await first.text.log.command(
            first.player.root,
            log,
            'blockinfo',
            ['0', '30', '31', '32', '33', '34'],
            { index: 0 },
          );
          await first.text.log.command(first.player.root, log, 'pathinfo', ['0', '35', '36'], {
            index: 0,
          });
          assert.deepEqual(
            [30, 31, 32, 33, 34, 35, 36].map((i) => first.player.root.global(i)),
            [0, 0, 1, 0, 0, -1, 0],
          );
          const writers = await Promise.all(
            children.map((o) => first.graphics.get(o.nativeTaskID)?.writer()),
          );
          assert(
            writers.some(
              (writer) => writer && writer.frame().rgba.some((v, i) => i % 4 === 3 && v),
            ),
          );
          const saved = {
            engine: first.engine.snapshot(),
            handles: first.runtime.handles.snapshot(),
            objects: first.objects.snapshot(),
            graphics: first.graphics.snapshot(),
            player: first.player.snapshot(),
          };
          second = await fixture(profile, bytes, source);
          second.configuration = new NativeConfiguration({ profile });
          second.configuration.restore(configuration.snapshot());
          second.engine.attachConfiguration(second.configuration);
          for (const [name] of saved.engine.features) await second.getNativeFeature(name);
          second.engine.restore(saved.engine);
          second.runtime.handles.restore(saved.handles);
          second.graphics.restore(saved.graphics);
          await second.objects.restore(saved.objects);
          await second.player.restore(saved.player);
          second.owner = first.owner;
          second.player.root.runtimeID = second.owner;
          await second.graphics.syncFES(second.objects.objects.get(second.owner), second.player);
          assert.deepEqual(
            await (await second.getNativeFeature('display-logs')).lines(handle),
            await logs.lines(handle),
          );
          assert.equal(
            second.player.root.objects.filter((o) => o.nativeControlledByLog === log.handle).length,
            children.length,
          );
          const scene = new NativeSceneData(),
            sceneHandle = first.runtime.handles.add('scene-data', scene);
          scene.history.appendPath('AuthoredScene', 1);
          await logs.apply(0x2bb, [handle, sceneHandle, 512, 512], machine, task);
          const rebuilt = (await logs.lines(handle)).map((b) =>
            new TextDecoder('shift_jis').decode(b),
          );
          assert(rebuilt.some((line) => line.includes('History message.')));
          await logs.apply(0x2bc, [handle, 1024, 0], machine, task);
          assert.equal(
            new TextDecoder('shift_jis').decode(
              machine.memory.subarray(1024, machine.memory.indexOf(0, 1024)),
            ),
            'AuthoredSpeaker',
          );
          if (!profile.startsWith('sdk-')) {
            const mappings = [],
              stop = first.engine.process.beforeInstruction(
                0x72bd00,
                'observe original display-log CSTL bindings',
                () => {
                  const p = first.engine.process,
                    at = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
                  mappings.push([p.load(at + 312), p.load(at + 320), p.load(p.load(at + 304) + 4)]);
                },
              );
            machine.memory.set(encodeCP932('en\0'), 1536);
            try {
              await logs.apply(0x40a, [handle, sceneHandle, 512, 512, 1536], machine, task);
            } finally {
              stop();
            }
            const localized = (await logs.lines(handle)).map((b) =>
              new TextDecoder('shift_jis').decode(b),
            );
            assert.equal(mappings.length, 0, 'JS rebuild does not call the EXE CST reader');
            assert(mappings.every((row) => row[0] === 0 && row[1] === 0 && row[2] === 2));
            assert.deepEqual(
              localized,
              rebuilt,
              'the original wrapper does not register its requested CSTL language in the temporary reader',
            );
          }
          await logs.apply(0x36c, [handle], machine, task);
          assert.equal((await logs.lines(handle)).length, 0);
          await logs.apply(0x2b9, [handle], machine, task);
          assert.throws(() => logs.get(handle), /Invalid or released/);
        } finally {
          await second?.close();
          await first.close();
        }
      }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original FES text handlers distinguish a whole array from an explicit element`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const source =
          '#DEFINE\nSTRING a[2]\n#OBJECT SIZE POS PRI DISP\na 96,64 0,0 60000 1\n#START\na str AB\na[1] str CDE\na draw\nnext WAIT\n#WAIT\n#QUERY\na[0] linecnt 10\na[1] linecnt 11\n',
        world = await fixture(
          profile,
          new Uint8Array(await readFile(process.env[variable])),
          source,
        );
      try {
        world.owner = await world.objects.create({ kind: 34 });
        await world.player.start('screen');
        world.player.root.runtimeID = world.owner;
        await world.graphics.syncFES(world.objects.objects.get(world.owner), world.player);
        for (let frame = 1; frame <= 30; frame++) await world.tick(frame);
        const tasks = ['a[0]', 'a[1]'].map((name) =>
          world.graphics.get(world.player.root.byKey.get(name).nativeTaskID),
        );
        assert.equal((await tasks[0].writer()).records().length, 2 * 88);
        assert.equal((await tasks[1].writer()).records().length, 3 * 88);
        await world.player.notify('QUERY');
        assert.deepEqual([world.player.globals[10], world.player.globals[11]], [1, 1]);
      } finally {
        await world.close();
      }
    },
  );
for (const [profile, variable, types] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', ['STRING', 'STRING8']],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', ['STRING']],
])
  test(
    `${profile} FES append expands raw bank bytes once before the original text parser`,
    { skip: !process.env[variable] },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable]));
      for (const type of types) {
        const source = `#DEFINE\n${type} str\n#OBJECT SIZE POS PRI DISP\nstr 96,64 0,0 60000 1\n#START\nnext WAIT\n#WAIT\n#APPEND\nstr apend $str7\n`,
          world = await fixture(profile, exe, source),
          bank = new NativeStringBank(),
          expected =
            type === 'STRING8'
              ? new TextEncoder().encode('「A♪」$str8')
              : encodeCP932('日本A$str8');
        bank.setBytes(7, expected);
        bank.set(8, 'SECOND_EXPANSION');
        const configuration = new NativeConfiguration({ profile });
        Object.assign(configuration.fields.texture, world.configuration.fields.texture);
        configuration.scriptReplacements.add(Uint8Array.of(65), Uint8Array.of(65, 65));
        world.configuration = configuration;
        world.engine.attachConfiguration(configuration);
        new NativeScriptReplacementsBridge(world.engine, configuration);
        world.player.host.nativeFESStringBytes = (bytes) => bank.expandBytes(bytes);
        try {
          world.owner = await world.objects.create({ kind: 34 });
          await world.player.start('screen');
          world.player.root.runtimeID = world.owner;
          await world.graphics.syncFES(world.objects.objects.get(world.owner), world.player);
          for (let frame = 1; frame <= 2; frame++) await world.tick(frame);
          const p = world.engine.process,
            observed = [],
            address =
              type === 'STRING8' ? 0x753450 : profile.startsWith('sdk-') ? 0x5eee70 : 0x74ead0,
            stop = p.beforeInstruction(address, 'authored raw FES append input', () => {
              const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
              observed.push(p.stringBytes(p.load(sp + 4)).slice());
            });
          try {
            await world.player.notify('APPEND');
          } finally {
            stop();
          }
          assert.deepEqual(observed, [configuration.scriptReplacements.apply(expected)]);
          for (let frame = 3; frame <= 4; frame++) await world.tick(frame);
          const task = world.graphics.get(world.player.root.byKey.get('str').nativeTaskID),
            writer = await task.writer();
          await writer.parse();
          assert.ok(writer.records().length > 0);
          if (type === 'STRING8') assert.equal(task.text.source, '「AA♪」$str8');
          const identities = (await world.getNativeFeature('fes-objects')).stringIdentities;
          assert.equal(identities.size, 1);
          assert.ok(p.load([...identities.values()][0]));
        } finally {
          await world.close();
        }
      }
    },
  );

test('GDI text boundaries preserve CP932 byte counts and DWORD-padded gray glyph bitmaps', async () => {
  const p = new PE32Process(await loadUnicorn()),
    platform = new NativeTextWindows(p, {
      glyphs: {
        ...glyphs,
        glyph: () => ({
          width: 5,
          height: 2,
          originX: -1,
          originY: 2,
          advanceX: 7,
          advanceY: -2,
          alpha: Uint8Array.of(0, 64, 128, 192, 255, 255, 192, 128, 64, 0),
        }),
      },
    });
  const call = (name, args) =>
    p.call(
      platform.resolve({ dll: name.startsWith('lstr') ? 'KERNEL32.dll' : 'GDI32.dll', name }),
      args,
    );
  try {
    const dc = call('CreateCompatibleDC', [0]),
      metrics = p.allocate(32, true),
      matrix = p.allocate(16, true),
      output = p.allocate(32, true),
      source = p.allocate(16, true);
    [65536, 0, 0, 65536].forEach((v, i) => p.store(matrix + i * 4, v));
    p.write(source, Uint8Array.of(0x93, 0xfa, 0x96, 0x7b, 0));
    assert.equal(call('lstrlenA', [source]), 4);
    assert.equal(call('GetTextExtentPoint32A', [dc, source, 4, metrics]), 1);
    assert.deepEqual([p.load(metrics), p.load(metrics + 4)], [8, 8]);
    assert.equal(call('GetGlyphOutlineW', [dc, 65, 6, metrics, 0, 0, matrix]), 16);
    assert.equal(call('GetGlyphOutlineW', [dc, 65, 6, metrics, 15, output, matrix]), 0xffffffff);
    assert.equal(call('GetGlyphOutlineW', [dc, 65, 6, metrics, 16, output, matrix]), 16);
    assert.deepEqual(
      [...p.read(output, 16)],
      [0, 16, 32, 48, 64, 0, 0, 0, 64, 48, 32, 16, 0, 0, 0, 0],
    );
    assert.deepEqual(
      [0, 4, 8, 12].map((at) => p.load(metrics + at) | 0),
      [5, 2, -1, 2],
    );
    assert.deepEqual([...new Int16Array(p.read(metrics + 16, 4).buffer)], [7, -2]);
    const state = platform.snapshot();
    call('DeleteDC', [dc]);
    platform.restore(state);
    assert.equal(platform.object(dc).kind, 'dc');
  } finally {
    p.close();
  }
});
test('Windows rectangle calls report successful empty writes separately from nonempty intersections', async () => {
  const p = new PE32Process(await loadUnicorn()),
    platform = new NativeTextWindows(p, { glyphs }),
    a = p.allocate(16, true),
    b = p.allocate(16, true),
    out = p.allocate(16, true),
    call = (name, args) => p.call(platform.resolve({ dll: 'USER32.dll', name }), args);
  try {
    assert.equal(call('SetRect', [a, 3, 4, 3, 4]), 1);
    assert.equal(call('IsRectEmpty', [a]), 1);
    assert.equal(call('OffsetRect', [a, 7, -2]), 1);
    assert.deepEqual(
      [0, 4, 8, 12].map((i) => p.load(a + i) | 0),
      [10, 2, 10, 2],
    );
    call('SetRect', [b, 8, 9, 7, 8]);
    assert.equal(call('UnionRect', [out, a, b]), 0);
    assert.deepEqual([...p.read(out, 16)], Array(16).fill(0));
    call('SetRect', [a, 0, 0, 4, 5]);
    assert.equal(call('PtInRect', [a, 0, 0]), 1);
    assert.equal(call('PtInRect', [a, 3, 4]), 1);
    assert.equal(call('PtInRect', [a, 4, 4]), 0);
    assert.equal(call('PtInRect', [a, 3, 5]), 0);
    assert.equal(call('PtInRect', [a, -1, 0]), 0);
    call('SetRect', [b, 2, 1, 8, 7]);
    assert.equal(call('IntersectRect', [out, a, b]), 1);
    assert.deepEqual(
      [0, 4, 8, 12].map((i) => p.load(out + i) | 0),
      [2, 1, 4, 5],
    );
  } finally {
    p.close();
  }
});

async function fixture(profile, bytes, source) {
  const areaPixels = new Uint8Array(128 * 96 * 4);
  for (let y = 13; y < 77; y++)
    for (let x = 11; x < 107; x++) areaPixels[(y * 128 + x) * 4 + 3] = 255;
  const image = await encodeHG2(
      {
        width: 2,
        height: 2,
        rgba: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255),
      },
      { id: 1 },
    ),
    area = await encodeHG2({ width: 128, height: 96, rgba: areaPixels }, { id: 7 }),
    game = memoryGame({
      'screen.fes': new TextEncoder().encode(source),
      'glyphs.hg2': image,
      'area.hg2': area,
    }),
    factories = new Map();
  game.width = 96;
  game.height = 64;
  game.resolveCategory = (name, category) => {
    const path =
      category === 'fes'
        ? name.replace(/\.fes$/, '') + '.fes'
        : name.replace(/\.hg2$/, '') + '.hg2';
    return game.has(path) ? path : null;
  };
  game.requireCategory = async (name, category) =>
    game.require(game.resolveCategory(name, category));
  const images = new ImageStore(game),
    world = {
      profile,
      game,
      images,
      objects: new NativeObjects(),
      runtime: {
        handles: new NativeHandles(),
        register() {},
        services: {
          formatBytes: (address, m) => {
            const bytes = [];
            for (let i = 0; m.load(address + i, 1); i++) bytes.push(m.load(address + i, 1));
            return Uint8Array.from(bytes);
          },
        },
      },
      base: () => ({
        message: ([, id]) => {
          if (id === 3) return 1;
          throw new Error(`Unimplemented engine message ${id}`);
        },
      }),
      registerNativeFeature: (name, factory) => factories.set(name, factory),
      async getNativeFeature(name) {
        return this.engine.features.get(name) || factories.get(name)(this.engine, this);
      },
    };
  world.configuration = {
    fields: {
      texture: {
        size: Uint32Array.of(128, 128),
        grid: Uint32Array.of(1, 1),
        bppY: Uint32Array.of(0, 1),
        bpp: 32,
        areas: Array.from({ length: 8 }, (_, i) =>
          Uint32Array.from(i ? [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff] : [0, 0, 1, 1]),
        ),
      },
    },
  };
  world.sendEngine = (target, sender, message, w, l, context = {}) =>
    world.objects.objects.get(target)?.implementation.message([sender, message, w, l], context);
  world.engine = await NativeEngineProcess.open({ profile, bytes });
  world.nativeEngine = world.engine;
  world.registerNativeFeature(
    'data-buffers',
    (engine) =>
      new NativeDataBuffers(engine, {
        handles: world.runtime.handles,
        read: (name, category) => game.requireCategory(name, category),
      }),
  );
  installNativeBitmapMemory(world);
  installNativeGraphics(world);
  installNativeText(world, { glyphs });
  world.objects.register(34, () => ({
    imageCache: new Map(),
    message: () => 0,
    async imageData(name) {
      if (!this.imageCache.has(name)) {
        const buffers = await world.getNativeFeature('data-buffers');
        this.imageCache.set(name, buffers.createPointer(await game.requireCategory(name, 'image')));
      }
      return this.imageCache.get(name);
    },
    snapshot() {
      return { imageCache: [...this.imageCache] };
    },
    restore(state) {
      this.imageCache = new Map(state.imageCache);
    },
    close() {
      const buffers = world.engine.features.get('data-buffers');
      for (const pointer of this.imageCache.values()) buffers.releasePointer(pointer);
      this.imageCache.clear();
    },
  }));
  world.player = new FESPlayer(game, images);
  world.tick = async (frame) => {
    await world.objects.tick(frame);
    await world.player.step();
    await world.graphics.syncFES(world.objects.objects.get(world.owner), world.player);
  };
  world.close = async () => {
    for (const id of [...world.objects.objects.keys()]) await world.objects.release(id);
    await world.engine.close();
  };
  return world;
}
for (const [profile, variable, types] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', ['STRING', 'STRING8', 'NVSTRING']],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', ['STRING', 'NVSTRING']],
])
  test(
    `${profile} original FES text commands, image fonts, reveal and a fresh process checkpoint`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable]));
      for (const type of types)
        for (const referenced of [false, true]) {
          const source = `#DEFINE\n${type} str\n${referenced ? 'IMAGE' : 'VIEW'} font\n#OBJECT ${referenced ? 'SIZE2' : 'SIZE'} POS PRI DISP\nstr ${referenced ? 'area:7' : '96,64'} 0,0 60000 1\n#OBJECT FILE IDN\nfont glyphs -1\n#START\nstr layout frame 2\nstr layout ${type === 'NVSTRING' ? 'font Authored' : 'fontind 0 Authored Face'}\n${referenced ? 'str userfontobj font\nstr userfont 0x8740 1\n' : ''}${type === 'NVSTRING' ? 'str insert\nstr apend' : 'str str'} A\\nB\nstr draw\nnext WAIT\n#WAIT\n#QUERY\n${type === 'NVSTRING' ? 'str endpos 8 9' : 'str linecnt 7'}\nstr isdraw\n`,
            first = await fixture(profile, bytes, source);
          let second;
          try {
            first.owner = await first.objects.create({ kind: 34 });
            await first.player.start('screen');
            first.player.root.runtimeID = first.owner;
            await first.graphics.syncFES(first.objects.objects.get(first.owner), first.player);
            for (let frame = 1; frame <= 3; frame++) await first.tick(frame);
            const nativeTextTask = first.graphics.get(
              first.player.root.byKey.get('str').nativeTaskID,
            );
            if (type !== 'NVSTRING') {
              const object = first.player.root.byKey.get('str'),
                name = first.engine.process.string(
                  object.nativeObjectPointer + 892,
                  !profile.startsWith('sdk-'),
                );
              assert.equal(name, 'Authored Face');
            }
            if (type === 'STRING' && !referenced) {
              const runtime = await first.getNativeFeature('fes-objects'),
                instance = first.player.root;
              await assert.rejects(
                runtime.command(instance, instance.byKey.get('str'), 'userfontobj', ['font']),
                /userfontobj requires an IMAGE source: font/,
              );
              const buffers = await first.getNativeFeature('data-buffers'),
                handle = await buffers.load('glyphs', first.owner),
                pointer = buffers.pointer(handle),
                p = first.engine.process;
              assert.equal(
                p.load(p.load(pointer) - 4),
                1,
                'data storage has its own native heap reference header',
              );
              assert.equal(
                (
                  await nativeText(
                    0x26c,
                    [nativeTextTask.record.nativeID, handle],
                    null,
                    { id: first.owner },
                    first,
                  )
                ).control,
                2,
              );
              assert.equal(
                buffers.pointer(handle),
                pointer,
                'the main wrapper and font share the original descriptor',
              );
            }
            assert.equal(nativeTextTask.graph.width, 96);
            assert.equal(nativeTextTask.graph.height, 64);
            const state = {
              engine: first.engine.snapshot(),
              graphics: first.graphics.snapshot(),
              handles: first.runtime.handles.snapshot(),
              objects: first.objects.snapshot(),
              player: first.player.snapshot(),
            };
            for (let frame = 4; frame <= 40; frame++) await first.tick(frame);
            await first.player.notify('QUERY');
            if (type !== 'NVSTRING') assert.equal(first.player.globals[7], 2);
            else {
              assert.equal(first.player.globals[8], 12);
              assert.equal(first.player.globals[9], 24);
            }
            assert.equal(first.player.root.local(0), 0);
            const expected = (
              await first.graphics.images.get(first.graphics.vramHandle).pixels()
            ).slice();
            assert.ok(expected.some((value, i) => i % 4 === 3 && value));
            second = await fixture(profile, bytes, source);
            for (const [name] of state.engine.features) await second.getNativeFeature(name);
            second.engine.restore(state.engine);
            second.runtime.handles.restore(state.handles);
            second.graphics.restore(state.graphics);
            await second.objects.restore(state.objects);
            await second.player.restore(state.player);
            second.owner = first.owner;
            second.player.root.runtimeID = second.owner;
            for (let frame = 4; frame <= 40; frame++) await second.tick(frame);
            assert.deepEqual(
              await second.graphics.images.get(second.graphics.vramHandle).pixels(),
              expected,
            );
            const a = first.graphics.get(first.player.root.byKey.get('str').nativeTaskID),
              b = second.graphics.get(second.player.root.byKey.get('str').nativeTaskID);
            assert.deepEqual(a.text, b.text);
            assert.deepEqual((await a.writer()).records(), (await b.writer()).records());
          } finally {
            await second?.close();
            await first.close();
          }
        }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original task 8 reveals its own character records and resumes in a fresh process`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        first = await fixture(profile, bytes, '');
      let second;
      const advance = async (world, start, end) => {
        for (let frame = start; frame <= end; frame++) {
          await world.objects.tick(frame);
          await world.objects.drawTick(frame);
        }
      };
      try {
        const id = await first.objects.create({ kind: 8, name: 'Authored', frameRate: 60 }),
          task = first.graphics.get(id),
          p = first.engine.process,
          config = p.allocate(1116, true),
          text = encodeCP932('AAB\0'),
          source = p.allocate(text.length, true),
          glyph = p.allocate(20, true);
        // This is the original task's configuration packet, separate from the
        // later STRING/NVSTRING writer layouts. The mounted parser owns layout.
        for (const [at, value] of [
          [8, 96],
          [12, 64],
          [16, 4],
          [20, 1],
          [24, 24],
          [60, 128],
          [64, 0xffffff],
          [68, 1],
          [72, 1],
        ])
          p.store(config + at, value);
        p.write(source, text);
        try {
          await task.message([id, 101, 0, config], { nativePointer: true });
          const font = await first.graphics.images.load('glyphs', 1, id);
          try {
            await task.message([id, 116, 0, font]);
            const copiedBitmap = p.load(p.load(task.pointer + 700) + 16),
              platform = await first.getNativeFeature('graphics-platform');
            assert.deepEqual(
              await platform.logicalBitmap(copiedBitmap).pixels(),
              await first.graphics.images.get(font).pixels(),
            );
          } finally {
            first.graphics.images.release(font);
          }
          [65, 0, 0, 2, 2].forEach((value, i) => p.store(glyph + i * 4, value));
          await task.message([id, 117, 0, glyph], { nativePointer: true });
          await task.message([id, 103, 0, source], { nativePointer: true });
          await task.message([id, 113, 0, 0xffffffff], { nativePointer: true });
        } finally {
          p.free(source);
          p.free(config);
          p.free(glyph);
        }
        assert.equal(task.characters().length, 3 * 40);
        assert.equal(new DataView(task.characters().buffer).getUint16(0, true), 65);
        await advance(first, 1, 3);
        const saved = {
          engine: first.engine.snapshot(),
          graphics: first.graphics.snapshot(),
          handles: first.runtime.handles.snapshot(),
          objects: first.objects.snapshot(),
        };
        await advance(first, 4, 90);
        assert.equal(await task.message([id, 108, 0, 0], { nativePointer: true }), 1);
        const expected = (
          await first.graphics.images.get(first.graphics.vramHandle).pixels()
        ).slice();
        assert.ok(
          expected.some((value, i) => i % 4 === 3 && value),
          'the original task uploaded revealed glyphs to VRAM',
        );

        second = await fixture(profile, bytes, '');
        for (const [name] of saved.engine.features) await second.getNativeFeature(name);
        second.engine.restore(saved.engine);
        second.runtime.handles.restore(saved.handles);
        second.graphics.restore(saved.graphics);
        await second.objects.restore(saved.objects);
        await advance(second, 4, 90);
        const restored = second.graphics.get(id);
        assert.deepEqual(restored.characters(), task.characters());
        assert.deepEqual(
          await second.graphics.images.get(second.graphics.vramHandle).pixels(),
          expected,
        );
        assert.equal(await restored.message([id, 108, 0, 0], { nativePointer: true }), 1);
        assert.equal(
          second.engine.process.load(restored.pointer + 72),
          60,
          'the original common constructor received frameRate',
        );
        await second.objects.release(id);
        assert.equal(second.engine.refs.tasks.byPointer.has(restored.pointer), false);
      } finally {
        await second?.close();
        await first.close();
      }
    },
  );

for (const [profile, variable, types] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', ['STRING', 'STRING8', 'NVSTRING']],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', ['STRING', 'NVSTRING']],
])
  test(
    `${profile} original text definition apply retains colors, base, references and local parent coordinates`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable]));
      for (const type of types) {
        const source = `#DEFINE\n${type} str[2]\nPLANE anchor\n#OBJECT SIZE POS BASE VRAM PRI COLOR BLEND DISP DIV PARENT\nstr 96,64 7,8,9 3,4,5 1,2 12345 0x11223344 128 1 3 anchor\n#OBJECT SIZE POS\nanchor 128,96 10,20\n#OBJECT COLOR\nstr[1] 0x55667788\n#START\nnext WAIT\n#WAIT\n`,
          world = await fixture(profile, bytes, source);
        let failure;
        try {
          world.owner = await world.objects.create({ kind: 34 });
          await world.player.start('screen');
          const instance = world.player.root,
            object = instance.byKey.get('str[0]');
          instance.runtimeID = world.owner;
          const runtime = await world.getNativeFeature('fes-objects'),
            pointer = await runtime.create(instance, object),
            p = world.engine.process,
            float = (offset) => {
              const data = p.read(pointer + offset, 4);
              return new DataView(data.buffer, data.byteOffset, 4).getFloat32(0, true);
            };
          assert.deepEqual([48, 52, 56].map(float), [7, 8, 9]);
          assert.equal(p.load(pointer + 12), instance.byKey.get('anchor').nativeObjectPointer);
          assert.deepEqual([64, 68, 72].map(float), [3, 4, 5]);
          assert.deepEqual(
            [
              p.load(pointer + (type === 'NVSTRING' ? 764 : 176)),
              p.load(pointer + (type === 'NVSTRING' ? 768 : 180)),
              p.load(pointer + 184),
              p.load(pointer + 188),
              p.load(pointer + 192),
            ],
            [96, 64, 12345, 1, 0x80223344],
          );
          assert.deepEqual([740, 744, 748].map(float), [1, 2, 0]);
          // An independent retained Draw surface can start on a different
          // page. Its rectangle does not change the text task's own address.
          world.player.nativeDraw = { target: 23, width: 128, height: 96, offset: [256, 512] };
          const laterColor = instance.byKey.get('str[1]'),
            laterPointer = await runtime.create(instance, laterColor);
          assert.equal(p.load(laterPointer + 192), 0x55667788);
          assert.equal(
            laterColor.alpha,
            0x55,
            'a later COLOR row replaces the earlier BLEND alpha',
          );
          for (let i = 0; i < 3; i++)
            await world.graphics.syncFES(world.objects.objects.get(world.owner), world.player);
          assert.deepEqual([object.x, object.y, object.z], [7, 8, 9]);
          const task = world.graphics.get(object.nativeTaskID);
          assert.deepEqual([740, 744, 748].map(float), [1, 2, 0]);
          assert.deepEqual(task.text.vram, [1, 2]);
          assert.deepEqual(
            Array.from(new Float32Array(task.graph.kx2.buffer, task.graph.kx2.byteOffset + 24, 3)),
            [17, 28, 9],
          );
          instance.apply(object, ['COLOR'], ['0x99aabbcc']);
          await runtime.create(instance, object);
          for (let i = 0; i < 3; i++)
            await world.graphics.syncFES(world.objects.objects.get(world.owner), world.player);
          assert.equal(p.load(pointer + 192), 0x99aabbcc);
          assert.equal(object.alpha, 0x99);
          assert.deepEqual([object.x, object.y, object.z], [7, 8, 9]);
          assert.deepEqual(
            Array.from(new Float32Array(task.graph.kx2.buffer, task.graph.kx2.byteOffset + 24, 3)),
            [17, 28, 9],
          );
        } catch (error) {
          failure = error;
          throw error;
        } finally {
          await closePreservingError(world, failure);
        }
      }
    },
  );

async function closePreservingError(world, error) {
  try {
    await world.close();
  } catch (cleanup) {
    if (error) error.cleanup = cleanup;
    else throw cleanup;
  }
}
