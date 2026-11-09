// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { HG2, encodeHG2 } from '../src/formats/hg2.mjs';
import { openImage, ImageStore } from '../src/formats/hg3.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { Binary } from '../src/binary.mjs';
import { memoryGame } from './helpers.mjs';

test('HG2 image entries retain transparent cropping, canvas dimensions, anchors and top/bottom colors', async () => {
  const rgba = new Uint8ClampedArray(4 * 3 * 4);
  rgba.set([255, 0, 0, 255], (1 * 4 + 2) * 4);
  rgba.set([0, 0, 255, 127], (2 * 4 + 2) * 4);
  const bytes = await encodeHG2({ width: 4, height: 3, rgba }, { id: 9, baseX: -2, baseY: 7 }),
    image = new HG2(bytes),
    frame = await image.decode(image.frame(9));
  assert.deepEqual(
    [
      frame.width,
      frame.height,
      frame.canvasWidth,
      frame.canvasHeight,
      frame.offsetX,
      frame.offsetY,
      frame.baseX,
      frame.baseY,
    ],
    [1, 2, 4, 3, 2, 1, -2, 7],
  );
  assert.deepEqual([...frame.rgba], [255, 0, 0, 255, 0, 0, 255, 127]);
  const game = memoryGame({ 'entry.hg2': bytes });
  game.resolve = (name) => `${name}.hg2`;
  assert.equal((await new ImageStore(game).frame('entry', 9)).offsetY, 1);
});

test('HG2 relative frame links preserve distinct IDs and reject a link into compressed data', async () => {
  const a = await encodeHG2(
      { width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, 255]) },
      { id: 1 },
    ),
    b = await encodeHG2({ width: 1, height: 1, rgba: new Uint8Array([0, 255, 0, 255]) }, { id: 7 }),
    combined = new Uint8Array(a.length + b.length - 12);
  combined.set(a);
  combined.set(b.subarray(12), a.length);
  new DataView(combined.buffer).setUint32(76, a.length - 12, true);
  const image = await openImage(combined);
  assert.deepEqual([...(await image.decode(image.frame(7))).rgba], [0, 255, 0, 255]);
  assert.equal(image.frame(2), undefined);
  new DataView(combined.buffer).setUint32(76, 76, true);
  assert.throws(() => new HG2(combined), /frame link/);
});

test('native F1/FB store a bitmap in a CTS entry and rebuild owned wrappers after a fresh runtime restore', async () => {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    game = memoryGame({}),
    storage = { read: async () => null, write: async () => true },
    create = () => {
      const random = new ParticleRandom();
      return new NativeWorld({
        game,
        images: {},
        host: {},
        profile,
        storage,
        random,
        configuration: new NativeConfiguration({ profile }),
        motionLibrary: new MotionLibrary(game, { profile, random }),
      });
    },
    first = create(),
    recordID = await first.objects.create({ kind: 12 }),
    task = { id: recordID, context: {} },
    machine = {},
    call = (world, id, args) =>
      world.runtime.native('main', id, args, machine, task, world.runtime.scheduler),
    file = new NativeGlobalFile(),
    global = first.runtime.handles.add('global-file', file),
    bitmap = first.graphics.images.create(2, 2, recordID);
  await first.graphics.images.get(bitmap).fill(0, 0, 2, 1, 0xffff0000);
  await first.graphics.images.get(bitmap).fill(0, 1, 2, 1, 0xff0000ff);
  assert.equal((await call(first, 0xf1, [global, 4, bitmap])).value, 1);
  assert.equal(new Binary(file.read(4)).magic('HG-2'), true);
  first.graphics.images.release(bitmap);
  assert.equal((await call(first, 0xfb, [global, 99])).value, 0);
  const second = create();
  await second.runtime.restore(first.runtime.snapshot());
  await second.objects.restore(first.objects.snapshot());
  const restored = (await call(second, 0xfb, [global, 4])).value,
    image = second.graphics.images.get(restored);
  assert.equal(image.owner, recordID);
  assert.deepEqual(
    [...(await image.pixels())],
    [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255],
  );
  await second.objects.release(recordID);
  assert.equal(second.runtime.handles.records.has(restored), false);
  await first.close();
  await second.close();
});
