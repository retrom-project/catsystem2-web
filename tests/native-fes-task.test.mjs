// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { nativeFES } from '../src/native/fes.mjs';
import { memoryGame, u32, kcsProgram } from './helpers.mjs';

function mainScript() {
  const code = Uint8Array.from([
    37,
    0x23,
    ...u32(8),
    43,
    0x23,
    ...u32(0xd1),
    0x23,
    ...u32(4),
    43,
    0x23,
    ...u32(0x41),
    0x23,
    ...u32(0),
    59,
  ]);
  return Uint8Array.from([
    ...[
      0x0053434b,
      2,
      0,
      52,
      code.length,
      52 + code.length,
      0,
      0,
      512,
      1024,
      52 + code.length,
      0,
      code.length * 2,
    ].flatMap(u32),
    ...deflateSync(code),
  ]);
}
function fixture(profile, extraFiles = {}) {
  const game = memoryGame({
      'main.kcs': mainScript(),
      'authored.fes': new TextEncoder().encode('#START\n\\0=19\nresult 0xfedcba98\nexit 7\n'),
      ...extraFiles,
    }),
    random = new ParticleRandom();
  return new NativeWorld({
    game,
    images: {},
    host: {},
    profile,
    random,
    configuration: new NativeConfiguration({ profile }),
    storage: {
      read: (name) => game.read(name),
      write: async () => true,
      remove: async () => true,
      stat: async () => null,
    },
    motionLibrary: new MotionLibrary(game, { profile, random }),
  });
}

for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74']) {
  test(`${profile} execfes allocates an independent private bank context for each child interpreter`, async () => {
    const world = fixture(profile, {
      'parent.fes': new TextEncoder().encode('#START\n\\0=19\nexecfes child 3\nnext WAIT\n#WAIT\n'),
      'child.fes': new TextEncoder().encode('#START\n\\1=\\0+100\nnext WAIT\n#WAIT\n'),
    });
    let restored;
    try {
      await world.initialize('main.kcs');
      const id = await world.objects.create({ kind: 34, parent: world.main.id }),
        parent = world.objects.objects.get(id).implementation;
      await parent.load('parent', world.main);
      await parent.tick();
      const childID = parent.player.root.childTaskID,
        child = world.objects.objects.get(childID).implementation,
        parentKey = parent.player.root.nativeVariableContextKey,
        childKey = child.player.root.nativeVariableContextKey;
      assert.notEqual(parentKey, childKey);
      assert.equal(parent.player.root.local(0), 19);
      assert.equal(child.player.root.local(0), 3);
      assert.equal(child.player.root.local(1), 103);
      parent.player.root.setLocal(0, 52);
      assert.equal(child.player.root.local(0), 3);
      restored = fixture(profile, {
        'parent.fes': await world.game.read('parent.fes'),
        'child.fes': await world.game.read('child.fes'),
      });
      await restored.restore(structuredClone(world.snapshot()));
      assert.equal(restored.objects.objects.get(id).implementation.player.root.local(0), 52);
      assert.equal(restored.objects.objects.get(childID).implementation.player.root.local(0), 3);
      await world.objects.release(childID);
      assert.equal(world.runtime.variableBank(world.main).context(childKey), null);
      assert.equal(parent.player.root.local(0), 52);
    } finally {
      await restored?.close();
      await world.close();
    }
  });
  test(`${profile} FES sound retains its Top receiver through task-tree destruction`, async () => {
    const world = fixture(profile, {
      'sound.fes': new TextEncoder().encode(
        '#DEFINE\nSOUND sound\n#OBJECT CHANNEL\nsound 0\n#START\nnext WAIT\n#WAIT\n',
      ),
    });
    try {
      await world.initialize('main.kcs');
      const id = await world.objects.create({ kind: 34, parent: world.main.id }),
        task = world.objects.objects.get(id).implementation;
      await world.sendEngine(id, world.main.id, 331, 0, world.main.context.variableBank);
      await task.loadSource('sound');
      const instance = task.player.root,
        object = instance.byKey.get('sound'),
        soundID = world.engineMessages.closestTop(id).implementation.sound,
        nativeID = world.nativeTaskID(soundID),
        state = world.fesSound.state(instance, object);
      assert.equal(task.player.nativeSoundTaskID, nativeID);
      assert.equal(task.snapshot().soundTaskID, nativeID);
      state.set('playOption', 1);
      const candidate = fixture(profile, { 'sound.fes': await world.game.read('sound.fes') });
      try {
        await candidate.restore(structuredClone(world.snapshot()));
        const restored = candidate.objects.objects.get(id).implementation;
        assert.equal(restored.player.nativeSoundTaskID, nativeID);
      } finally {
        await candidate.close();
      }
      await world.objects.release(soundID);
      await world.fesSound.destructionRequested(instance, object);
      await world.fesSound.close(instance, object);
      state.set('playing', 1);
      await assert.rejects(world.fesSound.busy(instance, object), /initialized 32-bit output/);
    } finally {
      await world.close();
    }
  });
  test(`${profile} FES start initializes before a missing or empty source fails with exit code -2`, async () => {
    const world = fixture(profile);
    await world.initialize('main.kcs');
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      record = world.objects.objects.get(id),
      call = (args) =>
        world.runtime.native(
          'main',
          0x1bf,
          args,
          world.main.machine,
          world.main,
          world.runtime.scheduler,
        );
    try {
      for (const source of ['', 'missing.fes']) {
        world.main.machine.writeString(source, 64);
        const reply = await call([world.nativeTaskID(id), 64]);
        assert.equal(reply.control, 2);
        assert.equal(record.exitCode, -2);
        assert.ok(record.implementation.player);
        assert.equal(record.implementation.player.root, null);
        assert.ok(
          world.runtime.variableBank(world.main).context(record.context.fesVariableContextKey),
        );
        assert.equal(
          await world.sendEngine(id, world.main.id, 340, 511, 0x89abcdef),
          NATIVE_UNWRITTEN_WORD,
        );
        assert.equal(await world.sendEngine(id, world.main.id, 341, 511), 0x89abcdef);
        const candidate = fixture(profile);
        try {
          await candidate.restore(structuredClone(world.snapshot()));
          assert.equal(await candidate.sendEngine(id, candidate.main.id, 341, 511), 0x89abcdef);
        } finally {
          await candidate.close();
        }
      }
      world.main.machine.writeString('authored.fes', 64);
      await call([world.nativeTaskID(id), 64]);
      assert.equal(record.exitCode, -1);
      assert.equal(record.implementation.player.root.local(0), 0);
      await world.sendEngine(id, world.main.id, 342, 0, 7);
      await record.implementation.tick();
      assert.equal(record.implementation.player.root.local(0), 0);
      await world.sendEngine(id, world.main.id, 342, 0, 0);
      await record.implementation.tick();
      assert.equal(record.implementation.player.root.local(0), 19);
      assert.equal(record.exitCode, 7);
      assert.equal(
        (await nativeFES(0x29b, [world.nativeTaskID(id)], world.main.machine, world.main, world))
          .value,
        0xfedcba98,
      );
      await nativeFES(0x29c, [world.nativeTaskID(id)], world.main.machine, world.main, world);
      assert.equal(
        (await nativeFES(0x29b, [world.nativeTaskID(id)], world.main.machine, world.main, world))
          .value,
        0,
      );
    } finally {
      await world.close();
    }
  });
  test(`${profile} FES context copies retain names and scalar/bulk messages use their distinct selection boundaries`, async () => {
    const world = fixture(profile);
    await world.initialize('main.kcs');
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      record = world.objects.objects.get(id),
      main = world.main,
      bank = world.runtime.variableBank(main),
      call = (native, args) => nativeFES(native, args, main.machine, main, world);
    try {
      const uninitialized = await world.sendEngine(id, main.id, 352, 0, 7);
      assert.equal(uninitialized, NATIVE_UNWRITTEN_WORD);
      main.machine.writeString('authored.fes', 64);
      await call(0x1bf, [world.nativeTaskID(id), 64]);
      const key = record.context.fesVariableContextKey,
        fes = bank.context(key);
      // This fixture's main initialized its bank after being loaded, so it
      // has no private context yet. A copy may not invent one.
      fes.words[0] = 9;
      await call(0x299, [world.nativeTaskID(id)]);
      assert.equal(fes.words[0], 9);
      bank.registerContext(main.id);
      const script = bank.context(main.id);
      script.words[0] = 0x10203040;
      script.names.set('authored-script-name', 17);
      fes.words[0] = 9;
      fes.names.set('authored-fes-name', 23);
      bank.selectContext(main.id);
      await call(0x299, [world.nativeTaskID(id)]);
      assert.equal(fes.words[0], 0x10203040);
      assert.deepEqual([...fes.names], [['authored-fes-name', 23]]);
      assert.equal(bank.selectedContext, main.id);
      fes.words[511] = 0xfedcba98;
      await call(0x29a, [world.nativeTaskID(id)]);
      assert.equal(script.words[511], 0xfedcba98);
      assert.deepEqual([...script.names], [['authored-script-name', 17]]);
      fes.words[0] = 19;
      script.words[0] = 0x12345678;
      const data = new Uint8Array(2048),
        view = new DataView(data.buffer),
        payload = { bytes: (_at, size) => data.subarray(0, size) };
      await world.sendEngine(id, main.id, 343, 2048, 1, { payload });
      assert.equal(view.getUint32(0, true), 0x12345678);
      assert.equal(bank.selectedContext, main.id);
      data.set([0xab, 0xcd, 0xef]);
      assert.equal(
        await world.sendEngine(id, main.id, 344, 3, 1, { payload }),
        NATIVE_UNWRITTEN_WORD,
      );
      assert.equal(script.words[0], 0x12efcdab);
      assert.equal(fes.words[0], 19);
      assert.equal(await world.sendEngine(id, main.id, 341, 0), 19);
      assert.equal(bank.selectedContext, key);
      main.machine.writeString('AuthoredValue', 128);
      await call(0x298, [world.nativeTaskID(id), 128, 0x34567890]);
      assert.equal(bank.getName('AuthoredValue'), 0x34567890);
      const context = {};
      assert.equal(
        await record.implementation.message([main.nativeID, 342, 0, 0], context),
        NATIVE_UNWRITTEN_WORD,
      );
      assert.equal(context.nativeUnhandled, true);
    } finally {
      await world.close();
    }
  });

  test(`${profile} FES image-data cache retains a new key once and preserves pointer ownership`, async () => {
    const world = fixture(profile);
    await world.initialize('main.kcs');
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      task = world.objects.objects.get(id).implementation,
      references = new Map([
        [4096, 1],
        [8192, 1],
      ]),
      buffers = {
        pointer: (handle) => ({ 10: 4096, 11: 8192 })[handle],
        retainPointer: (pointer) => references.set(pointer, references.get(pointer) + 1),
        releasePointer: (pointer) => references.set(pointer, references.get(pointer) - 1),
      };
    world.getNativeFeature = async (name) => {
      assert.equal(name, 'data-buffers');
      return buffers;
    };
    try {
      world.main.machine.writeString('AuthoredCachedImage', 64);
      for (const handle of [10, 10, 11])
        await nativeFES(
          0x2e2,
          [world.nativeTaskID(id), 64, handle],
          world.main.machine,
          world.main,
          world,
        );
      assert.deepEqual(
        [...references],
        [
          [4096, 2],
          [8192, 1],
        ],
      );
      assert.equal(await task.imageData('AuthoredCachedImage'), 4096);
      assert.deepEqual(task.snapshot().imageCache, [['AuthoredCachedImage', 4096]]);
      await world.objects.release(id);
      assert.deepEqual(
        [...references],
        [
          [4096, 1],
          [8192, 1],
        ],
      );
    } finally {
      await world.close();
    }
  });
  test(`${profile} FES execkcs shares its parent's live string bank and preserves borrowed ownership`, async () => {
    const world = fixture(profile, {
      'launch.fes': new TextEncoder().encode(
        '#START\nexeckcs child.kcs\nnext WAIT\n#WAIT\nwait 1\nnext WAIT\n',
      ),
      'child.kcs': kcsProgram(
        [
          [37, 801],
          [37, 128],
          [43, 0x115, 8],
          [37, 803],
          [37, 256],
          [43, 0x114, 8],
          [43, 0x41, 0],
          [59],
        ],
        [[256, 'written-by-child']],
      ),
    });
    await world.initialize('main.kcs');
    const mainBank = world.runtime.stringBank(world.main),
      id = await world.objects.create({ kind: 34, parent: world.main.id }),
      implementation = world.objects.objects.get(id).implementation;
    try {
      mainBank.set(801, 'AuthoredParentText');
      mainBank.dirty = false;
      await implementation.load('launch.fes', world.main);
      await implementation.tick();
      const root = implementation.player.root,
        child = world.runtime.scheduler.tasks.get(root.kcsTaskID),
        childRecord = world.objects.objects.get(child.id);
      assert.equal(childRecord.parent, id);
      assert.equal(child.context.stringBank, world.main.context.stringBank);
      assert.equal(child.machine.string(128), 'AuthoredParentText');
      assert.equal(world.runtime.stringBank(child), mainBank);
      assert.equal(implementation.player.strings[803], 'written-by-child');
      assert.equal(mainBank.dirty, true);
      await world.objects.release(child.id);
      assert.equal(
        world.runtime.handles.get(world.main.context.stringBank, 'string-bank'),
        mainBank,
      );
      assert.equal(mainBank.get(803), 'written-by-child');
    } finally {
      await world.close();
    }
  });
}
