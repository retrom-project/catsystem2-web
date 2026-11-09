// SPDX-License-Identifier: MPL-2.0
// The ECX argument passed by each WinMain to its startup helper. This static
// record owns window startup state independently of the allocated Engine.
export const NATIVE_STARTUP_BLOCKS = Object.freeze({
  'sdk-4.01-engine-2.6.1.74': 0xcb2440,
  'nekopara-vol3-engine-2.6.1.76': 0xbafa80,
});

// A bounded block of the game WinMain shares its aligned 0x6270-byte
// scratch frame. Neither entry nor exit runs the enclosing message loop.
export async function runNativeGameWinMainSpan(engine, first, after, prepare) {
  const p = engine.process,
    { cpu, uc } = p,
    frameSize = 0x6270,
    registers = [uc.X86_REG_ESP, uc.X86_REG_EBX, uc.X86_REG_ESI, uc.X86_REG_EDI];
  let caller,
    finished = false;
  const enter = p.beforeInstruction(first, 'WinMain span entry', () => {
    if (caller) throw new Error('Original WinMain span entered twice');
    caller = registers.map((id) => cpu.reg_read_i32(id));
    const stack = (((caller[0] >>> 0) - frameSize) & ~7) >>> 0;
    if (stack < p.stackBottom + 0x1000)
      throw new Error('Original WinMain exhausted its guest stack');
    p.zero(stack, frameSize);
    cpu.reg_write_i32(uc.X86_REG_ESP, stack);
    prepare(stack, cpu, uc);
  });
  try {
    const leave = p.beforeInstruction(after, 'WinMain span exit', () => {
      registers.forEach((id, i) => cpu.reg_write_i32(id, caller[i]));
      finished = true;
      cpu.reg_write_i32(uc.X86_REG_EIP, p.sentinel);
    });
    try {
      await engine.call(first);
      if (!finished) throw new Error('Original WinMain span did not reach its exit boundary');
    } finally {
      leave();
    }
  } finally {
    enter();
  }
}
