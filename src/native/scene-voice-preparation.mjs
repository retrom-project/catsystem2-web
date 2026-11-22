// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';
import {
  GameFiles,
  hasMountedRangeBacking,
  matchesArchiveRange,
  captureArchiveRange,
} from '../files.mjs';

const MAX_PACKED = 384 * 1024;
const MAX_SAMPLES = 2 * 1024 * 1024;
const decoder = new TextDecoder('shift_jis');

function dialogueVoice(reader, block) {
  if (block < 0 || block >= reader.blockCount) return null;
  const { count } = reader.blockInfo(block);
  if (count < 4 || count > 64) return null;
  for (let line = 0; line < count - 3; line++) {
    if (reader.type(block, line) !== 0x30) return null;
    const source = decoder.decode(reader.text(block, line)).trim();
    const match = /^pcm[ \t]+([a-z0-9_]{1,60})(?:\.ogg)?$/i.exec(source);
    if (!match) {
      if (!/^(?:frameoff|wait|pl|rwipe|bg|eg|se)\b/i.test(source)) return null;
      continue;
    }
    if (
      reader.type(block, line + 1) !== 0x21 ||
      reader.type(block, line + 2) !== 0x20 ||
      reader.type(block, count - 1) !== 2
    )
      return null;
    for (let row = line + 3; row < count - 1; row++)
      if (reader.type(block, row) !== 0x20) return null;
    return { block, name: match[1].toLowerCase() };
  }
  return null;
}

function boundedVorbis(bytes) {
  const b = new Binary(bytes, 'Scene voice preparation');
  const header = 27 + b.u8(26);
  if (
    !b.magic('OggS') ||
    b.u8(5) !== 2 ||
    b.u8(27) !== 30 ||
    b.u8(header) !== 1 ||
    !b.magic('vorbis', header + 1) ||
    b.u32(header + 7) !== 0
  )
    return false;
  const channels = b.u8(header + 11),
    rate = b.u32(header + 12),
    blockSizes = b.u8(header + 28),
    smallBlock = blockSizes & 15,
    largeBlock = blockSizes >>> 4,
    serial = b.u32(14);
  if (
    channels < 1 ||
    channels > 2 ||
    rate < 8000 ||
    rate > 96000 ||
    smallBlock < 6 ||
    smallBlock > largeBlock ||
    largeBlock > 13
  )
    return false;
  // Vorbis overlaps successive blocks by at least half a block. Bound the
  // decoded allocation from the packet count and block size, even if a
  // container advertises an inaccurate final granule position.
  const samplesPerPacket = (1 << (largeBlock - 1)) * channels;
  let packets = 0,
    continues = false,
    sequence = 0;
  for (let at = 0; at < bytes.length; ) {
    const flags = b.u8(at + 5),
      segments = b.u8(at + 26);
    if (
      !segments ||
      !b.magic('OggS', at) ||
      b.u8(at + 4) !== 0 ||
      b.u32(at + 14) !== serial ||
      b.u32(at + 18) !== sequence++ ||
      Boolean(flags & 1) !== continues ||
      (at && flags & 2) ||
      flags & ~7
    )
      return false;
    let next = at + 27 + segments;
    for (let i = 0; i < segments; i++) {
      const size = b.u8(at + 27 + i);
      next += size;
      continues = size === 255;
      if (!continues) packets++;
    }
    if (next > bytes.length || (packets + 1) * samplesPerPacket > MAX_SAMPLES) return false;
    if (flags & 4) return next === bytes.length && !continues;
    at = next;
  }
  return false;
}

const sameMount = (a, b) => b && a.file === b.file && a.offset === b.offset && a.size === b.size;

export class SceneVoicePreparation {
  #loaded = new WeakMap();
  #job = null;
  #decoding = false;

  constructor(world, audio) {
    this.world = world;
    this.audio = audio;
  }

  loaded(scene, filename, success) {
    if (success) this.#loaded.set(scene, { filename, body: scene.reader.body, tried: new Set() });
    else this.#loaded.delete(scene);
    const job = this.#job;
    if (job?.scene !== scene) return;
    const body = scene.reader.body;
    if (
      !success ||
      !job.adjacent ||
      !job.buffer ||
      job.filename !== filename ||
      body.bytes.length !== job.body.bytes.length ||
      !body.bytes.every((byte, index) => byte === job.body.bytes[index])
    ) {
      this.discard();
    } else job.body = body;
  }

  #mount(name) {
    const { game } = this.audio;
    if (
      !(game instanceof GameFiles) ||
      game.require !== GameFiles.prototype.require ||
      game.read !== GameFiles.prototype.read ||
      game.lookup !== GameFiles.prototype.lookup ||
      game.resolveCategory !== GameFiles.prototype.resolveCategory
    )
      return null;
    const path = game.resolveCategory(name, 'sound');
    if (!path || !/\.ogg$/i.test(path)) return null;
    const hit = game.lookup(path),
      file = hit?.file;
    if (!hasMountedRangeBacking(file) || hit.size > MAX_PACKED || hit.size < 58) return null;
    return { file, offset: hit.offset, size: hit.size, key: path.toLowerCase() };
  }

  #active(job) {
    const { scene, owner, history } = job,
      { world } = this;
    return (
      !world.closed &&
      !world.disposalRequested &&
      world.runtime.scheduler.tasks.get(owner.id) === owner &&
      scene.reader.body === job.body &&
      scene.history.path.at(-1) === history &&
      (history.value === job.block || (job.adjacent && history.value === job.voice.block))
    );
  }

  hint(scene, ownerID, block) {
    const { world } = this,
      loaded = this.#loaded.get(scene),
      owner = world.runtime.scheduler.tasks.get(ownerID),
      history = scene.history.path.at(-1);
    if (
      !owner ||
      !history ||
      history.value !== block ||
      !loaded?.body ||
      scene.reader.body !== loaded.body ||
      loaded.body.bytes.length > 2 * 1024 * 1024
    )
      return false;
    if (this.#job) {
      if (this.#job.scene === scene && this.#job.owner === owner && this.#active(this.#job))
        return false;
      this.discard();
    }
    if (loaded.tried.has(block)) return false;
    loaded.tried.add(block);
    const { body, filename } = loaded;
    return this.#schedule({ scene, owner, history, block, body, filename }, block, false);
  }

  #schedule(scope, block, adjacent) {
    if (this.#job || this.#decoding || this.audio.context.state !== 'running') return false;
    try {
      const voice = dialogueVoice(scope.scene.reader, block);
      if (!voice) return false;
      const mount = this.#mount(voice.name);
      if (!mount || this.audio.pending.has(mount.key) || this.audio.buffers.has(mount.key))
        return false;
      const job = {
        scene: scope.scene,
        owner: scope.owner,
        history: scope.history,
        block: scope.block,
        body: scope.body,
        filename: scope.filename,
        voice,
        mount,
        adjacent,
        abort: new AbortController(),
        idle: null,
        buffer: null,
        opened: null,
      };
      if (!this.#active(job)) return false;
      job.idle = requestIdleCallback(() => void this.#prepare(job));
      this.#job = job;
      return true;
    } catch {
      return false;
    }
  }

  async #prepare(job) {
    job.idle = null;
    if (this.#job !== job) return;
    this.#decoding = true;
    try {
      if (!this.#active(job)) return;
      const { file, offset, size } = job.mount,
        range = captureArchiveRange(job.mount, this.audio.game.nativeSearch);
      const bytes = await file.read(offset, size, job.abort.signal);
      if (
        this.#job === job &&
        this.#active(job) &&
        sameMount(job.mount, this.#mount(job.voice.name)) &&
        boundedVorbis(bytes)
      ) {
        const buffer = await this.audio.decodeBuffer(bytes, MAX_SAMPLES);
        if (this.#job === job && this.#active(job)) {
          job.buffer = buffer;
          if (buffer && range && bytes instanceof Uint8Array && bytes.length === size)
            job.opened = { range, bytes };
        }
      }
    } catch {
      // A failed preparation leaves resource errors to the normal sound load.
    } finally {
      this.#decoding = false;
      if (this.#job === job && !job.buffer) this.discard();
    }
  }

  openedBytes(name, owner, hit) {
    const job = this.#job,
      opened = job?.opened;
    if (
      !opened ||
      job.owner !== owner ||
      job.mount.key !== name.toLowerCase() ||
      !this.#active(job) ||
      !matchesArchiveRange(opened.range, hit, this.audio.game.nativeSearch)
    )
      return null;
    // The one active job keeps the exact bytes from a successful mounted read.
    return opened.bytes;
  }

  take(file, ownerID) {
    const job = this.#job;
    if (!job || job.owner.id !== ownerID) return null;
    const key = file.toLowerCase();
    if (job.mount.key !== key) return null;
    let active = false;
    try {
      const mount = this.#mount(key);
      active = this.#active(job) && sameMount(job.mount, mount);
      if (
        active &&
        job.buffer &&
        (!job.opened ||
          matchesArchiveRange(job.opened.range, mount, this.audio.game.nativeSearch)) &&
        !this.audio.pending.has(key) &&
        !this.audio.buffers.has(key)
      )
        this.audio.rememberBuffer(key, job.buffer);
    } catch {
      active = false;
    } finally {
      this.discard();
    }
    if (!active || job.history.value !== job.voice.block) return null;
    // Chain from the block whose sound was actually requested. A same-name
    // sound in the preceding block does not advance the preparation cursor.
    job.block = job.voice.block;
    job.adjacent = false;
    return job;
  }

  continued(job) {
    // The script has now loaded the voiced dialogue in the active block. An
    // immediately adjacent block may start with another simple voiced page.
    if (this.#active(job)) this.#schedule(job, job.block + 1, true);
  }

  discard(scene) {
    const job = this.#job;
    if (!job || (scene && job.scene !== scene)) return;
    this.#job = null;
    if (job.idle !== null) cancelIdleCallback(job.idle);
    job.abort.abort();
    job.buffer = null;
    job.opened = null;
  }

  releaseOwner(ownerID) {
    if (this.#job?.owner.id === ownerID) this.discard();
  }
}
