// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { HG2 } from '../src/formats/hg2.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { kif, kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-global-css-images-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));

async function checkBitmap(world, caller, expected) {
  const at = { source24: 72, source32: 76, reader24: 80, reader32: 84 }[expected.name],
    bitmap = world.graphics.images.get(caller.machine.load(at)),
    state = bitmap.state;
  assert.deepEqual([bitmap.width, bitmap.height, state.bpp], expected.shape, expected.name);
  assert.deepEqual(
    Object.fromEntries(Object.keys(expected.metadata).map((key) => [key, state[key]])),
    expected.metadata,
  );
  assert.deepEqual(new Uint8Array(await bitmap.pixels()), bytes(expected.rgba));
}

for (const source of golden.cases)
  for (const coldAt of source.name === 'stored-hg2'
    ? [null, 0, 1, 2, 3, 'native-file']
    : [null, 0, 1])
    test(`SDK23 CSS ${source.name} typed bitmap lifecycle${coldAt === null ? '' : ` independent cold${coldAt}`}`, async () => {
      const saved = new Map(),
        original = new Map(source.savedFiles.map((row) => [row.name, bytes(row.data)])),
        storage = {
          read: async (name) =>
            (coldAt === 'native-file' ? original : saved).get(name)?.slice() ?? null,
          write: async (name, data) => {
            saved.set(name, data.slice());
            return true;
          },
        },
        open = (initialize) =>
          modernParticleMessageWorld(
            golden.profile,
            Object.fromEntries(source.inputs.archives.map((row) => [row.name, bytes(row.data)])),
            {
              initialize,
              startup: parseXML(new TextDecoder().decode(bytes(source.inputs.startup))),
              storage,
            },
          );
      let world = await open(true),
        caller = await world.spawnScript(source.script, { initialExecute: false });
      const compare = async (row) => {
        assert.deepEqual(
          Array.from({ length: 8 }, (_, i) => caller.machine.load(128 + 4 * i)),
          row.outputs,
        );
        assert.deepEqual([...caller.machine.bytes(508, 80)], row.span);
        for (const bitmap of row.bitmaps) await checkBitmap(world, caller, bitmap);
        if (row.bitmaps.length === 0)
          assert(
            ![...world.runtime.handles.records.values()].some(
              (r) => r.type === 'bitmap' && r.value.owner === caller.id,
            ),
          );
      };
      try {
        await world.runtime.native('main', 209, [512], caller.machine, caller);
        for (const row of source.rows) {
          await world.objects.update(caller.id, 400 + row.phase);
          await compare(row);
          if (row.phase === coldAt) {
            const id = caller.id,
              state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
            await world.close({ flushFiles: false });
            world = await open(false);
            await world.restore(state);
            caller = world.runtime.scheduler.tasks.get(id);
            await compare(row);
          }
        }
        for (const expected of source.savedFiles) {
          const actual = await NativeGlobalFile.fromFile(saved.get(expected.name), 0x80000),
            native = await NativeGlobalFile.fromFile(bytes(expected.data), 0x80000);
          assert.equal(actual.tag, native.tag);
          assert.deepEqual(
            actual.records.map((r) => r.id),
            native.records.map((r) => r.id),
          );
          for (let i = 0; i < actual.records.length; i++) {
            const left = new HG2(actual.records[i].bytes),
              right = new HG2(native.records[i].bytes),
              a = left.frames[0],
              b = right.frames[0];
            await left.decode(a);
            await right.decode(b);
            for (const key of [
              'width',
              'height',
              'bpp',
              'canvasWidth',
              'canvasHeight',
              'offsetX',
              'offsetY',
              'baseX',
              'baseY',
            ])
              assert.equal(a[key], b[key]);
            assert.deepEqual(
              a.rgba,
              b.rgba,
              'native encoder pixels, independent of compressed representation',
            );
          }
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    });

for (const profile of [
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(`${profile} shared Main251 RGB24 conversion bridge`, async () => {
    const source = golden.cases.find((r) => r.name === 'rgb24-entry'),
      entry = bytes(source.inputs.resource),
      padded = Buffer.alloc(Math.ceil(entry.length / 4) * 4),
      value = (at) => [0x13, at];
    padded.set(entry);
    // Main65 is not admitted for SDK63. This authored bridge uses its existing
    // Main71 wait after the same typed data-entry and image-reader calls.
    const program = kcsProgram([
        ...Array.from({ length: padded.length / 4 }, (_, i) => [
          [37, padded.readUInt32LE(i * 4)],
          [38, 1024 + i * 4],
        ]).flat(),
        [37, 41],
        [43, 238, 4],
        [38, 64],
        [37, value(64)],
        [37, 33],
        [37, entry.length],
        [37, 1024],
        [43, 244, 16],
        [38, 128],
        [37, value(64)],
        [37, 33],
        [43, 251, 8],
        [38, 80],
        [37, 1500],
        [43, 71, 4],
        [59],
      ]),
      world = await modernParticleMessageWorld(
        profile,
        {
          ...Object.fromEntries(source.inputs.archives.map((row) => [row.name, bytes(row.data)])),
          'scripts.int': kif([
            ['main.kcs', kcsProgram([[37, 1500], [43, 71, 4], [59]])],
            [source.script + '.kcs', program],
          ]),
        },
        { startup: parseXML(new TextDecoder().decode(bytes(source.inputs.startup))) },
      );
    try {
      const caller = await world.spawnScript(source.script, { initialExecute: false });
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      await world.objects.update(caller.id, 400);
      await checkBitmap(world, caller, source.rows[0].bitmaps[0]);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
