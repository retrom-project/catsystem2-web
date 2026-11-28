// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-motion-knowledge-golden.json', import.meta.url)),
);
const G = 0x80000000;
for (const build of golden.builds)
  test(`${build.version} Main-loaded MOTs initialize only written bytes and preserve opaque copies through cold`, async () => {
    const inputs = {
      'frame.kcs': kcsProgram(Array.from({ length: 33 }, () => [59])),
      'startup.xml': new TextEncoder().encode(
        '<?xml version="1.0" encoding="Shift_JIS"?><document><INT><int00><int>mot</int><ext>kcs</ext><dir>loose</dir><name>mot</name></int00><int01><name>kcs</name><ext>kcs</ext></int01></INT></document>',
      ),
      ...Object.fromEntries(
        build.cases.map((c) => [
          'loose/' + c.name + '.kcs',
          new Uint8Array(Buffer.from(c.program, 'base64')),
        ]),
      ),
    };
    let world = await modernParticleMessageWorld(build.profile, inputs),
      caller = await world.spawnScript('frame.kcs');
    async function cold() {
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await modernParticleMessageWorld(build.profile, inputs, { initialize: false });
      await world.restore(state);
      caller = world.runtime.scheduler.tasks.get(caller.id);
    }
    async function call(id, args = [], name) {
      const machine = (caller.machine = new KCSMachine(
        await readKCS(
          kcsProgram([[43, id, args.length * 4], ...Array.from({ length: 22 }, () => [59])]),
        ),
        { native: (n, words, m) => world.runtime.scheduler.native(caller, n, words, m) },
        world.runtime.scheduler.shared,
      ));
      if (name) machine.writeString(name, 64);
      machine.store(4096, 0xa17a29c5);
      args.forEach((word, i) => machine.store(4100 + i * 4, word));
      machine.sp = 4100 + args.length * 4;
      caller.status = 'ready';
      caller.io = null;
      caller.waiting = null;
      await world.runtime.scheduler.execute(caller);
      return machine;
    }
    const checkControls = (machine, row) => {
      for (const key of ['pc', 'sp', 'fp']) assert.equal(machine[key], row[key]);
      assert.equal(machine.load(4096), 0xa17a29c5);
      if (row.control === 1 && row.result !== 'manager')
        assert.equal(machine.load(4100), row.result);
    };
    try {
      for (const c of build.cases) {
        let m = await call(294),
          handle = m.load(4100);
        checkControls(m, c.controls[0]);
        let manager = await world.runtime.services.motion.get(handle);
        assert(manager.workingKnown.every((value) => value === 0));
        assert.throws(() => manager.readBank(true), /uninitialized working/);
        m = await call(303, [handle]);
        checkControls(m, c.controls[1]);
        assert.throws(() => manager.readBank(false), /uninitialized base/);
        m = await call(304, [handle, 64, 0, 0, 0, 0, 7], 'mot/' + c.name + '.kcs');
        checkControls(m, c.controls[2]);
        const motion = m.load(4100);
        assert.equal(motion, 1);
        await cold();
        m = await call(307, [handle, 10, 0]);
        checkControls(m, c.controls[3]);
        manager = await world.runtime.services.motion.get(handle);
        const instance = manager.records.get(motion).instance,
          known = new Uint8Array(144);
        for (const [offset, size] of c.known) {
          known.fill(1, offset, offset + size);
          assert.deepEqual(
            manager.readBank(true, offset, size),
            new Uint8Array(Buffer.from(c.working, 'base64').subarray(offset, offset + size)),
          );
        }
        assert.deepEqual(manager.workingKnown ?? new Uint8Array(144).fill(1), known);
        assert.deepEqual(instance.objectKnowledge() ?? new Uint8Array(144).fill(1), known);
        const expected = new Uint8Array(Buffer.from(c.local, 'base64'));
        if (c.name === 'opaque-copy-local') {
          expected.fill(0, 256, 320);
          const current = instance.machine.memory.slice();
          current.fill(0, 256, 320);
          assert.deepEqual(current, expected);
          assert.throws(() => instance.machine.load(256), /uninitialized memory/);
        } else assert.deepEqual(instance.machine.memory, expected);
        for (const key of ['pc', 'sp', 'fp']) assert.equal(instance.machine[key], c.motionVm[key]);
        await cold();
        const fresh = await world.runtime.services.motion.get(handle),
          vm = fresh.records.get(motion).instance.machine;
        assert.deepEqual(fresh.workingKnown ?? new Uint8Array(144).fill(1), known);
        if (c.name === 'partial-write-read') {
          assert.equal(vm.load(G + 24), 0x41200000);
          assert.throws(() => vm.load(G + 28), /uninitialized memory/);
          vm.store(G + 28, 0x3f800000);
          assert.equal(vm.load(G + 28), 0x3f800000);
          vm.copyBytes(G + 32, G + 24, 16);
          assert.equal(vm.load(G + 32), 0x41200000);
          assert.equal(vm.load(G + 36), 0x3f800000);
          assert.throws(() => vm.load(G + 40), /uninitialized memory/);
          const state = fresh.records.get(motion).instance.snapshot();
          fresh.records
            .get(motion)
            .instance.restore(await deserializeCheckpoint(await serializeCheckpoint(state)));
          assert.equal(vm.load(G + 32), 0x41200000);
          assert.throws(() => vm.load(G + 40), /uninitialized memory/);
        }
        if (c.name === 'opaque-copy-local') {
          assert.throws(() => vm.load(256), /uninitialized memory/);
          vm.store(256, 123);
          assert.equal(vm.load(256), 123);
          assert.throws(() => vm.load(260), /uninitialized memory/);
          const block = vm.allocate(16);
          vm.copyBytes(block, G, 16);
          assert.throws(() => vm.load(block), /uninitialized memory/);
          vm.store(block, 0xabcd, 2);
          assert.equal(vm.load(block, 2), 0xabcd);
          assert.throws(() => vm.load(block), /uninitialized memory/);
          const state = fresh.records.get(motion).instance.snapshot();
          fresh.records
            .get(motion)
            .instance.restore(await deserializeCheckpoint(await serializeCheckpoint(state)));
          assert.equal(vm.load(block, 2), 0xabcd);
          assert.throws(() => vm.load(block), /uninitialized memory/);
          assert.equal(vm.free(block), true);
          vm.snapshot();
        }
        if (known.every((value) => value === 1)) {
          const output = [512, 528, 544, 560, 624, 640, 656, 672, 688];
          m = await call(302, [handle, ...output]);
          assert.equal(m.sp, 4100);
          const fields = [
            [0, 12],
            [12, 12],
            [24, 12],
            [36, 64],
            [100, 12],
            [112, 4],
            [116, 12],
            [128, 12],
            [140, 4],
          ];
          fields.forEach(([offset, size], i) =>
            assert.deepEqual(m.bytes(output[i], size), fresh.readBank(true, offset, size)),
          );
        } else {
          await assert.rejects(
            call(302, [handle, 512, 528, 544, 560, 624, 640, 656, 672, 688]),
            /uninitialized working/,
          );
        }
        m = await call(295, [handle]);
        checkControls(m, c.controls[4]);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
