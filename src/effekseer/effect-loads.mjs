// SPDX-License-Identifier: MPL-2.0
// Logical Effect/texture load identity is separate from decoded/GPU storage.
// This owner exclusively retains one source-cache reference per live load.
const KINDS = ['color', 'normal', 'distortion'];
const integer = (value, min, max, field) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error('Invalid Effekseer Effect-load ' + field);
  return value;
};
const textures = (source) => {
  for (const kind of KINDS)
    if (!Array.isArray(source?.textures?.[kind]))
      throw new TypeError('Effekseer source texture tables are required');
  return source.textures;
};
const successful = (binding) => {
  if (!binding || (binding.missing !== undefined && typeof binding.missing !== 'boolean'))
    throw new TypeError('Effekseer source texture result is required');
  if (binding.missing || binding.frame === null) return false;
  if (!binding.frame) throw new TypeError('Effekseer texture result must be a frame or NULL');
  return true;
};
export class EffekseerEffectLoads {
  constructor({ resources } = {}) {
    for (const operation of ['load', 'get', 'release', 'snapshot'])
      if (typeof resources?.[operation] !== 'function')
        throw new TypeError('Effekseer source-cache ' + operation + ' operation is required');
    this.resources = resources;
    this.loads = new Map();
    this.bindings = new Map();
    this.nextID = 1;
    this.nextTextureID = 1;
    this.pending = 0;
    this.fresh = true;
    this.closed = false;
  }
  assertOpen() {
    if (this.closed) throw new Error('Effekseer Effect-load owner is closed');
  }
  makeLoad(id, source, references, ids, bindings) {
    const loaded = {
      id,
      sourceID: source.id,
      sourceName: source.sourceName,
      resolved: source.resolved,
      sha256: source.sha256,
      effect: source.effect,
      references,
      textures: { color: [], normal: [], distortion: [] },
    };
    for (const kind of KINDS)
      for (let index = 0; index < source.textures[kind].length; index++) {
        const physical = source.textures[kind][index],
          textureID = ids[kind][index],
          token = textureID === null ? null : Object.freeze({ id: textureID }),
          binding = {
            token,
            frame: token === null ? null : physical.frame,
            missing: !!physical.missing,
            resolved: physical.resolved,
            sha256: physical.sha256,
          };
        loaded.textures[kind].push(binding);
        if (token !== null) bindings.set(textureID, binding);
      }
    return loaded;
  }
  async load(name) {
    this.assertOpen();
    this.fresh = false;
    this.pending++;
    let source = null,
      published = false;
    try {
      source = await this.resources.load(name);
      this.assertOpen();
      if (source === null) return null;
      const sourceTextures = textures(source),
        ids = { color: [], normal: [], distortion: [] };
      integer(this.nextID, 1, Number.MAX_SAFE_INTEGER - 1, 'allocation cursor');
      let nextTexture = this.nextTextureID;
      for (const kind of KINDS)
        for (const binding of sourceTextures[kind]) {
          if (successful(binding)) {
            integer(nextTexture, 1, Number.MAX_SAFE_INTEGER - 1, 'texture allocation cursor');
            ids[kind].push(nextTexture++);
          } else ids[kind].push(null);
        }
      const load = this.makeLoad(this.nextID, source, 1, ids, this.bindings);
      this.nextID++;
      this.nextTextureID = nextTexture;
      this.loads.set(load.id, load);
      published = true;
      return load;
    } finally {
      this.pending--;
      if (source !== null && !published) this.resources.release(source.id);
    }
  }
  get(id) {
    this.assertOpen();
    const load = this.loads.get(id);
    if (!load) throw new Error('Unknown Effekseer Effect-load ' + id);
    return load;
  }
  retain(id) {
    const load = this.get(id);
    integer(load.references, 1, Number.MAX_SAFE_INTEGER - 1, 'reference count');
    load.references++;
    return load;
  }
  release(id) {
    const load = this.get(id);
    if (--load.references) return;
    this.loads.delete(id);
    for (const kind of KINDS)
      for (const binding of load.textures[kind])
        if (binding.token !== null) this.bindings.delete(binding.token.id);
    this.resources.release(load.sourceID);
  }
  bindingFor(token) {
    this.assertOpen();
    if (token === null || token === 0) return null;
    const binding = this.bindings.get(token?.id);
    if (!binding || binding.token !== token)
      throw new Error('Unknown or retired Effekseer logical texture');
    return binding;
  }
  validateSources(loads) {
    const counts = new Map(),
      sources = this.resources.snapshot().assets;
    if (!Array.isArray(sources)) throw new Error('Effekseer source-cache snapshot is invalid');
    for (const load of loads) counts.set(load.sourceID, (counts.get(load.sourceID) ?? 0) + 1);
    if (
      sources.length !== counts.size ||
      sources.some((source) => source.references !== counts.get(source.id))
    )
      throw new Error('Effekseer source-cache references do not match its exclusive load owner');
  }
  snapshot() {
    this.assertOpen();
    if (this.pending) throw new Error('Effekseer Effect-load checkpoint requires settled loads');
    this.validateSources(this.loads.values());
    return {
      nextID: this.nextID,
      nextTextureID: this.nextTextureID,
      loads: [...this.loads.values()].map((load) => ({
        id: load.id,
        sourceID: load.sourceID,
        references: load.references,
        textures: Object.fromEntries(
          KINDS.map((kind) => [
            kind,
            load.textures[kind].map((binding) => binding.token?.id ?? null),
          ]),
        ),
      })),
    };
  }
  restore(state) {
    this.assertOpen();
    if (!this.fresh || this.loads.size || this.bindings.size || this.pending)
      throw new Error('Effekseer Effect-load restore requires a fresh owner');
    if (!state || Object.keys(state).length !== 3 || !Array.isArray(state.loads))
      throw new Error('Invalid Effekseer Effect-load checkpoint');
    integer(state.nextID, 1, Number.MAX_SAFE_INTEGER, 'allocation cursor');
    integer(state.nextTextureID, 1, Number.MAX_SAFE_INTEGER, 'texture allocation cursor');
    const loads = new Map(),
      bindings = new Map(),
      textureIDs = new Set();
    for (const saved of state.loads) {
      if (!saved || Object.keys(saved).length !== 4 || loads.has(saved.id))
        throw new Error('Invalid or duplicate Effekseer Effect-load checkpoint');
      integer(saved.id, 1, state.nextID - 1, 'load ID');
      integer(saved.sourceID, 1, Number.MAX_SAFE_INTEGER, 'source ID');
      integer(saved.references, 1, Number.MAX_SAFE_INTEGER, 'reference count');
      const source = this.resources.get(saved.sourceID),
        tables = textures(source);
      if (!saved.textures || Object.keys(saved.textures).length !== KINDS.length)
        throw new Error('Invalid Effekseer logical texture tables');
      for (const kind of KINDS) {
        const ids = saved.textures[kind];
        if (!Array.isArray(ids) || ids.length !== tables[kind].length)
          throw new Error('Effekseer logical texture table differs from restored source');
        for (let index = 0; index < ids.length; index++) {
          const id = ids[index];
          if (successful(tables[kind][index])) {
            integer(id, 1, state.nextTextureID - 1, 'texture ID');
            if (textureIDs.has(id)) throw new Error('Duplicate Effekseer logical texture ID');
            textureIDs.add(id);
          } else if (id !== null) throw new Error('NULL Effekseer texture has a nonempty identity');
        }
      }
      loads.set(
        saved.id,
        this.makeLoad(saved.id, source, saved.references, saved.textures, bindings),
      );
    }
    this.validateSources(loads.values());
    // Source RAM/data references were restored first. Rebinding does not Load,
    // retain, Play, sample randomness or duplicate the source reference count.
    this.loads = loads;
    this.bindings = bindings;
    this.nextID = state.nextID;
    this.nextTextureID = state.nextTextureID;
    this.fresh = false;
    return this;
  }
  close() {
    if (this.closed) return;
    if (this.pending) throw new Error('Cannot close an unsettled Effekseer Effect-load owner');
    for (const load of this.loads.values()) this.resources.release(load.sourceID);
    this.loads.clear();
    this.bindings.clear();
    this.closed = true;
  }
}
