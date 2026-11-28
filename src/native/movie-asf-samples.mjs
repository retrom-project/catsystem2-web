// SPDX-License-Identifier: MPL-2.0
import { InvalidASF } from './movie-asf.mjs';

const VARIABLE_BYTES = [0, 1, 2, 4];

function check(condition, message) {
  if (!condition) throw new InvalidASF(message);
}

class PacketReader {
  constructor(view, start, end) {
    this.view = view;
    this.at = start;
    this.end = end;
  }
  take(length) {
    const start = this.at;
    check(length >= 0 && length <= this.end - start, 'Truncated ASF packet field');
    this.at += length;
    return start;
  }
  word(length) {
    const at = this.take(length);
    switch (length) {
      case 0:
        return 0;
      case 1:
        return this.view.getUint8(at);
      case 2:
        return this.view.getUint16(at, true);
      default:
        return this.view.getUint32(at, true);
    }
  }
  variable(flags) {
    return this.word(VARIABLE_BYTES[flags & 3]);
  }
}

function openPacket(view, start, data) {
  const packet = new PacketReader(view, start, Math.min(start + data.maxPacket, data.end)),
    first = packet.word(1);
  let lengthFlags = first;
  if (first & 128) {
    check((first & 0x70) === 0, 'Unsupported ASF packet error correction');
    const correctionSize = first & 15,
      correction = packet.take(correctionSize);
    check(
      correctionSize === 0 || (view.getUint8(correction) & 15) === 0,
      'Unsupported ASF corrected packet',
    );
    lengthFlags = packet.word(1);
  }
  const properties = packet.word(1),
    packetLength = packet.variable(lengthFlags >> 5) || data.maxPacket;
  packet.variable(lengthFlags >> 1);
  const padding = packet.variable(lengthFlags >> 3),
    storedLength = Math.max(data.minPacket, packetLength),
    next = start + storedLength,
    multiple = Boolean(lengthFlags & 1);
  check(next <= packet.end, 'Invalid ASF packet size');
  packet.end = start + packetLength - (multiple ? 0 : padding);
  packet.take(6);
  const payloads = multiple ? packet.word(1) : 1,
    count = payloads & 63,
    lengthType = payloads >> 6;
  check(count && (!multiple || lengthType), 'Invalid ASF packet payload count');
  check(properties >> 6 === 1, 'Invalid ASF payload stream field');
  return { packet, properties, multiple, count, lengthType, next };
}

function presentationTime(milliseconds, preroll) {
  const time = BigInt(milliseconds) * 10000n - preroll;
  return time < 0n ? 0n : time;
}

function* payloadSamples(info, packetNumber, data, tracks, pending) {
  const { packet, properties, multiple, count, lengthType } = info,
    view = packet.view;
  for (let index = 0; index < count; index++) {
    const stream = packet.word(1),
      number = stream & 127,
      object = packet.variable(properties >> 4),
      offset = packet.variable(properties >> 2),
      replicationLength = packet.variable(properties),
      replication = packet.take(replicationLength),
      length = multiple ? packet.variable(lengthType) : packet.end - packet.at,
      source = packet.take(length),
      track = tracks.get(number),
      key = Boolean(stream & 128) || track?.kind === 'audio';
    check(number && length, 'Invalid ASF media payload');
    if (!track) continue;
    if (replicationLength === 1) {
      const delta = view.getUint8(replication),
        payload = new PacketReader(view, source, source + length);
      for (let sample = 0; payload.at < payload.end; sample++) {
        const size = payload.word(1),
          at = payload.take(size);
        check(size, 'Empty ASF compressed sub-payload');
        yield {
          number,
          time: presentationTime((offset + sample * delta) >>> 0, data.preroll),
          key,
          size,
          packet: packetNumber,
          spans: [{ at, length: size }],
        };
      }
      continue;
    }
    check(!replicationLength || replicationLength >= 8, 'Invalid ASF replicated data');
    if (offset === 0) {
      check(!pending.has(number), 'Incomplete ASF media object');
      const size = replicationLength ? view.getUint32(replication, true) : length,
        timestamp = replicationLength ? view.getUint32(replication + 4, true) : 0;
      pending.set(number, {
        object,
        received: 0,
        sample: {
          number,
          time: presentationTime(timestamp, data.preroll),
          key,
          size,
          packet: packetNumber,
          spans: [],
        },
      });
    }
    const record = pending.get(number);
    check(
      record?.object === object &&
        record.received === offset &&
        offset + length <= record.sample.size,
      'Invalid ASF media object fragment',
    );
    record.sample.spans.push({ at: source, length });
    record.received += length;
    if (record.received === record.sample.size) {
      yield record.sample;
      pending.delete(number);
    }
  }
}

// The spans address the mounted source and keep each fragment in its
// original packet. Readers can inspect sample boundaries without copying it.
export function* nativeASFSamples(bytes, { data, streams }) {
  check(
    data.minPacket > 0 &&
      data.minPacket <= data.maxPacket &&
      data.end <= bytes.length &&
      data.packetCount <= BigInt(Math.floor((data.end - data.start) / data.minPacket)),
    'Invalid ASF packet range',
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    tracks = new Map(streams.map((track) => [track.number, track])),
    pending = new Map();
  let at = data.start;
  for (let number = 0; number < Number(data.packetCount); number++) {
    const info = openPacket(view, at, data);
    yield* payloadSamples(info, number, data, tracks, pending);
    at = info.next;
  }
  check(at === data.end && !pending.size, 'Incomplete ASF data object');
}
