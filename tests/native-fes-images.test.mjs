// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { ImageStore } from '../src/formats/hg3.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { nativeDraw } from '../src/native/draw-task.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { hg3, memoryGame, kcsProgram } from './helpers.mjs';

const source = `#DEFINE
CIMAGE background
IMAGE animated
IMAGE mask
BUTTON button
#OBJECT SIZE POS COLOR PRI DISP
background 4,4 1,2 0xff803020 10 1
#OBJECT FILE IDN POS PRI DISP
animated authored -1 8,6 20 1
#OBJECT FILE ID.0 MASK POS PRI DISP
mask authored 0 1 32,6 21 1
#OBJECT FILE ID.0 POS PRI DISP ENABLE
button authored 0 20,8 30 1 0
#SUBCOMMAND
oneshot authoredFade authored-alpha p[64] : [0]
#START
button enable 1
animated setanm authored-animation
animated anm on
next WAIT
#WAIT
#button.PUSH_L
\\5=\\5+1
#MOTION
button authoredFade
button ismot 8
#CHECK
button ismot 9
`;
function animation() {
  const commands = [
      [12, 128],
      [0, 2, 3, 3],
      [12, 255],
      [0, 6, 3, 3],
      [13, 0],
      [0, 7, 100, 100],
    ],
    bytes = new Uint8Array(32 + 68 * commands.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4d4e41, true);
  view.setUint32(8, commands.length, true);
  commands.forEach(([opcode, ...args], index) => {
    view.setUint32(32 + index * 68, opcode, true);
    args.forEach((word, i) => view.setUint32(32 + index * 68 + 8 + i * 8, word, true));
  });
  return bytes;
}
function characterTree(nodes) {
  const entries = nodes.map((node) => {
      const children = node.children ? characterTree(node.children) : new Uint8Array(),
        bytes = new Uint8Array(12 + 100 + children.length),
        view = new DataView(bytes.buffer);
      view.setUint32(4, children.length ? 112 : 0, true);
      view.setUint32(8, 100, true);
      view.setUint32(12, node.id, true);
      bytes.set(encodeCP932(node.prefix || ''), 12 + 36);
      bytes.set(encodeCP932(node.mask || ''), 12 + 68);
      bytes.set(children, 112);
      return bytes;
    }),
    result = new Uint8Array(entries.reduce((size, entry) => size + entry.length, 0));
  let offset = 0;
  for (const [index, bytes] of entries.entries()) {
    new DataView(bytes.buffer).setUint32(0, index + 1 < entries.length ? bytes.length : 0, true);
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}
function imageWindow() {
  const frames = Array.from({ length: 9 }, (_, id) => {
      const rgba = new Uint8Array(16);
      for (let at = 0; at < rgba.length; at += 4)
        rgba.set([20 + id * 20, 30 + id * 7, 170 - id * 10, 255], at);
      return hg3(2, 2, rgba);
    }),
    bytes = new Uint8Array(12 + frames.reduce((size, frame) => size + frame.length - 12, 0));
  bytes.set(frames[0].subarray(0, 12));
  let at = 12;
  for (const [id, frame] of frames.entries()) {
    const body = frame.slice(12),
      view = new DataView(body.buffer);
    view.setUint32(0, id + 1 < frames.length ? body.length : 0, true);
    view.setUint32(4, id, true);
    bytes.set(body, at);
    at += body.length;
  }
  return bytes;
}
async function imageFile(format) {
  const frames = [];
  for (let id = 0; id < 8; id++) {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) rgba.set([id * 30, y * 30, 150, 255], (y * 8 + x) * 4);
    frames.push(
      format === 'hg3'
        ? hg3(8, 8, rgba)
        : await encodeHG2({ width: 8, height: 8, rgba }, { id, crop: false }),
    );
  }
  const result = new Uint8Array(12 + frames.reduce((n, frame) => n + frame.length - 12, 0));
  result.set(frames[0].subarray(0, 12));
  let offset = 12;
  for (const [id, frame] of frames.entries()) {
    const body = frame.slice(12),
      view = new DataView(body.buffer);
    view.setUint32(format === 'hg3' ? 0 : 64, id + 1 < frames.length ? body.length : 0, true);
    if (format === 'hg3') view.setUint32(4, id, true);
    result.set(body, offset);
    offset += body.length;
  }
  return result;
}
async function fixture(profile, exe, format = 'hg3', fesSource = source, options = {}) {
  const game = memoryGame({
    'engine.exe': exe,
    'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [43, 0x41, 0], [59]]),
    'screen.fes': new TextEncoder().encode(fesSource),
    [`authored.${format}`]: await imageFile(format),
    'authored-animation.anm': animation(),
    'authored-alpha.kcs': kcsProgram([[21, [0x13, 0x80000070], 0x40000000], [43, 0x26, 0], [59]]),
    ...options.files,
  });
  game.width = 64;
  game.height = 48;
  game.resolveCategory = (name, category) => {
    const path = name.includes('.')
      ? name
      : `${name}.${{ image: format, fes: 'fes', kcs: 'kcs', mot: 'kcs' }[category]}`;
    return game.has(path) ? path : null;
  };
  game.readCategory = async (name, category) => {
    const path = game.resolveCategory(name, category);
    return path === null ? null : game.read(path);
  };
  game.requireCategory = async (name, category) => {
    const result = await game.readCategory(name, category);
    if (result === null) throw new Error(`Missing authored ${category} ${name}`);
    return result;
  };
  const configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom();
  Object.assign(configuration.fields.screen, { width: 64, height: 48 });
  return new NativeWorld({
    game,
    profile,
    configuration,
    random,
    images: new ImageStore(game),
    host: options.glyphs ? { nativeTextGlyphs: () => options.glyphs } : {},
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: options.storage || {
      read: async () => null,
      write: async () => true,
      remove: async () => true,
      stat: async () => null,
    },
  });
}
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
async function start(world, { frames = 4 } = {}) {
  world.graphics.initializeTextures();
  world.root = await world.objects.create({ kind: 1, name: 'Authored Top', frameRate: 60 });
  await world.objects.create({ kind: 11, parent: world.root, name: 'Authored Input' });
  world.main = await world.spawnScript('main.kcs');
  await world.tick();
  const surface = await world.objects.create({
    kind: 15,
    parent: world.main.id,
    name: 'Authored Surface',
  });
  await world.sendEngine(surface, world.main.id, 279, 64, 48);
  await world.sendEngine(surface, world.main.id, 283, 0, 0);
  const id = await world.objects.create({ kind: 34, parent: world.main.id, name: 'Authored FES' }),
    task = world.objects.objects.get(id).implementation;
  task.surface = surface;
  await task.load('screen', world.main);
  for (let i = 0; i < frames; i++) await task.tick();
  return { id, surface, task };
}
function entry(world, surface, priority) {
  return world.graphics.drawTasks
    .get(surface)
    .state.renderer.items.find((item) => item.key >>> 16 === priority);
}

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} FES loading allocates native children without decoding images or creating plane/model graphs`,
    { skip: !process.env[variable] },
    async () => {
      const utf8 = !profile.startsWith('sdk-'),
        source = `#DEFINE
IMAGE image
BUTTON button
SCROLL scroll
SCROLL2 scroll2
SLIDER slider
STRING text
NVSTRING legacy
M2PLANE model
PLANE plane
${utf8 ? 'STRING8 utf8' : ''}
#OBJECT FILE
image authored
button authored
#START
next WAIT
#WAIT
`,
        world = await fixture(
          profile,
          new Uint8Array(await readFile(process.env[variable])),
          'hg3',
          source,
          { glyphs },
        );
      try {
        const { task, surface } = await start(world, { frames: 0 }),
          instance = task.player.root,
          pointer = (key) => instance.byKey.get(key).nativeObjectPointer,
          p = world.nativeEngine.process;
        for (const [key, kind] of [
          ['button', 6],
          ['scroll', 40],
          ['scroll2', 41],
          ['slider', 42],
          ['text', 48],
          ['legacy', 49],
          ...(utf8 ? [['utf8', 63]] : []),
        ]) {
          const object = instance.byKey.get(key),
            id = key === 'button' ? object.nativeInputTaskID : object.nativeTaskID;
          assert.equal(world.objects.objects.get(id).kind, kind, key);
          assert.ok(pointer(key));
        }
        for (const key of ['image', 'button']) {
          const object = instance.byKey.get(key);
          assert.ok(object.nativeImageWrapper);
          assert.equal(p.load(object.nativeImageWrapper), 0);
        }
        assert.ok(pointer('model'));
        assert.equal(instance.byKey.get('model').nativeTaskID, undefined);
        assert.equal(instance.byKey.get('plane').nativeTaskID, undefined);
        assert.equal(world.nativeEngine.features.has('m2'), false);
        assert.equal(task.imageCache.size, 0);
        assert.equal(instance.local(0), 0);
        assert.equal(world.graphics.drawTasks.get(surface).state.renderer.items.length, 0);
        const graphs = [...world.graphics.graphs.keys()];
        await world.graphics.prepareRender();
        assert.equal(task.imageCache.size, 0);
        assert.deepEqual([...world.graphics.graphs.keys()], graphs);
      } finally {
        await world.close();
      }
    },
  );
async function pixel(world, surface, priority) {
  return [
    ...(await world.graphics.images.get(entry(world, surface, priority).image).pixels()).subarray(
      0,
      4,
    ),
  ];
}
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} original FES image, mask, button, ANM and MOT retain pixels across a fresh World`,
    { skip: !process.env[variable] },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable])),
        world = await fixture(profile, exe);
      let restored;
      try {
        const { id, surface, task } = await start(world),
          objects = task.player.root.byKey;
        assert.deepEqual(
          [objects.get('background').width, objects.get('background').height],
          [4, 4],
        );
        assert.equal(objects.get('animated').currentID, -1);
        assert.deepEqual(await pixel(world, surface, 10), [128, 48, 32, 255]);
        assert.equal(
          world.nativeEngine.process.load(objects.get('mask').nativeObjectPointer + 648),
          1,
        );
        assert.deepEqual(await pixel(world, surface, 21), [0, 0, 150, 255]);
        const platform = world.nativeEngine.features.get('graphics-platform'),
          sourceBitmap = world.graphics.images.get(entry(world, surface, 21).image);
        await platform.withBitmap(
          sourceBitmap,
          async (pointer) => {
            const p = world.nativeEngine.process,
              pixelAt = profile.startsWith('sdk-') ? 0x5638e0 : 0x68cd70;
            for (const [y, green] of [
              [0, 0],
              [7, 210],
            ]) {
              const at = await world.nativeEngine.call(pixelAt, [0, y], pointer);
              assert.deepEqual([...p.read(at, 4)], [150, green, 0, 255]);
            }
            assert.deepEqual(
              await platform.logicalBitmap(pointer).pixels(),
              await sourceBitmap.pixels(),
            );
            assert.equal(p.load(pointer + 76), 1);
          },
          id,
        );
        const p = world.nativeEngine.process,
          padded = p.allocate(92, true),
          paddedData = p.allocate(8 * 8 * 4 + 8 * 4, true),
          stride = 8 * 4 + 4;
        try {
          p.write(paddedData, new Uint8Array(stride * 8).fill(0xa7));
          for (const [offset, value] of [
            [4, 8],
            [8, 8],
            [12, paddedData],
            [20, stride],
            [24, 4],
          ])
            p.store(padded + offset, value);
          await platform.writeLogicalBitmap(padded, sourceBitmap);
          assert.deepEqual(
            await platform.logicalBitmap(padded).pixels(),
            await sourceBitmap.pixels(),
          );
          for (let y = 0; y < 8; y++)
            assert.deepEqual(
              [...p.read(paddedData + y * stride + 32, 4)],
              [0xa7, 0xa7, 0xa7, 0xa7],
            );
        } finally {
          p.free(paddedData);
          p.free(padded);
        }
        const button = objects.get('button'),
          region = world.inputFor(id).get(button.nativeInputTaskID);
        // The enable command changes the original object's word. The event
        // adapter must observe it after the disabled definition was applied.
        assert.equal(
          button.enable,
          !!world.nativeEngine.process.load(button.nativeObjectPointer + 20),
        );
        assert.equal(button.enable, true);
        assert.deepEqual(region.bounds, [20, 8, 28, 16]);
        assert.deepEqual(task.player.root.rect(button), { x: 20, y: 8, w: 8, h: 8 });
        assert.equal(region.priority, 150);
        world.inputFor(id).pointer(24, 12);
        await world.inputFor(id).hover();
        assert.equal(task.input.state.focus, 'button');
        await world.inputFor(id).route(0, true, 2);
        // Plane registration sets its original change word to one. The first
        // press therefore also reaches the low button; subsequent presses use
        // the cleared reply and are captured by the object plane itself.
        assert.equal(task.player.root.local(5), 2);
        await world.inputFor(id).route(0, false, 2);
        await world.inputFor(id).route(0, true, 2);
        assert.equal(task.player.root.local(5), 3);
        await world.inputFor(id).route(0, false, 2);
        for (let frame = 1; frame <= 3; frame++) await world.objects.drawTick(frame);
        assert.equal(entry(world, surface, 20).alpha, 128);
        assert.deepEqual(await pixel(world, surface, 20), [60, 0, 150, 255]);
        const retained = world.nativeEngine.features.get('retained-draw');
        if (!profile.startsWith('sdk-'))
          assert.ok([...retained.threads.values()].every((thread) => thread.completed));
        restored = await fixture(profile, exe);
        await restored.restore(structuredClone(world.snapshot()));
        assert.equal(
          restored.nativeEngine.features.get('retained-draw').renderers.get(surface).pointer,
          retained.renderers.get(surface).pointer,
        );
        for (let frame = 4; frame <= 9; frame++) {
          for (const current of [world, restored]) await current.objects.drawTick(frame);
          assert.deepEqual(await pixel(restored, surface, 20), await pixel(world, surface, 20));
          assert.equal(entry(restored, surface, 20).visible, entry(world, surface, 20).visible);
        }
        assert.equal(entry(world, surface, 20).visible, false);
        assert.deepEqual(await pixel(world, surface, 20), [210, 0, 150, 255]);
        await task.player.root.notify('MOTION');
        assert.equal(task.player.globals[8], 1);
        await world.tick();
        assert.equal(button.alpha, 64);
        await task.player.root.notify('CHECK');
        assert.equal(task.player.globals[9], 0);
        assert.equal(task.player.unsupportedCommands.size, 0);
        await world.objects.release(id);
        assert.equal(world.graphics.drawTasks.get(surface).state.renderer.items.length, 0);
        assert.equal(
          [...retained.items.values()].filter((item) => item.surface === surface).length,
          0,
        );
        assert.equal(
          [...world.nativeEngine.features.get('graphics-platform').bitmapHandles.keys()].filter(
            (key) => key.startsWith(`${id}:`),
          ).length,
          0,
        );
      } finally {
        await restored?.close();
        await world.close();
      }
    },
  );
  test(
    `${profile} retained refresh replays ANM at its existing clock and keeps explicit visibility across updates`,
    { skip: !process.env[variable] },
    async () => {
      const world = await fixture(profile, new Uint8Array(await readFile(process.env[variable])));
      try {
        const { id, surface } = await start(world);
        for (let frame = 1; frame <= 3; frame++) await world.objects.drawTick(frame);
        assert.equal(entry(world, surface, 20).alpha, 128);
        await nativeDraw(0x1d0, [world.nativeTaskID(surface), 20], null, { id }, world);
        assert.equal(entry(world, surface, 20).alpha, 128);
        assert.equal(entry(world, surface, 20).visible, true);
        assert.deepEqual(await pixel(world, surface, 20), [60, 0, 150, 255]);
        await world.sendEngine(surface, id, 287, 30, 0);
        await world.objects.drawTick(4);
        assert.equal(entry(world, surface, 30).visible, false);
      } finally {
        await world.close();
      }
    },
  );
  test(
    `${profile} original PANEL and SAVEPANEL construct and compose defined image parts`,
    { skip: !process.env[variable] },
    async () => {
      const fesSource = `#DEFINE
IMAGE digits[2]
PANEL panel
SAVEPANEL saved
#OBJECT FILE ID.0 ID.1 DISP
digits[0] authored 0 3 0
digits[1] authored 3 0 0
#OBJECT FILE POS PRI DISP
panel authored 1,2 10 1
saved authored 12,2 20 1
#START
saved ptype NORM 0
saved ptype IMAGE 1 authored:4
saved ptype IMAGEOBJ 2 digits[1]
saved setsave 7 0x400 0
saved dispid 1 [0-2]
next WAIT
#WAIT
`;
      const world = await fixture(
        profile,
        new Uint8Array(await readFile(process.env[variable])),
        'hg3',
        fesSource,
      );
      try {
        const { surface, task } = await start(world),
          objects = task.player.root.byKey,
          saved = objects.get('saved'),
          p = world.nativeEngine.process;
        assert.deepEqual([objects.get('panel').width, objects.get('panel').height], [8, 8]);
        assert.deepEqual([saved.width, saved.height], [8, 8]);
        assert.equal(p.load(saved.nativeObjectPointer + 4), 12);
        assert.deepEqual(await pixel(world, surface, 20), [90, 0, 150, 255]);
        assert.equal(task.player.unsupportedCommands.size, 0);
      } finally {
        await world.close();
      }
    },
  );
  test(
    `${profile} SAVEPANEL executes all ptype branches against an actual CSS file and restores its composite`,
    { skip: !process.env[variable] },
    async () => {
      const kinds = [
          'NORM',
          'IMAGE authored:4',
          'SIMAGE 0x100',
          'IMAGEOBJ digits',
          'STR 7 4 8 0xffffff 0 0',
          'SSTR 0x200 4 8 0xffffff 0 0',
          'NUM_S 11 4 8 0xffffff 0 0',
          'NUM_O digits 3',
          'NUM_O2 digits 3',
          'NUM_I digits 3',
        ],
        definitions = kinds.map((kind, i) => {
          const [name, ...args] = kind.split(' ');
          return `saved[${i}] ptype ${name} 0 ${args.join(' ')}`;
        }),
        loads = kinds.flatMap((_, i) => [
          `saved[${i}] setsave 7 0x400 0`,
          `saved[${i}] dispid 1 0`,
        ]),
        fesSource = `#DEFINE
IMAGE digits
SAVEPANEL saved[${kinds.length}]
#OBJECT FILE ID.0 ID.1 ID.2 ID.3 ID.4 ID.5 ID.6 ID.7 DISP
digits authored 0 1 2 3 4 5 6 7 0
#OBJECT FILE PRI DISP
${kinds.map((_, i) => `saved[${i}] authored ${20 + i} 1`).join('\n')}
#START
${definitions.join('\n')}
next WAIT
#WAIT
#LOAD
${loads.join('\n')}
saved[0] getflag 5 10
$11=53
$12=64
saved[0] getflag 1024 11
saved[0] getflag -1 12
`,
        files = new Map(),
        reads = [],
        modifiedMs = Date.UTC(2025, 3, 18, 11, 23, 45),
        storage = {
          read: async (name) => {
            reads.push(name);
            return files.get(name) ?? null;
          },
          write: async (name, bytes) => {
            files.set(name, bytes.slice());
            return true;
          },
          remove: async (name) => files.delete(name),
          stat: async (name) => (files.has(name) ? { modifiedMs } : null),
        },
        exe = new Uint8Array(await readFile(process.env[variable])),
        world = await fixture(profile, exe, 'hg3', fesSource, { storage, glyphs });
      let restored;
      try {
        const { surface, task } = await start(world),
          objects = task.player.root.byKey,
          saved = objects.get('saved[0]'),
          p = world.nativeEngine.process,
          sdk = profile.startsWith('sdk-'),
          directory = p.string(saved.nativeObjectPointer + (sdk ? 1784 : 2296), !sdk),
          file = new NativeGlobalFile(),
          flags = new Uint32Array(1024);
        // This Top uses an empty save directory. The original reader prepends
        // a separator, which Win32 maps to the root of the virtual game drive.
        assert.equal(directory, '');
        const slot = 'save0007.dat';
        flags[5] = 617;
        file.write(0x400, new Uint8Array(flags.buffer));
        file.write(
          0x100,
          hg3(
            2,
            2,
            new Uint8Array([17, 33, 67, 255, 71, 39, 19, 255, 55, 12, 99, 255, 31, 80, 40, 255]),
          ),
        );
        file.write(0x200, Uint8Array.from([...encodeCP932('7'), 0]));
        const savedBytes = await file.file();
        assert.equal(new DataView(savedBytes.buffer).getUint32(0, true), 0x535343);
        files.set(slot, savedBytes);
        await task.player.root.notify('LOAD');
        await task.tick();
        assert.ok(reads.includes(slot));
        assert.equal(task.player.globals[10], 617);
        assert.equal(task.player.globals[11], 0);
        assert.equal(task.player.globals[12], 0);
        const pixels = await Promise.all(kinds.map((_, i) => pixel(world, surface, 20 + i))),
          composites = await Promise.all(
            kinds.map((_, i) =>
              world.graphics.images.get(entry(world, surface, 20 + i).image).pixels(),
            ),
          ),
          firstPixel = (i) => {
            const at = composites[i].findIndex((value, index) => index % 4 === 3 && value);
            return at < 0
              ? null
              : {
                  x: ((at - 3) / 4) % 8,
                  y: Math.floor((at - 3) / 32),
                  rgba: [...composites[i].slice(at - 3, at + 1)],
                };
          },
          date = new Date(modifiedMs - new Date().getTimezoneOffset() * 60000);
        assert.deepEqual(
          Array.from({ length: 6 }, (_, i) =>
            p.load(saved.nativeObjectPointer + (sdk ? 2048 : 2816) + i * 4),
          ),
          [
            date.getUTCFullYear(),
            date.getUTCMonth() + 1,
            date.getUTCDate(),
            date.getUTCHours(),
            date.getUTCMinutes(),
            date.getUTCSeconds(),
          ],
        );
        assert.deepEqual(pixels[0], [0, 0, 150, 255]);
        assert.deepEqual(pixels[1], [0, 0, 0, 0]);
        assert.deepEqual(firstPixel(2), { x: 0, y: 6, rgba: [17, 33, 67, 255] });
        assert.deepEqual(pixels[3], [0, 0, 150, 255]);
        // The fixed handlers treat STR's first numeric argument as a saved
        // entry; NUM_S keeps its constructor defaults. Preserve those profile
        // behaviors instead of supplying the older manual's missing fields.
        assert.equal(firstPixel(4), null);
        assert.deepEqual(firstPixel(5), { x: 1, y: 3, rgba: [255, 255, 255, 255] });
        assert.deepEqual(firstPixel(6), { x: 1, y: 7, rgba: [0, 0, 0, 255] });
        assert.deepEqual(pixels[7], [90, 0, 150, 255]);
        assert.deepEqual(pixels[8], [90, 0, 150, 255]);
        assert.deepEqual(pixels[9], [0, 0, 0, 0]);
        assert.equal(task.player.unsupportedCommands.size, 0);
        restored = await fixture(profile, exe, 'hg3', fesSource, { storage, glyphs });
        await restored.restore(structuredClone(world.snapshot()));
        for (let i = 0; i < kinds.length; i++)
          assert.deepEqual(
            await restored.graphics.images.get(entry(restored, surface, 20 + i).image).pixels(),
            composites[i],
          );
      } finally {
        await restored?.close();
        await world.close();
      }
    },
  );
  test(
    `${profile} retained image frame enumeration preserves its original HG2 profile behavior`,
    { skip: !process.env[variable] },
    async () => {
      const world = await fixture(
        profile,
        new Uint8Array(await readFile(process.env[variable])),
        'hg2',
      );
      try {
        const { surface } = await start(world);
        await world.objects.drawTick(4);
        assert.equal((await pixel(world, surface, 20))[0], profile.startsWith('sdk-') ? 180 : 0);
      } finally {
        await world.close();
      }
    },
  );
}

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original IMGWND composes all nine frames and keeps its real retained window`,
    { skip: !process.env[variable] },
    async () => {
      const source =
          '#DEFINE\nIMGWND wnd\n#OBJECT FILE POS PRI DISP\nwnd window 8,6 20 1\n#START\nwnd size 12 10\nnext WAIT\n#WAIT\n#HIDE\nwnd disp 0\n',
        exe = new Uint8Array(await readFile(process.env[variable])),
        files = { 'window.hg3': imageWindow() },
        world = await fixture(profile, exe, 'hg3', source, { files });
      let restored;
      try {
        (await world.ensureNativeEngine()).process.budget = 2000000;
        const { surface, task } = await start(world, { frames: 0 }),
          object = task.player.root.byKey.get('wnd'),
          p = world.nativeEngine.process;
        assert.equal(p.load(object.nativeImageWrapper), 0);
        assert.equal(task.imageCache.size, 0);
        assert.equal(world.graphics.drawTasks.get(surface).state.renderer.items.length, 0);
        assert.deepEqual([object.width, object.height], [-1, -1]);
        const runtime = await world.getNativeFeature('fes-objects'),
          runDriver = runtime.runDriver.bind(runtime),
          calls = [];
        runtime.runDriver = (...args) => {
          calls.push(args[1].key);
          return runDriver(...args);
        };
        for (let i = 0; i < 2; i++) await world.graphics.prepareRender();
        assert.deepEqual(calls, []);
        assert.equal(task.imageCache.size, 0);
        await world.sendEngine(task.player.root.runtimeID, world.main.id, 333, 0, 0);
        assert.deepEqual(calls, ['wnd']);
        const bitmap = p.load(object.nativeImageWrapper);
        assert.ok(bitmap);
        assert.deepEqual([p.load(bitmap + 4), p.load(bitmap + 8)], [12, 10]);
        const data = p.load(bitmap + 12),
          stride = p.load(bitmap + 20),
          sample = (x, y) => [...p.read(data + y * stride + x * 4, 4)],
          color = (id) => [170 - id * 10, 30 + id * 7, 20 + id * 20, 255];
        for (const [x, y, id] of [
          [0, 0, 0],
          [11, 0, 1],
          [0, 9, 2],
          [11, 9, 3],
          [0, 4, 4],
          [11, 4, 5],
          [4, 0, 6],
          [4, 9, 7],
          [4, 4, 8],
        ])
          assert.deepEqual(sample(x, y), color(id), `original tile ${id}`);
        assert.equal(task.player.unsupportedCommands.size, 0);
        assert.ok(entry(world, surface, 20));
        const cached = [...task.imageCache],
          count = calls.length;
        for (let i = 0; i < 2; i++) await world.graphics.prepareRender();
        assert.equal(calls.length, count);
        assert.deepEqual([...task.imageCache], cached);
        await world.sendEngine(surface, world.main.id, 292, 0, 0);
        const expected = (
          await world.graphics.images.get(world.graphics.vramHandle).pixels()
        ).slice();
        const saved = world.snapshot();
        restored = await fixture(profile, exe, 'hg3', source, { files });
        await restored.restore(saved);
        assert.deepEqual(
          await restored.graphics.images.get(restored.graphics.vramHandle).pixels(),
          expected,
        );
        const player = restored.objects.objects.get(task.player.root.runtimeID).implementation
          .player;
        await player.notify('HIDE');
        await restored.graphics.syncFES(
          restored.objects.objects.get(player.root.runtimeID),
          player,
        );
        assert.equal(entry(restored, surface, 20).visible, false);
      } catch (error) {
        error.cause = world.nativeEngine?.process.faultState();
        throw error;
      } finally {
        await restored?.close();
        await world.close();
      }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original CHTABLE3 follows named sections and retains partial selections`,
    { skip: !process.env[variable] },
    async () => {
      const table = encodeCP932(
          '#_TOP_\r\nauthored A\r\nsecond B\r\nmerged,1,@ MASK\r\n#A\r\n@ FINAL\r\nchanged STOP\r\n#B\r\n@ FINAL\r\n#MASK\r\n@,@,2 END\r\n',
        ),
        source =
          '#DEFINE\nCHTABLE3 ch\n#OBJECT TABLE ID.0 POS PRI DISP\nch authored.tbl 0 8,6 20 1\n#START\nch max 20\nch max 21 0\nch max 22 0 0\nch max 23 9\nch load 1 0\nnext WAIT\n#WAIT\n#FIRST\nch baseopt _alt\nch load 0 1\n#PARTIAL\nch load 0 9\n#MERGE\nch load 2 0\n#MISSING\nch load 9\n',
        pixels = Uint8Array.of(
          14,
          91,
          207,
          255,
          24,
          101,
          217,
          255,
          34,
          111,
          227,
          255,
          44,
          121,
          237,
          255,
        ),
        exe = new Uint8Array(await readFile(process.env[variable])),
        files = {
          'authored.tbl': table,
          'second.hg3': hg3(2, 2, pixels),
          'changed.hg3': hg3(2, 2, pixels),
        },
        world = await fixture(profile, exe, 'hg3', source, { files });
      let restored;
      try {
        const { surface, task } = await start(world),
          object = task.player.root.byKey.get('ch'),
          p = world.nativeEngine.process;
        assert.equal(p.string(object.nativeObjectPointer + 680), 'second');
        assert.deepEqual(
          [20, 21, 22, 23].map((index) => task.player.globals[index]),
          [3, 2, 0, 0],
        );
        assert.deepEqual(
          new Uint8Array(await world.graphics.images.get(entry(world, surface, 20).image).pixels()),
          pixels,
        );
        const saved = world.snapshot();
        restored = await fixture(profile, exe, 'hg3', source, { files });
        await restored.restore(saved);
        const player = restored.objects.objects.get(task.player.root.runtimeID).implementation
            .player,
          file = () =>
            restored.nativeEngine.process.string(
              player.root.byKey.get('ch').nativeObjectPointer + 680,
            );
        await player.notify('FIRST');
        assert.equal(
          file(),
          'changed',
          'baseopt is inserted only before a comma, leaving a plain prefix unchanged',
        );
        await restored.graphics.syncFES(
          restored.objects.objects.get(player.root.runtimeID),
          player,
        );
        assert.equal(player.unsupportedCommands.size, 0);
        await player.notify('PARTIAL');
        assert.equal(
          file(),
          'authored',
          'an invalid later selector retains the earlier accumulated prefix',
        );
        await player.notify('MERGE');
        assert.equal(
          file(),
          'merged_alt,1,2',
          'placeholder components and the suffix merge through the original string routines',
        );
        await player.notify('MISSING');
        assert.equal(file(), '', 'an invalid first selector produces the original empty result');
      } finally {
        await restored?.close();
        await world.close();
      }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original CHTABLE2 traverses its binary hierarchy and applies baseopt`,
    { skip: !process.env[variable] },
    async () => {
      const table = characterTree([
          {
            id: 0,
            children: [
              {
                id: 0,
                children: [
                  {
                    id: 0,
                    children: [
                      { id: 0, prefix: 'authored' },
                      { id: 1, prefix: 'second' },
                      { id: 2, prefix: 'merged', mask: '1@2' },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
        source =
          '#DEFINE\nCHTABLE2 ch\n#OBJECT TABLE ID.0 POS PRI DISP\nch authored.tbl 0 8,6 20 1\n#START\nch max 20\nch max 21 0\nch max 22 0 0\nch max 23 0 0 0\nch load 0 0 1\nnext WAIT\n#WAIT\n#INVALID\nch load 9 0 0\nch load 0 9 0\n#FIRST\nch baseopt _alt\nch load 0 0 0\n#MISSING\nch load 0 0 9\n#MASK\nch load 0 0 2\n',
        pixels = Uint8Array.of(
          14,
          91,
          207,
          255,
          24,
          101,
          217,
          255,
          34,
          111,
          227,
          255,
          44,
          121,
          237,
          255,
        ),
        exe = new Uint8Array(await readFile(process.env[variable])),
        files = {
          'authored.tbl': table,
          'second.hg3': hg3(2, 2, pixels),
          'authored_alt.hg3': hg3(2, 2, pixels),
        },
        world = await fixture(profile, exe, 'hg3', source, { files });
      let restored;
      try {
        const { surface, task } = await start(world),
          object = task.player.root.byKey.get('ch'),
          p = world.nativeEngine.process;
        assert.equal(p.string(object.nativeObjectPointer + 680), 'second');
        assert.deepEqual(
          [20, 21, 22, 23].map((index) => task.player.globals[index]),
          [1, 1, 1, 3],
        );
        assert.deepEqual(
          new Uint8Array(await world.graphics.images.get(entry(world, surface, 20).image).pixels()),
          pixels,
        );
        await task.player.notify('INVALID');
        assert.equal(p.string(object.nativeObjectPointer + 680), 'second');
        const saved = world.snapshot();
        restored = await fixture(profile, exe, 'hg3', source, { files });
        await restored.restore(saved);
        const player = restored.objects.objects.get(task.player.root.runtimeID).implementation
          .player;
        await player.notify('FIRST');
        await restored.graphics.syncFES(
          restored.objects.objects.get(player.root.runtimeID),
          player,
        );
        assert.equal(
          restored.nativeEngine.process.string(
            player.root.byKey.get('ch').nativeObjectPointer + 680,
          ),
          'authored_alt',
        );
        assert.equal(player.unsupportedCommands.size, 0);
        await player.notify('MISSING');
        assert.equal(
          restored.nativeEngine.process.string(
            player.root.byKey.get('ch').nativeObjectPointer + 680,
          ),
          '_alt',
          'a missing lower selector still returns its accumulated prefix/suffix',
        );
        await player.notify('MASK');
        assert.equal(
          restored.nativeEngine.process.string(
            player.root.byKey.get('ch').nativeObjectPointer + 680,
          ),
          'merged_alt,1,0,2',
        );
      } finally {
        await restored?.close();
        await world.close();
      }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original CHTABLE validates character, pose and both variant banks`,
    { skip: !process.env[variable] },
    async () => {
      const table = new Uint8Array(20 * 8 * 540),
        view = new DataView(table.buffer);
      for (const [character, name, variants] of [
        [0, 'authored', 2],
        [1, 'second', 1],
      ]) {
        const at = character * 8 * 540;
        view.setUint32(at, 1, true);
        table.set(encodeCP932(name), at + 4);
        view.setUint32(at + 20, variants, true);
        view.setUint32(at + 280, 1, true);
      }
      const source =
          '#DEFINE\nCHTABLE ch\n#OBJECT TABLE ID.0 POS PRI DISP\nch authored.tbl 0 8,6 20 1\n#START\nch load 1 0 0 0\nnext WAIT\n#WAIT\n#INVALID\nch load -1 0 0 0\nch load 2 0 0 0\nch load 20 0 0 0\nch load 1 1 0 0\nch load 1 8 0 0\nch load 1 0 1 0\nch load 1 0 16 0\nch load 1 0 0 1\nch load 1 0 0 16\n#FIRST\nch load 0 0 1 0\n',
        exe = new Uint8Array(await readFile(process.env[variable])),
        pixels = Uint8Array.of(
          14,
          91,
          207,
          255,
          24,
          101,
          217,
          255,
          34,
          111,
          227,
          255,
          44,
          121,
          237,
          255,
        ),
        files = { 'authored.tbl': table, 'second.hg3': hg3(2, 2, pixels) },
        world = await fixture(profile, exe, 'hg3', source, { files });
      let restored;
      try {
        const { surface, task } = await start(world),
          object = task.player.root.byKey.get('ch'),
          p = world.nativeEngine.process;
        assert.equal(p.string(object.nativeObjectPointer + 680), 'second');
        assert.equal(object.width, 2);
        assert.deepEqual(
          new Uint8Array(await world.graphics.images.get(entry(world, surface, 20).image).pixels()),
          pixels,
        );
        await task.player.notify('INVALID');
        await world.graphics.syncFES(
          world.objects.objects.get(task.player.root.runtimeID),
          task.player,
        );
        assert.equal(p.string(object.nativeObjectPointer + 680), 'second');
        assert.equal(task.player.unsupportedCommands.size, 0);
        const saved = world.snapshot();
        restored = await fixture(profile, exe, 'hg3', source, { files });
        await restored.restore(saved);
        const player = restored.objects.objects.get(task.player.root.runtimeID).implementation
          .player;
        await player.notify('FIRST');
        await restored.tick();
        await restored.graphics.syncFES(
          restored.objects.objects.get(player.root.runtimeID),
          player,
        );
        assert.equal(
          restored.nativeEngine.process.string(
            player.root.byKey.get('ch').nativeObjectPointer + 680,
          ),
          'authored',
        );
        assert.equal(player.root.byKey.get('ch').nativeImageMetrics.width, 8);
      } finally {
        await restored?.close();
        await world.close();
      }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original comma image preserves its profile-specific layer filename handling`,
    { skip: !process.env[variable] },
    async () => {
      const firstPixels = Uint8Array.of(
          191,
          21,
          11,
          255,
          11,
          191,
          21,
          255,
          21,
          191,
          191,
          255,
          191,
          191,
          21,
          255,
        ),
        overlay = Uint8Array.of(1, 2, 3, 0, 11, 21, 191, 255, 4, 5, 6, 0, 7, 8, 9, 0),
        expected = Uint8Array.of(
          191,
          21,
          11,
          255,
          11,
          21,
          191,
          255,
          21,
          191,
          191,
          255,
          191,
          191,
          21,
          255,
        ),
        source =
          '#DEFINE\nIMAGE layers\n#OBJECT FILE ID.0 POS PRI DISP\nlayers images/layer,1,1.hg3 0 8,6 20 1\n#START\nnext WAIT\n#WAIT\n',
        exe = new Uint8Array(await readFile(process.env[variable])),
        files = {
          'images/layer_1.hg3': hg3(2, 2, firstPixels),
          'images/layer_01.hg3': hg3(2, 2, overlay),
        },
        world = await fixture(profile, exe, 'hg3', source, { files });
      let restored;
      try {
        const reads = [];
        const original = await NativeEngineProcess.open({ profile, bytes: exe }),
          p = original.process,
          probeWorld = {
            game: world.game,
            async getNativeFeature(name) {
              if (name !== 'data-buffers') throw new Error(`Unknown authored feature ${name}`);
              return original.features.get(name) ?? new NativeDataBuffers(original);
            },
          };
        try {
          new NativeEngineFiles(original, probeWorld);
          for (const [name, definition] of nativeRectangleDefinitions(p))
            original.registerWindows('USER32.dll', name, definition);
          original.kernel.registerFiles('full original comma cache observation', {
            read: (name) => {
              reads.push(name);
              return undefined;
            },
          });
          const sdk = profile.startsWith('sdk-'),
            wrapper = p.allocate(sdk ? 0x114 : 0x218, true),
            interpreter = p.allocate(0x300, true),
            manager = p.allocate(0x200, true),
            filename = p.allocate(128, true);
          p.write(filename, encodeCP932('images/layer,1,1.hg3\0'));
          p.store(interpreter + 108, manager);
          await original.call(sdk ? 0x565560 : 0x68e9f0, [], wrapper);
          assert.equal(
            await original.call(sdk ? 0x503250 : 0x62bfb0, [wrapper, filename, 0], interpreter),
            0,
          );
          if (sdk) {
            const bitmap = p.load(wrapper);
            assert.ok(bitmap);
            assert.deepEqual(
              p.read(p.load(bitmap + 12), 16),
              Uint8Array.of(
                191,
                191,
                21,
                255,
                21,
                191,
                191,
                255,
                11,
                21,
                191,
                255,
                191,
                21,
                11,
                255,
              ),
            );
          } else {
            assert.equal(p.load(wrapper), 0);
            assert.equal(reads.length, 2);
            for (const name of reads) assert.ok(name.startsWith('浩条獥氯祡牥_'), name);
          }
          await (await probeWorld.getNativeFeature('data-buffers')).releaseBitmapPointer(wrapper);
        } finally {
          await original.close();
        }
        reads.length = 0;
        const engine = await world.ensureNativeEngine();
        engine.kernel.registerFiles('compound authored observation', {
          read: (path) => {
            reads.push(path);
            return undefined;
          },
        });
        const { surface, task } = await start(world);
        assert.equal(task.player.unsupportedCommands.size, 0);
        if (!profile.startsWith('sdk-')) {
          // The pinned game's original 6746A0 passes a narrow prefix to
          // wsprintfW("%s_"). Its layer requests therefore reinterpret pairs
          // of ASCII bytes as UTF-16. The SDK's narrow implementation succeeds.
          assert.equal(entry(world, surface, 20), undefined);
          assert.equal(task.player.root.byKey.get('layers').nativeImageHandle, 0);
          assert.equal(reads.length, 2);
          for (const path of reads) assert.ok(path.startsWith('浩条獥氯祡牥_'), path);
          return;
        }
        assert.ok(entry(world, surface, 20));
        assert.deepEqual(
          new Uint8Array(await world.graphics.images.get(entry(world, surface, 20).image).pixels()),
          expected,
        );
        await world.sendEngine(surface, world.main.id, 292, 0, 0);
        const pixels = await world.graphics.images
          .get(world.graphics.drawTasks.get(surface).state.renderer.bitmap)
          .pixels();
        assert.ok(
          pixels.some((value) => value),
          'the original retained manager draws the composition',
        );
        const saved = world.snapshot();
        restored = await fixture(profile, exe, 'hg3', source, { files });
        await restored.restore(saved);
        assert.deepEqual(
          new Uint8Array(
            await restored.graphics.images.get(entry(restored, surface, 20).image).pixels(),
          ),
          expected,
        );
        assert.deepEqual(
          await restored.graphics.images
            .get(restored.graphics.drawTasks.get(surface).state.renderer.bitmap)
            .pixels(),
          pixels,
        );
      } finally {
        await restored?.close();
        await world.close();
      }
    },
  );

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  for (const type of ['BGTABLE', 'BGTABLE2'])
    test(
      `${profile} original ${type} selects rows and rejects invalid variants without replacing the image`,
      { skip: !process.env[variable] },
      async () => {
        const table = new Uint8Array(4 + 2 * 128),
          view = new DataView(table.buffer);
        view.setUint32(0, 2, true);
        for (const [row, names] of [
          ['authored', 'second', '', 'authored'],
          ['second', '', 'authored', ''],
        ].entries())
          for (const [variant, name] of names.entries())
            table.set(encodeCP932(name), 4 + row * 128 + variant * 32);
        const pixels = Uint8Array.of(
            14,
            91,
            207,
            255,
            24,
            101,
            217,
            255,
            34,
            111,
            227,
            255,
            44,
            121,
            237,
            255,
          ),
          source = `#DEFINE\n${type} bg\n#OBJECT TABLE POS PRI DISP\nbg authored.tbl 8,6 20 1\n#START\nbg load 0 1\nnext WAIT\n#WAIT\n#INVALID\nbg load -1 0\nbg load 2 0\nbg load 0 4\nbg load 0 2\n#FIRST\nbg load 0 0\n`,
          exe = new Uint8Array(await readFile(process.env[variable])),
          files = {
            'authored.tbl':
              type === 'BGTABLE'
                ? table
                : encodeCP932(
                    'ignored,header,second,authored\r\n○,one,authored,second,,authored\r\n○,two,second,,authored,\r\n',
                  ),
            'second.hg3': hg3(2, 2, pixels),
          },
          first = await fixture(profile, exe, 'hg3', source, { files });
        let second;
        try {
          const { task } = await start(first),
            object = task.player.root.byKey.get('bg'),
            runtime = await first.getNativeFeature('fes-objects'),
            p = runtime.process;
          assert.equal(p.string(object.nativeObjectPointer + 680), 'second');
          assert.equal(object.width, 2);
          assert.equal(task.player.unsupportedCommands.size, 0);
          await first.graphics.drawTasks.get(task.surface).render();
          const expected = (
            await first.graphics.images
              .get(first.graphics.drawTasks.get(task.surface).state.renderer.bitmap)
              .pixels()
          ).slice();
          assert.ok(expected.some((v) => v));
          await task.player.notify('INVALID');
          await first.graphics.syncFES(
            first.objects.objects.get(task.player.root.runtimeID),
            task.player,
          );
          assert.equal(p.string(object.nativeObjectPointer + 680), 'second');
          const saved = first.snapshot();
          second = await fixture(profile, exe, 'hg3', source, { files });
          await second.restore(saved);
          const restored = second.objects.objects.get(task.player.root.runtimeID).implementation;
          assert.deepEqual(
            await second.graphics.images
              .get(second.graphics.drawTasks.get(restored.surface).state.renderer.bitmap)
              .pixels(),
            expected,
          );
          await restored.player.notify('FIRST');
          await second.graphics.syncFES(
            second.objects.objects.get(task.player.root.runtimeID),
            restored.player,
          );
          assert.equal(
            second.nativeEngine.process.string(
              restored.player.root.byKey.get('bg').nativeObjectPointer + 680,
            ),
            'authored',
          );
        } finally {
          await second?.close();
          await first.close();
        }
      },
    );
