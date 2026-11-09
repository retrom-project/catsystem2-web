// SPDX-License-Identifier: MPL-2.0
// The ECX argument passed by each WinMain to its startup helper. This static
// record owns window startup state independently of the allocated Engine.
export const NATIVE_STARTUP_BLOCKS = Object.freeze({
  'sdk-4.01-engine-2.6.1.74': 0xcb2440,
  'nekopara-vol3-engine-2.6.1.76': 0xbafa80,
});

// A bounded block of the game WinMain shares its aligned 0x6270-byte
// scratch frame. Neither entry nor exit runs the enclosing message loop.
export function runNativeGameWinMainSpan(engine, first, after, prepare) {
  return runNativeStackSpan(engine, first, after, 0x6270, prepare);
}

export async function runNativeStackSpan(engine, first, after, frameSize, prepare) {
  const p = engine.process,
    { cpu, uc } = p,
    registers = [uc.X86_REG_ESP, uc.X86_REG_EBX, uc.X86_REG_ESI, uc.X86_REG_EDI],
    label = `engine span ${first.toString(16)}`;
  let caller,
    finished = false;
  const enter = p.beforeInstruction(first, `${label} entry`, () => {
    if (caller) throw new Error(`Original ${label} entered twice`);
    caller = registers.map((id) => cpu.reg_read_i32(id));
    const stack = (((caller[0] >>> 0) - frameSize) & ~7) >>> 0;
    if (stack < p.stackBottom + 0x1000)
      throw new Error(`Original ${label} exhausted its guest stack`);
    p.zero(stack, frameSize);
    cpu.reg_write_i32(uc.X86_REG_ESP, stack);
    prepare(stack, cpu, uc);
  });
  try {
    const leave = p.beforeInstruction(after, `${label} exit`, () => {
      registers.forEach((id, i) => cpu.reg_write_i32(id, caller[i]));
      finished = true;
      cpu.reg_write_i32(uc.X86_REG_EIP, p.sentinel);
    });
    try {
      await engine.call(first);
      if (!finished) throw new Error(`Original ${label} did not reach its exit boundary`);
    } finally {
      leave();
    }
  } finally {
    enter();
  }
}
