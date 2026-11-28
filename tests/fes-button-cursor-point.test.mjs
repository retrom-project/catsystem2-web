// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESObjectCollection } from '../src/native/fes-object-collection.mjs';
import { createFESTypedObject } from '../src/native/fes-object-factory.mjs';
import { initializeFESImage } from '../src/native/fes-image-driver.mjs';
import { setFESButtonLock, fesPositionQuery } from '../src/native/fes-image-model.mjs';
import { fesButtonCursorPoint } from '../src/native/fes-button-navigation.mjs';

function fixture(type) {
  const collection = new FESObjectCollection({
      create: (identity) => createFESTypedObject(identity, { initializeImage: initializeFESImage }),
    }),
    [parent] = collection.create(type, 'parent', 1, { scalar: true }),
    [button] = collection.create('BUTTON', 'button', 1, { scalar: true }),
    instance = { collection, objects: collection.objects, byKey: collection.byKey };
  collection.graph.bind(button, parent);
  Object.assign(button, { x: 10.5, y: 20.25, baseX: 2, baseY: 3 });
  return { collection, parent, button, instance };
}
test('locked BUTTON cursor uses captured XY plus the current PLANE position minus local base, independently of getpos2', () => {
  const { parent, button, instance } = fixture('PLANE');
  Object.assign(parent, { x: 100.25, y: 200.5, baseX: 10, baseY: 20, planeProperty: 0 });
  assert.deepEqual(fesButtonCursorPoint(instance, button), [98, 197]);
  setFESButtonLock(instance, button, 1);
  assert.deepEqual(button.lockedPosition, [8.5, 17.25]);
  Object.assign(button, { x: 999, y: -999 });
  Object.assign(parent, { x: 130.25, y: 250.5 });
  // Native: trunc_f32(8.5+(130.25-10)), trunc_f32(17.25+(250.5-20)).
  assert.deepEqual(fesButtonCursorPoint(instance, button), [128, 247]);
  assert.deepEqual([...fesPositionQuery(instance, button, 'image')], [8, 17, 0]);
});
test('locked BUTTON cursor accepts a CPLANE parent with its eligible ancestor and local base', () => {
  const { collection, parent, button, instance } = fixture('CPLANE'),
    [ancestor] = collection.create('PLANE', 'ancestor', 1, { scalar: true });
  Object.assign(ancestor, { x: 70.25, y: 100 });
  Object.assign(parent, { x: 30.5, y: -50.5, baseX: 5, baseY: 6, planeProperty: 0 });
  collection.graph.bind(parent, ancestor);
  setFESButtonLock(instance, button, 1);
  assert.deepEqual(button.lockedPosition, [8.5, 17.25]);
  Object.assign(button, { x: -777, y: 888 });
  // Native parent pos2=(100.75,49.5), offset=(95.75,43.5), then captured XY.
  assert.deepEqual(fesButtonCursorPoint(instance, button), [104, 60]);
  assert.deepEqual([...fesPositionQuery(instance, button, 'image')], [8, 17, 0]);
});
