// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mutableDataWorld } from './fixtures/mutable-data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-section-generic-owner.json', import.meta.url)),
);
const decode = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const version of ['74', '76']) {
  const profile = version === '74' ? 'sdk-4.01-engine-2.6.1.74' : 'nekopara-vol3-engine-2.6.1.76';
  for (const coldAt of [null, 'before-source', 'after-source', 'after-writer'])
    test(`own${version} authored Section and generic database reach parsed variables and CSS consumers${coldAt ? ' ' + coldAt + ' cold' : ''}`, async () => {
      let resources = new Map(fixture.inputs.map((r) => [r.name, decode(r.data)]));
      const saved = new Map(),
        storage = {
          read: async (name) => saved.get(name)?.slice() ?? null,
          write: async (name, data) => {
            saved.set(name, data.slice());
            return true;
          },
        };
      const open = (initialize) =>
        mutableDataWorld(profile, resources, { startup: fixture.startup, storage, initialize });
      let { world, files } = await open(true);
      const frame = async (task, kind, index) => {
        await world.objects.update(task.id, index);
        const expected = fixture.rows.find((r) => r.kind === kind && r.index === index);
        assert.deepEqual(
          fixture.projections.words.map((at) => task.machine.load(at)),
          expected.words,
        );
        assert.deepEqual(
          fixture.projections.spans.map(({ at, size }) =>
            Buffer.from(task.machine.bytes(at, size)).toString('base64'),
          ),
          expected.spans,
        );
      };
      const cold = async () => {
        resources = new Map(files);
        const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        ({ world, files } = await open(false));
        await world.restore(state);
      };
      try {
        let writer = await world.spawnScript('writer.kcs', { initialExecute: false });
        await frame(writer, 'writer', 0);
        const id = writer.id;
        if (coldAt === 'before-source') {
          await cold();
          writer = world.runtime.scheduler.tasks.get(id);
        }
        files.set('tables/choice.txt', decode(fixture.changedSection));
        if (coldAt === 'after-source') {
          await cold();
          writer = world.runtime.scheduler.tasks.get(id);
        }
        await frame(writer, 'writer', 1);
        assert.equal(writer.machine.load(348), fixture.marker);
        assert.deepEqual(saved.get('generic.css'), decode(fixture.nativeCSS));
        if (coldAt === 'after-writer') await cold();
        const reader = await world.spawnScript('reader.kcs', { initialExecute: false });
        await frame(reader, 'reader', 0);
      } finally {
        await world.close({ flushFiles: false });
      }
    });
  test(`own${version} original generic CSS imports into a fresh owner after native source owners retire`, async () => {
    const resources = new Map(
      fixture.inputs
        .filter((r) => r.name.endsWith('.kcs') || r.name.endsWith('.db'))
        .map((r) => [r.name, decode(r.data)]),
    );
    const { world } = await mutableDataWorld(profile, resources, {
      startup: fixture.startup,
      storage: {
        read: async (name) => (name === 'generic.css' ? decode(fixture.nativeCSS) : null),
      },
    });
    try {
      const reader = await world.spawnScript('reader.kcs', { initialExecute: false });
      await world.objects.update(reader.id, 0);
      const expected = fixture.rows.find((r) => r.kind === 'reader');
      assert.deepEqual(
        fixture.projections.words.map((at) => reader.machine.load(at)),
        expected.words,
      );
      assert.deepEqual(
        fixture.projections.spans.map(({ at, size }) =>
          Buffer.from(reader.machine.bytes(at, size)).toString('base64'),
        ),
        expected.spans,
      );
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
