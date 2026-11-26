// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function fontOutlineProbe(t, version) {
  const directory = process.env.CS2_FT_PROBES_ROOT
    ? pathToFileURL(resolve(process.env.CS2_FT_PROBES_ROOT) + '/')
    : new URL('../../.local/vendor/freetype-tests/', import.meta.url);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(new URL('freetype-test-manifest.json', directory)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('Prepare the optional pinned FreeType C test probes');
    return null;
  }
  for (const [field, file] of [
    ['wrapperSHA256', '../../third_party/freetype/native-font.c'],
    ['probeSHA256', './freetype-outline-probe.c'],
  ])
    assert.equal(manifest.inputs[field], digest(await readFile(new URL(file, import.meta.url))));
  const artifact = manifest.artifacts[version],
    url = new URL(artifact.path, directory);
  assert.equal(digest(await readFile(url)), artifact.sha256);
  const { default: factory } = await import(url.href),
    module = await factory();
  module._cs2_font_advance(0, 0, 0);
  module._cs2_font_glyph(0, 0, 0, 0);
  module._cs2_font_probe_stat(0);
  module._cs2_font_probe_control(0, 0, 0);
  return fontOutlineBackend(module, true);
}

export function fontOutlineBackend(module, probe = false) {
  const output = module._malloc(32),
    records = new Set();
  const read = (words) => {
    const [width, height, originX, originY, advanceX, pointer, pitch, pixelMode] = words,
      alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        alpha[y * width + x] =
          pixelMode === 1
            ? module.HEAPU8[pointer + y * pitch + (x >>> 3)] & (0x80 >>> (x & 7))
              ? 255
              : 0
            : module.HEAPU8[pointer + y * pitch + x];
    return { width, height, originX, originY, advanceX, pitch, pixelMode, alpha };
  };
  const backend = {
    open(bytes) {
      const input = module._malloc(bytes.length);
      module.HEAPU8.set(bytes, input);
      const face = module._cs2_font_open(input, bytes.length, 0);
      assert(face, 'valid test memory face');
      const record = { face, input };
      records.add(record);
      return record;
    },
    advance(record, size, code) {
      return module._cs2_font_advance(record.face, size, code);
    },
    glyph(record, size, code) {
      module.HEAPU8.fill(0xa5, output, output + 32);
      const reply = module._cs2_font_glyph(record.face, size, code, output),
        words = Array.from(module.HEAP32.subarray(output >>> 2, (output >>> 2) + 8));
      if (!reply) {
        assert(module.HEAPU8.subarray(output, output + 32).every((byte) => byte === 0xa5));
        return null;
      }
      return { ...read(words), held: () => read(words) };
    },
    close(record) {
      if (!records.delete(record)) return;
      module._cs2_font_close(record.face);
      module._free(record.input);
    },
    dispose() {
      for (const record of records) backend.close(record);
      module._free(output);
    },
  };
  if (probe) {
    Object.assign(backend, {
      stats: () =>
        Object.fromEntries(
          [
            'defaultLoads',
            'renderLoads',
            'outlineCopies',
            'bitmapCalls',
            'entries',
            'bytes',
            'outputs',
            'injectedFaults',
          ].map((name, index) => [name, module._cs2_font_probe_stat(index)]),
        ),
      reset: () => module._cs2_font_probe_control(0, 0, 0),
      fault: (kind) => module._cs2_font_probe_control(0, 1, kind),
      transform: (record, kind) => module._cs2_font_probe_control(record.face, 2, kind),
      charmap: (record, index) => module._cs2_font_probe_control(record.face, 3, index),
      charmapCount: (record) => module._cs2_font_probe_control(record.face, 4, 0),
      driver: (record) => module._cs2_font_probe_control(record.face, 5, 0),
    });
  }
  return backend;
}

export function glyphSummary(glyph) {
  if (!glyph) return null;
  const { alpha, held, ...metrics } = glyph;
  void held;
  return { ...metrics, alphaSHA256: digest(alpha) };
}
