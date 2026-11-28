// SPDX-License-Identifier: MPL-2.0
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { authoredHG3 } from './hg3.mjs';
export async function imageOwnerFiles() {
  const rgba = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) => (i * 37 + 19) & 255),
    image = await encodeHG2(
      { width: 4, height: 3, rgba },
      { crop: false, clearTransparent: false, baseX: 2, baseY: -1 },
    );
  const animation = new Uint8Array(32 + 68 * 2),
    av = new DataView(animation.buffer);
  av.setUint32(0, 0x4d4e41, true);
  av.setUint32(8, 2, true);
  av.setUint32(32, 12, true);
  av.setUint32(40, 128, true);
  [0, 0, 2, 2].forEach((word, i) => av.setUint32(32 + 68 + (i ? 8 + (i - 1) * 8 : 0), word, true));
  const hg3 = authoredHG3([{ id: 0, width: 4, height: 3, rgba }]),
    attribute = new Uint8Array(hg3.length + 36),
    view = new DataView(attribute.buffer);
  attribute.set(hg3);
  let tag = 20;
  while (view.getUint32(tag + 8, true)) tag += view.getUint32(tag + 8, true);
  view.setUint32(tag + 8, hg3.length - tag, true);
  attribute.set(new TextEncoder().encode('ats0007\0'), hg3.length);
  view.setUint32(hg3.length + 12, 20, true);
  [10, -20, 30, -40, 0xff800123].forEach((word, i) =>
    view.setUint32(hg3.length + 16 + i * 4, word, true),
  );
  return new Map([
    ['@cat/image/probe.hg2', image],
    ['@cat/image/second.hg2', image],
    ['@cat/image/broken.hg2', Uint8Array.of(12, 34, 56, 78)],
    ['@cat/image/empty.hg2', new Uint8Array()],
    ['@cat/image/attr.hg3', attribute],
    ['@cat/image/anim.hg2', image],
    ['@cat/image/anim.anm', animation],
    ['@cat/image/composite_1.hg2', image],
    ['@cat/image/composite_1.anm', animation],
    ['@cat/image/composite_02.hg2', image],
    ['@cat/image/composite_02.anm', animation],
  ]);
}
