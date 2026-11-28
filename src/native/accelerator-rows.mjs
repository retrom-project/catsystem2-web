// SPDX-License-Identifier: MPL-2.0
// ACCEL row matching shared by the typed window and the Win32 boundary.
// Resource type9/id101 has the same four rows in both registered engines.
// The resource terminator bit is stripped by the existing 8B-to-6B parser.
export const NATIVE_WINDOW_BASE_ACCELERATORS = Object.freeze([
  Object.freeze([19, 112, 40021]),
  Object.freeze([19, 13, 40012]),
  Object.freeze([19, 115, 40002]),
  Object.freeze([3, 45, 40030]),
]);

const VIRTUAL_KEY = 1,
  ALT = 0x10,
  MODIFIERS = 0x1c;

export function matchNativeAcceleratorRows(rows, message, key, data, modifiers = 0) {
  if (!rows) return null;
  const character = message === 0x102 || message === 0x106;
  if (!character && message !== 0x100 && message !== 0x104) return null;
  for (const [flags, code, command] of rows) {
    if (code !== key) continue;
    if (flags & VIRTUAL_KEY) {
      if (!character && (flags & MODIFIERS) === (modifiers & MODIFIERS)) return command;
    } else if (
      character
        ? (flags & ALT) === (modifiers & ALT)
        : flags & ALT && (data & 0x21000000) === 0x20000000
    )
      return command;
  }
  return null;
}
