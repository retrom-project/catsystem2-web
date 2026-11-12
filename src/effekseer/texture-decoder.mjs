// SPDX-License-Identifier: MPL-2.0
// The proved texture-source path is PNG RGBA8 through the selected level0 device.
import { PNG } from '../formats/png.mjs';
import { EFFEKSEER_LEVEL0_PROFILE, convertEffekseerLevel0 } from './texture-level0.mjs';

export function isEffekseerTextureProfile(profile) {
  return (
    profile !== null &&
    typeof profile === 'object' &&
    Object.keys(profile).length === Object.keys(EFFEKSEER_LEVEL0_PROFILE).length &&
    Object.entries(EFFEKSEER_LEVEL0_PROFILE).every(([field, value]) => profile[field] === value)
  );
}

export async function decodeEffekseerTexture(bytes, { profile = EFFEKSEER_LEVEL0_PROFILE } = {}) {
  if (!isEffekseerTextureProfile(profile))
    throw new Error('Unsupported Effekseer texture device profile');
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Effekseer texture requires PNG bytes');
  const png = new PNG(bytes);
  if (png.depth !== 8 || png.colorType !== 6)
    throw new Error(`Unsupported Effekseer PNG layout: ${png.depth}-bit/type${png.colorType}`);
  return convertEffekseerLevel0(
    { width: png.width, height: png.height, rgba: await png.decode() },
    profile,
  );
}
