// SPDX-License-Identifier: MPL-2.0
export const BITMAP_UPLOAD_LAYOUT = Object.freeze({ size: [8, 8], grid: [2, 2] });
export function bitmapUploadCases() {
  return [
    { name: 'full', source: [0, 0, 5, 4], destination: [2, 1] },
    { name: 'subset', source: [1, 1, 3, 2], destination: [4, 3] },
    { name: 'source-clip', source: [-1, -1, 7, 6], destination: [2, 1] },
    { name: 'negative-destination', source: [0, 0, 5, 4], destination: [-2, -1] },
    { name: 'four-pages', source: [0, 0, 5, 4], destination: [6, 6] },
    { name: 'last-page-clip', source: [0, 0, 5, 4], destination: [14, 14] },
    { name: 'off-page', source: [0, 0, 5, 4], destination: [16, 16] },
    { name: 'missing-source-rectangle', source: [8, 0, 2, 2], destination: [2, 1] },
    { name: 'empty-source', source: [0, 0, 0, 2], destination: [2, 1] },
    { name: 'cropped-source-origin', origin: [3, -2], source: [4, -1, 3, 2], destination: [2, 5] },
    { name: 'cropped-origin-clip', origin: [-2, 3], source: [-3, 2, 7, 6], destination: [2, -2] },
  ];
}
export function bitmapUploadSource() {
  // Original physical BGRA rows, deliberately asymmetric in both axes.
  return Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 13 + 17) & 255,
  );
}
