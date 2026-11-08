// SPDX-License-Identifier: MPL-2.0
// Original kcTaskScript raw messages, with actual KCS message continuation.
// Queue insertion is an explicit packet-capture boundary; it does not replace
// the synchronous VM interpreter, packet writeback or bank-query branches.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { nodeGame } from './node-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, kcsProgram } from '../tests/helpers.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';

const [root, profile, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-script.mjs FIXED_DIRECTORY PROFILE IGNORED_REPORT',
  );
const sdk = profile.startsWith('sdk-'),
  game = await nodeGame(root),
  engine = await NativeEngineProcess.open({ game, profile }),
  p = engine.process,
  vft = sdk ? 0x992ec4 : 0x8cdbe4,
  handler = p.load(vft + 28),
  script = p.allocate(0x300, true),
  result = p.allocate(4, true),
  packet = p.allocate(16, true),
  scriptHeader = p.allocate(52, true);
let captured,
  passed = 0;
const rawMessage = (id) => (sdk && id === 446 ? 441 : sdk && id >= 37 ? id - 2 : id);
const compare = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  passed++;
};
engine.patch(
  sdk ? 0x4c5dd0 : 0x5e9b80,
  'oracle queue packet boundary',
  1,
  ([at]) => {
    captured = p.read(at, 16);
    return 0;
  },
  { calleePops: true },
);
try {
  const constructors = [],
    name = p.allocate(32, true),
    filename = p.allocate(16, true);
  for (let i = 0; i < 2; i++) {
    const pointer = p.allocate(1024, true);
    await engine.call(sdk ? 0x4c4b60 : 0x5e8840, [8 + i, name, 60, 0, 0, 0, 0, filename], pointer);
    constructors.push(pointer);
    compare(p.load(pointer + 104), 0, 'new Script has no global bank');
    assert.notEqual(p.load(pointer + 180), 0);
    passed++;
    p.store(packet, 0x11223344);
    p.store(result, 0xcafebabe);
    compare(
      await engine.call(handler, [0, rawMessage(177), 0, packet, 0, result], pointer),
      0,
      'new Script string query handled',
    );
    compare(p.load(packet), p.load(pointer + 180), 'new Script string query pointer');
    compare(p.load(result), 0xcafebabe, 'new Script string query preserves output');
  }
  assert.notEqual(p.load(constructors[0] + 180), p.load(constructors[1] + 180));
  passed++;
  const [parent, child] = constructors,
    ancestor = p.allocate(1024, true),
    parentStrings = p.load(parent + 180),
    childStrings = p.load(child + 180),
    attachParent = p.load(vft + 4);
  await engine.call(sdk ? 0x4b8cd0 : 0x5dcab0, [0, name, 60], ancestor);
  // The original upward router requires a non-null ancestor before checking
  // whether this parent itself is the packet target. No ancestor handler runs.
  p.store(parent + 12, ancestor);
  p.store(parent + 180, 0);
  await engine.call(attachParent, [parent], child);
  compare(p.load(child + 12), parent, 'attachment stores the actual parent pointer');
  compare(p.load(child + 180), childStrings, 'a null parent string bank retains the owned bank');
  compare(p.load(child + 176), 0, 'a null parent string bank retains ownership');
  p.store(parent + 180, parentStrings);
  for (let trial = 0; trial < 16; trial++) {
    await engine.call(attachParent, [parent], child);
    compare(p.load(child + 180), parentStrings, 'attachment borrows the parent string bank');
    compare(p.load(child + 176), 1, 'attachment marks the inherited bank borrowed');
    p.store(parent + 180, 0);
    await engine.call(attachParent, [parent], child);
    compare(
      p.load(child + 180),
      parentStrings,
      'later null attachment preserves the inherited bank',
    );
    compare(p.load(child + 176), 1, 'later null attachment preserves borrowed ownership');
    p.store(parent + 180, parentStrings);
  }
  for (const pointer of constructors.toReversed()) {
    await engine.call(sdk ? 0x4c4d30 : 0x5e8a10, [], pointer);
    p.free(pointer);
  }
  await engine.call(sdk ? 0x4b8dc0 : 0x5dcba0, [], ancestor);
  p.free(ancestor);
  p.free(name);
  p.free(filename);
  for (let trial = 0; trial < 24; trial++) {
    const expectedCommand = (0x80304000 + trial) >>> 0,
      source = kcsProgram([
        [37, 128],
        [43, 0x47, 4],
        [21, [0x13, 132], expectedCommand],
        [43, 0x41, 0],
        [59],
      ]),
      files = memoryGame({ 'main.kcs': source }),
      world = new NativeWorld({
        game: files,
        images: {},
        host: {},
        profile,
        configuration: new NativeConfiguration({ profile }),
        random: new ParticleRandom(),
        motionLibrary: new MotionLibrary(files, { profile, random: new ParticleRandom() }),
        storage: { read: () => null, write: () => true },
      });
    await world.initialize('main.kcs');
    world.nativeEngine = engine;
    const task = world.main,
      record = world.objects.objects.get(task.id),
      memory = new NativeKCSMemory(p, task.machine),
      code = p.allocate(task.machine.script.body.bytes.length, true),
      words = [3, 0x402, trial, 0xffffffff - trial];
    p.write(code, task.machine.script.body.bytes);
    p.store(scriptHeader + 16, task.machine.script.codeSize);
    p.store(memory.pointer + 8, scriptHeader);
    p.store(memory.pointer + 12, code);
    p.store(memory.pointer + 16, task.machine.pc);
    p.store(memory.pointer + 24, task.machine.sp);
    p.store(memory.pointer + 28, task.machine.floor);
    p.store(memory.pointer + 56, NATIVE_PROFILES[profile].tables.main.va);
    p.store(memory.pointer + 60, script);
    p.store(memory.pointer + 64, 1);
    p.store(memory.pointer + 68, p.load(memory.pointer + 20) + 128);
    p.store(script + 112, memory.pointer);
    words.forEach((value, i) => p.store(packet + i * 4, value));
    p.store(result, 0xcafebabe);
    compare(
      await engine.call(handler, [3, rawMessage(172), 0, packet, 0, result], script),
      0,
      'sync handled',
    );
    compare(p.load(result), 1, 'sync yielded result');
    compare(p.load(packet + 4), expectedCommand, 'sync packet command writeback');
    const original = p.read(p.load(memory.pointer + 20) + 128, 16),
      nativeContext = { payload: p, nativePointer: true },
      actual = await world.sendEngine(task.id, task.id, 172, 0, packet, nativeContext);
    compare(actual, 1, 'JS synchronous result');
    compare(task.machine.bytes(128, 16), original, 'synchronous VM continuation bytes');
    // An unarmed native interpreter ignores further immediate delivery.
    compare(
      await world.sendEngine(task.id, task.id, 172, 0, packet, nativeContext),
      0,
      'unarmed result',
    );
    for (const id of [176, 177, 178]) {
      const handle = trial * 111 + id,
        at = id === 176 ? 104 : id === 177 ? 180 : 184;
      p.store(script + at, handle);
      p.store(result, 0xcafebabe);
      p.store(packet, 0x11223344);
      compare(
        await engine.call(handler, [3, rawMessage(id), 1, packet, 0, result], script),
        0,
        `query/${id}/handled`,
      );
      compare(p.load(result), 0xcafebabe, `query/${id}/unwritten result`);
      if (id !== 178) {
        record.context[id === 176 ? 'variableBank' : 'stringBank'] = handle;
        const expected = p.load(packet);
        p.store(packet, 0x11223344);
        compare(
          await world.sendEngine(task.id, task.id, id, 1, packet, nativeContext),
          NATIVE_UNWRITTEN_WORD,
          `query/${id}/JS unwritten`,
        );
        compare(p.load(packet), expected, `query/${id}/JS memory output`);
      } else compare(p.load(script + at), 0, 'string dirty query clears field');
    }
    record.context.variableBank = record.context.stringBank = 0;
    words.forEach((value, i) => p.store(packet + i * 4, value));
    captured = null;
    p.store(result, 0xcafebabe);
    compare(
      await engine.call(handler, [3, rawMessage(173), 0, packet, 0, result], script),
      0,
      'queued handled',
    );
    compare(p.load(result), 1, 'queued accepted result');
    compare(captured, p.read(packet, 16), 'queue insertion packet');
    compare(
      await world.sendEngine(task.id, task.id, 173, 0, packet, nativeContext),
      1,
      'JS queued result',
    );
    compare(task.messages.at(-1), words, 'JS queue packet');
    memory.close();
    p.free(code);
    await world.close();
  }
  for (const present of [false, true]) {
    const files = memoryGame({ 'main.kcs': kcsProgram([[37, 128], [43, 0x47, 4], [59]]) }),
      random = new ParticleRandom(),
      world = new NativeWorld({
        game: files,
        images: {},
        host: {},
        profile,
        configuration: new NativeConfiguration({ profile }),
        random,
        motionLibrary: new MotionLibrary(files, { profile, random }),
        storage: { read: async () => null, write: async () => true },
      });
    await world.initialize('main.kcs');
    const vm = p.allocate(1408, true),
      empty = await world.objects.create({ kind: 12, parent: world.main.id }),
      target = present ? world.main.id : empty;
    world.main.machine.waiting = null;
    world.main.status = 'yielded';
    p.store(script + 112, present ? vm : 0);
    for (const id of [4, 6, 9, 10, 18, 19, 20, 21, 22, 30, 31, 64, 65, 446])
      for (const w of [0, 0x44332211]) {
        p.zero(packet, 16);
        p.store(result, 0xcafebabe);
        captured = null;
        // For an unarmed original interpreter the message is ignored, while
        // the task's initialized/untouched output rules still apply.
        const handle = await engine.call(
            handler,
            [3, rawMessage(id), id === 6 ? packet : w, id === 6 ? packet : w, 0, result],
            script,
          ),
          original = p.load(result),
          ctx = { payload: p, nativePointer: true },
          value = await world.sendEngine(
            target,
            world.main.id,
            id,
            id === 6 ? packet : w,
            id === 6 ? packet : w,
            ctx,
          );
        compare(handle, sdk && [30, 31].includes(id) ? 1 : 0, `event/${present}/${id}/handled`);
        compare(
          value === NATIVE_UNWRITTEN_WORD ? 0xcafebabe : value,
          original,
          `event/${present}/${id}/output`,
        );
        if (captured)
          compare(
            world.runtime.scheduler.tasks.get(target).messages.at(-1),
            Array.from(new Uint32Array(captured.buffer)),
            `event/${id}/queue`,
          );
      }
    p.free(vm);
    await world.close();
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: engine.identity,
        passed,
        scope:
          'Original Script constructors and parent attachment, owned/borrowed string banks, raw event output/queue rules and raw172/173/176/177/178; actual raw172 executes original KCS continuation. Profile-specific absent events and game446/SDK441 are covered. Queue insertion packets and variable/string pointer identities are explicit boundaries. No claim for remaining Script load/debug/dump lifecycle.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original Script differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
