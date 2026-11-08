// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { ImageStore } from '../src/formats/hg3.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

async function imageFile() {
  const ids = [0, 1, 2, 3, 10, 20, 100, 101, 102, 103, 200, 201, 202, 203, 300, 301, 302, 303],
    frames = [];
  for (const id of ids) {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        rgba.set([30 + (id % 100) * 20, 40 + y * 20, 60 + x * 20, 255], (y * 8 + x) * 4);
    frames.push(await encodeHG2({ width: 8, height: 8, rgba }, { id, crop: false }));
  }
  return linkFrames(frames);
}
function linkFrames(frames) {
  const result = new Uint8Array(12 + frames.reduce((size, frame) => size + frame.length - 12, 0));
  result.set(frames[0].subarray(0, 12));
  let offset = 12;
  for (const [i, frame] of frames.entries()) {
    const body = frame.slice(12);
    new DataView(body.buffer).setUint32(64, i + 1 < frames.length ? body.length : 0, true);
    result.set(body, offset);
    offset += body.length;
  }
  return result;
}
async function areaFile() {
  const frames = [];
  for (const [id, left, top, width, height] of [
    [7, 16, 12, 72, 12],
    [8, 104, 12, 12, 64],
  ]) {
    const rgba = new Uint8Array(128 * 96 * 4);
    for (let y = top; y < top + height; y++)
      for (let x = left; x < left + width; x++) rgba[(y * 128 + x) * 4 + 3] = 255;
    frames.push(await encodeHG2({ width: 128, height: 96, rgba }, { id }));
  }
  return linkFrames(frames);
}
async function scrollFile() {
  const frames = [];
  for (const [id, top, height] of [
    [0, 0, 80],
    [10, 0, 8],
    [20, 72, 8],
    [100, 8, 8],
    [200, 8, 1],
    [1000, 8, 8],
    [1001, 16, 48],
    [1002, 64, 8],
  ]) {
    const rgba = new Uint8Array(8 * 80 * 4);
    for (let y = top; y < top + height; y++)
      for (let x = 0; x < 8; x++)
        rgba.set([100 + (id % 100), 30 + y, 50 + x, 255], (y * 8 + x) * 4);
    frames.push(await encodeHG2({ width: 8, height: 80, rgba }, { id }));
  }
  return linkFrames(frames);
}
async function fixture(profile, exe, source = '') {
  const game = memoryGame({
    'engine.exe': exe,
    'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [43, 0x41, 0], [59]]),
    'screen.fes': new TextEncoder().encode(source),
    'controls.hg2': await imageFile(),
    'scroll.hg2': await scrollFile(),
    'authored-alpha.kcs': kcsProgram([[21, [0x13, 0x80000070], 0x40000000], [43, 0x26, 0], [59]]),
    'authored-loop.kcs': kcsProgram([[21, [0x13, 0x80000070], 0x80000000], [59]]),
    'area.hg2': await areaFile(),
  });
  game.width = 128;
  game.height = 96;
  game.resolveCategory = (name, category) => {
    const base = name.replaceAll('\\', '/'),
      extensions = { image: 'hg2', fes: 'fes', kcs: 'kcs', mot: 'kcs' };
    const path = base.includes('.') ? base : `${base}.${extensions[category] || category}`;
    return game.has(path) ? path : null;
  };
  game.readCategory = async (name, category) => {
    const path = game.resolveCategory(name, category);
    return path === null ? null : game.read(path);
  };
  game.requireCategory = async (name, category) => {
    const value = await game.readCategory(name, category);
    if (value === null) throw new Error(`Missing ${category} ${name}`);
    return value;
  };
  const random = new ParticleRandom(),
    configuration = new NativeConfiguration({ profile }),
    images = new ImageStore(game),
    world = new NativeWorld({
      game,
      images,
      host: {},
      profile,
      configuration,
      random,
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: {
        read: (name) => game.read(name),
        write: async () => true,
        remove: async () => true,
        stat: async () => null,
      },
    });
  return world;
}
async function start(world) {
  world.graphics.initializeTextures();
  world.root = await world.objects.create({ kind: 1, name: 'Authored Top', frameRate: 60 });
  await world.objects.create({ kind: 11, parent: world.root, name: 'Authored Input' });
  world.main = await world.spawnScript('main.kcs');
  await world.tick();
}
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} original controls keep Base messages, task identities and a fresh-process checkpoint`,
    { skip: !process.env[variable] },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable])),
        first = await fixture(profile, exe);
      let second;
      try {
        await start(first);
        const ids = [];
        for (const kind of [40, 41, 42]) {
          const id = await first.objects.create({
              kind,
              parent: first.main.id,
              name: 'Authored control',
            }),
            task = first.objects.objects.get(id).implementation,
            p = first.nativeEngine.process;
          ids.push(id);
          assert.equal(p.load(task.pointer + 4), first.nativeTaskID(id));
          assert.equal(p.load(task.pointer + 72), 60);
          assert.equal(await first.sendEngine(id, first.main.id, 13), 0);
          assert.equal(
            await first.sendEngine(id, first.main.id, 24, 0, -123),
            NATIVE_UNWRITTEN_WORD,
          );
          assert.equal(await first.sendEngine(id, first.main.id, 23), -123 >>> 0);
          const context = {};
          assert.equal(
            await first.sendEngine(id, first.main.id, 999, 0, 0, context),
            NATIVE_UNWRITTEN_WORD,
          );
          assert.equal(context.nativeUnhandled, true);
        }
        second = await fixture(profile, exe);
        await second.restore(structuredClone(first.snapshot()));
        for (const id of ids) {
          const task = second.objects.objects.get(id).implementation,
            p = second.nativeEngine.process,
            pointer = task.pointer;
          assert.equal(await second.sendEngine(id, second.main.id, 23), -123 >>> 0);
          await second.objects.release(id);
          assert.equal(p.allocations.has(pointer), false);
          assert.equal((await second.getNativeFeature('task-memory')).worldID(pointer), undefined);
        }
      } finally {
        await second?.close();
        await first.close();
      }
    },
  );
  test(
    `${profile} original FES controls load image frames, draw and deliver value/focus notifications`,
    { skip: !process.env[variable] },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable])),
        source =
          '#DEFINE\nPLANE pl\nSLIDER slider\nSCROLL2 scroll2\nSCROLL scroll\n#OBJECT SIZE VRAM PRI DISP\npl 128,96 0,0 400 1\n#OBJECT FILE PL POS2 PRI DISP ENABLE\nslider controls pl area:7 1000 1 1\nscroll2 controls pl area:8 1001 1 1\n#OBJECT FILE POS VRAM PRI PRI_P TYPE DISP ENABLE\nscroll scroll 4,4 0,0 1002 1003 0 1 1\n#SUBCOMMAND\noneshot authoredFade authored-alpha p[64] : [0]\ncontinue authoredLoop authored-loop p[0] : [0]\n#START\nslider page 0 100\nslider pos 25 1\nscroll2 page 0 100 20\nscroll2 pos 30\nscroll page 0 100 20\nscroll pos 10\nnext WAIT\n#WAIT\n#slider.SCRL_P\n\\5=\\5+1\nslider getpos 7\n#slider.FOCUS\n\\6=1\n#slider.UNFOCUS\n\\6=0\n#MOTION\nslider authoredFade\nslider ismot 8\n#CHECK\nslider ismot 9\n#LOOP\nslider authoredLoop\nslider ismot 10\n#STOP\nslider stop\nslider ismot 11\n',
        world = await fixture(profile, exe, source);
      let failure, restored;
      try {
        await start(world);
        const surface = await world.objects.create({
          kind: 15,
          parent: world.root,
          name: 'Authored Surface',
        });
        await world.sendEngine(surface, world.main.id, 279, 128, 96);
        await world.sendEngine(surface, world.main.id, 283, 0, 0);
        const fes = await world.objects.create({
            kind: 34,
            parent: world.main.id,
            name: 'Authored FES',
          }),
          record = world.objects.objects.get(fes);
        await world.sendEngine(fes, world.main.id, 331, 0, world.main.context.variableBank);
        await world.sendEngine(fes, world.main.id, 334, 0, world.nativeTaskID(surface));
        await record.implementation.loadSource('screen');
        for (let i = 0; i < 3; i++) await world.tick();
        const player = record.implementation.player,
          objects = ['slider', 'scroll2', 'scroll'].map((key) => player.root.byKey.get(key));
        assert.deepEqual(
          objects.map((object) => world.objects.objects.get(object.nativeTaskID).kind),
          [42, 41, 40],
        );
        assert.deepEqual(
          objects.map((object) => object.value),
          [25, 30, 10],
        );
        const draw = world.graphics.drawTasks.get(surface);
        assert.ok(draw.state.renderer.items.length >= 7);
        await world.sendEngine(surface, world.main.id, 292);
        const bitmap = world.graphics.images.get(draw.state.renderer.bitmap),
          pixels = await bitmap.pixels();
        assert.ok(pixels.some((value, index) => index % 4 !== 3 && value));
        const slider = objects[0];
        const eventCount = player.root.local(5);
        await world.sendEngine(fes, slider.nativeTaskID, 27, 0, 64);
        assert.equal(slider.value, 64);
        assert.equal(player.root.local(5), eventCount + 1);
        assert.equal(player.globals[7], 64);
        assert.equal(player.root.scrollPosition, slider.handle);
        await world.sendEngine(fes, slider.nativeTaskID, 28, 0, 1);
        assert.equal(player.root.local(6), 1);
        await world.sendEngine(fes, slider.nativeTaskID, 28, 0, 0);
        assert.equal(player.root.local(6), 0);
        await world.tick();
        const input = world.inputFor(fes),
          region = input.regions
            .filter(
              (region) => world.objects.objects.get(region.owner)?.parent === slider.nativeTaskID,
            )
            .sort(
              (a, b) =>
                (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) -
                (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]),
            )[0];
        assert.ok(region, 'the original thumb registers its input region');
        const x = (region.bounds[0] + region.bounds[2]) >> 1,
          y = (region.bounds[1] + region.bounds[3]) >> 1;
        input.pointer(x, y, 1);
        await world.tick();
        input.key(0, true, 2, 1);
        await world.tick();
        restored = await fixture(profile, exe, source);
        await restored.restore(structuredClone(world.snapshot()));
        for (const current of [world, restored]) {
          current.inputFor(fes).pointer(x + 20, y, 1);
          await current.tick();
          current.inputFor(fes).key(0, false, 2, 1);
          await current.tick();
          await current.sendEngine(surface, current.main.id, 292);
        }
        const beforeMotion = (await bitmap.pixels()).slice();
        await player.root.notify('MOTION');
        assert.equal(player.globals[8], 1);
        assert.equal(slider.motionBusy, true);
        const pendingMotion = structuredClone(world.snapshot());
        await restored.close();
        restored = await fixture(profile, exe, source);
        await restored.restore(pendingMotion);
        for (const current of [world, restored]) {
          await current.tick();
          const currentPlayer = current.objects.objects.get(fes).implementation.player;
          assert.equal(currentPlayer.root.byKey.get('slider').alpha, 64);
          await currentPlayer.root.notify('CHECK');
          assert.equal(currentPlayer.globals[9], 0);
          assert.equal(currentPlayer.root.byKey.get('slider').motionBusy, false);
          await current.sendEngine(surface, current.main.id, 292);
        }
        assert.notDeepEqual(await bitmap.pixels(), beforeMotion);
        const candidate = restored.objects.objects.get(fes).implementation.player;
        assert.ok(slider.value > 64, 'dragging the original thumb changes its value');
        assert.ok(player.root.local(5) > 1, 'the original task delivers SCRL_P through FES27');
        assert.equal(candidate.root.byKey.get('slider').value, slider.value);
        assert.equal(candidate.root.local(5), player.root.local(5));
        assert.deepEqual(
          await restored.graphics.images
            .get(restored.graphics.drawTasks.get(surface).state.renderer.bitmap)
            .pixels(),
          await bitmap.pixels(),
        );
        assert.deepEqual([...player.unsupportedCommands], []);
        await player.root.notify('LOOP');
        assert.equal(player.globals[10], 1);
        await world.tick();
        assert.equal(slider.alpha, 128);
        assert.equal(slider.motionBusy, true);
        await world.sendEngine(fes, world.main.id, 342, 0, 1);
        const buttonIDs = world.objects
          .children(world.objects.objects.get(slider.nativeTaskID))
          .map((child) => child.id);
        assert.ok(buttonIDs.every((id) => !world.inputFor(fes).get(id).enabled));
        assert.equal(slider.disp, true);
        assert.equal(slider.enable, true);
        await world.sendEngine(fes, world.main.id, 342, 0, 0);
        assert.ok(buttonIDs.every((id) => world.inputFor(fes).get(id).enabled));
        await player.root.notify('STOP');
        assert.equal(player.globals[11], 0);
        assert.equal(slider.motionBusy, false);
        const scroll2 = objects[1],
          thumb = input.regions
            .filter(
              (region) => world.objects.objects.get(region.owner)?.parent === scroll2.nativeTaskID,
            )
            .sort(
              (a, b) =>
                (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) -
                (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]),
            )[0],
          verticalX = (thumb.bounds[0] + thumb.bounds[2]) >> 1,
          verticalY = (thumb.bounds[1] + thumb.bounds[3]) >> 1,
          beforeVertical = scroll2.value;
        input.pointer(verticalX, verticalY, 1);
        await world.tick();
        input.key(0, true, 2, 1);
        await world.tick();
        assert.equal(input.captures[0], thumb.owner);
        input.pointer(verticalX, verticalY + 20, 1);
        await world.tick();
        input.key(0, false, 2, 1);
        await world.tick();
        assert.ok(
          scroll2.value > beforeVertical,
          'SCROLL2 uses its original vertical drag arithmetic',
        );
        const scroll = objects[2],
          task = world.objects.objects.get(scroll.nativeTaskID).implementation,
          arrowID = world.resolveTaskID(
            world.nativeEngine.process.load(task.pointer + 107 * 4),
            scroll.nativeTaskID,
          ),
          arrow = input.get(arrowID);
        input.pointer(
          (arrow.bounds[0] + arrow.bounds[2]) >> 1,
          (arrow.bounds[1] + arrow.bounds[3]) >> 1,
          1,
        );
        await world.tick();
        // The original release path quantizes the task position without a SCRL_P notification.
        const beforeRepeat = world.nativeEngine.process.load(task.pointer + 201 * 4);
        input.key(0, true, 2, 1);
        await world.tick();
        assert.equal(input.captures[0], arrowID);
        assert.equal(scroll.value, beforeRepeat + 1);
        for (let i = 0; i < 35; i++) await world.tick();
        assert.ok(scroll.value > beforeRepeat + 1, 'SCROLL holds its own delayed repeat timer');
        input.key(0, false, 2, 1);
        await world.tick();
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        await restored?.close();
        await closePreservingError(world, failure);
      }
    },
  );
}

async function closePreservingError(world, error) {
  try {
    await world.close();
  } catch (cleanup) {
    if (error) error.cleanup = cleanup;
    else throw cleanup;
  }
}
