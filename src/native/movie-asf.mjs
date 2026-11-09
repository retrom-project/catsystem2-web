// SPDX-License-Identifier: MPL-2.0
// ASF headers and the compressed media types exposed by the Windows Media reader.
const HEADER = '75b22630-668e-11cf-a6d9-00aa0062ce6c';
const DATA = '75b22636-668e-11cf-a6d9-00aa0062ce6c';
const FILE_PROPERTIES = '8cabdca1-a947-11cf-8ee4-00c00c205365';
const STREAM_PROPERTIES = 'b7dc0791-a9b7-11cf-8ee6-00c00c205365';
const HEADER_EXTENSION = '5fbf03b5-a92e-11cf-8ee3-00c00c205365';
const EXTENDED_STREAM = '14e6a5cb-c672-4332-8399-a96952065b5a';
const STREAM_BITRATES = '7bf875ce-468d-11d1-8d82-006097c9a2b2';
const VIDEO = 'bc19efc0-5b4d-11cf-a8fd-00805f5c442b';
const AUDIO = 'f8699e40-5b4d-11cf-a8fd-00805f5c442b';
const UTF16 = new TextDecoder('utf-16le');
const asfView = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const hex = (value, digits) => value.toString(16).padStart(digits, '0');

function guid(view, at) {
  return (
    hex(view.getUint32(at, true), 8) +
    '-' +
    hex(view.getUint16(at + 4, true), 4) +
    '-' +
    hex(view.getUint16(at + 6, true), 4) +
    '-' +
    hex(view.getUint16(at + 8), 4) +
    '-' +
    hex(view.getUint32(at + 10), 8) +
    hex(view.getUint16(at + 14), 4)
  );
}

export class InvalidASF extends Error {}

function check(condition, message) {
  if (!condition) throw new InvalidASF(message);
}

export function asfHeaderSize(prefix, fileSize) {
  const view = asfView(prefix);
  check(view.byteLength >= 30 && guid(view, 0) === HEADER, 'Missing ASF header');
  const size = view.getBigUint64(16, true);
  check(size >= 30n && size <= BigInt(fileSize) - 50n, 'Invalid ASF header size');
  return Number(size);
}

function* objects(bytes, start, end) {
  const view = asfView(bytes);
  while (start < end) {
    check(end - start >= 24, 'Truncated ASF object header');
    const size = view.getBigUint64(start + 16, true);
    check(size >= 24n && size <= BigInt(end - start), 'Invalid ASF object size');
    const next = start + Number(size);
    yield [guid(view, start), bytes.subarray(start + 24, next)];
    start = next;
  }
}

function readExtendedStream(bytes) {
  const view = asfView(bytes);
  check(view.byteLength >= 64, 'Truncated ASF extended stream');
  let cursor = 64;
  const names = [],
    nameCount = view.getUint16(60, true),
    extensionCount = view.getUint16(62, true);
  for (let i = 0; i < nameCount; i++) {
    check(cursor + 4 <= bytes.length, 'Truncated ASF stream name');
    const length = view.getUint16(cursor + 2, true);
    cursor += 4;
    check(length % 2 === 0 && cursor + length <= bytes.length, 'Invalid ASF stream name');
    names.push(UTF16.decode(bytes.subarray(cursor, cursor + length)).replace(/\0+$/, ''));
    cursor += length;
  }
  for (let i = 0; i < extensionCount; i++) {
    check(cursor + 22 <= bytes.length, 'Truncated ASF payload extension');
    cursor += 22 + view.getUint32(cursor + 18, true);
    check(cursor <= bytes.length, 'Invalid ASF payload extension');
  }
  return {
    number: view.getUint16(48, true),
    bitrate: view.getUint32(16, true),
    maxSample: view.getUint32(40, true),
    frameTime: view.getBigUint64(52, true),
    name: names[0],
    nested: bytes.subarray(cursor),
  };
}

function readStream(bytes) {
  const view = asfView(bytes);
  check(view.byteLength >= 54, 'Truncated ASF stream properties');
  const flags = view.getUint16(48, true),
    length = view.getUint32(40, true),
    correction = view.getUint32(44, true);
  check(flags & 127, 'Invalid ASF stream number');
  check(length + correction <= bytes.length - 54, 'Truncated ASF stream format');
  return {
    type: guid(view, 0),
    number: flags & 127,
    encrypted: Boolean(flags & 0x8000),
    format: bytes.slice(54, 54 + length),
  };
}

// WMASF derives the compressed video rate from the packet budget before
// applying any Extended Stream Properties.
function videoBitrates(file, streams, declared) {
  const videoPayloadBits = 17 * 8,
    audioPayloadBits = 29 * 8,
    maximumRate = file.bitrate || 1000,
    packetTime = ((file.maxPacket || 1000) * 8) / maximumRate,
    payload = videoPayloadBits / packetTime,
    payloadOverhead = Math.trunc(payload) >>> 0;
  const audio = streams.findLast((stream) => stream.type === AUDIO && stream.format.length >= 16),
    audioBudget = audio
      ? (asfView(audio.format).getUint32(8, true) * 8 +
          Math.trunc(audioPayloadBits / packetTime)) >>>
        0
      : 0;
  let remaining = maximumRate < audioBudget ? maximumRate >>> 1 : maximumRate - audioBudget;
  const rates = new Map();
  for (const { number, type } of streams) {
    if (type !== VIDEO) continue;
    const available = declared
        ? Math.max((declared.get(number) ?? 0) - payloadOverhead, 0)
        : remaining,
      fps = available > 150000 ? 30 : 15,
      frameOverhead = Math.trunc(fps * videoPayloadBits + payload) >>> 0;
    if (declared) {
      rates.set(number, Math.max(available - frameOverhead, 0));
    } else {
      const overhead = (frameOverhead + payloadOverhead) >>> 0;
      remaining = available <= overhead ? available >>> 1 : available - overhead;
      rates.set(number, remaining);
    }
  }
  return rates;
}

export function nativeASFProfile(header, dataPrefix, fileSize) {
  const size = asfHeaderSize(header, fileSize),
    view = asfView(header),
    data = asfView(dataPrefix),
    streamProperties = new Map(),
    extended = new Map();
  check(size === header.length, 'Truncated ASF header');
  check(data.byteLength >= 50 && guid(data, 0) === DATA, 'Missing ASF data object');
  const dataSize = data.getBigUint64(16, true);
  check(
    dataSize >= 50n && dataSize <= BigInt(fileSize) - BigInt(size),
    'Invalid ASF data object size',
  );
  let file, bitrates;
  function add(type, bytes) {
    const object = asfView(bytes);
    if (type === FILE_PROPERTIES) {
      check(!file && bytes.length >= 80, 'Invalid ASF file properties');
      check(guid(object, 0) === guid(data, 24), 'Mismatched ASF data file ID');
      const preroll = object.getBigUint64(56, true) * 10000n,
        playTime = object.getBigUint64(40, true);
      file = {
        duration: playTime > preroll ? playTime - preroll : 0n,
        preroll,
        bitrate: object.getUint32(76, true),
        minPacket: object.getUint32(68, true),
        maxPacket: object.getUint32(72, true),
      };
    } else if (type === STREAM_PROPERTIES) {
      const stream = readStream(bytes);
      check(!streamProperties.has(stream.number), 'Duplicate ASF stream');
      streamProperties.set(stream.number, stream);
    } else if (type === HEADER_EXTENSION) {
      check(bytes.length >= 22, 'Truncated ASF header extension');
      const length = object.getUint32(18, true);
      check(length === bytes.length - 22, 'Invalid ASF header extension size');
      for (const [key, body] of objects(bytes, 22, 22 + length)) {
        if ([EXTENDED_STREAM, STREAM_PROPERTIES, STREAM_BITRATES].includes(key)) add(key, body);
      }
    } else if (type === EXTENDED_STREAM) {
      const { nested, ...stream } = readExtendedStream(bytes);
      extended.set(stream.number, stream);
      for (const [key, body] of objects(nested, 0, nested.length)) {
        check(key === STREAM_PROPERTIES, 'Invalid nested ASF stream properties');
        add(key, body);
      }
    } else if (type === STREAM_BITRATES) {
      check(bytes.length >= 2, 'Truncated ASF stream bitrates');
      const count = object.getUint16(0, true);
      check(2 + 6 * count <= bytes.length, 'Invalid ASF stream bitrate count');
      bitrates ??= new Map();
      for (let i = 0; i < count; i++) {
        const offset = 2 + 6 * i;
        bitrates.set(object.getUint16(offset, true) & 127, object.getUint32(offset + 2, true));
      }
    }
  }
  let count = 0;
  for (const [type, bytes] of objects(header, 30, size)) {
    count++;
    add(type, bytes);
  }
  check(count === view.getUint32(24, true), 'Invalid ASF header object count');
  check(file && streamProperties.size, 'Missing ASF file or stream properties');
  const streams = [...streamProperties.values()],
    rates = videoBitrates(file, streams, bitrates);
  return {
    duration: file.duration,
    data: {
      start: size + 50,
      end: size + Number(dataSize),
      packetCount: data.getBigUint64(40, true),
      minPacket: file.minPacket,
      maxPacket: file.maxPacket,
      preroll: file.preroll,
    },
    streams: streams.map((stream) => {
      const detail = extended.get(stream.number),
        bitrate = detail?.bitrate ?? rates.get(stream.number) ?? 0;
      return compressedStream(stream, detail, bitrate);
    }),
  };
}

function compressedStream(stream, detail, bitrate) {
  const { type, number, encrypted, format: bytes } = stream,
    view = asfView(bytes);
  let kind = 'unknown',
    subtype = 0,
    fixed = 0,
    temporal = 0,
    sampleSize = 0,
    maxSample = detail?.maxSample ?? 0,
    formatID = 0,
    width = 0,
    height = 0,
    format = bytes;
  if (type === AUDIO) {
    check(bytes.length >= 16, 'Invalid ASF audio format');
    kind = 'audio';
    subtype = view.getUint16(0, true);
    fixed = 1;
    sampleSize = view.getUint16(12, true);
    maxSample ||= sampleSize;
    formatID = 0x05589f81;
  } else if (type === VIDEO) {
    check(bytes.length >= 51, 'Invalid ASF video format');
    const length = view.getUint16(9, true);
    check(length >= 40 && 11 + length <= bytes.length, 'Invalid ASF bitmap information');
    width = view.getUint32(0, true);
    height = view.getUint32(4, true);
    check(
      width > 0 && width <= 0x7fffffff && height > 0 && height <= 0x7fffffff,
      'Invalid ASF video size',
    );
    kind = 'video';
    subtype = view.getUint32(27, true);
    temporal = 1;
    maxSample ||= view.getUint32(31, true);
    formatID = 0x05589f80;
    format = new Uint8Array(48 + length);
    const video = asfView(format);
    for (const rectangle of [0, 16]) {
      video.setUint32(rectangle + 8, width, true);
      video.setUint32(rectangle + 12, height, true);
    }
    video.setUint32(32, bitrate, true);
    video.setBigUint64(40, detail?.frameTime ?? 0n, true);
    format.set(bytes.subarray(11, 11 + length), 48);
    video.setUint32(68, 0, true);
  }
  const major = { audio: 0x73647561, video: 0x73646976 }[kind] ?? 0,
    mediaTail = [0x00100000, 0xaa000080, 0x719b3800];
  return {
    number,
    kind,
    name: detail?.name ?? `${kind} ${number}`,
    selected: !encrypted,
    encrypted,
    maxSample,
    width,
    height,
    words: [
      major,
      ...mediaTail,
      subtype,
      ...mediaTail,
      fixed,
      temporal,
      sampleSize,
      formatID,
      0x11cec356,
      0xaa0001bf,
      0x5a595500,
      0,
      format.length,
      0,
    ],
    format,
  };
}
