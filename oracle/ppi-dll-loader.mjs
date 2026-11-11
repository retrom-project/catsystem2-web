// SPDX-License-Identifier: MPL-2.0
// Existing DLL mapping is available only to explicitly imported oracle code.
import { parsePE32 } from '../src/ppi/pe32.mjs';
export function loadOracleDLL(process, bytes, resolveImport, name = 'particle.ppi') {
  const pe = parsePE32(bytes);
  let base = pe.base;
  while (
    process.regions.some((r) => base < r.address + r.size && base + pe.image.length > r.address)
  )
    base = (base + 0x1000000) >>> 0;
  if (base !== pe.base && !pe.relocations.length)
    throw new Error('PPI cannot relocate into available guest address space');
  const v = new DataView(pe.image.buffer),
    delta = base - pe.base;
  for (const offset of pe.relocations) v.setUint32(offset, v.getUint32(offset, true) + delta, true);
  process.map(base, pe.image.length);
  for (const symbol of pe.imports)
    v.setUint32(symbol.address, resolveImport(symbol, process), true);
  process.write(base, pe.image);
  const module = {
    name,
    base,
    pe,
    export: (symbol) => {
      const entry = pe.exports.get(typeof symbol === 'string' ? pe.names.get(symbol) : symbol);
      if (!entry || entry.forward)
        throw new Error(
          `PPI export ${symbol} unavailable${entry?.forward ? ': ' + entry.forward : ''}`,
        );
      return base + entry.address;
    },
  };
  process.modules.push(module);
  return module;
}
