// SPDX-License-Identifier: MPL-2.0
import { parseXML } from '../../xml.mjs';
import { f, integer, anchorOffset } from './common.mjs';
import { normalize } from './spline.mjs';
const rawKeys = [
  'angle',
  'angleVariance',
  'blendFuncDestination',
  'blendFuncSource',
  'duration',
  'emitterType',
  'finishColorAlpha',
  'finishColorBlue',
  'finishColorGreen',
  'finishColorRed',
  'finishColorVarianceAlpha',
  'finishColorVarianceBlue',
  'finishColorVarianceGreen',
  'finishColorVarianceRed',
  'finishParticleSize',
  'finishParticleSizeVariance',
  'gravityx',
  'gravityy',
  'maxParticles',
  'maxRadius',
  'maxRadiusVariance',
  'minRadius',
  'particleLifespan',
  'particleLifespanVariance',
  'radialAccelVariance',
  'radialAcceleration',
  'rotatePerSecond',
  'rotatePerSecondVariance',
  'rotationEnd',
  'rotationEndVariance',
  'rotationStart',
  'rotationStartVariance',
  'sourcePositionVariancex',
  'sourcePositionVariancey',
  'sourcePositionx',
  'sourcePositiony',
  'speed',
  'speedVariance',
  'startColorAlpha',
  'startColorBlue',
  'startColorGreen',
  'startColorRed',
  'startColorVarianceAlpha',
  'startColorVarianceBlue',
  'startColorVarianceGreen',
  'startColorVarianceRed',
  'startParticleSize',
  'startParticleSizeVariance',
  'tangentialAccelVariance',
  'tangentialAcceleration',
];
const colorKeys = rawKeys.filter((k) => k.includes('Color'));
function config(i, data) {
  const c = (i.state.config ??= {});
  for (const key of rawKeys) if (c[key] == null) c[key] = 0;
  const xml = parseXML(new TextDecoder().decode(data).replace(/<!DOCTYPE[^>]*>/g, '')),
    nodes = xml.node('dict')?.children;
  if (xml.name !== 'plist' || !nodes) throw new Error('PPI cmnptcl requires a plist dictionary');
  for (let n = 0; n + 1 < nodes.length; n += 2) {
    if (nodes[n].name !== 'key') throw new Error('PPI cmnptcl dictionary key is missing');
    const key = nodes[n].text;
    if (!rawKeys.includes(key)) continue;
    let value = f(Number(nodes[n + 1].text));
    if (!Number.isFinite(value)) throw new Error('PPI cmnptcl invalid numeric field ' + key);
    if (key === 'angle') value = -value;
    else if (key === 'blendFuncDestination' || key === 'blendFuncSource' || key === 'emitterType')
      value = integer(value);
    else if (key === 'duration') value = value > 0 ? f(value * 60) : value;
    else if (colorKeys.includes(key)) value = f(value * 255);
    else if (key.includes('ParticleSize')) value = f(value / 30);
    else if (key === 'gravityx') value = f(value / 3600);
    else if (key === 'gravityy') value = f(f(value * -1) / 3600);
    else if (key === 'particleLifespan' || key === 'particleLifespanVariance')
      value = f(value * 60);
    else if (key === 'radialAccelVariance' || key === 'radialAcceleration')
      value = f(value / 360000);
    else if (key === 'rotatePerSecond') value = f(f(value * -1) / 60);
    else if (key === 'rotatePerSecondVariance' || key === 'speed' || key === 'speedVariance')
      value = f(value / 60);
    else if (key === 'sourcePositiony') value = f(i.parameters.screenHeight - value);
    else if (key === 'tangentialAccelVariance' || key === 'tangentialAcceleration')
      value = f(value / 3600);
    c[key] = value;
  }
}
const sym = (i, base, variance) => f(f(f(f(i.host.frand() * 2) - 1) * variance) + base);
const clamp = (v) => Math.max(0, Math.min(255, v));
function reset(i, n) {
  const s = i.state,
    c = s.config,
    v = s.particles[n],
    p = i.particle(n),
    h = i.host;
  p.disp = 0;
  p.base.x = f(i.parameters.width * 0.5);
  p.base.y = f(i.parameters.height * 0.5);
  v.dead = false;
  v.life = v.initialLife = Math.max(0, sym(i, c.particleLifespan, c.particleLifespanVariance));
  v.position[0] = sym(i, c.sourcePositionx, c.sourcePositionVariancex);
  v.position[1] = sym(i, c.sourcePositiony, c.sourcePositionVariancey);
  v.start.set(v.position);
  normalize(
    v.radialUnit,
    f(v.position[0] - c.sourcePositionx),
    f(v.position[1] - c.sourcePositiony),
    0,
    true,
  );
  const colors = s.colorScratch;
  for (let k = 0; k < 4; k++) {
    const channel = ['Red', 'Green', 'Blue', 'Alpha'][k];
    colors[k] = clamp(sym(i, c['startColor' + channel], c['startColorVariance' + channel]));
  }
  for (let k = 0; k < 4; k++) {
    const channel = ['Red', 'Green', 'Blue', 'Alpha'][k],
      end = clamp(sym(i, c['finishColor' + channel], c['finishColorVariance' + channel]));
    v.color[k] = integer(colors[k]) & 255;
    v.colorDelta[k] = integer(f(f(end - colors[k]) / v.life)) & 255;
  }
  v.size = Math.max(0, sym(i, c.startParticleSize, c.startParticleSizeVariance));
  const endSize = Math.max(0, sym(i, c.finishParticleSize, c.finishParticleSizeVariance));
  v.sizeDelta = f(f(endSize - v.size) / v.life);
  v.rotation = f(h.Deg2Rad(sym(i, c.rotationStart, c.rotationStartVariance)));
  const endRotation = f(h.Deg2Rad(sym(i, c.rotationEnd, c.rotationEndVariance)));
  v.rotationDelta = f(f(endRotation - v.rotation) / v.life);
  v.angle = f(h.Deg2Rad(sym(i, c.angle, c.angleVariance)));
  if (c.emitterType === 1) {
    v.radius = sym(i, c.maxRadius, c.maxRadiusVariance);
    const minimum = sym(i, c.minRadius, 0);
    v.radiusDelta = f(f(minimum - v.radius) / v.life);
    v.angleRate = f(h.Deg2Rad(sym(i, c.rotatePerSecond, c.rotatePerSecondVariance)));
  } else {
    const speed = sym(i, c.speed, c.speedVariance);
    v.velocity[0] = f(h.cos(v.angle) * speed);
    v.velocity[1] = f(h.sin(v.angle) * speed);
    v.velocity[2] = 0;
    v.radialAccel = sym(i, c.radialAcceleration, c.radialAccelVariance);
    v.tangentialAccel = sym(i, c.tangentialAcceleration, c.tangentialAccelVariance);
  }
}
function copyParticle(out, input) {
  for (const key of Object.keys(input)) {
    if (ArrayBuffer.isView(input[key])) out[key].set(input[key]);
    else out[key] = input[key];
  }
}
function gravity(v, c, dt, temp) {
  const x = f(v.position[0] - c.sourcePositionx),
    y = f(v.position[1] - c.sourcePositiony),
    ax = f(x * v.radialAccel),
    ay = f(y * v.radialAccel),
    bx = -v.radialUnit[1],
    by = v.radialUnit[0],
    bz = v.radialUnit[2],
    T = v.tangentialAccel;
  let cx, cy, cz, tx, ty, tz;
  if (T > 0) {
    cx = f(v.velocity[0] - bx);
    cy = f(v.velocity[1] - by);
    cz = f(v.velocity[2] - bz);
    tx = f(v.velocity[0] + cy);
    ty = f(v.velocity[1] - cx);
    tz = f(v.velocity[2] - cz);
  } else {
    cx = f(bx - v.velocity[0]);
    cy = f(by - v.velocity[1]);
    cz = f(bz - v.velocity[2]);
    tx = f(-cy - v.velocity[0]);
    ty = f(cx - v.velocity[1]);
    tz = f(cz - v.velocity[2]);
  }
  normalize(temp, tx, ty, tz, true);
  const accel = [
    f(f(ax + f(temp[0] * T)) + c.gravityx),
    f(f(ay + f(temp[1] * T)) + c.gravityy),
    f(temp[2] * T),
  ];
  for (let k = 0; k < 3; k++) {
    v.velocity[k] = f(v.velocity[k] + f(accel[k] * dt));
    v.position[k] = f(v.position[k] + f(f(v.velocity[k] * dt) * 1));
  }
}
export const cmnptcl = {
  name: 'cmnptcl-js',
  apiVersion: 0x20002,
  init(i) {
    const s = i.state,
      r = i.parameters.values,
      first = integer(r[0]),
      second = integer(r[1]),
      suffix =
        second < 0 ? '-' + String(-second).padStart(2, '0') : String(second).padStart(3, '0'),
      name = 'ptcl' + first + suffix + '.plist',
      length = i.host.LoadParticleData(name);
    if (!s.particles)
      s.particles = Array.from({ length: i.count }, () => ({
        position: new Float32Array(3),
        start: new Float32Array(3),
        velocity: new Float32Array(3),
        radialUnit: new Float32Array(3),
        color: new Uint8Array(4),
        colorDelta: new Uint8Array(4),
        life: 0,
        initialLife: 0,
        size: 0,
        sizeDelta: 0,
        rotation: 0,
        rotationDelta: 0,
        angle: 0,
        angleRate: 0,
        radius: 0,
        radiusDelta: 0,
        radialAccel: 0,
        tangentialAccel: 0,
        dead: false,
      }));
    if (!length) return;
    const data = new Uint8Array(length);
    i.host.LoadParticleData(name, data);
    config(i, data);
    s.burst = integer(r[2]);
    s.active = 0;
    s.elapsed = 0;
    s.accumulator = 0;
    s.dead = 0;
    s.running = true;
    s.ending = false;
    s.rate = f(f(i.count) / s.config.particleLifespan);
    s.colorScratch = new Float32Array(4);
    s.vector = new Float32Array(3);
    if (s.config.blendFuncDestination === 1) i.blendMode = 1;
    for (let n = 0; n < i.count; n++) reset(i, n);
  },
  exec(i) {
    const s = i.state;
    if (!s.running) return;
    const c = s.config,
      dt = f((i.frame - i.before) >>> 0),
      offset = anchorOffset(i);
    if (!s.ending) {
      const interval = f(1 / s.rate);
      if (s.active < i.count) {
        s.accumulator = f(s.accumulator + dt);
        while (s.accumulator > interval && s.active < i.count) {
          s.active = s.burst ? i.count : s.active + 1;
          s.accumulator = f(s.accumulator - interval);
        }
      }
      s.elapsed = f(s.elapsed + dt);
      if (c.duration !== -1 && c.duration < s.elapsed) s.ending = true;
    }
    let n = 0;
    while (n < s.active) {
      const v = s.particles[n],
        p = i.particle(n);
      v.life = f(v.life - dt);
      if (v.life <= 0) {
        if (!s.ending) {
          reset(i, n);
          const last = s.active - 1;
          if (n !== last) {
            i.records().copyWithin(n * 148, last * 148, (last + 1) * 148);
            copyParticle(v, s.particles[last]);
            reset(i, last);
          }
          s.active--;
        } else {
          if (!v.dead) {
            v.dead = true;
            p.disp = 0;
            s.dead++;
          }
          if (s.dead === s.active) {
            s.running = false;
            s.elapsed = c.duration;
            s.accumulator = 0;
            return;
          }
          n++;
        }
      } else {
        p.disp = 1;
        if (c.emitterType === 1) {
          v.angle = f(f(v.angleRate * dt) + v.angle);
          v.radius = f(f(v.radiusDelta * dt) + v.radius);
          v.position[0] = f(-f(i.host.cos(v.angle) * v.radius) + c.sourcePositionx);
          v.position[1] = f(-f(i.host.sin(v.angle) * v.radius) + c.sourcePositiony);
          v.position[2] = f(v.position[2] + 0);
        } else gravity(v, c, dt, s.vector);
        for (let k = 0; k < 4; k++)
          v.color[k] = integer(f(f(v.colorDelta[k] * dt) + v.color[k])) & 255;
        v.size = Math.max(0, f(v.size + f(v.sizeDelta * dt)));
        v.rotation = f(v.rotation + f(v.rotationDelta * dt));
        p.pos.set(v.position);
        p.rot.z = v.rotation;
        p.scale.x = p.scale.y = v.size;
        const color =
          ((v.color[3] << 24) | (v.color[0] << 16) | (v.color[1] << 8) | v.color[2]) >>> 0;
        for (const vertex of p.vertices) vertex.color = color;
        n++;
      }
      p.pos.x = f(p.pos.x + offset[0]);
      p.pos.y = f(p.pos.y + offset[1]);
    }
  },
};
