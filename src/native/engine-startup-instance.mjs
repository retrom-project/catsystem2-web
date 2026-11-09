// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// The original startup mutex belongs to the static WinMain record. Each
// emulated process has its own instance namespace.
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const layouts = {
  'sdk-4.01-engine-2.6.1.74': [
    0x635d60,
    0x432070,
    nativeABI('sdk-4.01-engine-2.6.1.74').layouts.startupInstance.nameOffset,
  ],
  'nekopara-vol3-engine-2.6.1.76': [
    0x79d1f0,
    0x79d280,
    nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.startupInstance.nameOffset,
  ],
};

export async function initializeNativeStartupInstance(engine) {
  const p = engine.process,
    block = NATIVE_STARTUP_BLOCKS[engine.profile],
    [construct, , name] = layouts[engine.profile];
  if (p.load(block + 28)) throw new Error('Original startup instance already has an owner');
  const pointer = p.allocate(4, true),
    status = p.allocate(4, true);
  try {
    if ((await engine.call(construct, [engine.refs.settings + name, status], pointer)) !== pointer)
      throw new Error('Original startup instance constructor returned a different owner');
    p.store(block + 28, pointer);
    if (p.load(status) || !p.load(pointer))
      throw new Error('Original startup could not acquire its virtual instance mutex');
    p.store(block + 32, 0);
  } finally {
    if (p.load(block + 28) !== pointer) p.free(pointer);
    p.free(status);
  }
}

export async function releaseNativeStartupInstance(engine) {
  if (!engine.refs.nativeOwner) return;
  const p = engine.process,
    block = NATIVE_STARTUP_BLOCKS[engine.profile],
    pointer = p.load(block + 28);
  if (!pointer) return;
  if (p.allocations.get(pointer) !== 4)
    throw new Error('Original startup instance lost its owned mutex record');
  await p.callAsync(layouts[engine.profile][1], [], pointer);
  p.free(pointer);
  p.store(block + 28, 0);
}
