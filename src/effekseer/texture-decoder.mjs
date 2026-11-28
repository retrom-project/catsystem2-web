// SPDX-License-Identifier: MPL-2.0
// Selected PNG RGB8/RGBA8 paths whose original metadata needs no color transform.
import { PNG } from '../formats/png.mjs';
import { effekseerLevel0Profile, convertEffekseerLevel0 } from './texture-level0.mjs';

export function isEffekseerTextureProfile(profile) {
  return (
    profile !== null &&
    typeof profile === 'object' &&
    [21, 22].includes(profile.format) &&
    Object.keys(profile).length === Object.keys(effekseerLevel0Profile(profile.format)).length &&
    Object.entries(effekseerLevel0Profile(profile.format)).every(
      ([field, value]) => profile[field] === value,
    )
  );
}

function requireNoColorTransform(png) {
  const chunks = png.colorChunks;
  if (!chunks.length) return;
  const chunk = chunks[0];
  if (
    chunks.length !== 1 ||
    chunk.type !== 'gAMA' ||
    chunk.size !== 4 ||
    !chunk.validCRC ||
    chunk.afterPalette ||
    chunk.afterData ||
    chunk.value === 0
  )
    throw new Error('Unsupported Effekseer PNG color metadata');
  // Only metadata storage rounds to f32. Screen2.2/threshold comparison has no
  // f32 store; the integer-neighbor proof bounds double vs native evaluation.
  const fileGamma = Math.fround(chunk.value * Math.fround(0.00001)),
    error = Math.abs(2.2 * fileGamma - 1);
  if (error > 0.05) throw new Error('Unsupported Effekseer PNG color metadata: gamma transform');
}

export async function decodeEffekseerTexture(bytes, { profile: deviceProfile } = {}) {
  if (deviceProfile !== undefined && !isEffekseerTextureProfile(deviceProfile))
    throw new Error('Unsupported Effekseer texture device profile');
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Effekseer texture requires PNG bytes');
  const png = new PNG(bytes);
  if (png.depth !== 8 || ![2, 6].includes(png.colorType))
    throw new Error(`Unsupported Effekseer PNG layout: ${png.depth}-bit/type${png.colorType}`);
  if (png.transparency) throw new Error('Unsupported Effekseer PNG transparency');
  if (png.colorType === 2 && png.interlace) throw new Error('Unsupported Effekseer RGB interlace');
  requireNoColorTransform(png);
  const format = png.colorType === 2 ? 22 : 21;
  if (deviceProfile !== undefined && deviceProfile.format !== format)
    throw new Error('Unsupported Effekseer texture source format for the requested profile');
  const frame = convertEffekseerLevel0(
    { width: png.width, height: png.height, rgba: await png.decode() },
    effekseerLevel0Profile(format),
  );
  return { ...frame, format };
}
