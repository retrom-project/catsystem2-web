// SPDX-License-Identifier: MPL-2.0
// The first word of WinMain's static startup block owns kcWindow.
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const layouts = {
  'sdk-4.01-engine-2.6.1.74': [0x5bf430, 0x5bf510],
  'nekopara-vol3-engine-2.6.1.76': [0x70e080, 0x70e160],
};
const WINDOW_BYTES = 0x74;

export async function initializeNativeWindowOwner(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile],
    [construct] = layouts[engine.profile];
  if (p.load(slot)) throw new Error('Original startup window already has an owner');
  const owner = p.allocate(WINDOW_BYTES, true);
  try {
    if ((await engine.call(construct, [], owner)) !== owner)
      throw new Error('Original startup window constructor returned a different owner');
    p.store(slot, owner);
  } finally {
    if (p.load(slot) !== owner) p.free(owner);
  }
}

export async function releaseNativeWindowOwner(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile],
    owner = p.load(slot);
  if (!owner) return;
  if (p.allocations.get(owner) !== WINDOW_BYTES)
    throw new Error('Original startup window lost its C++ owner');
  await engine.call(layouts[engine.profile][1], [], owner);
  if (!p.free(owner)) throw new Error('Original startup window allocation could not be released');
  p.store(slot, 0);
}
