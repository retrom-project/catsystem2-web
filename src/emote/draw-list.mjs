// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit EmoteRenderer / EmoteDrawList (OWCramer).
import { contentDefaults } from './model.mjs';
const identityPatch = Array.from({ length: 16 }, (_, i) => [
  (i % 4) / 3,
  Math.floor(i / 4) / 3,
]).flat();
export function stateAt(layer, time) {
  const frames = layer.frames;
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  if (!lo || !frames[lo - 1].type) return null;
  const a = frames[lo - 1],
    b = frames[lo];
  if (a.type !== 3 || !b?.type || b.time <= a.time) return a.content;
  const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))),
    c = { ...a.content };
  for (const key of [
    'x',
    'y',
    'z',
    'ox',
    'oy',
    'angle',
    'scaleX',
    'scaleY',
    'slantX',
    'slantY',
    'opacity',
  ])
    c[key] += (b.content[key] - c[key]) * t;
  if (c.mesh || b.content.mesh)
    c.mesh = (c.mesh || identityPatch).map(
      (v, i) => v + ((b.content.mesh || identityPatch)[i] - v) * t,
    );
  return c;
}
function place(c) {
  let a = c.flipX ? -1 : 1,
    b = 0,
    x = 0,
    d = c.flipY ? -1 : 1;
  b = Math.tan((c.slantY * Math.PI) / 180) * a;
  x = Math.tan((c.slantX * Math.PI) / 180) * d;
  a *= c.scaleX;
  x *= c.scaleX;
  b *= c.scaleY;
  d *= c.scaleY;
  if (c.angle) {
    const cs = Math.cos((c.angle * Math.PI) / 180),
      sn = Math.sin((c.angle * Math.PI) / 180);
    [a, b, x, d] = [cs * a - sn * b, sn * a + cs * b, cs * x - sn * d, sn * x + cs * d];
  }
  return [a, b, x, d, c.x - (a * c.ox + x * c.oy), c.y - (b * c.ox + d * c.oy)];
}
export function playTime(time, motion) {
  if (!motion.lastTime || time <= motion.lastTime) return time;
  return motion.loopTime >= 0 && motion.lastTime > motion.loopTime
    ? motion.loopTime + ((time - motion.loopTime) % (motion.lastTime - motion.loopTime))
    : Math.max(0, motion.lastTime - 0.001);
}

export function drawList(
  model,
  variables,
  time = 0,
  transform = [1, 0, 0, 1, 0, 0],
  object,
  motionName,
) {
  const nodes = [
      { transform, parent: -1, bent: false, mesh: null, box: [0, 0, 1, 1], opacity: 1, z: 0 },
    ],
    items = [],
    stencils = [];
  const motion = model.objects[object || model.baseObject]?.[motionName || model.baseMotion];
  if (!motion) throw new Error('E-mote root motion missing');
  function evaluate(motion, time, parentIndex, clips, depth) {
    if (depth > 16) throw new Error('E-mote motion recursion');
    const subtree = new Map();
    function layerTime(layer) {
      const p = motion.parameters[layer.parameterize ?? motion.defaultParameter];
      if (!p) return time;
      const range = p.rangeEnd - p.rangeBegin;
      if (Math.abs(range) < 1e-7) return 0;
      const value = Math.max(
        Math.min(p.rangeBegin, p.rangeEnd),
        Math.min(Math.max(p.rangeBegin, p.rangeEnd), variables[p.id] ?? p.rangeBegin),
      );
      let normalized = (value - p.rangeBegin) / range;
      if (p.discretization) {
        const r = Math.abs(range),
          steps = r >= 1 && Math.abs(r - Math.round(r)) < 1e-7 ? Math.round(r) : p.division;
        if (steps > 0) normalized = Math.round(normalized * steps) / steps;
      }
      return (
        Math.max(0, Math.min(1, normalized)) *
        Math.max(0, motion.lastTime > 0 ? motion.lastTime - 1 : p.division || 0)
      );
    }
    function visit(layer, parentIndex, clips, treeDepth) {
      if (treeDepth > 64 || nodes.length >= 8192) throw new Error('E-mote layer limit');
      const state = stateAt(layer, layerTime(layer));
      if (!state && layer.type !== 2) return;
      const first = items.length,
        c = state || contentDefaults,
        source = model.sources[c.src];
      let icon = source?.icons[c.icon];
      if (layer.type === 0 && c.src === 'blank' && c.icon) {
        const p = c.icon.split(':').map(Number);
        if (p.length === 4) icon = { width: p[0], height: p[1], originX: p[2], originY: p[3] };
      }
      const parent = nodes[parentIndex],
        index = nodes.length;
      const node = {
        transform: place(c),
        parent: parentIndex,
        mesh: icon ? c.mesh : null,
        bent: parent.bent || !!(icon && c.mesh),
        box: [
          icon?.originX || 0,
          icon?.originY || 0,
          Math.max(1, icon?.width || 1),
          Math.max(1, icon?.height || 1),
        ],
        opacity: parent.opacity * (state ? c.opacity : 1),
        z: parent.z + c.z,
      };
      nodes.push(node);
      if (state && layer.type === 0 && c.src !== 'blank' && source && icon && node.opacity > 0)
        items.push({
          node: index,
          texture: source.texture,
          icon,
          divisions: node.bent ? layer.divisions : 1,
          opacity: node.opacity,
          clips,
          label: layer.label,
          z: node.z,
        });
      if (state && layer.type === 3) {
        const sub = model.objects[c.src]?.[c.icon];
        if (sub) evaluate(sub, playTime(time + c.timeOffset, sub), index, clips, depth + 1);
      }
      let childClips = clips;
      if (state && layer.type === 12 && layer.masks.length) {
        const stencil = { labels: layer.masks, subtree };
        stencils.push(stencil);
        childClips = [...clips, stencils.length - 1];
      }
      for (const child of layer.children) visit(child, index, childClips, treeDepth + 1);
      if (model.maskLabels.has(layer.label) && items.length > first)
        subtree.set(layer.label, [...(subtree.get(layer.label) || []), ...items.slice(first)]);
    }
    for (const layer of motion.layers) visit(layer, parentIndex, clips, 0);
  }
  evaluate(motion, time, 0, [], 0);
  items.sort((a, b) => a.z - b.z);
  const masks = stencils.map((s) => s.labels.flatMap((label) => s.subtree.get(label) || []));
  return { nodes, items, masks };
}

export function pointToRoot(nodes, index, x, y) {
  while (index >= 0) {
    const node = nodes[index],
      [a, b, c, d, tx, ty] = node.transform;
    if (node.mesh) {
      const [ox, oy, w, h] = node.box,
        u = (x + ox) / w,
        v = (y + oy) / h;
      const bu = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3],
        bv = [(1 - v) ** 3, 3 * v * (1 - v) ** 2, 3 * v * v * (1 - v), v ** 3];
      let px = 0,
        py = 0;
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          const q = (j * 4 + i) * 2;
          px += node.mesh[q] * bu[i] * bv[j];
          py += node.mesh[q + 1] * bu[i] * bv[j];
        }
      x = px * w - ox;
      y = py * h - oy;
    }
    [x, y] = [a * x + c * y + tx, b * x + d * y + ty];
    index = node.parent;
  }
  return [x, y];
}
