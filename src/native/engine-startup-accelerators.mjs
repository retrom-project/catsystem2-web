// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { requireTransitionalHost } from './transitional-exe.mjs';
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

export async function initializeNativeAccelerators(engine) {
  const p = engine.process,
    owner = p.load(NATIVE_STARTUP_BLOCKS[engine.profile]);
  if (!owner || p.load(owner + 12))
    throw new Error('Original accelerators require their unused window owner');
  if (nativeABI(engine.profile).startup.accelerators === 'ansi-resource') {
    const load = engine.kernel.resolve({ dll: 'USER32.dll', name: 'LoadAcceleratorsA' }),
      handle = await engine.call(load, [engine.module.base, 101]);
    if (handle) await engine.call(0x5bfc50, [handle], owner);
  } else {
    await requireTransitionalHost(
      engine.transitionalExe,
      engine.profile,
      'startup.accelerators',
      'invokeRegion',
    ).invokeRegion('startup.accelerators', { engine });
  }
  if (!engine.kernel.accelerators.tables.has(p.load(owner + 12)))
    throw new Error('Original startup did not install its accelerator table');
}

export async function releaseNativeAccelerators(engine, handle) {
  if (!handle) return;
  const table = engine.kernel.accelerators.tables.get(handle);
  if (!table) throw new Error('Original window accelerator has lost its owner');
  if (!table.resource) {
    const destroy = engine.kernel.resolve({ dll: 'USER32.dll', name: 'DestroyAcceleratorTable' });
    if (!(await engine.call(destroy, [handle])))
      throw new Error('Original dynamic accelerator table did not release');
  }
}
