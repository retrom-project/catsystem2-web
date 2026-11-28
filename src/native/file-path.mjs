// SPDX-License-Identifier: MPL-2.0
// Paths resolve inside the mounted per-game virtual drive.
export function nativeVirtualFilePath(value, cwd = '') {
  let path = value.replaceAll('\\', '/');
  if (/^c:\/catsystem2-web(?:\/|$)/i.test(path)) path = path.replace(/^c:\/catsystem2-web\/?/i, '');
  // A single root separator selects the current virtual drive's root.
  else if (path.startsWith('/') && !path.startsWith('//')) path = path.slice(1);
  else if (/^[a-z]:|^\/\//i.test(path)) return path;
  else if (cwd) path = cwd + '/' + path;
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Native file path escaped the mounted directory');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}
