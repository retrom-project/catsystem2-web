// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { packNativeMesh, decodeNativeMesh, transformNativeMesh } from '../src/native/mesh.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { floatBits } from '../src/kcs.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import {
  NativeTexturePages,
  NULL_NATIVE_TEXTURE,
  negotiateNativeTextureLayout,
} from '../src/native/texture-layout.mjs';

test('native texture limits preserve settings dimensions and page allocation with 4-bit alpha', async () => {
  const source = {
      size: [512, 512],
      grid: [2, 3],
      areas: [
        [1, 2, 3, 4],
        [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
      ],
      bppY: [1, 2],
      bpp: 32,
    },
    adjusted = negotiateNativeTextureLayout(source, { width: 256, height: 128 });
  assert.deepEqual([...adjusted.size], [256, 128]);
  assert.deepEqual([...adjusted.grid], [4, 12]);
  assert.deepEqual([...adjusted.areas[0]], [4, 8, 12, 16]);
  assert.deepEqual([...adjusted.areas[1]], [0xfffffffc, 0xfffffffc, 0xfffffffc, 0xfffffffc]);
  assert.deepEqual([...adjusted.bppY], [4, 8]);
  const layout = negotiateNativeTextureLayout({
      size: [3, 3],
      grid: [2, 1],
      areas: [[1, 0, 1, 1]],
      bppY: [0, 0],
      bpp: 32,
    }),
    pages = new NativeTexturePages(layout),
    frame = {
      width: 8,
      height: 4,
      rgba: Uint8ClampedArray.from(Array.from({ length: 32 }, () => [31, 47, 63, 79]).flat()),
    },
    bitmap = { frame: async () => frame };
  assert.deepEqual([...layout.configurationSize], [3, 3]);
  assert.deepEqual([...layout.size], [4, 4]);
  assert.equal(await pages.frame(0), NULL_NATIVE_TEXTURE);
  assert.equal(await pages.frame(2), NULL_NATIVE_TEXTURE);
  await pages.upload(bitmap);
  const texture = await pages.frame(1);
  assert.deepEqual([texture.width, texture.height], [4, 4]);
  assert.deepEqual([...texture.rgba.subarray(0, 4)], [17, 34, 51, 68]);
  assert.deepEqual([...frame.rgba.subarray(0, 4)], [31, 47, 63, 79]);
  assert.equal(await pages.frame(1), texture);
});

test('VRAM pages preserve uploads, lose pixels when freed and restart cleared after allocation or fresh restore', async () => {
  const first = world();
  await first.initialize('main.kcs');
  await first.graphics.fill(0, 0, 4, 2, 0xff123456);
  const left = await first.graphics.meshTexture(0),
    released = [];
  first.graphics.texturePages.releaseFrame = (frame) => released.push(frame);
  await first.runtime.native('main', 0x21d, [2, 0, 1, 1], first.main.machine, first.main);
  assert.equal(await first.graphics.meshTexture(1), NULL_NATIVE_TEXTURE);
  assert.equal(released.length, 1);
  await first.graphics.fill(0, 0, 4, 2, 0xffabcdef);
  assert.equal(await first.graphics.meshTexture(0), left);
  assert.deepEqual([...left.rgba.slice(0, 4)], [171, 205, 239, 255]);
  await first.runtime.native('main', 0x21e, [], first.main.machine, first.main);
  assert.equal(await first.graphics.meshTexture(0), left);
  assert.deepEqual([...(await first.graphics.meshTexture(1)).rgba], new Array(16).fill(0));
  await first.graphics.fill(3, 1, 1, 1, 0xff654321);
  const second = world();
  await second.restore(structuredClone(first.snapshot()));
  assert.deepEqual(await second.graphics.meshTexture(1), await first.graphics.meshTexture(1));
  await first.graphics.fill(2, 0, 2, 2, 0xff010203);
  assert.deepEqual([...(await second.graphics.meshTexture(1)).rgba.slice(12)], [101, 67, 33, 255]);
  await first.close();
  await second.close();
});

test('divided mesh transforms match authored golden outputs from both frozen engines', async () => {
  const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-mesh-golden.json', import.meta.url)),
  );
  for (const record of golden) {
    const bytes = (key) => new Uint8Array(Buffer.from(record[key], 'base64'));
    assert.deepEqual(
      transformNativeMesh(decodeNativeMesh(packNativeMesh(bytes('source'), 1)), bytes('state'), {
        matrixExplicit: true,
      }),
      decodeNativeMesh(bytes('expected')),
    );
  }
});

function world() {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    game = memoryGame({ 'main.kcs': kcsProgram([[37, 64], [43, 0x47, 4], [59]]) }),
    configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom();
  game.width = 4;
  game.height = 2;
  const texture = configuration.fields.texture;
  texture.size.set([2, 2]);
  texture.grid.set([2, 1]);
  texture.areas[0].set([0, 0, 2, 1]);
  texture.bppY.set([0, 1]);
  return new NativeWorld({
    game,
    images: {},
    host: {},
    profile,
    configuration,
    random,
    storage: { read: (name) => game.read(name), write: async () => true },
    motionLibrary: new MotionLibrary(game, { profile, random }),
  });
}

test('divided meshes sample their own VRAM page and retain data, coordinates and pixels after restore', async () => {
  const first = world();
  let second;
  try {
    await first.initialize('main.kcs');
    const id = await first.objects.create({ kind: 2, parent: first.main.id }),
      machine = first.main.machine;
    machine.store(128, 1);
    [0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 1].forEach((number, i) =>
      machine.store(132 + i * 4, floatBits(number)),
    );
    await first.runtime.native('main', 0x1d3, [id, 128, 1], machine, first.main);
    await first.runtime.native('main', 0x1d2, [id, 128], machine, first.main);
    await first.graphics.fill(2, 0, 2, 2, 0xff804020);
    const collect = async (current) => {
        const draws = [];
        await current.graphics
          .get(id)
          .drawGPU({ drawGeometry: (geometry, frame) => draws.push({ geometry, frame }) });
        return draws;
      },
      before = await collect(first);
    assert.equal(before.length, 1);
    assert.deepEqual([before[0].frame.width, before[0].frame.height], [2, 2]);
    assert.deepEqual(
      [...before[0].frame.rgba],
      Array.from({ length: 4 }, () => [128, 64, 32, 255]).flat(),
    );
    assert.deepEqual(
      before[0].geometry[0].vertices.map((v) => [v.x, v.y, v.color, v.u, v.v]),
      [
        [-0.5, -0.5, 0xffffffff, 0, 0],
        [1.5, -0.5, 0xffffffff, 1, 0],
        [-0.5, 1.5, 0xffffffff, 0, 1],
      ],
    );
    second = world();
    await second.restore(structuredClone(first.snapshot()));
    assert.equal(second.graphics.get(id).state.coordMode, 128);
    assert.deepEqual(await collect(second), before);
    await first.graphics.fill(2, 0, 2, 2, 0xff112233);
    assert.equal((await collect(first))[0].frame.rgba[0], 17);
    assert.equal((await collect(second))[0].frame.rgba[0], 128);
  } finally {
    await first.close();
    await second?.close();
  }
});
