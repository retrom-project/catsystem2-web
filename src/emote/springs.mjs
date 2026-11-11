// SPDX-License-Identifier: BSD-3-Clause
// Translated from motionplayer EmoteSpring, pinned source in NOTICE.md.
// Original notices: licenses/motionplayer.txt.
const f = Math.fround;
const vector = (value = {}) => Float32Array.of(value.x ?? 0, value.y ?? 0, value.z ?? 0);
const radians = f(0.0392699082),
  response = f(1.15);
const output = (value) => f(f(Math.atan(f(value * radians))) / radians);

export class EmoteSpring {
  constructor(data) {
    this.gravity = f(data.gravity ?? 0);
    this.spring = f(data.spring ?? 0);
    this.friction = f(data.friction ?? 0);
    this.scaleX = f(data.scale_x ?? 0);
    this.scaleY = f(data.scale_y ?? 0);
    const param = data.param ?? {};
    this.stored = vector(param.op);
    this.position = vector(param.p);
    this.velocity = vector(param.pv);
    this.offset = f(param.ofs ?? 0);
    this.first = true;
    this.delta = new Float32Array(2);
    this.output = new Float32Array(2);
  }
  step(x, y, forceX, forceY, dt, scale, angle) {
    if (this.first) {
      this.first = false;
      this.delta[0] = f(this.stored[0] - x);
      this.delta[1] = f(this.stored[1] - y);
    } else {
      this.stored[0] = f(this.delta[0] + x);
      this.stored[1] = f(this.delta[1] + y);
    }
    const sn = f(Math.sin(-angle)),
      cs = f(Math.cos(angle)),
      spring = f(this.spring * dt),
      gravity = f(this.gravity * dt),
      damping = f(this.friction * dt),
      vx = f(
        f(-sn * gravity) +
          f(
            this.velocity[0] +
              f(f(f(cs * forceX) - f(sn * forceY)) * dt) +
              f(spring * f(this.stored[0] - this.position[0])),
          ),
      ),
      vy = f(
        f(cs * gravity) +
          f(
            this.velocity[1] +
              f(f(f(sn * forceX) + f(cs * forceY)) * dt) +
              f(spring * f(this.stored[1] - this.position[1])),
          ),
      ),
      vz = f(this.velocity[2] + f(spring * f(this.stored[2] - this.position[2])));
    this.velocity[0] = f(vx - f(damping * vx));
    this.velocity[1] = f(vy - f(damping * vy));
    this.velocity[2] = f(vz - f(damping * vz));
    for (let i = 0; i < 3; i++) this.position[i] = f(this.position[i] + f(this.velocity[i] * dt));
    this.output[0] = output(
      f(-f(f(f(this.stored[0] - this.position[0]) * scale) * this.scaleX) * response),
    );
    this.output[1] = output(
      f(
        f(f(-f(f(this.stored[1] - this.position[1]) * scale) - this.offset) * this.scaleY) *
          response,
      ),
    );
    return this.output;
  }
}

export class EmoteChainSpring {
  constructor(data) {
    for (const [field, key] of Object.entries({
      gravity: 'gravity',
      frictionX: 'friction_x',
      frictionY: 'friction_y',
      rate: 'b_rate',
      bound: 'v_bound',
      bendSpeed: 'bend_spd',
      bendVolume: 'bend_vol',
    }))
      this[field] = f(data[key] ?? 0);
    this.selectedY = data.ud_eft | 0;
    this.length = Float32Array.from(data.length);
    this.scaleX = Float32Array.from(data.scale_x);
    this.scaleY = Float32Array.from(data.scale_y);
    const param = data.param ?? {};
    this.origin = vector(param.op);
    this.offset = f(param.ofs ?? 0);
    this.bend = f(param.bendR ?? 0);
    this.bendScale = f(param.bendS ?? 0);
    this.target = [vector(param.bp?.[0]), vector(param.bp?.[1])];
    this.position = [vector(param.p?.[0]), vector(param.p?.[1])];
    this.velocity = [vector(param.pv?.[0]), vector(param.pv?.[1])];
    this.first = true;
    this.delta = new Float32Array(2);
    this.output = new Float32Array(3);
  }
  step(x, y, forceX, forceY, dt, scale, angle, wind) {
    if (this.first) {
      this.first = false;
      this.delta[0] = f(this.origin[0] - x);
      this.delta[1] = f(this.origin[1] - y);
    } else {
      this.origin[0] = f(this.delta[0] + x);
      this.origin[1] = f(this.delta[1] + y);
    }
    for (let i = 0; i < 2; i++) {
      this.target[i].set(i ? this.target[0] : this.origin);
      this.target[i][1] = f(this.length[i] + this.target[i][1]);
    }
    const sn = f(Math.sin(-angle)),
      cs = f(Math.cos(angle)),
      fx = f(f(f(cs * forceX) - f(sn * forceY)) * dt),
      fy = f(f(f(sn * forceX) + f(cs * forceY)) * dt);
    for (let i = 0; i < 2; i++) {
      const pos = this.position[i],
        vel = this.velocity[i],
        parent = i ? this.position[0] : this.origin,
        dx = f(parent[0] - pos[0]),
        dy = f(parent[1] - pos[1]),
        dz = f(parent[2] - pos[2]),
        squared = f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
      if (squared > f(this.length[i] * this.length[i])) {
        const distance = f(Math.sqrt(squared));
        if (distance > 0.015625) {
          const inverse = f(1 / distance),
            a = f(dx * inverse),
            b = f(dy * inverse),
            c = f(dz * inverse),
            extension = f(distance - this.length[i]);
          if (i) {
            pos[0] = f(f(extension * a) + pos[0]);
            pos[1] = f(f(extension * b) + pos[1]);
            pos[2] = f(f(extension * c) + pos[2]);
            const projection = f(
              f(this.bound * f(f(f(a * vel[0]) + f(b * vel[1])) + f(c * vel[2]))) * dt,
            );
            vel[0] = f(vel[0] - f(a * projection));
            vel[1] = f(vel[1] - f(b * projection));
            vel[2] = f(vel[2] - f(c * projection));
          } else {
            const impulse = f(f(extension * this.rate) * dt);
            vel[0] = f(vel[0] + f(a * impulse));
            vel[1] = f(f(b * impulse) + vel[1]);
            vel[2] = f(f(c * impulse) + vel[2]);
          }
        }
      }
      const gravity = f(this.gravity * dt);
      vel[0] = f(f(fx + vel[0]) - f(sn * gravity));
      vel[1] = f(f(cs * gravity) + f(fy + vel[1]));
      vel[2] = f(f(gravity * 0) + f(f(dt * 0) + vel[2]));
      if (wind) vel[0] = f(wind.force(pos[0]) + vel[0]);
      const deltaZ = f(vel[2] * dt);
      vel[0] = f(vel[0] - f(f(vel[0] * this.frictionX) * dt));
      vel[1] = f(vel[1] - f(f(vel[1] * this.frictionY) * dt));
      pos[0] = f(f(vel[0] * dt) + pos[0]);
      pos[1] = f(f(vel[1] * dt) + pos[1]);
      pos[2] = f(deltaZ + pos[2]);
      this.output[i] = output(
        f(f(f(f(this.target[i][0] - pos[0]) * this.scaleX[i]) * scale) * -response),
      );
      if (i === this.selectedY)
        this.output[2] = output(
          f(
            f(f(f(this.offset - f(this.target[i][1] - pos[1])) * this.scaleY[i]) * scale) *
              response,
          ),
        );
    }
    const amount = f(dt * 0.03125);
    this.bendScale =
      Math.abs(this.output[2]) <= 28
        ? Math.max(0, f(this.bendScale - amount))
        : Math.min(1, f(amount + this.bendScale));
    this.bend = f(f(this.bend + f(f(this.bendScale * this.bendSpeed) * dt)) % f(2 * Math.PI));
    const bend = f(f(f(Math.sin(this.bend)) * this.bendScale) * this.bendVolume);
    this.output[1] = f(this.output[1] + bend);
    this.output[0] = f(this.output[0] - bend);
    return this.output;
  }
}
