// SPDX-License-Identifier: MPL-2.0
// Independent authored input: distinct states, unequal pieces and cross offsets.
import { encodeHG2 } from '../../src/formats/hg2.mjs';

function link(frames) {
  const out = new Uint8Array(12 + frames.reduce((size, frame) => size + frame.length - 12, 0));
  out.set(frames[0].subarray(0, 12));
  let at = 12;
  frames.forEach((frame, index) => {
    const bytes = frame.slice(12);
    new DataView(bytes.buffer).setUint32(64, index + 1 < frames.length ? bytes.length : 0, true);
    out.set(bytes, at);
    at += bytes.length;
  });
  return out;
}
async function tile(id, W, H, x, y, width, height, state, part) {
  const rgba = new Uint8Array(W * H * 4);
  for (let iy = y; iy < y + height; iy++)
    for (let ix = x; ix < x + width; ix++)
      rgba.set(
        [
          25 + state * 35 + part * 9 + (ix - x),
          20 + (iy - y) * 11,
          70 + part,
          part === 3 ? 160 : 255,
        ],
        (iy * W + ix) * 4,
      );
  return encodeHG2({ width: W, height: H, rgba }, { id });
}
export async function extraControlFiles() {
  const controls = [],
    scroll = [];
  for (let state = 0; state < 4; state++) {
    for (const [part, x, y, w, h] of [
      [0, 0, 0, 4, 3],
      [1, 0, 0, 2, 2],
      [2, 0, 0, 3, 4],
      [3, 1, 2, 2, 2],
    ])
      controls.push(await tile(state * 100 + part, 8, 8, x, y, w, h, state, part));
    for (const [base, x, y, w, h, part] of [
      [10, 0, 2, 7, 8, 0],
      [20, 71, 3, 9, 6, 1],
      [100, 8, 1, 64, 9, 2],
      [200, 25, 4, 3, 3, 3],
    ])
      scroll.push(await tile(base + state, 80, 12, x, y, w, h, state, part));
  }
  scroll.push(await tile(0, 80, 12, 0, 0, 80, 12, 0, 0));
  for (const [id, x, y, w, h] of [
    [1000, 8, 1, 6, 4],
    [1001, 14, 2, 50, 7],
    [1002, 64, 3, 8, 6],
  ])
    scroll.push(await tile(id, 80, 12, x, y, w, h, 0, 0));
  return { 'controls.hg2': link(controls), 'scroll.hg2': link(scroll) };
}
