// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { floatBits } from '../src/kcs.mjs';

test('legacy divided model registration starts hidden and occupied-key rejection preserves display', async () => {
  for (const profile of [
    'grisaia-jp-engine-2.6.1.23',
    'rebellions-jp-engine-2.6.1.63',
    'bokutomo-engine-2.6.1.67',
  ]) {
    const w = await dataWorld(
      profile,
      {},
      {
        startup: parseNativeXML(
          encodeCP932(
            '<?xml version="1.0" encoding="Shift_JIS"?><document><TEXTURE><size><x>8</x><y>8</y></size><vt><x>1</x><y>1</y></vt><area00><sx>0</sx><sy>0</sy><dx>1</dx><dy>1</dy></area00><bpp>32</bpp></TEXTURE></document>',
          ),
        ),
      },
    );
    try {
      w.graphics.createLogicalDevice();
      const t = w.main,
        m = t.machine,
        call = (id, args) => w.runtime.native('main', id, args, m, t);
      m.bytes(128, 5).set(encodeCP932('Mesh\0'));
      const id = (await call(66, [2, w.nativeTaskID(t.id), 128])).value,
        plane = w.graphics.get(w.resolveTaskID(id, t.id)),
        source = [0, ...[0, 8, 0, 0, 0, 8, 100, 100, 100, 0, 1, 0, 0, 0, 1].map(floatBits)],
        draws = async () => {
          let n = 0;
          await plane.drawGPU({
            drawGeometry() {
              n++;
            },
          });
          return n;
        };
      source.forEach((word, i) => m.store(1024 + 4 * i, word));
      await call(542, []);
      await call(467, [id, 1024, 1]);
      assert.equal(await draws(), 0, profile + ' fresh hidden registration');
      await call(92, [id, 1]);
      assert.equal(await draws(), 1);
      const old = plane.graph;
      await call(467, [id, 1024, 1]);
      assert.equal(plane.graph, old, profile + ' original occupied-key rejection');
      assert.equal(await draws(), 1, 'rejected candidate does not hide the old shown model');
      await call(83, [id]);
      await call(467, [id, 1024, 1]);
      assert.notEqual(plane.graph, old);
      assert.equal(await draws(), 0, 'unload/recreate resets display');
      await call(92, [id, 1]);
      assert.equal(await draws(), 1);
    } finally {
      await w.close({ flushFiles: false });
    }
  }
});
