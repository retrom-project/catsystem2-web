// SPDX-License-Identifier: MPL-2.0
// EFK category loading reuses the owning World's mounted-file and ACP services.
import { readEffekseerEffect } from './effect-reader.mjs';

// 6A7600 remembers separator index zero as its initial sentinel as well.
export function effekseerTextureBasename(path) {
  let last = 0;
  for (let i = 0; i < path.length; i++) if (path[i] === '/' || path[i] === '\\') last = i;
  return path.slice(last ? last + 1 : 0);
}
const validateName = (name) => {
  if (typeof name !== 'string' || name.includes('\0'))
    throw new TypeError('Invalid Effekseer resource name');
  return name;
};
const textureIdentities = (textures) =>
  Object.fromEntries(
    Object.entries(textures).map(([kind, bindings]) => [
      kind,
      bindings.map(({ resolved, sha256, missing }) => ({
        resolved,
        sha256,
        missing: !!missing,
      })),
    ]),
  );
export class EffekseerResources {
  constructor({
    resolveCategory,
    readNative,
    roundTripCP932,
    identify,
    decodeTexture,
    disposeTexture = () => {},
    onWarning,
    readerLimits,
  } = {}) {
    for (const [name, value] of Object.entries({
      resolveCategory,
      readNative,
      roundTripCP932,
      identify,
      decodeTexture,
    }))
      if (typeof value !== 'function') throw new TypeError(`Effekseer ${name} service is required`);
    Object.assign(this, {
      resolveCategory,
      readNative,
      roundTripCP932,
      identify,
      decodeTexture,
      disposeTexture,
      onWarning,
      readerLimits,
    });
    this.assets = new Map();
    this.byID = new Map();
    this.textures = new Map();
    this.nextID = 1;
    this.closed = false;
  }
  assertOpen() {
    if (this.closed) throw new Error('Effekseer resources are closed');
  }
  async source(name, category, basename = false) {
    this.assertOpen();
    validateName(name);
    const acp = this.roundTripCP932(name),
      sourceName = basename ? effekseerTextureBasename(acp) : acp,
      resolved = this.resolveCategory(sourceName, category);
    if (resolved === null) return { sourceName, resolved, bytes: null, sha256: null };
    const bytes = await this.readNative(resolved, 3);
    this.assertOpen();
    if (bytes === null) return { sourceName, resolved, bytes, sha256: null };
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Effekseer mounted source must return bytes or null');
    const sha256 = await this.identify(bytes);
    this.assertOpen();
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new Error('Effekseer resource identity is not SHA-256');
    return { sourceName, resolved, bytes, sha256 };
  }
  async texture(name) {
    const source = await this.source(name, 'efktex', true);
    if (source.bytes === null) return { ...source, missing: true, frame: null };
    const key = `${source.resolved}\0${source.sha256}`;
    let texture = this.textures.get(key);
    if (!texture) {
      texture = { ...source, key, references: 0, frame: null, pending: null };
      this.textures.set(key, texture);
      texture.pending = Promise.resolve()
        .then(async () => {
          texture.frame = await this.decodeTexture(source.bytes, {
            identity: `${source.resolved}@sha256:${source.sha256}`,
          });
          if (this.closed) {
            if (texture.frame) this.disposeTexture(texture.frame);
            texture.frame = null;
            throw new Error('Effekseer resources closed during texture load');
          }
          if (!texture.frame)
            throw new Error(`Effekseer texture decoder returned no frame: ${source.resolved}`);
          return texture;
        })
        .catch((error) => {
          this.textures.delete(key);
          throw error;
        });
    }
    texture.references++;
    try {
      await texture.pending;
      return texture;
    } catch (error) {
      texture.references--;
      throw error;
    }
  }
  releaseTexture(texture) {
    if (texture.missing) return;
    if (this.textures.get(texture.key) !== texture || texture.references <= 0)
      throw new Error('Effekseer texture reference is invalid');
    if (--texture.references === 0) {
      this.textures.delete(texture.key);
      this.disposeTexture(texture.frame);
    }
  }
  async load(name) {
    this.assertOpen();
    validateName(name);
    if (name === '') return null;
    const source = await this.source(name, 'efk');
    if (source.bytes === null) return null;
    const key = `${source.resolved}\0${source.sha256}`;
    let asset = this.assets.get(key);
    if (!asset) {
      asset = {
        id: this.nextID++,
        ...source,
        key,
        references: 0,
        effect: null,
        textures: { color: [], normal: [], distortion: [] },
        pending: null,
      };
      this.assets.set(key, asset);
      this.byID.set(asset.id, asset);
      asset.pending = Promise.resolve()
        .then(async () => {
          asset.effect = readEffekseerEffect(source.bytes, {
            identity: `${source.resolved}@sha256:${source.sha256}`,
            onWarning: this.onWarning,
            limits: this.readerLimits,
          });
          try {
            // The original wrapper installs only its TextureLoader. Wave/model
            // paths remain parsed data; neither is sent through a fabricated IO path.
            for (const kind of ['color', 'normal', 'distortion'])
              for (const path of asset.effect.dependencies[kind])
                asset.textures[kind].push(await this.texture(path));
          } catch (error) {
            for (const texture of Object.values(asset.textures).flat())
              this.releaseTexture(texture);
            throw error;
          }
          return asset;
        })
        .catch((error) => {
          this.assets.delete(key);
          this.byID.delete(asset.id);
          throw error;
        });
    }
    await asset.pending;
    this.assertOpen();
    asset.references++;
    return asset;
  }
  get(id) {
    const asset = this.byID.get(id);
    if (!asset || !asset.references) throw new Error(`Unknown Effekseer asset ${id}`);
    return asset;
  }
  retain(id) {
    const asset = this.get(id);
    asset.references++;
    return asset;
  }
  release(id) {
    const asset = this.get(id);
    if (--asset.references === 0) {
      this.assets.delete(asset.key);
      this.byID.delete(id);
      for (const texture of Object.values(asset.textures).flat()) this.releaseTexture(texture);
    }
  }
  snapshot() {
    this.assertOpen();
    if ([...this.assets.values()].some((asset) => !asset.references))
      throw new Error('Effekseer resource snapshot requires settled loads');
    return {
      nextID: this.nextID,
      assets: [...this.byID.values()]
        .sort((a, b) => a.id - b.id)
        .map(({ id, sourceName, resolved, sha256, references, textures }) => ({
          id,
          sourceName,
          resolved,
          sha256,
          references,
          textures: textureIdentities(textures),
        })),
    };
  }
  async restore(state) {
    this.assertOpen();
    if (this.assets.size || this.nextID !== 1)
      throw new Error('Effekseer resources restore requires a fresh owner');
    if (
      !state ||
      !Number.isSafeInteger(state.nextID) ||
      state.nextID < 1 ||
      !Array.isArray(state.assets)
    )
      throw new Error('Invalid Effekseer resource checkpoint');
    const ids = new Set(),
      keys = new Set();
    for (const saved of state.assets) {
      if (
        !Number.isSafeInteger(saved.id) ||
        saved.id < 1 ||
        saved.id >= state.nextID ||
        ids.has(saved.id) ||
        !Number.isSafeInteger(saved.references) ||
        saved.references < 1 ||
        !/^[a-f0-9]{64}$/.test(saved.sha256) ||
        typeof saved.resolved !== 'string' ||
        keys.has(`${saved.resolved}\0${saved.sha256}`)
      )
        throw new Error('Invalid Effekseer asset checkpoint');
      validateName(saved.sourceName);
      for (const kind of ['color', 'normal', 'distortion']) {
        if (!Array.isArray(saved.textures?.[kind]))
          throw new Error('Invalid Effekseer texture checkpoint');
        for (const texture of saved.textures[kind])
          if (
            !texture ||
            typeof texture.missing !== 'boolean' ||
            !(typeof texture.resolved === 'string' || texture.resolved === null) ||
            (texture.missing
              ? texture.sha256 !== null
              : typeof texture.resolved !== 'string' || !/^[a-f0-9]{64}$/.test(texture.sha256))
          )
            throw new Error('Invalid Effekseer texture checkpoint');
      }
      ids.add(saved.id);
      keys.add(`${saved.resolved}\0${saved.sha256}`);
    }
    this.nextID = state.nextID;
    try {
      for (const saved of [...state.assets].sort((a, b) => a.id - b.id)) {
        const asset = await this.load(saved.sourceName);
        if (!asset || asset.resolved !== saved.resolved || asset.sha256 !== saved.sha256)
          throw new Error(`Effekseer asset identity changed: ${saved.sourceName}`);
        const loadedTextures = textureIdentities(asset.textures);
        for (const kind of ['color', 'normal', 'distortion'])
          if (
            loadedTextures[kind].length !== saved.textures[kind].length ||
            loadedTextures[kind].some((texture, i) =>
              ['resolved', 'sha256', 'missing'].some(
                (key) => texture[key] !== saved.textures[kind][i][key],
              ),
            )
          )
            throw new Error(`Effekseer texture identity changed: ${saved.sourceName}`);
        this.byID.delete(asset.id);
        asset.id = saved.id;
        asset.references = saved.references;
        this.byID.set(asset.id, asset);
      }
      this.nextID = state.nextID;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const texture of this.textures.values())
      if (texture.frame) this.disposeTexture(texture.frame);
    this.textures.clear();
    this.assets.clear();
    this.byID.clear();
  }
}
