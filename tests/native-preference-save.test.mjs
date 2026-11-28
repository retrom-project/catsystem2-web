// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { serializeNativePreferences } from '../src/native/preferences.mjs';
import { parseNativeXML, findNativeXML } from '../src/native/xml.mjs';
import { nativeABI, validateABI } from '../src/native/abi/index.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';

const call = (world, args = []) =>
  world.runtime.native('main', 361, args, world.main.machine, world.main);

const profiles = [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
];
for (const profile of profiles) {
  test(`${profile} explicit save writes current preferences unconditionally and ignores a file failure`, async (t) => {
    const writes = [],
      storage = { read: async () => null, write: async (...args) => (writes.push(args), false) },
      world = await dataWorld(profile, {}, { storage });
    t.after(() => world.close({ flushFiles: false }));
    world.soundConfiguration.loaded = true;
    world.soundConfiguration.filename = 'SoundConfiguration.xml';
    world.soundConfiguration.dirty = true;
    world.configurationRefresh.pending = true;
    for (let i = 0; i < 2; i++) assert.equal((await call(world)).control, 2);
    assert.deepEqual(
      writes.map(([name]) => name),
      ['setup.xml', 'setup.xml'],
    );
    for (const [, bytes] of writes)
      assert.deepEqual(bytes, serializeNativePreferences(world.configuration));
    assert.equal(world.configurationDirty, false);
    assert.equal(world.soundConfiguration.dirty, true);
    assert.equal(world.configurationRefresh.pending, true);
    await assert.rejects(() => call(world, [0]), /expects no arguments/);
  });

  test(`${profile} save retains native omissions and separate volume/mute words after a cold restore`, async (t) => {
    const writes = [],
      storage = {
        read: async () => null,
        write: async (name, bytes) => (writes.push([name, bytes]), true),
      },
      world = await dataWorld(profile),
      fresh = await dataWorld(profile, {}, { initialize: false, storage });
    t.after(() => world.close({ flushFiles: false }));
    t.after(() => fresh.close({ flushFiles: false }));
    const config = world.configuration,
      tail = config.voiceLayout.volumeWord,
      view = new DataView(config.blocks[0].buffer);
    for (let i = 0; i < (config.voiceLayout.muteWord === null ? 5 : 10); i++)
      view.setUint32((tail + i) * 4, 100 + i, true);
    config.fields.scene.autoSelect = 71;
    config.fields.paths.imageImport = 'not-persisted';
    await fresh.restore(structuredClone(world.snapshot()));
    await call(fresh);
    const xml = parseNativeXML(writes[0][1], 'Shift_JIS');
    for (const [index, name] of ['master', 'bgm', 'se', 'voice', 'play'].entries()) {
      if (config.voiceLayout.muteWord !== null)
        assert.equal(findNativeXML(xml, `VOICE/mute_${name}`).text, String(105 + index));
      assert.equal(findNativeXML(xml, `VOICE/vol_${name}`).text, String(100 + index));
    }
    for (const path of nativeABI(profile).configuration.preferenceOmittedFields)
      assert.equal(findNativeXML(xml, path), null);
    const abi = nativeABI(profile);
    assert.equal(abi.tables.main.entries[361].signature.argumentWords, 0);
    assert.throws(
      () =>
        validateABI({
          ...abi,
          configuration: { ...abi.configuration, preferenceOmittedFields: [null] },
        }),
      /omitted preference fields/,
    );
  });

  test(`${profile} explicit save diagnoses rejected browser I/O and still returns control 2`, async (t) => {
    const world = await dataWorld(profile),
      files = new NativeFileStorage(world.game, 'preference-failure-test'),
      logs = [];
    t.after(() => world.close({ flushFiles: false }));
    t.after(() => files.close());
    files.store.put = async () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    world.storage = files;
    world.host.nativeLog = (message) => logs.push(message);
    assert.equal((await call(world)).control, 2);
    assert.deepEqual(logs, ['Native preference save failed: setup.xml: full']);
    assert.equal(world.configurationDirty, false);
    world.storage = {};
    await assert.rejects(() => call(world), /requires its file service/);
  });
}
