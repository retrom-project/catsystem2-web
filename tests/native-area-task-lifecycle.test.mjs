// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const areaProgram = (kind, name) => {
  const target = [37, [0x14, 68]],
    start = [
      [43, 0x44, 0],
      [38, 64],
      [37, kind],
      [37, [0x14, 64]],
      [37, 256],
      [43, 0x42, 12],
      [38, 68],
      target,
      [37, 0xffffffff],
      [43, 0xc4, 8],
      target,
      [43, 0xc5, 4],
      target,
      [43, 0xc8, 4],
      [38, 72],
      target,
      [43, 0x43, 4],
      target,
      [43, 0x4a, 4],
      [38, 76],
    ],
    idle = start.reduce((pc, op) => pc + 1 + (op.length - 1) * 5, 0);
  return kcsProgram([...start, [43, 0x41, 0], [41, idle]], [[256, 'Authored ' + name]]);
};

const profiles = [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
];
for (const [kind, name, size, tables] of [
  [17, 'UnderWater', 0x84, [0x8cdc8c, 0x992f6c]],
  [22, 'Weather', 0xd4, [0x8cddb4, 0x993094]],
  [23, 'WipeCircle', 0xb8, [0x8cddd8, 0x9930b8]],
]) {
  for (const [index, [profile, variable]] of profiles.entries()) {
    test(
      `${profile} original ${name} retains unwritten query and removal messages across restore`,
      { skip: !process.env[variable] },
      async () => {
        const program = areaProgram(kind, name),
          executable = new Uint8Array(await readFile(process.env[variable])),
          make = () => {
            const game = memoryGame({ 'engine.exe': executable, 'main.kcs': program }),
              configuration = new NativeConfiguration({ profile }),
              random = new ParticleRandom();
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
          world = make(),
          call = (owner, id, ...args) =>
            owner.runtime.native('main', id, args, owner.main.machine, owner.main);
        let fresh;
        try {
          // This task has no device dependency. Start a real KCS tree with
          // the frozen executable mounted and no renderer startup.
          world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
          world.main = await world.spawnScript('main.kcs');
          await world.tick();
          const vm = world.main.machine,
            nativeID = vm.load(68),
            id = world.resolveTaskID(nativeID, world.main.id),
            record = world.objects.objects.get(id),
            pointer = record.implementation.pointer,
            p = world.nativeEngine.process,
            memory = await world.getNativeFeature('task-memory'),
            caller = await memory.pointer(world.main.id);
          assert.equal(p.load(pointer), tables[index]);
          assert.equal(p.allocations.get(pointer), size);
          assert.equal(p.load(pointer + 64), kind);
          assert.equal(vm.load(72), caller);
          assert.equal(vm.load(76), caller);
          assert.equal(Boolean(record.destroyRequested), false);
          assert.equal(world.nativeEngine.features.has('renderer'), false);

          const context = {};
          assert.equal(
            await world.sendNativeEngine(nativeID, world.main.id, 13, 0, 0, context),
            NATIVE_UNWRITTEN_WORD,
          );
          assert.equal(context.nativeRouted, true);
          assert.equal(context.nativeUnhandled, false);
          await world.tick();
          assert.equal(record.lastFrame, 0);
          assert.equal(p.load(pointer + 96), 0);
          assert.equal(p.load(pointer + 100), world.frame);
          const saved = p.read(pointer, size);

          fresh = make();
          await fresh.restore(structuredClone(world.snapshot()));
          const rp = fresh.nativeEngine.process,
            restored = fresh.objects.objects.get(id);
          assert.equal(restored.implementation.pointer, pointer);
          assert.deepEqual(rp.read(pointer, size), saved);
          assert.deepEqual(await call(fresh, 0x4a, nativeID), { control: 1, value: caller });
          assert.deepEqual(await call(fresh, 0x43, nativeID), { control: 2 });
          await fresh.tick();
          assert.equal(restored.lastFrame, 0);
          assert.equal(rp.load(pointer + 84), 0);
          assert.equal(rp.load(pointer + 96), 0);
          assert.equal(rp.load(pointer + 100), fresh.frame);
          assert.equal(fresh.resolveTaskID(nativeID, fresh.main.id), id);

          const base = await fresh.objects.create({ kind: 0, parent: fresh.main.id }),
            baseID = fresh.nativeTaskID(base);
          assert.deepEqual(await call(fresh, 0x4a, baseID), { control: 1, value: 0 });
          assert.deepEqual(await call(fresh, 0x43, baseID), { control: 2 });
          assert.equal(fresh.objects.objects.get(base).destroyRequested, true);
          await fresh.tick();
          assert.deepEqual(await call(fresh, 0x4a, baseID), { control: 1, value: 0xffffffff });
          assert.equal(await fresh.objects.destroy(id), true);
          await fresh.tick();
          assert.equal(fresh.objects.objects.has(id), false);
          assert.equal(rp.allocations.has(pointer), false);
          assert.equal(p.allocations.has(pointer), true);
        } finally {
          await fresh?.close({ flushFiles: false });
          await world.close({ flushFiles: false });
        }
      },
    );
  }
}
