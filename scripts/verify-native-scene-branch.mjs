// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { appendSceneCheckpoint, pruneSceneCheckpoints } from '../src/native/scene-checkpoint.mjs';
import { NativeSceneHistory, nativeSceneData } from '../src/native/scene-data.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { sceneCheckpointFixture } from '../tests/fixtures/scene-checkpoint-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-scene-branch.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Scene branch oracle requires a frozen engine');
const f = await sceneCheckpointFixture(bytes, profile),
  { engine, p, history, machine, variables, strings } = f,
  seed = [];
let comparisons = 0,
  operations = 0;
const compare = (a, b, label) => {
  assert.deepEqual(a, b, label);
  comparisons++;
};
// 3E1 uses strcpy into an uninitialized 32-byte stack name, then copies the
// whole field into its list node. Bytes after the first NUL are undefined;
// compare every other serialized byte, including all following metadata.
const definedCopyBytes = (raw) => {
  const bytes = raw.slice(),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 4; at < bytes.length; ) {
    const end = bytes.subarray(at, at + 32).indexOf(0);
    assert(end >= 0, 'original copy has a terminated scene name');
    bytes.fill(0, at + end + 1, at + 32);
    at += 48 + 72 * view.getUint32(at + 36, true) + view.getUint32(at + 40, true);
  }
  return bytes;
};
try {
  for (const positions of [[], [0], [0, 10, 20, 40], [40, 10, 20, 0]]) {
    history.path = [];
    history.seen = [];
    for (const name of [Uint8Array.of(0x81, 0x30, 0xff, 0x51), 'second', 'third']) {
      history.appendPath(name, 77);
      history.markSeen(name, 99);
      for (const position of positions)
        await appendSceneCheckpoint(history, position, variables, strings, {
          variables: [2, 3],
          strings: [4],
        });
    }
    seed.push(history.snapshot());
  }
  for (const saved of [{ path: [], seen: [] }, ...seed])
    for (const index of [
      0xffffffff, 0xfffffffe, 0xfffffffd, 0, 1, 2, 3, 7, 0x7ffffffe, 0x7fffffff, 0x80000000,
    ])
      for (const position of [0xffffffff, 0x80000000, 0x7fffffff, 0, 1, 9, 10, 11, 20, 40, 41]) {
        history.restore(saved);
        await f.syncHistory();
        const banks = await f.readBanks(),
          vm = [
            machine.memory.slice(),
            machine.shared.slice(),
            ...machine.blocks.map((b) => b.slice()),
          ];
        compare(
          await f.original(0x3e2, [index, position]),
          { control: 2 },
          'complete original 3E2 wrapper',
        );
        pruneSceneCheckpoints(history, index, position);
        const actual = await f.readHistory();
        compare(
          actual.path,
          history.encode('path', true),
          `complete path bytes ${index}/${position}`,
        );
        compare(actual.seen, history.encode('seen', true), 'seen records unchanged');
        compare(await f.readBanks(), banks, 'complete banks and dirty words unchanged');
        compare(
          [machine.memory.slice(), machine.shared.slice(), ...machine.blocks.map((b) => b.slice())],
          vm,
          'complete VM and canaries unchanged',
        );
        operations++;
      }
  // Existing 3E1 path-only copy also has an observable self-alias boundary.
  const sourceNative = p.allocate(8, true),
    sourcePair = p.allocate(8, true),
    argv = p.allocate(8, true),
    out = p.allocate(4, true),
    handles = new NativeHandles(),
    destination = { history },
    source = { history: new NativeSceneHistory() },
    destHandle = handles.add('scene-data', destination),
    sourceHandle = handles.add('scene-data', source);
  await engine.call(f.layout.historyCtor, [], sourceNative);
  p.store(sourcePair + 4, sourceNative);
  try {
    for (const alias of [false, true])
      for (const saved of seed) {
        history.restore(saved);
        source.history.restore(seed[0]);
        await f.syncHistory();
        const seen = source.history.encode('seen', true),
          path = source.history.encode('path', true),
          ap = p.allocate(seen.length, true),
          bp = p.allocate(path.length, true);
        p.write(ap, seen);
        p.write(bp, path);
        try {
          await engine.call(
            f.layout.historyImport,
            [ap, seen.length, bp, path.length],
            sourceNative,
          );
        } finally {
          p.free(ap);
          p.free(bp);
        }
        p.store(argv, f.pair);
        p.store(argv + 4, alias ? f.pair : sourcePair);
        const control = await engine.call(
            p.load(NATIVE_PROFILES[profile].tables.main.va + 0x3e1 * 4),
            [0, f.caller, argv, out],
          ),
          reply = nativeSceneData(0x3e1, [destHandle, alias ? destHandle : sourceHandle], machine, {
            handles,
          });
        compare(reply, { control }, 'complete 3E1 wrapper');
        const actual = await f.readHistory();
        compare(
          definedCopyBytes(actual.path),
          history.encode('path', true),
          'path-only copy and self-alias',
        );
        compare(actual.seen, history.encode('seen', true), 'path-only copy preserves seen');
        operations++;
      }
  } finally {
    await engine.call(f.layout.historyDtor, [], sourceNative);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        operations,
        comparisons,
        scope:
          'Complete main3E2 original selector construction, signed position comparison, exact checkpoint chains and last-entry writes, all-newer preservation, strict path indexes, DWORD index wrap/signed tail deletion; full path/seen serialization, banks/dirty words and four VM domains. Existing main3E1 full path-only copy includes self-alias; only undefined bytes after its strcpy name terminator are excluded, while all serialized metadata and content remain compared.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original scene branching ${comparisons}/${comparisons} (${operations} calls)`);
} finally {
  await engine.close();
}
