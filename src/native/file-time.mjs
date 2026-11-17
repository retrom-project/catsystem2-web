// SPDX-License-Identifier: MPL-2.0
// Win32 FILETIME is unsigned 100-ns ticks from 1601-01-01. Local conversion
// uses the current timezone/DST setting, not the offset at the file's date.
export const EPOCH_MS = 11644473600000n,
  MAX = 0x8000000000000000n;
export function nativeFileTime(milliseconds) {
  if (!Number.isSafeInteger(milliseconds)) return null;
  const value = (BigInt(milliseconds) + EPOCH_MS) * 10000n;
  return value >= 0n && value < MAX ? value : null;
}
export function nativeSystemTime(value) {
  if (typeof value !== 'bigint' || value < 0n || value >= MAX) return null;
  const date = new Date(Number(value / 10000n - EPOCH_MS));
  if (!Number.isFinite(date.getTime())) return null;
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDay(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ];
}
export function fromSystemTime(words) {
  const [year, month, , day, hour, minute, second, millisecond] = words;
  if (
    year < 1601 ||
    year > 30827 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    millisecond > 999
  )
    return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  const time = nativeFileTime(date.getTime()),
    actual = time === null ? null : nativeSystemTime(time);
  return actual && actual.every((n, i) => i === 2 || n === words[i]) ? time : null;
}
