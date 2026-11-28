// SPDX-License-Identifier: MPL-2.0
// Canonical control numbering is an ABI boundary shared by JS task callers.
import { mapABIMessage } from './abi/messages.mjs';
export function canonicalMessage(profile, kind, message) {
  return mapABIMessage(profile, 'control', 'canonical', message, kind);
}
