// SPDX-License-Identifier: MPL-2.0
// WebM classes and stream headers used by the original kcVideo loader.
export const WEBM_CLASSES = new Map([
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
