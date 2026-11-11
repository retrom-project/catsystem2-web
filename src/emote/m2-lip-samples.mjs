// SPDX-License-Identifier: MPL-2.0
// LPB/float-LV audio sidecars. Values are normalized once, at installation.
const f = Math.fround;
const weights = Float32Array.of(0, 1, 0.4, 0.2, 0.8, 0.6);

function smooth(backup, radius) {
  const values = backup.slice(),
    width = radius * 2 + 1;
  for (let i = radius; i < values.length - radius; i++) {
    let sum = 0;
    for (let j = i - radius; j <= i + radius; j++) sum = f(sum + backup[j]);
    values[i] = f(sum / f(width));
  }
  return values;
}

export class M2LipSamples {
  static open(bytes, kind, { radius = 1, classes = weights } = {}) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let backup;
    if (kind === 'lpb') {
      if (
        bytes.length < 20 ||
        view.getUint32(0, true) !==
          0x0044504c /* exe-address-check: non-address - little-endian LPD file magic */ ||
        view.getUint32(8, true) !== 32 ||
        !view.getUint32(12, true)
      )
        return null;
      const count = view.getUint32(12, true),
        floor = -view.getFloat32(16, true);
      // The C parser's size comparison omits its header. An actual short
      // byte array has no readable tail in JS; reject it before any access.
      if (count > Math.floor((bytes.length - 20) / 32)) return null;
      const length = view.getUint32(20 + (count - 1) * 32, true) + 1;
      if (length > 10000000 /* exe-address-check: non-address - bounded decoded lip sample count */)
        throw new RangeError('M2 LPB sample count exceeds its bound');
      backup = new Float32Array(length);
      let index = 0;
      for (let i = 0; i < length; i++) {
        while (index + 1 < count && view.getUint32(20 + (index + 1) * 32, true) <= i) index++;
        const at = 20 + index * 32,
          type = view.getUint32(at + 4, true),
          db = Math.min(floor, Math.max(20, -view.getFloat32(at + 28, true))),
          range = f(floor - 20),
          normalized = f(f(f(f(range - f(db - 20)) / range) * f(0.4)) + f(0.6));
        if (type >= classes.length) throw new Error(`Unsupported M2 LPB class ${type}`);
        backup[i] = f(normalized * f(classes[type]));
      }
    } else if (kind === 'lv') {
      backup = new Float32Array(Math.floor(bytes.length / 4));
      for (let i = 0; i < backup.length; i++) backup[i] = view.getFloat32(i * 4, true);
    } else throw new Error(`Unknown M2 lip sidecar ${kind}`);
    return new M2LipSamples(smooth(backup, radius), backup);
  }
  constructor(values, backup) {
    this.values = values;
    this.backup = backup;
    this.start = 0;
  }
  value(frame, low = 0, high = 5) {
    const index = ((frame >>> 0) - this.start) >>> 0;
    return index < this.values.length ? f(f(f(high - low) * this.values[index]) + f(low)) : f(low);
  }
  snapshot() {
    return { values: this.values.slice(), backup: this.backup.slice(), start: this.start };
  }
  static restore(state) {
    const samples = new M2LipSamples(state.values.slice(), state.backup.slice());
    samples.start = state.start;
    return samples;
  }
}
