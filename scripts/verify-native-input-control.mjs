// SPDX-License-Identifier: MPL-2.0
// The actual input handler and all three KCS wrappers execute unchanged.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { nodeGame } from './node-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeInput } from '../src/native/input.mjs';
import { nativeInputControl, nativeInputControlMessage } from '../src/native/input-control.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';

const [root, profile, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-input-control.mjs FIXED_DIRECTORY PROFILE IGNORED_REPORT',
  );
const sdk = profile.startsWith('sdk-'),
  engine = await NativeEngineProcess.open({
    game: await nodeGame(root),
    profile,
    configuration: new NativeConfiguration({ profile }),
  }),
  p = engine.process,
  caller = p.allocate(104, true),
  vft = p.allocate(32, true),
  argsPointer = p.allocate(8, true),
  result = p.allocate(4, true),
  task = p.allocate(5400, true),
  renderer = p.allocate(200, true),
  packet = p.allocate(40, true),
  handler = sdk ? 0x4c38f0 : 0x5e7680,
  main = NATIVE_PROFILES[profile].tables.main.va;
let passed = 0,
  calls = [];
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  passed++;
};
try {
  p.store(caller, vft);
  p.store(caller + 4, 7);
  p.store(
    vft + 16,
    p.trap(
      'input control engine-message transport',
      7,
      ([sender, target, message, w, l, flags, out]) => {
        calls.push({ sender, target, message, w, l, flags });
        if (message === (sdk ? 32 : 34)) p.store(out, 5);
        return 1;
      },
    ),
  );
  for (const [id, count] of [
    [0x191, 1],
    [0x193, 2],
    [0x194, 0],
  ])
    for (const words of [
      [0, 0],
      [1, 1],
      [79, 0xffffffff],
    ]) {
      words.forEach((v, i) => p.store(argsPointer + i * 4, v));
      calls = [];
      const original = await engine.call(p.load(main + id * 4), [0, caller, argsPointer, result]),
        raw = calls;
      calls = [];
      const reply = await nativeInputControl(
        id,
        words.slice(0, count),
        null,
        { id: 7 },
        {
          engineMessages: { layout: { rootStart: sdk ? 30 : 32 } },
          sendNativeEngine: async (target, sender, message, w = 0, l = 0) => {
            calls.push({
              sender,
              target,
              message: sdk && message >= 37 ? message - 2 : message,
              w,
              l,
              flags: 0,
            });
            return message === (sdk ? 32 : 34) ? 5 : NATIVE_UNWRITTEN_WORD;
          },
        },
      );
      compare(reply.control, original, `wrapper/${id}/control`);
      compare(calls, raw, `wrapper/${id}/messages`);
    }
  engine.patch(
    sdk ? 0x54e830 : 0x677730,
    'input renderer cursor service',
    1,
    ([visible]) => {
      p.store(renderer + 48, visible);
      return 1;
    },
    { calleePops: true },
  );
  const input = new NativeInput({ cursor: () => {} }),
    memory = { store: (a, v) => p.store(a, v), bytes: (a, n) => p.read(a, n) },
    view = () => ({
      enabled: Array.from({ length: 80 }, (_, i) => p.load(task + 4604 + i * 4)),
      cursorEnabled: p.load(task + 5236),
      cursorVisible: p.load(task + 5240),
      source: p.load(task + 4952),
      cursorBlocked: p.load(task + 5264),
    });
  p.store(task + 112, renderer);
  p.store(task + 5236, 1);
  p.store(task + 5240, 1);
  for (let i = 0; i < 80; i++) p.store(task + 4604 + i * 4, 1);
  for (let trial = 0; trial < 120; trial++)
    for (const [message, w, l] of [
      [150, trial % 80, trial % 3 ? 0 : 1],
      [151, 0, 0],
      [149, 0, trial % 2],
      [136, 0, 0],
      [148, 0, packet],
      [152, 0, 0],
    ]) {
      p.store(result, 0xcafebabe);
      p.store(packet, 0x3c52b16a);
      input.source = trial % 2 ? 16 : trial;
      p.store(task + 4952, input.source);
      input.cursorBlocked = trial % 3 === 0;
      p.store(task + 5264, Number(input.cursorBlocked));
      compare(
        await engine.call(handler, [7, sdk ? message - 2 : message, w, l, 0, result], task),
        0,
        `input/${message}/handled`,
      );
      const original = p.load(result),
        written = p.load(packet);
      p.store(packet, 0x3c52b16a);
      const actual = await nativeInputControlMessage(input, message, w, l, {}, () => memory);
      compare(
        actual === NATIVE_UNWRITTEN_WORD ? 0xcafebabe : actual,
        original,
        `input/${message}/result`,
      );
      compare(p.load(packet), written, `input/${message}/memory`);
      const state = view();
      compare(
        {
          enabled: [...input.enabled],
          cursorEnabled: Number(input.cursorEnabled),
          cursorVisible: Number(input.cursorVisible),
          source: input.source,
          cursorBlocked: Number(input.cursorBlocked),
        },
        state,
        `input/${message}/fields`,
      );
    }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256: engine.identity,
        passed,
        scope:
          'Complete original main191/193/194 transport and Input136/148..152 fields. Cursor rendering is an explicit host boundary; no assertion for the remaining input handler/frame.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native input controls passed ${passed}/${passed}`);
} finally {
  await engine.close();
}
