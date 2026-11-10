// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../src/native/abi/index.mjs';

// Temporary capacity for the original M2 texture/model path. Remove with the
// x86 backend in phase 10. JS-owned media allocations have separate ownership.
export const TRANSITIONAL_HEAP_POLICY = Object.freeze({
  defaultBytes: 256 * 1024 * 1024,
  nativeEmoteBytes: 512 * 1024 * 1024,
  removeInPhase: 10,
  consumersRemovedInPhases: Object.freeze([6, 9]),
});

export function transitionalHeapSize(profile) {
  return nativeABI(profile).plugins.emoteDriver === 'native'
    ? TRANSITIONAL_HEAP_POLICY.nativeEmoteBytes
    : TRANSITIONAL_HEAP_POLICY.defaultBytes;
}
