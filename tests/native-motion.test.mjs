// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, floatBits } from '../src/kcs.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeMotionRegistry, nativeMotion } from '../src/native/motion.mjs';
import { MotionManager } from '../src/motion/manager.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { decodeMotionRecords, encodeMotionRecords } from '../src/motion/checkpoint.mjs';
import { kcsProgram, u32 } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76';
function setup(handles = new NativeHandles(), selectedProfile = profile) {
  const bytes = new Uint8Array([
    21,
    0x13,
    ...u32(0x80000000 + MOTION_ABI.pos),
    0x13,
    ...u32(0x80000000 + MOTION_ABI.registers),
    59,
  ]);
  const script = {
    name: 'authored',
    body: new Binary(bytes),
    codeSize: bytes.length,
    data: new Uint8Array(16),
    stackSize: 1024,
  };
  const library = {
    load: async () => script,
    manager: (base, speed) =>
      new MotionManager({ profile: selectedProfile, base, speed, loadScript: async () => script }),
  };
  const registry = new NativeMotionRegistry({ handles, library });
  const machine = new KCSMachine({ ...script, data: new Uint8Array(4096) }, {});
  const call = (id, args = []) => nativeMotion(id, args, machine, { motion: registry });
  return { registry, handles, machine, call, script };
}

test('a suspended MOT lookup reads undeclared arguments from the original guest stack', async () => {
  let useManager;
  const managerReady = new Promise((resolve) => {
    useManager = resolve;
  });
  const motion = {
    with(handle, lookup) {
      assert.equal(handle, 15);
      return managerReady.then(lookup);
    },
  };
  const machine = {
    sp: 100,
    load(address) {
      assert.equal(address, 104);
      return 7;
    },
  };
  const result = nativeMotion(0x136, [15], machine, { motion });
  machine.sp = 500;
  useManager({ busy: (group) => group === 7 });
  assert.deepEqual(await result, { control: 1, value: 1 });
});

test('main MOT resources retain typed handles and explicit zero/null control replies', async () => {
  const { call, handles } = setup();
  const h = (await call(0x126)).value;
  assert.equal(handles.get(h, 'motion-manager').manager.profile, profile);
  assert.deepEqual(await call(0x137, [0]), { control: 1, value: 0 });
  assert.deepEqual(await call(0x128, [0]), { control: 2 });
  assert.throws(() => call(0x137, [h + 99]), /Invalid or released/);
  await call(0x127, [h]);
  assert.throws(() => call(0x137, [h]), /Invalid or released/);
  assert.equal(nativeMotion(0x800, [], null, { motion: {} }), undefined);
});

test('main MOT base/working state transfers retain all nine native fields and raw DWORD channels', async () => {
  const { call, machine, registry } = setup(),
    h = (await call(0x126)).value;
  const pointers = [64, 96, 128, 160, 240, 256, 272, 288, 304];
  for (let i = 0; i < 3; i++)
    for (const [n, address] of pointers.entries())
      machine.store(address + i * 4, floatBits(n * 10 + i + 0.5));
  for (let i = 0; i < 16; i++) machine.store(pointers[3] + i * 4, floatBits(i + 0.25));
  const input = [h, ...pointers];
  input[6] = 0xaa112233;
  input[9] = 0;
  await call(0x12b, input);
  const manager = registry.get(h);
  assert.deepEqual(motionVector(manager.base, MOTION_ABI.vram), [0.5, 1.5, 2.5]);
  assert.deepEqual(motionVector(manager.base, MOTION_ABI.pos), [20.5, 21.5, 22.5]);
  const output = pointers.map((p) => p + 512);
  await call(0x12c, [h, ...output]);
  assert.equal(machine.load(output[5]), 0xaa112233);
  assert.equal(machine.load(output[8]), 0);
  for (let i = 0; i < 16; i++) assert.equal(machine.load(output[3] + i * 4), floatBits(i + 0.25));
  await call(0x133, [h, 100, 0]);
  await call(0x12e, [h, ...output]);
  assert.equal(machine.load(output[2]), floatBits(20.5));
});

test('main MOT add copies registers/extra data, applies group, delay and the manager flags separately', async () => {
  const { call, machine, registry } = setup(),
    h = (await call(0x126)).value;
  machine.writeString('authored', 16);
  machine.store(64, floatBits(90));
  machine.bytes(80, 3).set([1, 2, 3]);
  await call(0x24a, [h, 0x11223344]);
  const motion = (await call(0x217, [h, 16, 64, 1, 80, 3, 7, 5])).value;
  machine.store(64, floatBits(900));
  machine.bytes(80, 3).fill(9);
  const manager = registry.get(h),
    instance = manager.records.get(motion).instance;
  assert.equal(instance.delay, 5);
  assert.equal(instance.view.getUint32(MOTION_ABI.flags, true), 0x11223344);
  assert.equal((await call(0x136, [h, 7])).value, 1);
  assert.equal((await call(0x136, [h, 6])).value, 0);
  assert.equal((await call(0x133, [h, 100, 1])).value, 0);
  assert.equal((await call(0x133, [h, 100, 0])).value, 1);
  assert.equal(motionVector(manager.working, MOTION_ABI.pos)[0], 0);
  await call(0x133, [h, 105, 0]);
  assert.equal(motionVector(manager.working, MOTION_ABI.pos)[0], 90);
  assert.deepEqual(
    [...instance.machine.bytes(instance.view.getUint32(MOTION_ABI.extraData, true), 3)],
    [1, 2, 3],
  );
  await call(0x138, [h, motion]);
  assert.equal(instance.skip, true);
  await call(0x12a, [h, 7]);
  assert.equal((await call(0x137, [h])).value, 0);
});

test('native MOT records have exact field offsets, retain raw registers, and reconstruct start ticks', async () => {
  const { call, machine, registry } = setup(),
    h = (await call(0x126)).value;
  machine.writeString('authored', 16);
  machine.store(64, 0x7fc01234);
  const motion = (await call(0x217, [h, 16, 64, 1, 0, 0, 9, 3])).value;
  await call(0x131, [h, motion, 100]);
  const manager = registry.get(h),
    bytes = encodeMotionRecords(manager, 115),
    view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 1116);
  assert.equal(view.getUint32(0, true), 1116);
  assert.equal(view.getUint32(4, true), 1);
  assert.equal(view.getUint32(8 + 68, true), 9);
  assert.equal(view.getUint32(8 + 72, true), 0x7fc01234);
  assert.equal(view.getUint32(8 + 1100, true), 15);
  assert.equal(view.getUint32(8 + 1104, true), 3);
  assert.equal(decodeMotionRecords(bytes)[0].name, 'authored');
  await registry.restoreRecords(h, bytes, 200);
  const restored = [...manager.records.values()][0];
  assert.equal(restored.startTick, 185);
  assert.equal(restored.instance.delay, 3);
  assert.equal(restored.instance.view.getUint32(MOTION_ABI.registers, true), 0x7fc01234);
  assert.equal(restored.handle, motion + 1);
  const bad = bytes.slice();
  new DataView(bad.buffer).setUint32(8, 1107, true);
  assert.throws(() => decodeMotionRecords(bad), /record size/);
});

test('main MOT checkpoints and VM resource checkpoints restore without sharing mutable managers', async () => {
  const { call, machine, registry, handles } = setup(),
    h = (await call(0x126)).value;
  machine.writeString('authored', 16);
  machine.store(64, floatBits(42));
  await call(0x130, [h, 16, 64, 1, 0, 0, 4]);
  await call(0x133, [h, 10, 0]);
  const checkpoint = (await call(0x13b, [h, 10])).value;
  const state = handles.snapshot(),
    second = setup();
  second.handles.restore(state);
  const restored = await second.registry.get(h);
  assert.notEqual(restored, registry.get(h));
  assert.equal((await second.call(0x137, [h])).value, 1);
  assert.equal(motionVector(restored.working, MOTION_ABI.pos)[0], 42);
  assert.deepEqual(
    second.handles.get(checkpoint, 'motion-checkpoint').bytes,
    handles.get(checkpoint, 'motion-checkpoint').bytes,
  );
  await second.call(0x13c, [checkpoint, 20]);
  const data = decodeMotionRecords(second.handles.get(checkpoint, 'motion-checkpoint').bytes);
  assert.equal(data[0].elapsed, 10);
  await second.call(0x13d, [checkpoint]);
  assert.throws(() => second.call(0x13c, [checkpoint, 20]), /released/);
});

test('63 MOT checkpoints use CP932 records and the live second word of a one-word call', async () => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    world = await dataWorld(profile, { 'motion.kcs': kcsProgram([[59]]) });
  let fresh;
  const call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
  try {
    const m = world.main.machine,
      handle = (await call(world, 294, [])).value;
    m.writeString('motion', 256);
    m.store(512, 0x7fc01234);
    m.bytes(520, 3).set([1, 2, 3]);
    const added = (await call(world, 304, [handle, 256, 512, 1, 520, 3, 9])).value,
      { manager } = world.runtime.handles.get(handle, 'motion-manager');
    manager.records.get(added).startTick = 100;
    m.store(m.sp, handle);
    m.store(m.sp + 4, 125);
    const checkpoint = (await call(world, 315, [handle])).value;
    const { bytes } = world.runtime.handles.get(checkpoint, 'motion-checkpoint'),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    assert.equal(bytes.length, 1087);
    assert.deepEqual(
      [...bytes.subarray(12, 23)],
      [109, 111, 116, 105, 111, 110, 46, 107, 99, 115, 0],
    );
    assert.deepEqual(
      [0, 4, 8, 44, 48, 1072, 1076, 1080].map((offset) => view.getUint32(offset, true)),
      [1087, 1, 1079, 9, 0x7fc01234, 3, 25, 0],
    );
    assert.deepEqual([...bytes.subarray(1084)], [1, 2, 3]);
    fresh = await dataWorld(profile, { 'motion.kcs': kcsProgram([[59]]) }, { initialize: false });
    await fresh.restore(structuredClone(world.snapshot()));
    const restoredMachine = fresh.main.machine;
    restoredMachine.store(restoredMachine.sp, checkpoint);
    restoredMachine.store(restoredMachine.sp + 4, 132);
    const refresh = call(fresh, 316, [checkpoint]);
    restoredMachine.push(checkpoint);
    assert.deepEqual(await refresh, { control: 1, value: 1 });
    assert.equal(restoredMachine.pop(), checkpoint);
    assert.equal(
      decodeMotionRecords(
        fresh.runtime.handles.get(checkpoint, 'motion-checkpoint').bytes,
        profile,
      )[0].elapsed,
      32,
    );
    assert.equal(view.getUint32(1076, true), 25);
    assert.deepEqual(await call(fresh, 317, [checkpoint]), { control: 2 });
    assert.equal(world.runtime.handles.get(checkpoint, 'motion-checkpoint').bytes, bytes);
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});

test('an unprofiled MOT registry retains its current task cleanup policy across restore', async () => {
  const first = setup(),
    owned = nativeMotion(0x126, [], first.machine, { motion: first.registry, owner: 11 }).value,
    other = nativeMotion(0x126, [], first.machine, { motion: first.registry, owner: 12 }).value,
    unowned = first.registry.create(),
    restored = setup();
  restored.handles.restore(first.handles.snapshot());
  assert.equal(restored.handles.get(owned, 'motion-manager').owner, 11);
  restored.registry.releaseOwner(11);
  assert.throws(() => restored.registry.get(owned), /released/);
  assert.equal((await restored.registry.get(other)).profile, profile);
  assert.equal((await restored.registry.get(unowned)).profile, profile);
  restored.registry.releaseOwner(11);
  restored.registry.releaseOwner(12);
  assert.throws(() => restored.registry.get(other), /released/);
});

test('main MOT math exposes native interpolation, rounding and cubic record preparation', () => {
  const { machine } = setup();
  assert.deepEqual(nativeMotion(0x13e, [0, 100, 0, 4, 1].map(floatBits), machine), {
    control: 1,
    value: floatBits(25),
  });
  assert.equal(nativeMotion(0x13f, [floatBits(-2.5)], machine).value | 0, -2);
  const points = [
    [0, 0],
    [1, 1],
    [2, 4],
  ];
  points.forEach(([x, y], i) => {
    machine.store(i * 20, floatBits(x));
    machine.store(i * 20 + 4, floatBits(y));
  });
  assert.deepEqual(nativeMotion(0x140, [0, 3], machine), { control: 2 });
  // Golden words from independently authored points executed by frozen native
  // 659A60. Preserve its residual cubic term and last-row unscaled coefficient.
  const expected = [
    0, 0, 0, 1065353216, 0, 1065353216, 1065353216, 1073741824, 1065353216, 3003121664, 1073741824,
    1082130432, 1082130432, 1051372202, 3003121664,
  ];
  assert.deepEqual(
    expected.map((_, i) => machine.load(i * 4)),
    expected,
  );
});

for (const selectedProfile of [profile, 'sdk-4.01-engine-2.6.1.74']) {
  test(`${selectedProfile} MOT refresh preserves capacity, name padding and the unused tail`, async () => {
    const { call, machine, registry, handles, script } = setup(
        new NativeHandles(),
        selectedProfile,
      ),
      owner = (await call(0x126)).value,
      manager = registry.get(owner);
    script.recordName = 'authored-long-name.kcs';
    machine.writeString('authored', 16);
    machine.bytes(80, 20).fill(0xb7);
    await call(0x130, [owner, 16, 0, 0, 80, 20, 4]);
    const checkpoint = (await call(0x13b, [owner, 10])).value,
      record = handles.get(checkpoint, 'motion-checkpoint'),
      original = record.bytes.slice(),
      capacity = original.length;
    manager.clear();
    await call(0x13c, [checkpoint, 20]);
    assert.equal(record.bytes.length, capacity);
    assert.equal(new DataView(record.bytes.buffer).getUint32(0, true), 8);
    assert.deepEqual(record.bytes.subarray(8), original.subarray(8));
    script.recordName = '動.kcs';
    await call(0x130, [owner, 16, 0, 0, 0, 0, 7]);
    await call(0x13c, [checkpoint, 30]);
    assert.equal(record.bytes.length, capacity);
    const decoded = decodeMotionRecords(record.bytes, selectedProfile);
    assert.equal(decoded[0].name, '動.kcs');
    assert.deepEqual(decoded[0].extra, new Uint8Array());
    const used = new DataView(record.bytes.buffer).getUint32(0, true);
    assert.deepEqual(record.bytes.subarray(used), original.subarray(used));
    const nameEnd = selectedProfile.startsWith('sdk-') ? 12 + 7 : 12 + 12;
    const nameLimit = selectedProfile.startsWith('sdk-') ? 44 : 76;
    assert.deepEqual(
      record.bytes.subarray(nameEnd, nameLimit),
      original.subarray(nameEnd, nameLimit),
    );
  });
}

for (const selectedProfile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(`${selectedProfile} World MOT handlers retain owner, current services and guarded admission across cold restore`, async () => {
    const world = await dataWorld(selectedProfile),
      call = (owner, id, args = []) =>
        owner.runtime.native(
          'main',
          id,
          args,
          owner.main.machine,
          owner.main,
          owner.runtime.scheduler,
        );
    let fresh;
    try {
      Object.defineProperty(world.runtime.services, 'fallbackProbe', {
        enumerable: true,
        get() {
          throw new Error('Registered MOT used fallback service preparation');
        },
      });
      const handle = (await call(world, 294)).value;
      assert.equal(world.runtime.handles.get(handle, 'motion-manager').owner, world.main.id);
      assert.deepEqual(await call(world, 311, [handle]), { control: 1, value: 0 });
      assert.deepEqual(await call(world, 319, [floatBits(3.2)]), { control: 1, value: 3 });
      const original = world.runtime.services.motion,
        replacement = Object.create(original);
      let visits = 0;
      replacement.with = (...args) => {
        visits++;
        return original.with(...args);
      };
      world.runtime.services.motion = replacement;
      assert.deepEqual(await call(world, 310, [handle, 7]), { control: 1, value: 0 });
      assert.equal(visits, 1);
      world.runtime.services.motion = null;
      assert.throws(() => call(world, 311, [handle]), /Unsupported/);
      world.runtime.services.motion = replacement;
      for (const key of world.runtime.handlers.keys()) {
        const [table, number] = key.split(':'),
          id = Number(number);
        if (world.runtime.tables.get(table)[id].status === 'unknown')
          assert.throws(
            () =>
              world.runtime.native(
                table,
                id,
                [],
                world.main.machine,
                world.main,
                world.runtime.scheduler,
              ),
            /Unsupported/,
          );
      }
      fresh = await dataWorld(selectedProfile, {}, { initialize: false });
      await fresh.restore(structuredClone(world.snapshot()));
      assert.equal(fresh.runtime.handles.get(handle, 'motion-manager').owner, fresh.main.id);
      const restoredRegistry = fresh.runtime.services.motion,
        pending = call(fresh, 311, [handle]);
      fresh.runtime.services.motion = {
        with() {
          throw new Error('Later calls must use the new service');
        },
      };
      assert.deepEqual(await pending, { control: 1, value: 0 });
      assert.throws(() => call(fresh, 311, [handle]), /Later calls must use the new service/);
      fresh.runtime.services.motion = restoredRegistry;
      assert.notEqual(fresh.runtime.services.motion, replacement);
      const next = (await call(fresh, 294)).value;
      assert.equal(fresh.runtime.handles.get(next, 'motion-manager').owner, fresh.main.id);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
