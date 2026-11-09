// SPDX-License-Identifier: MPL-2.0
// The first word of WinMain's static startup block owns kcWindow.
import { NATIVE_CONFIGURATION_MEMORY_LAYOUTS } from './config-memory.mjs';
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const layouts = {
  'sdk-4.01-engine-2.6.1.74': {
    construct: 0x5bf430,
    destroy: 0x5bf510,
    open: 0x5bf870,
    menuFlag: 48804,
    hook: 0xc9659c,
    releaseHook: 0x5c01c0,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    construct: 0x70e080,
    destroy: 0x70e160,
    open: 0x70e4c0,
    menuFlag: 51728,
    hook: 0xb91bc4,
    releaseHook: 0x70eed0,
  },
};
const WINDOW_BYTES = 0x74;

export async function initializeNativeWindowOwner(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile],
    { construct } = layouts[engine.profile];
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

export async function createNativeStartupWindow(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile],
    owner = p.load(slot),
    { open, menuFlag } = layouts[engine.profile],
    { first } = NATIVE_CONFIGURATION_MEMORY_LAYOUTS[engine.profile],
    dimensions = p.load(engine.refs.owner + first),
    classRecord = engine.refs.windowClass,
    menuOwner = p.load(engine.refs.settings + menuFlag) ? p.load(slot + 36) : 0;
  if (!owner || !classRecord || p.load(owner) || !dimensions)
    throw new Error('Original window creation requires its class and unused owner');
  const rect = p.allocate(16, true);
  try {
    p.store(rect + 8, dimensions & 0xffff);
    p.store(rect + 12, dimensions >>> 16);
    const handle = await engine.call(
      open,
      [classRecord, rect, 0xca0000, 0x800a0000, menuOwner, 0],
      owner,
    );
    if (
      handle !== 1 ||
      p.load(owner) !== handle ||
      engine.kernel.windowViews.windows.get(handle)?.userData !== owner
    )
      throw new Error('Original startup could not create its main window');
  } finally {
    p.free(rect);
  }
}

export async function releaseNativeWindowOwner(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile],
    owner = p.load(slot);
  if (!owner) return;
  if (p.allocations.get(owner) !== WINDOW_BYTES)
    throw new Error('Original startup window lost its C++ owner');
  const { destroy, hook, releaseHook } = layouts[engine.profile];
  await engine.call(destroy, [], owner);
  if (!p.free(owner)) throw new Error('Original startup window allocation could not be released');
  p.store(slot, 0);
  const callbackOwner = p.load(hook);
  if (callbackOwner) {
    await engine.call(releaseHook, [], callbackOwner);
    if (p.load(hook) || !p.free(callbackOwner))
      throw new Error('Original window callbacks did not release their owner');
  }
}
