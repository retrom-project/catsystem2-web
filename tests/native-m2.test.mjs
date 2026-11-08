// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeObjects } from '../src/native/objects.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { installNativeGraphics } from '../src/native/graphics.mjs';
import { installNativeM2 } from '../src/native/emote.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { installNativeBitmapMemory } from '../src/native/bitmap-memory.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { ImageStore } from '../src/formats/hg3.mjs';
import { memoryGame } from './helpers.mjs';

async function sdkWorld(bytes) {
  const source =
      '#DEFINE\nM2PLANE model\n#OBJECT FILE POS PRI DISP COLOR\nmodel authored 3,4 42 1 123\n#START\nmodel m2body idle\nmodel play\nmodel time 7\nnext WAIT\n#WAIT\n',
    game = memoryGame({ 'model.fes': new TextEncoder().encode(source) }),
    factories = new Map();
  game.width = 320;
  game.height = 240;
  const world = {
    profile: 'sdk-4.01-engine-2.6.1.74',
    game,
    images: new ImageStore(game),
    objects: new NativeObjects(),
    runtime: { handles: new NativeHandles(), services: {}, register() {} },
    base: (record) => ({
      message: ([, message]) => {
        if (message === 3) {
          record.destroyRequested = true;
          return undefined;
        }
        throw new Error(`Unimplemented test base message ${message}`);
      },
    }),
    registerNativeFeature: (name, factory) => factories.set(name, factory),
    nativeTaskID: (id) => id,
    resolveTaskID: (id) => id,
    async getNativeFeature(name) {
      return this.engine.features.get(name) || factories.get(name)(this.engine, this);
    },
  };
  world.engine = await NativeEngineProcess.open({ profile: world.profile, bytes });
  world.registerNativeFeature(
    'data-buffers',
    (engine) => new NativeDataBuffers(engine, { handles: world.runtime.handles }),
  );
  installNativeGraphics(world);
  installNativeBitmapMemory(world);
  installNativeM2(world);
  world.objects.register(34, () => ({ message() {}, snapshot: () => ({}), restore() {} }));
  world.player = new FESPlayer(game, world.images);
  world.player.nativeM2 = world.m2FES;
  world.close = async () => {
    for (const id of [...world.objects.objects.keys()].reverse()) await world.objects.release(id);
    await world.engine.close();
  };
  return world;
}

test(
  'the original SDK M2 placeholder preserves unhandled output and executes its FES driver without a driver DLL',
  {
    skip: !process.env.CATSYSTEM2_SDK_EXE,
  },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      first = await sdkWorld(bytes);
    let second;
    try {
      const id = await first.objects.create({ kind: 54, name: 'Authored M2' }),
        task = first.graphics.get(id),
        p = first.engine.process,
        out = p.allocate(4),
        context = { nativePointer: true, nativeResult: out };
      assert.equal(p.load(task.pointer), 0x992c98);
      p.store(out, 0x12345678);
      assert.equal(await task.message([99, 498, 0, 0], context), undefined);
      assert.equal(p.load(out), 0x12345678);
      assert.equal(context.nativeUnhandled, true);
      assert.equal(first.engine.features.has('m2'), false);
      const destruction = [];
      first.objects.register(0, (_record) => ({
        message: ([, message]) => {
          if (message === 3) destruction.push('notification');
        },
        close() {
          destruction.push(p.allocations.has(task.pointer) ? 'parent alive' : 'parent freed');
        },
        snapshot: () => ({}),
        restore() {},
      }));
      const nativeChild = await first.objects.create({
          kind: 54,
          parent: id,
          name: 'Native child',
        }),
        childPointer = first.graphics.get(nativeChild).pointer;
      await first.objects.create({ kind: 0, parent: id, name: 'Child' });
      p.free(out);
      await first.objects.release(id);
      assert.deepEqual(destruction, ['notification', 'parent alive']);
      assert.equal(p.allocations.has(childPointer), false);
      first.owner = await first.objects.create({ kind: 34 });
      await first.player.start('model');
      first.player.root.runtimeID = first.owner;
      const object = first.player.root.byKey.get('model');
      await first.m2FES.update(first.player.root, object);
      assert.equal(first.objects.objects.get(object.nativeTaskID).kind, 54);
      assert.equal(p.string(object.nativeObjectPointer + 740), 'authored');
      assert.equal(p.load(object.nativeObjectPointer + 1544), 123);
      assert.equal(p.load(object.nativeObjectPointer + 192), 0xffffffff);
      for (const verb of [
        'm2eff',
        'm2att',
        'm2fspeed',
        'm2prmscale',
        'm2iner',
        'm2enable_blink',
        'm2enable_lip',
        'm2splay',
        'm2draw',
        'm2enable_eff',
        'play',
        'time',
      ])
        assert.equal(await first.m2FES.command(first.player.root, object, verb, ['7']), 0);
      await first.m2FES.command(first.player.root, object, 'm2body', ['walk']);
      assert.equal(p.string(object.nativeObjectPointer + 996), 'walk');
      const state = {
        engine: first.engine.snapshot(),
        graphics: first.graphics.snapshot(),
        objects: first.objects.snapshot(),
        player: first.player.snapshot(),
      };
      second = await sdkWorld(bytes);
      for (const [name] of state.engine.features) await second.getNativeFeature(name);
      second.engine.restore(state.engine);
      await second.graphics.restore(state.graphics);
      await second.objects.restore(state.objects);
      await second.player.restore(state.player);
      const restored = second.player.root.byKey.get('model');
      second.player.root.runtimeID = first.owner;
      await second.m2FES.update(second.player.root, restored);
      assert.equal(second.engine.process.string(restored.nativeObjectPointer + 996), 'walk');
      assert.equal(second.engine.process.string(restored.nativeObjectPointer + 740), 'authored');
      assert.equal(second.engine.features.has('m2'), false);
    } finally {
      await second?.close();
      await first.close();
    }
  },
);
