// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { imageOwnerFixture } from '../fixtures/image-owner-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { NativePlaneModelCommands as OriginalCommands } from '../../oracle/plane-model-command-original.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS model/trail packets match existing original wrapper harness',
    { skip: !fixture.available },
    async () => {
      const oracle = await imageOwnerFixture(fixture.bytes, fixture.profile),
        js = await dataWorld(fixture.profile),
        events = [];
      const old = new OriginalCommands(oracle.engine, oracle.world);
      const receive = (profile, memory, target, message, w, l) => {
        if (message === 69 || message === 71) {
          const bytes = [];
          for (let i = 0; ; i++) {
            const byte = memory.bytes ? memory.bytes(l + i, 1)[0] : memory.read(l + i, 1)[0];
            if (!byte) break;
            bytes.push(byte);
          }
          return {
            target,
            message,
            w,
            filename: new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)),
          };
        }
        const bytes =
          w || message === 80
            ? memory.bytes
              ? memory.bytes(l, message === 80 ? 128 : 52).slice()
              : memory.read(l, message === 80 ? 128 : 52)
            : null;
        // The native 52-byte structure contains two unwritten alignment words.
        // The receiver treats these as vector padding, never as packet fields.
        if (bytes && message === 79) {
          bytes.fill(0, 24, 28);
          bytes.fill(0, 40, 44);
        }
        return { target, message, w, bytes };
      };
      oracle.world.sendNativeEngine = async (target, _sender, message, w, l, ctx) =>
        events.push(receive(fixture.profile, ctx.payload, target, message, w, l));
      js.sendNativeEngine = async (target, _sender, message, w, l, ctx) =>
        events.push(receive(fixture.profile, ctx.payload, target, message, w, l));
      try {
        for (const m of [oracle.machine, js.main.machine]) {
          m.writeString('mesh.kx2', 64);
          m.bytes(128, 128).set(Uint8Array.from({ length: 128 }, (_, i) => (i * 29 + 7) & 255));
        }
        for (const [id, args] of [
          [0x51, [0]],
          [0x51, [17, 64]],
          [0x15a, [17, 64, 0x7fc01234]],
          [0x18e, [0]],
          [0x18e, [17, 3, 1, 0, 0, 0, 96, 0x3f800000, 0x40000000, 0x40400000, 0, -10]],
          [0x18e, [17, ...Array(11).fill(0)]],
          [0x18f, [0, 128, 144, 160, 192, 0x12345678, 0xff223344]],
          [0x18f, [17, 128, 144, 160, 192, 0x12345678, 0xff223344]],
        ]) {
          events.length = 0;
          const before = js.main.machine.memory.slice();
          const expected = await old.apply(id, args, oracle.machine, { id: 41 }),
            reference = events.slice();
          events.length = 0;
          const actual = await js.planeModelCommands.apply(id, args, js.main.machine, js.main);
          assert.deepEqual(actual, expected, 'control ' + id.toString(16));
          assert.deepEqual(events, reference, 'packet ' + id.toString(16));
          assert.deepEqual(js.main.machine.memory, before, 'VM is borrowed/copy-only');
        }
      } finally {
        old.close();
        await oracle.engine.close();
        await js.close();
      }
    },
  );
