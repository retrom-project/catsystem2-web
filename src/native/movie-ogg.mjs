// SPDX-License-Identifier: MPL-2.0
// Ogg header and media-type contracts for the frozen engine's Xiph filters.
export const OGG_CLASSES = new Map([
  ['dsfOggDemux2.dll', ['ogg-splitter', [0xc9361f5a, 0x49443282, 0x996d9998, 0x0b37c5cd]]],
  ['dsfTheoraDecoder.dll', ['theora', [0x05187161, 0x43245c36, 0xbf2234a7, 0x2d9f5037]]],
  ['dsfVorbisDecoder.dll', ['ogg-vorbis', [0x05a1d945, 0x44efa794, 0x852f1ab4, 0x5571111a]]],
]);

const MEDIATYPE_STREAM = [0xe436eb83, 0x11ce524f, 0x2000539f, 0x70a70baf];
const MEDIASUBTYPE_OGG = [0xdd142c1e, 0x43810c1e, 0x2d0b4ea2, 0x8a09b680];
const MEDIATYPE_OGG_PACKETS = [0x60891713, 0x4767c24f, 0xa06cc9b6, 0xfc38335b];
const MEDIASUBTYPE_NONE = [0xe436eb8e, 0x11ce524f, 0x2000539f, 0x70a70baf];
const FORMAT_OGG_IDENT = [0x95388704, 0x42a9162c, 0x57c34981, 0xf9aa127c];
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index << 24;
  for (let i = 0; i < 8; i++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
  return crc >>> 0;
});
const OGG_CAPTURE = 0x5367674f;
const VFW_E_UNSUPPORTED_STREAM = 0x80040265;
const text = new TextDecoder();

export const OGG_INPUT_TYPE = {
  words: [...MEDIATYPE_STREAM, ...MEDIASUBTYPE_OGG, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
};

export function oggPacketType(track) {
  // The legacy filter leaves lSampleSize undefined for this variable-size
  // stream. The identification packet is the format block.
  return {
    words: [
      ...MEDIATYPE_OGG_PACKETS,
      ...MEDIASUBTYPE_NONE,
      0,
      0,
      0,
      ...FORMAT_OGG_IDENT,
      0,
      track.identifier.length,
      0,
    ],
    format: track.identifier,
  };
}

class OggHeaderError extends Error {}

function pageChecksum(bytes, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = i >= start + 22 && i < start + 26 ? 0 : bytes[i];
    crc = ((crc << 8) ^ CRC_TABLE[(crc >>> 24) ^ byte]) >>> 0;
  }
  return crc;
}

function readPage(bytes, view, start) {
  if (start + 27 > bytes.length || view.getUint32(start, true) !== OGG_CAPTURE)
    throw new OggHeaderError('Missing Ogg page header');
  const version = bytes[start + 4],
    flags = bytes[start + 5],
    endLacing = start + 27 + bytes[start + 26];
  if (version || flags & ~7 || endLacing > bytes.length)
    throw new OggHeaderError('Invalid Ogg page header');
  let end = endLacing,
    identification = null;
  for (let offset = start + 27; offset < endLacing; offset++) {
    end += bytes[offset];
    if (identification === null && bytes[offset] < 255) identification = end;
  }
  if (end > bytes.length) throw new OggHeaderError('Truncated Ogg page');
  if (view.getUint32(start + 22, true) !== pageChecksum(bytes, start, end))
    throw new OggHeaderError('Invalid Ogg page checksum');
  return {
    flags,
    serial: view.getUint32(start + 14, true),
    sequence: view.getUint32(start + 18, true),
    identifier:
      identification === null ? null : Uint8Array.from(bytes.subarray(endLacing, identification)),
    end,
  };
}

function identify({ identifier, serial }) {
  if (text.decode(identifier.subarray(0, 8)) === 'fishead\0') return null;
  const kind = text.decode(identifier.subarray(1, 7));
  if (kind === 'theora' && identifier[0] === 0x80 && identifier.length === 42)
    return { type: 1, codec: 'theora', index: serial, identifier };
  if (kind === 'vorbis' && identifier[0] === 1 && identifier.length === 30)
    return { type: 2, codec: 'vorbis', index: serial, identifier };
  return { type: 0, codec: 'unknown', index: serial, identifier };
}

export function nativeOggTracks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    tracks = [],
    serials = new Set();
  if (bytes.length < 4 || view.getUint32(0, true) !== OGG_CAPTURE)
    return { error: 'Missing Ogg capture pattern', status: VFW_E_UNSUPPORTED_STREAM };
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const page = readPage(bytes, view, offset);
      if (!(page.flags & 2)) break;
      if (page.flags & 1 || page.sequence || !page.identifier?.length || serials.has(page.serial))
        throw new OggHeaderError('Invalid Ogg beginning-of-stream packet');
      serials.add(page.serial);
      const track = identify(page);
      if (track) tracks.push(track);
      offset = page.end;
    }
    if (!tracks.length) throw new OggHeaderError('Missing Ogg logical stream headers');
    return { tracks };
  } catch (error) {
    if (!(error instanceof OggHeaderError)) throw error;
    return { error: error.message };
  }
}
