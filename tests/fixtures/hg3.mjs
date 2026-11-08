// SPDX-License-Identifier: MPL-2.0
// Authored top-to-bottom HG3 streams. The frozen engine decoders independently
// verify their row, part and selector contracts in native-hg3.test.mjs.
import { deflateSync } from 'node:zlib';
import { packHGPixels } from '../../src/formats/hg-codec.mjs';

const word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
const text = (value) => [...new TextEncoder().encode(value)];
export function authoredHG3(frames) {
  const bodies = frames.map((frame) => {
    const {
      width,
      height,
      rgba,
      bpp = 32,
      id = 0,
      offsetX = 0,
      offsetY = 0,
      canvasWidth = width,
      canvasHeight = height,
      baseX = 0,
      baseY = 0,
      transparent = 0,
      parts = [height],
    } = frame;
    if (parts.reduce((sum, rows) => sum + rows, 0) !== height)
      throw new Error('Authored HG3 parts must cover every row');
    const sections = [
      [
        'stdinfo',
        Uint8Array.from(
          [
            width,
            height,
            bpp,
            offsetX,
            offsetY,
            canvasWidth,
            canvasHeight,
            transparent,
            baseX,
            baseY,
          ].flatMap(word),
        ),
      ],
    ];
    let top = 0;
    for (const [index, rows] of parts.entries()) {
      const pixelSize = bpp / 8,
        raw = new Uint8Array(width * rows * pixelSize);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < width; x++) {
          const source = ((top + y) * width + x) * 4,
            at = (y * width + x) * pixelSize;
          raw.set([rgba[source + 2], rgba[source + 1], rgba[source]], at);
          if (pixelSize === 4) raw[at + 3] = rgba[source + 3];
        }
      const { data, control } = packHGPixels(raw, width, rows, pixelSize),
        packed = deflateSync(data),
        commands = deflateSync(control);
      sections.push([
        `img${String(index).padStart(4, '0')}`,
        Uint8Array.from([
          ...[top, rows, packed.length, data.length, commands.length, control.length].flatMap(word),
          ...packed,
          ...commands,
        ]),
      ]);
      top += rows;
    }
    return Uint8Array.from([
      ...word(0),
      ...word(id),
      ...sections.flatMap(([name, bytes], index) => [
        ...text(name.padEnd(8, '\0')),
        ...word(index + 1 < sections.length ? bytes.length + 16 : 0),
        ...word(bytes.length),
        ...bytes,
      ]),
    ]);
  });
  for (let i = 0; i + 1 < bodies.length; i++)
    new DataView(bodies[i].buffer).setUint32(0, bodies[i].length, true);
  return Uint8Array.from([
    ...text('HG-3'),
    ...word(12),
    ...word(0x300),
    ...bodies.flatMap((body) => [...body]),
  ]);
}

export function authoredHG3Frames(count = 18) {
  return Array.from({ length: count }, (_, index) => {
    const width = 1 + (index % 7),
      height = 2 + (index % 5),
      bpp = index % 2 ? 24 : 32,
      rgba = Uint8Array.from({ length: width * height * 4 }, (_, at) => {
        if (at % 4 === 3) return bpp === 24 ? 255 : (at * 17 + index) & 255;
        const pixel = at >> 2,
          x = pixel % width,
          y = Math.floor(pixel / width);
        return (x * 53 + y * 29 + (at % 4) * 71 + index * 13) & 255;
      });
    return {
      id: 7 + index * 3,
      width,
      height,
      rgba,
      bpp,
      offsetX: index % 3,
      offsetY: index % 4,
      canvasWidth: width + 5,
      canvasHeight: height + 7,
      baseX: -index | 0,
      baseY: index + 2,
      parts: index % 3 ? [1, height - 1] : [height],
    };
  });
}
