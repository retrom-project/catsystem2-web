// SPDX-License-Identifier: MPL-2.0
// Runs the original application callback only for its 0x46C dispatch branch.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeWindowMenuCommand } from '../src/native/window-commands.mjs';
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
  posts = [];
engine.registerWindows('USER32.dll', sdk ? 'PostMessageA' : 'PostMessageW', {
  count: 4,
  fn: (args) => {
    posts.push(args);
    return 1;
  },
});
let passed = 0;
try {
  for (const selector of [
    -2147483648,
    -1,
    ...Array.from({ length: 45 }, (_, i) => i),
    0x7fffffff,
  ]) {
    posts.length = 0;
    await engine.call(sdk ? 0x442a30 : 0x531670, [0, 0x1234, 0x46c, 0, selector >>> 0, 0]);
    const command = nativeWindowMenuCommand(selector);
    assert.deepEqual(posts, command === null ? [] : [[0x1234, 0x111, command, 0]]);
    passed++;
  }
  await writeFile(output, JSON.stringify({ profile, comparisons: passed }, null, 2) + '\n');
  console.log(`${profile}: ${passed} original window command dispatches passed`);
} finally {
  await engine.close();
}
