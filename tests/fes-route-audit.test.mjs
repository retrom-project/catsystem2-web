// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FES_ROUTE_AUDIT, reviewFESIndirect } from '../scripts/fes-route-audit.mjs';
import { NATIVE_FES_IDS } from '../src/native/fes.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { profiles, defaultFESWorld } from './fixtures/default-fes-world.mjs';

// These independent frozen message sequences came from the complete wrapper
// instruction paths, not from parsing the JavaScript implementation.
const sdkMessages = [
  [326, 327],
  [328],
  [329],
  [330],
  [331],
  [23],
  [],
  [],
  [332],
  [333],
  [334],
  [335],
  [336],
  [337],
  [338, 338],
  [339],
  [340],
  [341],
  [342],
  [343],
  [344],
  [345],
  [347],
  [346],
];
const gameMessages = [
  [331, 332],
  [333],
  [334],
  [335],
  [336],
  [23],
  [],
  [],
  [337],
  [338],
  [339],
  [340],
  [341],
  [342],
  [343, 343],
  [344],
  [345],
  [346],
  [347],
  [348],
  [349],
  [350],
  [352],
  [351],
];
for (const [profileIndex, profile] of profiles.entries())
  test(`${profile} all installed FES native wrappers preserve their own packets and control results`, async () => {
    const world = await defaultFESWorld(profile);
    try {
      assert.deepEqual(
        FES_ROUTE_AUDIT.map((row) => row.id),
        NATIVE_FES_IDS,
      );
      const machine = world.main.machine,
        target = world.nativeTaskID(world.main.id),
        file = new NativeGlobalFile(),
        handle = world.runtime.handles.add('global-file', file),
        messages = [],
        formats = [],
        format = world.runtime.services.format;
      file.write(7, new Uint8Array(2048));
      machine.writeString('authored-name', 256);
      machine.writeString('ignored-tail', 320);
      world.runtime.services.format = (address, current) => {
        formats.push(address);
        return format(address, current);
      };
      // Packet observation only. Actual default kind34 loading, child services,
      // drawing, input and restore are exercised by default-fes-world/task tests.
      world.sendNativeEngine = async (_target, _sender, message, _w, l, context = {}) => {
        messages.push(message);
        if (message === 351) context.payload.store(0, 0xfedcba98);
        if (message === 343) {
          if (l) context.payload.bytes(l, 2048).fill(0x5a);
          return 2048;
        }
        return 0;
      };
      for (const [index, row] of FES_ROUTE_AUDIT.entries()) {
        const args =
          row.id === 0x289 || row.id === 0x28a
            ? [handle, 7, target]
            : row.id === 0x1c6
              ? [512]
              : [target, 256, 320, 3].slice(0, row.words);
        messages.length = formats.length = 0;
        const reply = await world.runtime.native('main', row.id, args, machine, world.main);
        assert.equal(reply.control, row.control, row.label);
        assert.deepEqual(messages, row.messages, row.label);
        assert.deepEqual(
          row.messages.map((message) => mapABIMessage(profile, 'control', 'raw', message, 34)),
          [sdkMessages, gameMessages][profileIndex][index],
          row.label + ' frozen raw ABI messages',
        );
        if (row.id === 0x278) assert.deepEqual(formats, [256, 256]);
        if (row.id === 0x373) assert.equal(reply.value, 0xfedcba98);
      }
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });

test('FES audit keeps explicit D8 receivers and rejects unknown indirect routes', () => {
  for (const row of FES_ROUTE_AUDIT)
    for (const consumer of row.consumerRoutes)
      assert.ok(consumer.domain === 8 && consumer.removePhase === 8 && consumer.condition);
  assert.equal(
    reviewFESIndirect('src/native/fes-task.mjs', {
      method: 'getNativeFeature',
      feature: 'fes-objects',
    }),
    null,
  );
  assert.equal(
    reviewFESIndirect('src/native/fes-coordinator.mjs', { method: 'ensureNativeEngine' }),
    null,
  );
});
