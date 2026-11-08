// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { ImageStore } from '../src/formats/hg3.mjs';

const source = `#DEFINE
CPLANE parent
PLANE child
#OBJECT SIZE POS BASE PRI DISP COLOR
parent 8,6 4,5,6 1,2 50 1 0x80403020
child 12,7 3,4,5 2,3 60 1 0xff112233
#OBJECT PARENT VRAM
child parent 7,8
#SUBCOMMAND
oneshot scale authored-scale.kcs SX[1] SY[1] SZ[1] : [0] [1] [2]
#START
parent size 10 8
parent pos 6 7 8
child scale 200% 300% 100%
next WAIT
#WAIT
`;
async function close(world, failure) {
  if (!world) return;
  try {
    await world.close({ flushFiles: false });
  } catch (error) {
    if (!failure) throw error;
    failure.cleanup = error;
  }
}

test(
  'SDK FES DIFIMAGE retains an actual external image owner through its original refex and draw driver',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      fesSource =
        '#DEFINE\nDIFIMAGE face\n#OBJECT POS PRI DISP\nface 3,4 11 1\n#START\nnext WAIT\n#WAIT\n',
      world = make(profile, bytes, fesSource);
    let fresh, failure;
    try {
      await world.initialize('main.kcs');
      const surface = await world.objects.create({ kind: 15, parent: world.main.id }),
        owner = await world.objects.create({ kind: 34, parent: world.main.id }),
        task = world.objects.objects.get(owner).implementation,
        draw = world.graphics.drawTasks.get(surface);
      await world.sendEngine(surface, world.main.id, 279, 64, 48);
      await world.sendEngine(surface, world.main.id, 283, 0, 0);
      task.surface = surface;
      await task.load('planes', world.main);
      await task.tick();
      const handle = (
          await world.runtime.native('main', 0x2dd, [4, 3], world.main.machine, world.main)
        ).value,
        owners = await world.getNativeFeature('image-owners'),
        pointer = owners.pointer(handle),
        platform = await world.getNativeFeature('graphics-platform'),
        p = world.nativeEngine.process,
        bitmapPointer = p.load(p.load(pointer + 12)),
        mirror = platform.imageHandle(bitmapPointer, world.main.id),
        source = world.graphics.images.get(mirror);
      await source.fill(0, 0, 4, 3, 0xffa43019);
      const instance = task.player.root,
        object = instance.byKey.get('face');
      await world.imagesFES.command(instance, object, 'refex', [String(handle)]);
      assert.equal(p.load(object.nativeObjectPointer + 944), pointer);
      assert.equal(p.load(pointer), 2);
      await task.syncObjects();
      const item = draw.state.renderer.items.find((item) => item.key >>> 16 === 11),
        retained = await world.getNativeFeature('retained-draw');
      assert.ok(item);
      assert.equal(retained.record(draw, item.key).kind, 3);
      assert.equal(retained.record(draw, item.key).source, pointer);
      await draw.render();
      const pixels = await world.graphics.images.get(draw.state.renderer.bitmap).pixels();
      let count = 0;
      for (let at = 0; at < pixels.length; at += 4)
        if (pixels[at] === 164 && pixels[at + 1] === 48 && pixels[at + 2] === 25) count++;
      assert.equal(count, 12);
      await world.runtime.native('main', 0x2c7, [handle], world.main.machine, world.main);
      assert.ok(p.load(pointer) >= 1);
      const saved = structuredClone(world.snapshot());
      fresh = make(profile, bytes, fesSource);
      await fresh.restore(saved);
      const restoredDraw = fresh.graphics.drawTasks.get(surface);
      restoredDraw.state.dirty = true;
      restoredDraw.state.renderer.dirtyRects = [[0, 0, 64, 48]];
      await restoredDraw.render();
      assert.deepEqual(
        await fresh.graphics.images.get(restoredDraw.state.renderer.bitmap).pixels(),
        pixels,
      );
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      await close(fresh, failure);
      await close(world, failure);
    }
  },
);
function make(profile, bytes, fesSource = source, files = {}) {
  const game = memoryGame({
      'engine.exe': bytes,
      'main.kcs': kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]]),
      'planes.fes': encodeCP932(fesSource),
      'authored-scale.kcs': kcsProgram([
        [21, [0x13, 0x80000064], [0x13, 0x8000009c]],
        [21, [0x13, 0x80000068], [0x13, 0x800000a0]],
        [21, [0x13, 0x8000006c], [0x13, 0x800000a4]],
        [43, 0x26, 0],
        [59],
      ]),
      'dummy.kcs': kcsProgram([[59]]),
      ...files,
    }),
    configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom();
  game.width = 64;
  game.height = 48;
  game.resolveCategory = (name, category) => {
    const path = name.includes('.')
      ? name
      : `${name}.${category === 'fes' ? 'fes' : category === 'mot' ? 'kcs' : 'hg2'}`;
    return game.has(path) ? path : null;
  };
  game.requireCategory = (name, category) => game.require(game.resolveCategory(name, category));
  game.readCategory = (name, category) => {
    const path = game.resolveCategory(name, category);
    return path === null ? null : game.read(path);
  };
  Object.assign(configuration.screen, {
    width: 64,
    height: 48,
    currentWidth: 64,
    currentHeight: 48,
    virtualWidth: 64,
    virtualHeight: 48,
  });
  return new NativeWorld({
    game,
    profile,
    configuration,
    random,
    images: new ImageStore(game),
    host: {},
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: { read: async () => null, write: async () => true, stat: async () => null },
  });
}

for (const [profile, variable, vtables] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', [0x8cdae4, 0x8cdaa8]],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', [0x992dc4, 0x992d90]],
]) {
  test(
    `${profile} VIEW preserves its native Base identity and NUMIMG preserves an unallocated declared group`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        fesSource =
          '#DEFINE\nVIEW view\nNUMIMG numbers[3]\n#OBJECT POS\nview 8,9\nnumbers 2,3\n#START\nview pos 20 30\nnumbers disp 1\nnext WAIT\n#WAIT\n',
        world = make(profile, bytes, fesSource);
      let fresh, failure;
      try {
        await world.ensureNativeEngine();
        world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
        await world.objects.create({ kind: 11, parent: world.root, name: 'Input' });
        world.main = await world.spawnScript('main.kcs');
        await world.tick();
        const owner = await world.objects.create({ kind: 34, parent: world.main.id }),
          task = world.objects.objects.get(owner).implementation;
        await task.load('planes', world.main);
        await task.tick();
        const instance = task.player.root,
          view = instance.byKey.get('view'),
          p = world.nativeEngine.process,
          runtime = await world.getNativeFeature('fes-objects');
        assert.equal(p.allocations.get(view.nativeObjectPointer), 44);
        assert.equal(p.load(view.nativeObjectPointer + 4), 0);
        assert.equal(view.nativeTaskID, undefined);
        assert.equal(instance.declaredGroups.numbers, 3);
        assert.equal(
          instance.objects.some((object) => object.type === 'NUMIMG'),
          false,
        );
        const key = p.allocate(8, true);
        p.write(key, encodeCP932('numbers\0'));
        try {
          assert.equal(
            await runtime.withContext({ instance }, () =>
              runtime.call(runtime.sdk ? 0x5f3a80 : 0x755520, [key], runtime.interpreter),
            ),
            3,
          );
        } finally {
          p.free(key);
        }
        assert.equal(task.player.unsupportedCommands.size, 0);
        assert.equal(task.player.unresolvedTargets.size, 0);
        fresh = make(profile, bytes, fesSource);
        await fresh.restore(structuredClone(world.snapshot()));
        const restored = fresh.objects.objects.get(owner).implementation.player.root;
        assert.equal(restored.declaredGroups.numbers, 3);
        assert.equal(
          restored.objects.some((object) => object.type === 'NUMIMG'),
          false,
        );
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        await close(fresh, failure);
        await close(world, failure);
      }
    },
  );
  test(
    `${profile} real plane constructors keep scoped task identities, parent records and original destruction`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        world = make(profile, bytes);
      let fresh;
      try {
        await world.ensureNativeEngine();
        const tops = [];
        for (let i = 0; i < 2; i++) {
          const top = await world.objects.create({ kind: 1, name: 'Authored Top' }),
            planeID = await world.objects.create({
              kind: 2,
              parent: top,
              name: 'Plane',
              nativeID: 33,
            }),
            baseID = await world.objects.create({ kind: 6, parent: planeID, name: 'Input plane' });
          tops.push({ top, planeID, baseID });
          const plane = world.graphics.get(planeID),
            base = world.graphics.get(baseID),
            p = world.nativeEngine.process;
          assert.equal(p.allocations.get(plane.pointer), 0x2ac);
          assert.equal(p.allocations.get(base.pointer), 0xa4);
          assert.equal(p.load(plane.pointer), vtables[0]);
          assert.equal(p.load(base.pointer), vtables[1]);
          assert.equal(p.load(plane.pointer + 4), world.nativeTaskID(planeID));
          assert.equal(p.load(base.pointer + 12), plane.pointer);
          assert.equal(p.load(plane.pointer + 108), 0xffffffff);
          assert.equal(p.load(base.pointer + 108), 0xffffffff);
          assert.equal(plane.graph, null);
          assert.equal(base.graph, null);
        }
        assert.equal(world.nativeTaskID(tops[0].planeID), world.nativeTaskID(tops[1].planeID));
        world.root = tops[0].top;
        world.main = await world.spawnScript('main.kcs');
        const saved = structuredClone(world.snapshot());
        fresh = make(profile, bytes);
        await fresh.restore(saved);
        const removed = tops[1],
          plane = fresh.graphics.get(removed.planeID),
          base = fresh.graphics.get(removed.baseID),
          p = fresh.nativeEngine.process;
        await fresh.objects.release(removed.planeID);
        assert.equal(p.allocations.has(plane.pointer), false);
        assert.equal(p.allocations.has(base.pointer), false);
        assert.equal(fresh.resolveTaskID(33, removed.top), null);
        assert.equal(fresh.resolveTaskID(33, tops[0].top), tops[0].planeID);
        assert.equal(world.nativeEngine.process.allocations.has(plane.pointer), true);
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
  test(
    `${profile} original FES plane drivers create children after START and compose parent and surface transforms`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        world = make(profile, bytes);
      let fresh;
      let failure;
      try {
        await world.ensureNativeEngine();
        world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
        await world.objects.create({ kind: 11, parent: world.root, name: 'Input' });
        world.main = await world.spawnScript('main.kcs');
        await world.tick();
        const surface = await world.objects.create({ kind: 15, parent: world.main.id }),
          owner = await world.objects.create({ kind: 34, parent: world.main.id }),
          task = world.objects.objects.get(owner).implementation;
        await world.sendEngine(surface, world.main.id, 279, 64, 48);
        await world.sendEngine(surface, world.main.id, 283, 11, 13);
        task.surface = surface;
        await task.load('planes', world.main);
        const instance = task.player.root,
          parent = instance.byKey.get('parent'),
          child = instance.byKey.get('child'),
          p = world.nativeEngine.process;
        assert.equal(parent.nativeTaskID, undefined);
        assert.equal(child.nativeTaskID, undefined);
        assert.equal(p.load(child.nativeObjectPointer + 12), parent.nativeObjectPointer);
        await task.tick();
        const parentTask = world.graphics.get(parent.nativeTaskID),
          childTask = world.graphics.get(child.nativeTaskID);
        assert.deepEqual([parentTask.graph.width, parentTask.graph.height], [10, 8]);
        assert.deepEqual(parentTask.graph.colors, [0x80403020]);
        assert.deepEqual([childTask.graph.width, childTask.graph.height], [12, 7]);
        assert.deepEqual(motionVector(childTask.graph.kx2, MOTION_ABI.pos), [9, 11, 13]);
        assert.deepEqual(motionVector(childTask.graph.kx2, MOTION_ABI.base), [2, 3, 60]);
        assert.deepEqual(motionVector(childTask.graph.kx2, MOTION_ABI.scale), [2, 3, 1]);
        assert.deepEqual(
          motionVector(childTask.graph.textureTransform, MOTION_ABI.pos),
          [18, 21, 0],
        );
        const saved = structuredClone(world.snapshot()),
          before = childTask.snapshot();
        fresh = make(profile, bytes);
        await fresh.restore(saved);
        assert.deepEqual(fresh.graphics.get(child.nativeTaskID).snapshot(), before);
        const restored = fresh.objects.objects.get(owner).implementation,
          restoredChild = restored.player.root.byKey.get('child');
        await fresh.planesFES.command(restored.player.root, restoredChild, 'disp', ['0']);
        await fresh.graphics.syncFES(fresh.objects.objects.get(owner), restored.player);
        assert.equal(fresh.graphics.get(child.nativeTaskID).state.shown, false);
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        await close(fresh, failure);
        await close(world, failure);
      }
    },
  );
  for (const mode of ['draw', 'wipe', 'crosswipe', 'wipeout'])
    test(
      `${profile} native FES ${mode.toUpperCase()} executes its real area effect and owns its completion cleanup`,
      { skip: !process.env[variable] },
      async () => {
        const verb = mode === 'draw' ? 'draw' : 'wipe',
          bytes = new Uint8Array(await readFile(process.env[variable])),
          fesSource = `#DEFINE\nPLANE plane\n${['crosswipe', 'wipeout'].includes(mode) ? 'IMAGE art\n' : ''}#OBJECT SIZE POS PRI DISP\nplane 8,6 0,0 1000 1\n${['crosswipe', 'wipeout'].includes(mode) ? '#OBJECT FILE PL DISP\nart source plane 1\n' : ''}#START\nnext WAIT\n#WAIT\n`,
          maskRGBA = Uint8Array.from({ length: 8 * 6 * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : ((i >>> 2) % 8) * 32,
          ),
          files = {
            'mask.hg2': await encodeHG2({ width: 8, height: 6, rgba: maskRGBA }, { crop: false }),
            'source.hg2': await encodeHG2({ width: 8, height: 6, rgba: maskRGBA }, { crop: false }),
          },
          world = make(profile, bytes, fesSource, files);
        let fresh, failure;
        try {
          await world.ensureNativeEngine();
          world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
          await world.objects.create({ kind: 11, parent: world.root, name: 'Input' });
          world.main = await world.spawnScript('main.kcs');
          await world.tick();
          const surface = await world.objects.create({ kind: 15, parent: world.main.id }),
            owner = await world.objects.create({ kind: 34, parent: world.main.id }),
            task = world.objects.objects.get(owner).implementation,
            draw = world.graphics.drawTasks.get(surface);
          await world.sendEngine(surface, world.main.id, 279, 64, 48);
          await world.sendEngine(surface, world.main.id, 283, 0, 0);
          task.surface = surface;
          await task.load('planes', world.main);
          await task.tick();
          await task.tick();
          const instance = task.player.root,
            object = instance.byKey.get('plane'),
            bitmap = world.graphics.images.get(draw.state.renderer.bitmap);
          if (mode === 'crosswipe') {
            const p = world.nativeEngine.process,
              image = instance.byKey.get('art').nativeObjectPointer;
            await world.sendEngine(owner, world.main.id, 342, 0, 1);
            assert.equal(p.load(image + 296), 1, 'sleep must preserve script-owned display');
            assert.equal(p.load(image + 312), 0, 'sleep must not queue an image-count decrement');
            await world.sendEngine(owner, world.main.id, 342, 0, 0);
            assert.equal(p.load(image + 296), 1);
            assert.equal(p.load(image + 312), 0);
          }
          await bitmap.fill(0, 0, 64, 48, 0xffff0000);
          if (mode === 'wipeout')
            await world.imagesFES.command(instance, instance.byKey.get('art'), 'disp', ['0']);
          await world.planesFES.command(
            instance,
            object,
            verb,
            verb === 'draw' ? ['4'] : ['4', 'mask'],
          );
          await task.syncObjects();
          const fade = instance.objects.find(
            (object) => object.nativeType === (verb === 'draw' ? 7 : 8),
          );
          assert.ok(fade?.nativeTaskID != null);
          assert.equal(
            world.objects.objects.get(fade.nativeTaskID).kind,
            verb === 'draw' ? 27 : mode === 'crosswipe' ? 26 : 28,
          );
          if (['crosswipe', 'wipeout'].includes(mode)) {
            const p = world.nativeEngine.process;
            assert.equal(p.load(object.nativeObjectPointer + 756), mode === 'wipeout' ? 0 : 1);
            assert.equal(p.load(object.nativeObjectPointer + 760), 1);
          }
          assert.equal(draw.state.enabled, false);
          await bitmap.fill(0, 0, 64, 48, 0xff0000ff);
          let intermediate = false;
          const observations = [];
          for (let frame = 0; frame < 10 && !intermediate; frame++) {
            await world.tick();
            const pixels = world.graphics.vramHandle
              ? await world.graphics.images.get(world.graphics.vramHandle).pixels()
              : new Uint8Array();
            let red = 0,
              blue = 0;
            for (let at = 0; at < pixels.length; at += 4) {
              if (pixels[at] > 0) red++;
              if (pixels[at + 2] > 0) blue++;
            }
            intermediate = ['draw', 'crosswipe'].includes(mode)
              ? red > 0 && blue > 0
              : pixels.some((value, index) => index % 4 === 3 && value > 0 && value < 255);
            const area = world.objects.objects.get(fade.nativeTaskID)?.implementation;
            observations.push({
              frame: world.frame,
              source: fade.deleted,
              color: [...pixels.subarray(0, 4)],
              area: area
                ? [156, 160, 164, 168].map((at) =>
                    world.nativeEngine.process.load(area.pointer + at),
                  )
                : null,
            });
          }
          assert.equal(intermediate, true, JSON.stringify(observations));
          const saved = structuredClone(world.snapshot()),
            expected = (await bitmap.pixels()).slice(),
            expectedVRAM = (
              await world.graphics.images.get(world.graphics.vramHandle).pixels()
            ).slice();
          fresh = make(profile, bytes, fesSource, files);
          await fresh.restore(saved);
          const restoredDraw = fresh.graphics.drawTasks.get(surface),
            restoredBitmap = fresh.graphics.images.get(restoredDraw.state.renderer.bitmap);
          assert.deepEqual(await restoredBitmap.pixels(), expected);
          assert.deepEqual(
            await fresh.graphics.images.get(fresh.graphics.vramHandle).pixels(),
            expectedVRAM,
          );
          for (let frame = 0; frame < 8; frame++) await fresh.tick();
          const restoredTask = fresh.objects.objects.get(owner).implementation,
            restoredFade = restoredTask.player.root.objects.find(
              (object) => object.nativeType === (verb === 'draw' ? 7 : 8),
            );
          assert.equal(restoredFade.deleted, true);
          assert.equal(fresh.objects.objects.has(fade.nativeTaskID), false);
          assert.equal(restoredDraw.state.enabled, true);
          assert.deepEqual([...(await restoredBitmap.pixels()).subarray(0, 4)], [0, 0, 255, 255]);
        } catch (error) {
          failure = error;
          throw error;
        } finally {
          await close(fresh, failure);
          await close(world, failure);
        }
      },
    );
}
