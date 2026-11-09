// SPDX-License-Identifier: MPL-2.0
// Windows Media reader boundary consumed by the original 2.6.1.76 ASF filter.
import { InvalidASF, asfHeaderSize, nativeASFProfile } from './movie-asf.mjs';
import { nativeASFSamples } from './movie-asf-samples.mjs';

const E_POINTER = 0x80004003;
const E_INVALIDARG = 0x80070057;
const NS_E_INVALID_REQUEST = 0xc00d002b;
const NS_E_INVALID_DATA = 0xc00d002f;
const NS_E_INVALID_STREAM = 0xc00d003c;
const NS_E_ATTRIBUTE_NOT_FOUND = 0xc00d07f0;
const ASF_E_BUFFERTOOSMALL = 0xc00d07d1;
const VFW_E_CANNOT_RENDER = 0x80040218;
const FAILED = (word) => (word | 0) < 0;
const wmGuid = (word) => [word, 0x11d32b2b, 0xc0006bb3, 0xff08614f];
const u64 = (lo, hi) => (BigInt(hi) << 32n) | BigInt(lo);
const DWORD = (time) => [Number(time & 0xffffffffn), Number((time >> 32n) & 0xffffffffn)];
const STREAM_INPUT_VTABLE = 0x8f03b4;
const WMV_FILTER_VTABLE = 0x8f0548;

export const WM_READER_PROFILE = 'nekopara-vol3-engine-2.6.1.76';
export const WM_READER_GUIDS = {
  wmReader: [wmGuid(0x96406bd6)],
  wmAdvanced: [wmGuid(0x96406bea), [0xae14a945, 0x4d0db90c, 0xd6802791, 0x3ed7f765]],
  wmProfile: [wmGuid(0x96406bdb)],
  wmHeader: [wmGuid(0x96406bda)],
  wmStream: [wmGuid(0x96406bdc)],
  wmMedia: [wmGuid(0x96406bce)],
};
export const WM_READER_CONTRACTS = {
  wmReader: [14, { 4: ['closeReader', 0], 10: ['start', 6], 11: ['stop', 0] }],
  wmAdvanced: [
    38,
    {
      3: ['setUserClock', 1],
      5: ['deliverTime', 2],
      9: ['streamSelected', 2],
      12: ['setStreamSamples', 2],
      16: ['setStreamAllocation', 2],
      21: ['maxStreamSample', 2],
      37: ['openStream', 3],
    },
  ],
  wmProfile: [16, { 8: ['streamCount', 1], 9: ['getStream', 2] }],
  wmHeader: [15, { 5: ['attribute', 5] }],
  wmStream: [14, { 4: ['streamNumber', 1], 6: ['streamName', 2] }],
  wmMedia: [6, { 4: ['mediaType', 2] }],
};

export class NativeWindowsMediaReader {
  constructor(show) {
    this.show = show;
    this.engine = show.engine;
    this.process = show.process;
    const create = this.engine.registerWindows('WMVCore.dll', 'WMCreateReader', {
      count: 3,
      fn: (args) => this.createReader(...args),
    });
    this.engine.kernel.registerHostModule('WMVCore.dll', { WMCreateReader: create });
  }
  call(pointer, slot, ...args) {
    return this.show.call(pointer, slot, ...args);
  }
  word(output, value) {
    return this.show.word(output, value);
  }
  readWord(address) {
    const bytes = this.process.read(address, 2);
    return bytes[0] | (bytes[1] << 8);
  }
  writeWord(address, word) {
    this.process.write(address, Uint8Array.of(word & 255, (word >>> 8) & 255));
  }
  async createReader(certificate, rights, output) {
    if (!output) return E_POINTER;
    const p = this.process,
      owner = output - 124,
      input = p.load(owner + 276);
    p.store(output, 0);
    if (certificate || rights) return E_INVALIDARG;
    if (
      p.allocations.get(owner) !== 0x120 ||
      p.load(owner + 12) !== WMV_FILTER_VTABLE ||
      !input ||
      p.load(input) !== STREAM_INPUT_VTABLE
    )
      throw new Error('WMCreateReader requires the original ASF filter and stream');

    // The loader owns each CUnknown from its zero-ref constructor. The
    // ASF filter clears its borrowed CStreamInput before destructing.
    await this.call(owner + 12, 1);
    await this.call(input, 1);
    const reader = this.show.create(['wmReader', 'wmAdvanced', 'wmProfile', 'wmHeader'], {
      windowsMediaReader: true,
      owner,
      input,
      callback: 0,
      context: 0,
      opened: false,
      playing: false,
      userClock: false,
      clockRequest: null,
      streams: [],
      duration: 0n,
    });
    return this.word(output, reader.primary);
  }
  async readProfile(input) {
    const p = this.process,
      stat = p.allocate(72, true);
    let content = 0;
    try {
      if (FAILED(await this.call(input, 12, stat, 1)))
        throw new InvalidASF('ASF stream Stat failed');
      const size = u64(p.load(stat + 8), p.load(stat + 12));
      const seek = (at) => this.call(input, 5, at, 0, 0, 0);
      const read = async (address, length) => {
        p.store(stat + 16, 0);
        const status = await this.call(input, 3, address, length, stat + 16);
        if (FAILED(status) || p.load(stat + 16) !== length)
          throw new InvalidASF('Truncated ASF stream read');
      };
      if (size < 80n || FAILED(await seek(0))) throw new InvalidASF('Invalid ASF stream size');
      await read(stat + 24, 30);
      const length = asfHeaderSize(p.read(stat + 24, 30), size);
      content = p.allocate(length + 50, true);
      if (FAILED(await seek(0))) throw new InvalidASF('ASF stream seek failed');
      await read(content, length + 50);
      return nativeASFProfile(p.read(content, length), p.read(content + length, 50), size);
    } finally {
      if (content) p.free(content);
      p.free(stat);
    }
  }
  status(record, value, result = 0) {
    return this.call(record.callback, 3, value, result, 0, 0, record.context);
  }
  async openStream(record, input, callback, context) {
    if (!input || !callback) return E_POINTER;
    if (record.opened) return NS_E_INVALID_REQUEST;
    if (input !== record.input || callback !== record.owner + 80)
      throw new Error('Original ASF filter supplied a different IStream or callback');
    Object.assign(record, { callback, context });
    let data;
    try {
      data = await this.readProfile(input);
    } catch (error) {
      if (!(error instanceof InvalidASF)) throw error;
      await this.status(record, 1, NS_E_INVALID_DATA);
      return 0;
    }
    Object.assign(record, data, { opened: true });
    await this.status(record, 1);
    return 0;
  }
  async closeReader(record) {
    if (!record.opened) return NS_E_INVALID_REQUEST;
    record.playing = record.opened = false;
    record.clockRequest = null;
    await this.status(record, 13);
    return 0;
  }
  async start(record, lo, hi, _durationLow, _durationHigh, rate, context) {
    if (!record.opened || record.playing) return NS_E_INVALID_REQUEST;
    if (rate !== 0x3f800000 || u64(lo, hi) > record.duration) return E_INVALIDARG;
    record.playing = true;
    record.context = context;
    await this.status(record, 11);
    return 0;
  }
  async stop(record) {
    if (!record.opened || !record.playing) return NS_E_INVALID_REQUEST;
    record.playing = false;
    record.clockRequest = null;
    await this.status(record, 12);
    return 0;
  }
  setUserClock(record, enabled) {
    record.userClock = Boolean(enabled);
    return 0;
  }
  deliverTime(record, lo, hi) {
    if (!record.playing || !record.userClock) return NS_E_INVALID_REQUEST;
    record.clockRequest = u64(lo, hi);
    return 0;
  }
  streamCount(record, output) {
    return this.word(output, record.streams.length);
  }
  getStream(record, index, output) {
    if (!output) return E_POINTER;
    const track = record.streams[index];
    if (!track) return NS_E_INVALID_STREAM;
    const stream = this.show.create(['wmStream', 'wmMedia'], { windowsMediaStream: true, track });
    return this.word(output, stream.primary);
  }
  stream(record, number) {
    return record.streams.find((track) => track.number === (number & 0xffff));
  }
  streamSelected(record, number, output) {
    const track = this.stream(record, number);
    return track ? this.word(output, track.selected ? 2 : 0) : NS_E_INVALID_STREAM;
  }
  setStreamSamples(record, number, enabled) {
    const track = this.stream(record, number);
    if (!track) return NS_E_INVALID_STREAM;
    track.compressed = Boolean(enabled);
    return 0;
  }
  setStreamAllocation(record, number, enabled) {
    const track = this.stream(record, number);
    if (!track) return NS_E_INVALID_STREAM;
    track.allocate = Boolean(enabled);
    return 0;
  }
  maxStreamSample(record, number, output) {
    const track = this.stream(record, number);
    return track ? this.word(output, track.maxSample) : NS_E_INVALID_STREAM;
  }
  streamNumber({ track }, output) {
    if (!output) return E_POINTER;
    this.writeWord(output, track.number);
    return 0;
  }
  streamName({ track }, output, size) {
    if (!size) return E_POINTER;
    const required = track.name.length + 1,
      capacity = this.readWord(size);
    this.writeWord(size, required);
    if (!output) return 0;
    if (capacity < required) return ASF_E_BUFFERTOOSMALL;
    this.engine.kernel.writeString(output, track.name, true);
    return 0;
  }
  mediaType({ track }, output, size) {
    if (!size) return E_POINTER;
    const p = this.process,
      required = 72 + track.format.length,
      capacity = p.load(size);
    p.store(size, required);
    if (!output) return 0;
    if (capacity < required) return ASF_E_BUFFERTOOSMALL;
    track.words.forEach((word, index) => p.store(output + index * 4, word));
    p.store(output + 68, track.format.length ? output + 72 : 0);
    p.write(output + 72, track.format);
    return 0;
  }
  attribute(record, stream, name, type, output, size) {
    if (!stream || !name || !type || !size) return E_POINTER;
    if (this.readWord(stream) || this.process.string(name, true) !== 'Duration')
      return NS_E_ATTRIBUTE_NOT_FOUND;
    const capacity = this.readWord(size);
    this.writeWord(size, 8);
    this.process.store(type, 4);
    if (!output) return 0;
    if (capacity < 8) return ASF_E_BUFFERTOOSMALL;
    this.engine.kernel.write64(output, record.duration);
    return 0;
  }
  filter(pointer) {
    return [...this.show.objects.values()].find(
      (record) => record.windowsMediaReader && record.opened && record.owner + 12 === pointer,
    );
  }
  async attach(graph, reader) {
    const p = this.process,
      filter = reader.owner + 12,
      pinAt = p.load(p.load(reader.owner) + 28),
      invoke = p.asyncEnabled ? 'callFromHost' : 'call',
      pins = new Map();
    for (const track of reader.streams.filter((stream) => stream.compressed && stream.allocate)) {
      const pin = await this.engine[invoke](pinAt, [pins.size], reader.owner);
      if (!pin) throw new Error('Original ASF stream did not create its output pin');
      pins.set(pin + 12, track.number);
    }
    if (await this.engine[invoke](pinAt, [pins.size], reader.owner))
      throw new Error('Original ASF filter has an unrecognized output pin');
    graph.wmFilter = filter;
    graph.wmPins = pins;
    graph.wmRendered = new Set();
  }
  async renderPin(graph, pin) {
    const reader = this.filter(graph.wmFilter),
      track = reader && this.stream(reader, graph.wmPins.get(pin));
    if (!track || track.encrypted || track.kind === 'unknown') return VFW_E_CANNOT_RENDER;
    if (graph.wmRendered.has(pin)) return 0;
    if (track.kind === 'video') {
      graph.audioEnabled = reader.streams.some(
        (stream) => stream.selected && stream.kind === 'audio',
      );
      graph.wmDuration = reader.duration;
      const result = await this.show.connectMedia(graph, graph.source + 248, (bytes) =>
        this.hasVideoSample(reader, track.number, bytes, graph.filename),
      );
      if (FAILED(result)) return result;
      if (graph.video.width !== track.width || graph.video.height !== track.height)
        return VFW_E_CANNOT_RENDER;
    }
    graph.wmRendered.add(pin);
    return 0;
  }
  hasVideoSample(reader, number, bytes, filename) {
    try {
      for (const sample of nativeASFSamples(bytes, reader))
        if (sample.number === number) return true;
      throw new InvalidASF('ASF video stream has no complete media object');
    } catch (error) {
      if (!(error instanceof InvalidASF)) throw error;
      this.show.world.host.nativeDiagnostic?.({
        type: 'movie-codec-unavailable',
        filename,
        message: error.message,
      });
      return false;
    }
  }
  async changeState(graph, state) {
    if (!graph.wmFilter) return 0;
    const filter = graph.wmFilter,
      previous = this.process.load(filter + 8);
    if (previous === state) return 0;
    if (!state) return this.call(filter, 4);
    if (state === 1 || previous === 0) {
      const result = await this.call(filter, 5);
      if (FAILED(result) || state === 1) return result;
    }
    return this.call(filter, 6, 0, 0);
  }
  async advance(graph, position) {
    if (!graph.wmFilter) return;
    const reader = this.filter(graph.wmFilter);
    if (!reader.playing) return;
    if (graph.exhausted && reader.clockRequest !== null) {
      reader.clockRequest = null;
      await this.status(reader, 4);
      return;
    }
    const request = reader.clockRequest;
    if (request !== null && request <= position) {
      reader.clockRequest = null;
      await this.call(reader.callback + 4, 4, ...DWORD(request), reader.context);
    }
  }
  async detach(graph) {
    const reader = this.filter(graph.wmFilter);
    await this.changeState(graph, 0);
    if (reader?.opened) await this.closeReader(reader);
    graph.wmFilter = 0;
    graph.wmPins = null;
    graph.wmRendered = null;
  }
}
