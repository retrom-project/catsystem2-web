// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createFESImageSelector,
  setFESImageID,
  setFESImageTable,
  fesImageFrameID,
  fesImagePosition,
  fesPlanePosition,
  fesPositionQuery,
  setFESButtonLock,
} from '../src/native/fes-image-model.mjs';
const oracle = JSON.parse(
  await readFile(new URL('./fixtures/fes-image-model.json', import.meta.url), 'utf8'),
);

function selectorSnapshot(state) {
  const { ids, ...fields } = state;
  return { ...fields, idTable: ids };
}
function make(values, kind, type, key) {
  return {
    nativeType: type,
    key,
    x: values[0],
    y: values[1],
    z: kind === 'plane' ? values[2] : 0,
    ...(kind === 'image'
      ? { imageOriginX: values[2], imageOriginY: values[3], baseX: values[4], baseY: values[5] }
      : {}),
  };
}
function fixture(sample) {
  const object = make(sample.values, sample.kind, sample.kind === 'image' ? 2 : 4, 'subject'),
    objects = [object];
  let child = object;
  for (const [index, input] of sample.parents.entries()) {
    const kind = [1, 2].includes(input.type) ? 'image' : 'plane',
      parent = make(input.values, kind, input.type, `parent${index}`);
    child.parent = parent.key;
    child = parent;
    objects.push(parent);
  }
  return { object, instance: { objects, byKey: new Map(objects.map((o) => [o.key, o])) } };
}

test('FES image selector snapshots match both original command streams, including unsigned IDs and invalid table indices', () => {
  for (const profile of oracle.profiles) {
    const state = createFESImageSelector();
    for (const sample of profile.selector) {
      if (sample.command) {
        const [verb, args] = sample.command;
        if (verb === 'setid') setFESImageID(state, args[0]);
        else setFESImageTable(state, ...args);
      }
      assert.deepEqual(selectorSnapshot(state), sample.state, profile.profile);
    }
    assert.equal(fesImageFrameID(state), 102);
    const restored = structuredClone(state);
    setFESImageID(restored, 3);
    assert.deepEqual(restored, state);
  }
  const direct = createFESImageSelector();
  setFESImageID(direct, -1);
  assert.equal(fesImageFrameID(direct), 0xffffffff);
});

test('FES typed coordinate parents, float32 evaluation order and CVTT query outputs match the original engines', () => {
  for (const profile of oracle.profiles)
    for (const sample of profile.geometry) {
      const { instance, object } = fixture(sample);
      assert.deepEqual(
        [...fesPositionQuery(instance, object, sample.kind)],
        sample.result,
        profile.profile + '/' + sample.label,
      );
      const restored = structuredClone(instance.objects),
        fresh = { objects: restored, byKey: new Map(restored.map((o) => [o.key, o])) };
      assert.deepEqual([...fesPositionQuery(fresh, restored[0], sample.kind)], sample.result);
      assert.deepEqual(instance.objects, restored, 'queries do not mutate authored model fields');
    }
});

test('PL association, parent base/scale/rotation and unrelated raw types do not replace coordinate-parent rules', () => {
  const sample = { kind: 'plane', values: [3, 4, 5], parents: [{ type: 3, values: [6, 7, 8] }] },
    { instance, object } = fixture(sample),
    parent = instance.objects[1];
  Object.assign(parent, { baseX: 900, scaleX: 4, rotation: 90 });
  object.plane = 'unrelated';
  assert.deepEqual([...fesPlanePosition(instance, object)], [9, 11, 13]);
  parent.nativeType = 37;
  assert.deepEqual([...fesPlanePosition(instance, object)], [3, 4, 5]);
  object.parentHandle = parent.handle = 19;
  parent.nativeType = 3;
  assert.deepEqual([...fesPlanePosition(instance, object)], [9, 11, 13]);
  parent.parent = object.key;
  assert.throws(() => fesPlanePosition(instance, object), /parent cycle/);
});

test('FES position queries reuse their typed buffers and have no serialized pointer or cache state', () => {
  const sample = { kind: 'image', values: [3, 4, 5, 6, 1, 2], parents: [] },
    { instance, object } = fixture(sample),
    position = fesImagePosition(instance, object),
    words = fesPositionQuery(instance, object, 'image');
  for (let frame = 0; frame < 5; frame++) {
    object.x = frame;
    assert.strictEqual(fesImagePosition(instance, object), position);
    assert.strictEqual(fesPositionQuery(instance, object, 'image'), words);
  }
  assert.deepEqual(
    Object.keys(object).sort(),
    ['nativeType', 'key', 'x', 'y', 'z', 'imageOriginX', 'imageOriginY', 'baseX', 'baseY'].sort(),
  );
});

test('BUTTON lock captures once, preserves raw lock words and separates input queries from live image position', () => {
  for (const profile of oracle.profiles) {
    const sample = {
        kind: 'image',
        values: [3, 4, 5, 6, 1, 2],
        parents: [{ type: 2, values: [20.25, 30.75, 2, 3, 1, 4] }],
      },
      { instance, object } = fixture(sample),
      parent = instance.objects[1];
    object.nativeType = 6;
    for (const [index, record] of profile.lock.entries()) {
      if (index === 1) {
        object.x = 200;
        object.y = 300;
      }
      if (index === 2)
        Object.assign(parent, {
          x: -4,
          y: 10,
          imageOriginX: 0,
          imageOriginY: 0,
          baseX: 0,
          baseY: 0,
        });
      if (record.command) setFESButtonLock(instance, object, record.command[1][0]);
      assert.equal(object.buttonLock, record.lock);
      assert.deepEqual(object.lockedPosition, record.snapshot);
      assert.deepEqual(
        [...fesPositionQuery(instance, object, 'image')],
        record.result,
        profile.profile + '/' + record.label,
      );
      const restored = structuredClone(instance.objects),
        fresh = { objects: restored, byKey: new Map(restored.map((o) => [o.key, o])) };
      assert.deepEqual([...fesPositionQuery(fresh, restored[0], 'image')], record.result);
      if (index === 1)
        assert.deepEqual(
          [...fesImagePosition(instance, object)],
          [225.25, 333.75, 0],
          'image drawing remains live while its input query is locked',
        );
    }
  }
});
