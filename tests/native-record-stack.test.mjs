// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeRecordStack, nativeRecordStack } from '../src/native/record-stack.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import {
  recordStackSpecifications,
  recordStackOperations,
  recordStackFixture,
  stepRecordStackModel,
} from './fixtures/record-stack-fixture.mjs';

test('fixed-record stack complete states match 836 original-wrapper comparisons', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/record-stack-golden.json', import.meta.url)),
    ),
    hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let index = 0;
  for (const specification of recordStackSpecifications) {
    const fixture = recordStackFixture();
    for (const operation of recordStackOperations(specification)) {
      const model = stepRecordStackModel(fixture, operation);
      if (model.setup) continue;
      const expected = golden.cases[index++];
      assert.deepEqual(
        { specification, operation },
        { specification: expected.specification, operation: expected.operation },
      );
      assert.equal(
        hash({ reply: model.reply, state: model.state }),
        expected.hash,
        JSON.stringify({ specification, operation }),
      );
    }
  }
  assert.equal(index, golden.cases.length);
});

test('rejected VM pointer grows a full record stack before returning zero', () => {
  const f = recordStackFixture(),
    services = { handles: f.handles },
    handle = nativeRecordStack(0x35f, [3, 1], f.machine, services).value;
  f.memory.set([1, 2, 3]);
  assert.deepEqual(nativeRecordStack(0x361, [handle, 0], f.machine, services), {
    control: 1,
    value: 1,
  });
  const stack = f.handles.get(handle, 'record-stack');
  assert.deepEqual(nativeRecordStack(0x361, [handle, 0xffffffff], f.machine, services), {
    control: 1,
    value: 0,
  });
  assert.equal(stack.capacity, 2);
  assert.equal(stack.count, 1);
  f.memory.fill(0xa5);
  assert.deepEqual(nativeRecordStack(0x362, [handle, 0], f.machine, services), {
    control: 1,
    value: 1,
  });
  assert.deepEqual([...f.memory.subarray(0, 4)], [1, 2, 3, 0xa5]);
});

test('copy preserves popped records and replaces the complete capacity layout', () => {
  const source = new NativeRecordStack(3, 2),
    destination = new NativeRecordStack(1, 7);
  source.push(Uint8Array.of(1, 2, 3));
  source.push(Uint8Array.of(4, 5, 6));
  source.pop(new Uint8Array(3));
  destination.copy(source);
  assert.deepEqual(destination.snapshot(), source.snapshot());
  assert.deepEqual([...destination.data], [1, 2, 3, 4, 5, 6]);
  destination.data[5] = 255;
  assert.equal(source.data[5], 6);
  source.copy(source);
  assert.deepEqual([...source.data], [1, 2, 3, 4, 5, 6]);
});

test('record-stack handles restore full inactive bytes and retain type checks', () => {
  const before = recordStackFixture(),
    services = { handles: before.handles },
    handle = nativeRecordStack(0x35f, [4, 2], before.machine, services).value,
    stack = before.handles.get(handle, 'record-stack');
  stack.data.set([1, 2, 3, 4, 5, 6, 7, 8]);
  stack.count = 1;
  const after = recordStackFixture();
  after.handles.restore(before.handles.snapshot());
  assert.deepEqual(after.handles.get(handle, 'record-stack').snapshot(), stack.snapshot());
  assert.deepEqual(nativeRecordStack(0x360, [handle], after.machine, { handles: after.handles }), {
    control: 2,
  });
  assert.throws(() => after.handles.get(handle, 'record-stack'), /released/);
  const wrong = after.handles.add('another-type', {});
  assert.throws(
    () => nativeRecordStack(0x363, [wrong], after.machine, { handles: after.handles }),
    /expected record-stack/,
  );
});

test('zero-byte records and null stacks preserve original control behavior', () => {
  const f = recordStackFixture(),
    services = { handles: f.handles },
    handle = nativeRecordStack(0x35f, [0, 0], f.machine, services).value;
  for (let i = 0; i < 3; i++)
    assert.equal(nativeRecordStack(0x361, [handle, 0], f.machine, services).value, 1);
  assert.equal(nativeRecordStack(0x363, [handle], f.machine, services).value, 3);
  assert.equal(nativeRecordStack(0x362, [handle, 0], f.machine, services).value, 1);
  for (const id of [0x361, 0x362])
    assert.equal(nativeRecordStack(id, [0, 0], f.machine, services).value, 0);
  assert.deepEqual(nativeRecordStack(0x364, [0, handle], f.machine, services), { control: 2 });
  assert.equal(nativeRecordStack(0x35e, [], f.machine, services), undefined);
  assert.equal(nativeRecordStack(0x35f, [1, 1], f.machine, {}), undefined);
  assert.throws(() => nativeRecordStack(0x35f, [1], f.machine, services), /expects 2 arguments/);
});

for (const profile of ['rebellions-jp-engine-2.6.1.63', 'grisaia-jp-engine-2.6.1.23'])
  test(`${profile} record-stack GCALLs preserve fixed records through a fresh World`, () =>
    verifyRecordStack(profile));

async function verifyRecordStack(profile) {
  const world = await dataWorld(profile);
  let fresh;
  const call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
  try {
    const source = (await call(world, 863, [4, 1])).value,
      target = (await call(world, 863, [2, 1])).value;
    world.main.machine.store(256, 0x89abcde1);
    assert.deepEqual(await call(world, 865, [source, 256]), { control: 1, value: 1 });
    world.main.machine.store(256, 0x12345678);
    assert.deepEqual(await call(world, 865, [source, 256]), { control: 1, value: 1 });
    assert.deepEqual(await call(world, 868, [target, source]), { control: 2 });
    fresh = await dataWorld(profile, undefined, { initialize: false });
    await fresh.restore(structuredClone(world.snapshot()));
    for (const [remaining, expected] of [
      [2, 0x12345678],
      [1, 0x89abcde1],
    ]) {
      assert.deepEqual(await call(fresh, 867, [target]), { control: 1, value: remaining });
      assert.deepEqual(await call(fresh, 866, [target, 512]), { control: 1, value: 1 });
      assert.equal(fresh.main.machine.load(512), expected);
    }
    assert.deepEqual(await call(fresh, 866, [target, 512]), { control: 1, value: 0 });
    assert.equal(fresh.main.machine.load(512), 0x89abcde1);
    assert.deepEqual(await call(fresh, 864, [target]), { control: 2 });
    assert.deepEqual(await call(world, 867, [source]), { control: 1, value: 2 });
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
