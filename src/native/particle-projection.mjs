// SPDX-License-Identifier: MPL-2.0
// Engine-normal PC24 projection. Plug-in FPCW mutations are oracle evidence.
import { identity } from '../motion/matrix.mjs';
import { particleDepthOrder } from '../ppi/geometry.mjs';
import { projectNativeParticle } from '../ppi/native-projection-math.mjs';

export class NativeParticleProjection {
  geometry(particles, options) {
    const normalized = {
        ...options,
        screenMatrix: options.screenMatrix ?? identity(),
        screenShift: options.screenShift ?? [0, 0],
      },
      shifts = options.zShifts ?? [];
    if (options.alpha === 0) return [];
    return particleDepthOrder(particles, shifts).flatMap(({ index }, rank) => {
      const particle = particles[index];
      if (!particle.disp) return [];
      const vertices = projectNativeParticle(
        particle,
        { ...normalized, zShift: shifts[rank] || 0 },
        (angle) => [Math.fround(Math.cos(angle)), Math.fround(Math.sin(angle))],
        24,
      );
      if (!vertices) throw new RangeError('Particle transform exceeds finite scalar matrix inputs');
      return [{ index, vertices }];
    });
  }
}
