// SPDX-License-Identifier: MPL-2.0
// Actual Steam broadcast helper, menu flag toggle/refresh and main41E.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeWindow } from '../src/native/window.mjs';
import { NativeSteam } from '../src/native/steam.mjs';
const [filename, output] = process.argv.slice(2),
  profile = 'nekopara-vol3-engine-2.6.1.76';
if (!output)
  throw new Error('Usage: node scripts/verify-native-broadcast.mjs FIXED_GAME_EXE IGNORED_REPORT');
const engine = await NativeEngineProcess.open({
    profile,
    bytes: new Uint8Array(await readFile(filename)),
  }),
  p = engine.process,
  context = p.allocate(128, true),
  video = p.allocate(4, true),
  vtable = p.allocate(8, true),
  manager = p.allocate(8200, true),
  menu = p.allocate(16, true),
  app = p.allocate(256, true),
  task = p.allocate(128, true),
  out = p.allocate(4),
  posts = [],
  nativeChecks = [],
  modelChecks = [];
let queryCalls = 0,
  queryValue = false,
  passed = 0;
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
p.store(video, vtable);
p.store(
  vtable + 4,
  p.trap('authored Steam Video IsBroadcasting', 1, ([result]) => {
    queryCalls++;
    p.store(result, Number(queryValue));
    return Number(!queryValue);
  }),
);
p.store(
  0xb6f01c,
  p.trap('authored SteamInternal_ContextInit', 0, () => context),
);
engine.patch(0x5dbaf0, 'platform menu pause boundary', 0, () => 0);
engine.patch(0x5dbc50, 'platform menu resume boundary', 0, () => 0);
engine.patch(0x7ce5a0, 'platform menu object boundary', 0, () => 0x1234);
engine.registerWindows('USER32.dll', 'SetMenuItemInfoW', {
  count: 4,
  fn: ([, command, , info]) => {
    if (command === 40096) nativeChecks.push([command, Boolean(p.load(info + 12) & 8)]);
    return 1;
  },
});
engine.registerWindows('USER32.dll', 'PostMessageW', {
  count: 4,
  fn: (args) => {
    posts.push(args);
    return 1;
  },
});
p.store(menu + 4, app);
p.store(task + 120, 0x3456);
const world = {
    profile,
    configuration: { authorMode: 0 },
    ensureNativeEngine: async () => engine,
    host: { nativeMenuChecked: (...args) => modelChecks.push(args) },
    windowMessages: [],
  },
  window = new NativeWindow(world);
try {
  for (const state of ['null', 'failed', 'ready'])
    for (const gate of [0, 1, 0xffffffff])
      for (const flag of [0, 1, 7, 0xffffffff])
        for (const sdkVideo of [null, false, true]) {
          const steam = new NativeSteam(
            state === 'null'
              ? null
              : {
                  isBroadcasting: () => {
                    modelQueries++;
                    return sdkVideo;
                  },
                },
          );
          if (state === 'failed') {
            steam.ready = false;
            steam.managerExists = true;
          }
          world.steamService = steam;
          world.configuration.authorMode = gate;
          p.store(0xb9bd9c, state === 'null' ? 0 : manager);
          p.store(manager, Number(state === 'ready'));
          p.store(context + 80, sdkVideo === null ? 0 : video);
          p.store(engine.refs.settings + 12506 * 4, gate);
          p.store(engine.refs.owner + 163524, flag);
          queryValue = sdkVideo;
          queryCalls = 0;
          let modelQueries = 0;
          if (sdkVideo === null && steam.provider) delete steam.provider.isBroadcasting;
          const expected = await engine.call(
            state === 'null' ? 0x713f70 : 0x5aedc0,
            [],
            state === 'null' ? engine.refs.owner : manager,
          );
          compare(
            await window.broadcast(),
            expected,
            'broadcast returns the native owner flag behind its author gate',
          );
          compare(
            modelQueries,
            queryCalls,
            'SDK video query is a side effect; its return and output do not determine the flag',
          );
        }
  for (const gate of [0, 1, 0xffffffff])
    for (const flag of [0, 1, 7, 0xffffffff]) {
      world.configuration.authorMode = gate;
      p.store(engine.refs.settings + 12506 * 4, gate);
      nativeChecks.length = 0;
      modelChecks.length = 0;
      p.store(engine.refs.owner + 163524, flag);
      const control = await engine.call(
          0x530200,
          [0x3456, 0x111, (0xabcd0000 | 40096) >>> 0, 0, 0],
          menu,
        ),
        expected = p.load(engine.refs.owner + 163524);
      compare(control, 0, 'original menu callback result');
      p.store(engine.refs.owner + 163524, flag);
      compare(
        await window.command((0xabcd0000 | 40096) >>> 0),
        true,
        'browser window consumes broadcast menu command',
      );
      compare(p.load(engine.refs.owner + 163524), expected, 'original flag toggle');
      compare(modelChecks, nativeChecks, 'menu check update is author-mode gated');
    }
  posts.length = 0;
  p.store(out, 0xcccccccc);
  compare(await engine.call(0x6507f0, [0, task, 0, out]), 2, 'main41E control');
  compare(p.load(out), 0xcccccccc, 'main41E leaves result untouched');
  compare(posts, [[0x3456, 0x468, 0, 0]], 'main41E posts return-title event');
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: engine.identity,
        passed,
        scope:
          'Original5AEDC0 Steam broadcast helper including actual settings/owner memory; null/failed/ready managers, missing/present Video interface, SDK boolean/out disagreement, raw flags and author gates. Original530200 menu toggle and530EB0 full refresh, authored platform pause/menu APIs. Complete original main41E wrapper PostMessageW/control/unwritten output.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original broadcast/window handler differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
