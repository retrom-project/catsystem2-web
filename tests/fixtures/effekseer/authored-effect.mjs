// SPDX-License-Identifier: MPL-2.0
// Authored fixtures; layout follows Effekseer 1.23's Binary/Exporter.cs.
export class EffectWriter {
  constructor() {
    this.values = [];
  }
  int(...values) {
    for (const n of values) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setInt32(0, n, true);
      this.values.push(b);
    }
    return this;
  }
  float(...values) {
    for (const n of values.flat()) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, n, true);
      this.values.push(b);
    }
    return this;
  }
  raw(...values) {
    this.values.push(Uint8Array.from(values.flat()));
    return this;
  }
  append(bytes) {
    this.values.push(bytes);
    return this;
  }
  sized(bytes) {
    return this.int(bytes.byteLength).append(bytes);
  }
  paths(values) {
    this.int(values.length);
    for (const path of values) {
      this.int(path.length + 1);
      for (let i = 0; i < path.length; i++)
        this.raw(path.charCodeAt(i) & 255, path.charCodeAt(i) >>> 8);
      this.raw(0, 0);
    }
    return this;
  }
  bytes() {
    const b = new Uint8Array(this.values.reduce((n, v) => n + v.length, 0));
    let at = 0;
    for (const value of this.values) {
      b.set(value, at);
      at += value.length;
    }
    return b;
  }
}
function curve(
  w,
  {
    keys = [1, 3, 5],
    edgeStart = 0,
    edgeEnd = 0,
    offsetMax = 0.5,
    offsetMin = 0.25,
    offset = 2,
    frequency = 2,
    length = 4,
  } = {},
) {
  w.int(edgeStart, edgeEnd)
    .float(offsetMax, offsetMin)
    .int(offset, length, frequency, keys.length)
    .float(keys);
  return w;
}
function curves(w, count) {
  for (let i = 0; i < count; i++) curve(w, { keys: [i, i + 1, i + 2] });
  return w;
}
export function motionBytes(domain, type) {
  const w = new EffectWriter().int(type),
    b = new EffectWriter();
  if (type === 0) b.float(domain === 'scaling' ? [2, 3, 4] : [1, 2, 3]);
  else if (type === 1)
    b.float(
      [3, 4, 5],
      [1, 2, 3],
      [0.3, 0.4, 0.5],
      [0.1, 0.2, 0.3],
      [0.03, 0.04, 0.05],
      [0.01, 0.02, 0.03],
    );
  else if (type === 2) b.float([1, 2, 3], [0, 1, 2], [4, 5, 6], [3, 4, 5], [0, 0, 1]);
  else if ((domain === 'translation' && type === 3) || type === 5) curves(b, 3);
  else if (domain === 'rotation' && type === 3)
    b.float([1, 0, 0], [1, 0, 0], [0.5, 0.25], [0.1, 0.05], [0.01, 0.005]);
  else if (domain === 'rotation' && type === 4)
    b.float([0, 1, 0], [0, 1, 0], [0.5, 0.25], [1, 0.75], [0, 0, 1]);
  else if (domain === 'scaling' && type === 3) b.float([2, 1], [0.1, 0.05], [0.01, 0.005]);
  else if (domain === 'scaling' && type === 4) b.float([2, 1], [4, 3], [0, 0, 1]);
  else if (type !== 0x7ffffffe) throw new Error(`Unknown authored motion ${domain}/${type}`);
  if (type !== 0x7ffffffe) w.sized(b.bytes());
  return w.bytes();
}
export function generationBytes(type = 0) {
  const w = new EffectWriter().int(0, type);
  if (type === 0) w.float([0, 0, 0], [0, 0, 0]);
  else if (type === 1) w.float([2, 1], [0.5, 0.25], [1, 0.75]);
  else if (type === 2) w.int(0, 4);
  else if (type === 3) w.int(8).float([2, 1], [0, 0], [6.28, 6.28]).int(1);
  return w.bytes();
}
function randomColor(w, version, max = [255, 128, 64, 255], min = [128, 64, 32, 128]) {
  if (version >= 4) w.raw(1, 0);
  w.raw(max).raw(min);
}
export function colorBytes(type = 0, version = 9) {
  const w = new EffectWriter().int(type);
  if (type === 0) w.raw(255, 64, 0, 255);
  else if (type === 1) randomColor(w, version);
  else if (type === 2) {
    randomColor(w, version);
    randomColor(w, version, [128, 64, 32, 0], [0, 0, 0, 0]);
    w.float(0, 0, 1);
  } else if (type === 3) curves(w, 4);
  return w.bytes();
}
export function authoredEffect({
  version = 9,
  encodedVersion = version,
  colorPaths = [],
  soundPaths = [],
  modelPaths = [],
  magnification = 1,
  translation = 1,
  rotation = 0x7ffffffe,
  scaling = 0x7ffffffe,
  generation = 0,
  uv = 0,
  color = 0,
  kind = 2,
  commonSize = null,
  children = [],
  life = [8, 8],
  maxGeneration = 3,
  interval = 2,
  generationOffset = 0,
  withSound = false,
} = {}) {
  const w = new EffectWriter().raw(83, 75, 70, 69).int(encodedVersion).paths(colorPaths);
  if (version >= 9) w.paths([]).paths([]);
  if (version >= 1) w.paths(soundPaths);
  if (version >= 6) w.paths(modelPaths);
  if (version >= 2) w.float(magnification);
  if (version >= 9) w.int(0);
  w.int(-1, 1, kind);
  const common = new EffectWriter().int(maxGeneration, 2, 2, 2, 1, 0, 0, ...life).float(interval);
  if (version >= 9) common.float(interval, generationOffset, generationOffset);
  else common.float(generationOffset);
  const c = common.bytes();
  w.int(commonSize ?? c.byteLength).append(c);
  w.append(motionBytes('translation', translation));
  w.int(0, 0); // absolute None with zero-byte parameter block
  w.append(motionBytes('rotation', rotation))
    .append(motionBytes('scaling', scaling))
    .append(generationBytes(generation));
  if (version >= 3) {
    w.int(colorPaths.length ? 0 : -1, 1, 0, 1);
    if (version >= 5) w.int(1, 0);
    w.int(1).float(2, 0, 0, 1).int(1).float(3, 0, 0, 1).int(uv);
    if (uv) w.float(0.25, 0.5, 0.125, 0.25);
    if (uv === 2) w.int(3, 2, 4, 1);
    if (uv === 3) w.float(0.01, -0.02);
    if (version >= 9) w.int(0).float(1);
  }
  w.int(kind);
  if (kind === 2) {
    w.int(0);
    if (version < 3) w.int(1);
    w.int(2).append(colorBytes(color, version)).int(0, 1).float(-1, -1, 1, -1, -1, 1, 1, 1);
    if (version < 3) w.int(-1);
  } else if (kind !== 0) throw new Error('Authored node generator supports sprite or none');
  if (version >= 1) {
    w.int(Number(withSound));
    if (withSound) w.int(0).float(1, 1, 0, 0).int(0).float(0, 0, 10).int(3, 1);
  }
  w.int(children.length);
  for (const bytes of children) w.append(bytes);
  return w.bytes();
}
