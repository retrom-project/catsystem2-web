// SPDX-License-Identifier: MPL-2.0
// The original CRT obtains SystemFunction036 through LoadLibrary/GetProcAddress.
export function installNativeEntropy(kernel, fill = (bytes) => crypto.getRandomValues(bytes)) {
  const p = kernel.process,
    SystemFunction036 = kernel.register('ADVAPI32.dll', 'SystemFunction036', {
      count: 2,
      fn: ([out, size]) => {
        if (!size) return 1;
        if (!out || out + size > 0x100000000) return 0;
        const chunk = new Uint8Array(Math.min(size, 65536));
        for (let at = 0; at < size; at += chunk.length) {
          const bytes = chunk.subarray(0, Math.min(size - at, chunk.length));
          fill(bytes);
          p.write(out + at, bytes);
        }
        return 1;
      },
    });
  kernel.registerHostModule('advapi32.dll', { SystemFunction036 });
}
