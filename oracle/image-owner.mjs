// SPDX-License-Identifier: MPL-2.0
// FES IMAGEEX retains an independent projected image collection until phase 7.
export function imageOwnerReleaseAddress(engine) {
  return engine.profile === 'sdk-4.01-engine-2.6.1.74' ? 0x5e3210 : 0x7424d0;
}
