// SPDX-License-Identifier: BSD-3-Clause
// Translated from motionplayer EmoteMeshResolver/Blink/EyebrowController.
// Source commit 3840e3d86cab38217a193abaaea2c404e1bc71dc; licenses/motionplayer.txt.
const f = Math.fround;

export function resolveControllerPath(edges, nodes, start, end) {
  const rows = [],
    visited = [],
    stack = [],
    path = [];
  const edge = (value) => edges.findIndex(([a, b]) => a <= value && b >= value),
    node = (value) => nodes.find((row) => row.includes(value)),
    unvisited = (row) => row?.find((value) => !visited.includes(value)) ?? -1;
  let current = start,
    previousMode = 0,
    distance = 0,
    continuePasses = true,
    passes = 0;
  const append = (a, b) => {
      distance = f(distance + Math.abs(f(b - a)));
      path.push([a, b]);
    },
    pop = () => {
      const row = path.pop();
      if (row) distance = f(distance - Math.abs(f(row[1] - row[0])));
    },
    emit = () => rows.push({ distance, path: path.map((row) => [...row]) });
  let budget = 100000;
  search: while (continuePasses) {
    let state = 0,
      complete = false;
    while (!complete) {
      if (!--budget) throw new Error('E-mote controller graph traversal did not terminate');
      switch (state & 3) {
        case 0:
          path.length = 0;
          distance = 0;
          stack.length = 0;
          if (edge(current) >= 0) {
            previousMode = 1;
            state = 1;
            if (edge(end) >= 0) break;
          }
          distance = -1;
          emit();
          continuePasses = false;
          previousMode = 1;
          complete = true;
          break;
        case 1: {
          const at = edge(current);
          state = previousMode === 1 ? 2 : 3;
          if (at !== edge(end)) break;
          for (let i = visited.length - 1; i >= 0; i--)
            if (visited[i] === edges[at][0] || visited[i] === edges[at][1]) visited.splice(i, 1);
          append(current, end);
          if (!rows.some((row) => row.distance === distance)) emit();
          continuePasses = stack.length > 0;
          complete = true;
          break;
        }
        case 2: {
          const boundary = edges[edge(current)][1],
            row = node(boundary);
          if (row) {
            visited.push(boundary);
            const next = unvisited(row);
            if (next !== -1) {
              append(current, boundary);
              visited.push(next);
              stack.push(current);
              current = next;
              state = 1;
              break;
            }
          }
          if (!stack.length) {
            previousMode = -1;
            state = 3;
          } else {
            current = stack.pop();
            pop();
            state = 2;
          }
          break;
        }
        case 3: {
          const boundary = edges[edge(current)][0],
            row = node(boundary);
          if (row) {
            visited.push(boundary);
            const next = unvisited(row);
            if (next !== -1) {
              append(current, boundary);
              visited.push(next);
              stack.push(current);
              current = next;
              state = 1;
              break;
            }
          }
          if (stack.length) {
            current = stack.pop();
            pop();
            state = 3;
            break;
          }
          const endBoundary = edges[edge(end)][1],
            endRow = node(endBoundary);
          if (endRow) {
            const close = unvisited(endRow);
            visited.push(endBoundary);
            const next = unvisited(endRow);
            if (next === -1) {
              distance = -1;
              emit();
            } else {
              append(current, close);
              visited.push(next);
              stack.push(current);
              current = next;
            }
          }
          distance = -1;
          emit();
          break search;
        }
      }
    }
    if (passes++ > 8) break;
  }
  let best = null,
    span = 99999;
  for (const row of rows)
    if (row.distance !== -1 && row.distance < span) {
      best = row;
      span = row.distance;
    }
  return best ? { path: best.path, span } : { path: [[end, end]], span: 0 };
}

export class GraphController {
  constructor(data, { blink = false, random = () => 0 } = {}) {
    this.edges = (data.edge ?? []).map((row) => row.map((value) => f(value | 0)));
    this.nodes = (data.node ?? []).map((row) => row.map((value) => f(value | 0)));
    this.begin = data.beginFrame | 0;
    this.end = data.endFrame | 0;
    this.value = f(this.begin);
    this.target = 0;
    this.direction = 0;
    this.state = 0;
    this.accum = 0;
    this.span = 0;
    this.inverse = 0;
    this.power = 1;
    this.queue = [];
    this.path = [];
    this.blink = blink;
    this.random = random;
    this.blinkEnabled = Boolean(data.blinkEnabled);
    this.blinkPhase = 0;
    this.blinkValue = f(this.begin);
    this.minimum = f(data.blinkIntervalMin ?? 0);
    this.maximum = f(data.blinkIntervalMax ?? 0);
    this.blinkFrames = f(data.blinkFrameCount ?? 0);
    this.timer = blink ? this.interval() : 0;
  }
  interval() {
    return f(this.minimum + f(f(this.maximum - this.minimum) * f(this.random())));
  }
  set(value, duration = 0, exponent = 1, append = false) {
    if (!append || !(duration > 0)) {
      this.queue.length = 0;
      this.path.length = 0;
      this.state = 0;
    }
    if (!(duration > 0)) {
      this.value = f(value);
      return;
    }
    this.queue.push({ value: f(value), duration: f(duration), power: f(exponent) });
  }
  setup() {
    const key = this.queue.shift(),
      result = resolveControllerPath(this.edges, this.nodes, this.value, key.value);
    this.path = result.path;
    this.span = result.span;
    this.accum = 0;
    this.inverse = f(1 / key.duration);
    this.power = key.power;
    this.state++;
  }
  segment() {
    if (!this.path.length) {
      this.state = 0;
      return;
    }
    const [start, end] = this.path.shift();
    this.value = start;
    if (start !== end) {
      this.target = end;
      this.direction = f(end - start) < 0 ? -1 : 1;
      this.state = 2;
    }
  }
  advance(dt) {
    const phase = f(
        f(Math.pow(f(this.accum / this.span), f(1 / this.power))) + f(this.inverse * dt),
      ),
      powered = Math.pow(phase, this.power),
      delta = f(f(f(powered) * this.span) - this.accum),
      next = f(this.value + f(this.direction * delta));
    this.value = next;
    const overshoot =
      this.direction > 0 ? f(next - this.target) >= f(-0.0001) : f(next - this.target) <= f(0.0001);
    if (overshoot) {
      this.value = this.target;
      this.state = 1;
    }
    this.accum = f(this.accum + (overshoot ? f(f(this.target - next) * this.direction) : delta));
    return overshoot;
  }
  step(dt) {
    {
      let budget = 10000;
      while (--budget) {
        if (this.state === 0) {
          if (!this.queue.length) break;
          this.setup();
        } else if (this.state === 1) {
          if (!this.path.length) {
            this.state = 0;
            continue;
          }
          this.segment();
          if (this.state === 1) continue;
        } else if (this.state === 2) {
          if (!this.advance(dt)) break;
        } else break;
      }
      if (!budget) throw new Error('E-mote blink track did not terminate');
    }
    if (!this.blink) return this.value;
    let previous,
      blinkBudget = 64;
    do {
      if (!--blinkBudget) throw new Error('E-mote blink phases did not terminate');
      previous = this.blinkPhase;
      switch (this.blinkPhase) {
        case 0:
          if (this.blinkEnabled && this.begin === Math.trunc(this.blinkValue)) {
            this.timer = f(this.timer - dt);
            if (this.timer <= 0) this.blinkPhase = 10;
          }
          break;
        case 10:
          this.blinkValue = f(
            this.blinkValue + f(f(f(dt * 2.5) / this.blinkFrames) * f(this.end - this.begin)),
          );
          if (this.blinkValue >= f(this.end)) {
            this.blinkValue = f(this.end);
            this.blinkPhase = 11;
            this.timer = f(this.blinkFrames / 5);
          }
          break;
        case 11:
          this.timer = f(this.timer - dt);
          if (this.timer <= 0) {
            this.blinkPhase = 12;
            this.timer = this.interval();
          }
          break;
        case 12:
          this.blinkValue = f(
            this.blinkValue + f(f(f(dt * -2.5) / this.blinkFrames) * f(this.end - this.begin)),
          );
          if (this.blinkValue <= f(this.begin)) {
            this.blinkValue = f(this.begin);
            this.blinkPhase = 0;
          }
          break;
      }
    } while (previous !== this.blinkPhase);
    return this.value >= this.begin && this.value <= this.end
      ? f(
          f(f(this.end - this.value) * f(this.blinkValue - this.begin)) / (this.end - this.begin) +
            this.value,
        )
      : this.value;
  }
  reset() {
    if (this.queue.length) this.value = this.queue.at(-1).value;
    else if (this.state) this.value = this.path.length ? this.path.at(-1)[0] : this.target;
    this.queue.length = 0;
    this.path.length = 0;
    this.state = 0;
  }
}
