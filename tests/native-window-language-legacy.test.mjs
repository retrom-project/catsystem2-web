// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { parseXML } from '../src/xml.mjs';
import { applyNativePreferences } from '../src/native/preferences.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-window-language-legacy-golden.json', import.meta.url)),
);

for (const build of golden.builds) {
  test(`${build.profile} title confirmation uses inline text and its original preparation order`, async (t) => {
    const world = await dataWorld(build.profile),
      events = [];
    t.after(() => world.close({ flushFiles: false }));
    let row;
    // Compare the same explicit Root send boundary as the original callback
    // capture. Root script restart/disposal is a separate owner contract.
    world.window.sendEvent = async (raw, w = 0, l = 0) => {
      if (row.present) events.push({ type: 'native-message', raw, w, l });
      return 0;
    };
    world.host.nativeWindowAction = (action) => {
      assert.equal(action.type, 'confirm-title');
      events.push({
        type: 'MessageBoxA',
        caption: action.caption,
        message: action.message,
        buttons: 4,
      });
      return row.reply === 6;
    };
    for (row of build.rows) {
      events.length = 0;
      world.window.post(0x46c, 0, 0);
      await world.processWindowMessages();
      assert.deepEqual(
        events,
        row.events.map((event) =>
          event.type === 'native-message'
            ? { ...event, raw: event.raw === 154 ? 158 : event.raw === 20 ? 21 : event.raw }
            : event,
        ),
      );
    }
    const saved = structuredClone(world.snapshot()),
      fresh = await dataWorld(build.profile, {}, { initialize: false }),
      cold = [];
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(saved);
    fresh.host.nativeWindowAction = (action) => {
      cold.push(action);
      return false;
    };
    await fresh.window.command(119);
    assert.deepEqual(cold, [
      {
        type: 'confirm-title',
        caption: build.rows[0].events[0].caption,
        message: build.rows[0].events[0].message,
      },
    ]);
    assert.equal(fresh.globalStrings.tables.size, 0);
  });

  test(`${build.profile} defined Settings paths ignore later language nodes and preserve ordinary preferences through file cold-read`, async () => {
    assert.equal(build.settingsViewsEqual, true);
    assert.equal(build.settingsViewBytes, 91140);
    const configs = build.startupXML.map(
      (text) => new NativeConfiguration({ profile: build.profile, startup: parseXML(text) }),
    );
    assert.deepEqual(configs[0].snapshot(), configs[1].snapshot());
    assert.equal(configs[1].getField('application.title'), 'Ordinary title');
    assert.equal(configs[1].language, undefined);
    const files = new Map(),
      storage = {
        read: async (name) => files.get(name)?.slice() ?? null,
        write: async (name, bytes) => {
          files.set(name, bytes.slice());
          return true;
        },
      },
      world = await dataWorld(build.profile, {}, { storage });
    try {
      world.configuration.applyStartup(parseXML(build.startupXML[1]));
      world.configuration.applyUserPreferences(parseXML(build.startupXML[1]));
      world.configuration.setField('application.title', 'Ordinary title');
      assert.equal(world.configuration.language, undefined);
      new DataView(world.configuration.blocks[1].buffer).setUint32(48, 7, true);
      assert.deepEqual(
        await world.runtime.native('main', 361, [], world.main.machine, world.main),
        { control: 2 },
      );
      const persisted = await storage.read('setup.xml'),
        text = new TextDecoder().decode(persisted);
      assert.equal(/<language[\s>]/i.test(text), false);
      const fresh = new NativeConfiguration({
        profile: build.profile,
        startup: parseXML(build.startupXML[1]),
      });
      applyNativePreferences(fresh, persisted);
      assert.equal(fresh.language, undefined);
      assert.equal(fresh.getField('application.title'), 'Ordinary title');
      assert.equal(new DataView(fresh.blocks[1].buffer).getUint32(48, true), 7);
      assert.equal(world.globalStrings.tables.size, 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

  test(`${build.profile} later language menu and private window messages stay unhandled without entering a missing language service`, async () => {
    const world = await dataWorld(build.profile),
      actions = [],
      before = world.configuration.snapshot();
    world.host.nativeWindowAction = (action) => {
      actions.push(action);
      return false;
    };
    try {
      for (const { command } of build.languageMenus) {
        assert.equal(world.window.handlesBrowserMessage(0x111, command), false);
        assert.equal(await world.window.command(command), false);
      }
      for (const { message } of build.languageMessages) {
        assert.equal(world.window.handlesBrowserMessage(message, 0), false);
        await world.dispatchWindowMessage({ message, wParam: 0, lParam: 0 });
      }
      assert.deepEqual(actions, []);
      assert.deepEqual(world.configuration.snapshot(), before);
      assert.equal(world.globalStrings.tables.size, 0);
      assert.throws(() => world.globalStrings.get('$key$fallback'), /language.storage/);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('authored language XML is active in the established multilingual configuration control', () => {
  const root = parseXML(golden.builds[0].startupXML[1]),
    configuration = new NativeConfiguration({
      profile: 'nekopara-vol3-engine-2.6.1.76',
      startup: root,
      preferences: root,
    });
  assert.equal(configuration.language.entries.length, 2);
  assert.equal(configuration.language.main, 1);
  assert.equal(configuration.language.ui, 1);
  assert.equal(configuration.language.entries[1].prefix, 'en');
});
