// SPDX-License-Identifier: MPL-2.0
// Runs original Script wrappers and the application's private-message dispatch.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import {
  installNativeWindowCommands,
  NATIVE_WINDOW_COMMAND_CALLBACKS,
  nativeWindowMessageCommand,
} from '../src/native/window-commands.mjs';
const [filename, profile, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-window-commands.mjs EXE PROFILE IGNORED_REPORT',
  );
const engine = await NativeEngineProcess.open({
    bytes: new Uint8Array(await readFile(filename)),
    profile,
  }),
  sdk = profile.startsWith('sdk-'),
  p = engine.process,
  table = NATIVE_EXE_PROFILES[profile].tables.main.va,
  wndProc = NATIVE_WINDOW_COMMAND_CALLBACKS[profile],
  context = p.allocate(124, true),
  out = p.allocate(4, true),
  hwnd = 0x1234,
  handlers = new Map(),
  posts = [];
p.store(context + 120, hwnd);
let postResult = 1;
engine.registerWindows('USER32.dll', sdk ? 'PostMessageA' : 'PostMessageW', {
  count: 4,
  fn: (args) => {
    posts.push(args);
    return postResult;
  },
});
installNativeWindowCommands({
  runtime: {
    register: (table, id, handler) => {
      assert.equal(table, 'main');
      handlers.set(id, handler);
    },
  },
  window: { post: (message) => posts.push([hwnd, message, 0, 0]) },
});
let passed = 0;
async function compareDispatch(message, wParam, lParam) {
  posts.length = 0;
  await engine.call(wndProc, [0, hwnd, message, wParam, lParam, 0]);
  const command = nativeWindowMessageCommand(message, lParam);
  assert.deepEqual(posts, command === null ? [] : [[hwnd, 0x111, command, 0]]);
  passed++;
}
try {
  for (const selector of [-2147483648, -1, ...Array.from({ length: 45 }, (_, i) => i), 0x7fffffff])
    await compareDispatch(0x46c, 0, selector >>> 0);
  for (const id of [0x34d, 0x34e, 0x34f])
    for (postResult of [0, 1]) {
      posts.length = 0;
      p.store(out, 0xcccccccc);
      const control = await engine.call(p.load(table + id * 4), [0, context, 0xffffffff, out]),
        originalPosts = posts.splice(0),
        reply = handlers.get(id)([]);
      assert.deepEqual(reply, { control });
      assert.equal(p.load(out), 0xcccccccc);
      assert.deepEqual(posts, originalPosts);
      passed += 3;
      const [, message] = originalPosts[0];
      await compareDispatch(message, 0x12345678, 0xabcdef01);
    }
  await writeFile(output, JSON.stringify({ profile, comparisons: passed }, null, 2) + '\n');
  console.log(`${profile}: ${passed} original window command dispatches passed`);
} finally {
  await engine.close();
}
