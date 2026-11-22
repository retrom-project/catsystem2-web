// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobFile, GameFiles, HTTPFile } from '../src/files.mjs';
import { NativeImageFiles } from '../src/native/image-file.mjs';
import { NativeRetainedDraw } from '../src/native/retained-draw.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kif } from './helpers.mjs';

function program(first = 4) {
  const bytes = new Uint8Array(100),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4d4e41, true);
  view.setUint32(8, 1, true);
  view.setUint32(32, 15, true);
  view.setUint32(40, first, true);
  view.setUint32(48, first + 7, true);
  return bytes;
}

test('repeated mounted ANM reads keep file precedence and create independent playback', async (t) => {
  const bytes = program(),
    mounted = kif([['idle.anm', bytes]]),
    archive = new HTTPFile('http://archives.invalid/graphics.int', mounted.length, 1),
    updated = program(80),
    startup = new BlobFile(
      new Blob([
        '<?xml version="1.0" encoding="UTF-8"?><document><INT><int00><name>image</name><int>graphics.int</int><ext>hg3</ext><dir>graphics</dir></int00></INT></document>',
      ]),
    );
  let archiveBytes = mounted,
    payloadReads = 0,
    rejectRead = false;
  t.mock.method(globalThis, 'fetch', async (url, { headers }) => {
    assert.equal(url, archive.url);
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(headers.Range);
    if (+start >= 80) {
      payloadReads++;
      if (rejectRead) throw new Error('mount read failed');
    }
    return new Response(archiveBytes.slice(+start, +end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${archiveBytes.length}` },
    });
  });
  const game = new GameFiles(
    new Map([
      ['startup.xml', startup],
      ['graphics.int', archive],
      ['graphics/placeholder.bin', new BlobFile(new Blob([]))],
      ['update01.int', new BlobFile(new Blob([kif([['idle.anm', updated]])]))],
    ]),
  );
  await game.open();
  const updates = game.nativeSearch.overrides;
  game.nativeSearch.overrides = [];
  const random = new ParticleRandom(17),
    expected = new ParticleRandom(17),
    source = { frames: [] },
    storage = new NativeFileStorage(game, 'animation-file-test'),
    world = { game, storage, random, renderSources: new Map([[1, source]]) },
    files = (world.imageFiles = new NativeImageFiles(world)),
    retained = new NativeRetainedDraw(world),
    draw = { record: { id: 1 } };
  retained.items.set(retained.key(draw, 2), { source: 1 });

  const path = await files.locate('idle');
  assert.equal(path, 'graphics.int/idle.anm');
  const isolated = await files.readResolved(path);
  isolated.fill(0);
  let previous;
  for (const frame of [14, 29]) {
    assert.equal(await retained.load(draw, 2, path), true);
    const animation = source.animation;
    assert.notEqual(animation, previous);
    assert.equal(animation.pc, -1);
    assert.equal(animation.registers[1], 0);
    animation.setVariable(1, 3);
    animation.start(frame);
    animation.step(frame);
    assert.equal(animation.duration, 4 + (expected.rand() % 7));
    assert.deepEqual(random.snapshot(), expected.snapshot());
    previous = animation;
  }
  assert.equal(payloadReads, 1, 'the presence query and both restarts share one mounted read');

  const saved = program(40),
    preloaded = program(60);
  storage.store.records.set('graphics/idle.anm', { data: { bytes: saved } });
  world.resourceCache = { peek: () => preloaded };
  assert.deepEqual(await files.readResolved(path), preloaded);
  world.resourceCache.peek = () => null;
  assert.deepEqual(await files.readResolved(path), saved);
  storage.store.records.clear();
  game.nativeSearch.overrides = updates;
  assert.deepEqual(await files.readResolved(path), updated);
  game.nativeSearch.overrides = [];
  assert.deepEqual(await files.readResolved(path), bytes);
  assert.equal(payloadReads, 1);

  game.applyStartup(null, game.nativeSearch);
  rejectRead = true;
  await assert.rejects(files.readResolved(path), /mount read failed/);
  rejectRead = false;
  assert.deepEqual(await files.readResolved(path), bytes);
  assert.equal(payloadReads, 3, 'a new mount and a read failure both require a fresh read');

  const fresh = new NativeImageFiles(world);
  fresh.restore(files.snapshot());
  assert.deepEqual(await fresh.readResolved(path), bytes);
  assert.equal(payloadReads, 4, 'restoring the file service does not carry the read through');

  archive.url = 'http://archives.invalid/replaced.int';
  const malformed = new Uint8Array(bytes.length);
  archiveBytes = kif([['idle.anm', malformed]]);
  assert.equal(await retained.load(draw, 2, path), false);
  assert.deepEqual(await files.readResolved(path), malformed);
  const replacement = program(100);
  archiveBytes = kif([['idle.anm', replacement]]);
  assert.deepEqual(await files.readResolved(path), replacement);
  assert.equal(payloadReads, 7, 'a replaced backing and malformed data keep normal reads');
  files.close();
  assert.deepEqual(await files.readResolved(path), replacement);
  assert.equal(payloadReads, 8);
});
