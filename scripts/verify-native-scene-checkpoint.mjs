// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { appendSceneCheckpoint, restoreSceneCheckpoint } from '../src/native/scene-checkpoint.mjs';
import { sceneCheckpointFixture } from '../tests/fixtures/scene-checkpoint-fixture.mjs';
import { nativeInflate } from '../src/native/zlib.mjs';
import { Binary } from '../src/binary.mjs';
import { decodeNativeSceneHistory } from '../src/native/scene-history.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { importStringBank } from '../src/native/persistence.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-scene-checkpoint.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Scene checkpoint oracle requires a frozen image');
const fixture = await sceneCheckpointFixture(bytes, profile),
  { engine, machine, history, variables, strings, feature, files } = fixture;
let passed = 0,
  operations = 0;
const paddingSamples = new Set();
async function canonical(bytes) {
  const records = decodeNativeSceneHistory(bytes),
    output = [];
  for (const entry of records) {
    const frames = [];
    let at = 0;
    if (entry.extra)
      do {
        const extra = new Binary(entry.extra),
          variables = extra.u32(at + 8),
          stringSize = extra.u32(at + 12),
          compressed = extra.range(at + 20, extra.u32(at + 4) - 20),
          decoded = await nativeInflate(compressed, new Uint8Array(variables + stringSize));
        compare(decoded.result, variables + stringSize, 'compressed declared payload size');
        const bank = new NativeStringBank();
        importStringBank(bank, decoded.bytes.subarray(variables));
        paddingSamples.add(
          Buffer.from(decoded.bytes.subarray(variables + stringSize - 8)).toString('hex'),
        );
        frames.push({
          position: extra.u32(at + 16),
          variables: decoded.bytes.slice(0, variables),
          strings: [...bank.entries],
          stringSize,
        });
        const next = extra.u32(at);
        if (!next) break;
        compare(next, extra.u32(at + 4), 'chain offset equals header+compressed byte count');
        at += next;
      } while (at < entry.extra.length);
    output.push({ ...entry, extra: frames });
  }
  return output;
}
const compare = (a, b, label) => {
    assert.deepEqual(a, b, label);
    passed++;
  },
  put = (at, text) => machine.writeString(text, at),
  match = async () => {
    const native = await fixture.readHistory();
    compare(native.seen, history.encode('seen', true), 'complete seen history');
    compare(
      await canonical(native.path),
      await canonical(history.encode('path', true)),
      'all defined path/checkpoint fields, compressed payloads and chain order; eight unread padding bytes excluded',
    );
    const bank = await fixture.readBanks();
    compare(bank.words, [...variables.words], 'all variable words');
    compare(bank.dirty, variables.dirty, 'variable dirty');
    compare(
      bank.strings,
      [...strings.entries].sort(([a], [b]) => a - b),
      'all raw string bytes',
    );
  };
try {
  const encode = profile.startsWith('sdk-')
      ? encodeCP932
      : (text) => new TextEncoder().encode(text),
    xml = (text) =>
      encode(
        `<?xml version="1.0" encoding="${profile.startsWith('sdk-') ? 'Shift_JIS' : 'UTF-8'}"?><document><localstr>${text}</localstr></document>`,
      );
  put(64, 'localstr.xml');
  for (const text of ['4,9', '9,4,9', '-1,0x4, 9,abc,,4.5', '', '400,401']) {
    files.set('localstr.xml', xml(text));
    const selection = await feature.selection('localstr.xml');
    compare(
      selection.variables,
      [2, 3, 4, 17, 18, 63, 64],
      'original configured local flag ranges, including an out-of-bank index',
    );
    history.seen = [];
    history.path = [];
    await fixture.syncHistory();
    for (let i = 0; i < 64; i++) await fixture.word(i, Math.imul(i + 17, 982451653) >>> 0);
    for (const id of [0, 4, 9, 400, 401, 0xffffffff])
      await fixture.text(id, id === 4 ? encodeCP932('猫 raw') : Uint8Array.of(0x81, 0xff));
    for (const name of ['no path', 'first', 'second']) {
      if (name !== 'no path') {
        history.appendPath(name, history.path.length + 11);
        await fixture.syncHistory();
      }
      for (const position of [0, 20, 10, 40]) {
        await fixture.word(3, position + 999);
        await fixture.text(4, Uint8Array.of(65 + (position % 26), 0x81, 0xff));
        compare(
          await fixture.original(0x3df, [position, 64]),
          { control: 2 },
          'complete append wrapper control',
        );
        await appendSceneCheckpoint(history, position, variables, strings, selection);
        operations++;
        await match();
      }
    }
    // Feed the JS writer's actual bytes to the original reader as well.
    await fixture.syncHistory();
    for (const start of [0xffffffff, 0, 1, 2, 7])
      for (const position of [0, 9, 10, 19, 20, 39, 40, 0xffffffff]) {
        put(4096, 'canary');
        machine.bytes(1024, 16).fill(0xa5);
        machine.store(1024, start);
        machine.store(1028, position);
        const before = machine.memory.slice(),
          expected = await fixture.original(0x3e0, [1024, 1028, 64]),
          native = machine.memory.slice();
        machine.memory.set(before);
        const ok = await restoreSceneCheckpoint(
          history,
          start,
          position,
          variables,
          strings,
          selection,
          (index, pos) => {
            machine.store(1024, index);
            machine.store(1028, pos);
          },
        );
        compare(
          expected,
          { control: 1, value: Number(ok) },
          `complete restore wrapper return ${JSON.stringify({ text, start, position })}`,
        );
        compare(machine.memory, native, 'all VM bytes and output words');
        operations++;
        await match();
      }
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        operations,
        paddingSamples: [...paddingSamples],
        scope:
          'Complete original main3DF/3E0 wrappers, XML selection, configured ranges, original variable/string bank constructors and accessors, chained level9 compressed local snapshots, all defined history/checkpoint/payload fields (eight unread original string-bank padding bytes excluded), arbitrary restore positions and earlier-scene fallback, no-path behavior, complete VM/canary and bank side effects. Reviewed file/allocator/CRT platform bridges only; no native scene/checkpoint/bank handler is replaced.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Original scene checkpoint differential ${passed}/${passed}, ${operations} wrapper operations`,
  );
} finally {
  await engine.close();
}
