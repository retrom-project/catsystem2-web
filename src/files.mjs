// SPDX-License-Identifier: MPL-2.0
import { Binary, decodeText, boundedCount } from './binary.mjs';
import { sourceIdentity } from './identity.mjs';
import { parseNativeXML, findNativeXML } from './native/xml.mjs';
import { parseNativeInteger } from './native/standard.mjs';
import { NativeResources } from './native/resources.mjs';
import { NativeResourceSearch, nativeUpdatePriority } from './native/resource-search.mjs';

export class HTTPFile {
  constructor(url, size, modifiedMs) {
    this.url = url;
    this.size = size;
    this.modifiedMs = modifiedMs;
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
    this.modifiedMs = blob.lastModified;
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
    this.qualifiedIndex = new Map();
    this.looseIndex = new Map();
    this.archiveIndex = new Map();
    this.archiveQualifiedIndex = new Map();
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
      manifest.files.map((f) => [
        f.path,
        new HTTPFile(new URL(f.url, base).href, f.size, f.modifiedMs),
      ]),
    );
    const game = new GameFiles(files);
    if (/^[0-9a-f]{64}$/.test(manifest.identity || '')) game.identity = manifest.identity;
    game.media = Object.fromEntries(
      Object.entries(manifest.media || {}).map(([name, record]) => {
        if (
          record.sourceIdentity !== game.identity ||
          !/^[0-9a-f]{64}$/.test(record.sourceSha256) ||
          !/^[0-9a-f]{64}$/.test(record.outputSha256) ||
          !Number.isSafeInteger(record.sourceSize)
        )
          throw new Error('Movie sidecar provenance does not match the mounted game');
        return [resourcePath(name), { ...record, url: new URL(record.url, base).href }];
      }),
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
    const nativeArchives = new Map(),
      nativeLoose = new Map(),
      nativeLists = new Map(),
      directories = new Set();
    for (const [path] of ordered) {
      const parts = resourcePath(path)
        .replace(/^patch\//i, '')
        .split('/');
      parts.pop();
      while (parts.length) {
        directories.add(parts.join('/'));
        parts.pop();
      }
    }
    const add = (name, hit, patch) => {
      const key = resourcePath(name);
      if (patch || !this.qualifiedIndex.has(key)) this.qualifiedIndex.set(key, hit);
    };
    for (const [path, file] of ordered.filter(([p]) => /\.int$/i.test(p))) {
      const archive = await KIFArchive.open(file, path);
      this.archives.push(archive);
      const patch = /(^|\/)patch\//i.test(path);
      const logicalArchive = resourcePath(path).replace(/^patch\//i, ''),
        mountedArchive = { name: logicalArchive, entries: new Map() };
      if (patch || !nativeArchives.has(logicalArchive))
        nativeArchives.set(logicalArchive, mountedArchive);
      for (const entry of archive.entries) {
        const key = resourcePath(entry.name).split('/').pop(),
          hit = { file: archive.file, offset: entry.offset, size: entry.size, path };
        if (!mountedArchive.entries.has(resourcePath(entry.name)))
          mountedArchive.entries.set(resourcePath(entry.name), hit);
        if (patch || !this.index.has(key)) this.index.set(key, hit);
        if (patch || !this.archiveIndex.has(key)) this.archiveIndex.set(key, hit);
        const archivePath = resourcePath(path).replace(/^patch\//i, '');
        for (const qualified of [
          `${archivePath}/${entry.name}`,
          `${archivePath.replace(/\.int$/i, '')}/${entry.name}`,
        ]) {
          const name = resourcePath(qualified);
          if (patch || !this.archiveQualifiedIndex.has(name))
            this.archiveQualifiedIndex.set(name, hit);
        }
        add(`${archivePath}/${entry.name}`, hit, patch);
        add(`${archivePath.replace(/\.int$/i, '')}/${entry.name}`, hit, patch);
      }
    }
    // Loose patch files override archives; base loose files supply startup.xml, fonts, etc.
    for (const [path, file] of ordered.sort(
      ([a], [b]) => Number(/(^|\/)patch\//i.test(a)) - Number(/(^|\/)patch\//i.test(b)),
    )) {
      if (/\.int$/i.test(path)) continue;
      const exact = resourcePath(path);
      if (!this.looseIndex.has(exact)) this.looseIndex.set(exact, file);
      const key = path.split('/').pop().toLowerCase();
      const patch = /(^|\/)patch\//i.test(path),
        hit = { file, offset: 0, size: file.size, path },
        logicalPath = resourcePath(path).replace(/^patch\//i, '');
      if (patch || !nativeLoose.has(logicalPath)) nativeLoose.set(logicalPath, hit);
      if (!this.index.has(key) || /(^|\/)patch\//i.test(path)) this.index.set(key, hit);
      add(logicalPath, hit, patch);
      const slash = logicalPath.indexOf('/');
      if (slash > 0 && !logicalPath.slice(0, slash).endsWith('.int'))
        add(`${logicalPath.slice(0, slash)}.int${logicalPath.slice(slash)}`, hit, patch);
    }
    for (const [path, file] of ordered.filter(([name]) => /\.lst$/i.test(name))) {
      const list = resourcePath(path),
        text = decodeText(await file.read(0, file.size));
      const rows = [];
      nativeLists.set(list, rows);
      for (const line of text.split(/\r\n|\r|\n/)) {
        const source = line
          .replace(/\/\/.*$/, '')
          .replaceAll('"', '')
          .trim();
        if (!source) continue;
        // 5D4C31..5D4C8D splits the first literal '/' into a loose
        // directory and an archive name. Backslashes belong to the directory.
        const slash = source.indexOf('/');
        const directory = slash < 0 ? source : source.slice(0, slash);
        const archive = slash < 0 ? '' : source.slice(slash + 1);
        rows.push({
          directory: directory ? resourcePath(directory) : '',
          archive: archive ? resourcePath(archive) : '',
        });
        const loosePrefix = directory ? `${resourcePath(directory)}/` : '';
        for (const [name, hit] of [...this.qualifiedIndex])
          if (name.startsWith(loosePrefix) && !/\.int$/i.test(hit.path))
            add(`${list}/${name.slice(loosePrefix.length)}`, hit, false);
        if (!archive) continue;
        const prefix = `${resourcePath(archive)}/`;
        for (const [name, hit] of [...this.qualifiedIndex])
          if (name.startsWith(prefix)) add(`${list}/${name.slice(prefix.length)}`, hit, false);
      }
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
      if (/^\s*<\?xml/i.test(xml)) {
        const configuration = parseNativeXML(startup),
          dimension = (name, fallback) => {
            const value = findNativeXML(configuration, `SCREEN/${name}`);
            return value ? (parseNativeInteger(value.text) ?? 0) & 65535 : fallback;
          };
        this.width = dimension('v_width', 800);
        this.height = dimension('v_height', 600);
        this.nativeResources = new NativeResources(configuration);
        for (const entry of this.nativeResources.entries) {
          if (!entry.archive || !entry.directory) continue;
          const prefix = `${resourcePath(entry.directory)}/`;
          for (const [name, hit] of [...this.qualifiedIndex])
            if (name.startsWith(prefix) && !/\.int$/i.test(hit.path)) {
              const key = `${resourcePath(entry.archive)}/${name.slice(prefix.length)}`;
              if (!this.qualifiedIndex.has(key) || /^patch\//i.test(hit.path))
                this.qualifiedIndex.set(key, hit);
            }
        }
      }
    }
    const overrides = [...nativeArchives.values()]
      .filter((archive) => nativeUpdatePriority(archive.name) !== null)
      .sort((a, b) => nativeUpdatePriority(b.name) - nativeUpdatePriority(a.name));
    this.nativeSearch = new NativeResourceSearch({
      archives: nativeArchives,
      loose: nativeLoose,
      directories,
      lists: nativeLists,
      overrides,
      mounts: this.nativeResources
        ? this.nativeResources.entries.filter((entry) => entry.archive)
        : [...nativeArchives.values()]
            .filter((archive) => nativeUpdatePriority(archive.name) === null)
            .map((archive) => ({ archive: archive.name, directory: '' })),
    });
  }
  has(name) {
    return !!this.lookup(name);
  }
  lookup(name) {
    const key = resourcePath(name);
    return key.includes('/') ? this.qualifiedIndex.get(key) : this.index.get(key);
  }
  names(extension) {
    return [...this.index.keys()].filter((n) => n.endsWith(`.${extension}`));
  }
  async read(name) {
    const hit = this.lookup(name);
    return hit ? hit.file.read(hit.offset, hit.size) : null;
  }
  async readLoose(name) {
    const file = this.looseIndex.get(resourcePath(name));
    return file ? file.read(0, file.size) : null;
  }
  async readArchive(name) {
    const key = resourcePath(name),
      hit = key.includes('/') ? this.archiveQualifiedIndex.get(key) : this.archiveIndex.get(key);
    return hit ? hit.file.read(hit.offset, hit.size) : null;
  }
  nativeCandidates(name, mode = 3) {
    resourcePath(name);
    if (!this.nativeSearch) throw new Error('Native resource mounts have not been initialized');
    return this.nativeSearch.candidates(name, mode);
  }
  async readNative(name, mode = 3) {
    const candidate = this.nativeCandidates(name, mode).find((item) => item.hit);
    return candidate ? candidate.hit.file.read(candidate.hit.offset, candidate.hit.size) : null;
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
  resolveCategory(name, category) {
    if (!this.nativeResources) return this.has(name) ? name : null;
    const resolved = this.nativeResources.resolve(name, category);
    return resolved !== null && this.has(resolved) ? resolved : null;
  }
  readCategory(name, category) {
    const resolved = this.resolveCategory(name, category);
    return resolved === null ? Promise.resolve(null) : this.read(resolved);
  }
  async requireCategory(name, category) {
    const bytes = await this.readCategory(name, category);
    if (bytes === null) throw new Error(`Missing ${category} resource: ${name}`);
    return bytes;
  }
  async movieSource(name, canPlayType, stream = null) {
    const hit = stream ? null : this.lookup(name);
    if (!stream && !hit) return null;
    const named = this.media?.[resourcePath(name)],
      matches = (record) =>
        record?.sourceSize === stream.bytes.length && record.sourceSha256 === stream.sha256,
      converted = stream && !matches(named) ? Object.values(this.media ?? {}).find(matches) : named;
    if (converted) {
      if (
        converted.sourceIdentity !== (await this.fingerprint()) ||
        converted.sourceSize !== (stream?.bytes.length ?? hit.size)
      )
        throw new Error('Movie sidecar source differs from the mounted resource');
      return canPlayType(converted.mime) ? { url: converted.url } : null;
    }
    const extension = name.split('.').at(-1).toLowerCase(),
      mime =
        stream?.mime ??
        {
          mp4: 'video/mp4',
          m4v: 'video/mp4',
          webm: 'video/webm',
          ogv: 'video/ogg',
          wmv: 'video/x-ms-wmv',
          avi: 'video/x-msvideo',
          mpg: 'video/mpeg',
          mpeg: 'video/mpeg',
        }[extension];
    if (!mime || !canPlayType(mime)) return null;
    if (hit && hit.offset === 0 && hit.size === hit.file.size && hit.file.url)
      return { url: hit.file.url };
    const url = URL.createObjectURL(
      new Blob([stream?.bytes ?? (await hit.file.read(hit.offset, hit.size))], { type: mime }),
    );
    return { url, release: () => URL.revokeObjectURL(url) };
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

function resourcePath(name) {
  if (typeof name !== 'string' || name.includes('\0'))
    throw new Error('Invalid game resource name');
  const path = name.replaceAll('\\', '/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path))
    throw new Error('Game resource path must be relative');
  const parts = path.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) throw new Error('Game resource path escapes its namespace');
  return parts.join('/').toLowerCase();
}
