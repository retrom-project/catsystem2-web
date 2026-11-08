// SPDX-License-Identifier: MPL-2.0
// DirectSound's hundredths-of-decibel value, recovered from game 5D1F70.
export function nativeSoundDecibels(volume, factor = 100, minimum = -10000, maximum = 0) {
  const percent = Math.floor((Math.imul(volume, factor) >>> 0) / 100);
  let value;
  if (percent >= 100) value = maximum | 0;
  else if (!percent) value = minimum | 0;
  else {
    const input = Math.fround(percent * Math.fround(0.01));
    const logarithm = Math.fround(Math.log10(input));
    value = Math.trunc(Math.fround(Math.fround(logarithm * Math.fround(33.22)) * 100));
  }
  return Math.min(maximum | 0, Math.max(minimum | 0, value));
}

export function nativeSoundGain(volume, factor = 100) {
  return 10 ** (nativeSoundDecibels(volume, factor) / 2000);
}

// The original playback entry halves positions for 22050 Hz, and otherwise
// preserves positions. Negative end means play through the end of the stream.
export function nativeLoopFrames(start, end, sampleRate) {
  start = BigInt.asIntN(64, BigInt(start));
  end = BigInt.asIntN(64, BigInt(end));
  if (sampleRate === 22050) {
    start /= 2n;
    if (end >= 0n) end /= 2n;
  }
  return { start, end };
}
