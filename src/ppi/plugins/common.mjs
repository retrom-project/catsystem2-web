// SPDX-License-Identifier: MPL-2.0
import { truncateFloat32 } from '../numeric.mjs';
export const f = Math.fround;
export const integer = truncateFloat32;
export const delta = (i) => integer(f((i.frame - i.before) >>> 0));
export const alpha = (p, value) => {
  for (const vertex of p.vertices) vertex.color = (((integer(value) & 255) << 24) | 0xffffff) >>> 0;
};
export function uv(p, x, y, w, h) {
  p.vertices[0].u = x;
  p.vertices[0].v = y;
  p.vertices[1].u = f(x + w);
  p.vertices[1].v = y;
  p.vertices[2].u = x;
  p.vertices[2].v = f(y + h);
  p.vertices[3].u = f(x + w);
  p.vertices[3].v = f(y + h);
}
export function centeredQuad(p, w, h) {
  p.vertices[0].x = f(w * -0.5);
  p.vertices[0].y = f(h * -0.5);
  p.vertices[1].x = f(w * 0.5);
  p.vertices[1].y = f(h * -0.5);
  // The original third vertex uses width for Y.
  p.vertices[2].x = f(w * -0.5);
  p.vertices[2].y = f(w * 0.5);
  p.vertices[3].x = f(w * 0.5);
  p.vertices[3].y = f(h * 0.5);
}
export function anchorOffset(i) {
  return [
    f(i.attachPos[0] - f(i.parameters.screenWidth * 0.5)),
    f(i.attachPos[1] - f(i.parameters.screenHeight * 0.5)),
  ];
}
