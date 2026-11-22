// SPDX-License-Identifier: MPL-2.0
import { hasMountedRangeBacking } from '../files.mjs';
import { HG3 } from '../formats/hg3.mjs';
import { nativeABI } from './abi/index.mjs';
import { NativeFileStorage } from './storage.mjs';
import { acquireSceneWorker, canPrepareSceneWorker } from './scene-workers.mjs';

const decoder = new TextDecoder('shift_jis');
const MAX_PACKED = 8 * 1024 * 1024;
const MAX_RGBA = 24 * 1024 * 1024;

function sameMount(a, b) {
  return a.file === b.file && a.offset === b.offset && a.size === b.size;
}

function mountedImage(images, name) {
  const { game, resourceCache, storage } = images.world,
    path = images.images.resolve(name);
  if (
    path === null ||
    (storage?.read && storage.read !== NativeFileStorage.prototype.read) ||
    resourceCache?.entries.some(({ filename }) => filename.toLowerCase() === path.toLowerCase())
  )
    return null;
  for (const candidate of game.nativeCandidates(path, 3)) {
    let hit = candidate.hit;
    if (candidate.kind === 'loose' && storage?.read) {
      const stored = storage.mountedHit(candidate.path);
      if (stored === undefined) return null;
      hit = stored ?? hit;
    }
    if (hit) return hasMountedRangeBacking(hit.file) ? hit : null;
  }
  return null;
}

function blockImages(images, reader, block) {
  const { count } = reader.blockInfo(block);
  if (count > 64) return null;
  let backgrounds = 0,
    packed = 0;
  const items = [];
  for (let line = 0; line < count; line++) {
    if (reader.type(block, line) !== 0x30) continue;
    const text = decoder.decode(reader.text(block, line));
    if (/^\s*(?:mpl|if|else|jump|call)\b/i.test(text)) return null;
    if (!/^\s*(?:bg|eg)\b/i.test(text)) continue;
    const match = /^\s*(bg|eg)\s+\d+\s+([a-z0-9_]+)(?:\.hg3)?\s*$/i.exec(text);
    if (!match) return null;
    if (match[1].toLowerCase() === 'bg') backgrounds++;
    const name = match[2].toLowerCase(),
      hit = mountedImage(images, name);
    if (
      !hit ||
      hit.size < 64 * 1024 ||
      hit.size > MAX_PACKED / 2 ||
      images.assets.has(name + ':0') ||
      items.some((item) => sameMount(item.hit, hit))
    )
      return null;
    packed += hit.size;
    items.push({ name, hit, read: null, rgba: null, claimed: false });
    if (items.length > 5 || packed > MAX_PACKED) return null;
  }
  return backgrounds === 1 && items.length >= 2 ? items : null;
}

export class SceneImagePreparation {
  #loaded = new WeakMap();
  #requested = new WeakMap();
  #prepared = new WeakMap();
  #job = null;
  #running = false;

  constructor(images) {
    this.images = images;
  }

  loaded(scene) {
    this.#loaded.set(scene, scene.reader.body);
  }

  #current(job) {
    const { world } = this.images,
      history = job.scene.history.path.at(-1);
    return (
      this.#job === job &&
      !job.abort.signal.aborted &&
      !world.closed &&
      !world.disposalRequested &&
      job.scene.reader.body === job.body &&
      world.runtime.scheduler.tasks.get(job.owner.id) === job.owner &&
      history === job.history &&
      history?.value === job.historyValue
    );
  }

  hint(scene, ownerID, block) {
    const { world } = this.images,
      { reader } = scene;
    if (
      !canPrepareSceneWorker(world, 'image') ||
      world.closed ||
      world.disposalRequested ||
      world.transitionalExe ||
      nativeABI(world.profile).engineVersion !== '2.6.1.76' ||
      typeof world.game.nativeCandidates !== 'function' ||
      !reader.body ||
      this.#loaded.get(scene) !== reader.body ||
      reader.body.bytes.length > 2 * 1024 * 1024 ||
      !Number.isInteger(block) ||
      block < 0 ||
      block >= reader.blockCount
    )
      return false;
    const owner = world.runtime.scheduler.tasks.get(ownerID),
      history = scene.history.path.at(-1);
    if (!owner || !history) return false;
    if (this.#job?.body === reader.body && this.#job.block === block && this.#current(this.#job))
      return false;
    this.discard();
    if (this.#running) return false;
    let requested = this.#requested.get(reader.body);
    if (!requested) {
      requested = new Set();
      this.#requested.set(reader.body, requested);
    }
    if (requested.has(block)) return false;
    requested.add(block);
    let items;
    try {
      items = blockImages(this.images, reader, block);
    } catch {
      return false;
    }
    if (!items) return false;

    const job = {
      scene,
      body: reader.body,
      block,
      owner,
      history,
      historyValue: history.value,
      items,
      abort: new AbortController(),
    };
    this.#job = job;
    this.#running = true;
    void this.#run(job)
      .catch(() => {
        if (this.#job === job) this.discard();
      })
      .finally(() => {
        this.#running = false;
        if (this.#job === job && !this.#current(job)) this.discard();
      });
    return true;
  }

  async #run(job) {
    const { signal } = job.abort,
      world = this.images.world,
      { resourceCache } = world;
    let worker,
      remaining = MAX_RGBA;
    try {
      // Existing queue operations can change which mounted files are resident.
      if (resourceCache?.pending) await resourceCache.lock;
      for (const item of job.items) {
        if (!this.#current(job)) break;
        if (item.claimed) continue;
        const hit = mountedImage(this.images, item.name);
        if (!hit || !sameMount(item.hit, hit)) continue;
        const { file, offset, size } = item.hit;
        item.read = file.read(offset, size, signal).catch(() => null);
        const bytes = await item.read;
        if (!bytes || item.claimed || !this.#current(job)) continue;
        worker ??= acquireSceneWorker(world, 'image');
        if (!worker) return;
        const copy = bytes.slice();
        job.decoding = item;
        const result = await worker.send({ bytes: copy, remaining }, [copy.buffer], signal);
        job.decoding = null;
        if (!this.#current(job) || item.claimed || !(result?.rgba instanceof Uint8ClampedArray))
          continue;
        const { width, height, rgba } = result;
        if (rgba.length !== width * height * 4 || rgba.length > remaining) continue;
        item.rgba = result;
        remaining -= rgba.length;
      }
    } finally {
      worker?.release();
    }
  }

  read(hit) {
    const job = this.#job,
      item = job?.items.find((item) => sameMount(hit, item.hit));
    if (!item || item.claimed || !this.#current(job)) return hit.file.read(hit.offset, hit.size);
    item.claimed = true;
    if (!item.read) return hit.file.read(hit.offset, hit.size);
    const read = item.read;
    item.read = null;
    // When this file is demanded during its speculative decode, keep the
    // already fetched bytes and let the ordinary decoder run just once.
    if (job.decoding === item) this.discard();
    return read.then((bytes) => {
      if (!bytes) return hit.file.read(hit.offset, hit.size);
      if (item.rgba && this.#current(job)) this.#prepared.set(bytes, item.rgba);
      item.rgba = null;
      return bytes;
    });
  }

  apply(image, frame) {
    if (!(image instanceof HG3)) return false;
    const bytes = image.binary.bytes,
      ready = this.#prepared.get(bytes);
    if (!ready) return false;
    this.#prepared.delete(bytes);
    if (
      frame.rgba ||
      frame.id !== 0 ||
      frame.width !== ready.width ||
      frame.height !== ready.height
    )
      return false;
    frame.rgba = ready.rgba;
    return true;
  }

  discard(scene) {
    const job = this.#job;
    if (!job || (scene !== undefined && scene !== job.scene)) return;
    this.#job = null;
    job.abort.abort();
    for (const item of job.items) {
      item.read = null;
      item.rgba = null;
    }
    this.#prepared = new WeakMap();
  }
}
