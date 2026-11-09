// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../../src/kcs.mjs';
export function viewStateBytes(graphics) {
  const v = graphics.view,
    ratios = v.ratios ?? [
      Math.fround(v.virtualWidth / v.clientWidth),
      Math.fround(v.virtualHeight / v.clientHeight),
    ];
  const words = [
    graphics.cameraNearWord,
    v.virtualWidth,
    v.virtualHeight,
    ...v.drawingRectangle,
    ...v.deviceOffset.map(floatBits),
    floatBits(v.deviceScale),
    ...ratios.map(floatBits),
    Number(v.active),
  ];
  const bytes = new Uint8Array(words.length * 4),
    d = new DataView(bytes.buffer);
  words.forEach((w, i) => d.setUint32(i * 4, w, true));
  return bytes;
}
