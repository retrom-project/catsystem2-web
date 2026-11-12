// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import sdkRegistration from '../src/native/abi/2.6.1.74.mjs';
import gameRegistration from '../src/native/abi/2.6.1.76.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { abiForEngineVersion, nativeABI } from '../src/native/abi/index.mjs';
import { nativeCatalog } from '../src/native/catalog.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const sdk = nativeABI(sdkRegistration.profile),
  game = nativeABI(gameRegistration.profile);

test('shared semantics do not name or enable explicitly unknown profile slots', () => {
  assert.equal(NATIVE_SEMANTICS.main[0x42].name, 'task.create');
  assert.equal(sdk.tables.main.entries[0x42].name, null);
  assert.equal(sdk.tables.main.entries[0x42].status, 'unknown');
  assert.equal(game.tables.main.entries[0x42].name, 'task.create');
  assert.equal(Object.hasOwn(NATIVE_SEMANTICS.main, 0x52), false);
  assert.deepEqual(sdk.tables.main.entries[0x52].controlCodes, []);
  assert.deepEqual(game.tables.main.entries[0x52].controlCodes, [2]);
  assert.throws(() => nativeABI('unregistered'), /Unregistered/);
  for (const version of ['2.6.1.23', '2.6.1.37', '2.6.1.58', '2.6.1.63', '2.6.1.67', '2.6.1.75'])
    assert.throws(() => abiForEngineVersion(version), /Unregistered/);
});

test('SDK JavaScript and game E-mote remain separate explicit bindings and stubs', () => {
  assert.equal(sdk.tables.main.entries[0x3ce].name, 'javascript.linkScript');
  assert.equal(game.tables.main.entries[0x3ce].name, 'reserved.noop');
  assert.equal(game.tables.main.entries[0x3ce].status, 'reserved');
  assert.equal(sdk.tables.main.entries[0x38a].name, 'reserved.noop');
  assert.equal(game.tables.main.entries[0x38a].name, 'emote.message524');
  assert.equal(sdk.tables.main.entries[0x38d].status, 'constant-zero');
  assert.equal(game.tables.main.entries[0x38d].name, 'emote.message528');
  for (const abi of [sdk, game]) {
    assert.equal(abi.tables.main.entries[0x181].signature.argumentWords, 5);
    assert.equal(abi.tables.main.entries[0x358].signature.argumentWords, 7);
  }
  assert.equal(sdk.tables.main.count, 1009);
  assert.equal(game.tables.main.count, 1055);
  assert.equal(sdk.tables.main.entries[1054], undefined);
  assert.equal(game.tables.main.entries[1054].name, 'window.postMessage468');
});

test('profile signature knowledge, encodings and independent observations remain exact', () => {
  assert.equal(sdk.tables.main.entries[6].signature.resultWritten, true);
  assert.equal(game.tables.main.entries[6].signature.resultWritten, null);
  assert.equal(sdk.tables.main.entries[0x251].parameters[1].type.target.encoding, 'CP932');
  assert.equal(game.tables.main.entries[0x251].parameters[1].type.target.encoding, 'UTF-8');
  assert.equal(sdk.tables.main.entries[0x38a].signature.argumentWords, null);
  assert.deepEqual(sdk.tables.main.entries[0x38a].observedArgumentWords, [3]);
  assert.equal(game.tables.main.entries[0x38a].signature.argumentWords, 3);
  assert.equal(sdk.tables.main.entries[1].signature.review, 'needs-review');
  assert.ok(sdk.tables.main.entries[1].signature.reviewReason);
});

for (const registration of [sdkRegistration, gameRegistration]) {
  test(`${registration.profile} ordinary World preserves resolved runtime dispatch and diagnostics`, async () => {
    const world = await dataWorld(registration.profile);
    try {
      const task = world.main,
        machine = task.machine,
        runtime = world.runtime,
        invoke = (id, args = []) =>
          runtime.native('main', id, args, machine, task, runtime.scheduler);
      assert.deepEqual(invoke(6, [0xdeadbeef]), { control: 1, value: 0xdeadbeef });
      assert.deepEqual(invoke(0xab), { control: 1, value: 0 });
      const noop = registration === sdkRegistration ? 0x38a : 0x3ce;
      assert.deepEqual(invoke(noop), { control: 2 });
      assert.throws(
        () => invoke(0x52),
        (error) =>
          error.name === 'UnsupportedKCSNative' &&
          error.details.id === 0x52 &&
          error.details.profile === registration.profile &&
          error.details.task === task.id,
      );
      assert.throws(() => invoke(registration.tables.main.count), /outside/);
      const catalog = nativeCatalog(registration.profile);
      assert.equal(catalog[0x52].name, null);
      assert.equal(catalog[noop].status, 'reserved');
      assert.equal(catalog[0x181].argumentWords, 5);
    } finally {
      await world.close();
    }
  });
}
