// SPDX-License-Identifier: MPL-2.0
// The guest calibrates its TSC over a quarter second. During the calibration
// only, advance both counters together without blocking the browser.
const TSC_TICKS_PER_MICROSECOND = 2000n;
const CALIBRATION_STEP = 62500n;
const TSC_ORIGIN = 1n << 36n;

export async function constructNativeSystemSurvey(engine, layout, pointer) {
  const { kernel, process: p } = engine,
    { cpu, uc } = p,
    { counterReturns, afterTSC } = layout.cpu,
    originalCounter = kernel.definitions.get('QueryPerformanceCounter');
  let elapsed = -CALIBRATION_STEP,
    active = true;
  engine.registerWindows('KERNEL32.dll', 'QueryPerformanceCounter', {
    count: 1,
    fn: (args) => {
      if (active && counterReturns.includes(p.load(cpu.reg_read_i32(uc.X86_REG_ESP) >>> 0))) {
        elapsed += CALIBRATION_STEP;
        kernel.write64(args[0], elapsed);
        return 1;
      }
      return originalCounter.fn(args);
    },
  });
  const detach = [];
  try {
    for (const address of afterTSC) {
      const instruction = p.read(address - 2, 2);
      if (instruction[0] !== 0x0f || instruction[1] !== 0x31)
        throw new Error('Original startup TSC instruction changed');
      detach.push(
        p.beforeInstruction(address, 'virtual TSC during the original CPU survey', () => {
          if (elapsed < 0n) throw new Error('Original CPU survey did not sample its clock');
          const ticks = TSC_ORIGIN + elapsed * TSC_TICKS_PER_MICROSECOND;
          cpu.reg_write_i32(uc.X86_REG_EAX, Number(BigInt.asIntN(32, ticks)));
          cpu.reg_write_i32(uc.X86_REG_EDX, Number(BigInt.asIntN(32, ticks >> 32n)));
        }),
      );
    }
    return await p.callAsync(layout.construct, [0x7f, 1], pointer);
  } finally {
    active = false;
    for (const remove of detach) remove();
  }
}
