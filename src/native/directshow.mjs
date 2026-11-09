// SPDX-License-Identifier: MPL-2.0
// DirectShow connection boundary for the original renderless SimplePlane movie.
import { nativeImageIdentity } from './engine-process.mjs';
import { writeMoviePixels } from './movie-texture-renderer.mjs';
import { WEBM_CONVERTERS } from './movie-webm.mjs';
import {
  MOVIE_FILTER_CONTRACTS,
  MOVIE_FILTER_GUIDS,
  NativeMovieFilters,
} from './movie-split-filters.mjs';
import {
  NativeWindowsMediaReader,
  WM_READER_CONTRACTS,
  WM_READER_GUIDS,
  WM_READER_PROFILE,
} from './movie-wmreader.mjs';

const E_NOINTERFACE = 0x80004002;
const E_POINTER = 0x80004003;
const E_ABORT = 0x80004004;
const E_FAIL = 0x80004005;
const E_INVALIDARG = 0x80070057;
const E_NOTIMPL = 0x80004001;
const VFW_E_CANNOT_RENDER = 0x80040218;
const VFW_E_WRONG_STATE = 0x80040227;
const FORMAT_MEDIA_TIME = [0x7b785574, 0x11cf8c82, 0xaa000cbc, 0xf674ac00];
const FILTER_GRAPH = [0xe436ebb3, 0x11ce524f, 0x2000539f, 0x70a70baf];
const VMR9 = [0x51b4abf3, 0x4e3b748f, 0x28c876a2, 0x6a920e33];
const UNKNOWN = [0, 0, 0xc0, 0x46000000];
const NOTIFY = [0xdca3f5df, 0x4d03bb3a, 0x618481bd, 0x0cfafb4b];
const directShow = (word) => [word, 0x11ce0ad4, 0x20003ab0, 0x70a70baf];
const ASYNC_READER = directShow(0x56a868aa);
const GUIDS = {
  ...MOVIE_FILTER_GUIDS,
  ...WM_READER_GUIDS,
  graph: [directShow(0x56a8689f), directShow(0x56a868a9)],
  control: [directShow(0x56a868b1)],
  seeking: [[0x36b73880, 0x11cfc2c8, 0x8000468b, 0x60ef6c5f]],
  event: [directShow(0x56a868c0), directShow(0x56a868b6)],
  eventSink: [directShow(0x56a868a2)],
  audio: [directShow(0x56a868b3)],
  video: [directShow(0x56a868b5)],
  filter: [directShow(0x56a86895)],
  config: [[0x5a804648, 0x48674f66, 0x5c4f439c, 0xb8f12c82]],
};
const CONTRACTS = {
  ...MOVIE_FILTER_CONTRACTS,
  ...WM_READER_CONTRACTS,
  graph: [
    18,
    { 3: ['addFilter', 2], 4: ['removeFilter', 1], 7: ['connectDirect', 3], 12: ['renderPin', 1] },
  ],
  control: [
    16,
    {
      7: ['run', 0],
      8: ['pause', 0],
      9: ['stop', 0],
      10: ['getState', 2],
      15: ['stopWhenReady', 0],
    },
  ],
  seeking: [
    20,
    {
      9: ['setTimeFormat', 1],
      10: ['getDuration', 1],
      12: ['getPosition', 1],
      14: ['setPositions', 4],
    },
  ],
  event: [16, { 9: ['waitForCompletion', 2] }],
  eventSink: [4, { 3: ['notifyEvent', 3] }],
  audio: [11, { 7: ['setVolume', 1], 8: ['getVolume', 1] }],
  video: [39, { 10: ['getWidth', 1], 11: ['getHeight', 1], 34: ['getVideoSize', 2] }],
  filter: [15, {}],
  config: [
    10,
    {
      4: ['setStreams', 1],
      5: ['getStreams', 1],
      8: ['setMode', 1],
      9: ['getMode', 1],
    },
  ],
};
const IUNKNOWN = [
  ['queryInterface', 2],
  ['addRef', 0],
  ['release', 0],
];
const GRAPH_INTERFACES = ['graph', 'control', 'seeking', 'event', 'eventSink', 'audio', 'video'];
const FILTER_INTERFACES = ['filter', 'config'];
const FAILED = (result) => (result | 0) < 0;

export class NativeDirectShow {
  constructor(engine, world, vmr) {
    Object.assign(this, { engine, world, vmr, process: engine.process });
    this.objects = new Map();
    this.interfaces = new Map();
    this.tables = new Map();
    this.decoders = new Map();
    this.samples = new Map();
    engine.registerWindows('OLE32.dll', 'CoCreateInstance', {
      count: 5,
      fn: (args) => this.createInstance(...args),
    });
    this.splitFilters = new NativeMovieFilters(this, UNKNOWN);
    if (engine.profile === WM_READER_PROFILE) this.wmReader = new NativeWindowsMediaReader(this);
    engine.registerFeature('directshow', this);
  }
  guid(address, value) {
    return address && value.every((word, index) => this.process.load(address + 4 * index) === word);
  }
  definition(kind, slot) {
    const [name, count] = IUNKNOWN[slot] ?? CONTRACTS[kind][1][slot] ?? [null, 0],
      service =
        slot < 3
          ? this
          : WM_READER_CONTRACTS[kind]
            ? this.wmReader
            : MOVIE_FILTER_CONTRACTS[kind]
              ? this.splitFilters
              : this;
    return {
      name: `DirectShow ${kind} slot ${slot}`,
      args: count + 1,
      real: false,
      handler: ([pointer, ...args]) => {
        const receiver = this.interfaces.get(pointer);
        if (receiver?.kind !== kind) throw new Error('DirectShow interface identity is absent');
        if (!name) throw new Error(`Unimplemented DirectShow ${kind} slot ${slot}`);
        return service[name](this.objects.get(receiver.primary), ...args);
      },
    };
  }
  table(kind) {
    if (!this.tables.has(kind)) {
      const p = this.process,
        slots = CONTRACTS[kind][0],
        table = p.allocate(slots * 4, true);
      for (let slot = 0; slot < slots; slot++) {
        const { name, args, handler } = this.definition(kind, slot);
        p.store(table + slot * 4, p.trap(name, args, handler));
      }
      this.tables.set(kind, table);
    }
    return this.tables.get(kind);
  }
  recoverTrap(trap) {
    const match = /^DirectShow (\w+) slot (\d+)$/.exec(trap.name);
    if (!match) return null;
    const [, kind, slot] = match;
    return CONTRACTS[kind] && Number(slot) < CONTRACTS[kind][0]
      ? this.definition(kind, Number(slot))
      : null;
  }
  call(pointer, slot, ...args) {
    const p = this.process,
      address = p.load(p.load(pointer) + slot * 4),
      call = p.asyncEnabled ? 'callFromHost' : 'call';
    return this.engine[call](address, [pointer, ...args]);
  }
  create(kinds, data) {
    const p = this.process,
      interfaces = {};
    for (const kind of kinds) {
      const pointer = p.allocate(4, true);
      p.store(pointer, this.table(kind));
      interfaces[kind] = pointer;
    }
    const primary = interfaces[kinds[0]],
      record = { primary, interfaces, references: 1, ...data };
    for (const kind of kinds) this.interfaces.set(interfaces[kind], { primary, kind });
    this.objects.set(primary, record);
    return record;
  }
  createInstance(clsid, outer, context, iid, output) {
    if (!output) return E_POINTER;
    const p = this.process;
    p.store(output, 0);
    if (!clsid || !iid) return E_POINTER;
    if (outer || ![1, 3].includes(context)) return E_INVALIDARG;
    if (!this.engine.kernel.comDepth) return 0x800401f0;
    let record;
    if (this.guid(clsid, FILTER_GRAPH)) {
      if (!GUIDS.graph.some((guid) => this.guid(iid, guid))) return E_NOINTERFACE;
      // The reviewed kcVideo passes its first field as the out parameter.
      if (p.allocations.get(output) !== 0x1b4)
        throw new Error('DirectShow FilterGraph requires its original kcVideo owner');
      record = this.create(GRAPH_INTERFACES, {
        movie: output,
        filename: p.string(output + 108),
        owner: this.engine.currentTaskID,
        source: 0,
        filter: 0,
        textureFilter: 0,
        video: null,
        sha256: null,
        position: 0n,
        exhausted: false,
        volume: 0,
        state: 0,
        events: [],
      });
    } else if (this.guid(clsid, VMR9)) {
      if (!this.guid(iid, GUIDS.filter[0])) return E_NOINTERFACE;
      record = this.create(FILTER_INTERFACES, {
        notify: this.vmr.create(),
        mode: 1,
        streams: 0,
        graph: 0,
      });
    } else {
      const converter = [...WEBM_CONVERTERS].find(([, guid]) => this.guid(clsid, guid));
      if (!converter) throw new Error('Unimplemented native DirectShow COM class');
      if (!this.guid(iid, GUIDS.filter[0])) return E_NOINTERFACE;
      record = this.splitFilters.createFilter(converter[0]);
    }
    p.store(output, record.primary);
    return 0;
  }
  queryInterface(record, iid, output) {
    if (!output) return E_POINTER;
    const p = this.process;
    p.store(output, 0);
    if (!iid) return E_POINTER;
    if (record.notify && record.mode === 4 && this.guid(iid, NOTIFY)) {
      this.vmr.addRef(this.vmr.record(record.notify));
      p.store(output, record.notify);
      return 0;
    }
    const kind = Object.keys(record.interfaces).find((name) =>
        GUIDS[name].some((guid) => this.guid(iid, guid)),
      ),
      pointer = kind ? record.interfaces[kind] : this.guid(iid, UNKNOWN) ? record.primary : 0;
    if (!pointer) return E_NOINTERFACE;
    this.addRef(record);
    p.store(output, pointer);
    return 0;
  }
  addRef(record) {
    if (record.parentFilter) return this.addRef(this.objects.get(record.parentFilter));
    return ++record.references;
  }
  async release(record) {
    if (record.parentFilter) return this.release(this.objects.get(record.parentFilter));
    if (record.references > 1) return --record.references;
    await this.destroy(record);
    return 0;
  }
  async destroy(record) {
    if (record.notify) {
      await this.vmr.disconnect(record.notify);
      if (record.movieNotify) await this.vmr.call(record.notify, 2);
      await this.vmr.call(record.notify, 2);
    } else if (record.movie) {
      const adapter = this.decoders.get(record.primary);
      if (adapter) {
        this.decoders.delete(record.primary);
        this.samples.delete(record.primary);
        adapter.ended = adapter.error = null;
        await adapter.close();
      }
      if (record.filter) await this.removeFilter(record, record.filter);
      if (record.textureFilter) await this.removeFilter(record, record.textureFilter);
      if (record.wmFilter) await this.removeFilter(record, record.wmFilter);
      if (record.source) await this.removeFilter(record, record.source);
      for (const pointer of Object.values(record.splitFilters ?? {}))
        await this.removeFilter(record, pointer);
    } else if (!record.windowsMediaReader && !record.windowsMediaStream)
      await this.splitFilters.destroy(record);
    this.freeInterfaces(record);
  }
  freeInterfaces(record) {
    for (const pointer of Object.values(record.interfaces)) {
      this.interfaces.delete(pointer);
      this.process.free(pointer);
    }
    this.objects.delete(record.primary);
  }
  async addFilter(graph, pointer, name) {
    if (!pointer) return E_POINTER;
    const filter = this.objects.get(pointer);
    if (filter?.role) return this.splitFilters.addFilter(graph, filter, name);
    if (filter?.notify) {
      if (
        graph.filter ||
        graph.textureFilter ||
        filter.graph ||
        filter.mode !== 4 ||
        filter.streams !== 1
      )
        return VFW_E_WRONG_STATE;
      this.addRef(filter);
      graph.filter = pointer;
      filter.graph = graph.primary;
      const p = this.process,
        { cookie } = this.vmr.record(filter.notify);
      // The original loader saves its Notify query at +0x144 in the
      // movie record passed as the allocator cookie. Its destructor
      // releases the filter and allocator, leaving that query reference.
      filter.movieNotify =
        cookie !== 0 && p.load(cookie) === graph.movie && p.load(cookie + 0x144) === filter.notify;
      this.vmr.bindEventSink(filter.notify, graph.interfaces.eventSink);
      return 0;
    }
    const source = !graph.source && pointer === this.process.load(graph.movie + 384) + 12,
      texture = this.engine.features.get('texture-movie-renderer')?.matches(pointer),
      reader = this.wmReader?.filter(pointer);
    if (!source && !texture && !reader) return E_NOTIMPL;
    if (texture && (graph.filter || graph.textureFilter)) return VFW_E_WRONG_STATE;
    await this.call(pointer, 1);
    const result = await this.call(pointer, 13, graph.primary, name);
    if (FAILED(result)) await this.call(pointer, 2);
    else if (source) graph.source = pointer;
    else if (texture) graph.textureFilter = pointer;
    else await this.wmReader.attach(graph, reader);
    return result;
  }
  async removeFilter(graph, pointer) {
    if (!pointer) return E_POINTER;
    const filter = this.objects.get(pointer);
    if (filter?.role) return this.splitFilters.removeFilter(graph, filter);
    if (graph.filter === pointer) {
      await this.vmr.disconnect(filter.notify);
      graph.filter = 0;
      filter.graph = 0;
      await this.release(filter);
      return 0;
    }
    if (graph.source !== pointer && graph.textureFilter !== pointer && graph.wmFilter !== pointer)
      return E_INVALIDARG;
    if (graph.source === pointer) await this.splitFilters.disconnectSource(graph);
    const result = await this.call(pointer, 13, 0, 0);
    if (!FAILED(result)) {
      if (graph.source === pointer) graph.source = 0;
      else if (graph.wmFilter === pointer) await this.wmReader.detach(graph);
      else graph.textureFilter = 0;
      await this.call(pointer, 2);
    }
    return result;
  }
  setMode(record, mode) {
    if (record.graph) return VFW_E_WRONG_STATE;
    if (mode !== 4) return E_NOTIMPL;
    record.mode = mode;
    return 0;
  }
  setStreams(record, count) {
    if (record.graph) return VFW_E_WRONG_STATE;
    if (count !== 1) return E_NOTIMPL;
    record.streams = count;
    return 0;
  }
  word(output, value) {
    if (!output) return E_POINTER;
    this.process.store(output, value);
    return 0;
  }
  getMode(record, output) {
    return this.word(output, record.mode);
  }
  getStreams(record, output) {
    return this.word(output, record.streams);
  }
  async stream(graph, pin) {
    const p = this.process,
      layout = this.engine.features.get('engine-files').layout,
      stream = p.load(graph.movie + 380),
      file = p.load(stream + 316);
    if (p.allocations.get(file) !== layout.size)
      throw new Error('DirectShow source does not own a mounted IFile');
    const data = p.load(file + layout.data),
      length = p.load(file + layout.length),
      scratch = p.allocate(48, true);
    let reader = 0;
    try {
      ASYNC_READER.forEach((word, i) => p.store(scratch + 4 * i, word));
      const query = await this.call(pin, 0, scratch, scratch + 16);
      if (FAILED(query)) throw new Error('Original movie output pin has no IAsyncReader');
      reader = p.load(scratch + 16);
      const lengthStatus = await this.call(reader, 8, scratch, scratch + 8);
      if (
        FAILED(lengthStatus) ||
        p.load(scratch) !== length ||
        p.load(scratch + 4) ||
        p.load(scratch + 8) !== length ||
        p.load(scratch + 12)
      )
        throw new Error('Original movie reader length differs from its mounted IFile');
      const size = Math.min(16, length);
      const status = await this.call(reader, 7, 0, 0, size, scratch + 32);
      const prefix = p.read(data, size);
      if (status || !p.read(scratch + 32, size).every((byte, i) => byte === prefix[i]))
        throw new Error('Original movie reader bytes differ from its mounted IFile');
    } finally {
      if (reader) await this.call(reader, 2);
      p.free(scratch);
    }
    return p.view(data, length);
  }
  async decoder(graph, bytes) {
    if (this.decoders.has(graph.primary)) return this.decoders.get(graph.primary);
    if (!this.world.host.nativeMovie) throw new Error('Native plane movie decoder is unavailable');
    const sha256 = await nativeImageIdentity(bytes);
    if (graph.sha256 && sha256 !== graph.sha256)
      throw new Error('Restored DirectShow source differs from the original reader');
    const adapter = await this.world.host.nativeMovie(graph.filename, graph.owner, this.world);
    try {
      if (
        !(await adapter.open(graph.filename, {
          bytes,
          sha256,
          audioEnabled: graph.audioEnabled,
          mime: graph.mime,
        }))
      ) {
        await adapter.close();
        return null;
      }
      const video = adapter.metadata();
      if (
        graph.video &&
        (video.width !== graph.video.width ||
          video.height !== graph.video.height ||
          video.duration !== graph.video.duration)
      )
        throw new Error('Restored DirectShow decoder metadata differs');
      if (graph.position) await adapter.seek(graph.position);
      adapter.volume(graph.volume);
      const terminal = (code) => {
        if (this.decoders.get(graph.primary) === adapter && graph.state === 2)
          this.notifyEvent(graph, code, 0, 0);
      };
      adapter.ended = () => {
        graph.exhausted = true;
        terminal(1);
      };
      adapter.error = (error) => {
        this.world.host.nativeDiagnostic?.({
          type: 'movie-error',
          filename: graph.filename,
          message: error.message,
        });
        terminal(3);
      };
      Object.assign(graph, { video, sha256 });
      this.decoders.set(graph.primary, adapter);
      return adapter;
    } catch (error) {
      await adapter.close();
      throw error;
    }
  }
  async renderPin(graph, pin) {
    if (!pin || !graph.source || (!graph.filter && !graph.textureFilter))
      return VFW_E_CANNOT_RENDER;
    const output = this.objects.get(pin);
    if (output?.parentFilter) return this.splitFilters.renderPin(graph, output);
    if (graph.wmFilter) return this.wmReader.renderPin(graph, pin);
    if (pin !== graph.source + 248) return VFW_E_CANNOT_RENDER;
    return this.connectMedia(graph, pin);
  }
  connectDirect(graph, source, input, mediaType) {
    return this.splitFilters.connectDirect(graph, source, input, mediaType);
  }
  async connectMedia(graph, pin) {
    if (graph.video) return VFW_E_WRONG_STATE;
    const bytes = await this.stream(graph, pin),
      decoder = await this.decoder(graph, bytes);
    if (!decoder) return VFW_E_CANNOT_RENDER;
    const result = graph.textureFilter
      ? await this.engine.features
          .get('texture-movie-renderer')
          .configure(graph.textureFilter, graph.video)
      : await this.vmr.initialize(this.objects.get(graph.filter).notify, graph.video);
    if (FAILED(result)) {
      this.decoders.delete(graph.primary);
      graph.video = null;
      graph.sha256 = null;
      await decoder.close();
    }
    return result;
  }
  async presentFrame(graph, preroll = false) {
    const decoder = this.decoders.get(graph.primary),
      stamp = decoder.frameStamp(),
      frame = await decoder.decodedFrame(),
      result = graph.textureFilter
        ? await this.engine.features
            .get('texture-movie-renderer')
            .present(graph.textureFilter, frame)
        : await this.presentVMRFrame(graph, frame, preroll);
    if (!FAILED(result)) this.samples.set(graph.primary, stamp);
    return result;
  }
  async presentVMRFrame(graph, frame, preroll) {
    const { notify } = this.objects.get(graph.filter),
      surface = this.vmr.record(notify).surfaces[0],
      p = this.process,
      data = this.vmr.device.surfaceData(surface);
    if (
      frame.width !== graph.video.width ||
      frame.height !== graph.video.height ||
      frame.width > data.width ||
      frame.height > data.height ||
      data.format !== 22
    )
      throw new Error('DirectShow decoder frame differs from its negotiated surface');
    const info = p.allocate(80, true),
      lock = info + 72;
    try {
      const locked = await this.call(surface, 13, lock, 0, 0);
      if (FAILED(locked)) return locked;
      let unlocked;
      try {
        writeMoviePixels(p, frame, p.load(lock + 4), p.load(lock));
      } finally {
        unlocked = await this.call(surface, 14);
      }
      if (FAILED(unlocked)) return unlocked;
      p.store(info, preroll ? 0x12 : 0x10);
      [
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
      ].forEach((word, i) => p.store(info + 24 + 4 * i, word));
      return await this.vmr.present(notify, 0, info);
    } finally {
      p.free(info);
    }
  }
  resumeDecoder(graph) {
    return (
      this.decoders.get(graph.primary) ??
      this.stream(graph, graph.source + 248).then((bytes) => this.decoder(graph, bytes))
    );
  }
  startPresentation(graph) {
    if (graph.textureFilter) return 0;
    const { notify } = this.objects.get(graph.filter);
    return this.vmr.record(notify).presenting ? 0 : this.vmr.start(notify);
  }
  async run(graph) {
    if (!graph.video) return VFW_E_WRONG_STATE;
    if (graph.state === 2 && this.decoders.has(graph.primary)) return 0;
    const decoder = await this.resumeDecoder(graph);
    if (!decoder) return VFW_E_CANNOT_RENDER;
    const result = await this.startPresentation(graph);
    if (FAILED(result)) return result;
    if (graph.wmFilter) {
      const state = await this.wmReader.changeState(graph, 2);
      if (FAILED(state)) return state;
    }
    if (!graph.exhausted && !(await decoder.play())) return E_FAIL;
    graph.state = 2;
    return 0;
  }
  async pause(graph) {
    if (!graph.video) return VFW_E_WRONG_STATE;
    const decoder = await this.resumeDecoder(graph);
    if (!decoder) return VFW_E_CANNOT_RENDER;
    if (!(await decoder.stop())) return VFW_E_WRONG_STATE;
    const started = await this.startPresentation(graph);
    if (FAILED(started)) return started;
    if (graph.wmFilter) {
      const state = await this.wmReader.changeState(graph, 1);
      if (FAILED(state)) return state;
    }
    const result = await this.presentFrame(graph, true);
    if (!FAILED(result)) graph.state = 1;
    return result;
  }
  async stop(graph) {
    const decoder = this.decoders.get(graph.primary);
    if (decoder && !(await decoder.stop())) return VFW_E_WRONG_STATE;
    if (graph.wmFilter) {
      const state = await this.wmReader.changeState(graph, 0);
      if (FAILED(state)) return state;
    }
    if (graph.filter) {
      const { notify } = this.objects.get(graph.filter);
      if (this.vmr.record(notify).presenting) {
        const result = await this.vmr.stop(notify);
        if (FAILED(result)) return result;
      }
    }
    graph.state = 0;
    graph.events.length = 0;
    return 0;
  }
  async stopWhenReady(graph) {
    const result = await this.pause(graph);
    return FAILED(result) ? result : this.stop(graph);
  }
  getState(graph, _timeout, output) {
    return this.word(output, graph.state);
  }
  setTimeFormat(_graph, guid) {
    return this.guid(guid, FORMAT_MEDIA_TIME) ? 0 : E_INVALIDARG;
  }
  getDuration(graph, output) {
    if (!output) return E_POINTER;
    if (!graph.video) return VFW_E_WRONG_STATE;
    this.engine.kernel.write64(output, graph.wmDuration ?? graph.video.duration);
    return 0;
  }
  getPosition(graph, output) {
    if (!output) return E_POINTER;
    this.engine.kernel.write64(
      output,
      this.decoders.get(graph.primary)?.position() ?? graph.position,
    );
    return 0;
  }
  async setPositions(graph, current, currentFlags, stop, stopFlags) {
    if (stop || stopFlags || ![1, 5].includes(currentFlags)) return E_NOTIMPL;
    if (!current) return E_POINTER;
    if (!graph.video) return VFW_E_WRONG_STATE;
    const p = this.process,
      position = BigInt.asIntN(64, (BigInt(p.load(current + 4)) << 32n) | BigInt(p.load(current)));
    const duration = graph.wmDuration ?? graph.video.duration;
    if (position < 0n || position > duration) return E_INVALIDARG;
    const decoder = await this.resumeDecoder(graph);
    if (!decoder) return VFW_E_CANNOT_RENDER;
    await decoder.seek(position);
    graph.position = position;
    graph.exhausted = position === duration;
    graph.events.length = 0;
    this.samples.delete(graph.primary);
    return 0;
  }
  setVolume(graph, word) {
    const volume = word | 0;
    if (volume < -10000 || volume > 0) return E_INVALIDARG;
    graph.volume = volume;
    this.decoders.get(graph.primary)?.volume(volume);
    return 0;
  }
  getVolume(graph, output) {
    return this.word(output, graph.volume);
  }
  getWidth(graph, output) {
    return graph.video ? this.word(output, graph.video.width) : VFW_E_WRONG_STATE;
  }
  getHeight(graph, output) {
    return graph.video ? this.word(output, graph.video.height) : VFW_E_WRONG_STATE;
  }
  getVideoSize(graph, width, height) {
    if (!width || !height) return E_POINTER;
    const status = this.getWidth(graph, width);
    return status || this.getHeight(graph, height);
  }
  notifyEvent(graph, code, param1, param2) {
    graph.events.push([code, param1, param2]);
    return 0;
  }
  terminalEvent(graph) {
    return graph.events.findIndex(([code]) => code >= 1 && code <= 3);
  }
  waitForCompletion(graph, _timeout, output) {
    if (!output) return E_POINTER;
    if (graph.state !== 2) return VFW_E_WRONG_STATE;
    const index = this.terminalEvent(graph);
    if (index < 0) {
      graph.events.length = 0;
      return E_ABORT;
    }
    const code = graph.events[index][0];
    graph.events.splice(0, index + 1);
    return this.word(output, code);
  }
  async update(activated) {
    if (!this.updating)
      this.updating = this.updateMovies(activated).finally(() => {
        this.updating = null;
      });
    await this.updating;
  }
  async updateMovies(activated) {
    const p = this.process,
      workers = this.engine.features.get('engine-workers');
    for (const graph of this.objects.values()) {
      if (!graph.movie || !p.load(graph.movie + 372)) continue;
      const decoder = this.decoders.get(graph.primary);
      if (!decoder && !activated) continue;
      if (graph.state === 2) {
        if (!decoder) {
          const result = await this.run(graph);
          if (FAILED(result))
            throw new Error(`Restored Plane movie could not resume: ${graph.filename}`);
        }
        if (graph.wmFilter)
          await this.wmReader.advance(graph, this.decoders.get(graph.primary).position());
        if (this.decoders.get(graph.primary).frameStamp() !== this.samples.get(graph.primary)) {
          const result = await this.presentFrame(graph);
          if (FAILED(result)) throw new Error(`Plane movie presentation failed: ${graph.filename}`);
        }
      }
      const thread = p.load(graph.movie + 388),
        handle = thread && p.load(thread),
        worker = workers.threads.get(handle);
      if (worker && (worker.polling ? graph.state !== 2 : this.terminalEvent(graph) >= 0))
        await workers.step(handle);
    }
  }
  snapshot() {
    if (this.updating) throw new Error('Cannot checkpoint a running Plane movie update');
    return structuredClone({
      tables: [...this.tables],
      objects: [...this.objects].map(([pointer, record]) => [
        pointer,
        { ...record, position: this.decoders.get(pointer)?.position() ?? record.position },
      ]),
    });
  }
  restore(state) {
    const p = this.process;
    this.tables = new Map(state.tables);
    for (const [kind, table] of this.tables) {
      const contract = CONTRACTS[kind];
      if (!contract || p.allocations.get(table) !== contract[0] * 4)
        throw new Error('Invalid DirectShow checkpoint interface table');
      for (let slot = 0; slot < contract[0]; slot++)
        if (p.traps.get(p.load(table + slot * 4))?.name !== this.definition(kind, slot).name)
          throw new Error('Invalid DirectShow checkpoint interface method');
    }
    this.objects = new Map(structuredClone(state.objects));
    this.interfaces.clear();
    for (const [primary, record] of this.objects) {
      if (record.primary !== primary || record.references < 1)
        throw new Error('Invalid DirectShow checkpoint identity');
      for (const [kind, pointer] of Object.entries(record.interfaces)) {
        if (
          p.allocations.get(pointer) !== 4 ||
          p.load(pointer) !== this.tables.get(kind) ||
          this.interfaces.has(pointer)
        )
          throw new Error('Invalid DirectShow checkpoint vtable');
        this.interfaces.set(pointer, { primary, kind });
      }
    }
  }
  async close() {
    for (const record of [...this.objects.values()]) {
      if (record.movie) await this.destroy(record);
    }
    for (const record of [...this.objects.values()])
      if (!record.parentFilter && this.objects.has(record.primary)) await this.destroy(record);
    for (const table of this.tables.values()) this.process.free(table);
    this.tables.clear();
  }
}
