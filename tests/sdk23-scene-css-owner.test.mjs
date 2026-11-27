// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-scene-css-owner-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const coldAt of [null, 0, 1, 2, 3, 4, 5, 6])
  test(`SDK23 loaded CSS writer/new owner and raw data lifetime${coldAt === null ? '' : ` independent cold${coldAt}`}`, async () => {
    const saved = new Map(),
      storage = {
        read: async (name) => saved.get(name)?.slice() ?? null,
        write: async (name, data) => {
          saved.set(name, data.slice());
          return true;
        },
      },
      open = (initialize) =>
        modernParticleMessageWorld(
          golden.profile,
          {
            ...Object.fromEntries(golden.inputs.archives.map((row) => [row.name, bytes(row.data)])),
            'startup.xml': bytes(golden.inputs.startup),
          },
          {
            initialize,
            startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))),
            storage,
          },
        );
    let world = await open(true),
      caller = await world.spawnScript('scene-g2', { initialExecute: false });
    const compare = (row) => {
      const m = caller.machine;
      assert.deepEqual(
        Array.from({ length: 20 }, (_, i) => m.load(128 + 4 * i)),
        row.outputs,
        row.label,
      );
      assert.deepEqual(m.bytes(512, 224), bytes(row.bytes), 'all initialized native output bytes');
      if (row.raw) {
        const pointer = m.load(row.phase === 1 ? 84 : 88),
          length = m.load(row.phase === 1 ? 160 : 184);
        assert.deepEqual(
          world.runtime.imageDataBuffers.process.readHostData(pointer, length, 836),
          bytes(row.raw),
        );
      }
      if (row.phase >= 3) {
        assert(!world.runtime.handles.records.has(m.load(64)));
        assert(!world.runtime.handles.records.has(m.load(68)));
        assert(!world.runtime.handles.records.has(m.load(72)));
      }
      if (row.phase >= 6) {
        assert(!world.runtime.handles.records.has(m.load(76)));
        assert(!world.runtime.handles.records.has(m.load(80)));
      }
    };
    try {
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      for (const row of golden.rows) {
        await world.objects.update(caller.id, row.frame);
        compare(row);
        if (row.phase === coldAt) {
          const id = caller.id,
            state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(state);
          caller = world.runtime.scheduler.tasks.get(id);
          compare(row);
        }
      }
      assert.deepEqual(
        saved.get(golden.outputFile),
        bytes(golden.savedFile),
        'exact native CSS header, zlib stream and all defined records',
      );
    } finally {
      await world.close({ flushFiles: false });
    }
  });
