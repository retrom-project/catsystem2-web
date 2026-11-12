// SPDX-License-Identifier: MPL-2.0
// Inspect data directories only. No native image is mapped or executed here.
import { Binary } from '../binary.mjs';
import { nativeABI } from './abi/index.mjs';
import { readEngineVersion } from './profile.mjs';
import { StartupBlowfish } from './startup-blowfish.mjs';
import { checkNativeStartupAuthor, nativeStartupCode } from './startup-author.mjs';

// Bounded lookup of a named type/name, independent of executable code sections.
export function findNativeStartupResource(bytes, type, name, language = 0) {
  const b = new Binary(bytes, 'PE startup resource');
  if (!b.magic('MZ')) return null;
  const pe = b.u32(0x3c);
  if (!b.magic('PE\0\0', pe)) throw new Error('Invalid PE signature');
  const optional = pe + 24,
    magic = b.u16(optional),
    directory = optional + (magic === 0x10b ? 96 : magic === 0x20b ? 112 : 0);
  if (directory === optional) throw new Error('Unsupported PE optional header');
  const rva = b.u32(directory + 16),
    size = b.u32(directory + 20);
  if (!rva || !size) return null;
  const sections = Array.from({ length: b.u16(pe + 6) }, (_, i) => {
    const at = optional + b.u16(pe + 20) + i * 40;
    return { rva: b.u32(at + 12), size: b.u32(at + 16), offset: b.u32(at + 20) };
  });
  const map = (address, length) => {
    const section = sections.find((s) => address >= s.rva && address + length <= s.rva + s.size);
    if (!section) throw new Error('PE resource RVA exceeds file sections');
    const at = section.offset + address - section.rva;
    b.range(at, length);
    return at;
  };
  const base = map(rva, size),
    range = (at, length) => {
      if (at < 0 || at + length > size) throw new Error('Invalid PE startup resource offset');
      return base + at;
    },
    identifier = (value) => {
      if (!(value & 0x80000000)) return value;
      const at = range(value & 0x7fffffff, 2),
        length = b.u16(at);
      return new TextDecoder('utf-16le').decode(
        b.range(range(at - base + 2, length * 2), length * 2),
      );
    };
  let offset = 0;
  for (const key of [type, name]) {
    const at = range(offset, 16),
      count = b.u16(at + 12) + b.u16(at + 14);
    range(offset + 16, count * 8);
    let target = null;
    for (let i = 0; i < count; i++) {
      const entry = at + 16 + i * 8;
      if (identifier(b.u32(entry)) === key) {
        target = b.u32(entry + 4);
        break;
      }
    }
    if (target === null) return null;
    if (!(target & 0x80000000)) throw new Error('Invalid PE startup resource nesting');
    offset = target & 0x7fffffff;
  }
  const at = range(offset, 16),
    count = b.u16(at + 12) + b.u16(at + 14);
  range(offset + 16, count * 8);
  const languages = new Map();
  for (let i = 0; i < count; i++) {
    const entry = at + 16 + i * 8,
      id = b.u32(entry),
      target = b.u32(entry + 4);
    if (target & 0x80000000) throw new Error('Invalid PE startup resource language entry');
    const data = range(target, 16),
      length = b.u32(data + 4),
      address = b.u32(data);
    languages.set(id, { size: length, read: () => b.range(map(address, length), length) });
  }
  // The existing Win32 resource service's neutral-language fallback order.
  for (const candidate of [0, language & 65535, language & 0x3ff, 0x411, 0x11, 0x409])
    if (languages.has(candidate)) return languages.get(candidate);
  return languages.values().next().value ?? null;
}

function cString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end);
}

export async function checkNativeStartupResources(world) {
  const { game, profile } = world,
    abi = nativeABI(profile),
    code = nativeStartupCode(world.startupDocument, abi.startup.verification.codeEncoding),
    author = await checkNativeStartupAuthor(world, code);
  for (const file of game.names?.('exe') ?? []) {
    const bytes = await game.require(file);
    if (readEngineVersion(bytes) !== abi.engineVersion) continue;
    const resource = (type, name) =>
        findNativeStartupResource(bytes, type, name, world.configuration.fields.uiLanguage ?? 0),
      keyResource = resource('KEY_CODE', 'KEY');
    let key = new TextEncoder().encode('open_cs2');
    if (keyResource) {
      let source;
      // Original optional-key load/size/lock failures keep the default key.
      try {
        if (keyResource.size > 0 && keyResource.size <= 512) source = keyResource.read();
      } catch {
        source = undefined;
      }
      if (source) {
        if (source.length === 512)
          throw new RangeError('Startup KEY_CODE size 512 enters the original unsafe boundary');
        const decoded = Uint8Array.from(source, (byte) => byte ^ 0xcd);
        key = cString(decoded);
      }
    }
    const cipher = new StartupBlowfish(key);
    for (const type of ['V_CODE', 'V_CODE2']) {
      const input = resource(type, 'DATA');
      if (!input) continue;
      if (!input.size) throw new Error(`${file}: ${type}/DATA startup resource has size zero`);
      let output;
      try {
        output = cipher.decryptResource(input.read());
      } catch (cause) {
        throw new Error(`${file}: ${type}/DATA startup resource read failed`, { cause });
      }
      if (type === 'V_CODE') {
        // This registered SDK wrapper unconditionally replaces the decrypted
        // comparison bytes before comparing. Game compares its actual output.
        if (abi.startup.verification.comparison === 'open-cs2-literal')
          output.set(new TextEncoder().encode('open_cs2\0'));
        const expected = cString(output);
        if (!author && (code.length !== expected.length || code.some((v, i) => v !== expected[i])))
          throw new Error(`${file}: V_CODE/DATA does not match startup v_code`);
      }
      // V_CODE2 is really read and decrypted. The prepared/decrypted JS VFS
      // has no private Settings+262 consumer, so no duplicate slot is invented.
    }
  }
}
