// SPDX-License-Identifier: MPL-2.0
// Original main 3A6, formatter and history receiver versus the browser history.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { encodeCP932, formatNativeAt } from '../src/kcs.mjs';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeSceneData, nativeSceneData } from '../src/native/scene-data.mjs';
import { decodeNativeSceneHistory } from '../src/native/scene-history.mjs';
import { sceneCheckpointFixture } from '../tests/fixtures/scene-checkpoint-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-seen-alias.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Scene alias oracle requires a frozen engine image');

const fixture = await sceneCheckpointFixture(bytes, profile),
  { engine, history, machine } = fixture,
  handles = new NativeHandles(),
  data = new NativeSceneData(),
  handle = handles.add('scene-data', data),
  services = { handles, formatBytes: formatNativeAt, format: (at, m) => m.string(at) },
  raw = (value) => (typeof value === 'string' ? encodeCP932(value) : value),
  put = (address, value) => machine.writeStringBytes(raw(value), address),
  defined = (buffer) =>
    decodeNativeSceneHistory(buffer, { side: 'seen' }).map(
      ({ nameBytes, value, strings, extra }) => ({
        // The original new record copies through the NUL; its unused local
        // name bytes are outside the contract.
        name: Buffer.from(nameBytes.subarray(0, nameBytes.indexOf(0))).toString('hex'),
        value,
        strings,
        extra,
      }),
    );
data.history = history;
const cases = [
  [[['Source', 0xffffffff]], 'SOURCE', 'Copy'],
  [
    [
      ['source', 51],
      ['copy', 7],
    ],
    'Source',
    'COPY',
  ],
  [[['source', 51]], 'absent', 'copy'],
  [[['source', 51]], 'source.cst', 'copy'],
  [[['source', 51]], 'source', 'copy.cst'],
  [[['source', 51]], 'source', ''],
  [
    [
      ['', 51],
      ['source', 71],
    ],
    'source',
    'copy',
  ],
  [[['source', 51]], '%s[G512]', 'copy%02d[G1024]'],
  [[['ア', 17]], 'ヂ', 'both fold their trail byte'],
  [[['source', 51]], 'source', Uint8Array.of(0x81, 0x30, 0xff, 0x51)],
  [[['source', 51]], 'source', 'x'.repeat(31)],
  [
    [
      ['source', 51],
      ['ア', 17],
    ],
    'source',
    'ヂ',
  ],
];
let calls = 0,
  comparisons = 0;
try {
  for (const domain of [0, machine.fp, 0x80000000, machine.memory.length])
    for (const [index, [seen, source, destination]] of cases.entries()) {
      history.seen = [];
      history.path = [];
      history.appendPath('source', 61);
      for (const [name, value] of seen) history.markSeen(name, value);
      await fixture.syncHistory();
      put(512, 'source');
      machine.store(1024, 7);
      const from = domain + 128,
        to = domain + 256;
      put(from, source);
      put(to, destination);
      const expected = await fixture.original(0x3a6, [from, to]);
      assert.deepEqual(nativeSceneData(0x3a6, [handle, from, to], machine, services), expected);
      const report = await fixture.readHistory();
      assert.deepEqual(
        defined(history.encode('seen', true)),
        defined(report.seen),
        `scene alias case ${index} at ${domain.toString(16)}`,
      );
      assert.deepEqual(report.path, history.encode('path', true));
      calls++;
      comparisons += 3;
    }
  await writeFile(output, JSON.stringify({ profile, sha256, calls, comparisons }, null, 2) + '\n');
  console.log(`Original seen aliases: ${calls} calls, ${comparisons} comparisons`);
} finally {
  await engine.close();
}
