// SPDX-License-Identifier: MPL-2.0
import { nativeSoundDecibels } from './sound-math.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { lowerSoundName } from './sound-config.mjs';

const f = Math.fround;
const cvtt = (value) =>
  Number.isFinite(value) && value >= -2147483648 && value < 2147483648
    ? Math.trunc(value) | 0
    : -2147483648;
export const nativeSoundPan = (value) => Math.max(-100, Math.min(100, value | 0));

// IDirectSoundBuffer pan is attenuation of one channel, with center at unity
// in both channels. A WebAudio equal-power StereoPanner has a different curve.
export function nativeSoundPanDecibels(value) {
  const pan = nativeSoundPan(value);
  if (!pan) return 0;
  if (pan === 100) return 10000;
  if (pan === -100) return -10000;
  const attenuation = nativeSoundDecibels(100 - Math.abs(pan));
  return pan > 0 ? -attenuation : attenuation;
}

export function nativeSoundPanGains(value) {
  const db = nativeSoundPanDecibels(value);
  return db >= 0 ? [10 ** (-db / 2000), 1] : [1, 10 ** (db / 2000)];
}

// Pan controls the position of an available DirectSound3DBuffer.
export function nativeSoundPanPosition(value) {
  const normalized = f(nativeSoundPan(value) * f(0.01));
  const angle = f(Math.acos(Math.max(-1, Math.min(1, normalized))));
  const cosine = f(Math.cos(angle)),
    sine = f(Math.sin(angle));
  return [f(f(sine * 0) + cosine), 0, f(f(cosine * 0) - sine)];
}

// Store XYZ even without a 3D buffer. Derive ordinary pan from X and Z.
export function nativeSoundPositionPan(x, z) {
  const angle = f(Math.atan2(f(x), f(z)));
  return nativeSoundPan(cvtt(f(f(Math.sin(angle)) * 100)));
}

export const NATIVE_SOUND_SPATIAL_DEFAULTS = Object.freeze({
  pan: 0,
  maximumDistance: 100,
  minimumDistance: 100,
  dopplerFactor: 1,
  position: Object.freeze([0, 0, 0]),
  velocity: Object.freeze([0, 0, 0]),
});

// Decoder vtable slot +28 is not consistent across the original codec classes.
// The WAV implementation returns frames; Ogg and ADPCM implementations return ms.
export function nativeSoundDecoderQuery({
  codec,
  pcmBytes,
  channels,
  bitsPerSample,
  sampleRate,
  durationSeconds,
}) {
  if (codec === 'ogg') return Math.trunc(durationSeconds * 1000) >>> 0;
  if (codec !== 'wav' && codec !== 'adpcm')
    throw new Error(`Unrecovered native sound decoder query ${codec}`);
  const bytesPerSample = (bitsPerSample & 0xffff) >>> 3;
  channels &= 0xffff;
  if (!bytesPerSample || !channels || (codec === 'adpcm' && !(sampleRate >>> 0)))
    throw new Error('Native sound decoder query divides by zero');
  if (codec === 'wav') return Math.floor((pcmBytes >>> 0) / (channels * bytesPerSample)) >>> 0;
  const frames = Math.floor(Math.floor((pcmBytes >>> 0) / channels) / bytesPerSample);
  return Math.floor((Math.imul(1000, frames) >>> 0) / (sampleRate >>> 0)) >>> 0;
}

const fieldBytes = (configuration, record, offset, capacity) => {
  const start = configuration.voiceRecordByte(record) + offset,
    bytes = configuration.blocks[0].subarray(start, start + capacity);
  const nul = bytes.indexOf(0);
  if (nul < 0) throw new Error('Unterminated native VOICE configuration field');
  return bytes.subarray(0, nul);
};
const foldByte = (value) => (value >= 65 && value <= 90 ? value + 32 : value);
const sameFoldedBytes = (left, right) =>
  left.length === right.length && left.every((value, i) => foldByte(value) === foldByte(right[i]));

// Legacy sound classification tries the archive or parent directory before filename prefixes.
// Unlike head, the configuration's int field is compared without case.
export function nativeLegacySoundIndex(configuration, filename) {
  const { count, archiveByte, headBytes } = configuration.voiceLayout,
    source = encodeCP932(filename);
  let lastSeparator = 0;
  for (let at = 0; at < source.length; at++) {
    const lead = source[at],
      trail = source[at + 1];
    if (
      ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xef)) &&
      ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc))
    )
      at++;
    else if (lead === 47 || lead === 92) lastSeparator = at;
  }
  if (lastSeparator) {
    let directory = source.subarray(0, lastSeparator);
    for (let at = directory.length - 1; at >= 0; at--) {
      if (directory[at] === 47 || directory[at] === 92) break;
      if (directory[at] === 46) {
        directory = directory.subarray(0, at);
        break;
      }
    }
    for (let row = 0; row < count; row++)
      if (sameFoldedBytes(directory, fieldBytes(configuration, row, archiveByte, 32))) return row;
  }
  const name = encodeCP932(lowerSoundName(filename));
  for (let row = 0; row < count; row++) {
    const prefix = fieldBytes(configuration, row, 40, headBytes);
    if (
      prefix.length &&
      prefix.length <= name.length &&
      prefix.every((value, i) => value === name[i])
    )
      return row;
  }
  return -1;
}

export function nativeLegacySoundCategory(configuration, filename) {
  const row = nativeLegacySoundIndex(configuration, filename);
  return row < 0
    ? ''
    : new TextDecoder('shift_jis').decode(
        fieldBytes(configuration, row, configuration.voiceLayout.archiveByte, 32),
      );
}

// Classify the directory before the bare filename. The
// basename scan uses raw bytes. The directory scan respects CP932 pairs.
export function nativeLegacySoundGroup(configuration, filename) {
  const voice = configuration.blocks[0],
    { count, archiveByte, headBytes, groupByte } = configuration.voiceLayout,
    words = new DataView(voice.buffer, voice.byteOffset, voice.byteLength),
    group = (row) => words.getInt32(configuration.voiceRecordByte(row) + groupByte, true),
    source = encodeCP932(filename);
  let separator = 0;
  for (let i = 0; i < source.length; i++) {
    const lead = source[i],
      trail = source[i + 1];
    if (
      ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xef)) &&
      ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc))
    )
      i++;
    else if (lead === 47 || lead === 92) separator = i;
  }
  if (separator) {
    let directory = source.subarray(0, separator);
    for (let i = directory.length - 1; i >= 0; i--) {
      if (directory[i] === 47 || directory[i] === 92) break;
      if (directory[i] === 46) {
        directory = directory.subarray(0, i);
        break;
      }
    }
    for (let row = 0; row < count; row++)
      if (sameFoldedBytes(directory, fieldBytes(configuration, row, archiveByte, 32)))
        return group(row);
  }
  separator = 0;
  for (let i = 0; i < source.length; i++) if (source[i] === 47 || source[i] === 92) separator = i;
  const name = source.subarray(separator ? separator + 1 : 0);
  for (let row = 0; row < count; row++) {
    const prefix = fieldBytes(configuration, row, 40, headBytes);
    if (
      prefix.length &&
      prefix.length <= name.length &&
      prefix.every((value, i) => value === foldByte(name[i]))
    )
      return group(row);
  }
  return -1;
}

// Measure average absolute differences between successive PCM frames.
// It is a high-frequency activity measure, not absolute amplitude or RMS.
export function nativePCMLevel(bytes, channels, bitsPerSample) {
  if (![8, 16].includes(bitsPerSample) || ![1, 2].includes(channels)) return 0;
  const width = bitsPerSample >>> 3,
    samples = Math.floor(bytes.length / width);
  if (!samples || (channels === 2 && samples < 3))
    throw new Error('Native PCM level window reads outside its sample range');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sample = bitsPerSample === 8 ? (i) => bytes[i] : (i) => view.getInt16(i * 2, true);
  const scale = bitsPerSample === 8 ? 256 : 1;
  let total = 0;
  if (channels === 1) {
    for (let i = 1; i < samples; i++)
      total = (total + Math.abs(sample(i - 1) - sample(i)) * scale) >>> 0;
    return Math.floor(total / samples) >>> 0;
  }
  const frames = samples >>> 1;
  for (let frame = 1; frame < frames; frame++) {
    const at = frame * 2;
    total =
      (total +
        (((Math.abs(sample(at - 2) - sample(at)) + Math.abs(sample(at - 1) - sample(at + 1))) *
          scale) >>
          1)) >>>
      0;
  }
  return Math.floor(total / frames) >>> 0;
}
