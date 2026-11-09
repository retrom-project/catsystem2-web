// SPDX-License-Identifier: MPL-2.0
// Win32 INI string reads on the mounted virtual drive, including OEM data.
import { encodeCP932 } from '../kcs/strings.mjs';

function parseProfile(bytes) {
  const sections = new Map();
  if (!bytes) return sections;
  const bom = (bytes[0] << 8) | bytes[1],
    encoding = bom === 0xfffe ? 'utf-16le' : bom === 0xfeff ? 'utf-16be' : 'shift_jis';
  let section;
  for (const raw of new TextDecoder(encoding).decode(bytes).split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      const name = header[1].trim(),
        key = name.toLowerCase();
      if (!sections.has(key)) sections.set(key, { name, entries: new Map() });
      section = sections.get(key);
      continue;
    }
    const equals = line.indexOf('=');
    if (!section || equals <= 0) continue;
    const name = line.slice(0, equals).trimEnd(),
      key = name.toLowerCase();
    if (section.entries.has(key)) continue;
    let value = line.slice(equals + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0]))
      value = value.slice(1, -1);
    section.entries.set(key, { name, value });
  }
  return sections;
}

export function installNativeProfileStrings(kernel) {
  const p = kernel.process;
  for (const [suffix, wide] of [
    ['A', false],
    ['W', true],
  ]) {
    kernel.register('KERNEL32.dll', `GetPrivateProfileString${suffix}`, {
      count: 6,
      async fn([sectionPtr, keyPtr, defaultPtr, out, capacity, filename]) {
        if (!out || !capacity) return 0;
        const section = sectionPtr && p.string(sectionPtr, wide).toLowerCase(),
          key = keyPtr && p.string(keyPtr, wide).toLowerCase(),
          name = filename ? p.string(filename, wide) : 'win.ini',
          path = kernel.path(
            /^(?:[a-z]:|[\\/])/i.test(name) ? name : `C:\\catsystem2-web\\@cat\\windows\\${name}`,
          ),
          bytes = kernel.readFile || kernel.fileProviders.size ? await kernel.read(path) : null,
          sections = parseProfile(bytes),
          entries = sections.get(section)?.entries,
          list = !sectionPtr || !keyPtr,
          names = list
            ? [...(sectionPtr ? (entries?.values() ?? []) : sections.values())].map(
                (item) => item.name,
              )
            : [],
          text = list
            ? names.length
              ? names.join('\0') + '\0'
              : ''
            : (entries?.get(key)?.value ??
              (defaultPtr ? p.string(defaultPtr, wide).trimEnd() : '')),
          unit = wide ? 2 : 1,
          encoded = wide ? null : encodeCP932(text),
          length = wide ? text.length : encoded.length,
          terminators = list && (!length || length >= capacity) ? Math.min(2, capacity) : 1;
        let copied = Math.min(length, capacity - terminators);
        if (wide) {
          kernel.writeString(out, text.slice(0, copied), true);
        } else {
          // Keep a Shift-JIS lead byte and its trail together for scalar reads.
          if (!list && copied < length)
            for (let i = 0; i < copied; i++)
              if ((encoded[i] >= 0x81 && encoded[i] <= 0x9f) || encoded[i] >= 0xe0) {
                if (i === copied - 1) copied--;
                i++;
              }
          p.write(out, encoded.subarray(0, copied));
        }
        p.zero(out + copied * unit, terminators * unit);
        if (!bytes) kernel.lastError = 2;
        return copied;
      },
    });
  }
}
