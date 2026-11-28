// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeImages } from '../src/native/image.mjs';
import { NativeTexturePages, negotiateNativeTextureLayout } from '../src/native/texture-layout.mjs';
import { checkpointBytes, serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

function resources() {
  const handles = new NativeHandles(),
    world = { runtime: { handles }, images: {} },
    images = new NativeImages(world),
    pages = new NativeTexturePages(
      negotiateNativeTextureLayout({
        size: [1024, 1024],
        grid: [1, 2],
        areas: [[0, 0, 1, 2]],
        bppY: [0, 1],
        bpp: 32,
      }),
    );
  return { handles, images, pages };
}
test('portable sparse pixels preserve bitmap aliases, independent CPU edits and stale 32/16-bit texture pages', async () => {
  const first = resources(),
    image = first.images.create(1024, 2048, 7),
    alias = first.images.alias(image, 9),
    bitmap = first.images.get(image);
  await bitmap.fill(0, 0, 1, 1, 0x4f1f2f3f);
  await bitmap.fill(3, 1025, 1, 1, 0x8f5f6f7f);
  await first.pages.upload(bitmap);
  assert.deepEqual([...first.pages.frame(0).rgba.slice(0, 4)], [31, 47, 63, 79]);
  const lower = (1024 + 3) * 4;
  assert.deepEqual([...first.pages.frame(1).rgba.slice(lower, lower + 4)], [85, 102, 119, 136]);
  // The CPU bitmap changes without a GPU upload. Restoring by uploading the
  // bitmap would incorrectly discard both native page contents and depth.
  await first.images.get(alias).fill(0, 0, 1, 1, 0xffabcdef);
  const checkpoint = { handles: first.handles.snapshot(), pages: first.pages.snapshot() };
  assert.ok(checkpointBytes(checkpoint) < 256 * 1024);
  const saved = await deserializeCheckpoint(await serializeCheckpoint(checkpoint)),
    fresh = resources();
  fresh.handles.restore(saved.handles);
  fresh.pages.restore(saved.pages);
  assert.equal(fresh.images.get(image).state, fresh.images.get(alias).state);
  assert.notEqual(fresh.images.get(image).state, bitmap.state);
  assert.deepEqual(await fresh.images.get(image).pixels(), await bitmap.pixels());
  for (const index of [0, 1]) assert.deepEqual(fresh.pages.frame(index), first.pages.frame(index));
  assert.deepEqual([...fresh.images.get(alias).state.rgba.slice(0, 4)], [171, 205, 239, 255]);
  assert.deepEqual([...fresh.pages.frame(0).rgba.slice(0, 4)], [31, 47, 63, 79]);
  await bitmap.fill(0, 0, 1, 1, 0xff000001);
  assert.deepEqual([...fresh.images.get(alias).state.rgba.slice(0, 4)], [171, 205, 239, 255]);
  await fresh.images.releaseOwner(7);
  assert.ok(fresh.images.get(alias));
  await fresh.images.releaseOwner(9);
  assert.equal(fresh.handles.records.size, 0);
  await first.images.releaseOwner(7);
  await first.images.releaseOwner(9);
  first.pages.close();
  fresh.pages.close();
});
