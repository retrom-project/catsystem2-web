// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { imageOwnerFixture } from '../fixtures/image-owner-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { NativeParticleCommands as OriginalCommands } from '../../oracle/particle-commands-original.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS particle wrappers preserve packets, controls and VM bytes',
    { skip: !fixture.available },
    async () => {
      const oracle = await imageOwnerFixture(fixture.bytes, fixture.profile),
        js = await dataWorld(fixture.profile),
        old = new OriginalCommands(oracle.engine, oracle.world),
        events = [];
      const receive = async (target, sender, message, w, l, context) => {
        const size = message === 314 ? 400 : message === 319 ? 128 : 0;
        const bytes = size ? context.payload.bytes(l, size).slice() : null;
        // Category buffers are C strings. Old global scratch retains bytes
        // following the terminator, which the receiver never reads.
        if (message === 314)
          for (const at of [4, 132]) {
            const end = bytes.subarray(at, at + 128).indexOf(0);
            if (end >= 0) bytes.fill(0, at + end, at + 128);
          }
        events.push({
          target,
          message,
          w,
          flags: context.flags,
          bytes,
          value: size ? undefined : l,
        });
        context.nativeRouted = target !== 0xffffffff;
        return message === 318 ? undefined : 0;
      };
      oracle.world.sendNativeEngine = receive;
      js.sendNativeEngine = receive;
      try {
        for (const machine of [oracle.machine, js.main.machine]) {
          machine.writeString('emitter', 64);
          machine.writeString('', 128);
          machine
            .bytes(256, 128)
            .set(Uint8Array.from({ length: 128 }, (_, i) => (i * 139 + 97) & 255));
        }
        for (const [id, args] of [
          [0x10f, [17, 64, 128, 23, 0x7fc01234, 256]],
          [0x2b5, [0xffffffff, 64, 128, 0, 0, 256]],
          [0x110, [17]],
          [0x111, [17]],
          [0x112, [17]],
          [0x112, [0xffffffff]],
          [0x113, [17, 256]],
          [0x1aa, [17, 0x80000000]],
          [0x1ab, [17, 0xffffffff]],
        ]) {
          const before = js.main.machine.memory.slice();
          events.length = 0;
          const expected = await old.apply(id, args, oracle.machine, { id: 41 }),
            reference = events.slice();
          events.length = 0;
          const actual = await js.particleCommands.apply(id, args, js.main.machine, js.main);
          assert.deepEqual(actual, expected, 'reply ' + id.toString(16));
          assert.deepEqual(events, reference, 'packet ' + id.toString(16));
          assert.deepEqual(js.main.machine.memory, before);
        }
      } finally {
        old.close();
        await oracle.engine.close();
        await js.close();
      }
    },
  );
