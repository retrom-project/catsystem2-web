// SPDX-License-Identifier: MPL-2.0
// The Hap5 VfW driver used by the original loader reads AVI frames with a
// four-byte Hap section header. Preserve its unassociated BC3 alpha.
const HAP_ALPHA = 0x0e;
const RAW = 0x0a;
const SNAPPY = 0x0b;
const TIME_UNITS = 10000000n;

export class InvalidHap extends Error {}

function check(condition, message) {
  if (!condition) throw new InvalidHap(message);
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const tagAt = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));

function* chunks(bytes, start = 0, end = bytes.length) {
  const view = viewOf(bytes);
  for (let at = start; at < end; ) {
    check(end - at >= 8, 'Truncated Hap AVI chunk');
    const tag = tagAt(bytes, at),
      length = view.getUint32(at + 4, true),
      data = at + 8,
      next = data + length + (length & 1);
    check(next <= end, 'Invalid Hap AVI chunk length');
    yield { tag, bytes: bytes.subarray(data, data + length) };
    at = next;
  }
}

const listType = (chunk, type) => chunk.tag === 'LIST' && tagAt(chunk.bytes, 0) === type;

function dimensionCheck(width, height) {
  check(
    Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0 &&
      !(width % 4) &&
      !(height % 4) &&
      width * height <= 0x4000000,
    'Invalid Hap5 dimensions',
  );
}

function aviStreams(lists) {
  let video, audio;
  for (const [index, stream] of lists.entries()) {
    const fields = [...chunks(stream.bytes, 4)],
      header = fields.find((field) => field.tag === 'strh')?.bytes,
      format = fields.find((field) => field.tag === 'strf')?.bytes;
    check(header?.length >= 56, 'Missing Hap AVI stream header');
    const type = tagAt(header, 0);
    if (type !== 'vids' && type !== 'auds') continue;
    const timing = viewOf(header),
      scale = timing.getUint32(20, true),
      rate = timing.getUint32(24, true),
      start = timing.getUint32(28, true),
      unit = BigInt(scale) * TIME_UNITS;
    check(scale && rate && index < 100, 'Invalid Hap5 AVI stream timing');
    const track = {
      index,
      scale,
      rate,
      start,
      startTime: (BigInt(start) * unit) / BigInt(rate),
      packets: [],
    };
    if (type === 'auds') {
      check(!audio && format?.length >= 16, 'Invalid Hap AVI audio stream');
      audio = { ...track, format };
      continue;
    }
    check(!video && format?.length >= 40, 'Invalid Hap AVI video stream');
    check(tagAt(format, 16) === 'Hap5', 'Hap AVI video is not Hap5');
    const bitmap = viewOf(format),
      size = bitmap.getUint32(0, true),
      width = bitmap.getInt32(4, true),
      height = bitmap.getInt32(8, true);
    check(
      size >= 40 && size <= format.length && bitmap.getUint16(12, true) === 1,
      'Invalid Hap5 bitmap header',
    );
    dimensionCheck(width, height);
    video = { ...track, width, height };
  }
  check(video, 'Missing Hap5 AVI video stream');
  return { video, audio };
}

export function nativeHapMovie(bytes) {
  const reels = [...chunks(bytes)].filter((chunk) => chunk.tag === 'RIFF'),
    primary = reels[0]?.bytes;
  check(primary && tagAt(primary, 0) === 'AVI ', 'Missing Hap AVI header');
  const directory = [...chunks(primary, 4)].find((chunk) => listType(chunk, 'hdrl'));
  check(directory, 'Missing Hap AVI stream directory');
  const lists = [...chunks(directory.bytes, 4)].filter((chunk) => listType(chunk, 'strl')),
    { video, audio } = aviStreams(lists),
    prefix = String(video.index).padStart(2, '0'),
    wave = audio && String(audio.index).padStart(2, '0') + 'wb';
  function collect(list) {
    for (const chunk of chunks(list.bytes, 4)) {
      if (listType(chunk, 'rec ')) collect(chunk);
      else if (chunk.tag === prefix + 'dc' || chunk.tag === prefix + 'db')
        video.packets.push(chunk.bytes);
      else if (chunk.tag === wave) audio.packets.push(chunk.bytes);
    }
  }
  for (const [index, reel] of reels.entries()) {
    check(tagAt(reel.bytes, 0) === (index ? 'AVIX' : 'AVI '), 'Invalid Hap AVI continuation');
    for (const chunk of chunks(reel.bytes, 4)) if (listType(chunk, 'movi')) collect(chunk);
  }
  check(
    video.packets.some((packet) => packet.length),
    'Missing Hap AVI frames',
  );
  const unit = BigInt(video.scale) * TIME_UNITS,
    divisor = BigInt(video.rate);
  return {
    ...video,
    duration: (BigInt(video.start + video.packets.length) * unit) / divisor,
    audio: audio ?? null,
  };
}

function unpackSnappy(bytes, size) {
  let cursor = 0,
    length = 0;
  function read(count) {
    check(cursor + count <= bytes.length, 'Truncated Hap5 Snappy data');
    let value = 0;
    for (let i = 0; i < count; i++) value += bytes[cursor++] * 2 ** (i * 8);
    return value;
  }
  for (let i = 0; ; i++) {
    check(i < 5, 'Invalid Hap5 Snappy size');
    const next = read(1);
    length += (next & 127) * 2 ** (i * 7);
    if (!(next & 128)) break;
  }
  check(length === size, 'Hap5 Snappy size differs from its texture');
  const texture = new Uint8Array(size);
  let written = 0;
  while (cursor < bytes.length) {
    const tag = read(1),
      operation = tag & 3,
      count = tag >>> 2;
    if (!operation) {
      const length = (count < 60 ? count : read(count - 59)) + 1;
      check(
        cursor + length <= bytes.length && written + length <= size,
        'Invalid Hap5 Snappy literal',
      );
      texture.set(bytes.subarray(cursor, cursor + length), written);
      cursor += length;
      written += length;
    } else {
      const short = operation === 1,
        length = short ? (count & 7) + 4 : count + 1,
        offset = short ? ((tag & 0xe0) << 3) | read(1) : read(operation === 2 ? 2 : 4);
      check(
        offset > 0 && offset <= written && written + length <= size,
        'Invalid Hap5 Snappy copy',
      );
      for (let i = 0; i < length; i++, written++) texture[written] = texture[written - offset];
    }
  }
  check(written === size, 'Incomplete Hap5 Snappy texture');
  return texture;
}

const expand5 = (value) => (value << 3) | (value >>> 2);
const expand6 = (value) => (value << 2) | (value >>> 4);

function decodeBC3(texture, width, height) {
  const data = viewOf(texture),
    rgba = new Uint8Array(width * height * 4),
    color = new Uint8Array(12),
    alpha = new Uint8Array(8);
  for (let by = 0, at = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4, at += 16) {
      alpha[0] = texture[at];
      alpha[1] = texture[at + 1];
      const six = alpha[0] <= alpha[1],
        span = six ? 5 : 7;
      for (let i = 1; i < span; i++) alpha[i + 1] = ((span - i) * alpha[0] + i * alpha[1]) / span;
      if (six) {
        alpha[6] = 0;
        alpha[7] = 255;
      }
      for (let i = 0; i < 2; i++) {
        const packed = data.getUint16(at + 8 + i * 2, true);
        color[i * 3] = expand5(packed >>> 11);
        color[i * 3 + 1] = expand6((packed >>> 5) & 63);
        color[i * 3 + 2] = expand5(packed & 31);
      }
      for (let i = 0; i < 3; i++) {
        color[6 + i] = (2 * color[i] + color[3 + i]) / 3;
        color[9 + i] = (color[i] + 2 * color[3 + i]) / 3;
      }
      const alphaLow = data.getUint32(at + 2, true),
        alphaHigh = data.getUint32(at + 5, true),
        colorBits = data.getUint32(at + 12, true);
      for (let y = 0, pixel = 0; y < 4; y++) {
        let dest = ((by + y) * width + bx) * 4;
        for (let x = 0; x < 4; x++, pixel++, dest += 4) {
          const c = ((colorBits >>> (pixel * 2)) & 3) * 3,
            a = ((pixel < 8 ? alphaLow : alphaHigh) >>> ((pixel & 7) * 3)) & 7;
          rgba[dest] = color[c];
          rgba[dest + 1] = color[c + 1];
          rgba[dest + 2] = color[c + 2];
          rgba[dest + 3] = alpha[a];
        }
      }
    }
  }
  return rgba;
}

export function decodeHap5(packet, width, height) {
  dimensionCheck(width, height);
  check(packet.length >= 4, 'Truncated Hap5 frame');
  const length = packet[0] | (packet[1] << 8) | (packet[2] << 16),
    type = packet[3] & 15,
    compressor = packet[3] >>> 4;
  check(length > 0 && length + 4 <= packet.length, 'Invalid legacy Hap5 section length');
  check(type === HAP_ALPHA, 'Invalid Hap5 texture format');
  const size = width * height,
    payload = packet.subarray(4, 4 + length);
  check(compressor === RAW || compressor === SNAPPY, 'Unsupported legacy Hap5 compressor');
  const texture = compressor === RAW ? payload : unpackSnappy(payload, size);
  check(texture.length === size, 'Hap5 BC3 texture size differs from its dimensions');
  return { width, height, rgba: decodeBC3(texture, width, height) };
}
