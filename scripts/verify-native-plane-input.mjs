// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativePlaneInputGeometry } from '../src/native/plane-input-geometry.mjs';
import { floatBits } from '../src/kcs.mjs';

export async function verifyNativePlaneInput(bytes, profile) {
  const sdk = profile.startsWith('sdk-'),
    [baseHandler, getBase, getPosition, query, register] = sdk
      ? [0x4bcc70, 0x54d210, 0x54d720, 32, 124]
      : [0x5e0920, 0x676180, 0x676640, 34, 126],
    engine = await NativeEngineProcess.open({ profile, bytes }),
    p = engine.process,
    table = p.allocate(40, true),
    plane = p.allocate(0x2ac, true),
    out = p.allocate(4, true);
  let registered, base, position;
  try {
    p.store(plane, table);
    p.store(plane + 4, 17);
    p.store(plane + 104, 1);
    p.store(engine.refs.settings + 522, 96 | (64 << 16));
    p.store(
      table + 16,
      p.trap(
        'authored original Graph input transport',
        7,
        ([sender, target, message, w, l, flags, reply]) => {
          if (message === query) {
            p.store(reply, 42);
            return 1;
          }
          assert.equal(message, register);
          assert.deepEqual([sender, target, flags], [17, 42, 0]);
          registered = [w | 0, ...Array.from({ length: 8 }, (_, i) => p.load(l + 4 * i) | 0)];
          return 1;
        },
      ),
    );
    engine.registerWindows('USER32.dll', 'SetRectEmpty', {
      count: 1,
      fn: ([pointer]) => {
        p.zero(pointer, 16);
        return 1;
      },
    });
    const queryGraph = (address, coordinates) =>
      engine.patch(
        address,
        'authored original graph coordinates',
        5,
        ([id, x, y, z, mode]) => {
          assert.equal(id, 17);
          assert.equal(mode, 0);
          [x, y, z].forEach((pointer, i) => p.store(pointer, floatBits(coordinates()[i])));
          return 1;
        },
        { calleePops: true },
      );
    queryGraph(getBase, () => base);
    queryGraph(getPosition, () => position);

    const samples = [-23.75, -2, -0.25, 0, 0.25, 18.75, 128.25, 0x80000000, NaN, Infinity];
    let fullScreen = 0;
    for (let i = 0; i <= 200; i++) {
      base = [samples[i % 10], samples[Math.floor(i / 10) % 10], samples[(i + 4) % 10]];
      position = [samples[(i + 3) % 10], samples[(i + 6) % 10], 89];
      let size = [samples[(i + 8) % 10], samples[(i + 1) % 10]];
      if (i === 200) {
        base = [0, 0, 19.25];
        position = [0, 0, 0];
        size = [96, 64];
      }
      const flag = (0xf2345678 + i) >>> 0,
        { priority, bounds } = nativePlaneInputGeometry(base, position, size),
        [left, top, right, bottom] = bounds,
        full = left <= 0 && top <= 0 && right >= 96 && bottom >= 64;
      fullScreen += Number(full);
      registered = null;
      p.store(plane + 108, 0xffffffff);
      p.store(plane + 176, floatBits(size[0]));
      p.store(plane + 180, floatBits(size[1]));
      p.store(out, 0xcccccccc);
      assert.equal(await engine.call(baseHandler, [23, sdk ? 87 : 89, 23, flag, 0, out], plane), 0);
      assert.equal(p.load(out), 0xcccccccc, 'the outer Graph receiver leaves the output unwritten');
      assert.deepEqual(registered, [
        priority,
        17,
        priority,
        7,
        ...(full ? [-100000, -100000, 100000, 100000] : bounds),
        0,
      ]);
      assert.deepEqual(
        [108, 116, 188, 192].map((offset) => p.load(plane + offset)),
        [23, flag, 1, flag],
      );
    }
    assert.ok(fullScreen, 'include the original full-screen expansion');
  } finally {
    await engine.close();
  }
}
