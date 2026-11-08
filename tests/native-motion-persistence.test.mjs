// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, floatBits } from '../src/kcs.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeMotionRegistry, nativeMotion } from '../src/native/motion.mjs';
import { nativeMotionPersistence } from '../src/native/motion-persistence.mjs';
import { MotionManager } from '../src/motion/manager.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { u32 } from './helpers.mjs';
function fixture(profile) {
  const bytes = Uint8Array.from([
      21,
      0x13,
      ...u32(0x80000000 + MOTION_ABI.pos),
      0x13,
      ...u32(0x80000000 + MOTION_ABI.registers),
      59,
    ]),
    script = {
      name: 'authored.kcs',
      recordName: 'authored.kcs',
      body: new Binary(bytes),
      codeSize: bytes.length,
      data: new Uint8Array(64),
      stackSize: 1024,
    },
    handles = new NativeHandles(),
    library = {
      load: async () => script,
      manager: (base) => new MotionManager({ profile, base, loadScript: async () => script }),
    };
  handles.registerType('global-file', {
    snapshot: (file) => file.snapshot(),
    restore: (state) => {
      const file = new NativeGlobalFile();
      file.restore(state);
      return file;
    },
  });
  const motion = new NativeMotionRegistry({ handles, library }),
    machine = new KCSMachine({ ...script, data: new Uint8Array(4096) }),
    services = { handles, motion },
    call = (id, args) =>
      id === 0x183 || id === 0x184
        ? nativeMotionPersistence(id, args, machine, services)
        : nativeMotion(id, args, machine, services);
  return { handles, motion, machine, call };
}
for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74'])
  test(`${profile} CTS motion envelopes restore an independent authored animation after source disposal`, async () => {
    const before = fixture(profile),
      source = before.motion.create(73);
    before.machine.writeString('authored.kcs', 32);
    before.machine.store(64, floatBits(42));
    const motion = (await before.call(0x217, [source, 32, 64, 1, 0, 0, 9, 7])).value;
    await before.call(0x131, [source, motion, 100]);
    const checkpoint = (await before.call(0x13b, [source, 150])).value,
      file = before.handles.add('global-file', new NativeGlobalFile(91));
    assert.deepEqual(before.call(0x183, [file, 7, checkpoint]), { control: 1, value: 1 });
    before.handles.get(checkpoint, 'motion-checkpoint').bytes.fill(0);
    await before.call(0x13d, [checkpoint]);
    before.motion.release(source);
    assert.throws(() => before.motion.get(source), /released/);
    const disk = await before.handles.get(file, 'global-file').file(),
      after = fixture(profile),
      loaded = after.handles.add('global-file', await NativeGlobalFile.fromFile(disk)),
      target = after.motion.create(74),
      restored = await after.call(0x184, [loaded, 7, target, 300]),
      record = after.handles.get(restored.value, 'motion-checkpoint'),
      targetManager = after.motion.get(target),
      entry = [...targetManager.records.values()][0];
    assert.equal(record.owner, target);
    assert.equal(entry.startTick, 250);
    assert.equal(entry.group, 9);
    assert.equal(entry.instance.delay, 7);
    after.handles.get(loaded, 'global-file').clear();
    targetManager.update(300);
    assert.equal(motionVector(targetManager.working, MOTION_ABI.pos)[0], 42);
    const fresh = fixture(profile);
    fresh.handles.restore(after.handles.snapshot());
    assert.equal(fresh.handles.get(restored.value, 'motion-checkpoint').owner, target);
    assert.equal((await fresh.motion.get(target)).records.size, 1);
    await after.call(0x13d, [restored.value]);
    assert.ok(fresh.handles.get(restored.value, 'motion-checkpoint').bytes.length > 8);
    const empty = after.handles.add('global-file', new NativeGlobalFile());
    after.handles.get(empty, 'global-file').write(9, new Uint8Array());
    const detached = after.call(0x184, [empty, 9, 0, 123]).value;
    assert.equal(after.handles.get(detached, 'motion-checkpoint').owner, 0);
    assert.equal(after.handles.get(detached, 'motion-checkpoint').bytes.length, 0);
    await after.call(0x13d, [detached]);
    assert.deepEqual(after.call(0x183, [0, 1, 2]), { control: 1, value: 0 });
    assert.deepEqual(after.call(0x184, [empty, 999, 0, 1]), { control: 1, value: 0 });
  });
