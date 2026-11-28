// SPDX-License-Identifier: MPL-2.0
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

export async function releaseNativeConfigurationEvent(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile] + 88,
    handle = p.load(slot);
  if (!handle) return;
  const close = engine.kernel.resolve({ dll: 'KERNEL32.dll', name: 'CloseHandle' });
  if (!(await engine.call(close, [handle])))
    throw new Error('Original startup did not release its configuration event');
  p.store(slot, 0);
}
