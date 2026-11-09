// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// The original lookup helpers require their static tree even with no files.
const LANGUAGE = {
  'sdk-4.01-engine-2.6.1.74': {
    global: 0xcc2bf8,
    constructHead: 0x47dbb0,
    size: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.languageBank.size,
    load: 0x47e690,
    destroy: 0x98cf90,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    global: 0xbc3880,
    constructHead: 0x5ad7a0,
    size: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.languageBank.size,
    destroy: 0x8c1050,
  },
};

export async function initializeNativeLanguage(engine) {
  const layout = LANGUAGE[engine.profile];
  const p = engine.process;
  if (p.load(layout.global)) throw new Error('Original language table already has an owner');
  // Use the same sentinel constructor as the original static initializer.
  // The engine process owns its teardown instead of registering CRT atexit.
  const head = p.call(layout.constructHead, [], layout.global);
  if (p.allocations.get(head) !== layout.size)
    throw new Error('Original language sentinel was not allocated');
  p.store(layout.global, head);
  // SDK WinMain loads language.txt before constructing the Engine owner.
  const loaded = layout.load ? await p.callAsync(layout.load) : 0;
  if ((loaded !== 0 && loaded !== 1) || p.load(layout.global) !== head)
    throw new Error('Original language loader lost its table');
  engine.refs.startupLanguage = { head, loaded: Boolean(loaded) };
}

// The original line loader recomputes strlen of the remaining catalogue at
// every line. Its input is one unchanged new[] buffer. Keep the original
// splitting, allocation and parser, and reuse the already located terminator.
function observeCatalogueTerminator(p) {
  let start = 0,
    end = 0;
  return p.beforeInstruction(0x787840, 'original language catalogue length scan', () => {
    const { cpu, uc } = p,
      address = cpu.reg_read_i32(uc.X86_REG_ECX) >>> 0;
    if (address < start || address > end || !end) {
      const size = p.allocations.get(address);
      if (!size) return;
      for (let at = 0; at < size; at += 65536) {
        const found = p.read(address + at, Math.min(size - at, 65536)).indexOf(0);
        if (found < 0) continue;
        start = address;
        end = address + at + found;
        break;
      }
      if (start !== address) return;
    }
    // At the next native instruction ECX points past the terminator and AL
    // contains the terminating zero. The original SUB sets the final flags.
    cpu.reg_write_i32(uc.X86_REG_ECX, end + 1);
    cpu.reg_write_i32(uc.X86_REG_EAX, cpu.reg_read_i32(uc.X86_REG_EAX) & ~255);
    cpu.reg_write_i32(uc.X86_REG_EIP, 0x787847);
  });
}

export async function loadNativeGameStartupLanguage(engine) {
  const layout = LANGUAGE[engine.profile],
    p = engine.process,
    state = engine.refs.startupLanguage;
  if (
    !nativeABI(engine.profile).language.switchWindowProtocol ||
    !state ||
    p.load(layout.global) !== state.head ||
    state.filename !== undefined
  )
    throw new Error('Original game startup language has no unloaded catalogue owner');
  const buffers = p.allocate(3 * 520 + 2048, true),
    filename = buffers + 3 * 520;
  try {
    // WinMain asks the Settings owner for the selected UI, main and sub
    // language codes, then builds the UI catalogue path with wsprintfW.
    await p.callAsync(0x7137d0, [buffers, buffers + 520, buffers + 1040], engine.refs.owner);
    p.call(p.load(0x8c64dc), [filename, 0x9e3000, buffers]);
    const name = p.string(filename, true),
      detach = observeCatalogueTerminator(p);
    try {
      p.cpu.reg_write_i32(p.uc.X86_REG_EDX, filename);
      const loaded = await p.callAsync(0x5ab510, [], 0);
      if ((loaded !== 0 && loaded !== 1) || p.load(layout.global) !== state.head)
        throw new Error('Original game language loader lost its table');
      Object.assign(state, { filename: name, loaded: Boolean(loaded) });
    } finally {
      detach();
    }
  } finally {
    p.free(buffers);
  }
}

export function releaseNativeLanguage(engine) {
  const state = engine.refs.startupLanguage;
  if (!state) return;
  const layout = LANGUAGE[engine.profile],
    p = engine.process;
  if (p.load(layout.global) !== state.head)
    throw new Error('Original language table has inconsistent ownership');
  p.call(layout.destroy);
  if (p.allocations.has(state.head)) throw new Error('Original language table was not released');
  p.store(layout.global, 0);
  delete engine.refs.startupLanguage;
}
