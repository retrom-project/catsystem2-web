// SPDX-License-Identifier: MPL-2.0
import { deflateSync } from 'node:zlib';
import { encodeCP932 } from '../src/kcs.mjs';
export const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
export const ascii = (text) => [...new TextEncoder().encode(text)];
export function kcsProgram(instructions, strings = []) {
  const code = instructions.flatMap(([op, ...args]) => [
      op,
      ...args.flatMap((arg) => {
        const [mode, value] = Array.isArray(arg) ? arg : [0x23, arg];
        return [mode, ...u32(value)];
      }),
    ]),
    table = [],
    text = [];
  for (const [address, value] of strings) {
    table.push(...u32(strings.length * 8 + text.length), ...u32(address));
    text.push(...encodeCP932(value), 0);
  }
  const body = Uint8Array.from([...code, ...table, ...text]);
  return Uint8Array.from([
    ...[
      0x0053434b,
      2,
      0,
      52,
      code.length,
      52 + code.length,
      strings.length,
      table.length + text.length,
      4096,
      4096,
      52 + body.length,
      0,
      Math.max(body.length, code.length * 2),
    ].flatMap(u32),
    ...deflateSync(body),
  ]);
}
export function catScene(lines) {
  const strings = [],
    offsets = [];
  for (const [kind, text] of lines) {
    offsets.push(strings.length);
    strings.push(1, kind, ...encodeCP932(text), 0);
  }
  const body = new Uint8Array([
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(offsets.length * 4),
    ...offsets.flatMap(u32),
    ...strings,
  ]);
  const packed = deflateSync(body);
  return new Uint8Array([
    ...ascii('CatScene'),
    ...u32(packed.length),
    ...u32(body.length),
    ...packed,
  ]);
}
export function translation(languages, messages) {
  const number = (value) => {
    const result = [];
    while (value >= 255) {
      result.push(255);
      value -= 255;
    }
    return [...result, value];
  };
  const string = (value) => {
    const b = ascii(value);
    return [...number(b.length), ...b];
  };
  return new Uint8Array([
    ...ascii('CSTL'),
    0,
    0,
    0,
    0,
    ...number(languages.length),
    ...languages.flatMap(string),
    ...number(messages.length),
    ...messages.flatMap((m) =>
      languages.flatMap((lang) => [...string(m[lang][0]), ...string(m[lang][1])]),
    ),
  ]);
}
export function kif(entries) {
  const data = [],
    table = [],
    start = 8 + entries.length * 72;
  for (const [name, bytes] of entries) {
    const n = ascii(name);
    table.push(
      ...n,
      ...Array(64 - n.length).fill(0),
      ...u32(start + data.length),
      ...u32(bytes.length),
    );
    data.push(...bytes);
  }
  return new Uint8Array([...ascii('KIF\0'), ...u32(entries.length), ...table, ...data]);
}
export function memoryGame(files) {
  return {
    width: 640,
    height: 480,
    index: new Map(Object.keys(files).map((n) => [n, {}])),
    has: (n) => Object.hasOwn(files, n.toLowerCase()),
    names: (ext) => Object.keys(files).filter((n) => n.endsWith(`.${ext}`)),
    async read(name) {
      return files[name.toLowerCase()] || null;
    },
    async require(name) {
      const bytes = files[name.toLowerCase()];
      if (!bytes) throw new Error(`Missing resource: ${name}`);
      return bytes;
    },
  };
}
export function hg3(width, height, rgba) {
  const pixel = new Uint8Array(rgba.length),
    stride = width * 4;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4,
        p = (y * width + x) * 4;
      pixel.set([rgba[source + 2], rgba[source + 1], rgba[source], rgba[source + 3]], p);
    }
  const delta = pixel.slice();
  for (let y = height - 1; y > 0; y--)
    for (let x = 0; x < stride; x++) delta[y * stride + x] -= pixel[(y - 1) * stride + x];
  for (let x = stride - 1; x >= 4; x--) delta[x] -= pixel[x - 4];
  const folded = delta.map((v) => (v & 128 ? ((255 - v) << 1) | 1 : v << 1)),
    total = folded.length,
    planes = new Uint8Array(total);
  for (let i = 0; i < total / 4; i++)
    for (let plane = 0; plane < 4; plane++)
      for (let channel = 0; channel < 4; channel++)
        planes[(plane * total) / 4 + i] |=
          ((folded[i * 4 + channel] >> (6 - plane * 2)) & 3) << (channel * 2);
  const gamma = (n) => {
      const bits = n.toString(2);
      return [...Array(bits.length - 1).fill(0), ...bits.split('').map(Number)];
    },
    controlBits = [1, ...gamma(total), ...gamma(total)],
    control = new Uint8Array(Math.ceil(controlBits.length / 8));
  controlBits.forEach((bit, i) => {
    control[i >> 3] |= bit << (i & 7);
  });
  const packed = deflateSync(planes),
    packedControl = deflateSync(control);
  const info = [width, height, 32, 0, 0, width, height, 0, 0, 0].flatMap(u32);
  const section = [
    ...u32(0),
    ...u32(height),
    ...u32(packed.length),
    ...u32(total),
    ...u32(packedControl.length),
    ...u32(control.length),
    ...packed,
    ...packedControl,
  ];
  return new Uint8Array([
    ...ascii('HG-3'),
    ...u32(12),
    ...u32(0x300),
    ...u32(0),
    ...u32(0),
    ...ascii('stdinfo\0'),
    ...u32(56),
    ...u32(40),
    ...info,
    ...ascii('img0000\0'),
    ...u32(0),
    ...u32(section.length),
    ...section,
  ]);
}
