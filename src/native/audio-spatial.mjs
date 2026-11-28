// SPDX-License-Identifier: MPL-2.0
// DirectSound delegates spatial filtering to the output device. The browser
// backend uses WebAudio's inverse-distance panner and computes the Doppler
// playback ratio, which current PannerNode implementations do not supply.
// Positions and velocities remain in the engine's left-handed coordinate system.
export function spatialPlaybackRate(
  { position = [0, 0, 0], velocity = [0, 0, 0], dopplerFactor = 1, speedOfSound = 343.3 },
  sampleRate,
) {
  if (
    ![...position, ...velocity, dopplerFactor, speedOfSound].every(Number.isFinite) ||
    speedOfSound <= 0
  )
    throw new Error('Invalid spatial audio parameters');
  const distance = Math.hypot(...position);
  if (!distance || !dopplerFactor) return 1;
  const radial = velocity.reduce(
    (sum, component, axis) => sum + (component * position[axis]) / distance,
    0,
  );
  const shifted =
    speedOfSound / Math.max(speedOfSound * 0.01, speedOfSound + radial * dopplerFactor);
  return Math.min(200000 / sampleRate, Math.max(100 / sampleRate, shifted));
}
