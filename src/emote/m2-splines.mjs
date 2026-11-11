// SPDX-License-Identifier: MPL-2.0
import { prepareMotionSpline } from '../motion/spline.mjs';
const f = Math.fround;

export function readM2Splines(text) {
  const programs = {};
  let program;
  for (const line of text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')
    .split(/\r?\n/)) {
    const [name, ...rest] = line.trim().split(/\s+/);
    if (!name) continue;
    if (name.startsWith('#')) {
      program = programs[name.slice(1)] ??= { loop: rest.includes('loop'), variables: {} };
      continue;
    }
    if (!program || Object.hasOwn(program.variables, name)) continue;
    let time = 0;
    const points = rest.map((token) => {
      const [value, duration = 0] = token.split(',').map(Number);
      time = f(time + duration);
      return [time, f(value), 0, 0, 0];
    });
    if (!points.length) continue;
    if (program.loop) {
      const period = points.at(-1)[0];
      points.push(...points.map((point) => [f(point[0] + period), point[1], 0, 0, 0]));
    }
    const values = new Float32Array(points.flat());
    prepareMotionSpline(new Uint8Array(values.buffer), points.length);
    program.variables[name] = values;
  }
  return programs;
}

function valueAt(points, frame, loop) {
  const count = points.length / 5;
  let time = f(frame);
  if (loop) {
    time = Math.trunc(time) >>> 0;
    if (time >= Math.trunc(points[(count - 2) * 5]) >>> 0) {
      const period = Math.trunc(points[((count - 1) >>> 1) * 5]) >>> 0;
      if (!period) throw new Error('M2 spline has a zero loop period');
      time = f(period + (time % period));
    }
  }
  let index = 0;
  while (index < count && points[index * 5] <= time) index++;
  if (index === count) time = points[(count - 1) * 5];
  const at = Math.max(0, index - 1) * 5,
    delta = f(time - points[at]),
    square = f(delta * delta);
  return f(
    f(f(f(points[at + 2] * delta) + points[at + 1]) + f(points[at + 3] * square)) +
      f(f(square * delta) * points[at + 4]),
  );
}

export class M2Splines {
  constructor(programs) {
    this.programs = programs;
    this.name = '';
    this.startFrame = null;
  }
  start(name) {
    this.name = name;
    this.startFrame = null;
  }
  stop() {
    this.name = '';
    this.startFrame = null;
  }
  update(frame, material, write) {
    if (!this.name) return;
    this.startFrame ??= frame;
    const program = this.programs[this.name];
    let applied = false;
    for (const [name, points] of Object.entries(program?.variables ?? {})) {
      const entry = material(name);
      if (!entry) continue;
      write(
        name,
        f(valueAt(points, (frame - this.startFrame) >>> 0, program.loop) * f(entry.scale)),
      );
      applied = true;
    }
    if (!applied) this.stop();
  }
  snapshot() {
    return { name: this.name, startFrame: this.startFrame };
  }
  restore(state) {
    this.name = state.name;
    this.startFrame = state.startFrame;
  }
}
