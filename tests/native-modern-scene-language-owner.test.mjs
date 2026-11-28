// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mutableDataWorld } from './fixtures/mutable-data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-scene-language-owner.json', import.meta.url)),
);
const decode = (value) => new Uint8Array(Buffer.from(value, 'base64'));
for (const restore of [false, true])
  test(`implicit Script Scene creation registers the same Settings prefixes${restore ? ' through cold' : ''}`, async () => {
    const resources = new Map(fixture.inputs.map((r) => [r.name, decode(r.data)]));
    resources.set('implicit.kcs', decode(fixture.implicitProgram));
    const open = (initialize) =>
      mutableDataWorld(fixture.profile, resources, { startup: fixture.startup, initialize });
    let { world } = await open(true);
    try {
      let task = await world.spawnScript('implicit.kcs', { initialExecute: false });
      await world.objects.update(task.id, 0);
      assert.equal(task.machine.load(256), 1);
      if (restore) {
        const id = task.id,
          state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        ({ world } = await open(false));
        await world.restore(state);
        task = world.runtime.scheduler.tasks.get(id);
      }
      await world.objects.update(task.id, 1);
      assert.equal(task.machine.load(264), 1723);
      assert.deepEqual([...task.machine.bytes(2112, 4)], [67, 97, 116, 0]);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
for (const coldAt of [null, 'before-source', 'after-source', 'after-writer'])
  test(`Scene registration copies real startup prefixes and owns translations through CSS${coldAt ? ' ' + coldAt + ' cold' : ''}`, async () => {
    const saved = new Map(),
      storage = {
        read: async (name) => saved.get(name)?.slice() ?? null,
        write: async (name, data) => {
          saved.set(name, data.slice());
          return true;
        },
      };
    let resources = new Map(fixture.inputs.map((r) => [r.name, decode(r.data)]));
    const open = (initialize) =>
      mutableDataWorld(fixture.profile, resources, {
        startup: fixture.startup,
        storage,
        initialize,
      });
    let { world, files } = await open(true);
    const frame = async (task, kind, index) => {
      await world.objects.update(task.id, index);
      if (kind === 'xml') return;
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
      const xml = await world.spawnScript('xml.kcs', { initialExecute: false });
      await frame(xml, 'xml', 0);
      const handle = xml.machine.load(64);
      assert(handle);
      await frame(xml, 'xml', 1);
      assert.throws(() => world.runtime.handles.get(handle, 'xml'), /released/);
      files.set(
        'config/language.xml',
        new Uint8Array(files.get('config/language.xml').length).fill(32),
      );
      let writer = await world.spawnScript('writer.kcs', { initialExecute: false });
      await frame(writer, 'writer', 0);
      const id = writer.id;
      if (coldAt === 'before-source') {
        await cold();
        writer = world.runtime.scheduler.tasks.get(id);
      }
      files.set('scene/language.cstl', decode(fixture.changedCSTL));
      if (coldAt === 'after-source') {
        await cold();
        writer = world.runtime.scheduler.tasks.get(id);
      }
      await frame(writer, 'writer', 1);
      assert.equal(writer.machine.load(348), fixture.marker);
      assert.deepEqual(saved.get('language.css'), decode(fixture.nativeCSS));
      if (coldAt === 'after-writer') await cold();
      const reader = await world.spawnScript('reader.kcs', { initialExecute: false });
      await frame(reader, 'reader', 0);
    } finally {
      await world.close({ flushFiles: false });
    }
  });

test('native language/log CSS feeds an independent parsed reader without Scene or CSTL resources', async () => {
  const resources = new Map(
    fixture.inputs.filter((r) => r.name.endsWith('.kcs')).map((r) => [r.name, decode(r.data)]),
  );
  const { world } = await mutableDataWorld(fixture.profile, resources, {
    startup: fixture.startup,
    storage: { read: async (name) => (name === 'language.css' ? decode(fixture.nativeCSS) : null) },
  });
  try {
    const task = await world.spawnScript('reader.kcs', { initialExecute: false });
    await world.objects.update(task.id, 0);
    const expected = fixture.rows.find((r) => r.kind === 'reader');
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
  } finally {
    await world.close({ flushFiles: false });
  }
});
