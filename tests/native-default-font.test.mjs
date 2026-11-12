// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeConfigurationMemory } from '../src/native/config-memory.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
function viewFixture(profile) {
  const configuration = new NativeConfiguration({ profile }),
    abi = nativeABI(profile),
    bytes = new Uint8Array(0x80000),
    reads = [],
    process = {
      read(at, size) {
        reads.push([at, size]);
        assert.ok(at >= 0 && size >= 0 && at + size <= bytes.length);
        return Buffer.from(bytes.buffer, at, size);
      },
    },
    owner = 0x1000,
    settings = 0x40000,
    memory = new NativeConfigurationMemory(process, configuration, { owner }),
    font =
      settings +
      abi.configuration.memory.layout.font -
      abi.configuration.memory.layout.settingsOffset,
    raw =
      abi.text.settingsCharacterBytes === 1
        ? Uint8Array.of(0x87, 0x9c, 0xfd, 0)
        : Uint8Array.of(0x2b, 0x73, 0, 0),
    expected =
      abi.text.settingsCharacterBytes === 1
        ? Uint8Array.of(0x87, 0x9c, 0xfd)
        : Uint8Array.of(0x94, 0x4c);
  bytes.set(raw, font);
  configuration.font.name = 'ACTIVE';
  reads.length = 0;
  return { configuration, abi, bytes, reads, memory, settings, font, expected };
}

for (const profile of profiles) {
  test(`${profile} existing Settings data view reads the real default font without active state or aliasing`, () => {
    const h = viewFixture(profile),
      before = h.configuration.snapshot(),
      result = h.memory.defaultFontBytes(h.settings);
    assert.equal(Object.getPrototypeOf(result), Uint8Array.prototype);
    assert.deepEqual(result, h.expected);
    assert.deepEqual(h.reads, [[h.font, h.abi.text.configurationLayout.fontBytes]]);
    h.bytes.fill(0, h.font, h.font + h.abi.text.configurationLayout.fontBytes);
    assert.deepEqual(
      result,
      h.expected,
      'owned default bytes survive changes to the borrowed data view',
    );
    assert.deepEqual(h.configuration.snapshot(), before);
    assert.throws(() => h.memory.defaultFontBytes(0), /existing native Settings reference/);
    h.bytes.fill(65, h.font, h.font + h.abi.text.configurationLayout.fontBytes);
    assert.throws(() => h.memory.defaultFontBytes(h.settings), /not terminated/);
  });

  test(`${profile} World borrows only an already mounted default Settings view and never ensures an engine`, async () => {
    const world = await dataWorld(profile, {}, { initialize: false }),
      h = viewFixture(profile);
    try {
      assert.equal(world.nativeEngine, undefined);
      assert.throws(() => world.nativeDefaultFontBytes(), /data view is unavailable/);
      assert.equal(world.nativeEngine, undefined);
      world.nativeEngine = {};
      assert.throws(() => world.nativeDefaultFontBytes(), /data view is unavailable/);
      world.nativeEngine = { configurationMemory: h.memory, refs: {} };
      assert.throws(() => world.nativeDefaultFontBytes(), /data view is unavailable/);
      assert.deepEqual(h.reads, []);
      world.nativeEngine.refs.defaultSettings = h.settings;
      const result = world.nativeDefaultFontBytes();
      assert.equal(Object.getPrototypeOf(result), Uint8Array.prototype);
      assert.deepEqual(result, h.expected);
      assert.deepEqual(h.reads, [[h.font, h.abi.text.configurationLayout.fontBytes]]);
      assert.equal(world.configuration.font.name, 'ＭＳ ゴシック');
      h.bytes.fill(0, h.font, h.font + h.abi.text.configurationLayout.fontBytes);
      assert.deepEqual(result, h.expected);
    } finally {
      delete world.nativeEngine; // Authored borrowed view, not a native process/factory.
      await world.close();
    }
  });
}

test('World accepts one explicit synchronous byte provider, owns Buffer data and never creates default state', async () => {
  const world = await dataWorld(profiles[0], {}, { initialize: false }),
    input = Buffer.from([0x87, 0x9c, 0, 0x58]);
  try {
    const before = Object.keys(world),
      configuration = structuredClone(world.configuration.snapshot());
    let calls = 0;
    world.host.nativeDefaultFontBytes = function (owner) {
      assert.equal(owner, world);
      assert.equal(this, world.host);
      calls++;
      return input;
    };
    const output = world.nativeDefaultFontBytes();
    assert.deepEqual(output, Uint8Array.of(0x87, 0x9c));
    assert.equal(Object.getPrototypeOf(output), Uint8Array.prototype);
    input.fill(0);
    assert.deepEqual(output, Uint8Array.of(0x87, 0x9c));
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(world), before);
    assert.deepEqual(world.configuration.snapshot(), configuration);
    world.host.nativeDefaultFontBytes = () => Promise.resolve(new Uint8Array());
    assert.throws(() => world.nativeDefaultFontBytes(), /synchronous CP932 bytes/);
    world.host.nativeDefaultFontBytes = () => null;
    assert.throws(() => world.nativeDefaultFontBytes(), /synchronous CP932 bytes/);
    world.host.nativeDefaultFontBytes = 0;
    assert.throws(() => world.nativeDefaultFontBytes(), /synchronous byte reader/);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});
