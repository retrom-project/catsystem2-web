// SPDX-License-Identifier: MPL-2.0
// Executes the original menu handler and its original event-packet helper.
// Native dialogs, shell, display mode and configuration UI are host boundaries.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeWindowMenuCommand } from '../src/native/window-commands.mjs';

const [filename, profile, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-window-actions.mjs EXE PROFILE IGNORED_REPORT',
  );
const engine = await NativeEngineProcess.open({
    bytes: new Uint8Array(await readFile(filename)),
    profile,
  }),
  p = engine.process,
  sdk = profile.startsWith('sdk-'),
  wide = !sdk,
  f = sdk
    ? {
        menu: 0x442080,
        route: 0x4bafc0,
        path: 0x577670,
        pause: 0x4b7fb0,
        resume: 0x4b80d0,
        full: 0x442780,
        window: 0x442860,
        update: 0x5c4280,
        gameConfig: 0x434e80,
        systemConfig: 0x435010,
        volume: 0x4a94f0,
        translate: 0x47ecf0,
        shellError: 0x578720,
        fullscreen: 52664,
        saveDirectory: 0x860,
        configTool: 0xc034,
        dialogs: new Map([
          [0x4341b0, 'resource-9'],
          [0x441390, 'resource-129'],
        ]),
      }
    : {
        menu: 0x530200,
        route: 0x5dec00,
        path: 0x6a7b80,
        pause: 0x5dbaf0,
        resume: 0x5dbc50,
        full: 0x530a20,
        window: 0x530b00,
        update: 0x712ad0,
        gameConfig: 0x522d50,
        systemConfig: 0x522e80,
        volume: 0x5cc4b0,
        translate: 0x5abe00,
        shellError: 0x6a82a0,
        fullscreen: 63372,
        saveDirectory: 2924,
        configTool: 52388,
        dialogs: new Map([
          [0x521f20, 'resource-9'],
          [0x52f5e0, 'resource-129'],
        ]),
      },
  menu = p.allocate(16, true),
  app = p.allocate(0x20000, true),
  core = p.allocate(64, true),
  root = p.allocate(104, true),
  pauseManager = p.allocate(64, true),
  soundSystem = p.allocate(64, true),
  translations = new Map(),
  suffix = sdk ? 'A' : 'W',
  trace = [],
  results = [];
let answer = 6;
const record = (name, ...args) => {
  trace.push([name, ...args]);
  return 0;
};
const string = (pointer) => (pointer ? p.string(pointer, wide) : null);
const write = (at, value) => engine.kernel.writeString(at, value, wide);
const expectThis = (expected) => assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, expected);
p.store(menu + 4, app);
p.store(app + 4, pauseManager);
p.store(app + 12, soundSystem);
p.store(root + 4, 77);
write(engine.refs.settings + f.saveDirectory, 'authored-save');
write(engine.refs.settings + f.configTool, 'authored-config.exe');
engine.patch(
  f.route,
  'original event dispatch host boundary',
  7,
  ([sender, target, message, w, packet, flags]) => {
    expectThis(root);
    assert.deepEqual([sender, target, message, w, flags], [0, 77, 11, 0, 0]);
    const words = Array.from({ length: 5 }, (_, i) => p.load(packet + i * 4));
    assert.deepEqual(words.slice(0, 2), [0, 0]);
    // Only these five words are initialized by the native helper.
    record('event', sdk && words[2] === 156 ? 158 : words[2], words[3], words[4]);
    return 1;
  },
  { calleePops: true },
);
for (const [name, expected] of [
  ['pause', pauseManager],
  ['resume', pauseManager],
  ['full', app],
  ['window', app],
  ['update', engine.refs.owner],
  ['gameConfig', app],
])
  engine.patch(f[name], `${name} platform boundary`, 0, () => {
    expectThis(expected);
    return record(name);
  });
engine.patch(f.systemConfig, 'native configuration DLL UI boundary', 0, () => {
  assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0, 0x1234);
  assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_EDX) >>> 0, app);
  return record('systemConfig');
});
engine.patch(
  f.volume,
  'system volume UI boundary',
  1,
  ([enabled]) => {
    expectThis(soundSystem);
    return record('volume', enabled);
  },
  { calleePops: true },
);
engine.patch(f.path, 'platform full-path boundary', 3, ([out, mode, source]) => {
  record('path', mode, string(source));
  write(out, 'C:\\authored-save');
  return out;
});
engine.patch(f.translate, 'global UI translation boundary', 1, ([source]) => {
  if (!translations.has(source)) {
    const translated = p.allocate(1024, true);
    write(translated, p.string(source, wide));
    translations.set(source, translated);
  }
  return translations.get(source);
});
engine.patch(f.shellError, 'platform shell-error UI boundary', 2, ([hwnd, result]) =>
  record('shellError', hwnd, result),
);
engine.registerWindows('USER32.dll', `PostMessage${suffix}`, {
  count: 4,
  fn: (args) => {
    record('post', ...args);
    return 1;
  },
});
engine.registerWindows('USER32.dll', `GetWindowLong${suffix}`, {
  count: 2,
  fn: (args) => {
    assert.deepEqual(args, [0x1234, 0xfffffffa]);
    return 0x7890;
  },
});
engine.registerWindows('USER32.dll', `DialogBoxParam${suffix}`, {
  count: 5,
  fn: ([instance, resource, hwnd, callback, data]) => {
    assert.deepEqual([instance, hwnd, data], [0x7890, 0x1234, app]);
    return record('dialog', resource, f.dialogs.get(callback));
  },
});
engine.registerWindows('USER32.dll', `MessageBox${suffix}`, {
  count: 4,
  fn: ([hwnd, body, caption, flags]) => {
    record('confirm', hwnd, string(body).slice(0, 11), string(caption).slice(0, 11), flags);
    return answer;
  },
});
engine.registerWindows('SHELL32.dll', `ShellExecute${suffix}`, {
  count: 6,
  fn: ([hwnd, operation, file, parameters, directory, show]) => {
    record(
      'shell',
      hwnd,
      string(operation),
      string(file),
      string(parameters),
      string(directory),
      show,
    );
    return 33;
  },
});
function expected(selector, { fullscreen, attached, hasRoot, yes }) {
  const pre = attached && hasRoot ? [['event', 158, 0, 1]] : [],
    path = ['path', 1, 'authored-save'];
  switch (selector) {
    case 0:
      return [
        ...pre,
        ['confirm', 0x1234, '$0000-0036$', '$0000-0035$', 4],
        ...(yes && attached && hasRoot ? [['event', 21, 0, 0]] : []),
      ];
    case 1:
      return [path, ['shell', 0, 'open', 'C:\\authored-save', '', '', 5]];
    case 2:
      return [...pre, ['post', 0x1234, 0x10, 0, 0]];
    case 10:
      return fullscreen ? [] : [['pause'], ['full'], ['update'], ['resume']];
    case 11:
      return !fullscreen ? [] : [['pause'], ['window'], ['update'], ['resume']];
    case 12:
      return [['post', 0x1234, 0x112, 0xf020, 0]];
    case 13:
      return attached && hasRoot ? [['event', 20, 0, 0]] : [];
    case 20:
      return [...pre, ['gameConfig']];
    case 21:
      return [...pre, ['systemConfig']];
    case 22:
      return [...pre, ['volume', 1]];
    case 30:
      return [...pre, ['dialog', 9, 'resource-9']];
    case 31:
      return [...pre, ['dialog', 129, 'resource-129']];
    case 32:
      return [
        ...pre,
        path,
        ['shell', 0x1234, 'open', 'authored-config.exe', null, 'C:\\authored-save', 1],
        ['shellError', 0x1234, 33],
      ];
    default:
      return [];
  }
}
try {
  for (const selector of [0, 1, 2, 10, 11, 12, 13, 20, 21, 22, 30, 31, 32])
    for (let variant = 0; variant < 16; variant++) {
      const state = {
        fullscreen: variant & 1,
        attached: Boolean(variant & 2),
        hasRoot: Boolean(variant & 4),
        yes: Boolean(variant & 8),
      };
      trace.length = 0;
      answer = state.yes ? 6 : 7;
      p.store(app + 16, state.attached ? core : 0);
      p.store(core + 8, state.hasRoot ? root : 0);
      p.store(engine.refs.settings + f.fullscreen, state.fullscreen);
      const command = nativeWindowMenuCommand(selector),
        result = await engine.call(
          f.menu,
          [0x1234, 0x111, (command | 0xabcd0000) >>> 0, 0, 0],
          menu,
        );
      assert.deepEqual(
        trace,
        expected(selector, state),
        `selector=${selector}, variant=${variant}`,
      );
      assert.equal(result, [2, 22, 30, 31].includes(selector) ? 1 : 0);
      results.push({ selector, variant, result, trace: trace.slice() });
    }
  for (const locked of [0, 1])
    for (const fullscreen of [0, 1]) {
      trace.length = 0;
      p.store(app + 44, locked);
      p.store(engine.refs.settings + f.fullscreen, fullscreen);
      const command = 40012,
        result = await engine.call(f.menu, [0x1234, 0x111, command, 0, 0], menu);
      assert.equal(result, 0);
      assert.deepEqual(
        trace,
        locked ? [] : [['pause'], [fullscreen ? 'window' : 'full'], ['update'], ['resume']],
      );
      results.push({ command, locked, fullscreen, result, trace: trace.slice() });
    }
  await writeFile(
    output,
    JSON.stringify(
      { profile, cases: results.length, comparisons: results.length * 2, results },
      null,
      2,
    ) + '\n',
  );
  console.log(`${profile}: ${results.length * 2} original menu action comparisons passed`);
} finally {
  await engine.close();
}
