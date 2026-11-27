// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';
import { captureArchiveRange, hasMountedRangeBacking, matchesArchiveRange } from '../files.mjs';
import { EMOTE_PREPARATION_LIMITS } from '../emote/document.mjs';
import { nativeABI } from './abi/index.mjs';
import { NativeSceneReader } from './scene-data.mjs';
import { acquireOwnedSceneWorker, canPrepareOwnedSceneWorker } from './scene-workers.mjs';

const MAX_SCENE_FILE = 512 * 1024;
const MAX_SCENE_BODY = 2 * 1024 * 1024;
const MAX_PACKED_MODEL = EMOTE_PREPARATION_LIMITS.packedBytes;
const MAX_MODEL = EMOTE_PREPARATION_LIMITS.expandedBytes;
const decoder = new TextDecoder('shift_jis');
const apply = Reflect.apply,
  ownDescriptor = Object.getOwnPropertyDescriptor,
  prototypeOf = Object.getPrototypeOf,
  mapPrototype = Map.prototype,
  mapHas = Map.prototype.has,
  mapGet = Map.prototype.get,
  weakHas = WeakMap.prototype.has,
  weakSet = WeakMap.prototype.set,
  ByteArray = Uint8Array,
  WeakWitness = WeakMap,
  bytePrototype = ByteArray.prototype,
  typedPrototype = prototypeOf(bytePrototype),
  typedBytes = ownDescriptor(typedPrototype, 'byteLength').get,
  typedBuffer = ownDescriptor(typedPrototype, 'buffer').get,
  typedOffset = ownDescriptor(typedPrototype, 'byteOffset').get,
  bufferBytes = ownDescriptor(ArrayBuffer.prototype, 'byteLength').get,
  bufferResizable = ownDescriptor(ArrayBuffer.prototype, 'resizable')?.get,
  WordView = DataView,
  WordArray = Uint32Array,
  wordAt = DataView.prototype.getUint32,
  bind = Function.prototype.bind,
  Controller = AbortController,
  abort = AbortController.prototype.abort,
  controllerSignal = ownDescriptor(AbortController.prototype, 'signal').get,
  signalAborted = ownDescriptor(AbortSignal.prototype, 'aborted').get;

function byteStorage(bytes) {
  try {
    if (ownDescriptor(globalThis, 'Uint8Array')?.value !== ByteArray) return null;
    const length = apply(typedBytes, bytes, []),
      buffer = apply(typedBuffer, bytes, []);
    if (
      prototypeOf(bytes) !== bytePrototype ||
      (bufferResizable && apply(bufferResizable, buffer, []))
    )
      return null;
    return {
      length,
      buffer,
      backingLength: apply(bufferBytes, buffer, []),
      offset: apply(typedOffset, bytes, []),
    };
  } catch {
    return null;
  }
}

function samePackedBytes(first, second) {
  if (
    ownDescriptor(globalThis, 'DataView')?.value !== WordView ||
    ownDescriptor(globalThis, 'Uint32Array')?.value !== WordArray
  )
    return false;
  const a = byteStorage(first),
    b = byteStorage(second);
  if (!a || !b || a.length !== b.length) return false;
  const end = a.length - (a.length % 4);
  if (((a.offset | b.offset) & 3) === 0) {
    const av = new WordArray(a.buffer, a.offset, end / 4),
      bv = new WordArray(b.buffer, b.offset, end / 4);
    for (let at = 0; at < end / 4; at++) if (av[at] !== bv[at]) return false;
  } else {
    const av = new WordView(a.buffer, a.offset, a.length),
      bv = new WordView(b.buffer, b.offset, b.length),
      aw = apply(bind, wordAt, [av]),
      bw = apply(bind, wordAt, [bv]);
    for (let at = 0; at < end; at += 4) if (aw(at) !== bw(at)) return false;
  }
  for (let at = end; at < a.length; at++) if (first[at] !== second[at]) return false;
  return true;
}

function ordinaryDocuments(documents) {
  try {
    apply(mapHas, documents, [null]);
    return (
      prototypeOf(documents) === mapPrototype &&
      !ownDescriptor(documents, 'has') &&
      !ownDescriptor(documents, 'get') &&
      ownDescriptor(mapPrototype, 'has')?.value === mapHas &&
      ownDescriptor(mapPrototype, 'get')?.value === mapGet
    );
  } catch {
    return false;
  }
}

function witness(value) {
  const held = new WeakWitness();
  apply(weakSet, held, [value, true]);
  return held;
}

function currentRange(range, hit, body) {
  const file = ownDescriptor(hit, 'file')?.value;
  if (!file || file !== range.file) return false;
  const ownRead = ownDescriptor(file, 'read'),
    read = ownRead ?? ownDescriptor(prototypeOf(file), 'read'),
    url = ownDescriptor(file, 'url'),
    blob = ownDescriptor(file, 'blob');
  return (
    range.epoch === body &&
    ownDescriptor(hit, 'offset')?.value === range.offset &&
    ownDescriptor(hit, 'size')?.value === range.size &&
    ownDescriptor(file, 'size')?.value === range.sourceSize &&
    ownDescriptor(file, 'modifiedMs')?.value === range.modifiedMs &&
    read?.value === range.read &&
    (url
      ? 'value' in url && url.value === range.backing
      : blob
        ? 'value' in blob && blob.value === range.backing
        : file === range.backing)
  );
}

function modelDeclarations(reader, block) {
  const { count } = reader.blockInfo(block),
    declarations = [];
  let emptyProgramHint = false;
  for (let line = 0; line < Math.min(count, 64); line++) {
    if (reader.type(block, line) !== 0x30) continue;
    const bytes = reader.text(block, line);
    if (!bytes) continue;
    const text = decoder.decode(bytes);
    if (/^\s*mpl\s+\d+\s*$/i.test(text)) emptyProgramHint = true;
    const match = /^\s*mpl\s+\d+\s+([a-z0-9_]+)\s*,\s*(\d+)(?=,|\s|$)/i.exec(text);
    if (match) declarations.push([match[1], Number(match[2]), emptyProgramHint]);
  }
  return declarations;
}

function selectModel(declarations, profiles, documents) {
  if (!ordinaryDocuments(documents)) return null;
  let selected;
  for (const [profile, body, emptyProgramHint] of declarations) {
    if (!Object.hasOwn(profiles.profileFiles, profile.toLowerCase())) continue;
    const model = profiles.profile(profile).bodies[body];
    if (!model) continue;
    const resident = apply(mapHas, documents, [model]);
    if (resident && !emptyProgramHint) continue;
    const record = resident ? apply(mapGet, documents, [model]) : null;
    if (resident && (!record || typeof record !== 'object')) continue;
    if (selected && selected.model !== model) return null;
    // This is only a bounded lookahead hint. Actual unload/load instructions
    // still run, and a prepared result never shares the resident PSB backing.
    selected = { model, generation: record ? witness(record) : null };
  }
  return selected;
}

async function expandInWorker(world, packed, length, signal) {
  const worker = acquireOwnedSceneWorker(world, 'model');
  if (!worker) return null;
  try {
    const bytes = new ByteArray(packed);
    const data = await worker.send({ bytes, length }, [bytes.buffer], signal);
    const expanded = data?.expanded,
      storage = byteStorage(expanded);
    if (
      !storage ||
      storage.length !== length ||
      storage.offset !== 0 ||
      storage.backingLength !== length
    )
      return null;
    // Oversized results cannot retain an atlas alongside the expanded PSB.
    if (length > EMOTE_PREPARATION_LIMITS.atlasWorkingBytes) return { expanded, atlas: null };
    const atlas = data.atlas,
      rgba = atlas?.texture?.rgba,
      pixels = rgba ? byteStorage(rgba) : null;
    if (
      rgba &&
      (!pixels ||
        pixels.offset !== 0 ||
        pixels.backingLength !== pixels.length ||
        pixels.buffer === storage.buffer ||
        length + pixels.length > EMOTE_PREPARATION_LIMITS.atlasWorkingBytes)
    )
      return { expanded, atlas: null };
    return { expanded, atlas: atlas ?? null };
  } finally {
    worker.release();
  }
}

export class M2ScenePreparation {
  #job = null;
  #pending = false;
  #atlasOwner = null;

  constructor(owner) {
    this.owner = owner;
  }

  #activeScene() {
    let active;
    for (const record of this.owner.world.runtime.handles.records.values()) {
      if (record.type !== 'scene-data' || !record.value.reader.body) continue;
      if (active) return null;
      active = record.value;
    }
    return active;
  }

  #current(job, completed = false) {
    const world = ownDescriptor(this.owner, 'world')?.value;
    if (world !== job.world) return false;
    // The active-scene lookup can call public collection ports. Read the
    // current history and consumer only after those callbacks have returned.
    const active = this.#activeScene();
    const reader = ownDescriptor(job.scene, 'reader')?.value,
      historyOwner = ownDescriptor(job.scene, 'history')?.value,
      path = historyOwner && ownDescriptor(historyOwner, 'path')?.value,
      length = path && ownDescriptor(path, 'length')?.value,
      history = length && ownDescriptor(path, length - 1)?.value,
      closed = ownDescriptor(world, 'closed'),
      disposing = ownDescriptor(world, 'disposalRequested');
    return (
      (completed || !apply(signalAborted, job.signal, [])) &&
      (!disposing || ('value' in disposing && !disposing.value)) &&
      (!closed || ('value' in closed && !closed.value)) &&
      reader &&
      ownDescriptor(reader, 'body')?.value === job.body &&
      history === job.history &&
      history &&
      ownDescriptor(history, 'value')?.value === job.historyValue &&
      active === job.scene &&
      (!job.model || this.#currentDocument(job)) &&
      this.#job === job &&
      !job.cancelled
    );
  }

  #currentDocument(job) {
    const documents = ownDescriptor(this.owner, 'documents')?.value;
    if (!documents || !apply(weakHas, job.documents, [documents]) || !ordinaryDocuments(documents))
      return false;
    if (!apply(mapHas, documents, [job.model])) return true;
    const record = apply(mapGet, documents, [job.model]);
    return (
      (!!job.generation && apply(weakHas, job.generation, [record])) ||
      (!!job.consumer && apply(weakHas, job.consumer, [record]))
    );
  }

  #mount(name, category) {
    const { game, resourceCache } = this.owner.world;
    const path = game.resolveCategory(name, category);
    if (path === null) return null;
    const key = path.toLowerCase();
    if (
      resourceCache?.pending ||
      resourceCache?.entries.some(({ filename }) => filename.toLowerCase() === key)
    )
      return null;
    // NativeWorld's cache misses use this archive search, including update overrides.
    const hit = game.nativeCandidates(path, 3).find((entry) => entry.hit)?.hit;
    return hasMountedRangeBacking(hit?.file) ? hit : null;
  }

  resume() {
    if (!canPrepareOwnedSceneWorker(this.owner.world, 'model')) return;
    const scene = this.#activeScene(),
      entry = scene?.history.path.at(-1);
    if (entry) this.hint(scene, entry.nameBytes ?? entry.scene, entry.value);
  }

  hint(scene, filename, block) {
    const { world, profiles } = this.owner;
    if (
      !canPrepareOwnedSceneWorker(world, 'model') ||
      !profiles ||
      world.closed ||
      world.disposalRequested ||
      nativeABI(world.profile).engineVersion !== '2.6.1.76' ||
      this.#activeScene() !== scene ||
      !Number.isInteger(block) ||
      block < 0 ||
      block >= scene.reader.blockCount ||
      typeof world.game.resolveCategory !== 'function' ||
      typeof world.game.nativeCandidates !== 'function' ||
      typeof world.game.requireCategory !== 'function'
    )
      return;
    const name =
      typeof filename === 'string' ? filename : decoder.decode(filename).split('\0', 1)[0];
    const body = scene.reader.body,
      previous = this.#job;
    if (previous?.body === body && previous.block === block && previous.name === name) return;
    this.discard();
    if (this.#pending || !name) return;

    const history = scene.history.path.at(-1);
    const job = {
      world,
      scene,
      body,
      name,
      block,
      history,
      historyValue: history?.value,
      abort: new Controller(),
    };
    job.signal = apply(controllerSignal, job.abort, []);
    this.#job = job;
    this.#pending = true;
    void this.#run(job)
      .catch(() => {})
      .finally(() => {
        this.#pending = false;
        if (this.#job === job && !this.#current(job)) this.#discardJob(undefined, job);
      });
  }

  async #run(job) {
    const { world, profiles, documents } = this.owner;
    const { game } = world;
    if (job.body.bytes.length > MAX_SCENE_BODY) return;
    const declarations = modelDeclarations(job.scene.reader, job.block);
    if (!declarations.length) return;
    const sceneFile = this.#mount(job.name, 'scene');
    if (!sceneFile || sceneFile.size > MAX_SCENE_FILE) return;
    const original = await game.requireCategory(job.name, 'scene');
    if (!this.#current(job) || original.length < 16) return;
    const header = new Binary(original, 'CatScene');
    if (!header.magic('CatScene') || header.u32(12) > MAX_SCENE_BODY) return;
    const verified = new NativeSceneReader();
    if (
      !(await verified.load(original)) ||
      verified.body.bytes.length !== job.body.bytes.length ||
      !job.body.bytes.every((value, at) => value === verified.body.bytes[at]) ||
      !this.#current(job)
    )
      return;

    const selected = selectModel(declarations, profiles, documents);
    if (!selected) return;
    const { model, generation } = selected;
    const file = this.#mount(model, 'm2psb');
    if (!file || file.size <= 64 * 1024 || file.size > MAX_PACKED_MODEL) return;
    job.model = model;
    job.generation = generation;
    job.documents = witness(documents);
    job.range = captureArchiveRange(file, job.body);
    if (!job.range) return;

    let source = await game.requireCategory(model, 'm2psb');
    const storage = byteStorage(source);
    if (
      !this.#current(job) ||
      !storage ||
      storage.length !== file.size ||
      storage.length > MAX_PACKED_MODEL
    )
      return;
    // A mounted range may be a view into a larger caller-owned buffer. Retain
    // one exact, independent PSZ snapshot rather than its complete backing.
    const packed = new ByteArray(source);
    source = null;
    const container = new Binary(packed, 'PSZ');
    if (!container.magic('PSZ\0')) return;
    const length = container.u32(8);
    if (length < MAX_PACKED_MODEL || length > MAX_MODEL) return;
    const result = await expandInWorker(
      world,
      container.range(16, container.u32(4)),
      length,
      job.signal,
    );
    if (result && this.#current(job)) job.prepared = { packed, ...result, scene: job.scene };
  }

  beginDocument(model, record) {
    const job = this.#job;
    if (!job || job.model !== model) return;
    try {
      if (this.#current(job)) job.consumer = witness(record);
      else this.#discardJob(undefined, job);
    } catch {
      this.#discardJob(undefined, job);
    }
  }

  endDocument(model, record) {
    const job = this.#job;
    if (job?.model === model && job.consumer && apply(weakHas, job.consumer, [record]))
      this.#discardJob(undefined, job);
  }

  take(model, bytes, record) {
    const job = this.#job;
    if (!job || job.model !== model) return null;
    try {
      if (
        !job.prepared ||
        !job.consumer ||
        !apply(weakHas, job.consumer, [record]) ||
        !this.#current(job)
      )
        return null;
      const file = this.#mount(model, 'm2psb');
      if (!file || !matchesArchiveRange(job.range, file, job.body)) return null;
      // Finish the old channel before the final witness check. Abort listeners
      // may cancel this job, replace its consumer, or start a successor. Our
      // own completion abort is distinct from discard(), which marks canceled.
      apply(abort, job.abort, []);
      if (!this.#current(job, true) || !matchesArchiveRange(job.range, file, job.body)) return null;
      const prepared = job.prepared;
      // Lookup, range access and cleanup may all reenter. The final check is
      // after them; comparison uses only intrinsic, non-shared byte storage.
      if (
        !samePackedBytes(bytes, prepared.packed) ||
        !this.#current(job, true) ||
        !currentRange(job.range, file, job.body) ||
        !this.#currentDocument(job) ||
        this.#job !== job ||
        job.cancelled
      )
        return null;
      return prepared;
    } catch {
      return null;
    } finally {
      this.#discardJob(undefined, job);
    }
  }

  keepAtlas(document, scene) {
    this.releaseAtlas();
    this.#atlasOwner = { document, scene };
  }

  releaseAtlas(document) {
    if (this.#atlasOwner && (document === undefined || this.#atlasOwner.document === document)) {
      const previous = this.#atlasOwner;
      this.#atlasOwner = null;
      previous.document.discardPreparedAtlas();
    }
  }

  discard(scene) {
    const job = this.#job;
    try {
      if (scene === undefined || this.#atlasOwner?.scene === scene) this.releaseAtlas();
    } finally {
      this.#discardJob(scene, job);
    }
  }

  #discardJob(scene, job = this.#job) {
    if (job && this.#job === job && (scene === undefined || job.scene === scene)) {
      job.cancelled = true;
      this.#job = null;
      apply(abort, job.abort, []);
    }
  }
}
