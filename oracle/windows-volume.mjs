// SPDX-License-Identifier: MPL-2.0
// The mounted game and Windows folders belong to one virtual C: volume.
const FILE_SYSTEM = 'CatVFS';
const SERIAL = 0x43533200;
const MAX_COMPONENT = 255;
const FLAGS = 0x02 | 0x04; // FILE_CASE_PRESERVED_NAMES | FILE_UNICODE_ON_DISK

export function installNativeVolumeInformation(kernel) {
  const p = kernel.process,
    fail = (error) => {
      kernel.lastError = error;
      return 0;
    };
  for (const suffix of ['A', 'W']) {
    const wide = suffix === 'W';
    kernel.register('KERNEL32.dll', 'GetVolumeInformation' + suffix, {
      count: 8,
      fn: ([root, label, labelSize, serial, maxComponent, flags, fs, fsSize]) => {
        if (root) {
          const path = p
            .string(root, wide)
            .replaceAll('/', '\\')
            .replace(/^\\\\\?\\/, '');
          if (!path || /^[a-bd-z]:/i.test(path)) return fail(3); // ERROR_PATH_NOT_FOUND
          if (/^c:\\/i.test(path) && path.length > 3) return fail(144); // ERROR_DIR_NOT_ROOT
          if (!/^c:\\$/i.test(path)) return fail(123); // ERROR_INVALID_NAME
        }
        if (label && !labelSize) return fail(24); // ERROR_BAD_LENGTH
        if (wide && label) p.zero(label, 2);
        if (serial) p.store(serial, SERIAL);
        if (fs && fsSize <= FILE_SYSTEM.length) return fail(24);
        if (!wide && label) p.zero(label, 1);
        if (fs) kernel.writeString(fs, FILE_SYSTEM, wide);
        if (maxComponent) p.store(maxComponent, MAX_COMPONENT);
        if (flags) p.store(flags, FLAGS);
        return 1;
      },
    });
  }
}
