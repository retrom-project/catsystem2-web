// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-scene-reader-cursor-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
async function open(initialize = true) {
  const startup = bytes(golden.inputs.startup);
  return modernParticleMessageWorld(
    golden.profile,
    {
      ...Object.fromEntries(golden.inputs.archives.map((row) => [row.name, bytes(row.data)])),
      'startup.xml': startup,
    },
    { initialize, startup: parseXML(new TextDecoder().decode(startup)) },
  );
}
function reader(data) {
  return {
    loaded: !!data.body,
    blockCount: data.blockCount,
    ...(data.body ? { block: data.block, line: data.line } : {}),
    filename: data.filename,
    fileValue: data.fileValue >>> 0,
  };
}
function compare(world, caller, row) {
  const m = caller.machine;
  assert.deepEqual(
    Array.from({ length: 22 }, (_, i) => m.load(128 + i * 4)),
    row.outputs,
    row.label + ' complete outputs',
  );
  assert.deepEqual(
    m.bytes(512, 704),
    bytes(row.bytes),
    row.label + ' all initialized destination bytes',
  );
  if (row.scene) {
    const scene = world.runtime.handles.get(m.load(64), 'scene-data');
    assert.deepEqual(reader(scene.reader), row.scene.reader, row.label + ' direct reader');
    assert.equal(
      row.scene.references,
      1,
      'native cursor borrows its Scene owner without adding a ref',
    );
  } else assert(!world.runtime.handles.records.has(m.load(64)));
  if (row.cursor) {
    const cursor = world.runtime.handles.get(m.load(68), 'history-cursor');
    assert.equal(cursor.sceneHandle, m.load(64), 'live borrowed owner identity');
    assert.deepEqual(
      [cursor.capacity, cursor.lastPath],
      [row.cursor.capacity, row.cursor.lastPath],
    );
    assert.deepEqual(
      Array.from({ length: cursor.capacity }, (_, i) => {
        const entry = cursor.row(i, false);
        return {
          path: entry.path,
          block: entry.block,
          lastBlock: entry.lastBlock,
          valid: entry.valid,
          reader: reader(entry.reader),
        };
      }),
      row.cursor.rows,
      row.label + ' all logical cursor reader states',
    );
  }
  if (row.phase >= 4) assert(!world.runtime.handles.records.has(m.load(68)));
}
for (const coldAt of [null, 0, 1, 2, 3, 4, 5])
  test(`SDK23 actual Scene/Cursor marker ownership${coldAt === null ? '' : ` with independent cold at${coldAt}`}`, async () => {
    let world = await open(),
      caller = await world.spawnScript('scene-g1', { initialExecute: false });
    try {
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      for (const row of golden.rows) {
        await world.objects.update(caller.id, row.frame);
        compare(world, caller, row);
        if (row.phase === coldAt) {
          const id = caller.id,
            saved = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(saved);
          caller = world.runtime.scheduler.tasks.get(id);
          compare(world, caller, row);
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
