// SPDX-License-Identifier: MPL-2.0
// Renderless Plane movies borrow the shared movie controls and bitmap authority.
import { nativeABI } from './abi/index.mjs';
import { readNativeResource } from './resource-file.mjs';
import { binaryIdentity as nativeImageIdentity } from '../identity.mjs';
import { NativeHapPlayback } from './movie-hap-playback.mjs';
import { nativeWebMTracks } from './movie-webm.mjs';
import { nativeOggTracks } from './movie-ogg.mjs';
import { asfHeaderSize, nativeASFProfile, nativeASFSeekable } from './movie-asf.mjs';
import { nativeASFSamples } from './movie-asf-samples.mjs';

const type = 'plane-movie';
const powerOfTwo = (value) => 2 ** Math.ceil(Math.log2(value));
const extension = (name) => name.split('.').at(-1).toLowerCase();

async function sourceInfo(filename, bytes) {
  const kind = extension(filename);
  if (kind === 'webm' || kind === 'ogv' || kind === 'ogg') {
    const { tracks } = kind === 'webm' ? nativeWebMTracks(bytes) : nativeOggTracks(bytes);
    return {
      kind,
      renderable: Boolean(tracks?.some((track) => track.type === 1)),
      audioEnabled: Boolean(tracks?.some((track) => track.type === 2)),
    };
  }
  if (kind === 'wmv') {
    // Reuse the accepted reader's actual headers/samples and Start bounds;
    // a seekable browser sidecar does not make an unindexed ASF seekable.
    const length = asfHeaderSize(bytes, bytes.length),
      profile = nativeASFProfile(
        bytes.subarray(0, length),
        bytes.subarray(length, length + 50),
        BigInt(bytes.length),
      ),
      video = profile.streams.find((stream) => stream.kind === 'video' && !stream.encrypted),
      seekable = await nativeASFSeekable(profile, BigInt(bytes.length), async (at, count) =>
        bytes.subarray(Number(at), Number(at) + count),
      );
    let sample = false;
    if (video)
      for (const entry of nativeASFSamples(bytes, profile))
        if (entry.number === video.number) {
          sample = true;
          break;
        }
    return {
      kind,
      renderable: sample,
      audioEnabled: profile.streams.some((stream) => stream.kind === 'audio' && stream.selected),
      wmv: {
        duration: profile.duration,
        seekable,
        width: video?.width ?? 0,
        height: video?.height ?? 0,
      },
    };
  }
  return { kind, renderable: true, audioEnabled: true };
}

export class NativePlaneMovies {
  constructor(world) {
    this.world = world;
    this.loads = new Map();
    this.frames = new Map();
    world.runtime.handles.registerType(type, {
      snapshot: (value) => structuredClone(value),
      restore: (value) => structuredClone(value),
    });
  }
  get handles() {
    return this.world.runtime.handles;
  }
  get movies() {
    return this.world.movies;
  }
  alive(token) {
    return (
      !this.closed &&
      !this.world.disposalRequested &&
      this.loads.get(token.owner) === token &&
      this.world.objects.objects.get(token.owner)?.implementation === token.plane
    );
  }
  check(token) {
    if (!this.alive(token)) throw new Error('Plane movie owner closed during media I/O');
  }
  async adapter(record) {
    if (!record.source.renderable) return null;
    if (extension(record.filename) === 'hap') {
      if (!nativeABI(this.world.profile).capabilities.hapMovieAnsiDriverPath) return null;
      const player = new NativeHapPlayback({
        clock: () => this.world.clock.performanceCounter() * 10n,
        audioContext: this.world.audio?.context,
        diagnostic: (detail) => this.world.host.nativeDiagnostic?.(detail),
      });
      player.configure = (state) => player.volume(state.decibels);
      return player;
    }
    if (!this.world.host.nativeMovie) throw new Error('Plane movie decoder service is unavailable');
    const adapter = await this.world.host.nativeMovie(record.filename, record.owner, this.world);
    if (record.source.wmv) {
      const seek = adapter.seek,
        { duration, seekable } = record.source.wmv;
      adapter.seek = function (at) {
        if (at < 0n || (at && !seekable) || at / 10000n > duration / 10000n)
          throw new Error('Plane Windows Media reader rejected the saved seek position');
        return seek.call(this, at);
      };
    }
    return adapter;
  }
  async load(plane, mode, _position, filename) {
    const owner = plane.record.id;
    await this.release(plane);
    if (this.closed || this.world.disposalRequested || plane.nativeClosed)
      throw new Error('Plane movie owner is closing');
    if (plane.state.vramType !== 1 || (!mode && this.movies.disabled())) return null;
    if (
      extension(filename) === 'wmv' &&
      !nativeABI(this.world.profile).capabilities.windowsMediaReader
    )
      return null;
    const token = { owner, plane },
      record = {
        owner,
        filename,
        planeMode: mode,
        mode: 0xffffffff,
        prepared: false,
        running: false,
        repeat: 0,
        volume: 100,
        decibels: 0,
        rectangle: [0, 0, 0, 0],
        windowVisible: false,
        position: 0n,
        width: 0,
        height: 0,
        bitmap: 0,
        frameStamp: null,
        sha256: null,
      };
    this.loads.set(owner, token);
    let handle = 0,
      adapter;
    try {
      const bytes = await readNativeResource(this.world, filename, 3);
      this.check(token);
      if (bytes === null) return null;
      record.sha256 = await nativeImageIdentity(bytes);
      this.check(token);
      record.source = await sourceInfo(filename, bytes);
      this.check(token);
      adapter = await this.adapter(record);
      this.check(token);
      handle = this.handles.add(type, record);
      token.handle = handle;
      if (adapter) {
        this.movies.sessions.set(handle, adapter);
        const opened = await adapter.open(filename, {
          bytes,
          sha256: record.sha256,
          audioEnabled: record.source.audioEnabled,
        });
        this.check(token);
        if (opened) {
          const video = adapter.metadata();
          if (
            !Number.isSafeInteger(video.width) ||
            video.width < 1 ||
            !Number.isSafeInteger(video.height) ||
            video.height < 1 ||
            typeof video.duration !== 'bigint' ||
            video.duration < 0n
          )
            throw new Error('Plane movie decoder returned invalid dimensions or duration');
          if (
            record.source.wmv &&
            (video.width !== record.source.wmv.width || video.height !== record.source.wmv.height)
          )
            throw new Error('Plane Windows Media frame differs from the actual ASF video stream');
          Object.assign(record, {
            width: video.width,
            height: video.height,
            video: structuredClone(video),
            prepared: true,
          });
          record.rectangle = [0, 0, video.width, video.height];
          record.bitmap = this.world.graphics.images.create(
            powerOfTwo(video.width),
            powerOfTwo(video.height),
            { type, handle },
          );
          this.movies.callbacks(handle, adapter, filename);
          adapter.configure(record);
          await this.updateFrame(handle, adapter);
          this.check(token);
        } else await this.movies.releaseSession(handle);
      }
      return { handle, mode, width: record.width, height: record.height };
    } catch (error) {
      if (handle && this.handles.records.has(handle)) await this.releaseHandle(handle);
      else if (adapter) await adapter.close();
      throw error;
    } finally {
      if (this.loads.get(owner) === token) this.loads.delete(owner);
    }
  }
  async resume(handle, { playback = true } = {}) {
    const record = this.handles.get(handle, type);
    if (!record.prepared || this.movies.sessions.has(handle))
      return this.movies.sessions.get(handle);
    const plane = this.world.objects.objects.get(record.owner)?.implementation;
    if (!plane || plane.nativeClosed || this.closed) throw new Error('Plane movie lost its owner');
    const token = { owner: record.owner, plane, handle };
    this.loads.set(record.owner, token);
    let adapter;
    try {
      const bytes = await readNativeResource(this.world, record.filename, 3);
      this.check(token);
      if (bytes === null || (await nativeImageIdentity(bytes)) !== record.sha256)
        throw new Error('Restored Plane movie source differs from its mounted resource');
      this.check(token);
      adapter = await this.adapter(record);
      this.check(token);
      if (
        !adapter ||
        !(await adapter.open(record.filename, {
          bytes,
          sha256: record.sha256,
          audioEnabled: record.source.audioEnabled,
        }))
      )
        throw new Error('Cannot restore the prepared Plane movie decoder');
      this.check(token);
      const video = adapter.metadata();
      if (
        video.width !== record.video.width ||
        video.height !== record.video.height ||
        video.duration !== record.video.duration ||
        video.alpha !== record.video.alpha
      )
        throw new Error('Restored Plane movie decoder metadata differs');
      await adapter.seek(record.position);
      this.check(token);
      adapter.configure(record);
      this.movies.callbacks(handle, adapter, record.filename);
      if (playback && record.running && !(await adapter.play()))
        throw new Error('Restored Plane movie could not resume playback');
      this.check(token);
      this.movies.sessions.set(handle, adapter);
      return adapter;
    } catch (error) {
      await adapter?.close();
      throw error;
    } finally {
      if (this.loads.get(record.owner) === token) this.loads.delete(record.owner);
    }
  }
  async updateFrame(handle, adapter) {
    const record = this.handles.get(handle, type),
      stamp = adapter.frameStamp();
    if (stamp === record.frameStamp) return;
    const decoded = await adapter.decodedFrame();
    if (this.handles.records.get(handle)?.value !== record || this.closed)
      throw new Error('Plane movie closed during frame decoding');
    if (
      decoded.width !== record.width ||
      decoded.height !== record.height ||
      decoded.rgba.length !== decoded.width * decoded.height * 4
    )
      throw new Error('Plane movie frame differs from its negotiated dimensions');
    const bitmap = this.world.graphics.images.get(record.bitmap),
      output = await bitmap.pixels();
    output.fill(0);
    if (!record.planeMode) for (let i = 3; i < output.length; i += 4) output[i] = 255;
    for (let y = 0; y < decoded.height; y++)
      for (let x = 0; x < decoded.width; x++) {
        const from = (y * decoded.width + x) * 4,
          to = (y * bitmap.width + x) * 4;
        output.set(decoded.rgba.subarray(from, from + 4), to);
        if (!record.planeMode || !record.video.alpha) output[to + 3] = 255;
      }
    await bitmap.changed();
    record.frameStamp = stamp;
  }
  async retainedFrame(source) {
    const record = this.handles.get(source.handle, type);
    if (!record.prepared) return null;
    const bitmap = this.world.graphics.images.get(record.bitmap);
    let frame = this.frames.get(source.handle);
    if (!frame) this.frames.set(source.handle, (frame = {}));
    Object.assign(frame, {
      width: bitmap.width,
      height: bitmap.height,
      rgba: await bitmap.pixels(),
      revision: bitmap.state.revision,
    });
    return frame;
  }
  async frame(source) {
    const adapter = await this.resume(source.handle);
    if (adapter) await this.updateFrame(source.handle, adapter);
    return this.retainedFrame(source);
  }
  async settle() {
    for (const [handle, session] of this.movies.sessions) {
      if (this.handles.records.get(handle)?.type === type) session.advance?.();
    }
  }
  assertSettled() {
    if (this.loads.size) throw new Error('Plane movie checkpoint requires settled media I/O');
  }
  restore() {
    for (const [handle, entry] of this.handles.records) {
      if (entry.type !== type) continue;
      if (typeof entry.value !== 'object' || entry.value === null) {
        if (this.world.nativeEngine && Number.isInteger(entry.value)) continue;
        throw new Error('Ordinary Plane movie checkpoint cannot contain an original pointer');
      }
      const record = entry.value,
        plane = this.world.graphics.tasks.get(record.owner);
      if (
        ![0, 1].includes(record.planeMode) ||
        typeof record.filename !== 'string' ||
        !/^[0-9a-f]{64}$/.test(record.sha256) ||
        typeof record.prepared !== 'boolean' ||
        typeof record.running !== 'boolean' ||
        typeof record.position !== 'bigint' ||
        record.source?.kind !== extension(record.filename) ||
        typeof record.source.renderable !== 'boolean' ||
        typeof record.source.audioEnabled !== 'boolean' ||
        (record.prepared && !record.source.renderable)
      )
        throw new Error('Invalid Plane movie checkpoint state');
      if (
        !plane ||
        plane.graph?.movie?.handle !== handle ||
        plane.graph.movie.mode !== record.planeMode
      )
        throw new Error('Plane movie checkpoint lost its actual graph owner');
      if (record.prepared) {
        const bitmap = this.world.graphics.images.get(record.bitmap);
        if (
          bitmap.width !== powerOfTwo(record.width) ||
          bitmap.height !== powerOfTwo(record.height) ||
          bitmap.owner?.type !== type ||
          bitmap.owner.handle !== handle
        )
          throw new Error('Plane movie checkpoint bitmap owner differs');
      } else if (record.bitmap || record.running)
        throw new Error('Unprepared Plane movie checkpoint has live playback');
    }
  }
  async releaseHandle(handle) {
    const record = this.handles.get(handle, type);
    this.handles.release(handle, type);
    const frame = this.frames.get(handle);
    if (frame) this.world.getNativeGPU()?.releaseTextureFrame(frame);
    this.frames.delete(handle);
    if (record.bitmap) this.world.graphics.images.release(record.bitmap);
    await this.movies.releaseSession(handle);
  }
  async release(plane) {
    this.loads.delete(plane.record.id);
    if (plane.graph?.movie?.handle) plane.unload();
    for (const [handle, record] of [...this.handles.records])
      if (
        record.type === type &&
        typeof record.value === 'object' &&
        record.value.owner === plane.record.id
      )
        await this.releaseHandle(handle);
  }
  async close() {
    this.closed = true;
    this.loads.clear();
    for (const [handle, record] of [...this.handles.records])
      if (record.type === type && typeof record.value === 'object')
        await this.releaseHandle(handle);
  }
}
