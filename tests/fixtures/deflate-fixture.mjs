// SPDX-License-Identifier: MPL-2.0
export function authoredDeflateBytes(length, pattern) {
  let state = 0x7badcafe;
  return Uint8Array.from({ length }, (_, i) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return pattern === 'random' ? state >>> 24 : pattern === 'runs' ? (i >>> 10) & 255 : i % 17;
  });
}
export function authoredDeflateCases() {
  return [0, 1, 3, 15, 16, 255, 4095, 4096, 65535, 65536, 65537, 131073].flatMap((length) =>
    ['random', 'runs', 'periodic'].flatMap((pattern) =>
      [0, 1, 32, length * 2 + 64].map((capacity) => ({ length, pattern, capacity, fill: 165 })),
    ),
  );
}
