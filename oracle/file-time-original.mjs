// SPDX-License-Identifier: MPL-2.0
import {
  nativeFileTime,
  nativeSystemTime,
  fromSystemTime,
  EPOCH_MS,
  MAX,
} from '../src/native/file-time.mjs';
export function installNativeFileTimes(
  kernel,
  {
    wallNow = Date.now,
    localOffsetMinutes = (now = wallNow()) => -new Date(now).getTimezoneOffset(),
  } = {},
) {
  const p = kernel.process,
    read = (at) => BigInt(p.load(at)) + BigInt(p.load(at + 4)) * 0x100000000n,
    write = (at, value) => kernel.write64(at, value),
    def = (name, count, fn) => kernel.register('KERNEL32.dll', name, { count, fn }),
    fail = (error) => {
      kernel.lastError = error;
      return 0;
    },
    offsetAt = (now) => {
      const offset = localOffsetMinutes(now);
      if (!Number.isInteger(offset) || Math.abs(offset) > 24 * 60)
        throw new Error('Native timezone provider must return current offset minutes east of UTC');
      return offset;
    },
    writeSystemTime = (out, words) => {
      const bytes = new Uint8Array(16),
        view = new DataView(bytes.buffer);
      words.forEach((word, i) => view.setUint16(i * 2, word, true));
      p.write(out, bytes);
    };
  def('GetLocalTime', 1, ([out]) => {
    const now = Math.trunc(wallNow()),
      local = nativeFileTime(now + offsetAt(now) * 60000),
      words = nativeSystemTime(local);
    if (!out || !words) throw new Error('Native local time requires a valid SYSTEMTIME output');
    writeSystemTime(out, words);
  });
  def('CompareFileTime', 2, ([a, b]) => {
    const first = read(a),
      second = read(b);
    return first === second ? 0 : first < second ? -1 : 1;
  });
  def('GetFileTime', 4, async ([handle, created, accessed, modified]) => {
    const file = kernel.files.get(handle);
    if (!file) return fail(6);
    if (!created && !accessed && !modified) return 1;
    const source = await kernel.stat(file.path),
      info = source ? { ...source, ...file.pendingTimes } : file.pendingTimes;
    if (!info) return fail(50);
    const values = [];
    for (const [out, field] of [
      [created, 'createdMs'],
      [accessed, 'accessedMs'],
      [modified, 'modifiedMs'],
    ]) {
      if (!out) continue;
      const time = nativeFileTime(info[field]);
      if (time === null) return fail(50);
      values.push([out, time]);
    }
    for (const [out, time] of values) write(out, time);
    return 1;
  });
  def('SetFileTime', 4, ([handle, created, accessed, modified]) => {
    const file = kernel.files.get(handle);
    if (!file) return fail(6);
    if (!file.writable) return fail(5);
    const times = {};
    for (const [input, field] of [
      [created, 'createdMs'],
      [accessed, 'accessedMs'],
      [modified, 'modifiedMs'],
    ]) {
      if (!input) continue;
      const time = read(input);
      if (!time) continue;
      if (time >= MAX) return fail(87);
      times[field] = Number(time / 10000n - EPOCH_MS);
    }
    file.pendingTimes = { ...file.pendingTimes, ...times };
    return 1;
  });
  def('FileTimeToSystemTime', 2, ([input, out]) => {
    if (!input || !out) return fail(87);
    const words = nativeSystemTime(read(input));
    if (!words) return fail(87);
    writeSystemTime(out, words);
    return 1;
  });
  def('SystemTimeToFileTime', 2, ([input, out]) => {
    if (!input || !out) return fail(87);
    const bytes = p.read(input, 16),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      value = fromSystemTime(Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2, true)));
    if (value === null) return fail(87);
    write(out, value);
    return 1;
  });
  for (const [name, direction] of [
    ['FileTimeToLocalFileTime', 1],
    ['LocalFileTimeToFileTime', -1],
  ])
    def(name, 2, ([input, out]) => {
      if (!input || !out || input === out) return fail(87);
      const time = read(input),
        offset = offsetAt();
      if (time >= MAX) return fail(87);
      const result = time + BigInt(direction * offset) * 600000000n;
      if (result < 0n || result >= MAX) return fail(87);
      write(out, result);
      return 1;
    });
}
