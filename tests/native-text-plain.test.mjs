// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../oracle/engine-process.mjs';
import { NativeTextRuntime } from '../src/native/text.mjs';
import { nativePlainText } from '../src/native/text-plain.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { formatNativeAt, encodeCP932 } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

test('23 Main392 extracts CP932 base text into shared memory and supports aliased source', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23');
  t.after(() => world.close());
  const { main, runtime } = world,
    m = main.machine,
    shared = 0x80000c3c,
    source = Uint8Array.of(0x81, 0x5c, ...encodeCP932('[夏/なつ]\\n\\c0xff;光。\tA\\wrB\\qC\\iD')),
    expected = Uint8Array.of(0x81, 0x5c, ...encodeCP932('夏光。\tArBCD'));
  m.writeStringBytes(source, 128);
  m.bytes(shared, 32).fill(0xa5);
  const call = (destination, address) =>
    runtime.native('main', 392, [destination, address], m, main);
  assert.deepEqual(await call(shared, 128), { control: 1, value: expected.length });
  assert.deepEqual(m.bytes(shared, expected.length + 2), Uint8Array.of(...expected, 0, 0xa5));
  assert.deepEqual(await call(128, 128), { control: 1, value: expected.length });
  assert.deepEqual(m.bytes(128, expected.length + 1), Uint8Array.of(...expected, 0));
  assert.deepEqual(await call(0xffffffff, 128), { control: 1, value: 0 });
});

test('63 Main392 preserves wide CP932 pairs and emits only the displayed base text', async (t) => {
  const world = await dataWorld('rebellions-jp-engine-2.6.1.63');
  t.after(() => world.close());
  const { main, runtime } = world,
    m = main.machine,
    source = Uint8Array.of(0xf1, 0x5b, ...encodeCP932('[春/はる]\\n。')),
    expected = Uint8Array.of(0xf1, 0x5b, ...encodeCP932('春。'));
  m.writeStringBytes(source, 128);
  m.bytes(256, 40).fill(0xa5);
  const call = (destination) => runtime.native('main', 392, [destination, 128], m, main);
  assert.deepEqual(await call(256), { control: 1, value: expected.length });
  assert.deepEqual(m.bytes(256, expected.length + 2), Uint8Array.of(...expected, 0, 0xa5));
  assert.deepEqual(await call(0xffffffff), { control: 1, value: 0 });
});

const glyphs = {
  measure: (_font, text) => ({
    width: text.length * 8,
    height: 16,
    ascent: 12,
    descent: 4,
    averageWidth: 8,
    maximumWidth: 16,
  }),
};
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    `${profile} plain-text parser retains raw bytes across a fresh process and releases temporary objects`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ profile, bytes }),
        runtime = new NativeTextRuntime(engine, { glyphs }),
        m = new KCSMachine({
          body: new Binary(Uint8Array.of(59)),
          codeSize: 1,
          data: new Uint8Array(4096),
          stackSize: 1024,
        }),
        source = encodeCP932('Authored 猫'),
        world = {
          profile,
          runtime: { services: { formatBytes: formatNativeAt } },
          getNativeFeature: async () => runtime,
        };
      try {
        m.bytes(16, source.length + 1).set([...source, 0]);
        assert.deepEqual(await nativePlainText(0x188, [512, 16], m, world), {
          control: 1,
          value: source.length,
        });
        assert.deepEqual(m.bytes(512, source.length + 1), Uint8Array.from([...source, 0]));
        const saved = engine.snapshot(),
          fresh = await NativeEngineProcess.open({ profile, bytes }),
          after = new NativeTextRuntime(fresh, { glyphs });
        try {
          fresh.restore(saved);
          world.getNativeFeature = async () => after;
          assert.deepEqual(await nativePlainText(0x188, [16, 16], m, world), {
            control: 1,
            value: source.length,
          });
          assert.deepEqual(m.bytes(16, source.length + 1), Uint8Array.from([...source, 0]));
          assert.deepEqual(await nativePlainText(0x188, [0xffffffff, 16], m, world), {
            control: 1,
            value: 0,
          });
          assert.equal(after.writers.size, 0);
        } finally {
          await after.close();
          await fresh.close();
        }
      } finally {
        await runtime.close();
        await engine.close();
      }
    },
  );
