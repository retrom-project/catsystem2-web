// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import {
  initializeNativeStartupMenu,
  releaseNativeStartupMenu,
} from '../src/native/engine-startup-menu.mjs';

for (const [profile, variable, normalCount, load, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 4, 0x5bf3c0, 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 6, 0x70e000, 'W'],
]) {
  test(
    `${profile} owns its original standard and author menus and restores their handles`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        open = () =>
          NativeEngineProcess.open({
            profile,
            bytes,
            bootstrapOwner: {},
            readFile: async () => null,
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          }),
        first = await open(),
        p = first.process,
        slot = NATIVE_STARTUP_BLOCKS[profile] + 36,
        get = (engine, name, ...args) =>
          engine.process.call(engine.kernel.resolve({ dll: 'USER32.dll', name }), args);
      let fresh;
      try {
        await initializeNativeStartupMenu(first);
        const owner = p.load(slot),
          normal = p.load(owner + 8),
          normalSystem = get(first, 'GetSubMenu', normal, 0),
          tree = first.kernel.windowMenus.menus;
        assert.equal(p.allocations.get(owner), 16);
        assert.equal(get(first, 'GetMenuItemCount', normal), normalCount);
        assert.equal(get(first, 'GetMenuItemCount', normalSystem), 4);
        assert.equal(get(first, 'GetSubMenu', normal, normalCount), 0);
        assert.equal(get(first, 'GetSubMenu', normalSystem, 0), 0);
        assert.equal(tree.get(normal)[0].label, '$0011-0001$システム(&S)');
        assert.deepEqual(
          tree.get(normalSystem).find(({ id }) => id === 40002),
          { id: 40002, label: '$0011-0004$ゲームの終了(&X)', type: 0, state: 0, submenu: 0 },
        );
        assert.ok(tree.get(normalSystem).some(({ type }) => type === 0x800));

        assert.equal(await first.call(load, [first.module.base, 105], owner), 1);
        const replacement = p.load(owner + 8);
        assert.notEqual(replacement, normal);
        assert.equal(tree.has(normal), false);
        assert.equal(tree.has(normalSystem), false);
        assert.equal(get(first, 'GetMenuItemCount', replacement), normalCount + 1);

        await releaseNativeStartupMenu(first);
        assert.equal(tree.size, 0);
        assert.equal(p.load(slot), 0);
        first.options.configuration.authorMode = 1;
        await initializeNativeStartupMenu(first);
        const author = p.load(slot),
          handle = p.load(author + 8),
          debug = get(first, 'GetSubMenu', handle, normalCount);
        assert.equal(get(first, 'GetMenuItemCount', handle), normalCount + 1);
        assert.equal(get(first, 'GetMenuItemCount', debug), suffix === 'A' ? 6 : 7);
        assert.equal(tree.get(handle).at(-1).label, '$0011-0020$デバッグ(&D)');
        assert.equal(first.kernel.calls.get('user32.dll!LoadMenu' + suffix), 3);

        fresh = await open();
        fresh.restore(first.snapshot());
        assert.equal(fresh.process.load(slot), author);
        assert.equal(fresh.process.load(author + 8), handle);
        assert.deepEqual(fresh.kernel.windowMenus.menus, tree);
        assert.equal(get(fresh, 'GetSubMenu', handle, normalCount), debug);
        await releaseNativeStartupMenu(fresh);
        assert.equal(fresh.process.load(slot), 0);
        assert.equal(fresh.process.allocations.has(author), false);
        assert.equal(fresh.kernel.windowMenus.menus.size, 0);
        assert.equal(get(first, 'GetMenuItemCount', handle), normalCount + 1);
        assert.equal(get(fresh, 'GetMenuItemCount', handle), 0xffffffff);
        assert.equal(fresh.kernel.lastError, 1401);
      } finally {
        await fresh?.close();
        await first.close();
      }
    },
  );
}
