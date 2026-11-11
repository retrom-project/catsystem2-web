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
      assert.equal(com(process, device.device, 23, 2, 2, 1, 1, 21, 0, out, 0), 0);
      const texture = device.objects.get(process.load(out)),
        target = { width: 2, height: 2 },
        rgba = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      device.gpu = {
        pixels(value) {
          assert.equal(value, target);
          return rgba;
        },
      };
      device.gpuTargets.set(texture.pointer, target);
      texture.dirty = true;
      try {
        // Snapshot and LockRect read back the owning texture ID. Public COM
        // operations must continue rejecting that ID as a Surface9 argument.
        device.syncSurface(texture.pointer, texture);
        assert.deepEqual(device.frame(texture.pointer).rgba, rgba);
        assert.equal(texture.dirty, false);
        assert.equal(device.surfaceData(texture.pointer), null);
      } finally {
        device.gpu = null;
        device.gpuTargets.clear();
      }
      com(process, texture.pointer, 2);
      return frame;
    } finally {
      device.close();
      renderer.dispose();
      process.close();
    }
  };
  assert.deepEqual(run(true), run(false));
});
