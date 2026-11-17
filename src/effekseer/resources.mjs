// SPDX-License-Identifier: MPL-2.0
// EFK category loading reuses the owning World's mounted-file and ACP services.
import { readEffekseerEffect } from './effect-reader.mjs';
import { EFFEKSEER_LEVEL0_PROFILE, effekseerLevel0Profile } from './texture-level0.mjs';
import { decodeEffekseerTexture, isEffekseerTextureProfile } from './texture-decoder.mjs';

// Filename splitting uses separator index zero as its initial sentinel.
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
const dimension = (value) =>
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= EFFEKSEER_LEVEL0_PROFILE.maxWidth &&
  (value & (value - 1)) === 0;
const framePixels = (frame) => {
  if (
    !frame ||
    ![21, 22].includes(frame.format) ||
    !dimension(frame.width) ||
    !dimension(frame.height) ||
    !(frame.rgba instanceof Uint8Array || frame.rgba instanceof Uint8ClampedArray) ||
    frame.rgba.length !== frame.width * frame.height * 4
  )
    throw new Error('Effekseer texture decoder returned an invalid level0 frame');
  if (frame.format === 22)
    for (let i = 3; i < frame.rgba.length; i += 4)
      if (frame.rgba[i] !== 255)
        throw new Error('Effekseer format22 frame must contain defined opaque samples');
  return frame.rgba;
};
const storageIdentity = (texture) =>
  texture.missing
    ? null
    : {
        profile: { ...effekseerLevel0Profile(texture.frame.format) },
        width: texture.frame.width,
        height: texture.frame.height,
        rgbaSHA256: texture.rgbaSHA256,
      };
const validStorage = (storage) =>
  storage !== null &&
  typeof storage === 'object' &&
  Object.keys(storage).length === 4 &&
  isEffekseerTextureProfile(storage.profile) &&
  dimension(storage.width) &&
  dimension(storage.height) &&
  typeof storage.rgbaSHA256 === 'string' &&
  /^[a-f0-9]{64}$/.test(storage.rgbaSHA256);
const sameStorage = (a, b) =>
  a === null || b === null
    ? a === b
    : a.width === b.width &&
      a.height === b.height &&
      a.rgbaSHA256 === b.rgbaSHA256 &&
      Object.entries(a.profile).every(([field, value]) => b.profile[field] === value);
const textureIdentities = (textures) =>
  Object.fromEntries(
    Object.entries(textures).map(([kind, bindings]) => [
      kind,
      bindings.map((texture) => ({
        resolved: texture.resolved,
        sha256: texture.sha256,
        missing: !!texture.missing,
        storage: storageIdentity(texture),
      })),
    ]),
  );
export class EffekseerResources {
  constructor({
    resolveCategory,
    readNative,
    roundTripCP932,
    identify,
    decodeTexture = decodeEffekseerTexture,
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
      texture = { ...source, key, references: 0, frame: null, rgbaSHA256: null, pending: null };
      this.textures.set(key, texture);
      texture.pending = Promise.resolve()
        .then(async () => {
          texture.frame = await this.decodeTexture(source.bytes, {
            identity: `${source.resolved}@sha256:${source.sha256}`,
          });
          this.assertOpen();
          const rgbaSHA256 = await this.identify(framePixels(texture.frame));
          this.assertOpen();
          if (typeof rgbaSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(rgbaSHA256))
            throw new Error('Effekseer level0 storage identity is not SHA-256');
          texture.rgbaSHA256 = rgbaSHA256;
          return texture;
        })
        .catch((error) => {
          if (this.textures.get(key) === texture) this.textures.delete(key);
          try {
            this.disposeFrame(texture);
          } catch (cleanup) {
            throw new AggregateError([error, cleanup], error.message + '; texture cleanup failed');
          }
          throw error;
        })
        .finally(() => {
          texture.pending = null;
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
    if (texture.missing || this.closed) return;
    if (this.textures.get(texture.key) !== texture || texture.references <= 0)
      throw new Error('Effekseer texture reference is invalid');
    if (--texture.references === 0) {
      this.textures.delete(texture.key);
      this.disposeFrame(texture);
    }
  }
  disposeFrame(texture) {
    const frame = texture.frame;
    texture.frame = null;
    texture.rgbaSHA256 = null;
    if (frame) this.disposeTexture(frame);
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
            const errors = [error];
            for (const texture of Object.values(asset.textures).flat())
              try {
                this.releaseTexture(texture);
              } catch (cleanup) {
                errors.push(cleanup);
              }
            throw errors.length === 1
              ? error
              : new AggregateError(errors, error.message + '; Effect cleanup failed');
          }
          return asset;
        })
        .catch((error) => {
          if (this.assets.get(key) === asset) this.assets.delete(key);
          if (this.byID.get(asset.id) === asset) this.byID.delete(asset.id);
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
      const errors = [];
      for (const texture of Object.values(asset.textures).flat())
        try {
          this.releaseTexture(texture);
        } catch (error) {
          errors.push(error);
        }
      if (errors.length)
        throw new AggregateError(errors, 'Effekseer Effect release cleanup failed');
    }
  }
  snapshot() {
    this.assertOpen();
    if (
      [...this.assets.values()].some((asset) => !asset.references) ||
      [...this.textures.values()].some((texture) => texture.pending)
    )
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
            Object.keys(texture).length !== 4 ||
            typeof texture.missing !== 'boolean' ||
            !(typeof texture.resolved === 'string' || texture.resolved === null) ||
            (texture.missing
              ? texture.sha256 !== null || texture.storage !== null
              : typeof texture.resolved !== 'string' ||
                !/^[a-f0-9]{64}$/.test(texture.sha256) ||
                !validStorage(texture.storage))
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
            loadedTextures[kind].some(
              (texture, i) =>
                ['resolved', 'sha256', 'missing'].some(
                  (key) => texture[key] !== saved.textures[kind][i][key],
                ) || !sameStorage(texture.storage, saved.textures[kind][i].storage),
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
      try {
        this.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], error.message + '; restore cleanup failed');
      }
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    const textures = [...this.textures.values()],
      errors = [];
    this.textures.clear();
    this.assets.clear();
    this.byID.clear();
    for (const texture of textures)
      try {
        this.disposeFrame(texture);
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, 'Effekseer resource cleanup failed');
  }
}
