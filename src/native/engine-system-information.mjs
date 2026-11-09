// SPDX-License-Identifier: MPL-2.0
// Original system-information owner. These Win32 APIs describe the virtual
// i686 process and its memory budget, independently of the browser's OS.
export const NATIVE_SYSTEM_INFORMATION = Object.freeze({
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    global: 0xc93b6c,
    size: 0x580,
    construct: 0x49fbe0,
    destroy: 0x49ffb0,
    memory: 1372,
    wide: false,
  }),
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    global: 0xb8f04c,
    size: 0xa80,
    construct: 0x5c3460,
    destroy: 0x5c3820,
    memory: 2652,
    wide: true,
  }),
});

function installSystemInformationAPIs(engine) {
  const { kernel, process: p } = engine,
    version = (out, wide) => {
      const basic = wide ? 276 : 148,
        size = out && p.load(out);
      if (size !== basic && size !== basic + 8) return false;
      p.zero(out + 4, size - 4);
      [6, 1, 7601, 2].forEach((word, i) => p.store(out + 4 + 4 * i, word));
      kernel.writeString(out + 20, 'Service Pack 1', wide);
      if (size > basic) {
        p.store(out + basic, 1); // wServicePackMajor, wServicePackMinor
        p.store(out + basic + 4, 0x10000); // wSuiteMask, wProductType, wReserved
      }
      return true;
    },
    def = (name, count, fn) => engine.registerWindows('KERNEL32.dll', name, { count, fn }),
    error = (code) => {
      kernel.lastError = code;
      return 0;
    };
  const RtlGetVersion = engine.registerWindows('NTDLL.dll', 'RtlGetVersion', {
    count: 1,
    fn: ([out]) => (version(out, true) ? 0 : 0xc000000d),
  });
  kernel.registerHostModule('ntdll.dll', { RtlGetVersion });
  for (const [suffix, wide] of [
    ['A', false],
    ['W', true],
  ])
    def(`GetVersionEx${suffix}`, 1, ([out]) => (version(out, wide) ? 1 : error(87)));
  def('IsWow64Process', 2, ([handle, out]) => {
    if (handle !== 0xffffffff) return error(6);
    if (!out) return error(87);
    p.store(out, 0);
    return 1;
  });
  def('GetProductInfo', 5, ([major, minor, , , out]) => {
    if (!out || major !== 6 || minor !== 1) return error(87);
    p.store(out, 0x30); // PRODUCT_PROFESSIONAL
    return 1;
  });
  def('GlobalMemoryStatusEx', 1, ([out]) => {
    if (!out || p.load(out) !== 64) return error(87);
    const physical = BigInt(p.regions.find((region) => region.kind === 'heap').size),
      used = [...p.allocations.values()].reduce(
        (sum, size) => sum + BigInt(Math.ceil(Math.max(16, size) / 16) * 16),
        0n,
      ),
      available = physical - used,
      userStart = 0x10000,
      userEnd = 0x7fff0000,
      virtual = BigInt(userEnd - userStart),
      mapped = p.regions.reduce(
        (sum, { address, size }) =>
          sum +
          BigInt(Math.max(0, Math.min(userEnd, address + size) - Math.max(userStart, address))),
        0n,
      );
    p.store(out + 4, Number((used * 100n) / physical));
    // The virtual Windows instance has no additional paging store.
    [physical, available, physical, available, virtual, virtual - mapped, 0n].forEach((value, i) =>
      kernel.write64(out + 8 + 8 * i, value),
    );
    return 1;
  });
}

export async function initializeNativeSystemInformation(engine) {
  const layout = NATIVE_SYSTEM_INFORMATION[engine.profile],
    p = engine.process;
  if (!layout || p.load(layout.global))
    throw new Error('Original system information already has an owner');
  installSystemInformationAPIs(engine);
  const pointer = p.allocate(layout.size, true);
  // The original flag mask includes DirectX diagnostics, sound and OEM
  // discovery. These two flags select the OS and memory queries.
  if (
    (await p.callAsync(layout.construct, [0x05, 1], pointer)) !== pointer ||
    p.load(layout.global) !== pointer
  )
    throw new Error('Original system information did not establish its singleton');
  engine.refs.systemInformation = pointer;
}

export async function releaseNativeSystemInformation(engine) {
  const pointer = engine.refs.systemInformation;
  if (!pointer) return;
  const layout = NATIVE_SYSTEM_INFORMATION[engine.profile],
    p = engine.process;
  if (p.load(layout.global) !== pointer || p.allocations.get(pointer) !== layout.size)
    throw new Error('Original system information has inconsistent ownership');
  await p.callAsync(layout.destroy, [], pointer);
  if (p.load(layout.global) || !p.free(pointer))
    throw new Error('Original system information did not release its singleton');
  delete engine.refs.systemInformation;
}
