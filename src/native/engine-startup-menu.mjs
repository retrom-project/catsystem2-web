// SPDX-License-Identifier: MPL-2.0
// WinMain owns the original MainWndMenu at +36 in the startup block.
import { NATIVE_CONFIGURATION_MEMORY_LAYOUTS } from './config-memory.mjs';
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const layouts = {
  'sdk-4.01-engine-2.6.1.74': [0x5bf330, 0x5bf3c0, 0xaff2c8],
  'nekopara-vol3-engine-2.6.1.76': [0x70df70, 0x70e000, 0x9e3230],
};

export async function initializeNativeStartupMenu(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile] + 36,
    [construct, load, vtable] = layouts[engine.profile],
    { authorMode } = NATIVE_CONFIGURATION_MEMORY_LAYOUTS[engine.profile];
  if (p.load(slot)) throw new Error('Original startup menu already has an owner');
  const owner = p.allocate(16, true);
  try {
    if ((await engine.call(construct, [], owner)) !== owner)
      throw new Error('Original startup menu constructor returned a different owner');
    p.store(owner, vtable);
    const resource = p.load(engine.refs.owner + authorMode) ? 105 : 104;
    if (!(await engine.call(load, [engine.module.base, resource], owner)))
      throw new Error(`Original startup menu resource ${resource} could not be loaded`);
    p.store(slot, owner);
  } finally {
    if (p.load(slot) !== owner) p.free(owner);
  }
}

export async function releaseNativeStartupMenu(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile] + 36,
    owner = p.load(slot);
  if (!owner) return;
  const vtable = layouts[engine.profile][2];
  if (p.allocations.get(owner) !== 16 || p.load(owner) !== vtable)
    throw new Error('Original startup menu lost its C++ owner');
  const handle = p.load(owner + 8);
  await engine.call(p.load(vtable), [1], owner);
  if (p.allocations.has(owner) || engine.kernel.windowMenus.menus.has(handle))
    throw new Error('Original startup menu did not release its allocation and handle');
  p.store(slot, 0);
}
