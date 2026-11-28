// SPDX-License-Identifier: MPL-2.0
// Diagnostic identity only. This never maps or executes a plugin image, and a
// failed version read never prevents a same-name JS implementation from running.
import { VERIFIED_PPI_VERSIONS } from './verified-versions.mjs';
export function ppiName(path) {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    .toLowerCase()
    .replace(/\.ppi$/, '');
}
export function ppiVersion(bytes) {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      u16 = (at) => v.getUint16(at, true),
      u32 = (at) => v.getUint32(at, true),
      pe = u32(60),
      optional = pe + 24,
      count = u16(pe + 6),
      table = optional + u16(pe + 20);
    if (u16(0) !== 0x5a4d || u32(pe) !== 0x4550 || u16(optional) !== 0x10b || count > 96)
      return null;
    const offset = (rva) => {
      if (rva < u32(optional + 60)) return rva;
      for (let i = 0; i < count; i++) {
        const s = table + i * 40,
          start = u32(s + 12),
          size = u32(s + 16);
        if (rva >= start && rva - start < size) return u32(s + 20) + rva - start;
      }
      throw new Error('Version data is outside file sections');
    };
    const exp = offset(u32(optional + 96)),
      index = 3 - u32(exp + 16);
    if (index < 0 || index >= u32(exp + 20)) return null;
    let rva = u32(offset(u32(exp + 28)) + index * 4);
    for (let i = 0; i < 8; i++) {
      const at = offset(rva),
        op = v.getUint8(at);
      if (op === 0xb8 && v.getUint8(at + 5) === 0xc3) return u32(at + 1);
      if (op === 0xe9) rva += 5 + v.getInt32(at + 1, true);
      else if (op === 0xeb) rva += 2 + v.getInt8(at + 1);
      else return null;
    }
  } catch {
    /* Unfamiliar, absent or truncated version information is diagnostic only. */
  }
  return null;
}
export async function ppiIdentity(bytes, name, verified = []) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    sha256 = [...digest].map((n) => n.toString(16).padStart(2, '0')).join(''),
    key = ppiName(name),
    known = verified.find((entry) => entry.name === key && entry.sha256 === sha256);
  return { name: key, path: name, version: known?.version ?? ppiVersion(bytes), sha256 };
}
export function describePPI(identity) {
  const version =
    identity.version == null ? 'unknown' : `${identity.version >>> 16}.${identity.version & 65535}`;
  return `${identity.path} PPI=${version} sha256=${identity.sha256}`;
}

export class PPIRegistry {
  constructor({ implementations = {}, verified = VERIFIED_PPI_VERSIONS } = {}) {
    this.implementations = new Map(Object.entries(implementations));
    this.verified = verified;
    this.warned = new Set();
  }
  implementation(identity) {
    const implementation = this.implementations.get(identity.name);
    if (!implementation) {
      const error = new Error(
        `Unsupported PPI: ${describePPI(identity)}; no JavaScript implementation`,
      );
      error.code = 'CATSYSTEM2_PPI_UNSUPPORTED';
      error.plugin = identity;
      throw error;
    }
    return implementation;
  }
  async resolve(bytes, name, warn = (message) => console.warn(message)) {
    return this.select(await ppiIdentity(bytes, name, this.verified), warn);
  }
  select(identity, warn = (message) => console.warn(message)) {
    const implementation = this.implementation(identity),
      verified = this.verified.some(
        (entry) =>
          entry.name === identity.name &&
          entry.version === identity.version &&
          entry.sha256 === identity.sha256,
      );
    if (!verified) {
      const key = `${identity.name}/${identity.version}/${identity.sha256}`;
      if (!this.warned.has(key)) {
        this.warned.add(key);
        warn(`Unverified PPI ${describePPI(identity)}; continuing with ${implementation.name}`);
      }
    }
    return { identity, implementation };
  }
}
