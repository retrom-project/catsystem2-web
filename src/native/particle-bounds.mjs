// SPDX-License-Identifier: MPL-2.0
import { nativeParticleNear, projectionBounds } from '../ppi/numeric.mjs';

export function nativeParticleBounds(
  z,
  width,
  height,
  priority,
  near = nativeParticleNear(priority),
) {
  return projectionBounds(z, width, height, priority, near, 24);
}
