// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  markFESObjectDirty,
  setFESEnabled,
  setFESGraphicalDisplay,
  setFESGraphicalPriority,
  setFESGraphicalPosition,
  fesGraphicalPosition,
  setFESGraphicalSize,
  fesGraphicalSize,
  fesGraphicalBase,
  setFESImageClip,
  setFESImagePlane,
  setFESImageParentPlane,
  writeFESQuery,
} from '../src/native/fes-common-model.mjs';
import { NativeVariableBank } from '../src/native/bank.mjs';
const oracle = JSON.parse(
  await readFile(new URL('./fixtures/fes-common-model.json', import.meta.url), 'utf8'),
);
function instance(objects) {
  return { objects, byKey: new Map(objects.map((o) => [o.key, o])) };
}
function observed(object, fields) {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, object[key]]));
}

test('typed FES graphical state and query writes match the independently captured original commands', () => {
  for (const profile of oracle.profiles) {
    const s = instance(structuredClone(profile.initial));
    for (const sample of profile.samples) {
      for (const before of sample.before)
        Object.assign(s.byKey.get(before.key), structuredClone(before));
      const o = s.byKey.get(sample.target),
        values = sample.args.map(Number),
        globals = [...sample.globalsBefore.words];
      let dirty = false,
        result = null;
      const targets =
        sample.context.index === -1 ? sample.before.map((before) => s.byKey.get(before.key)) : [o];
      for (const target of targets) {
        switch (sample.verb) {
          case 'enable':
            setFESEnabled(target, values[0] ?? 0);
            break;
          case 'disp':
            setFESGraphicalDisplay(s, target, values[0] ?? 1);
            break;
          case 'pri':
            setFESGraphicalPriority(s, target, values[0]);
            break;
          case 'pos':
            setFESGraphicalPosition(s, target, values);
            break;
          case 'size':
            setFESGraphicalSize(target, values[0] ?? 0, values[1] ?? 0);
            break;
          case 'clip':
            setFESImageClip(s, target, ...values);
            break;
          case 'refparentpl':
            setFESImageParentPlane(target, values[0] ?? 0);
            break;
          case 'pl':
            setFESImagePlane(s, target, sample.args[0], 0);
            break;
          case 'getpos':
            result = fesGraphicalPosition(s, target);
            break;
          case 'getpos2':
            result = fesGraphicalPosition(s, target, true);
            break;
          case 'getsize':
            result = fesGraphicalSize(target);
            break;
          case 'getbase':
            result = fesGraphicalBase(target);
            break;
          default:
            assert.fail(`Unexpected observed verb ${sample.verb}`);
        }
      }
      writeFESQuery(result, values, (index, value) => {
        globals[index - 10] = value >>> 0;
        dirty = true;
      });
      for (const expected of sample.after)
        assert.deepEqual(
          observed(s.byKey.get(expected.key), expected),
          expected,
          `${profile.profile}/${sample.label}`,
        );
      assert.deepEqual(
        globals,
        sample.globalsAfter.words,
        `${profile.profile}/${sample.label}/globals`,
      );
      assert.equal(
        dirty,
        sample.globalsAfter.dirty,
        `${profile.profile}/${sample.label}/bank dirty`,
      );
    }
  }
});

test('image definition priority changes the retained-entry key while ordinary requests preserve it', () => {
  const object = { key: 'image', nativeType: 2, pri: -1, renderID: -1 },
    s = instance([object]);
  setFESGraphicalPriority(s, object, 30, true);
  assert.deepEqual([object.pri, object.oldPriority, object.renderID], [50, -1, 30]);
  object.priorityChanged = false;
  setFESGraphicalPriority(s, object, 50);
  assert.equal(object.priorityChanged, false);
  setFESGraphicalPriority(s, object, 2147483640);
  assert.deepEqual([object.pri, object.oldPriority, object.renderID], [-2147483636, 50, 30]);
});

test('dirty propagation follows lifetime parents independently of display-plane association', () => {
  const parent = { key: 'parent', handle: 1 },
    child = { key: 'child', handle: 2, parentHandle: 1 },
    grandchild = { key: 'grandchild', parent: 'child' },
    associated = { key: 'associated', planeReference: { name: 'parent', index: 0 } },
    s = instance([parent, child, grandchild, associated]);
  markFESObjectDirty(s, parent);
  assert.deepEqual(
    s.objects.map((o) => Boolean(o.dirty)),
    [true, true, true, false],
  );
  parent.parent = 'grandchild';
  assert.throws(() => markFESObjectDirty(s, parent), /parent cycle/);
});

test('size setter gates differ from query gates and auxiliary sizes preserve their own mode', () => {
  const table = { nativeType: 16, width: -1, height: -1 };
  assert.equal(setFESGraphicalSize(table, 10, 20), false);
  assert.deepEqual([...fesGraphicalSize(table)], [-1, -1, 0]);
  const m2 = { nativeType: 33 };
  assert.equal(setFESGraphicalSize(m2, 10, 20), false);
  assert.equal(fesGraphicalSize(m2), null);
  const image = {
    nativeType: 2,
    width: 10,
    height: 20,
    auxiliarySizeMode: 1,
    auxiliaryWidth: 8,
    auxiliaryHeight: 9,
  };
  setFESGraphicalSize(image, 10, 20);
  assert.equal(image.sizeDirty, undefined);
  assert.deepEqual([image.auxiliaryWidth, image.auxiliaryHeight], [8, 9]);
  image.auxiliarySizeMode = 0;
  setFESGraphicalSize(image, 10, 20);
  assert.deepEqual([image.auxiliaryWidth, image.auxiliaryHeight], [-6, 12]);
});

test('query outputs only skip exact minus one and reuse borrowed buffers across restored semantic records', () => {
  const object = {
      nativeType: 4,
      key: 'plane',
      x: 7.75,
      y: -8.75,
      z: 9.75,
      baseX: 4.75,
      baseY: -5.75,
      baseZ: 6.75,
    },
    s = instance([object]),
    position = fesGraphicalPosition(s, object),
    bank = new NativeVariableBank();
  bank.initialize(16);
  assert.strictEqual(fesGraphicalPosition(s, object), position);
  writeFESQuery(position, [-1, -2], (index, value) => bank.set(index, value));
  assert.equal(
    bank.dirty,
    true,
    'original word setter marks dirty even for out-of-range uint32 indices',
  );
  assert.deepEqual([...bank.words], new Array(16).fill(0));
  const restored = structuredClone(s.objects),
    fresh = instance(restored);
  assert.deepEqual([...fesGraphicalPosition(fresh, restored[0])], [7, -8, 9]);
  assert.deepEqual([...fesGraphicalBase(restored[0])], [4, -5, 6]);
});
