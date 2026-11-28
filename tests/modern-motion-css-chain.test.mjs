// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/modern-motion-css-golden.json', import.meta.url)),
  ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const build of golden.builds)
  test(`${build.version} complete Main MOT capture/refresh and CSS save/load retain bytes and reconstruct a fresh owner`, async () => {
    const files = {
        'startup.xml': new TextEncoder().encode(build.xml),
        'loose/owned.kcs': Buffer.from(build.program, 'base64'),
      },
      saved = new Map();
    let world = await modernParticleMessageWorld(build.profile, files),
      caller = world.main,
      previous = new Uint8Array(8192),
      initial;
    const storage = () => {
      world.storage.read = async (name) => saved.get(name)?.slice() ?? null;
      world.storage.write = async (name, bytes) => {
        saved.set(name, bytes.slice());
        return true;
      };
    };
    storage();
    world.runtime.handles.next = 0x10000;
    async function cold() {
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
      await world.close({ flushFiles: false });
      world = await modernParticleMessageWorld(build.profile, files, { initialize: false });
      storage();
      await world.restore(state);
      caller = world.main;
    }
    const mask = (bytes) => {
      const copy = new Uint8Array(bytes);
      copy.fill(0, ...build.unknownFilenamePadding);
      return copy;
    };
    try {
      for (const row of build.rows) {
        const machine = (caller.machine = new KCSMachine(
          await readKCS(
            kcsProgram([
              [43, row.id, row.args.length * 4],
              ...Array.from({ length: 22 }, () => [59]),
            ]),
          ),
          { native: (id, args, m) => world.runtime.scheduler.native(caller, id, args, m) },
          world.runtime.scheduler.shared,
        ));
        machine.memory.set(previous);
        for (const write of row.writes)
          machine.writeBytes(write.address, Buffer.from(write.bytes, 'base64'));
        assert.equal(hash(machine.memory), row.beforeLocalSha256, row.label + ' before');
        machine.store(4096, 0xa17a29c5);
        row.args.forEach((word, i) => machine.store(4100 + i * 4, word));
        machine.sp = 4100 + row.args.length * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        assert.equal(hash(machine.memory), row.localSha256, row.label + ' complete Main local');
        for (const key of ['pc', 'sp', 'fp'])
          assert.equal(machine[key], row[key], row.label + ' ' + key);
        if (row.id === 315 || row.id === 316) {
          const handle = row.id === 315 ? row.result : row.args[0],
            bytes = world.runtime.handles.get(handle, 'motion-checkpoint').bytes,
            expected = build.snapshots[row.id === 315 ? 0 : 1];
          assert.equal(bytes.length, expected.capacity);
          assert.deepEqual(mask(bytes), mask(Buffer.from(expected.bytes, 'base64')));
          if (row.id === 315) initial = bytes.slice();
          else assert.deepEqual(bytes.subarray(8), initial.subarray(8));
        }
        if (row.label === 'save-CSS-file') {
          const actual = await NativeGlobalFile.fromFile(saved.get('motion-test.css')),
            original = await NativeGlobalFile.fromFile(
              Buffer.from(build.files['motion-test.css'], 'base64'),
            );
          assert.equal(actual.tag, original.tag);
          assert.equal(actual.records.length, 2);
          for (let i = 0; i < 2; i++) {
            assert.equal(actual.records[i].id, original.records[i].id);
            assert.deepEqual(mask(actual.records[i].bytes), mask(original.records[i].bytes));
          }
        }
        if (row.label === 'read-record-and-restore-actual-MOT') {
          const manager = await world.runtime.services.motion.get(row.args[2]),
            record = [...manager.records.values()][0];
          assert.equal(record.startTick, build.restored.start);
          assert.equal(record.group, build.restored.group);
          assert.equal(record.instance.delay, build.restored.delay);
          assert.deepEqual(
            record.instance.shared.subarray(156, 1180),
            new Uint8Array(Buffer.from(build.restored.registers, 'base64')),
          );
          assert.equal(record.instance.machine.load(0x80000000 + 1184), build.restored.extraLength);
        }
        if (row.label === 'update-restored-target') {
          const manager = await world.runtime.services.motion.get(row.args[0]);
          assert.deepEqual(
            manager.readBank(true, 0, 12),
            new Uint8Array(Buffer.from(build.restored.position, 'base64')),
          );
        }
        if (row.label === 'read-empty-detached') {
          const envelope = world.runtime.handles.get(row.result, 'motion-checkpoint');
          assert.equal(envelope.owner, 0);
          assert.equal(envelope.bytes.length, build.detached.capacity);
          assert.deepEqual(mask(envelope.bytes), mask(Buffer.from(build.detached.bytes, 'base64')));
        }
        previous = machine.memory.slice();
        if (['save-CSS-file', 'read-record-and-restore-actual-MOT'].includes(row.label))
          await cold();
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const build of golden.builds)
  test(`${build.version} current KCS loads the original saved CSS bytes and retains its opaque envelope after the file is cleared`, async () => {
    const source = new Uint8Array(Buffer.from(build.files['motion-test.css'], 'base64')),
      world = await modernParticleMessageWorld(build.profile, {
        'startup.xml': new TextEncoder().encode(build.xml),
        'loose/owned.kcs': Buffer.from(build.program, 'base64'),
      });
    world.storage.read = async (name) => (name === 'motion-test.css' ? source : null);
    try {
      const caller = world.main;
      async function call(id, args) {
        const machine = (caller.machine = new KCSMachine(
          await readKCS(kcsProgram([[43, id, args.length * 4], [59]])),
          {
            native: (number, words, m) => world.runtime.scheduler.native(caller, number, words, m),
          },
          world.runtime.scheduler.shared,
        ));
        machine.writeString('motion-test.css', 64);
        args.forEach((word, i) => machine.store(4100 + i * 4, word));
        machine.sp = 4100 + args.length * 4;
        caller.status = 'ready';
        caller.io = null;
        caller.waiting = null;
        await world.runtime.scheduler.execute(caller);
        return machine.load(4100);
      }
      const file = await call(247, [64]),
        target = await call(294, []),
        envelope = await call(388, [file, 7, target, 300]);
      assert(file && target && envelope);
      const copy = world.runtime.handles.get(envelope, 'motion-checkpoint');
      assert.deepEqual(copy.bytes, new Uint8Array(Buffer.from(build.snapshots[0].bytes, 'base64')));
      assert.equal(await call(389, [file]), 1);
      assert.equal(world.runtime.handles.get(file, 'global-file').records.length, 0);
      assert.deepEqual(copy.bytes, new Uint8Array(Buffer.from(build.snapshots[0].bytes, 'base64')));
      assert.equal(await call(307, [target, 300, 0]), 1);
      assert.deepEqual(
        (await world.runtime.services.motion.get(target)).readBank(true, 0, 12),
        new Uint8Array(Buffer.from(build.restored.position, 'base64')),
      );
      await call(317, [envelope]);
      await call(246, [file]);
      await call(295, [target]);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
