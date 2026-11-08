// SPDX-License-Identifier: MPL-2.0
// Main312 / 6A7910 is an integer weekday calculation, including invalid dates.
import { nativeReply } from '../kcs/vm.mjs';
const truncate32 = (value) =>
  Number.isFinite(value) && value >= -2147483648 && value < 2147483648
    ? Math.trunc(value)
    : -2147483648;
export function nativeWeekday(year, month, day) {
  year |= 0;
  month |= 0;
  day |= 0;
  const y = month > 2 ? year : (year - 1) | 0,
    m = month > 2 ? (month + 1) | 0 : (month + 13) | 0,
    value =
      (Math.trunc(y / 400) +
        truncate32(y * 365.25) -
        truncate32(m * -30.6) -
        Math.trunc(y / 100) +
        day -
        429) |
      0;
  return (1 - 7 * Math.trunc(value / 7) + value) % 7 | 0;
}
export function nativeCalendar(id, args) {
  if (id !== 0x312) return undefined;
  if (args.length !== 3) throw new Error('Native weekday expects year, month and day');
  return nativeReply(1, nativeWeekday(...args));
}
