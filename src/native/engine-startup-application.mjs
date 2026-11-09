// SPDX-License-Identifier: MPL-2.0
import { NATIVE_STARTUP_BLOCKS, runNativeStackSpan } from './engine-startup-block.mjs';
import {
  isNativeWindowCommandMessage,
  NATIVE_WINDOW_COMMAND_CALLBACKS,
} from './window-commands.mjs';

const layouts = {
  'sdk-4.01-engine-2.6.1.74': {
    begin: 0x43ebd9,
    registered: 0x43ec0a,
    post: 0x43ec5d,
    dispatch: 0x5c05dd,
    nextHook: 0x5c05fb,
    unregister: 0x5c03b0,
    destroyIME: 0x4b7db0,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    begin: 0x52d031,
    registered: 0x52d062,
    post: 0x52d0a6,
    dispatch: 0x70f2ed,
    nextHook: 0x70f30b,
    unregister: 0x70f0c0,
    destroyIME: 0x5db8a0,
  },
};
const IME_SLOT = 40;
const IME_BYTES = 24;

export function installNativeApplicationWindowBoundary(engine) {
  const { process: p, profile } = engine,
    { cpu, uc } = p,
    { dispatch, nextHook } = layouts[profile],
    callback = NATIVE_WINDOW_COMMAND_CALLBACKS[profile],
    block = NATIVE_STARTUP_BLOCKS[profile];
  p.beforeInstruction(dispatch, 'application window callback platform boundary', () => {
    const hook = cpu.reg_read_i32(uc.X86_REG_EDI) >>> 0;
    if (p.load(hook + 8) !== callback || p.load(hook + 12) !== block) return;
    const packet = cpu.reg_read_i32(uc.X86_REG_EBX) >>> 0;
    // The remaining application window services are dispatched by the World.
    // Continue the original hook walk so the other window callbacks still run.
    if (!isNativeWindowCommandMessage(p.load(packet + 4)))
      cpu.reg_write_i32(uc.X86_REG_EIP, nextHook);
  });
}

export async function initializeNativeApplicationWindow(engine) {
  const { process: p, profile } = engine,
    block = NATIVE_STARTUP_BLOCKS[profile],
    owner = p.load(block),
    handle = owner && p.load(owner),
    { begin, registered, post } = layouts[profile];
  if (
    !handle ||
    !engine.kernel.windowViews.windows.has(handle) ||
    engine.refs.applicationWindowHook ||
    p.load(block + 88) ||
    p.load(block + IME_SLOT)
  )
    throw new Error('Original application window prelude requires its unused startup slots');
  const detach = p.beforeInstruction(registered, 'original application window hook result', () => {
    if (p.cpu.reg_read_i32(p.uc.X86_REG_EAX) !== 1)
      throw new Error('Original application window hook could not be registered');
    engine.refs.applicationWindowHook = handle;
  });
  try {
    await runNativeStackSpan(engine, begin, post, 0);
    const ime = p.load(block + IME_SLOT),
      event = p.load(block + 88);
    if (
      engine.refs.applicationWindowHook !== handle ||
      p.allocations.get(ime) !== IME_BYTES ||
      p.load(ime) !== handle ||
      !p.load(ime + 4) ||
      engine.kernel.events.events.get(event)?.event !== 'CoreSystem2ConfigEvent'
    )
      throw new Error('Original application window prelude did not establish its owners');
  } finally {
    detach();
  }
}

export async function releaseNativeApplicationWindow(engine) {
  const { process: p, profile } = engine,
    block = NATIVE_STARTUP_BLOCKS[profile],
    { applicationWindowHook: handle } = engine.refs,
    { unregister, destroyIME } = layouts[profile];
  if (handle) {
    if (
      (await engine.call(unregister, [handle, block, NATIVE_WINDOW_COMMAND_CALLBACKS[profile]])) !==
      1
    )
      throw new Error('Original application window hook could not be unregistered');
    delete engine.refs.applicationWindowHook;
  }
  const ime = p.load(block + IME_SLOT);
  if (!ime) return;
  if (p.allocations.get(ime) !== IME_BYTES)
    throw new Error('Original startup IME owner is invalid');
  await engine.call(destroyIME, [], ime);
  if (p.load(ime) || p.load(ime + 4) || !p.free(ime))
    throw new Error('Original startup IME owner could not be released');
  p.store(block + IME_SLOT, 0);
}
