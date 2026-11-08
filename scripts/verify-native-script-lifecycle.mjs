// SPDX-License-Identifier: MPL-2.0
// Actual Script constructor/load/enable/debug/dump/reload/destructor and main8F.
// Mounted files, category formatting and task transport are host boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { kcsProgram, memoryGame } from '../tests/helpers.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-script-lifecycle.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Script lifecycle oracle requires a frozen engine');
const sdk = profile.startsWith('sdk-'),
  configuration = new NativeConfiguration({ profile }),
  engine = await NativeEngineProcess.open({ bytes, profile, configuration, trace: true }),
  p = engine.process,
  main = sdk ? 0xb3c900 : 0xa2dd38,
  originalVFT = sdk ? 0x992ec4 : 0x8cdbe4,
  handler = p.load(originalVFT + 28),
  ctor = sdk ? 0x4c4b60 : 0x5e8840,
  dtor = sdk ? 0x4c4d30 : 0x5e8a10,
  rawMessage = (id) => (sdk && id === 330 ? 325 : sdk && id >= 37 ? id - 2 : id);
let passed = 0,
  uninitializedDebugQueries = 0,
  activeFiles,
  activeRaw,
  transport = [];
const check = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
engine.kernel.registerFiles('script-lifecycle', {
  read: (path) => {
    const match = /^@cat\/kcs\/(.*)$/.exec(path);
    return activeFiles.read(match?.[1] ?? path);
  },
});
new NativeEngineFiles(engine, { game: { readCategory: (name) => activeFiles.read(name) } });
engine.registerFeature('task-memory', {
  guestAddress: () => p.load(p.load(activeRaw + 112) + 20),
  // This oracle normalizes VM data addresses at the explicit transport boundary.
  // Shared RAM identity is exercised by native-shared-memory.test.mjs instead.
  bindSharedMachine: () => false,
  releaseMachine() {},
  snapshot: () => ({}),
  restore() {},
});
const virtual = p.allocate(32, true);
const appendedPacket = p.allocate(16, true),
  originalNative1 = p.load(main + 4);
p.store(
  main + 4,
  p.trap(
    'authored native callback appends a Script packet',
    4,
    async ([_vm, source, _args, out]) => {
      [7, 0x2222, 3, 4].forEach((word, i) => p.store(appendedPacket + i * 4, word));
      await engine.callFromHost(
        handler,
        [p.load(source + 4), rawMessage(173), 0, appendedPacket, 0, out],
        source,
      );
      return 2;
    },
  ),
);
p.write(virtual, p.read(originalVFT, 32));
p.store(
  virtual + 16,
  p.trap('Script task transport boundary', 7, async ([sender, target, id, w, l, flags, out]) => {
    transport.push({ sender, target, id: sdk && id >= 35 ? id + 2 : id, w, l, flags });
    if (id === rawMessage(176)) {
      p.store(l, 0);
      return 1;
    }
    if (id === 25) {
      p.write(l, Uint8Array.of(0));
      return 1;
    }
    await engine.callFromHost(handler, [sender, id, w, l, flags, out], activeRaw);
    return 1;
  }),
);
try {
  for (const initial of [0, 1])
    for (let trial = 0; trial < 8; trial++) {
      const mounted = {
        'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
        'other.kcs': kcsProgram(
          [[65, 100 + trial, 64], [37, 1088], [43, 0x47, 4], [59]],
          [[64, 'native script']],
        ),
      };
      activeFiles = memoryGame(mounted);
      const random = new ParticleRandom(),
        world = new NativeWorld({
          game: activeFiles,
          images: {},
          host: {},
          profile,
          configuration: new NativeConfiguration({ profile }),
          random,
          motionLibrary: new MotionLibrary(activeFiles, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      let bridge,
        raw = 0,
        name = 0,
        parent = 0,
        rootName = 0,
        args = 0,
        result = 0,
        dump = 0;
      try {
        await world.initialize('main.kcs');
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        const target = await world.objects.create({
            kind: 12,
            parent: world.root,
            name: 'Authored Script',
          }),
          record = world.objects.objects.get(target),
          caller = world.main;
        caller.machine.writeString('other.kcs', 64);
        bridge = new NativeKCSMemory(p, caller.machine);
        raw = p.allocate(1024, true);
        activeRaw = raw;
        name = p.allocate(64, true);
        p.write(name, encodeCP932('Authored Script\0'));
        parent = p.allocate(1024, true);
        rootName = p.allocate(32, true);
        await engine.call(sdk ? 0x4b8cd0 : 0x5dcab0, [0, rootName, 60], parent);
        await engine.call(ctor, [world.nativeTaskID(target), name, 60, 0, 0, 0, 0, rootName], raw);
        p.store(raw, virtual);
        p.store(raw + 12, parent);
        const source = p.allocate(1024, true);
        p.store(source, virtual);
        p.store(source + 4, world.nativeTaskID(caller.id));
        p.store(source + 132, p.load(bridge.pointer + 40));
        p.store(source + 136, caller.machine.shared.length);
        args = p.allocate(12, true);
        [world.nativeTaskID(target), 64, initial].forEach((n, i) => p.store(args + i * 4, n));
        result = p.allocate(4, true);
        p.store(result, 0x35ad6c12);
        transport = [];
        const control = await engine.call(p.load(main + 0x8f * 4), [
          bridge.pointer,
          source,
          args,
          result,
        ]);
        check(p.load(result), 0x35ad6c12, 'main8F unwritten output');
        const model = await world.runtime.native(
          'main',
          0x8f,
          [world.nativeTaskID(target), 64, initial],
          caller.machine,
          caller,
        );
        check(control, model.control, 'main8F control');
        const m = record.implementation.machine,
          vm = p.load(raw + 112);
        check(
          [p.load(vm + 16), p.load(vm + 24), p.load(vm + 28), p.load(vm + 32)],
          [m.pc, m.sp, m.floor, m.fp],
          'loaded VM frame',
        );
        check(p.read(p.load(vm + 20), m.memory.length), m.memory, 'loaded VM bytes');
        check(record.scriptEnabled, p.load(raw + 124), 'load running flag');
        check(record.scriptLoaded, p.load(raw + 128), 'load completed flag');
        check(p.load(vm + 44), m.shared.length, 'load shared length');
        const query = p.allocate(520, true);
        p.write(query, new Uint8Array(520).fill(0x5a));
        await engine.call(handler, [3, rawMessage(163), 0, query, 0, result], raw);
        check(p.load(query), p.load(vm + 20), 'raw contiguous memory pointer');
        p.store(query, 0);
        await world.sendEngine(target, caller.id, 163, 0, query, {
          payload: p,
          nativePointer: true,
        });
        check(p.load(query), p.load(vm + 20), 'mapped model contiguous memory pointer');
        if (initial) {
          await engine.call(handler, [3, rawMessage(167), query, query + 4, 0, result], raw);
          const location = p.read(query, 520);
          p.write(query, new Uint8Array(520).fill(0x5a));
          await world.sendEngine(target, caller.id, 167, query, query + 4, {
            payload: p,
            nativePointer: true,
          });
          check(p.read(query, 520), location, 'debug line and file preserve output padding');
        } else uninitializedDebugQueries++;
        p.store(query, 0xdeadbeef);
        p.store(query + 4, 0xdeadbeef);
        await engine.call(handler, [3, rawMessage(175), query, query + 4, 0, result], raw);
        check(p.read(query, 8), new Uint8Array(8), 'original absent scene pointers');
        p.store(query, 0xdeadbeef);
        p.store(query + 4, 0xdeadbeef);
        await world.sendEngine(target, caller.id, 175, query, query + 4, {
          payload: p,
          nativePointer: true,
        });
        check(p.read(query, 8), new Uint8Array(8), 'model absent scene pointers');
        for (const id of [161, 162])
          for (const w of [world.nativeTaskID(target), 0xffffffff])
            for (const l of [0, 1, 2, 3, 0xffffffff]) {
              p.store(result, 0xcafebabe);
              await engine.call(handler, [3, rawMessage(id), w, l, 0, result], raw);
              check(
                await world.sendEngine(target, caller.id, id, w, l),
                NATIVE_UNWRITTEN_WORD,
                'mode unwritten result',
              );
              check(p.load(result), 0xcafebabe, 'raw mode unwritten result');
              check(record.scriptEnabled, p.load(raw + 124), 'mode task field');
              check(m.executionMode, p.load(vm + 1380), 'mode VM field');
              check(m.debugBreakPC, p.load(vm + 1384), 'mode break PC');
            }
        for (const id of [166, 170]) {
          const w = (0x12345678 + trial) >>> 0,
            l = (0xaabbccdd - trial) >>> 0;
          p.store(result, 0xcafebabe);
          await engine.call(handler, [3, rawMessage(id), w, l, 0, result], raw);
          await world.sendEngine(target, caller.id, id, w, l);
          check(
            id === 166
              ? [record.scriptDebugCallback, record.scriptDebugData]
              : [record.scriptDebugHook, m.debugHook],
            id === 166
              ? [p.load(raw + 140), p.load(raw + 144)]
              : [p.load(raw + 148), p.load(vm + 1376)],
            'debug fields',
          );
          check(p.load(result), 0xcafebabe, 'debug fields unwritten');
        }
        const pointer = p.allocate(4, true);
        for (const address of [0, 4, m.memory.length - 1, m.memory.length, 0x80000004, 0xffffffff])
          for (const w of [0, 1]) {
            p.store(pointer, address);
            await engine.call(handler, [3, rawMessage(169), w, pointer, 0, result], raw);
            const expected = p.load(pointer);
            p.store(pointer, address);
            await world.sendEngine(target, caller.id, 169, w, pointer, {
              payload: p,
              nativePointer: true,
            });
            check(p.load(pointer), expected, 'relative pointer');
          }
        p.free(pointer);
        // The only normalized field is the data pointer: original and browser
        // VMs have distinct, explicitly mapped native allocations in this probe.
        m.setExecutionMode(1);
        p.store(vm + 1380, 1);
        p.store(raw + 124, 1);
        record.scriptEnabled = 1;
        const size = await world.sendEngine(target, caller.id, 15);
        p.store(result, 0xcafebabe);
        await engine.call(handler, [3, 15, 0, 0, 0, result], raw);
        check(size, p.load(result), 'dump size');
        dump = p.allocate(size, true);
        p.write(dump, new Uint8Array(size).fill(0x5a));
        await engine.call(handler, [3, 16, 0, dump, 0, result], raw);
        const nativeDump = p.read(dump, size);
        p.write(dump, new Uint8Array(size).fill(0x5a));
        await world.sendEngine(target, caller.id, 16, 0, dump, { payload: p, nativePointer: true });
        const modelDump = p.read(dump, size);
        new DataView(nativeDump.buffer).setUint32(68, 0, true);
        new DataView(modelDump.buffer).setUint32(68, 0, true);
        check(modelDump, nativeDump, 'complete Script dump bytes');
        // Actual 16-byte deque entries, including the separately allocated VM
        // string. The scope notification descends from this Script directly.
        const child = await world.objects.create({ kind: 12, parent: target, name: 'CHILD' }),
          childRecord = world.objects.objects.get(child),
          rawChild = p.allocate(1024, true),
          registration = p.allocate(24, true),
          contextPointer = p.allocate(32, true),
          contextBytes = Uint8Array.of(0x81, 0x30, 0xfa, 0x40, 65 + trial, 0);
        await engine.call(
          ctor,
          [world.nativeTaskID(child), rootName, 60, 0, 0, 0, 0, rootName],
          rawChild,
        );
        [world.nativeTaskID(target), 3, 2, world.nativeTaskID(child), rawChild, 0].forEach(
          (word, i) => p.store(registration + i * 4, word),
        );
        await engine.call(sdk ? 0x4b9360 : 0x5dd130, [registration, result], raw);
        p.write(contextPointer, contextBytes);
        if (trial % 2) {
          await engine.call(
            handler,
            [3, rawMessage(161), world.nativeTaskID(target), 0, 0, result],
            raw,
          );
          await world.sendEngine(target, caller.id, 161, world.nativeTaskID(target), 0);
        }
        p.store(result, 0xcafebabe);
        await engine.call(handler, [3, rawMessage(330), trial, contextPointer, 0, result], raw);
        check(
          await world.sendEngine(target, caller.id, 330, trial, contextPointer, {
            payload: p,
            nativePointer: true,
          }),
          p.load(result),
          'context notification output',
        );
        const queue = p.load(raw + 188),
          nativeMessages = Array.from({ length: p.load(queue + 16) }, (_, i) => {
            const index = p.load(queue + 12) + i,
              entry = p.load(p.load(queue + 4) + ((p.load(queue + 8) - 1) & index) * 4);
            return Array.from({ length: 4 }, (_, j) => p.load(entry + j * 4));
          });
        check(record.implementation.task.messages, nativeMessages, 'actual queued packet bytes');
        const nativeString = await engine.call(
          sdk ? 0x8a6910 : 0x8772a0,
          [nativeMessages.at(-1)[3]],
          vm,
        );
        check(
          p.read(nativeString, contextBytes.length),
          m.bytes(nativeMessages.at(-1)[3], contextBytes.length),
          'separate owned VM string',
        );
        for (const [model, native] of [
          [record, raw],
          [childRecord, rawChild],
        ]) {
          p.write(query, new Uint8Array(520).fill(0x5a));
          await engine.call(handler, [3, 25, 0, query, 0, result], native);
          const expected = p.read(query, 520);
          p.write(query, new Uint8Array(520).fill(0x5a));
          await world.sendEngine(model.id, caller.id, 25, 0, query, {
            payload: p,
            nativePointer: true,
          });
          check(p.read(query, 520), expected, 'context byte preservation and child propagation');
        }
        await engine.call(p.load(originalVFT + 8), [10, 1], raw);
        await record.implementation.tick();
        check(record.scriptEnabled, p.load(raw + 124), 'queued frame running flag');
        check(m.memory, p.read(p.load(vm + 20), m.memory.length), 'queued frame entire VM memory');
        check(
          record.implementation.task.messages.length,
          p.load(queue + 16),
          'queued frame drains actual deque',
        );
        check(
          [m.pc, m.sp, m.floor, m.fp],
          [p.load(vm + 16), p.load(vm + 24), p.load(vm + 28), p.load(vm + 32)],
          'queued frame PC/SP/floor/FP',
        );
        [3, 0x11223344, trial, 0xffffffff].forEach((value, i) => p.store(query + i * 4, value));
        await engine.call(handler, [3, rawMessage(173), 0, query, 0, result], raw);
        await world.sendEngine(target, caller.id, 173, 0, query, {
          payload: p,
          nativePointer: true,
        });
        p.write(contextPointer, encodeCP932('missing.kcs\0'));
        record.exitCode = 1234;
        p.store(raw + 80, 1234);
        record.scriptStringDirty = 9;
        p.store(raw + 184, 9);
        await engine.call(handler, [3, rawMessage(160), 1, contextPointer, 0, result], raw);
        await world.sendEngine(target, caller.id, 160, 1, contextPointer, {
          payload: p,
          nativePointer: true,
        });
        check(record.implementation.machine, null, 'failed reload removes old interpreter');
        check(p.load(raw + 112), 0, 'raw failed reload removes old interpreter');
        check(record.scriptEnabled, p.load(raw + 124), 'failed reload running word');
        check(record.scriptLoaded, p.load(raw + 128), 'failed reload loaded word');
        check(record.exitCode, p.load(raw + 80) | 0, 'failed reload retains exit code');
        check(
          record.scriptStringDirty,
          p.load(raw + 184),
          'failed reload retains per-task string dirty',
        );
        check(
          record.scriptMessages.length,
          p.load(queue + 16),
          'failed reload preserves queued packet',
        );
        for (const clear of [0, 1, 0]) {
          p.write(query, new Uint8Array(520).fill(0x5a));
          p.store(result, 0xcafebabe);
          await engine.call(handler, [3, rawMessage(178), clear, query, 0, result], raw);
          const expected = p.read(query, 520);
          p.write(query, new Uint8Array(520).fill(0x5a));
          await world.sendEngine(target, caller.id, 178, clear, query, {
            payload: p,
            nativePointer: true,
          });
          check(p.read(query, 520), expected, 'per-task string dirty query and clear');
          check(record.scriptStringDirty, p.load(raw + 184), 'per-task dirty state after clear');
          check(p.load(result), 0xcafebabe, 'string dirty output word remains unwritten');
        }
        for (const id of [163, 164, 165, 167, 168, 169, 170, 171, 174]) {
          p.write(query, new Uint8Array(520).fill(0x5a));
          p.store(result, 0xcafebabe);
          check(
            await engine.call(handler, [3, rawMessage(id), query, query + 4, 0, result], raw),
            0,
            'missing interpreter handled',
          );
          await world.sendEngine(target, caller.id, id, query, query + 4, {
            payload: p,
            nativePointer: true,
          });
          check(
            p.read(query, 520),
            new Uint8Array(520).fill(0x5a),
            'missing interpreter preserves pointed bytes',
          );
          check(p.load(result), 0xcafebabe, 'missing interpreter leaves output unwritten');
        }
        const dumpContext = { payload: p, nativePointer: true };
        p.store(result, 0xcafebabe);
        check(
          await engine.call(handler, [3, 16, 0, query, 0, result], raw),
          1,
          'absent VM dump unhandled',
        );
        check(
          await world.sendEngine(target, caller.id, 16, 0, query, dumpContext),
          NATIVE_UNWRITTEN_WORD,
          'absent VM dump unwritten',
        );
        check(dumpContext.nativeUnhandled, true, 'absent VM dump nativeUnhandled');
        check(p.load(result), 0xcafebabe, 'absent VM dump output remains unwritten');
        mounted['other.kcs'] = kcsProgram(
          [[65, 1000 + trial, 64], [37, 1152], [43, 0x47, 4], [59]],
          [[64, 'replacement script']],
        );
        p.write(contextPointer, encodeCP932('other.kcs\0'));
        await engine.call(handler, [3, rawMessage(160), 1, contextPointer, 0, result], raw);
        await world.sendEngine(target, caller.id, 160, 1, contextPointer, {
          payload: p,
          nativePointer: true,
        });
        const renewed = record.implementation.machine,
          renewedVM = p.load(raw + 112);
        check(
          renewed.debug.line,
          p.load(renewedVM + 76),
          'same-filename reload reads replacement code',
        );
        check(
          record.implementation.task.messages.length,
          p.load(queue + 16),
          'successful reload retains deferred queue',
        );
        await engine.call(p.load(originalVFT + 8), [11, 1], raw);
        await record.implementation.tick();
        check(
          renewed.memory,
          p.read(p.load(renewedVM + 20), renewed.memory.length),
          'preserved packet delivered to replacement VM',
        );
        check(record.scriptEnabled, p.load(raw + 124), 'replacement VM frame completion');
        check(
          record.scriptMessages.length,
          p.load(queue + 16),
          'replacement VM drains persistent queue',
        );
        mounted['append.kcs'] = kcsProgram([
          [37, 128],
          [43, 0x47, 4],
          [43, 1, 0],
          [37, 128],
          [43, 0x47, 4],
          [59],
        ]);
        world.runtime.register('main', 1, async () => {
          await world.sendEngine(target, target, 173, 0, 0, {
            payload: { load: (at) => [7, 0x2222, 3, 4][at / 4] },
          });
          return { control: 2 };
        });
        p.write(contextPointer, encodeCP932('append.kcs\0'));
        await engine.call(handler, [3, rawMessage(160), 1, contextPointer, 0, result], raw);
        await world.sendEngine(target, caller.id, 160, 1, contextPointer, {
          payload: p,
          nativePointer: true,
        });
        [7, 0x1111, 3, 4].forEach((word, i) => p.store(query + i * 4, word));
        await engine.call(handler, [3, rawMessage(173), 0, query, 0, result], raw);
        await world.sendEngine(target, caller.id, 173, 0, query, {
          payload: p,
          nativePointer: true,
        });
        await engine.call(p.load(originalVFT + 8), [12, 1], raw);
        await record.implementation.tick();
        const appended = record.implementation.machine,
          appendedVM = p.load(raw + 112);
        check(
          appended.memory,
          p.read(p.load(appendedVM + 20), appended.memory.length),
          'same-frame append complete VM bytes',
        );
        check(appended.load(132), 0x2222, 'appended packet delivered in original frame');
        check(p.load(queue + 16), 0, 'original live deque drained');
        check(record.scriptMessages.length, 0, 'model live deque drained');
        check(record.scriptEnabled, p.load(raw + 124), 'live deque frame completion');
        p.free(query);
        p.free(contextPointer);
        p.free(registration);
        p.free(source);
      } finally {
        bridge?.close();
        if (raw) {
          await engine.call(dtor, [], raw);
          p.free(raw);
        }
        if (parent) {
          await engine.call(sdk ? 0x4b8dc0 : 0x5dcba0, [], parent);
          p.free(parent);
        }
        for (const pointer of [name, rootName, args, result, dump]) if (pointer) p.free(pointer);
        world.nativeEngine = null;
        world.nativeEngineLoading = null;
        await world.close({ flushFiles: false });
      }
    }
  console.log(`Native Script lifecycle passed ${passed}/${passed}`);
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        uninitializedDebugQueries,
        authoredNativeCallbacks: [1],
        scope:
          'Original constructors, main8F, Script160..178 guards/debug/pointers, loaded15/16 complete dump,330 actual deque and child byte propagation, original frame drain and failed reload. Category/files and main8F task transport are explicit host boundaries; VM data pointers normalized between separate allocations.',
        patches: engine.patches,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  p.store(main + 4, originalNative1);
  p.free(appendedPacket);
  await engine.close();
}
