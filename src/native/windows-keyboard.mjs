// SPDX-License-Identifier: MPL-2.0
// Virtual US keyboard for posted key messages without a browser layout.
const punctuation = new Map([
  [0xba, ';:'],
  [0xbb, '=+'],
  [0xbc, ',<'],
  [0xbd, '-_'],
  [0xbe, '.>'],
  [0xbf, '/?'],
  [0xc0, '`~'],
  [0xdb, '[{'],
  [0xdc, '\\|'],
  [0xdd, ']}'],
  [0xde, '\'"'],
  [0xe2, '<>'],
]);
const shiftedControl = new Map([
  [0x20, 0],
  [0x32, 0],
  [0x36, 30],
  [0xbd, 31],
  [0xc0, 30],
]);

export function virtualKeyCharacter(key, modifiers, { capsLock = false, numLock = false } = {}) {
  const shift = Boolean(modifiers & 4),
    control = Boolean(modifiers & 8);
  if (control && modifiers & 16) return null;
  if (key >= 0x41 && key <= 0x5a) {
    if (control) return key - 0x40;
    return shift !== capsLock ? key : key + 32;
  }
  if (key >= 0x60 && key <= 0x69) {
    if (!numLock || shift) return null;
    return control ? [0, 1, 0, 27, 28, 29, 30, 31, 127, 9][key - 0x60] : key - 0x30;
  }
  if (key >= 0x6a && key <= 0x6f) {
    if (shift && (key === 0x6c || key === 0x6e)) return null;
    return '*+.-./'.charCodeAt(key - 0x6a);
  }
  if (key === 0x08 || key === 0x1b) return key;
  if (key === 0x92) return 0x3d;
  if (control) {
    if (key === 0x0d) return shift ? null : 0x0a;
    if (key === 0x20 && !shift) return key;
    if (key >= 0xdb && key <= 0xdd) return key - 0xc0;
    return shift ? (shiftedControl.get(key) ?? null) : null;
  }
  if (key === 0x09 || key === 0x0d || key === 0x20) return key;
  if (key >= 0x30 && key <= 0x39) return shift ? ')!@#$%^&*('.charCodeAt(key - 0x30) : key;
  return punctuation.get(key)?.charCodeAt(Number(shift)) ?? null;
}
