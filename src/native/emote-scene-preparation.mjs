// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';
import { BlobFile, HTTPFile } from '../files.mjs';
import { nativeABI } from './abi/index.mjs';
import { NativeSceneReader } from './scene-data.mjs';

const MAX_SCENE_FILE = 512 * 1024;
const MAX_SCENE_BODY = 2 * 1024 * 1024;
const MAX_PACKED_MODEL = 8 * 1024 * 1024;
const MAX_MODEL = 64 * 1024 * 1024;
const decoder = new TextDecoder('shift_jis');

function modelDeclarations(reader, block) {
  const { count } = reader.blockInfo(block),
    declarations = [];
  for (let line = 0; line < Math.min(count, 64); line++) {
    if (reader.type(block, line) !== 0x30) continue;
    const bytes = reader.text(block, line);
    if (!bytes) continue;
    const match = /^\s*mpl\s+\d+\s+([a-z0-9_]+)\s*,\s*(\d+)(?=,|\s|$)/i.exec(decoder.decode(bytes));
    if (match) declarations.push([match[1], Number(match[2])]);
  }
  return declarations;
}

function selectModel(declarations, profiles, documents) {
  let selected;
  for (const [profile, body] of declarations) {
    if (!Object.hasOwn(profiles.profileFiles, profile.toLowerCase())) continue;
    const model = profiles.profile(profile).bodies[body];
    if (!model || documents.has(model)) continue;
    if (selected && selected !== model) return null;
    selected = model;
  }
  return selected;
}

function expandInWorker(packed, length, signal) {
  const transfer = new Uint8Array(packed);
  const worker = new Worker(new URL('../emote/psz-worker.mjs', import.meta.url), {
    type: 'module',
  });
  let cancel;
  return new Promise((resolve, reject) => {
    cancel = () => resolve(null);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) =>
      resolve(
        data?.expanded instanceof Uint8Array && data.expanded.length === length ? data : null,
      );
    worker.onerror = (event) => {
      event.preventDefault();
      resolve(null);
    };
    try {
      worker.postMessage({ bytes: transfer, length }, [transfer.buffer]);
    } catch (error) {
      reject(error);
    }
  }).finally(() => {
    signal.removeEventListener('abort', cancel);
    worker.terminate();
  });
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

  #current(job) {
    const { world } = this.owner;
    const history = job.scene.history.path.at(-1);
    return (
      !job.abort.signal.aborted &&
      !world.disposalRequested &&
      !world.closed &&
      job.scene.reader.body === job.body &&
      history === job.history &&
      history?.value === job.historyValue &&
      this.#activeScene() === job.scene
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
    return hit?.file instanceof HTTPFile || hit?.file instanceof BlobFile ? hit : null;
  }

  resume() {
    if (typeof Worker !== 'function') return;
    const scene = this.#activeScene(),
      entry = scene?.history.path.at(-1);
    if (entry) this.hint(scene, entry.nameBytes ?? entry.scene, entry.value);
  }

  hint(scene, filename, block) {
    const { world, profiles } = this.owner;
    if (
      typeof Worker !== 'function' ||
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
      scene,
      body,
      name,
      block,
      history,
      historyValue: history?.value,
      abort: new AbortController(),
    };
    this.#job = job;
    this.#pending = true;
    void this.#run(job)
      .catch(() => {})
      .finally(() => {
        this.#pending = false;
        if (this.#job === job && !this.#current(job)) this.discard();
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

    const model = selectModel(declarations, profiles, documents);
    if (!model) return;
    const file = this.#mount(model, 'm2psb');
    if (!file || file.size <= 64 * 1024 || file.size > MAX_PACKED_MODEL) return;
    job.model = model;
    job.file = file;

    const packed = await game.requireCategory(model, 'm2psb');
    if (!this.#current(job) || documents.has(model) || packed.length !== file.size) return;
    const container = new Binary(packed, 'PSZ');
    if (!container.magic('PSZ\0')) return;
    const length = container.u32(8);
    if (length < MAX_PACKED_MODEL || length > MAX_MODEL) return;
    const result = await expandInWorker(
      container.range(16, container.u32(4)),
      length,
      job.abort.signal,
    );
    if (result && this.#current(job) && !documents.has(model))
      job.prepared = { packed, ...result, scene: job.scene };
  }

  take(model) {
    const job = this.#job;
    if (!job || job.model !== model) return null;
    try {
      if (!job.prepared || !this.#current(job)) return null;
      const file = this.#mount(model, 'm2psb');
      return file?.file === job.file.file &&
        file.offset === job.file.offset &&
        file.size === job.file.size
        ? job.prepared
        : null;
    } catch {
      return null;
    } finally {
      this.discard();
    }
  }

  keepAtlas(document, scene) {
    this.releaseAtlas();
    this.#atlasOwner = { document, scene };
  }

  releaseAtlas(document) {
    if (this.#atlasOwner && (document === undefined || this.#atlasOwner.document === document)) {
      this.#atlasOwner.document.discardPreparedAtlas();
      this.#atlasOwner = null;
    }
  }

  discard(scene) {
    if (scene === undefined || this.#atlasOwner?.scene === scene) this.releaseAtlas();

    if (this.#job && (scene === undefined || this.#job.scene === scene)) {
      this.#job.abort.abort();
      this.#job = null;
    }
  }
}
