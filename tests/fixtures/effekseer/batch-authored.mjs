// SPDX-License-Identifier: MPL-2.0
// Authored CC0 effect outputs. Fixed1.23 exporter layout, never native bytes.
import { EffectWriter as W } from './authored-effect.mjs';
const tags = { sprite: 2, ribbon: 3, ring: 4, track: 6 },
  zero = [0, 0, 0];
export const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const fixedColor = (w, color) => w.int(0).raw(color);
export function batchEffect({ nodes = [{}], colorPaths = [], distortionPaths = [] } = {}) {
  const w = new W()
    .raw(83, 75, 70, 69)
    .int(9)
    .paths(colorPaths)
    .paths([])
    .paths(distortionPaths)
    .paths([])
    .paths([])
    .float(1)
    .int(0)
    .int(-1, nodes.length);
  for (const n of nodes) {
    const kind = n.kind ?? 'sprite',
      tag = tags[kind],
      trail = kind === 'ribbon' || kind === 'track',
      count = n.count ?? (trail ? 4 : 1),
      color = n.color ?? [255, 0, 0, 255],
      common = new W()
        .int(count, 2, 2, 2, 1, 0, 0, 100, 100)
        .float(n.interval ?? (trail ? 1 : 0), n.interval ?? (trail ? 1 : 0), 0, 0);
    w.int(tag).sized(common.bytes());
    if (trail)
      w.int(1).sized(
        new W()
          .float([0, -0.375, 0], [0, -0.375, 0], [0, 0.25, 0], [0, 0.25, 0], zero, zero)
          .bytes(),
      );
    else w.int(0).sized(new W().float(n.position ?? zero).bytes());
    w.int(0, 0, 0x7ffffffe, 0x7ffffffe, 0, 0).float(zero, zero);
    w.int(
      n.textureIndex ?? -1,
      n.blend ?? 0,
      n.filter ?? 0,
      n.wrap ?? 1,
      Number(n.zTest ?? true),
      Number(n.zWrite ?? false),
      0,
      0,
      0,
      Number(n.distortion ?? false),
    ).float(1);
    w.int(tag);
    if (kind === 'sprite') {
      w.int(0, 2);
      fixedColor(w, color);
      w.int(0, 1).float(n.corners ?? [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
    } else if (kind === 'ribbon') {
      w.int(0);
      fixedColor(w, color);
      w.int(0, 1).float(-0.25, 0.25);
    } else if (kind === 'ring') {
      w.int(0, 2, n.segments ?? 8, 0)
        .float(360)
        .int(0)
        .float(0.75, 0)
        .int(0)
        .float(0.35, 0)
        .int(0)
        .float(0.5);
      for (let i = 0; i < 3; i++) fixedColor(w, color);
    } else if (kind === 'track') {
      for (let i = 0; i < 3; i++) w.int(0).float(0.5);
      for (let i = 0; i < 6; i++) fixedColor(w, color);
    } else throw new Error('Unknown authored batch geometry ' + kind);
    w.int(0, 0);
  }
  return w.bytes();
}
