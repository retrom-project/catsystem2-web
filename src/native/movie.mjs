// SPDX-License-Identifier: MPL-2.0
// Movie wrappers 655170..655600 / 521590..5219E0. DirectShow is a host boundary.
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';

export const NATIVE_MOVIE_IDS = Object.freeze([
  0x109, 0x10a, 0x10b, 0x10c, 0x10d, 0x10e, 0x1a1, 0x314, 0x3e4, 0x3e5, 0x3e6,
]);
const counts = new Map(NATIVE_MOVIE_IDS.map((id, i) => [id, [1, 2, 1, 1, 1, 1, 2, 5, 2, 2, 1][i]]));
export function nativeMovieDecibels(word) {
  const volume = word | 0;
  if (volume >= 100) return 0;
  if (volume <= 0) return -10000;
  const f = Math.fround,
    ratio = f(f(volume) * f(0.01));
  return Math.trunc(f(f(f(Math.log10(ratio)) * f(33.22)) * f(100)));
}
const position = (value) => BigInt.asIntN(64, BigInt(value));
const codec = {
  snapshot: (value) => structuredClone(value),
  restore: (value) => structuredClone(value),
};

export class NativeMovies {
  constructor({
    handles,
    create,
    inputGate,
    cursorGate,
    cursorVisible,
    dimensions,
    disabled = () => false,
    active = () => true,
    audio = () => ({ factor: 100, mute: false }),
    diagnostic = () => {},
    directShow = () => null,
  }) {
    Object.assign(this, {
      handles,
      create,
      inputGate,
      cursorGate,
      cursorVisible,
      dimensions,
      disabled,
      active,
      audio,
      diagnostic,
      directShow,
    });
    if (!handles.codecs.has('movie')) handles.registerType('movie', codec);
    this.sessions = new Map();
    this.renderGate = 0;
    this.clearBlack = false;
    this.activated = false;
    this.pending = Promise.resolve();
    this.failure = null;
  }
  exclusive(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch((error) => {
      this.failure ??= error;
    });
    return result;
  }
  async settle() {
    await this.pending;
    if (this.failure) throw this.failure;
    await this.directShow()?.update(this.activated);
  }
  callbacks(handle, adapter, filename) {
    adapter.ended = () => this.exclusive(() => this.ended(handle));
    adapter.error = (error) => {
      this.diagnostic({ type: 'movie-error', filename, message: error.message });
      return this.exclusive(() => this.ended(handle));
    };
  }
  gate(value, clear = false) {
    this.cursorGate(Number(!value));
    this.renderGate = Number(Boolean(value));
    if (clear) this.clearBlack = true;
  }
  get(handle) {
    return this.handles.get(handle, 'movie');
  }
  session(handle) {
    const session = this.sessions.get(handle);
    if (!session) throw new Error('Native movie host session is absent');
    return session;
  }
  async open(filename, owner) {
    if (this.disabled()) return 0;
    if (!this.create) throw new Error('Native movie decoder service is unavailable');
    const [width, height] = this.dimensions(),
      record = {
        filename,
        owner,
        prepared: false,
        running: false,
        repeat: 0,
        volume: 100,
        decibels: 0,
        rectangle: [0, 0, width, height],
        mode: 0xffffffff,
        windowVisible: false,
        position: 0n,
      },
      adapter = await this.create(filename, owner),
      handle = this.handles.add('movie', record);
    this.sessions.set(handle, adapter);
    try {
      await this.inputGate(owner, 0);
      this.gate(1);
      if (!(await adapter.open(filename))) {
        await this.inputGate(owner, 1);
        this.gate(0);
        await this.releaseSession(handle);
        this.handles.release(handle, 'movie');
        return 0;
      }
      record.prepared = true;
      this.callbacks(handle, adapter, filename);
      adapter.configure(record);
      if (this.activated) adapter.activate();
      return handle;
    } catch (error) {
      if (this.sessions.has(handle)) await this.releaseSession(handle);
      this.handles.release(handle, 'movie');
      await this.inputGate(owner, 1);
      this.gate(0);
      throw error;
    }
  }
  async play(handle, repeat) {
    const record = this.get(handle);
    if (!record.prepared || record.running) return 0;
    // The original sets running before IGraphControl::Run. A failed Run does
    // not roll this word back; stop is required before another play attempt.
    record.running = true;
    const session = this.session(handle);
    record.windowVisible = Boolean(record.mode);
    session.configure(record);
    if (!(await session.play())) return 0;
    record.repeat = repeat >>> 0;
    session.configure(record);
    return 1;
  }
  async stop(handle) {
    const record = this.get(handle);
    if (!record.prepared || !record.running) return 0;
    const session = this.session(handle);
    if (!(await session.stop())) return 0;
    record.running = false;
    record.windowVisible = false;
    record.position = position(session.position());
    session.configure(record);
    return 1;
  }
  async ended(handle) {
    if (!this.sessions.has(handle)) return;
    const record = this.get(handle),
      session = this.session(handle);
    if (!record.running) return;
    record.position = position(session.position());
    if (record.repeat !== 0xffffffff) record.repeat = (record.repeat - 1) >>> 0;
    if (record.repeat) {
      await session.seek(0n);
      record.position = 0n;
      await session.play();
    } else record.running = false;
    session.configure(record);
  }
  async closeHandle(handle, caller) {
    if (!handle) return 0;
    await this.stop(handle);
    await this.releaseSession(handle);
    this.handles.release(handle, 'movie');
    this.gate(0);
    this.cursorVisible(1);
    await this.inputGate(caller, 1);
    return 1;
  }
  async releaseSession(handle) {
    const session = this.sessions.get(handle);
    if (!session) return;
    this.sessions.delete(handle);
    session.ended = session.error = null;
    await session.close();
  }
  volume(handle, word) {
    const record = this.get(handle),
      settings = this.audio();
    if (!this.active())
      word = settings.mute ? 0 : Math.floor((Math.imul(word, settings.factor) >>> 0) / 100);
    record.volume = word >>> 0;
    record.decibels = nativeMovieDecibels(word);
    this.session(handle).configure(record);
  }
  rectangle(handle, x, y, width, height) {
    const record = this.get(handle);
    record.rectangle = [x | 0, y | 0, (x + width) | 0, (y + height) | 0];
    this.session(handle).configure(record);
  }
  mode(handle, word) {
    const record = this.get(handle);
    record.mode = word ? 0xffffffff : 0;
    record.windowVisible = Boolean(word);
    this.session(handle).configure(record);
  }
  capture() {
    for (const [handle, session] of this.sessions)
      this.get(handle).position = position(session.position());
  }
  snapshot() {
    this.capture();
    return { renderGate: this.renderGate, clearBlack: this.clearBlack };
  }
  async restore(state) {
    if (this.sessions.size) throw new Error('Native movie restore requires a fresh service');
    this.renderGate = state.renderGate;
    this.clearBlack = state.clearBlack;
    try {
      for (const [handle, { type, value: record }] of this.handles.records) {
        if (type !== 'movie') continue;
        const adapter = await this.create(record.filename, record.owner);
        this.sessions.set(handle, adapter);
        if (!(await adapter.open(record.filename)))
          throw new Error(`Cannot restore native movie ${record.filename}`);
        this.callbacks(handle, adapter, record.filename);
        await adapter.seek(position(record.position));
        adapter.configure(record);
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  activate() {
    if (this.activated) return;
    this.activated = true;
    for (const [handle, session] of this.sessions) {
      session.activate();
      const { running, filename } = this.get(handle);
      if (running)
        session
          .play()
          .then((ok) => {
            if (!ok) this.diagnostic({ type: 'movie-resume-failed', filename });
          })
          .catch((error) =>
            this.diagnostic({ type: 'movie-resume-failed', message: error.message }),
          );
    }
  }
  async close() {
    await this.pending;
    for (const handle of [...this.sessions.keys()]) await this.releaseSession(handle);
  }
}

export async function nativeMovie(id, args, machine, task, movies, format) {
  if (!counts.has(id)) return undefined;
  if (args.length !== counts.get(id))
    throw new Error(`Native movie 0x${id.toString(16)} expects ${counts.get(id)} arguments`);
  const result = (word) => nativeReply(1, word),
    handle = args[0];
  if (id === 0x109) {
    if (movies.disabled()) return result(0);
    return result(await movies.open(format(args[0], machine), task.id));
  }
  if (id === 0x10a) return result(handle ? await movies.play(handle, args[1]) : 0);
  if (id === 0x10b) return result(handle ? await movies.stop(handle) : 0);
  if (id === 0x10c) return result(await movies.closeHandle(handle, task.id));
  if (id === 0x10d)
    return result(handle ? Number(movies.get(handle).prepared && movies.get(handle).running) : 0);
  if (id === 0x3e6)
    return result(
      handle ? Number(BigInt.asUintN(32, position(movies.session(handle).position()) / 10000n)) : 0,
    );
  if (handle) {
    if (id === 0x10e) movies.session(handle).redraw();
    else if (id === 0x1a1) movies.volume(handle, args[1]);
    else if (id === 0x314) movies.rectangle(handle, ...args.slice(1));
    else if (id === 0x3e4) movies.mode(handle, args[1]);
    else if (id === 0x3e5) movies.gate(!args[1], !args[1]);
  }
  return nativeReply(2);
}

export function installNativeMovies(world) {
  world.movies = new NativeMovies({
    handles: world.runtime.handles,
    create: world.host.nativeMovie
      ? (name, owner) => world.host.nativeMovie(name, owner, world)
      : null,
    disabled: () => Boolean(world.configuration.fields.general.disableMovie),
    active: () =>
      world.host.nativeWindowActive ? world.host.nativeWindowActive(world) : world.input.foreground,
    audio: () => {
      const b = world.configuration.blocks[0],
        view = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return {
        factor: view.getUint32(0, true),
        mute: Boolean(view.getUint32(5608, true) || view.getUint32(5612, true)),
      };
    },
    inputGate: async (owner, enabled) => {
      const input = await world.sendEngine(
        0,
        owner,
        nativeABI(world.profile).messages.movieInput.query,
      );
      if (input === NATIVE_UNWRITTEN_WORD)
        throw new Error('Native movie has no initialized InputTask identity');
      await world.sendEngine(
        input,
        owner,
        nativeABI(world.profile).messages.movieInput.gate,
        0,
        enabled,
      );
    },
    cursorGate: (word) => {
      world.graphics.cursorAllowed = word;
    },
    cursorVisible: (word) => world.graphics.cursor.setVisible(word),
    dimensions: () => [world.graphics.view.clientWidth, world.graphics.view.clientHeight],
    diagnostic: (detail) => world.host.nativeDiagnostic?.(detail),
    directShow: () => world.nativeEngine?.features.get('directshow'),
  });
  for (const id of NATIVE_MOVIE_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      world.movies.exclusive(async () => {
        if (
          id !== 0x109 &&
          id !== 0x3e5 &&
          world.runtime.handles.records.get(args[0])?.type === 'plane-movie'
        )
          return (await world.getNativeFeature('plane-movie-commands')).control(id, args, task);
        return nativeMovie(id, args, machine, task, world.movies, (at, machine) => {
          const name = world.runtime.services.format(at, machine);
          return world.runtime.services.resourceFilename(name, 'movie') ?? '';
        });
      }),
    );
}
