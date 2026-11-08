// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeInput } from '../src/native/input.mjs';
import { NativeInputBindings, browserVirtualKey } from '../src/native/input-bindings.mjs';
function fixture() {
  const messages = [],
    input = new NativeInput({
      dispatch: async (...args) => {
        messages.push(args);
        return 0;
      },
    }),
    config = new NativeConfiguration({ profile: 'nekopara-vol3-engine-2.6.1.76' }),
    bindings = new NativeInputBindings(input, config);
  input.register({ owner: 4, bounds: [0, 0, 100, 100] });
  input.pointer(10, 10);
  const row = config.keys.rows[0];
  row.name = 'Authored confirm';
  row.enabled = 1;
  row.keyboard.set([13, 90, 0, 0]);
  row.mouse[0] = 1;
  row.joypad[0] = 5;
  return { input, config, bindings, messages };
}
test('physical keyboard alternatives and a short pointer tap retain separate native press/release frames', async () => {
  const { input, bindings, messages } = fixture();
  bindings.key('keyboard', 90, true);
  bindings.sample();
  await input.tick(1);
  assert.deepEqual(messages.at(-1), [4, 4, 0, 1]);
  assert.equal(input.keys[1], 1);
  assert.equal(input.sources[1], 1);
  bindings.key('keyboard', 90, false);
  bindings.sample();
  await input.tick(2);
  assert.deepEqual(messages.at(-1), [4, 4, 0, 1]);
  bindings.sample();
  await input.tick(3);
  assert.deepEqual(messages.at(-1), [4, 4, 0, 0]);
  bindings.mouse(0, true);
  bindings.mouse(0, false);
  bindings.sample();
  await input.tick(4);
  assert.deepEqual(messages.at(-1), [4, 4, 0, 1]);
  assert.equal(input.sources[0], 2);
  bindings.sample();
  await input.tick(5);
  assert.deepEqual(messages.at(-1), [4, 4, 0, 0]);
});
test('native repeat flags and a held handled key preserve the original timer and routing order', async () => {
  const { input, config, bindings, messages } = fixture();
  bindings.key('keyboard', 13, true);
  bindings.sample();
  await input.tick(1);
  for (let frame = 2; frame <= 40; frame++) {
    bindings.sample();
    await input.tick(frame);
  }
  assert.equal(messages.filter((m) => m[1] === 4).length, 1);
  bindings.releaseAll();
  bindings.sample();
  await input.tick(41);
  config.keys.rows[0].rep_keyboard[0] = 1;
  bindings.key('keyboard', 13, true);
  for (let frame = 42; frame <= 76; frame++) {
    bindings.sample();
    await input.tick(frame);
  }
  assert.equal(messages.filter((m) => m[1] === 4 && m[3] === 1).length, 4);
});
test('wheel pulses use source16 and configured joystick enablement controls standard gamepad inputs', async () => {
  const { input, config, bindings } = fixture();
  config.keys.rows[0].mouse[1] = 7;
  bindings.wheel(false);
  bindings.sample();
  assert.equal(input.sources[1], 16);
  assert.equal(input.keys[1], 1);
  bindings.sample();
  assert.equal(input.keys[1], 0);
  const pad = { connected: true, axes: [0, 0], buttons: [{ pressed: true }] };
  bindings.gamepad([pad]);
  bindings.sample();
  assert.equal(input.keys[0], 0);
  config.keys.enableJoypad = 1;
  bindings.setJoypad(1);
  bindings.gamepad([pad]);
  bindings.sample();
  assert.equal(input.sources[0], 4);
});
test('browser virtual keys retain native numeric keypad and modifier values', () => {
  assert.equal(browserVirtualKey({ code: 'KeyZ' }), 90);
  assert.equal(browserVirtualKey({ code: 'Numpad8' }), 104);
  assert.equal(browserVirtualKey({ code: 'ControlRight' }), 17);
  assert.equal(browserVirtualKey({ code: 'KeyZ', keyCode: 229 }), 0);
});
