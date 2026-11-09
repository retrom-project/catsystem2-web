// SPDX-License-Identifier: MPL-2.0
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

export async function initializeNativeConfigurationEvent(engine) {
  const p = engine.process,
    slot = NATIVE_STARTUP_BLOCKS[engine.profile] + 88,
    sdk = engine.profile.startsWith('sdk-'),
    name = sdk ? 0xae78ac : 0x9e2fb0,
    create = engine.kernel.resolve({
      dll: 'KERNEL32.dll',
      name: sdk ? 'CreateEventA' : 'CreateEventW',
    });
  if (p.load(slot)) throw new Error('Original configuration event already exists');
  const handle = await engine.call(create, [0, 0, 0, name]);
  if (!handle) throw new Error('Original startup could not create its configuration event');
  p.store(slot, handle);
}

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
