// SPDX-License-Identifier: BSD-3-Clause
// Algorithms translated from kirikiroid2-web motionplayer, commit
// 3840e3d86cab38217a193abaaea2c404e1bc71dc. See licenses/motionplayer.txt.
const f = Math.fround;
const int = (value) =>
  Number.isNaN(value) ? 0 : Math.min(2147483647, Math.max(-2147483648, Math.trunc(value)));
const power = (easing) => f(easing > 0 ? easing + 1 : easing < 0 ? 1 / (1 - easing) : 1);
export { power as emoteTransitionPower };

export class ValueController {
  constructor(count = 1) {
    this.value = new Float32Array(count);
    this.start = new Float32Array(count);
    this.target = new Float32Array(count);
    this.queue = [];
    this.state = 0;
    this.phase = 0;
    this.inverse = 0;
    this.power = 1;
  }
  set(values, duration = 0, exponent = 1, append = false) {
    if (!append || duration <= 0) {
      this.queue.length = 0;
      this.state = 0;
    }
    if (duration <= 0) {
      this.value.set(values);
      return;
    }
    this.queue.push({ values: Array.from(values, f), duration: f(duration), power: f(exponent) });
  }
  step(dt) {
    if (!this.state && this.queue.length) {
      const key = this.queue.shift();
      this.start.set(this.value);
      this.target.set(key.values);
      this.inverse = f(1 / key.duration);
      this.power = key.power;
      this.phase = 0;
      this.state = 1;
    }
    if (this.state === 1) {
      this.phase = f(this.phase + f(this.inverse * dt));
      if (this.phase >= 1) {
        this.phase = 1;
        this.value.set(this.target);
        this.state = 0;
      } else {
        const weight = f(Math.pow(this.phase, this.power));
        for (let i = 0; i < this.value.length; i++)
          this.value[i] = f(this.start[i] + f(weight * f(this.target[i] - this.start[i])));
      }
    }
    return this.value;
  }
  reset() {
    if (this.queue.length) this.value.set(this.queue.at(-1).values);
    else if (this.state) this.value.set(this.target);
    this.queue.length = 0;
    this.state = 0;
  }
  snapshot() {
    return {
      value: [...this.value],
      start: [...this.start],
      target: [...this.target],
      queue: structuredClone(this.queue),
      state: this.state,
      phase: this.phase,
      inverse: this.inverse,
      power: this.power,
    };
  }
  restore(state) {
    this.value.set(state.value);
    this.start.set(state.start);
    this.target.set(state.target);
    for (const key of ['queue', 'state', 'phase', 'inverse', 'power'])
      this[key] = structuredClone(state[key]);
  }
}

export class AngleController {
  constructor() {
    this.value = 0;
    this.start = 0;
    this.target = 0;
    this.state = 0;
    this.phase = 0;
    this.queue = [];
  }
  wrap(value) {
    const period = f(2 * Math.PI);
    if (!Number.isFinite(value)) throw new Error('Non-finite E-mote angle');
    while (value < 0) value = f(value + period);
    while (value >= period) value = f(value - period);
    return value;
  }
  set(value, duration = 0, exponent = 1, append = false) {
    value = this.wrap(f(value));
    if (!append || !(duration > 0)) {
      this.queue.length = 0;
      this.state = 0;
    }
    if (!(duration > 0)) {
      this.value = value;
      return;
    }
    this.queue.push({ value, duration: f(duration), power: f(exponent) });
  }
  step(dt) {
    if (this.state === 1) {
      this.phase = f(this.phase + f(this.inverse * dt));
      if (this.phase >= 1) {
        this.phase = 1;
        this.value = this.wrap(this.target);
        this.state = 0;
      } else
        this.value = this.wrap(
          f(f(f(Math.pow(this.phase, this.power)) * f(this.target - this.start)) + this.start),
        );
    } else if (!this.state && this.queue.length) {
      const key = this.queue.shift();
      this.start = this.value;
      this.target = key.value;
      if (this.target > this.value) {
        if (f(this.target - this.value) > f(Math.PI)) this.target = f(this.target - f(2 * Math.PI));
      } else if (f(this.value - this.target) > f(Math.PI))
        this.target = f(this.target + f(2 * Math.PI));
      this.inverse = f(1 / key.duration);
      this.power = key.power;
      this.phase = 0;
      this.state = 1;
    }
    return this.value;
  }
}

export class MouthController extends AngleController {
  constructor(data) {
    super();
    this.beginFrame = data.beginFrame | 0;
  }
  wrap(value) {
    return value;
  }
  step(dt) {
    if (this.state === 1) {
      this.phase = f(this.phase + f(this.inverse * dt));
      if (this.phase >= 1) {
        this.phase = 1;
        this.value = this.target;
        this.state = 0;
      } else
        this.value = f(
          f(f(Math.pow(this.phase, this.power)) * f(this.target - this.start)) + this.start,
        );
    } else if (!this.state && this.queue.length) {
      const key = this.queue.shift();
      this.start = this.value;
      this.target = key.value;
      this.inverse = f(1 / key.duration);
      this.power = key.power;
      this.phase = 0;
      this.state = 1;
    }
    return this.value;
  }
}

export class LoopController {
  constructor(data) {
    this.keys = data.transitionList.map((row) => row.map(f));
    this.index = 0;
    this.time = 0;
  }
  step(dt) {
    this.time = f(this.time + dt);
    let remaining = this.keys.length;
    while (this.keys[this.index][2] <= this.time) {
      const span = this.keys[this.index][2];
      if (!(span > 0) && !--remaining) throw new Error('E-mote loop has no positive span');
      this.time = f(this.time - span);
      this.index = (this.index + 1) % this.keys.length;
    }
    const [start, end, span] = this.keys[this.index],
      t = f(this.time / span);
    return f(f(t * end) + f(f(1 - t) * start));
  }
}

export class SelectorController {
  constructor(options) {
    this.options = options;
    this.queue = [];
    this.state = 0;
    this.index = 0;
    this.phase = 0;
    this.apply(0, 0, 0);
  }
  apply(index, duration, exponent) {
    this.index = index;
    for (let i = 0; i < this.options.length; i++) {
      const { controller, onValue, offValue } = this.options[i];
      if (!controller) continue;
      const target = f(index === i ? onValue : offValue),
        delta = f(controller.step(0)[0] - target);
      if (controller.state || controller.queue.length || Math.abs(delta) >= f(1e-7))
        controller.set(
          [target],
          f(Math.abs(f(delta / f(onValue - offValue))) * duration),
          exponent,
        );
    }
  }
  set(value, duration, exponent, append = false) {
    if (!append || !(duration > 0)) {
      this.queue.length = 0;
      this.state = 0;
    }
    if (!(duration > 0)) {
      this.apply(int(value), 0, 0);
      return;
    }
    this.queue.push({ value: f(value), duration: f(duration), power: f(exponent) });
  }
  step(dt) {
    if (this.state === 1) {
      this.phase = f(this.phase + f(this.inverse * dt));
      if (this.phase >= 1) {
        this.phase = 1;
        this.state = 0;
      }
    } else if (!this.state && this.queue.length) {
      const key = this.queue.shift();
      this.apply(int(key.value), key.duration, key.power);
      this.inverse = f(1 / key.duration);
      this.phase = 0;
      this.state = 1;
    }
    return f(this.index);
  }
}
