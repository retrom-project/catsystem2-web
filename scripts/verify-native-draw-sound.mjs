// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeDrawTask } from '../src/native/draw-task.mjs';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node scripts/verify-native-draw-sound.mjs FIXED_EXE REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Draw sound oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  [construct, receiver, frame, rendererConstruct] = sdk
    ? [0x4ce380, 0x4ce6c0, 0x4ce5e0, 0x5e3720]
    : [0x5f3c00, 0x5f3f50, 0x5f3e70, 0x742a10],
  [soundQuery, capture, level] = sdk ? [33, 209, 210] : [35, 211, 212],
  engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  [id, sound] = [17, 19],
  name = p.allocate(32, true),
  task = p.allocate(148, true),
  vtable = p.allocate(32, true),
  renderer = p.allocate(60, true),
  result = p.allocate(4, true),
  hostPackets = [],
  originalPackets = [],
  levels = new Map();
const world = {
    profile,
    engineMessages: { layout: { rootStart: soundQuery - 3 } },
    base: () => ({}),
    sendNativeEngine: async (target, from, message, w = 0, l = 0) => {
      hostPackets.push([from, target, message, w, l, 0]);
      return message === soundQuery ? sound : message === level ? (levels.get(w) ?? 0) : 0;
    },
    getNativeFeature: async () => ({ setAnimationVariable: () => {} }),
  },
  host = new NativeDrawTask({ world }, { id });
let operations = 0,
  checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ordered = (items) => items.toSorted((a, b) => a.key - b.key);
function tree() {
  const sentinel = p.load(p.load(task + 144)),
    entries = [];
  const walk = (node) => {
    if (node === sentinel) return;
    walk(p.load(node));
    entries.push({ key: p.load(node + 16), bank: p.load(node + 20), threshold: p.load(node + 24) });
    walk(p.load(node + 8));
  };
  walk(p.load(sentinel + 4));
  return entries;
}
try {
  for (const [name, definition] of nativeRectangleDefinitions(p))
    engine.registerWindows('USER32.dll', name, definition);
  engine.kernel.writeString(name, 'Authored Draw');
  await engine.call(construct, [id, name, 60, 0], task);
  const originalVTable = p.load(task);
  p.write(vtable, p.read(originalVTable, 32));
  p.store(
    vtable + 16,
    p.trap('independent original Draw sound packet transport', 7, (args) => {
      const [, target, message, w, , , out] = args;
      originalPackets.push(args.slice(0, 6));
      if (target === 0 && message === soundQuery) p.store(out, sound);
      else if (target === sound && message === level) p.store(out, levels.get(w) ?? 0);
      else assert.ok(target === sound && message === capture);
      return 1;
    }),
  );
  p.store(task, vtable);
  await engine.call(rendererConstruct, [8, 6, 4, 0], renderer);
  p.store(task + 108, renderer);
  const run = async (sender, slot, message, value) => {
    originalPackets.length = hostPackets.length = 0;
    p.store(result, 0xa5a5a5a5);
    if (message) {
      const raw = message - (sdk ? 5 : 0);
      check(await engine.call(receiver, [sender, raw, slot, value, 0, result], task), 0);
      check(await host.message([sender, message, slot, value]), 0);
      check(p.load(result), 0xa5a5a5a5, 'Draw leaves the command result word untouched');
    } else {
      check(await engine.call(frame, [operations, result], task), 1);
      await host.tick();
      if (!host.state.registrations.length)
        check(originalPackets.splice(0), [[id, 0, soundQuery, 0, 0, 0]]);
    }
    check(hostPackets, originalPackets, 'complete original sound envelopes and unsigned key order');
    check(ordered(host.state.registrations), tree(), 'complete live original registration map');
    operations++;
  };
  await run(3, 7, 311, 0xffffffff);
  for (const sender of [0, 7, 0x80000000, 0x43210003])
    for (const slot of [0, 4, 0x8000, 0xffff]) {
      await run(sender, slot, 313, 0xffffffff);
      await run(sender, slot, 311, (sender + slot) & 31);
      await run(sender, slot, 313, (sender ^ slot ^ 0xff800000) >>> 0);
      await run(sender, slot, 311, (sender + slot + 1) & 31);
    }
  for (let i = 0; i < 8; i++) {
    for (let bank = 0; bank < 32; bank++) levels.set(bank, ((i << 29) ^ bank) >>> 0);
    await run(0, 0, 0, 0);
  }
  for (const sender of [0x80000000, 7, 0, 0x43210003])
    for (const slot of [0xffff, 4, 0x8000, 0]) {
      await run(sender, slot, 311, 0xffffffff);
      await run(sender, slot, 311, 0xffffffff);
      await run(0, 0, 0, 0);
    }
  p.store(task, originalVTable);
  await engine.call(p.load(originalVTable), [1], task);
  check(p.allocations.has(task), false, 'original scalar destructor releases Draw');
  check(p.allocations.has(renderer), false, 'original Draw destructor releases the renderer');
  await writeFile(output, JSON.stringify({ profile, sha256, operations, checks }, null, 2) + '\n');
  console.log(`${profile}: ${checks} comparisons over ${operations} calls`);
} finally {
  await engine.close();
}
