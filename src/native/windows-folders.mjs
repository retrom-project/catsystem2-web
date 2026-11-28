// SPDX-License-Identifier: MPL-2.0
// CatSystem's folder selectors resolve inside the per-game virtual drive.
const ROOT = '@cat/user';
export function isNativeUserPath(path) {
  const key = path.toLowerCase();
  return key === ROOT || key.startsWith(ROOT + '/');
}
