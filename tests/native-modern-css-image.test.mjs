// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { openImage } from '../src/formats/hg3.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-css-image.json', import.meta.url)),
);
const bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
async function decode(data) {
  const f = await NativeGlobalFile.fromFile(data),
    out = [];
  for (const r of f.records) {
    const i = await openImage(r.bytes),
      x = i.frame(0);
    await i.decode(x);
    out.push({
      id: r.id,
      width: x.width,
      height: x.height,
      bpp: x.bpp,
      rgba: Buffer.from(x.rgba).toString('base64'),
    });
  }
  return out;
}
for (const b of fixture.builds) {
  const input = Object.fromEntries(b.inputs.map((r) => [r.name, bytes(r.data)]));
  const open = (saved, initialize = true) =>
    modernParticleMessageWorld(b.profile, input, {
      startup: parseXML(b.startup),
      initialize,
      storage: {
        read: async (n) => saved.get(n)?.slice() ?? null,
        write: async (n, data) => {
          saved.set(n, data.slice());
          return true;
        },
      },
    });
  const compare = (task, kind) => {
    const p = b.projections[kind],
      r = b.rows.find((r) => r.kind === kind);
    assert.deepEqual(
      p.outputs.map((at) => task.machine.load(at)),
      r.words,
    );
    assert.deepEqual(
      p.spans.map(({ at, size }) => Buffer.from(task.machine.bytes(at, size)).toString('base64')),
      r.spans,
    );
    assert.equal(task.machine.load(344), b.marker);
  };
  for (const coldAt of [null, 'writer', 'reader'])
    test(`own${b.version} finite RGB24 CSS image feeds independent mutable reader${coldAt ? ' with live ' + coldAt + ' cold' : ''}`, async () => {
      const saved = new Map();
      let w = await open(saved);
      try {
        for (const kind of ['writer', 'reader']) {
          let task = await w.spawnScript(kind + '.kcs', { initialExecute: false });
          await w.objects.update(task.id, 0);
          const bitmap = w.graphics.images.get(task.machine.load(68));
          assert.equal(bitmap.state.bpp, 4);
          assert.equal((await bitmap.pixels()).length, 48);
          if (kind === coldAt) {
            const id = task.id,
              state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
            await w.close({ flushFiles: false });
            w = await open(saved, false);
            await w.restore(state);
            task = w.runtime.scheduler.tasks.get(id);
            assert.equal(w.graphics.images.get(task.machine.load(68)).state.bpp, 4);
          }
          await w.objects.update(task.id, 1);
          compare(task, kind);
        }
        for (const [name, expected] of Object.entries(b.decoded))
          assert.deepEqual(await decode(saved.get(name)), expected);
        if (b.version === '74') {
          assert.notEqual(
            b.decoded['modern-image.css'][0].rgba,
            b.decoded['modern-image.css'][1].rgba,
          );
          assert.equal(
            b.decoded['modern-image.css'][1].rgba,
            b.decoded['modern-image-reader.css'][1].rgba,
          );
        }
      } finally {
        await w.close({ flushFiles: false });
      }
    });
  test(`own${b.version} native image CSS alone survives source-free fresh reader`, async () => {
    const saved = new Map([['modern-image.css', bytes(b.nativeFiles['modern-image.css'])]]),
      w = await open(saved);
    try {
      const task = await w.spawnScript('reader.kcs', { initialExecute: false });
      for (const frame of [0, 1]) await w.objects.update(task.id, frame);
      compare(task, 'reader');
      assert.deepEqual(
        await decode(saved.get('modern-image-reader.css')),
        b.decoded['modern-image-reader.css'],
      );
      assert.deepEqual(saved.get('modern-image.css'), bytes(b.nativeFiles['modern-image.css']));
    } finally {
      await w.close({ flushFiles: false });
    }
  });
}
