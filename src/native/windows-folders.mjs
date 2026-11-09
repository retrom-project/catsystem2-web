// SPDX-License-Identifier: MPL-2.0
// CatSystem's folder selectors resolve inside the per-game virtual drive.
const ROOT = '@cat/user';
const WINDOWS = '@cat/windows';
export function isNativeUserPath(path) {
  const key = path.toLowerCase();
  return key === ROOT || key.startsWith(ROOT + '/');
}
const FOLDERS = new Map([
  [0x02, 'Profile/Start Menu/Programs'],
  [0x05, 'Profile/Documents'],
  [0x0b, 'Profile/Start Menu'],
  [0x10, 'Profile/Desktop'],
  [0x17, 'Public/Start Menu/Programs'],
  [0x19, 'Public/Desktop'],
  [0x1a, 'Profile/AppData/Roaming'],
  [0x23, 'Public/ProgramData'],
  [0x26, 'Program Files'],
  [0x27, 'Profile/Pictures'],
]);

export function installNativeKnownFolders(kernel) {
  const process = kernel.process;
  kernel.directories.add(WINDOWS);
  kernel.directories.add(WINDOWS + '/system32');
  for (const folder of FOLDERS.values()) {
    let path = '';
    for (const part of `${ROOT}/${folder}`.toLowerCase().split('/')) {
      path += path ? `/${part}` : part;
      if (isNativeUserPath(path)) kernel.directories.add(path);
    }
  }
  for (const suffix of ['A', 'W']) {
    const wide = suffix === 'W',
      write = (id, token, type, out) => {
        if (out) process.zero(out, wide ? 2 : 1);
        const folder = FOLDERS.get(id & 0xff);
        // This environment has one user and its folders are already present.
        // CURRENT and DEFAULT resolve identically, including CREATE or
        // DONT_VERIFY. Additional tokens and folder classes are unavailable.
        if (!out || !folder || token || type > 1 || id & ~0xc0ff) return 0x80070057;
        kernel.writeString(
          out,
          `C:\\catsystem2-web\\${ROOT}/${folder}`.replaceAll('/', '\\'),
          wide,
        );
        return 0;
      };
    for (const [name, directory] of [
      ['GetWindowsDirectory', WINDOWS],
      ['GetSystemDirectory', WINDOWS + '/System32'],
    ]) {
      const path = `C:\\catsystem2-web\\${directory.replaceAll('/', '\\')}`;
      kernel.register('KERNEL32.dll', name + suffix, {
        count: 2,
        fn: ([out, capacity]) => {
          if (capacity <= path.length) return path.length + 1;
          if (!out) {
            kernel.lastError = 87;
            return 0;
          }
          kernel.writeString(out, path, wide);
          return path.length;
        },
      });
    }
    kernel.register('SHELL32.dll', `SHGetFolderPath${suffix}`, {
      count: 5,
      fn: ([, id, token, type, out]) => write(id, token, type, out),
    });
    kernel.register('SHELL32.dll', `SHGetSpecialFolderPath${suffix}`, {
      count: 4,
      fn: ([, out, id, create]) => Number(write(id | (create ? 0x8000 : 0), 0, 0, out) === 0),
    });
  }
}
