// SPDX-License-Identifier: MPL-2.0
// A PPI DLL runs on the engine's calling thread. Its separate memory sandbox
// must not invent a different x87/SSE floating-point environment.
export const FLOATING_POINT_REGISTERS = [
  ['FPCW', 2],
  ['FPSW', 2],
  ['FPTAG', 2],
  ['FIP', 8],
  ['FCS', 2],
  ['FDP', 8],
  ['FDS', 2],
  ['FOP', 2],
  ['MXCSR', 4],
  ...Array.from({ length: 8 }, (_, index) => ['FP' + index, 10]),
  ...Array.from({ length: 8 }, (_, index) => ['XMM' + index, 16]),
];

export function captureFloatingPoint(process) {
  return FLOATING_POINT_REGISTERS.map(([name, size]) =>
    Uint8Array.from(process.cpu.reg_read(process.uc['X86_REG_' + name], size)),
  );
}

export function restoreFloatingPoint(process, state) {
  FLOATING_POINT_REGISTERS.forEach(([name, size], index) => {
    if (!(state[index] instanceof Uint8Array) || state[index].length !== size)
      throw new TypeError('Native floating-point state has an invalid register');
    process.cpu.reg_write(process.uc['X86_REG_' + name], state[index]);
  });
}

export function withFloatingPointThread(process, owner, callback) {
  if (!owner || owner === process) return callback();
  restoreFloatingPoint(process, captureFloatingPoint(owner));
  try {
    return callback();
  } finally {
    restoreFloatingPoint(owner, captureFloatingPoint(process));
  }
}
