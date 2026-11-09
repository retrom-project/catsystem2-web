// SPDX-License-Identifier: MPL-2.0
// DirectShow splitters and decoder pins hosted for the original movie loader.
import { nativeWebMTracks, WEBM_CLASSES } from './movie-webm.mjs';
import { nativeOggTracks, OGG_CLASSES, OGG_INPUT_TYPE, oggPacketType } from './movie-ogg.mjs';

const SPLITTERS = {
  splitter: {
    name: 'webm',
    tracks: nativeWebMTracks,
    decoders: { V_VP8: 'vpx', V_VP9: 'vpx', A_VORBIS: 'vorbis' },
  },
  'ogg-splitter': {
    name: 'ogg',
    tracks: nativeOggTracks,
    decoders: { theora: 'theora', vorbis: 'ogg-vorbis' },
    inputType: OGG_INPUT_TYPE,
    packetType: oggPacketType,
  },
};

const directShow = (word) => [word, 0x11ce0ad4, 0x20003ab0, 0x70a70baf];
const NULL_GUID = [0, 0, 0, 0];
const MEDIATYPE_STREAM = [0xe436eb83, 0x11ce524f, 0x2000539f, 0x70a70baf];
const E_NOINTERFACE = 0x80004002;
const E_POINTER = 0x80004003;
const E_OUTOFMEMORY = 0x8007000e;
const E_NOTIMPL = 0x80004001;
const CLASS_E_NOAGGREGATION = 0x80040110;
const CLASS_E_CLASSNOTAVAILABLE = 0x80040111;
const VFW_E_ENUM_OUT_OF_SYNC = 0x80040203;
const VFW_E_ALREADY_CONNECTED = 0x80040204;
const VFW_E_NOT_CONNECTED = 0x80040209;
const VFW_E_CANNOT_RENDER = 0x80040218;
const VFW_E_NOT_STOPPED = 0x80040224;
const VFW_E_WRONG_STATE = 0x80040227;
const VFW_E_TYPE_NOT_ACCEPTED = 0x8004022a;
const VFW_E_INVALID_FILE_FORMAT = 0x8004022f;
const VFW_E_NOT_IN_GRAPH = 0x8004025f;
const FAILED = (status) => (status | 0) < 0;
const AM_MEDIA_TYPE_BYTES = 72;

export const MOVIE_FILTER_GUIDS = {
  splitFactory: [[1, 0, 0xc0, 0x46000000]],
  splitFilter: [directShow(0x56a86895)],
  splitPin: [directShow(0x56a86891)],
  splitPins: [directShow(0x56a86892)],
  splitMediaTypes: [[0x89c31040, 0x11ce846b, 0xaa00d397, 0x5a595500]],
};

export const MOVIE_FILTER_CONTRACTS = {
  splitFactory: [5, { 3: ['createInstance', 3] }],
  splitFilter: [15, { 10: ['enumPins', 1] }],
  splitPin: [
    18,
    {
      4: ['receiveConnection', 2],
      5: ['disconnect', 0],
      6: ['connectedTo', 1],
      7: ['connectionMediaType', 1],
      9: ['queryDirection', 1],
      11: ['queryAccept', 1],
      12: ['enumMediaTypes', 1],
    },
  ],
  splitPins: [7, { 3: ['nextPin', 3] }],
  splitMediaTypes: [7, { 3: ['nextMediaType', 3], 5: ['resetMediaTypes', 0] }],
};

export class NativeMovieFilters {
  constructor(graphs, unknownIID) {
    Object.assign(this, { graphs, p: graphs.process, unknownIID });
    const kernel = graphs.engine.kernel;
    for (const [dll, [role, clsid]] of [...WEBM_CLASSES, ...OGG_CLASSES]) {
      const DllGetClassObject = kernel.register(dll, 'DllGetClassObject', {
        count: 3,
        fn: ([requested, iid, out]) => {
          if (!out) return E_POINTER;
          this.p.store(out, 0);
          if (!graphs.guid(requested, clsid)) return CLASS_E_CLASSNOTAVAILABLE;
          if (
            !graphs.guid(iid, unknownIID) &&
            !graphs.guid(iid, MOVIE_FILTER_GUIDS.splitFactory[0])
          )
            return E_NOINTERFACE;
          return graphs.word(out, graphs.create(['splitFactory'], { factoryRole: role }).primary);
        },
      });
      kernel.registerHostModule(dll, { DllGetClassObject });
    }
  }
  createInstance(factory, outer, iid, out) {
    if (!out) return E_POINTER;
    this.p.store(out, 0);
    if (outer) return CLASS_E_NOAGGREGATION;
    if (
      !this.graphs.guid(iid, this.unknownIID) &&
      !this.graphs.guid(iid, MOVIE_FILTER_GUIDS.splitFilter[0])
    )
      return E_NOINTERFACE;
    return this.graphs.word(out, this.createFilter(factory.factoryRole).primary);
  }
  createFilter(role) {
    const filter = this.graphs.create(['splitFilter'], { role, pins: [], pinVersion: 0, graph: 0 });
    this.pin(filter, 0);
    if (!SPLITTERS[role]) this.pin(filter, 1);
    return filter;
  }
  pin(filter, direction, track) {
    const pin = this.graphs.create(['splitPin'], {
      parentFilter: filter.primary,
      direction,
      peer: 0,
      ...(track ? { track } : {}),
    });
    filter.pins.push(pin.primary);
    filter.pinVersion++;
    return pin;
  }
  addFilter(graph, filter, name) {
    graph.splitFilters ??= {};
    if (
      filter.graph ||
      graph.splitFilters[filter.role] ||
      (SPLITTERS[filter.role] && this.splitter(graph))
    )
      return VFW_E_WRONG_STATE;
    filter.name = name ? this.p.string(name, true) : '';
    filter.graph = graph.primary;
    graph.splitFilters[filter.role] = filter.primary;
    this.graphs.addRef(filter);
    return 0;
  }
  async removeFilter(graph, filter) {
    if (filter.graph !== graph.primary) return VFW_E_NOT_IN_GRAPH;
    await this.disconnectFilter(filter);
    delete graph.splitFilters[filter.role];
    filter.graph = 0;
    await this.graphs.release(filter);
    return 0;
  }
  enumPins(filter, out) {
    if (!out) return E_POINTER;
    const iterator = this.graphs.create(['splitPins'], {
      enumeratedFilter: filter.primary,
      version: filter.pinVersion,
      index: 0,
    });
    this.graphs.addRef(filter);
    return this.graphs.word(out, iterator.primary);
  }
  nextPin(iterator, count, out, fetched) {
    if (!out || (!fetched && count !== 1)) return E_POINTER;
    const filter = this.graphs.objects.get(iterator.enumeratedFilter);
    if (filter.pinVersion !== iterator.version) return VFW_E_ENUM_OUT_OF_SYNC;
    const length = Math.min(count, filter.pins.length - iterator.index);
    for (let i = 0; i < length; i++) {
      const pointer = filter.pins[iterator.index++];
      this.graphs.addRef(this.graphs.objects.get(pointer));
      this.p.store(out + i * 4, pointer);
    }
    if (fetched) this.p.store(fetched, length);
    return length === count ? 0 : 1;
  }
  splitter(graph) {
    return this.graphs.objects.get(
      graph.splitFilters?.splitter ?? graph.splitFilters?.['ogg-splitter'],
    );
  }
  enumMediaTypes(pin, out) {
    if (!out) return E_POINTER;
    const filter = this.graphs.objects.get(pin.parentFilter),
      policy = SPLITTERS[filter.role];
    if (!policy) return E_NOTIMPL;
    const type = pin.direction === 0 ? policy.inputType : policy.packetType?.(pin.track);
    const iterator = this.graphs.create(['splitMediaTypes'], {
      enumeratedFilter: filter.primary,
      types: type ? [type] : [],
      index: 0,
    });
    this.graphs.addRef(filter);
    return this.graphs.word(out, iterator.primary);
  }
  writeMediaType(out, type) {
    const memory = this.graphs.engine.kernel.comMemory,
      format = type.format ? memory.allocate(type.format.length) : 0;
    if (type.format && !format) return E_OUTOFMEMORY;
    if (format) this.p.write(format, type.format);
    type.words.forEach((word, index) => this.p.store(out + index * 4, word));
    this.p.store(out + 68, format);
    return 0;
  }
  nextMediaType(iterator, count, out, fetched) {
    if (!out || (!fetched && count !== 1)) return E_POINTER;
    if (fetched) this.p.store(fetched, 0);
    if (!count) return 0;
    // The two splitter inputs and the Ogg output pins advertise at most one type.
    const type = iterator.types[iterator.index];
    if (!type) return 1;
    const memory = this.graphs.engine.kernel.comMemory,
      pointer = memory.allocate(AM_MEDIA_TYPE_BYTES);
    if (!pointer) return E_OUTOFMEMORY;
    const status = this.writeMediaType(pointer, type);
    if (FAILED(status)) {
      memory.free(pointer);
      return status;
    }
    iterator.index++;
    this.p.store(out, pointer);
    if (fetched) this.p.store(fetched, 1);
    return count === 1 ? 0 : 1;
  }
  resetMediaTypes(iterator) {
    iterator.index = 0;
    return 0;
  }
  queryDirection(pin, out) {
    return this.graphs.word(out, pin.direction);
  }
  queryAccept(pin, type) {
    if (!type) return E_POINTER;
    const filter = this.graphs.objects.get(pin.parentFilter),
      policy = SPLITTERS[filter.role];
    return policy &&
      pin.direction === 0 &&
      (this.graphs.guid(type, MEDIATYPE_STREAM) ||
        (policy.inputType && this.graphs.guid(type, NULL_GUID)))
      ? 0
      : 1;
  }
  connectionMediaType(pin, out) {
    if (!out) return E_POINTER;
    if (!pin.peer) return VFW_E_NOT_CONNECTED;
    if (pin.mediaType) {
      this.p.write(out, pin.mediaType);
      return 0;
    }
    const track = pin.track ?? this.graphs.objects.get(pin.peer)?.track;
    return track?.identifier ? this.writeMediaType(out, oggPacketType(track)) : E_NOTIMPL;
  }
  async connectedTo(pin, out) {
    if (!out) return E_POINTER;
    this.p.store(out, 0);
    if (!pin.peer) return VFW_E_NOT_CONNECTED;
    const peer = this.graphs.objects.get(pin.peer);
    if (peer) this.graphs.addRef(peer);
    else await this.graphs.call(pin.peer, 1);
    return this.graphs.word(out, pin.peer);
  }
  async connectDirect(graph, source, input, mediaType) {
    if (!source || !input) return E_POINTER;
    const splitter = this.splitter(graph);
    if (!graph.source || source !== graph.source + 248 || input !== splitter?.pins[0])
      return VFW_E_NOT_IN_GRAPH;
    if (graph.state !== 0) return VFW_E_NOT_STOPPED;
    return this.graphs.call(source, 3, input, mediaType);
  }
  async receiveConnection(pin, source, mediaType) {
    if (!source || !mediaType) return E_POINTER;
    if (pin.peer) return VFW_E_ALREADY_CONNECTED;
    const filter = this.graphs.objects.get(pin.parentFilter),
      graph = this.graphs.objects.get(filter.graph),
      policy = SPLITTERS[filter.role];
    if (!policy || pin.direction !== 0) return E_NOTIMPL;
    if (!graph || graph.source + 248 !== source) return VFW_E_NOT_IN_GRAPH;
    if (graph.state !== 0) return VFW_E_NOT_STOPPED;
    if (
      (!this.graphs.guid(mediaType, NULL_GUID) && this.queryAccept(pin, mediaType)) ||
      this.p.load(mediaType + 60) ||
      this.p.load(mediaType + 64)
    )
      return VFW_E_TYPE_NOT_ACCEPTED;
    const type = this.p.read(mediaType, AM_MEDIA_TYPE_BYTES),
      bytes = await this.graphs.stream(graph, source),
      { tracks, error, status } = policy.tracks(bytes);
    const failure =
      error ??
      (tracks.some(({ type }) => type === 1) ? null : 'Movie has no supported video track');
    if (failure) {
      this.graphs.world.host.nativeDiagnostic?.({
        type: `movie-${policy.name}-stream-unavailable`,
        filename: graph.filename,
        message: failure,
      });
      return status ?? VFW_E_INVALID_FILE_FORMAT;
    }
    await this.graphs.call(source, 1);
    pin.peer = source;
    pin.mediaType = type;
    graph.audioEnabled = tracks.some(({ type }) => type === 2);
    if (policy.name === 'ogg')
      graph.mime = graph.audioEnabled
        ? 'video/ogg; codecs="theora, vorbis"'
        : 'video/ogg; codecs="theora"';
    for (const track of tracks) this.pin(filter, 1, track);
    return 0;
  }
  async renderPin(graph, output) {
    const splitter = this.splitter(graph),
      decoderRole = SPLITTERS[splitter?.role]?.decoders[output.track?.codec],
      decoder = this.graphs.objects.get(graph.splitFilters?.[decoderRole]),
      input = this.graphs.objects.get(decoder?.pins[0]);
    if (output.parentFilter !== splitter?.primary || !output.track || !input)
      return VFW_E_CANNOT_RENDER;
    if (input.peer || output.peer) return VFW_E_ALREADY_CONNECTED;
    if (output.track.type === 1) {
      const status = await this.graphs.connectMedia(graph, graph.source + 248);
      if (FAILED(status)) return status;
    }
    input.peer = output.primary;
    output.peer = input.primary;
    this.graphs.addRef(input);
    this.graphs.addRef(output);
    return 0;
  }
  async disconnect(pin) {
    if (!pin.peer) return 1;
    const previous = pin.peer,
      peer = this.graphs.objects.get(previous);
    pin.peer = 0;
    delete pin.mediaType;
    if (peer) {
      peer.peer = 0;
      await this.graphs.release(peer);
      await this.graphs.release(pin);
    } else {
      const filter = this.graphs.objects.get(pin.parentFilter);
      for (const pointer of filter.pins.splice(1)) {
        const output = this.graphs.objects.get(pointer);
        await this.disconnect(output);
        this.graphs.freeInterfaces(output);
      }
      filter.pinVersion++;
      await this.graphs.call(previous, 2);
    }
    return 0;
  }
  async disconnectFilter(filter) {
    const input = this.graphs.objects.get(filter.pins[0]);
    if (SPLITTERS[filter.role] && input.peer) {
      // The original CBasePin stores a reference to the hosted input pin.
      // Clear its side before retiring our reference to its original output.
      const result = await this.graphs.call(input.peer, 5);
      if (FAILED(result)) throw new Error('Original WebM source did not disconnect');
    }
    for (const pointer of filter.pins.slice()) {
      const pin = this.graphs.objects.get(pointer);
      if (pin) await this.disconnect(pin);
    }
  }
  async disconnectSource(graph) {
    const splitter = this.splitter(graph);
    if (splitter) await this.disconnectFilter(splitter);
  }
  async destroy(record) {
    if (record.enumeratedFilter) {
      const filter = this.graphs.objects.get(record.enumeratedFilter);
      if (filter) await this.graphs.release(filter);
    }
    if (record.role) {
      await this.disconnectFilter(record);
      for (const pointer of record.pins)
        this.graphs.freeInterfaces(this.graphs.objects.get(pointer));
    }
  }
}
