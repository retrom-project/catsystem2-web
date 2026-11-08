// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';

// The decoded AudioBuffer may use the browser output rate. Native decoder
// queries and loop positions retain the source rate and container units.
export function readAudioSource(bytes, decoded) {
  const b = new Binary(bytes, 'audio source');
  let fields = {
    codec: 'unknown',
    sampleRate: decoded?.sampleRate ?? null,
    channels: decoded?.numberOfChannels ?? null,
    bitsPerSample: null,
    pcmBytes: null,
    sampleFrames: null,
    durationSeconds: decoded?.duration ?? null,
  };
  if (bytes.length >= 12 && b.magic('RIFF') && b.str(8, 4) === 'WAVE') {
    let format = null,
      dataBytes = 0;
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = b.u32(at + 4);
      if (at + 8 + size > bytes.length) throw new Error('Truncated WAV chunk');
      if (b.str(at, 4) === 'fmt ') {
        if (size < 16) throw new Error('Truncated WAV format');
        const data = at + 8;
        format = {
          formatTag: b.u16(data),
          channels: b.u16(data + 2),
          sampleRate: b.u32(data + 4),
          averageBytesPerSecond: b.u32(data + 8),
          blockAlign: b.u16(data + 12),
          bitsPerSample: b.u16(data + 14),
          samplesPerBlock: size >= 20 ? b.u16(data + 18) : 0,
        };
      } else if (b.str(at, 4) === 'data') dataBytes += size;
      at += 8 + size + (size & 1);
    }
    if (!format) throw new Error('WAV format is absent');
    const adpcm = [2, 17].includes(format.formatTag);
    const sampleFrames = adpcm
      ? format.blockAlign
        ? Math.floor(dataBytes / format.blockAlign) * format.samplesPerBlock
        : 0
      : format.channels && format.bitsPerSample
        ? Math.floor(dataBytes / (format.channels * (format.bitsPerSample >>> 3)))
        : 0;
    const bitsPerSample = adpcm ? 16 : format.bitsPerSample;
    fields = {
      ...fields,
      ...format,
      codec: adpcm ? 'adpcm' : 'wav',
      dataBytes,
      bitsPerSample,
      sampleFrames,
      pcmBytes: adpcm ? sampleFrames * format.channels * 2 : dataBytes,
      durationSeconds: format.sampleRate
        ? sampleFrames / format.sampleRate
        : (decoded?.duration ?? null),
    };
  } else if (bytes.length >= 27 && b.magic('OggS')) {
    let stream = null,
      total = null,
      sampleRate = null,
      channels = null;
    for (let at = 0; at + 27 <= bytes.length; ) {
      if (!b.magic('OggS', at) || b.u8(at + 4) !== 0) throw new Error('Invalid Ogg page');
      const segments = b.u8(at + 26);
      b.range(at + 27, segments);
      let length = 0;
      for (let i = 0; i < segments; i++) length += b.u8(at + 27 + i);
      const data = at + 27 + segments;
      b.range(data, length);
      const serial = b.u32(at + 14),
        granule = BigInt(b.u32(at + 6)) | (BigInt(b.u32(at + 10)) << 32n);
      if (length >= 16 && b.u8(data) === 1 && b.str(data + 1, 6) === 'vorbis') {
        stream = serial;
        channels = b.u8(data + 11);
        sampleRate = b.u32(data + 12);
      }
      if (serial === stream && granule !== 0xffffffffffffffffn) total = granule;
      at = data + length;
    }
    if (sampleRate) {
      if (total !== null && total > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error('Ogg sample count exceeds exact browser addressing');
      fields = {
        ...fields,
        codec: 'ogg',
        sampleRate,
        channels,
        bitsPerSample: 16,
        sampleFrames: total === null ? null : Number(total),
        pcmBytes: total === null ? null : Number(total) * channels * 2,
        durationSeconds: total === null ? (decoded?.duration ?? null) : Number(total) / sampleRate,
      };
    }
  }
  return Object.freeze(fields);
}
