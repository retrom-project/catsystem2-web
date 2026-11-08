// SPDX-License-Identifier: MPL-2.0
// Compare the mounted engine's complete HG3 reader with public logical RGBA.
// Authored probes are redistributable; mounted resource names/hashes/results
// are written only to the caller's ignored report file.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { HG3 } from '../src/formats/hg3.mjs';
import { authoredHG3, authoredHG3Frames } from '../tests/fixtures/hg3.mjs';
import { nodeGame } from './node-files.mjs';

const [exe, output, resourceRoot] = process.argv.slice(2);
if (!exe || !output)
  throw new Error(
    'Usage: node scripts/verify-native-hg3.mjs FROZEN_EXE IGNORED_REPORT [MOUNTED_ROOT]',
  );
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  bytes = new Uint8Array(await readFile(exe)),
  sha256 = hash(bytes),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, value]) => value.sha256 === sha256)?.[0];
if (!profile) throw new Error('HG3 oracle requires a frozen executable');
const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  buffers = new NativeDataBuffers(engine),
  pixelAt = profile.startsWith('sdk-') ? 0x5638e0 : 0x68cd70,
  results = [],
  skipped = [];
async function compare(name, bytes, selectors) {
  const image = new HG3(bytes),
    source = buffers.createPointer(bytes);
  try {
    for (const selector of selectors ?? image.frames.map((frame) => frame.id)) {
      const frame = image.frame(selector);
      if (!frame || ![...frame.sections.keys()].some((key) => /^img\d+$/.test(key))) {
        skipped.push({ name, selector, reason: 'non-lossless HG3 section family' });
        continue;
      }
      const wrapper = await buffers.decodeBitmapPointer(source, selector);
      assert.ok(wrapper, `${name}:${selector} original reader failed`);
      try {
        const pointer = p.load(wrapper),
          native = new Uint8ClampedArray(frame.width * frame.height * 4),
          metadata = [4, 8, 28, 32, 36, 40, 48, 52].map((offset) => p.load(pointer + offset) | 0),
          fields = [
            'width',
            'height',
            'canvasWidth',
            'canvasHeight',
            'offsetX',
            'offsetY',
            'baseX',
            'baseY',
          ];
        assert.deepEqual(
          metadata,
          fields.map((field) => frame[field]),
          `${name}:${selector} metadata`,
        );
        for (let y = 0; y < frame.height; y++) {
          const address = await engine.call(pixelAt, [0, y], pointer),
            row = p.read(address, frame.width * 4);
          for (let x = 0; x < frame.width; x++)
            native.set(
              [row[x * 4 + 2], row[x * 4 + 1], row[x * 4], row[x * 4 + 3]],
              (y * frame.width + x) * 4,
            );
        }
        await image.decode(frame);
        assert.deepEqual(frame.rgba, native, `${name}:${selector} logical RGBA`);
        results.push({ name, selector, metadata, bytes: native.length, sha256: hash(native) });
      } finally {
        await buffers.releaseBitmapPointer(wrapper);
      }
    }
  } finally {
    buffers.releasePointer(source);
  }
}
try {
  await compare('authored', authoredHG3(authoredHG3Frames(36)));
  if (resourceRoot) {
    const game = await nodeGame(resourceRoot),
      names = game.names('hg3').sort(),
      selected = new Set([
        ...Array.from(
          { length: Math.min(12, names.length) },
          (_, i) => names[Math.floor((i * names.length) / Math.min(12, names.length))],
        ),
        ...names.slice(-8),
      ]);
    for (const name of selected) {
      const source = await game.require(name),
        image = new HG3(source),
        selectors = [
          ...new Set([
            image.frames[0].id,
            image.frames[Math.floor(image.frames.length / 2)].id,
            image.frames.at(-1).id,
          ]),
        ];
      await compare(name, source, selectors);
    }
  }
  await writeFile(output, JSON.stringify({ profile, sha256, results, skipped }, null, 2) + '\n');
  console.log(
    `${profile}: ${results.length} HG3 frames / ${results.reduce((sum, result) => sum + result.bytes, 0)} RGBA bytes agree; ${skipped.length} other section families recorded separately`,
  );
} finally {
  engine.close();
}
