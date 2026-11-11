// SPDX-License-Identifier: BSD-3-Clause
// Motion layer evaluation adapted from motionplayer. NOTICE.md and
// licenses/motionplayer.txt retain the original source and license.
const f = Math.fround;
export const neutralColor = 0xff808080;
export const identityPatch = Float32Array.from(
  { length: 32 },
  (_, i) => (i & 1 ? i >> 3 : (i >> 1) & 3) / 3,
);

export function colorProduct(a, b) {
  let result = Math.trunc(((a >>> 24) * (b >>> 24)) / 255) << 24;
  for (let shift = 0; shift < 24; shift += 8)
    result |= Math.min(255, (((a >>> shift) & 255) * ((b >>> shift) & 255)) >> 7) << shift;
  return result >>> 0;
}

export function colorLerp(a, b, ratio) {
  const weight = Math.trunc(ratio * 256),
    inverse = 256 - weight;
  let out = 0;
  for (let shift = 0; shift < 32; shift += 8)
    out |=
      (((((a >>> shift) & 255) * inverse + ((b >>> shift) & 255) * weight) >>> 8) & 255) << shift;
  return out >>> 0;
}

export function colorBilinear(colors, u, v) {
  // The target truncates the packed vertical edge colors first, then the
  // horizontal interpolation. Reversing those two stores changes bytes.
  return colorLerp(colorLerp(colors[0], colors[3], v), colorLerp(colors[1], colors[2], v), u);
}

// No non-null per-key interpolation curves occur in the reviewed prepared
// PSBs. Keep that unverified boundary explicit instead of guessing a curve
// representation from its array length.
export function curveValue(curve, value) {
  if (curve == null) return value;
  throw new Error('Unsupported E-mote per-key interpolation curve');
}

export function layerContent(content = {}) {
  const mask = content.mask ?? 0,
    c = {
      src: content.src,
      icon: content.icon,
      ox: mask & 1 ? (content.ox ?? 0) : 0,
      oy: mask & 1 ? (content.oy ?? 0) : 0,
      x: mask & 2 ? (content.coord?.[0] ?? 0) : 0,
      y: mask & 2 ? (content.coord?.[1] ?? 0) : 0,
      z: mask & 2 ? (content.coord?.[2] ?? 0) : 0,
      flipX: Boolean(mask & 4 && content.fx),
      flipY: Boolean(mask & 8 && content.fy),
      angle: mask & 16 ? (content.angle ?? 0) : 0,
      scaleX: mask & 96 ? (content.zx ?? 1) : 1,
      scaleY: mask & 96 ? (content.zy ?? 1) : 1,
      slantX: mask & 384 ? (content.sx ?? 0) : 0,
      slantY: mask & 384 ? (content.sy ?? 0) : 0,
      opacity: mask & 1024 ? (content.opa ?? 0) : 255,
      blend: mask & 131072 ? (content.bm ?? 0) : 16,
      timeOffset: mask & 524288 ? (content.motion?.timeOffset ?? 0) : 0,
      motionFlags: mask & 524288 ? (content.motion?.mask ?? 0) : 0,
      motion: content.motion,
      curves: content,
      patch: mask & 33554432 ? (content.mesh?.bp ?? content.obj?.bezierPatch ?? null) : null,
    };
  const color =
    mask & 512
      ? content.color
      : (c.blend & 15) === 6
        ? 0xffffffff
        : c.blend & 16
          ? neutralColor
          : 0xffffffff;
  c.colors = Uint32Array.from(
    Array.isArray(color) ? color : [color, color, color, color],
    (value) => (mask & 512 ? ((value >>> 8) | (value << 24)) >>> 0 : value),
  );
  if (c.patch && c.patch.length !== 32) throw new Error('E-mote patch requires 16 control points');
  return c;
}

export function copyContent(out, source) {
  for (const name of [
    'ox',
    'oy',
    'x',
    'y',
    'z',
    'flipX',
    'flipY',
    'angle',
    'scaleX',
    'scaleY',
    'slantX',
    'slantY',
    'opacity',
    'blend',
    'src',
    'icon',
    'timeOffset',
    'motionFlags',
    'motion',
  ])
    out[name] = source[name];
  out.colors.set(source.colors);
  out.hasPatch = Boolean(source.patch);
  if (source.patch) out.patch.set(source.patch);
}

export function interpolateContent(out, a, b, ratio) {
  copyContent(out, a);
  if (ratio === 0) return;
  const lerp = (name, curve) => {
    const t = f(curveValue(curve, ratio));
    out[name] = f(f(b[name] * t) + f(a[name] * f(1 - t)));
  };
  for (const name of ['x', 'y', 'z']) lerp(name, a.curves.ccc);
  for (const name of ['scaleX', 'scaleY']) lerp(name, a.curves.zcc);
  for (const name of ['slantX', 'slantY']) lerp(name, a.curves.scc);
  out.opacity = Math.trunc(b.opacity * ratio + a.opacity * (1 - ratio));
  let angle = b.angle;
  if (a.angle - angle > 180) angle += 360;
  else if (angle - a.angle > 180) angle -= 360;
  out.angle =
    angle * curveValue(a.curves.acc, ratio) + a.angle * (1 - curveValue(a.curves.acc, ratio));
  if (out.angle < 0) out.angle += 360;
  else if (out.angle >= 360) out.angle -= 360;
  if (a.patch || b.patch) {
    out.hasPatch = true;
    const t = f(curveValue(a.curves.mesh?.cc, ratio)),
      inverse = f(1 - t),
      left = a.patch ?? identityPatch,
      right = b.patch ?? identityPatch;
    for (let i = 0; i < 32; i++) out.patch[i] = f(f(inverse * left[i]) + f(t * right[i]));
  }
}

export function localMatrix(out, state, order) {
  let a = 1,
    b = 0,
    c = 0,
    d = 1;
  for (const operation of order ?? [0, 3, 2, 1]) {
    if (operation === 0) {
      if (state.flipX) {
        a = -a;
        c = -c;
      }
      if (state.flipY) {
        b = -b;
        d = -d;
      }
    } else if (operation === 1 && state.angle !== 0) {
      const radians = f(f(state.angle * f(2 * Math.PI)) / 360),
        cos = f(Math.cos(radians)),
        sin = f(Math.sin(radians)),
        na = cos * a - sin * b,
        nc = cos * c - sin * d;
      b = sin * a + cos * b;
      d = sin * c + cos * d;
      a = na;
      c = nc;
    } else if (operation === 2) {
      a *= state.scaleX;
      c *= state.scaleX;
      b *= state.scaleY;
      d *= state.scaleY;
    } else if (operation === 3) {
      const na = a + state.slantX * b,
        nb = a * state.slantY + b,
        nc = d * state.slantX + c,
        nd = d + c * state.slantY;
      a = na;
      b = nb;
      c = nc;
      d = nd;
    }
  }
  out[0] = f(a);
  out[1] = f(b);
  out[2] = f(c);
  out[3] = f(d);
}

export function parameterTime(motion, selection, values, fallback) {
  const p = typeof selection === 'object' ? selection : motion.parameter?.[selection];
  if (!p || !p.enabled) return fallback;
  if (p.rangeBegin === p.rangeEnd || p.division <= 0) return 0;
  let value = values.get(p.id) ?? 0;
  if (p.discretization) value = Math.trunc(value);
  value = Math.max(
    Math.min(p.rangeBegin, p.rangeEnd),
    Math.min(Math.max(p.rangeBegin, p.rangeEnd), value),
  );
  return f(f(p.division * f(value - p.rangeBegin)) / f(p.rangeEnd - p.rangeBegin));
}
