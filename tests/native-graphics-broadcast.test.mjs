// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativePlaneReceiver } from '../src/native/graphics-task.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { createTextureMemoryWorld } from './fixtures/texture-clear-fixture.mjs';
import { kcsProgram } from './helpers.mjs';

// Build a small authored MSVC route tree for the unmodified PE helper. The
// original signed lookup and iterator read the same node layout in both PEs.
function originalRoutes(p, allocate, pointer, entries) {
  const map = allocate(8),
    end = allocate(24);
  p.store(end + 12, 0x0101);
  const build = (first, last, parent) => {
    if (first === last) return end;
    const middle = (first + last) >>> 1,
      node = allocate(24),
      [key, target] = entries[middle];
    [build(first, middle, node), parent, build(middle + 1, last, node), 0, key, target].forEach(
      (value, i) => p.store(node + i * 4, value),
    );
    if (middle === 0) p.store(end, node);
    if (middle === entries.length - 1) p.store(end + 8, node);
    return node;
  };
  p.store(end + 4, build(0, entries.length, end));
  p.store(map, end);
  p.store(map + 4, entries.length);
  p.store(pointer + 8, map);
}

for (const [profile, path, broadcast, rawMessage] of [
  ['nekopara-vol3-engine-2.6.1.76', process.env.CATSYSTEM2_ENGINE_EXE, 0x5dfbd0, 0x353],
  ['sdk-4.01-engine-2.6.1.74', process.env.CATSYSTEM2_SDK_EXE, 0x4bbf70, 0x351],
])
  test(
    `${profile} plane broadcasts match original signed traversal and shared writes across restore`,
    {
      skip: !path,
    },
    async () => {
      const files = new Map([
          ['engine.exe', new Uint8Array(await readFile(path))],
          ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]])],
        ]),
        signedID = 0xfffffff9,
        trace = [],
        observe = (id, sender, message, w, l, flags, out, memory) => {
          const previous = memory.load(l);
          trace.push([id, sender, message, w, l, flags, memory.load(out), previous]);
          memory.store(l, previous + 1);
          if (id === signedID) return 0;
          if (id === 120) return 0x13579bdf;
          return NATIVE_UNWRITTEN_WORD;
        },
        make = () => {
          const owner = createTextureMemoryWorld(profile, files);
          owner.objects.register(0x7ffe, (record) => {
            const base = owner.base(record);
            return {
              ...base,
              message(words, context) {
                if (words[1] !== 0x353) return base.message(words, context);
                const [sender, , w, l] = words;
                context.nativeUnhandled = false;
                return observe(
                  record.nativeID,
                  sender,
                  rawMessage,
                  w,
                  l,
                  context.flags,
                  context.nativeResult,
                  context.payload,
                );
              },
            };
          });
          return owner;
        },
        world = make();
      let fresh, plane, restored;
      try {
        // The packet helper has no renderer dependency. Mount the original
        // task constructors without starting the game's GPU bootstrap here.
        await world.ensureNativeEngine();
        world.root = await world.objects.create({ kind: 1, name: 'Authored Top' });
        world.main = await world.spawnScript('main.kcs');
        await world.tick();
        const parent = await world.objects.create({
            kind: 2,
            parent: world.main.id,
            nativeID: 30,
            name: 'Parent plane',
          }),
          probe = (parent, nativeID) =>
            world.objects.create({ kind: 0x7ffe, parent, nativeID, name: 'Packet probe' }),
          branch = await probe(parent, 120);
        plane = new NativePlaneReceiver(world.graphics.get(parent));
        await probe(branch, 80);
        await probe(parent, signedID);
        const removed = await probe(parent, 99);
        await world.objects.release(removed);

        const engine = world.nativeEngine,
          p = engine.process,
          allocate = (size) => p.allocate(size, true),
          source = allocate(4),
          result = allocate(4),
          args = [rawMessage, 0x12345678, source, 1, result],
          run = async (engine, pointer) => {
            const p = engine.process;
            trace.length = 0;
            p.store(source, 30);
            p.store(result, 0xdecafbad);
            await engine.call(broadcast, args, pointer, { task: parent });
            return { packets: trace.slice(), result: p.load(result), source: p.load(source) };
          },
          actual = await run(engine, plane.task.pointer),
          saved = world.snapshot();
        fresh = make();
        await fresh.restore(saved);
        restored = new NativePlaneReceiver(fresh.graphics.get(parent));

        const original = allocate(88),
          vft = allocate(28),
          rawTask = (id) => {
            const pointer = allocate(88);
            p.store(pointer, vft);
            p.store(pointer + 4, id);
            return pointer;
          },
          signed = rawTask(signedID),
          rawBranch = rawTask(120),
          descendant = rawTask(80);
        p.store(
          vft + 24,
          p.trap('authored original plane broadcast packet', 2, ([packet, out]) => {
            const words = Array.from({ length: 6 }, (_, i) => p.load(packet + i * 4)),
              value = observe(...words, out, p);
            if (value !== NATIVE_UNWRITTEN_WORD) p.store(out, value);
            return 0;
          }),
        );
        p.store(original + 4, 30);
        originalRoutes(p, allocate, original, [
          [signedID, signed],
          [80, rawBranch],
          [99, 0],
          [120, rawBranch],
        ]);
        originalRoutes(p, allocate, rawBranch, [[80, descendant]]);
        const reference = await run(engine, original);
        assert.deepEqual(reference, {
          packets: [
            [signedID, 30, rawMessage, args[1], source, 1, 0xdecafbad, 30],
            [80, 30, rawMessage, args[1], source, 1, 0, 31],
            [120, 30, rawMessage, args[1], source, 1, 0, 32],
          ],
          result: 0x13579bdf,
          source: 33,
        });
        assert.deepEqual(actual, reference);
        assert.deepEqual(await run(fresh.nativeEngine, restored.task.pointer), reference);
      } finally {
        restored?.close();
        plane?.close();
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
