// SPDX-License-Identifier: MPL-2.0
// File enumeration matches long names and any short name supplied by the mount.
// The fixed reference host treats trailing dots and a final .* specially.
export function nativeFilePattern(pattern, name, shortName = '') {
  const mask = pattern.toUpperCase().replace(/\.+$/, ''),
    match = (value) => {
      value = value.toUpperCase();
      // These star/question-mark combinations have no match in the pinned
      // FindFirstFile reference, including when a short name is available.
      if (/\*\?/.test(mask)) return false;
      const memo = new Map(),
        scan = (at, index) => {
          const key = `${at}:${index}`;
          if (memo.has(key)) return memo.get(key);
          let result;
          if (at === mask.length) result = index === value.length;
          else if (mask[at] === '*')
            result = scan(at + 1, index) || (index < value.length && scan(at, index + 1));
          else if (mask.slice(at) === '.*' && index === value.length) result = true;
          else
            result =
              index < value.length &&
              (mask[at] === '?' || mask[at] === value[index]) &&
              scan(at + 1, index + 1);
          memo.set(key, result);
          return result;
        };
      return scan(0, 0);
    };
  return match(name) || Boolean(shortName && match(shortName));
}
