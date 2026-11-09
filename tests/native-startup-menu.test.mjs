// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { loadNativeGameStartupLanguage } from '../src/native/engine-language.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import {
  initializeNativeStartupMenu,
  refreshNativeLanguageMenu,
  releaseNativeStartupMenu,
} from '../src/native/engine-startup-menu.mjs';
import { nativeWindowLanguageCommand } from '../src/native/window-commands.mjs';

for (const [profile, variable, normalCount, load, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 4, 0x5bf3c0, 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 4, 0x70e000, 'W'],
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
        assert.equal(tree.get(normal)[0].label, 'システム(&S)');
        assert.deepEqual(
          tree.get(normalSystem).find(({ id }) => id === 40002),
          { id: 40002, label: 'ゲームの終了(&X)', type: 0, state: 0, submenu: 0 },
        );
        assert.ok(tree.get(normalSystem).some(({ type }) => type === 0x800));

        assert.equal(await first.call(load, [first.module.base, 105], owner), 1);
        const replacement = p.load(owner + 8);
        assert.notEqual(replacement, normal);
        assert.equal(tree.has(normal), false);
        assert.equal(tree.has(normalSystem), false);
        assert.equal(get(first, 'GetMenuItemCount', replacement), suffix === 'A' ? 5 : 7);
        assert.equal(tree.get(replacement)[0].label, '$0011-0001$システム(&S)');

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
        assert.equal(tree.get(handle).at(-1).label, 'デバッグ(&D)');
        assert.equal(first.kernel.calls.get('user32.dll!LoadMenu' + suffix), 3);
        assert.ok(first.kernel.calls.get('user32.dll!SetMenuItemInfo' + suffix) > normalCount * 2);

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

  test(
    `${profile} localizes nested menu labels through the original UI catalogue`,
    { skip: !process.env[variable] },
    async () => {
      const filename = process.env[variable],
        wide = suffix === 'W',
        bytes = new Uint8Array(await readFile(filename)),
        startup = wide
          ? new Uint8Array(await readFile(resolve(dirname(filename), 'config/startup.xml')))
          : null,
        source =
          '$0011-0001$\r\nメニュー(Menu)\r\n$0011-0004$\r\n保存して終了\r\n$0011-0005$\r\n$empty$\r\n',
        catalogue = wide ? new TextEncoder().encode(source) : encodeCP932(source),
        engine = await NativeEngineProcess.open({
          profile,
          bytes,
          bootstrapOwner: {},
          configuration: new NativeConfiguration({
            profile,
            startup: startup && parseNativeXML(startup, 'utf-8'),
            uiLanguage: 0x409,
          }),
          readFile: async (name) =>
            name === (wide ? 'language_en.txt' : 'language.txt')
              ? catalogue
              : name === 'config/startup.xml'
                ? startup
                : null,
        });
      try {
        if (wide) await loadNativeGameStartupLanguage(engine);
        assert.equal(engine.refs.startupLanguage.loaded, true);
        await initializeNativeStartupMenu(engine);
        const p = engine.process,
          owner = p.load(NATIVE_STARTUP_BLOCKS[profile] + 36),
          tree = engine.kernel.windowMenus.menus,
          top = tree.get(p.load(owner + 8)),
          system = tree.get(top[0].submenu);
        assert.equal(top[0].label, 'メニュー(Menu)');
        assert.equal(top[1].label, '');
        assert.equal(system.find(({ id }) => id === 40002).label, '保存して終了');
        assert.equal(system.find(({ id }) => id === 119).label, 'タイトル画面に戻る(&T)');
        assert.ok(system.some(({ type, label }) => type === 0x800 && !label));
      } finally {
        await engine.close();
      }
    },
  );

  test(
    `${profile} applies the original settings flags to optional menu commands`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({
          profile,
          bytes,
          bootstrapOwner: {},
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          readFile: async () => null,
        }),
        p = engine.process,
        query = engine.kernel.resolve({ dll: 'USER32.dll', name: 'GetMenuItemInfo' + suffix }),
        out = p.allocate(48, true),
        flags =
          suffix === 'A'
            ? [
                [46104, 118],
                [47368, 40034],
              ]
            : [
                [47924, 118],
                [50032, 40034],
                [57540, 40063],
              ];
      try {
        if (suffix === 'W')
          engine.options.configuration.language.entries = [
            { code: 1033, prefix: 'en', lang: 'English', accel: [0, 0], accelsub: [0, 0] },
            { code: 1041, prefix: 'jp', lang: '日本語', accel: [0, 0], accelsub: [0, 0] },
          ];
        p.store(out, 48);
        for (let enabled = 0; enabled < 1 << flags.length; enabled++) {
          for (const [i, [offset]] of flags.entries())
            p.store(engine.refs.settings + offset, (enabled >>> i) & 1);
          await initializeNativeStartupMenu(engine);
          const owner = p.load(NATIVE_STARTUP_BLOCKS[profile] + 36),
            root = p.load(owner + 8);
          for (const [i, [, id]] of flags.entries())
            assert.equal(p.call(query, [root, id, 0, out]), (enabled >>> i) & 1, `command ${id}`);
          assert.equal(p.call(query, [root, 40002, 0, out]), 1);
          await releaseNativeStartupMenu(engine);
        }
      } finally {
        await engine.close();
      }
    },
  );
}

test(
  'game WinMain builds language menu labels, accelerators and the original checked selections',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const profile = 'nekopara-vol3-engine-2.6.1.76',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      configuration = new NativeConfiguration({ profile, uiLanguage: 0x411 }),
      engine = await NativeEngineProcess.open({
        profile,
        bytes,
        bootstrapOwner: {},
        configuration,
        readFile: async () => null,
      }),
      p = engine.process,
      top = () => {
        const owner = p.load(NATIVE_STARTUP_BLOCKS[profile] + 36);
        return engine.kernel.windowMenus.menus.get(p.load(owner + 8));
      };
    try {
      configuration.language.entries = [
        { code: 1033, prefix: 'en', lang: 'English', accel: [69, 0], accelsub: [69, 4] },
        {
          code: 1041,
          prefix: 'jp',
          lang: '日本語 with a long native buffer',
          accel: [74, 8],
          accelsub: [74, 16],
        },
        { code: 1028, prefix: 'cn', lang: '繁体中文', accel: [0, 0], accelsub: [67, 0] },
      ];
      Object.assign(configuration.language, { default: 1, ui: 8, main: 0, sub: 0xffffffff });
      await initializeNativeStartupMenu(engine);
      const choices = engine.kernel.windowMenus.menus.get(top()[3].submenu);
      assert.deepEqual(
        choices.map(({ id, label, type, state }) => [id, label, type, state]),
        [
          [40065, 'UI : English', 0, 0],
          [40066, 'UI : 日本語 with a long native buffer', 0, 8],
          [40067, 'UI : 繁体中文', 0, 0],
          [0, '', 0x800, 0],
          [40075, 'Main : English\tE', 0, 8],
          [40076, 'Main : 日本語 with a long native buffer\tCtrl + J', 0, 0],
          [40077, 'Main : 繁体中文', 0, 0],
          [0, '', 0x800, 0],
          [40085, 'Sub : English\tShift + E', 0, 0],
          [40086, 'Sub : 日本語 with a long native buffer\tAlt + J', 0, 0],
          [40087, 'Sub : 繁体中文\tC', 0, 0],
          [40088, 'Sub : OFF\tShift + N', 0, 8],
        ],
      );
      const block = NATIVE_STARTUP_BLOCKS[profile],
        owner = p.load(block + 36),
        observed = [];
      for (const [address, field] of [
        [0x530be0, 'ui'],
        [0x530d50, 'main'],
        [0x530e30, 'sub'],
      ])
        engine.patch(address, 'observe original menu language selection', 1, ([forced]) => {
          assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, block);
          assert.equal(forced, 0);
          observed.push({ field, index: p.cpu.reg_read_i32(p.uc.X86_REG_EDX) >>> 0 });
          return 0;
        });
      for (let command = 40064; command <= 40095; command++) {
        observed.length = 0;
        await engine.call(0x530200, [1, 0x111, 0x10000 | command, 0, 0], owner);
        const selection = nativeWindowLanguageCommand(command);
        assert.deepEqual(observed, selection ? [selection] : [], `command ${command}`);
      }

      Object.assign(configuration.language, { ui: 0, main: 2, sub: 1 });
      await refreshNativeLanguageMenu(engine);
      assert.deepEqual(
        choices.filter(({ state }) => state === 8).map(({ id }) => id),
        [40065, 40077, 40086],
      );
      configuration.language.sub = 0xffffffff;
      await refreshNativeLanguageMenu(engine);
      assert.deepEqual(
        choices.filter(({ state }) => state === 8).map(({ id }) => id),
        [40065, 40077, 40088],
      );
      await releaseNativeStartupMenu(engine);
      configuration.language.entries = configuration.language.entries.slice(0, 1);
      Object.assign(configuration.language, { default: 0, ui: 0, main: 0 });
      await initializeNativeStartupMenu(engine);
      assert.equal(top().length, 4);
      assert.equal(top()[3].label, 'ヘルプ(&H)');
    } finally {
      await engine.close();
    }
  },
);
