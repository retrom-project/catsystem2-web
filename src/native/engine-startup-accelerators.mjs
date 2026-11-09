// SPDX-License-Identifier: MPL-2.0
import { NATIVE_STARTUP_BLOCKS, runNativeGameWinMainSpan } from './engine-startup-block.mjs';

export async function initializeNativeAccelerators(engine) {
  const p = engine.process,
    owner = p.load(NATIVE_STARTUP_BLOCKS[engine.profile]);
  if (!owner || p.load(owner + 12))
    throw new Error('Original accelerators require their unused window owner');
  if (engine.profile.startsWith('sdk-')) {
    const load = engine.kernel.resolve({ dll: 'USER32.dll', name: 'LoadAcceleratorsA' }),
      handle = await engine.call(load, [engine.module.base, 101]);
    if (handle) await engine.call(0x5bfc50, [handle], owner);
  } else {
    await runNativeGameWinMainSpan(engine, 0x52cdcb, 0x52cfed, (stack, cpu, uc) => {
      p.store(stack + 0x14, engine.module.base); // WinMain's local hInstance.
      cpu.reg_write_i32(uc.X86_REG_EAX, engine.refs.settings);
      cpu.reg_write_i32(uc.X86_REG_EBX, 0);
    });
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
