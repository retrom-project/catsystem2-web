// SPDX-License-Identifier: MPL-2.0
// Complete original main411..414 handlers, singleton and achievement map.
// Only the external Steam SDK calls are authored platform boundaries.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeSteam, nativeSteam } from '../src/native/steam.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { KCSMachine, formatNativeAt } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
const [filename, output] = process.argv.slice(2),
  profile = 'nekopara-vol3-engine-2.6.1.76';
if (!output)
  throw new Error('Usage: node scripts/verify-native-steam.mjs FIXED_GAME_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, NATIVE_ENGINE_IMAGES[profile].sha256);
const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  argv = p.allocate(4),
  out = p.allocate(4),
  context = p.allocate(128, true),
  vtable = p.allocate(128, true),
  service = p.allocate(4, true),
  machine = new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(8192),
    stackSize: 1024,
  }),
  table = NATIVE_PROFILES[profile].tables.main.va;
let ready = false,
  original = [],
  model = [],
  initializations = 0,
  contexts = 0,
  passed = 0;
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
p.store(
  0xb6f034,
  p.trap('authored SteamAPI_Init', 0, () => {
    initializations++;
    return Number(ready);
  }),
);
// SteamInternal_ContextInit is cdecl: leaving the argument for its caller is
// essential; this oracle does not replace the original singleton constructor.
p.store(
  0xb6f01c,
  p.trap('authored SteamInternal_ContextInit', 0, () => {
    contexts++;
    return context;
  }),
);
p.store(service, vtable);
p.store(
  vtable + 28,
  p.trap('authored Steam SetAchievement', 1, ([name]) => {
    original.push(['achievement', p.string(name, false, 'utf-8')]);
    return 0;
  }),
);
p.store(
  vtable + 40,
  p.trap('authored Steam StoreStats', 0, () => {
    original.push(['store']);
    return 0;
  }),
);
p.store(
  vtable + 84,
  p.trap('authored Steam ResetAllStats', 1, ([all]) => {
    original.push(['reset', all]);
    return 0;
  }),
);
function attach(entries, serviceReady) {
  const manager = p.load(0xb9bd9c);
  if (entries === null) {
    p.store(manager + 8196, 0);
    return [];
  }
  const cache = p.allocate(12, true),
    header = p.allocate(72, true),
    nodes = [],
    sorted = [...entries].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  p.write(header + 13, Uint8Array.of(1));
  for (const [name, flag] of sorted) {
    const node = p.allocate(72, true),
      key = new TextEncoder().encode(name),
      at = key.length < 16 ? node + 16 : p.allocate(key.length + 1);
    p.write(at, Uint8Array.from([...key, 0]));
    if (key.length >= 16) p.store(node + 16, at);
    p.store(node + 32, key.length);
    p.store(node + 36, Math.max(15, key.length));
    p.store(node + 60, 15);
    p.write(node + 64, Uint8Array.of(flag));
    nodes.push(node);
  }
  const build = (lo, hi, parent) => {
    if (lo === hi) return header;
    const mid = (lo + hi) >> 1,
      node = nodes[mid];
    p.store(node, build(lo, mid, node));
    p.store(node + 4, parent);
    p.store(node + 8, build(mid + 1, hi, node));
    return node;
  };
  p.store(header, nodes[0] ?? header);
  p.store(header + 4, build(0, nodes.length, header));
  p.store(header + 8, nodes.at(-1) ?? header);
  p.store(cache, serviceReady ? service : 0);
  p.store(cache + 4, header);
  p.store(cache + 8, nodes.length);
  p.store(manager + 8196, cache);
  return nodes;
}
async function run(id, steam, name = '') {
  const text = typeof name === 'string' ? new TextEncoder().encode(name) : name;
  machine.bytes(0, text.length + 1).set([...text, 0]);
  const args = id === 0x412 || id === 0x413 ? [0] : [],
    bridge = new NativeKCSMemory(p, machine);
  let expected;
  try {
    p.store(argv, 0);
    p.store(out, 0xcccccccc);
    const control = await engine.call(p.load(table + id * 4), [bridge.pointer, 0, argv, out]);
    expected = { control, ...(control === 1 ? { value: p.load(out) } : {}) };
  } finally {
    bridge.close();
  }
  compare(
    await nativeSteam(id, args, machine, {
      profile,
      steamService: steam,
      runtime: { services: { formatBytes: formatNativeAt } },
    }),
    expected,
    `main${id.toString(16)} complete wrapper result`,
  );
  compare(model, original, 'external SDK call order and arguments');
}
try {
  for (const available of [false, true])
    for (const cacheMode of ['none', 'without-service', 'ready']) {
      ready = available;
      original = [];
      model = [];
      initializations = 0;
      contexts = 0;
      p.store(0xb9bd9c, 0);
      const entries =
          cacheMode === 'none'
            ? null
            : new Map([
                ['locked', 0],
                ['already', 255],
                ['long achievement identifier 12345', 0],
                ['猫の実績', 2],
              ]),
        provider = {
          initialize: () => available,
          achievements: entries,
          statsReady: cacheMode !== 'without-service',
          achievement: (name) => {
            model.push(['achievement', name], ['store']);
            return false;
          },
          resetAllStats: (all) => {
            model.push(['reset', all]);
            return false;
          },
        },
        steam = new NativeSteam(provider);
      await run(0x413, steam, 'already');
      await run(0x412, steam, 'locked');
      await run(0x414, steam);
      await run(0x411, steam);
      await run(0x411, steam);
      compare(initializations, 1, 'native singleton initialization is attempted once');
      compare(contexts, Number(available), 'context lookup follows successful SteamAPI_Init only');
      compare(
        Boolean(p.load(0xb9bd9c)),
        steam.managerExists,
        'failed initialization still owns a manager',
      );
      const nodes = attach(entries, provider.statsReady);
      steam.refreshAchievements(entries);
      for (const name of [
        'locked',
        'locked',
        'already',
        'long achievement identifier 12345',
        '猫の実績',
        'unknown',
        Uint8Array.of(0xff, 0x81),
        '',
      ]) {
        await run(0x413, steam, name);
        await run(0x412, steam, name);
        await run(0x413, steam, name);
      }
      if (entries)
        compare(
          nodes.map((node) => p.read(node + 64, 1)[0]),
          [...steam.achievements.values()]
            .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
            .map((e) => e.unlocked),
          'cached byte flags before reset',
        );
      await run(0x414, steam);
      if (entries)
        compare(
          nodes.map((node) => p.read(node + 64, 1)[0]),
          [...steam.achievements.values()]
            .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
            .map((e) => e.unlocked),
          'all cached flags after reset, including unavailable SDK service',
        );
      for (const name of ['locked', 'already', 'unknown', '猫の実績'])
        await run(0x413, steam, name);
      await steam.close();
    }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Actual main411..414 wrappers, original byte formatter, singleton constructor, std::map lookup, cached flag updates and reset traversal. External Steam SDK calls only are authored. Null manager, failed/successful initialization, absent cache/service, empty/unknown/long/UTF-8/malformed names, repeated unlock, SDK false returns, reset and unwritten GCALL result are compared.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original Steam handler differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
