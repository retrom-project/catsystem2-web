// SPDX-License-Identifier: MPL-2.0
// Shared packet entry boundary for remaining executable consumers.
export function conditionalNativeGraphicsBoundary(engine, address, name, count, accepts, callback) {
  const p = engine.process,
    boundary = { trap: p.trap(name, count, callback) };
  boundary.detach = p.beforeInstruction(address, name, () => {
    const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
      args = Array.from({ length: count }, (_, i) => p.load(sp + 4 + i * 4));
    if (accepts(args)) p.cpu.reg_write_i32(p.uc.X86_REG_EIP, boundary.trap);
  });
  return boundary;
}
