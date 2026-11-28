import { Binary } from '../src/binary.mjs';
// SPDX-License-Identifier: MPL-2.0
import { queryVersionResource } from '../src/native/windows-version.mjs';
import { readPEVersionResource } from '../src/native/profile.mjs';
import { windowsWideCharToMultiByte } from './ppi-windows-widechar.mjs';
export function installNativeVersionAPIs(kernel, imageName, versionResource) {
  const p = kernel.process,
    image = imageName.replaceAll('\\', '/').toLowerCase(),
    error = (code) => {
      kernel.lastError = code;
      return 0;
    };
  async function resource(name, wide) {
    if (!name) return error(87);
    const file = p.string(name, wide);
    if (!file) return error(161);
    const path = kernel.path(file);
    if (path.toLowerCase() === image) return versionResource ?? error(1812);
    const bytes = await kernel.read(path);
    if (!bytes) return error(2);
    try {
      return readPEVersionResource(bytes) ?? error(1812);
    } catch {
      return error(1812);
    }
  }
  for (const suffix of ['A', 'W']) {
    const wide = suffix === 'W',
      register = (name, count, fn) => kernel.register('version.dll', name + suffix, { count, fn });
    register('GetFileVersionInfoSize', 2, async ([name, handle]) => {
      if (handle) p.store(handle, 0);
      const block = await resource(name, wide);
      if (!block) return 0;
      kernel.lastError = 0;
      return block.length * 2 + 4;
    });
    register('GetFileVersionInfo', 4, async ([name, , size, out]) => {
      if (!out) return error(13);
      const block = await resource(name, wide);
      if (!block) return 0;
      const length = new Binary(block, 'Win32 version resource').u16(0);
      const copy = block.subarray(0, size);
      if (copy.length) p.write(out, copy);
      if (size >= length + 4) p.store(out + length, 0x58324546); // FE2X
      kernel.lastError = 0;
      return 1;
    });
    register('VerQueryValue', 4, ([block, subBlock, out, countOut]) => {
      if (!block) return 0;
      if (!out) return error(87);
      const header = new Binary(p.read(block, 2), 'Win32 version header'),
        length = header.u16(0),
        value = queryVersionResource(
          p.read(block, length),
          subBlock ? p.string(subBlock, wide) : '',
        );
      if (!value) {
        if (countOut) p.store(countOut, 0);
        return error(1813);
      }
      let pointer = block + value.offset,
        count = value.count;
      if (!wide && value.text) {
        const ansi = pointer + length + 4;
        count = windowsWideCharToMultiByte(kernel, [
          0,
          0,
          pointer,
          count,
          ansi,
          length - value.offset,
          0,
          0,
        ]);
        pointer = ansi;
      }
      p.store(out, pointer);
      if (countOut) p.store(countOut, count);
      return 1;
    });
  }
}
