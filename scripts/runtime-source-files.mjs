// SPDX-License-Identifier: MPL-2.0
import { nativeEntryGraph } from './check-native-entry.mjs';

// One source authority for product audit, inventory and artifact ownership.
// Explicit oracle includes remain a development-server concern only.
export function runtimeSourceFiles(root) {
  return nativeEntryGraph(root, 'web/app.mjs', new Map(), { strict: true });
}
