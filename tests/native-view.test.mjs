// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeView } from '../src/native/view.mjs';

test('native view keeps virtual dimensions distinct and applies viewport, scale, window shift and integer truncation in order', () => {
  const view = new NativeView({
    virtualWidth: 800,
    virtualHeight: 600,
    clientWidth: 1600,
    clientHeight: 900,
    deviceOffset: [20.75, -11.25],
    deviceScale: 1.5,
    windowShift: [3, -2],
  });
  assert.deepEqual(view.virtualSize(), [800, 600]);
  assert.deepEqual(view.screenToVirtual(172, 99), { x: 48, y: 50, inside: true });
  assert.deepEqual(view.screenToVirtual(19, -11), { x: -2, y: 1, inside: false });
  assert.deepEqual(view.border(), [4, -3]);
  const copy = new NativeView(view.snapshot());
  assert.deepEqual(copy.screenToVirtual(-103, 800), view.screenToVirtual(-103, 800));
  view.configure({ deviceOffset: [0, 0], deviceScale: 1, windowShift: [0, 0] });
  assert.deepEqual(view.border(), [0, 0]);
  assert.deepEqual(view.screenToVirtual(1600, 900), { x: 800, y: 600, inside: false });
});
