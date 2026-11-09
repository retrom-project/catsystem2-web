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
    afterPost: 0x43ec63,
    dispatch: 0x5c05dd,
    nextHook: 0x5c05fb,
    unregister: 0x5c03b0,
    destroyIME: 0x4b7db0,
    destroyDisplay: 0x635ea0,
    soundRead: 0x442e22,
    soundReady: 0x442e77,
    graphicsReady: 0x442fac,
    servicesReturn: 0x44381b,
    graphicsBytes: 0x54,
    findTask: 0x4b9690,
    destroyGraphics: 0x4b7f10,
    destroySound: 0x4a8f90,
    soundGlobal: 0xc945cc,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    begin: 0x52d031,
    registered: 0x52d062,
    afterPost: 0x52d0ac,
    dispatch: 0x70f2ed,
    nextHook: 0x70f30b,
    unregister: 0x70f0c0,
    destroyIME: 0x5db8a0,
    destroyDisplay: 0x79d380,
    soundRead: 0x531b47,
    soundReady: 0x531bab,
    graphicsReady: 0x531ce7,
    servicesReturn: 0x5325b8,
    graphicsBytes: 0x254,
    findTask: 0x5dd450,
    destroyGraphics: 0x5dba30,
    destroySound: 0x5cbee0,
    soundGlobal: 0xb8faa4,
  },
};
const IME_SLOT = 40;
const IME_BYTES = 24;
const GRAPHICS_SLOT = 4;
const GRAPHICS_DEVICE_SLOT = 16;
const GRAPHICS_VIEW_SLOT = 20;
const DISPLAY_SLOT = 8;
const DISPLAY_BYTES = 36;
const SOUND_SLOT = 12;
const SOUND_BYTES = 0x78;
const DISPLAY_STARTUP_MESSAGE = 0x40b;
export const NATIVE_APPLICATION_SERVICES_MESSAGE = 0x40c;

export function installNativeApplicationWindowBoundary(engine) {
  const { process: p, profile } = engine,
    { cpu, uc } = p,
    { dispatch, nextHook } = layouts[profile],
    callback = NATIVE_WINDOW_COMMAND_CALLBACKS[profile],
    block = NATIVE_STARTUP_BLOCKS[profile];
  p.beforeInstruction(dispatch, 'application window callback platform boundary', () => {
    const hook = cpu.reg_read_i32(uc.X86_REG_EDI) >>> 0;
    if (p.load(hook + 8) !== callback || p.load(hook + 12) !== block) return;
    const packet = cpu.reg_read_i32(uc.X86_REG_EBX) >>> 0,
      message = p.load(packet + 4);
    // The remaining application window services are dispatched by the World.
    // Continue the original hook walk so the other window callbacks still run.
    if (
      message !== DISPLAY_STARTUP_MESSAGE &&
      !(engine.startingApplicationServices && message === NATIVE_APPLICATION_SERVICES_MESSAGE) &&
      !isNativeWindowCommandMessage(message)
    )
      cpu.reg_write_i32(uc.X86_REG_EIP, nextHook);
  });
}

export async function initializeNativeApplicationWindow(engine) {
  const { process: p, profile } = engine,
    block = NATIVE_STARTUP_BLOCKS[profile],
    owner = p.load(block),
    handle = owner && p.load(owner),
    { begin, registered, afterPost } = layouts[profile];
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
    if ((await runNativeStackSpan(engine, begin, afterPost, 0)) !== 1)
      throw new Error('Original WinMain could not post its display initialization');
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

export async function initializeNativeApplicationServices(
  engine,
  { graphics = false, finishSoundRead } = {},
) {
  const { process: p, profile, kernel, refs } = engine,
    { cpu, uc } = p,
    block = NATIVE_STARTUP_BLOCKS[profile],
    handle = refs.applicationWindowHook,
    window = kernel.windowViews.windows.get(handle),
    { soundRead, soundReady, graphicsReady, servicesReturn, soundGlobal } = layouts[profile];
  if (
    !window ||
    !p.load(block + DISPLAY_SLOT) ||
    p.load(block + SOUND_SLOT) ||
    p.load(soundGlobal) ||
    p.load(block + GRAPHICS_SLOT) ||
    engine.startingApplicationServices
  )
    throw new Error('Original services require the initialized application window');
  let loaded,
    ready = false;
  const detach = [],
    finish = () => {
      ready = true;
      cpu.reg_write_i32(uc.X86_REG_EIP, servicesReturn);
    };
  engine.startingApplicationServices = true;
  try {
    detach.push(
      p.beforeInstruction(soundRead, 'original application sound configuration result', () => {
        loaded = cpu.reg_read_i32(uc.X86_REG_EAX) >>> 0;
      }),
    );
    detach.push(
      p.beforeInstruction(soundReady, 'original application sound owner is ready', () => {
        finishSoundRead?.();
        if (!graphics) finish();
      }),
    );
    if (graphics)
      detach.push(
        p.beforeInstruction(graphicsReady, 'original application graphics ready', finish),
      );
    await engine.call(window.procedure, [handle, NATIVE_APPLICATION_SERVICES_MESSAGE, 0, 0]);
    const owner = p.load(block + SOUND_SLOT);
    if (
      loaded === undefined ||
      !ready ||
      p.allocations.get(owner) !== SOUND_BYTES ||
      p.load(soundGlobal) !== owner ||
      p.load(owner) !== 1 ||
      p.load(owner + 4) !== handle
    )
      throw new Error('Original application callback did not establish its sound owner');
    if (graphics) await bindNativeApplicationGraphics(engine);
    return loaded;
  } finally {
    delete engine.startingApplicationServices;
    for (const unhook of detach.reverse()) unhook();
  }
}

async function bindNativeApplicationGraphics(engine) {
  const { process: p, profile, kernel, refs } = engine,
    block = NATIVE_STARTUP_BLOCKS[profile],
    { graphicsBytes, findTask } = layouts[profile],
    task = p.load(block + GRAPHICS_SLOT),
    device = p.load(block + GRAPHICS_DEVICE_SLOT),
    view = p.load(block + GRAPHICS_VIEW_SLOT),
    thread = task && p.load(task + 12),
    handle = thread && p.load(thread),
    worker = kernel.threadHandles.threads.get(kernel.threadHandles.handles.get(handle)?.id),
    top = device && p.load(device + 8);
  if (
    p.allocations.get(task) !== graphicsBytes ||
    p.allocations.get(device) !== 0x28 ||
    p.load(task + 20) !== device ||
    !p.allocations.has(view) ||
    p.load(device + 4) !== view ||
    !p.allocations.has(top) ||
    p.load(top + 104) !== view ||
    !worker?.context
  )
    throw new Error('Original application callback did not establish its graphics owners');
  const out = p.allocate(4, true),
    children = [];
  try {
    for (const [offset, kind] of [
      [120, 11],
      [124, 13],
    ]) {
      const id = p.load(top + offset);
      if (!(await engine.call(findTask, [id, out], top)))
        throw new Error('Original BASE TASK has no device task');
      const pointer = p.load(out);
      if (
        !p.allocations.has(pointer) ||
        p.load(pointer + 12) !== top ||
        p.load(pointer + 64) !== kind
      )
        throw new Error('Original BASE TASK device ownership differs');
      children.push(pointer);
    }
  } finally {
    p.free(out);
  }
  const renderer = engine.features.get('renderer');
  if (!renderer) throw new Error('Original application graphics require a renderer');
  renderer.adoptApplicationView(view);
  refs.applicationGraphics = { task, top, handle, input: children[0], sound: children[1] };
}

export async function releaseNativeApplicationGraphics(engine) {
  if (!engine.refs.nativeOwner) return;
  const { process: p, profile, kernel, refs } = engine,
    block = NATIVE_STARTUP_BLOCKS[profile],
    task = p.load(block + GRAPHICS_SLOT);
  if (!task) return;
  const { destroyGraphics, graphicsBytes } = layouts[profile],
    device = p.load(task + 20),
    view = device && p.load(device + 4),
    top = device && p.load(device + 8),
    { input, sound, handle } = refs.applicationGraphics ?? {},
    destroy = () => engine.call(destroyGraphics, [], task);
  if (p.allocations.get(task) !== graphicsBytes)
    throw new Error('Original startup graphics task is invalid');
  if (kernel.clock) await kernel.clock.whileWaiting(destroy);
  else await destroy();
  if (
    p.load(task + 12) ||
    kernel.threadHandles.handles.has(handle) ||
    [device, view, top, input, sound].some((pointer) => p.allocations.has(pointer)) ||
    !p.free(task)
  )
    throw new Error('Original startup graphics task could not be released');
  for (const offset of [GRAPHICS_SLOT, GRAPHICS_DEVICE_SLOT, GRAPHICS_VIEW_SLOT])
    p.store(block + offset, 0);
  delete refs.applicationGraphics;
}

export async function releaseNativeApplicationWindow(engine) {
  const { process: p, profile } = engine,
    block = NATIVE_STARTUP_BLOCKS[profile],
    { applicationWindowHook: handle } = engine.refs,
    { unregister, destroyIME, destroyDisplay, destroySound, soundGlobal } = layouts[profile];
  const sound = p.load(block + SOUND_SLOT);
  if (sound) {
    if (p.allocations.get(sound) !== SOUND_BYTES || p.load(soundGlobal) !== sound)
      throw new Error('Original startup sound owner is invalid');
    await engine.call(destroySound, [], sound);
    if (p.load(soundGlobal) || !p.free(sound))
      throw new Error('Original startup sound owner could not be released');
    p.store(block + SOUND_SLOT, 0);
  }
  const display = p.load(block + DISPLAY_SLOT);
  if (display) {
    if (p.allocations.get(display) !== DISPLAY_BYTES)
      throw new Error('Original startup display owner is invalid');
    await engine.call(destroyDisplay, [], display);
    if (!p.free(display)) throw new Error('Original startup display owner could not be released');
    p.store(block + DISPLAY_SLOT, 0);
  }
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
