// SPDX-License-Identifier: MPL-2.0
// WebM split/decoder DLL boundary used by the original kcVideo loader.
const WEBM_CLASSES = new Map([
  ['webmsplit.dll', ['splitter', [0xed3110f8, 0x11df5211, 0x2600af94, 0xaaee77b9]]],
  ['vpxdecoder.dll', ['vpx', [0xbddb6a11, 0x46d89d65, 0x76f34e82, 0x8a4a4ed6]]],
  ['webmvorbisdecoder.dll', ['vorbis', [0xed311103, 0x11df5211, 0x2600af94, 0xaaee77b9]]],
]);

export const WEBM_CONVERTERS = new Map([
  ['avi-decompressor', [0xcf49d4e0, 0x11ce1115, 0x20003ab0, 0x70a70baf]],
  ['color-space-converter', [0x1643e180, 0x11ce90f5, 0xaa00d597, 0x5a595500]],
]);

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const TRACK = 0xae;
const HEADER_LIMITS = {
  0x4286: [1, 1],
  0x42f2: [1, 8],
  0x42f3: [1, 8],
  0x4287: [1, Infinity],
  0x4285: [1, 2],
};
const ascii = new TextDecoder();

class WebMHeaderError extends Error {}

function vint(bytes, offset, end, id) {
  let marker = 0x80,
    length = 1;
  while (length <= 8 && !(bytes[offset] & marker)) {
    marker >>= 1;
    length++;
  }
  if (offset + length > end || length > (id ? 4 : 8))
    throw new WebMHeaderError('Invalid EBML element header');
  let value = id ? bytes[offset] : bytes[offset] & (marker - 1),
    unknown = !id && value === marker - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[offset + i];
    unknown &&= bytes[offset + i] === 255;
  }
  return [unknown ? null : value, offset + length];
}

function* elements(bytes, start, end) {
  while (start < end) {
    const [id, sizeStart] = vint(bytes, start, end, true),
      [size, data] = vint(bytes, sizeStart, end, false),
      next = size === null ? end : data + size;
    if (
      !Number.isSafeInteger(next) ||
      next > end ||
      (size === null && id !== SEGMENT && id !== CLUSTER)
    )
      throw new WebMHeaderError('Invalid EBML element size');
    yield { id, start: data, end: next };
    start = next;
  }
}

function number(bytes, { start, end }) {
  if (start === end || end - start > 8) throw new WebMHeaderError('Invalid EBML integer');
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + bytes[i];
  if (!Number.isSafeInteger(value)) throw new WebMHeaderError('EBML integer is too large');
  return value;
}

function track(bytes, entry) {
  let type, codec, index;
  for (const child of elements(bytes, entry.start, entry.end)) {
    if (child.id === 0x83) type = number(bytes, child);
    if (child.id === 0x86)
      codec = ascii.decode(bytes.subarray(child.start, child.end)).toUpperCase();
    if (child.id === 0xd7) index = number(bytes, child);
  }
  if (!type || !codec || !index) throw new WebMHeaderError('Incomplete WebM track');
  return { type, codec, index };
}

function readTracks(bytes) {
  const root = elements(bytes, 0, bytes.length),
    header = root.next().value;
  if (header?.id !== EBML) throw new WebMHeaderError('Missing EBML header');
  let docType;
  for (const field of elements(bytes, header.start, header.end)) {
    if (field.id === 0x4282)
      docType = ascii.decode(bytes.subarray(field.start, field.end)).toLowerCase();
    if (HEADER_LIMITS[field.id]) {
      const value = number(bytes, field),
        [min, max] = HEADER_LIMITS[field.id];
      if (value < min || value > max) throw new WebMHeaderError('Unsupported EBML header version');
    }
  }
  if (docType !== 'webm' && docType !== 'matroska')
    throw new WebMHeaderError('Unsupported EBML document type');
  let segment;
  for (const entry of root) {
    if (entry.id === SEGMENT) {
      segment = entry;
      break;
    }
  }
  if (!segment) throw new WebMHeaderError('Missing WebM segment');
  let info = false,
    tracks;
  for (const entry of elements(bytes, segment.start, segment.end)) {
    if (entry.id === INFO) info = true;
    if (entry.id === TRACKS) {
      tracks = [...elements(bytes, entry.start, entry.end)]
        .filter(({ id }) => id === TRACK)
        .map((field) => track(bytes, field));
    }
    if ((tracks && info) || entry.id === CLUSTER) break;
  }
  if (!info || !tracks) throw new WebMHeaderError('Missing WebM segment headers');
  const video = tracks.filter(({ type }) => type === 1),
    audio = tracks.filter(({ type }) => type === 2),
    vorbis = audio.find(({ codec }) => codec === 'A_VORBIS');
  if (
    new Set(tracks.map(({ index }) => index)).size !== tracks.length ||
    video.length !== 1 ||
    !['V_VP8', 'V_VP9'].includes(video[0].codec) ||
    (vorbis && audio.length > 1)
  )
    throw new WebMHeaderError('WebM requires one VPx video track and an unambiguous Vorbis track');
  return tracks.filter((track) => track === video[0] || track === vorbis);
}

export function nativeWebMTracks(bytes) {
  try {
    return { tracks: readTracks(bytes) };
  } catch (error) {
    if (!(error instanceof WebMHeaderError)) throw error;
    return { error: error.message };
  }
}

const directShow = (word) => [word, 0x11ce0ad4, 0x20003ab0, 0x70a70baf];
const NULL_GUID = [0, 0, 0, 0];
const MEDIATYPE_STREAM = [0xe436eb83, 0x11ce524f, 0x2000539f, 0x70a70baf];
const E_NOINTERFACE = 0x80004002;
const E_POINTER = 0x80004003;
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

export const WEBM_GUIDS = {
  webmFactory: [[1, 0, 0xc0, 0x46000000]],
  webmFilter: [directShow(0x56a86895)],
  webmPin: [directShow(0x56a86891)],
  webmPins: [directShow(0x56a86892)],
  webmMediaTypes: [[0x89c31040, 0x11ce846b, 0xaa00d397, 0x5a595500]],
};

export const WEBM_CONTRACTS = {
  webmFactory: [5, { 3: ['createInstance', 3] }],
  webmFilter: [15, { 10: ['enumPins', 1] }],
  webmPin: [
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
  webmPins: [7, { 3: ['nextPin', 3] }],
  webmMediaTypes: [7, { 3: ['nextMediaType', 3], 5: ['resetMediaTypes', 0] }],
};

export class NativeWebMFilters {
  constructor(graphs, unknownIID) {
    Object.assign(this, { graphs, p: graphs.process, unknownIID });
    const kernel = graphs.engine.kernel;
    for (const [dll, [role, clsid]] of WEBM_CLASSES) {
      const DllGetClassObject = kernel.register(dll, 'DllGetClassObject', {
        count: 3,
        fn: ([requested, iid, out]) => {
          if (!out) return E_POINTER;
          this.p.store(out, 0);
          if (!graphs.guid(requested, clsid)) return CLASS_E_CLASSNOTAVAILABLE;
          if (!graphs.guid(iid, unknownIID) && !graphs.guid(iid, WEBM_GUIDS.webmFactory[0]))
            return E_NOINTERFACE;
          return graphs.word(out, graphs.create(['webmFactory'], { factoryRole: role }).primary);
        },
      });
      kernel.registerHostModule(dll, { DllGetClassObject });
    }
  }
  createInstance(factory, outer, iid, out) {
    if (!out) return E_POINTER;
    this.p.store(out, 0);
    if (outer) return CLASS_E_NOAGGREGATION;
    if (!this.graphs.guid(iid, this.unknownIID) && !this.graphs.guid(iid, WEBM_GUIDS.webmFilter[0]))
      return E_NOINTERFACE;
    return this.graphs.word(out, this.createFilter(factory.factoryRole).primary);
  }
  createFilter(role) {
    const filter = this.graphs.create(['webmFilter'], { role, pins: [], pinVersion: 0, graph: 0 });
    this.pin(filter, 0);
    if (role !== 'splitter') this.pin(filter, 1);
    return filter;
  }
  pin(filter, direction, track) {
    const pin = this.graphs.create(['webmPin'], {
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
    graph.webmFilters ??= {};
    if (filter.graph || graph.webmFilters[filter.role]) return VFW_E_WRONG_STATE;
    filter.name = this.p.string(name, true);
    filter.graph = graph.primary;
    graph.webmFilters[filter.role] = filter.primary;
    this.graphs.addRef(filter);
    return 0;
  }
  async removeFilter(graph, filter) {
    if (filter.graph !== graph.primary) return VFW_E_NOT_IN_GRAPH;
    await this.disconnectFilter(filter);
    delete graph.webmFilters[filter.role];
    filter.graph = 0;
    await this.graphs.release(filter);
    return 0;
  }
  enumPins(filter, out) {
    if (!out) return E_POINTER;
    const iterator = this.graphs.create(['webmPins'], {
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
  enumMediaTypes(pin, out) {
    if (!out) return E_POINTER;
    const filter = this.graphs.objects.get(pin.parentFilter);
    if (filter.role !== 'splitter' || pin.direction !== 0) return E_NOTIMPL;
    // The original WebM splitter input leaves its preferred types empty.
    // The upstream CAsyncReader offers its own stream type instead.
    const iterator = this.graphs.create(['webmMediaTypes'], { enumeratedFilter: filter.primary });
    this.graphs.addRef(filter);
    return this.graphs.word(out, iterator.primary);
  }
  nextMediaType(_iterator, count, out, fetched) {
    if (!out || (!fetched && count !== 1)) return E_POINTER;
    if (fetched) this.p.store(fetched, 0);
    return count === 0 ? 0 : 1;
  }
  resetMediaTypes() {
    // The splitter input does not advertise any preferred media types.
    return 0;
  }
  queryDirection(pin, out) {
    return this.graphs.word(out, pin.direction);
  }
  queryAccept(pin, type) {
    if (!type) return E_POINTER;
    const filter = this.graphs.objects.get(pin.parentFilter);
    return filter.role === 'splitter' &&
      pin.direction === 0 &&
      this.graphs.guid(type, MEDIATYPE_STREAM)
      ? 0
      : 1;
  }
  connectionMediaType(pin, out) {
    if (!out) return E_POINTER;
    if (!pin.peer) return VFW_E_NOT_CONNECTED;
    if (!pin.mediaType) return E_NOTIMPL;
    this.p.write(out, pin.mediaType);
    return 0;
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
    const splitter = this.graphs.objects.get(graph.webmFilters?.splitter);
    if (!graph.source || source !== graph.source + 248 || input !== splitter?.pins[0])
      return VFW_E_NOT_IN_GRAPH;
    if (graph.state !== 0) return VFW_E_NOT_STOPPED;
    return this.graphs.call(source, 3, input, mediaType);
  }
  async receiveConnection(pin, source, mediaType) {
    if (!source || !mediaType) return E_POINTER;
    if (pin.peer) return VFW_E_ALREADY_CONNECTED;
    const filter = this.graphs.objects.get(pin.parentFilter),
      graph = this.graphs.objects.get(filter.graph);
    if (filter.role !== 'splitter' || pin.direction !== 0) return E_NOTIMPL;
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
      { tracks, error } = nativeWebMTracks(bytes);
    if (error) {
      this.graphs.world.host.nativeDiagnostic?.({
        type: 'movie-webm-stream-unavailable',
        filename: graph.filename,
        message: error,
      });
      return VFW_E_INVALID_FILE_FORMAT;
    }
    await this.graphs.call(source, 1);
    pin.peer = source;
    pin.mediaType = type;
    graph.audioEnabled = tracks.some(({ type }) => type === 2);
    for (const track of tracks) this.pin(filter, 1, track);
    return 0;
  }
  async renderPin(graph, output) {
    const splitter = this.graphs.objects.get(graph.webmFilters?.splitter),
      decoderRole = output.track?.type === 1 ? 'vpx' : 'vorbis',
      decoder = this.graphs.objects.get(graph.webmFilters?.[decoderRole]),
      input = this.graphs.objects.get(decoder?.pins[0]);
    if (output.parentFilter !== splitter?.primary || !output.track || !input)
      return VFW_E_CANNOT_RENDER;
    if (input.peer || output.peer) return VFW_E_ALREADY_CONNECTED;
    if (decoderRole === 'vpx') {
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
    if (filter.role === 'splitter' && input.peer) {
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
    const splitter = this.graphs.objects.get(graph.webmFilters?.splitter);
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
