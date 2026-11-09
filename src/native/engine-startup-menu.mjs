// SPDX-License-Identifier: MPL-2.0
// WinMain owns the original MainWndMenu at +36 in the startup block.
import { NATIVE_CONFIGURATION_MEMORY_LAYOUTS } from './config-memory.mjs';
import { NATIVE_STARTUP_BLOCKS, runNativeGameWinMainSpan } from './engine-startup-block.mjs';

const layouts = {
  'sdk-4.01-engine-2.6.1.74': [0x5bf330, 0x5bf3c0, 0xaff2c8, 0x47ee90, 0x5bf400],
  'nekopara-vol3-engine-2.6.1.76': [0x70df70, 0x70e000, 0x9e3230, 0x5ac260, 0x70e050],
};

// WinMain consults the active Settings after translating the resource.
const optionalCommands = {
  'sdk-4.01-engine-2.6.1.74': [
    [46104, 118],
    [47368, 40034],
  ],
  'nekopara-vol3-engine-2.6.1.76': [
    [47924, 118],
    [50032, 40034],
    [57540, 40063],
  ],
};

// The game builds all three language groups from its original Settings.
function runGameLanguageMenu(engine, remove) {
  const wsprintf = engine.process.load(0x8c64dc);
  return runNativeGameWinMainSpan(engine, 0x52c72f, 0x52ccfe, (_stack, cpu, uc) => {
    cpu.reg_write_i32(uc.X86_REG_ESI, remove);
    cpu.reg_write_i32(uc.X86_REG_EDI, wsprintf);
  });
}

export async function initializeNativeStartupMenu(engine) {
  const p = engine.process,
    block = NATIVE_STARTUP_BLOCKS[engine.profile],
    slot = block + 36,
    [construct, load, vtable, localize, bind] = layouts[engine.profile],
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
    const handle = p.load(owner + 8);
    await engine.call(localize, [], handle);
    if ((await engine.call(bind, [block], owner)) !== block)
      throw new Error('Original menu did not retain its startup block');
    const remove = engine.kernel.resolve({ dll: 'USER32.dll', name: 'DeleteMenu' });
    for (const [offset, id] of optionalCommands[engine.profile])
      if (!p.load(engine.refs.settings + offset)) await engine.call(remove, [handle, id, 0]);
    if (engine.profile === 'nekopara-vol3-engine-2.6.1.76')
      await runGameLanguageMenu(engine, remove);
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
