// SPDX-License-Identifier: MPL-2.0
import { runNativeGameWinMainSpan } from '../src/native/engine-startup-block.mjs';
export async function invokeRegion(operation, { engine }) {
  if (engine.profile !== 'nekopara-vol3-engine-2.6.1.76' || operation !== 'startup.accelerators')
    throw new Error(`Unreviewed transitional region ${operation}`);
  return runNativeGameWinMainSpan(engine, 0x52cdcb, 0x52cfed, (stack, cpu, uc) => {
    engine.process.store(stack + 0x14, engine.module.base);
    cpu.reg_write_i32(uc.X86_REG_EAX, engine.refs.settings);
    cpu.reg_write_i32(uc.X86_REG_EBX, 0);
  });
}
