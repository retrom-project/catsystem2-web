// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const start = [
    [43, 0x44, 0],
    [38, 64],
    [37, 0],
    [37, 0],
    [37, 256],
    [43, 0x42, 12],
    [38, 68],
    [37, 17],
    [37, [0x14, 64]],
    [37, 288],
    [43, 0x42, 12],
    [38, 72],
    [37, 0],
    [37, [0x14, 72]],
    [37, 320],
    [43, 0x42, 12],
    [38, 76],
  ],
  idle = start.reduce((pc, op) => pc + 1 + (op.length - 1) * 5, 0),
  program = kcsProgram(
    [...start, [43, 0x41, 0], [41, idle]],
    [
      [256, 'Sibling'],
      [288, 'UnderWater'],
      [320, 'First orphan'],
    ],
  ),
  word = (value) => ({ control: 1, value });

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} rejected native registration preserves allocation, ordered routes and stale branch faults`,
    { skip: !process.env[variable] },
    async () => {
      const executable = new Uint8Array(await readFile(process.env[variable])),
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
          owner.runtime.native('main', id, args, owner.main.machine, owner.main),
        create = (owner, kind, target, name) => {
          owner.main.machine.writeString(name, 128);
          return call(owner, 0x42, kind, target, 128);
        },
        records = (owner) => owner.objects.objects,
        named = (owner, name) => [...records(owner).values()].find((entry) => entry.name === name);
      let fresh, stale;
      try {
        world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
        world.main = await world.spawnScript('main.kcs');
        const caller = world.main.id,
          callerID = world.nativeTaskID(caller),
          top = records(world).get(world.root);
        top.effectiveFrame = 203;
        top.pausedFrames = 11;
        records(world).get(caller).effectiveFrame = 23;
        await world.runtime.scheduler.execute(world.main);
        const vm = world.main.machine,
          sibling = vm.load(68),
          under = vm.load(72),
          actor = named(world, 'UnderWater'),
          siblingRecord = named(world, 'Sibling'),
          memory = await world.getNativeFeature('task-memory'),
          p = world.nativeEngine.process;
        assert.equal(actor.parent, caller);
        assert.equal(actor.effectiveFrame, 192);
        assert.equal(p.load(actor.implementation.pointer + 12), await memory.pointer(caller));
        assert.equal(world.resolveTaskID(sibling, caller), siblingRecord.id);

        const first = vm.load(76),
          unreachable = named(world, 'First orphan'),
          pointer = await memory.pointer(unreachable.id);
        assert.equal(unreachable.parent, null);
        assert.equal(unreachable.detached, true);
        assert.equal(unreachable.namespace, world.root);
        assert.equal(p.load(pointer + 12), 0);
        assert.equal(p.load(pointer + 100), 192);
        assert.equal(actor.nativeTaskRoutes.size, 0);
        assert.equal(records(world).get(caller).nativeTaskRoutes.get(first), actor.id);
        assert.equal(top.nativeTaskRoutes.get(first), caller);
        assert.deepEqual(await call(world, 0x4d, first), word(1));
        assert.deepEqual(await call(world, 0x4a, first), word(0xffffffff));
        assert.deepEqual(await call(world, 0x4b, 1), word(first));

        const rawCreate = async (owner, target, name) => {
          const engine = owner.nativeEngine,
            p = engine.process,
            sender = records(owner).get(actor.id),
            address = sender.implementation.pointer,
            input = p.allocate(32, true),
            out = p.allocate(4, true);
          try {
            p.write(input, new TextEncoder().encode(name + '\0'));
            p.store(out, NATIVE_RESULT_SENTINEL);
            const control = await engine.call(
              p.load(p.load(address) + 16),
              [under, target, 1, 0, input, 0, out],
              address,
              { task: sender.id },
            );
            return [control, p.load(out)];
          } finally {
            p.free(input);
            p.free(out);
          }
        };
        const [handled, secondPointer] = await rawCreate(world, under, 'PE orphan'),
          second = named(world, 'PE orphan');
        assert.equal(handled, 1);
        assert.equal(second.nativeID, first);
        assert.equal(second.detached, true);
        assert.equal(secondPointer, await memory.pointer(second.id));
        assert.equal(p.load(secondPointer + 12), 0);
        assert.notEqual(secondPointer, pointer);
        assert.deepEqual(await rawCreate(world, callerID, 'PE duplicate'), [1, 0]);
        assert.deepEqual(
          await create(world, 0, callerID, 'Duplicate'),
          word(NATIVE_RESULT_SENTINEL),
        );
        assert.equal(named(world, 'Duplicate').nativeID, first);
        assert.equal(named(world, 'Duplicate').detached, true);
        assert.deepEqual(await create(world, 0, sibling, 'Local child'), word(first));
        const local = named(world, 'Local child');
        assert.equal(local.parent, siblingRecord.id);
        assert.equal(local.detached, undefined);
        assert.equal(world.resolveTaskID(first, siblingRecord.id), local.id);
        assert.equal(world.resolveTaskID(first, caller), null);
        assert.deepEqual(await create(world, 0, 0, 'Top duplicate'), word(NATIVE_RESULT_SENTINEL));
        assert.deepEqual(await create(world, 0, 0x1234, 'Missing parent'), word(first));
        const [routed, missingPointer] = await rawCreate(world, 0x1234, 'PE missing parent');
        assert.equal(routed, 0);
        assert.equal(p.load(missingPointer + 4), first);
        assert.equal(p.load(missingPointer + 12), 0);

        const visits = [0, 0],
          table = p.load(actor.implementation.pointer),
          detach = [8, 12].map((offset, i) =>
            p.beforeInstruction(p.load(table + offset), 'observe aliased native frame', () => {
              if (p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0 === actor.implementation.pointer)
                visits[i]++;
            }),
          );
        try {
          await world.tick();
        } finally {
          detach.forEach((remove) => remove());
        }
        assert.deepEqual(visits, [2, 2]);
        assert.equal(p.load(pointer + 100), 192);

        fresh = make();
        await fresh.restore(structuredClone(world.snapshot()));
        const rp = fresh.nativeEngine.process,
          restored = named(fresh, 'First orphan');
        assert.equal(restored.id, unreachable.id);
        assert.equal(restored.detached, true);
        assert.equal(rp.load(pointer + 12), 0);
        assert.equal(rp.load(pointer + 100), 192);
        assert.equal(fresh.resolveTaskID(first, siblingRecord.id), local.id);
        assert.equal(fresh.resolveTaskID(first, caller), null);
        assert.deepEqual(await create(fresh, 0, under, 'Restored orphan'), word(first));
        assert.equal(named(fresh, 'Restored orphan').detached, true);

        await fresh.objects.release(actor.id);
        assert.equal(rp.allocations.has(actor.implementation.pointer), false);
        assert.equal(records(fresh).get(caller).nativeTaskRoutes.get(under), null);
        assert.deepEqual(await call(fresh, 0x4d, first), word(1));
        assert.throws(() => fresh.resolveTaskID(first, caller), /crosses a released branch/);
        await assert.rejects(create(fresh, 0, 0, 'Blocked factory'), /crosses a released branch/);
        await assert.rejects(fresh.tick(), /crosses a released branch/);

        stale = make();
        await stale.restore(structuredClone(fresh.snapshot()));
        const reused = await stale.objects.create({ kind: 0, name: 'Reused internal identity' });
        assert.equal(reused, actor.id);
        assert.throws(() => stale.resolveTaskID(first, caller), /crosses a released branch/);
        assert.equal(stale.resolveTaskID(first, siblingRecord.id), local.id);
        assert.equal(p.allocations.has(actor.implementation.pointer), true);
      } finally {
        await stale?.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
}
