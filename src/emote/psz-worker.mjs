// SPDX-License-Identifier: MPL-2.0
import { inflate } from '../binary.mjs';

self.onmessage = async ({ data: { bytes, length } }) => {
  try {
    const expanded = await inflate(bytes, length, 64 * 1024 * 1024);
    self.postMessage(expanded, [expanded.buffer]);
  } catch {
    self.postMessage(null);
  }
};
