// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-script-file-owner.json', import.meta.url)),
);
const bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
for (const b of fixture.builds)
  for (const coldAt of [null, 'writer-live', 'after-delete'])
    test(`own${b.version} Script save directory is independent of context and later Top changes${coldAt ? ' ' + coldAt + ' cold' : ''}`, async () => {
      const files = new Map(),
        metadata = new Map(),
        clock = { now: 1577934245000 };
      const storage = {
        read: async (n) => files.get(n)?.slice() ?? null,
        write: async (n, data, options) => {
          const old = metadata.get(n);
          files.set(n, data.slice());
          metadata.set(n, {
            modifiedMs: options.updateModified === false && old ? old.modifiedMs : clock.now,
          });
          return true;
        },
        stat: async (n) => metadata.get(n) ?? null,
        setAttributes: async (n, attributes) => {
          assert.equal(attributes, 0x80);
          return files.has(n);
        },
        remove: async (n) => {
          metadata.delete(n);
          return files.delete(n);
        },
      };
      const input = Object.fromEntries(b.inputs.map((r) => [r.name, bytes(r.data)])),
        open = (initialize) =>
          modernParticleMessageWorld(b.profile, input, {
            startup: parseXML(b.startup),
            initialize,
            storage,
          });
      let w = await open(true);
      const frame = async (task, kind, index) => {
        await w.objects.update(task.id, index);
        if (kind === 'setup') return;
        const p = b.projections,
          r = b.rows.find((r) => r.kind === kind && r.index === index);
        assert.deepEqual(
          p.words.map((at) => task.machine.load(at)),
          r.words,
        );
        assert.deepEqual(
          p.spans.map(({ at, size }) =>
            Buffer.from(task.machine.bytes(at, size)).toString('base64'),
          ),
          r.spans,
        );
      };
      let setup;
      const setDir = async (dir) => {
        const root = w.engineMessages.closestTop(setup.id);
        await w.sendNativeEngine(
          root.nativeID,
          setup.id,
          b.version === '74' ? 35 : 37,
          0,
          b.version === '74' ? (dir === 'alpha' ? 1024 : 1088) : dir === 'alpha' ? 2048 : 2112,
          { machine: setup.machine },
        );
      };
      const cold = async () => {
        const id = setup.id,
          state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
        await w.close({ flushFiles: false });
        w = await open(false);
        await w.restore(state);
        setup = w.runtime.scheduler.tasks.get(id);
      };
      try {
        setup = await w.spawnScript('setup.kcs', { initialExecute: false });
        await frame(setup, 'setup', 0);
        await setDir('alpha');
        let writer = await w.spawnScript('writer.kcs', { initialExecute: false });
        await frame(writer, 'writer', 0);
        assert(files.has('alpha/slot.css'));
        clock.now = 1641092645000;
        await setDir('beta');
        const other = await w.spawnScript('other.kcs', { initialExecute: false });
        await frame(other, 'other', 0);
        const peer = files.get('beta/slot.css').slice();
        assert.equal(w.objects.objects.get(writer.id).nativeSaveDirectory, 'alpha');
        if (coldAt === 'writer-live') {
          const id = writer.id;
          await cold();
          writer = w.runtime.scheduler.tasks.get(id);
          assert.equal(w.objects.objects.get(id).nativeSaveDirectory, 'alpha');
          assert.equal(w.engineMessages.closestTop(id).implementation.caption, 'beta');
        }
        await frame(writer, 'writer', 1);
        assert.equal(metadata.get('alpha/slot.css').modifiedMs, 1577934245000);
        await setDir('alpha');
        const reader = await w.spawnScript('reader.kcs', { initialExecute: false });
        await frame(reader, 'reader', 0);
        assert(!files.has('alpha/slot.css'));
        assert.deepEqual(files.get('beta/slot.css'), peer);
        if (coldAt === 'after-delete') await cold();
        await setDir('beta');
        const peerTask = await w.spawnScript('peer.kcs', { initialExecute: false });
        await frame(peerTask, 'peer', 0);
        assert.equal(peerTask.machine.load(348), b.marker);
      } finally {
        await w.close({ flushFiles: false });
      }
    });

for (const b of fixture.builds)
  test(`own${b.version} native CSS feeds source-free independent relative reader`, async () => {
    const files = new Map([
      ['alpha/slot.css', bytes(b.nativeCSS)],
      ['beta/slot.css', bytes(b.peerCSS)],
    ]);
    const metadata = new Map([
      ['alpha/slot.css', { modifiedMs: 1577934245000 }],
      ['beta/slot.css', { modifiedMs: 1641092645000 }],
    ]);
    const w = await modernParticleMessageWorld(
      b.profile,
      Object.fromEntries(b.inputs.map((r) => [r.name, bytes(r.data)])),
      {
        startup: parseXML(b.startup),
        storage: {
          read: async (name) => files.get(name)?.slice() ?? null,
          stat: async (name) => (files.has(name) ? (metadata.get(name) ?? null) : null),
          setAttributes: async (name, attributes) => {
            assert.equal(attributes, 0x80);
            return files.has(name);
          },
          remove: async (name) => {
            metadata.delete(name);
            return files.delete(name);
          },
        },
      },
    );
    try {
      const setup = await w.spawnScript('setup.kcs', { initialExecute: false });
      await w.objects.update(setup.id, 0);
      const root = w.engineMessages.closestTop(setup.id);
      for (const [kind, offset] of [
        ['reader', b.version === '74' ? 1024 : 2048],
        ['peer', b.version === '74' ? 1088 : 2112],
      ]) {
        await w.sendNativeEngine(root.nativeID, setup.id, b.version === '74' ? 35 : 37, 0, offset, {
          machine: setup.machine,
        });
        const task = await w.spawnScript(kind + '.kcs', { initialExecute: false });
        await w.objects.update(task.id, 0);
        const row = b.rows.find((r) => r.kind === kind);
        assert.deepEqual(
          b.projections.words.map((at) => task.machine.load(at)),
          row.words,
        );
        assert.deepEqual(
          b.projections.spans.map(({ at, size }) =>
            Buffer.from(task.machine.bytes(at, size)).toString('base64'),
          ),
          row.spans,
        );
      }
      assert(!files.has('alpha/slot.css'));
      assert.deepEqual(files.get('beta/slot.css'), bytes(b.peerCSS));
    } finally {
      await w.close({ flushFiles: false });
    }
  });
