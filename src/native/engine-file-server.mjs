// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// The original platform prelude owns a kcFileServer before creating Settings.
export const NATIVE_FILE_SERVER_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    global: 0xb8fb08,
    size: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.fileServer.size,
    construct: 0x5d3060,
    destroy: 0x5d33e0,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    global: 0xc94630,
    size: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.fileServer.size,
    construct: 0x4b0020,
    destroy: 0x4b0330,
  }),
});

export async function initializeNativeFileServer(engine) {
  const layout = NATIVE_FILE_SERVER_LAYOUTS[engine.profile],
    p = engine.process;
  if (!layout || p.load(layout.global))
    throw new Error('Native file server requires an uninitialized engine');
  const pointer = p.allocate(layout.size, true);
  if (
    (await p.callAsync(layout.construct, [], pointer)) !== pointer ||
    p.load(layout.global) !== pointer
  )
    throw new Error('Original file server did not establish its singleton');
  engine.refs.fileServer = pointer;
}

export async function releaseNativeFileServer(engine) {
  const pointer = engine.refs.fileServer;
  if (!pointer) return;
  const layout = NATIVE_FILE_SERVER_LAYOUTS[engine.profile],
    p = engine.process;
  if (!layout || p.load(layout.global) !== pointer || p.allocations.get(pointer) !== layout.size)
    throw new Error('Original file server has inconsistent ownership');
  await p.callAsync(layout.destroy, [], pointer);
  if (p.load(layout.global) || !p.free(pointer))
    throw new Error('Original file server did not release its singleton');
  delete engine.refs.fileServer;
}
