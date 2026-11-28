// SPDX-License-Identifier: MPL-2.0
// Existing bounded HG3 vertical delta boundary for FES task/image producers.
// Its original decoder owns inflation, sparse runs, the first row and metadata.
// Script images and particle/PPI atlases decode in JS; remove this in phase 7.
const sites = {
  'sdk-4.01-engine-2.6.1.74': 0x5733e4,
  'nekopara-vol3-engine-2.6.1.76': 0x6a1ff4,
};
const instructions = Uint8Array.from(
  '8b54245c85d2741d8d6424000fb6038d4901438a44307802440fff8841ff4a75eb8b4424188b542424402bef894424188bcd3b42047cc9'.match(
    /../g,
  ),
  (hex) => parseInt(hex, 16),
);
const overlaps = (start, size, other, length) => start < other + length && other < start + size;

export const nativeHG3DecodeContext = () => ({ hg3DeltaBytes: 64 * 1024 * 1024 });

function mapped(regions, at, size, write = false) {
  return (
    at >= 0 &&
    size > 0 &&
    at + size <= 0x100000000 &&
    regions.some(
      ({ begin, end, perms }) =>
        at >= Number(begin) &&
        at + size - 1 <= Number(end) &&
        (perms & 1) !== 0 &&
        (!write || (perms & 6) === 2),
    )
  );
}

export function installNativeHG3Delta(engine) {
  const p = engine.process,
    site = sites[engine.profile],
    matches = () => p.read(site, instructions.length).every((byte, i) => byte === instructions[i]);
  if (!site || !matches()) throw new Error('Reviewed HG3 vertical delta loop differs');
  const register = (name, value) => {
    const reg = p.uc[`X86_REG_${name}`];
    if (value === undefined) return p.cpu.reg_read_i32(reg) >>> 0;
    p.cpu.reg_write_i32(reg, value >>> 0);
  };

  return p.beforeInstruction(site, 'bulk HG3 vertical delta rows', () => {
    const allowance = engine.currentMessageContext;
    if (!(allowance?.hg3DeltaBytes > 0) || register('EFLAGS') & 0x10100) return;
    const sp = register('ESP'),
      object = register('ESI'),
      section = register('EDX'),
      row = register('EAX'),
      pitch = register('EDI'),
      target = register('EBP'),
      source = register('EBX'),
      regions = p.cpu.mem_regions();
    if (
      !pitch ||
      row === 0 ||
      register('ECX') !== target ||
      !mapped(regions, sp, 0x60) ||
      !mapped(regions, object, 0x178) ||
      !mapped(regions, section, 8) ||
      p.load(sp + 0x18) !== row ||
      p.load(sp + 0x24) !== section ||
      p.load(sp + 0x5c) !== pitch ||
      p.load(object + 20) !== pitch
    )
      return;
    const startRow = p.load(section),
      end = p.load(section + 4),
      height = p.load(object + 8),
      data = p.load(object + 12),
      imageSize = p.load(object + 16),
      rows = end - row - 1,
      bytes = rows * pitch,
      first = target - (rows - 1) * pitch,
      size = bytes + pitch,
      table = object + 0x78,
      rowWord = sp + 0x18;
    if (
      rows < 1 ||
      bytes < 8192 ||
      bytes > allowance.hg3DeltaBytes ||
      startRow + end > height ||
      imageSize !== pitch * height ||
      (p.allocations.get(data - 4) ?? 0) < imageSize + 4 ||
      target !== data + (height - startRow - row - 1) * pitch ||
      !mapped(regions, source, bytes) ||
      !mapped(regions, first, size, true) ||
      !mapped(regions, rowWord, 4, true) ||
      overlaps(first, size, source, bytes) ||
      overlaps(first, size, object, 0x178) ||
      overlaps(first, size, section, 8) ||
      overlaps(first, size, sp, 0x60) ||
      overlaps(source, bytes, rowWord, 4) ||
      [...p.writeObservers].some(
        ({ address, end }) =>
          overlaps(first, size, address, end - address) ||
          overlaps(rowWord, 4, address, end - address),
      ) ||
      [...p.executionBoundaries.keys()].some(
        (address) => address > site && address < site + instructions.length,
      ) ||
      !matches()
    )
      return;
    const { active, limit, counter } = p.instructionBudget();
    // The last row executes in x86, including its register/flags epilogue.
    // Count the substituted work in bytes and leave the native cap unchanged.
    if (!active || (limit && limit - counter < BigInt(11 + pitch * 8))) return;
    let input, output, lookup;
    try {
      input = p.view(source, bytes);
      output = p.view(first, size);
      lookup = p.view(table, 256);
    } catch {
      return;
    }
    allowance.hg3DeltaBytes -= bytes;
    for (let dst = bytes - pitch, src = 0; dst >= 0; dst -= pitch)
      for (let x = 0; x < pitch; x++)
        output[dst + x] = lookup[input[src++]] + output[dst + pitch + x];
    const last = target - bytes;
    p.store(rowWord, end - 1);
    register('EAX', end - 1);
    register('EBX', source + bytes);
    register('EBP', last);
    register('ECX', last);
  });
}
