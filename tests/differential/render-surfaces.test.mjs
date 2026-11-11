// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { StageRenderer } from '../../src/render/stage.mjs';
import { EmoteD3D9 } from '../../src/emote/native-d3d.mjs';
import { PE32Process } from '../../src/ppi/pe32.mjs';
import { loadUnicorn } from '../../src/ppi/backend.mjs';
import { com } from '../fixtures/native-vmr-surface.mjs';

// This exercises the existing COM oracle harness with and without renderer
// ownership. Packed integer pixels, HRESULTs and lock bytes are exact.
test('renderer surface ownership preserves the DLL lock/copy/restore contract', async () => {
  const backend = await loadUnicorn();
  const run = (owned) => {
    const process = new PE32Process(backend),
      renderer = new StageRenderer(),
      device = new EmoteD3D9(process, {
        width: 4,
        height: 4,
        surfaces: owned ? renderer.surfaces : null,
      }),
      out = process.allocate(16, true);
    try {
      assert.equal(com(process, device.device, 23, 3, 2, 1, 0, 26, 1, out, 0), 0);
      const pointer = process.load(out),
        record = device.objects.get(pointer);
      assert.equal(com(process, pointer, 19, 0, out, 0, 0), 0);
      const projected = process.load(out + 4),
        pixels = Uint8Array.from({ length: record.pitch * record.height }, (_, i) => i * 17);
      process.write(projected, pixels);
      assert.equal(com(process, pointer, 20, 0), 0);
      const frame = device.frame(pointer);
      if (owned) {
        assert.deepEqual(renderer.surfaces.get(record.surfaceID).bytes, pixels);
        process.zero(projected, pixels.length);
        assert.deepEqual(device.frame(pointer), frame);
      }
      assert.equal(com(process, pointer, 19, 0, out, 0, 16), 0);
      assert.deepEqual(process.read(process.load(out + 4), pixels.length), pixels);
      assert.throws(() => device.snapshot(), /locked/);
      assert.equal(com(process, pointer, 20, 0), 0);
      const saved = structuredClone(device.snapshot());
      device.restore(saved);
      assert.deepEqual(device.frame(pointer), frame);
      assert.equal(com(process, pointer, 2), 0);
      assert.equal(renderer.surfaces.records.size, 0);
      assert.throws(() => device.frame(pointer), /invalid texture/);
      return frame;
    } finally {
      device.close();
      renderer.dispose();
      process.close();
    }
  };
  assert.deepEqual(run(true), run(false));
});
