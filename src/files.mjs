// SPDX-License-Identifier: MPL-2.0
import { Binary, decodeText, boundedCount } from './binary.mjs';
import { sourceIdentity } from './identity.mjs';

export class HTTPFile {
  constructor(url, size) {
    this.url = url;
    this.size = size;
  }
  async read(at, count) {
    if (at < 0 || count < 0 || at + count > this.size) throw new Error('File read out of bounds');
    if (!count) return new Uint8Array();
    const response = await fetch(this.url, { headers: { Range: `bytes=${at}-${at + count - 1}` } });
    if (
      response.status !== 206 ||
      response.headers.get('content-range') !== `bytes ${at}-${at + count - 1}/${this.size}`
    )
      throw new Error(`${this.url}: server must support exact HTTP byte ranges`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== count) throw new Error(`${this.url}: truncated range`);
    return bytes;
  }
}

export class BlobFile {
  constructor(blob) {
    this.blob = blob;
    this.size = blob.size;
  }
  async read(at, count) {
    if (at < 0 || count < 0 || at + count > this.size) throw new Error('File read out of bounds');
    return new Uint8Array(await this.blob.slice(at, at + count).arrayBuffer());
  }
}

export class KIFArchive {
  static async open(file, name) {
    const header = new Binary(await file.read(0, 8), name);
    if (!header.magic('KIF\0')) throw new Error(`${name}: expected KIF archive`);
    const count = boundedCount(header.u32(4), 100000, 'KIF entries');
    const table = new Binary(await file.read(8, count * 72), name);
    const archive = new KIFArchive();
    archive.file = file;
    archive.name = name;
    archive.entries = [];
    for (let i = 0; i < count; i++) {
      const at = i * 72,
        entry = { name: table.str(at, 64), offset: table.u32(at + 64), size: table.u32(at + 68) };
      if (entry.name === '__key__.dat')
        throw new Error(`${name}: encrypted KIF; use a prepared/decrypted game directory`);
      if (entry.offset < 8 + count * 72 || entry.offset + entry.size > file.size)
        throw new Error(`${name}: invalid entry ${i}`);
      archive.entries.push(entry);
    }
    return archive;
  }
  async read(entry) {
    return this.file.read(entry.offset, entry.size);
  }
}

// All inputs are read-only. Archive payloads are fetched on demand, never preloaded as one game-sized buffer.
export class GameFiles {
  constructor(files) {
    this.input = files;
    this.index = new Map();
    this.width = 1280;
    this.height = 720;
    this.title = 'CatSystem2';
  }
  static async fromHTTP(manifestURL) {
    const response = await fetch(manifestURL);
    if (!response.ok) throw new Error(`Game manifest: HTTP ${response.status}`);
    const manifest = await response.json(),
      base = new URL(manifestURL, location.href);
    const files = new Map(
      manifest.files.map((f) => [f.path, new HTTPFile(new URL(f.url, base).href, f.size)]),
    );
    const game = new GameFiles(files);
    if (/^[0-9a-f]{64}$/.test(manifest.identity || '')) game.identity = manifest.identity;
    game.media = Object.fromEntries(
      Object.entries(manifest.media || {}).map(([name, url]) => [name, new URL(url, base).href]),
    );
    await game.open();
    return game;
  }
  static async fromFileList(files) {
    const list = Array.from(files),
      prefix = list[0]?.webkitRelativePath.split('/')[0] + '/';
    const game = new GameFiles(
      new Map(
        list.map((f) => [
          (f.webkitRelativePath || f.name).replace(new RegExp(`^${escapeRegExp(prefix)}`), ''),
          new BlobFile(f),
        ]),
      ),
    );
    await game.open();
    return game;
  }
  async open() {
    const ordered = [...this.input].sort(([a], [b]) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    this.archives = [];
    for (const [path, file] of ordered.filter(([p]) => /\.int$/i.test(p))) {
      const archive = await KIFArchive.open(file, path);
      this.archives.push(archive);
      const patch = /(^|\/)patch\//i.test(path);
      for (const entry of archive.entries) {
        const key = entry.name.toLowerCase();
        if (patch || !this.index.has(key))
          this.index.set(key, { file: archive.file, offset: entry.offset, size: entry.size, path });
      }
    }
    // Loose patch files override archives; base loose files supply startup.xml, fonts, etc.
    for (const [path, file] of ordered.sort(
      ([a], [b]) => Number(/(^|\/)patch\//i.test(a)) - Number(/(^|\/)patch\//i.test(b)),
    )) {
      if (/\.int$/i.test(path)) continue;
      const key = path.split('/').pop().toLowerCase();
      if (!this.index.has(key) || /(^|\/)patch\//i.test(path))
        this.index.set(key, { file, offset: 0, size: file.size, path });
    }
    if (!this.archives.length && !this.index.has('main.kcs'))
      throw new Error('No CatSystem2 archives or scripts found');
    const startup = await this.read('startup.xml');
    if (startup) {
      const xml = decodeText(startup),
        tag = (name) => xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i'))?.[1];
      this.width = Number(tag('width')) || 1280;
      this.height = Number(tag('height')) || 720;
      this.title = tag('title') || this.title;
    }
  }
  has(name) {
    return this.index.has(name.toLowerCase().split('/').pop());
  }
  names(extension) {
    return [...this.index.keys()].filter((n) => n.endsWith(`.${extension}`));
  }
  async read(name) {
    const hit = this.index.get(name.toLowerCase().split('/').pop());
    return hit ? hit.file.read(hit.offset, hit.size) : null;
  }
  async require(name) {
    const bytes = await this.read(name);
    if (!bytes) throw new Error(`Missing resource: ${name}`);
    return bytes;
  }
  resolve(name, extensions) {
    if (this.has(name)) return name;
    return extensions.map((e) => `${name}.${e}`).find((n) => this.has(n));
  }
  async fingerprint() {
    if (this.identity) return this.identity;
    this.identityPromise ||= sourceIdentity(this.input);
    this.identity = await this.identityPromise;
    return this.identity;
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
