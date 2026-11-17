// SPDX-License-Identifier: MPL-2.0
import { findNativeFileEntries } from '../src/native/file-search.mjs';
import { nativeFileTime } from '../src/native/file-time.mjs';
export function installNativeFileSearch(kernel) {
  const p = kernel.process;
  kernel.finds = new Map();
  kernel.nextFind = 0x51000000;
  const fail = (error) => {
      kernel.lastError = error;
      return 0;
    },
    write = (out, entry, wide) => {
      p.zero(out, wide ? 592 : 320);
      p.store(out, entry.attributes ?? 0x80);
      for (const [field, offset] of [
        ['createdMs', 4],
        ['accessedMs', 12],
        ['modifiedMs', 20],
      ])
        kernel.write64(out + offset, nativeFileTime(entry[field]) ?? 0n);
      const size = BigInt(entry.size ?? 0);
      p.store(out + 28, Number(size >> 32n));
      p.store(out + 32, Number(size & 0xffffffffn));
      kernel.writeString(out + 44, entry.name, wide);
      if (entry.shortName) kernel.writeString(out + (wide ? 564 : 304), entry.shortName, wide);
    };
  for (const [suffix, wide] of [
    ['A', false],
    ['W', true],
  ]) {
    kernel.register('KERNEL32.dll', `FindFirstFile${suffix}`, {
      count: 2,
      fn: async ([name, out]) => {
        const entries = await findNativeFileEntries(kernel, p.string(name, wide));
        if (!entries.length) {
          fail(2);
          return 0xffffffff;
        }
        const handle = kernel.nextFind++;
        kernel.finds.set(handle, { entries, index: 0 });
        write(out, entries[0], wide);
        return handle;
      },
    });
    kernel.register('KERNEL32.dll', `FindNextFile${suffix}`, {
      count: 2,
      fn: ([handle, out]) => {
        const search = kernel.finds.get(handle);
        if (!search) return fail(6);
        if (search.index + 1 >= search.entries.length) return fail(18);
        write(out, search.entries[++search.index], wide);
        return 1;
      },
    });
  }
  kernel.register('KERNEL32.dll', 'FindClose', {
    count: 1,
    fn: ([handle]) => (kernel.finds.delete(handle) ? 1 : fail(6)),
  });
}
