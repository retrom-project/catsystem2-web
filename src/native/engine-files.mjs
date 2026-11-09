// SPDX-License-Identifier: MPL-2.0
// The reviewed engine readers share one category/path boundary. Native parsers
// still consume the original bytes; providers may supply a live temporary view.
import { encodeCP932 } from '../kcs/strings.mjs';

export const NATIVE_MEMORY_FILE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    open: 0x5d57a0,
    construct: 0x5d8a70,
    size: 0x220,
    data: 528,
    length: 532,
    wide: true,
    read: 0x5d50f0,
    readWide: 0x5d5160,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    open: 0x4b22c0,
    construct: 0x4b5140,
    size: 0x120,
    data: 272,
    length: 276,
    wide: false,
    read: 0x4b1ca0,
  }),
});

export class NativeEngineFiles {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    const p = engine.process,
      sdk = engine.profile.startsWith('sdk-');
    const categoryFilename = ([out, source, category], wide = false) => {
      const name = p.string(source, wide),
        kind = p.string(category),
        filename = world.game.nativeResources
          ? world.game.nativeResources.resolve(name, kind)
          : /[\\/]/.test(name)
            ? name
            : `@cat/${kind}/${name}`;
      if (filename === null) {
        p.zero(out, wide ? 2 : 1);
        return 0;
      }
      const bytes = wide ? new Uint8Array((filename.length + 1) * 2) : encodeCP932(filename + '\0');
      if (wide) {
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < filename.length; i++)
          view.setUint16(i * 2, filename.charCodeAt(i), true);
      }
      if (bytes.length > (wide ? 520 : 260))
        throw new RangeError(
          'Native category filename exceeds its original 260-character destination',
        );
      p.write(out, bytes);
      return 1;
    };
    engine.patch(
      sdk ? 0x4b0830 : 0x5d39e0,
      'category filename',
      3,
      (args) => categoryFilename(args),
      { calleePops: true },
    );
    if (!sdk)
      engine.patch(0x5d3b30, 'wide category filename', 3, (args) => categoryFilename(args, true), {
        calleePops: true,
      });
    // The original byte readers clear bit 0x10 before opening, preserve the
    // remaining search mode, and handle size-only reads, failure logging and
    // destruction themselves. Keep those wrappers and their IFile calls in
    // the guest; only the mounted-resource opener crosses into the host.
    this.layout = NATIVE_MEMORY_FILE_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error(`Native file objects are unavailable in ${engine.profile}`);
    engine.patch(
      this.layout.open,
      'mounted resource file object',
      2,
      ([name, mode]) => this.open(name, mode & 0xffff),
      { calleePops: true },
    );
    engine.registerFeature('engine-files', this);
  }
  async open(name, mode) {
    if (!name) return 0;
    const p = this.engine.process,
      path = p.string(name, this.layout.wide),
      bytes = await this.read(path, mode);
    if (bytes === null) return 0;
    const buffers =
        this.engine.features.get('data-buffers') ??
        (await this.world.getNativeFeature('data-buffers')),
      pointer = p.allocate(this.layout.size, true);
    let data = 0,
      constructed = false;
    try {
      const call = (address, args, target) =>
        p.asyncEnabled
          ? this.engine.callFromHost(address, args, target)
          : this.engine.call(address, args, target);
      await call(this.layout.construct, [], pointer);
      constructed = true;
      data = buffers.allocateData(bytes.length);
      p.write(data, bytes);
      // The original descriptor owns the same hidden-reference allocation
      // used by kcBuffer. Its original read/seek/close/destructor operate on
      // these bytes; there is no parallel host cursor or file lifetime.
      p.store(pointer + this.layout.data, data);
      p.store(pointer + this.layout.length, bytes.length);
      const encoded = this.layout.wide
        ? new Uint8Array((path.length + 1) * 2)
        : encodeCP932(path + '\0');
      if (encoded.length > (this.layout.wide ? 512 : 256))
        throw new RangeError('Native resource filename exceeds its file-object field');
      if (this.layout.wide) {
        const view = new DataView(encoded.buffer);
        for (let i = 0; i < path.length; i++) view.setUint16(i * 2, path.charCodeAt(i), true);
      }
      p.write(pointer + 12, encoded);
      return pointer;
    } catch (error) {
      if (constructed) {
        if (data) p.store(pointer + this.layout.data, data);
        const destroy = p.load(p.load(pointer));
        if (p.asyncEnabled) await this.engine.callFromHost(destroy, [1], pointer);
        else await this.engine.call(destroy, [1], pointer);
      } else p.free(pointer);
      throw error;
    }
  }
  async read(path, mode = 3) {
    const kernel = this.engine.kernel;
    for (const provider of kernel.fileProviders.values()) {
      const result = await provider.read?.(path);
      if (result !== undefined) return this.validateBytes(result);
    }
    const game = this.world.game,
      match = /^@cat\/([^/]+)\/(.*)$/.exec(path),
      resolved = match
        ? game.nativeResources
          ? game.nativeResources.resolve(match[2], match[1])
          : game.resolveCategory
            ? game.resolveCategory(match[2], match[1])
            : match[2]
        : path;
    if (resolved === null && game.nativeCandidates) return null;
    const cached =
      this.world.resourceCache && resolved !== null
        ? await this.world.resourceCache.peek(resolved)
        : null;
    if (cached !== null) return this.validateBytes(cached);
    if (game.nativeCandidates) {
      for (const candidate of game.nativeCandidates(resolved, mode)) {
        if (candidate.kind === 'loose' && kernel.readFile) {
          const bytes = await kernel.readFile(candidate.path);
          if (bytes !== null) return this.validateBytes(bytes);
        }
        if (candidate.hit) {
          const { file, offset, size } = candidate.hit;
          return this.validateBytes(await file.read(offset, size));
        }
      }
      return null;
    }
    if (mode !== 3)
      throw new Error(
        `Native mounted file search mode ${mode} requires a native resource mount provider`,
      );
    let bytes = kernel.readFile ? await kernel.readFile(path) : null;
    if (bytes === null) {
      if (match) {
        if (game.readCategory) bytes = await game.readCategory(match[2], match[1]);
        else {
          const resolved = game.resolveCategory
            ? game.resolveCategory(match[2], match[1])
            : match[2];
          bytes = resolved === null ? null : await game.read(resolved);
        }
      } else bytes = await this.world.game.read(path);
    }
    return this.validateBytes(bytes);
  }
  validateBytes(bytes) {
    if (bytes !== null && !(bytes instanceof Uint8Array))
      throw new TypeError('Native file provider must return bytes or null');
    return bytes;
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeEngineFiles(world) {
  if (world.nativeEngineFilesInstalled) return;
  world.nativeEngineFilesInstalled = true;
  world.registerNativeFeature('engine-files', (engine) => new NativeEngineFiles(engine, world));
}
