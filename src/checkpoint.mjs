// SPDX-License-Identifier: MPL-2.0
export const CHECKPOINT_LIMIT = 256 * 1024 * 1024;
const PORTABLE_LIMIT = CHECKPOINT_LIMIT * 2;
const MAGIC = new TextEncoder().encode('CS2WEB\0');

// Count binary state as bytes, not JSON's decimal properties for typed arrays.
// This also preserves Map/Set, shared buffers and cyclic object references,
// which IndexedDB's structured clone supports.
export function checkpointBytes(value, limit = CHECKPOINT_LIMIT) {
  const seen = new WeakSet(),
    encoder = new TextEncoder();
  let size = 0;
  const add = (n) => {
    size += n;
    if (size > limit) throw new Error(`Checkpoint exceeds ${limit} bytes`);
  };
  const visit = (value) => {
    if (value === null || value === undefined) {
      add(1);
      return;
    }
    if (typeof value === 'string') {
      add(encoder.encode(value).length);
      return;
    }
    if (['number', 'bigint', 'boolean'].includes(typeof value)) {
      add(8);
      return;
    }
    if (typeof value !== 'object')
      throw new TypeError('Checkpoint contains a non-serializable value');
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof ArrayBuffer) {
      add(value.byteLength);
      return;
    }
    if (ArrayBuffer.isView(value)) {
      visit(value.buffer);
      return;
    }
    if (value instanceof Date) {
      add(8);
      return;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      add(value.size);
      return;
    }
    if (value instanceof Map) {
      for (const [key, item] of value) {
        visit(key);
        visit(item);
      }
      return;
    }
    if (value instanceof Set || Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      visit(key);
      visit(item);
    }
  };
  visit(value);
  return size;
}

const typedArrays = Object.fromEntries(
  [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
  ].map((type) => [type.name, type]),
);
const base64 = (buffer) => {
  const bytes = new Uint8Array(buffer),
    parts = [];
  for (let at = 0; at < bytes.length; at += 32768)
    parts.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
  return btoa(parts.join(''));
};
const unbase64 = (text) => {
  if (typeof text !== 'string' || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new Error('Invalid checkpoint buffer encoding');
  const decoded = atob(text);
  return Uint8Array.from(decoded, (c) => c.charCodeAt(0)).buffer;
};
async function transform(bytes, stream, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(),
    chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error(`Checkpoint file exceeds ${limit} bytes`);
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.length;
  }
  return output;
}

// IndexedDB uses structured clone. Export files must retain the same resource
// graph, including shared buffers, bigint loop points, Maps and cyclic links.
// An explicit graph encoding avoids lossy JSON.stringify(typedArray) output.
export async function serializeCheckpoint(value) {
  checkpointBytes(value);
  const ids = new WeakMap(),
    nodes = [];
  const encode = async (value) => {
    if (value === undefined) return ['undefined'];
    if (typeof value === 'bigint') return ['bigint', String(value)];
    if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))
      return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (value === null || typeof value !== 'object') return value;
    if (ids.has(value)) return ['ref', ids.get(value)];
    const id = nodes.length;
    ids.set(value, id);
    nodes.push(null);
    let node;
    if (value instanceof ArrayBuffer) node = ['buffer', base64(value)];
    else if (ArrayBuffer.isView(value))
      node = [
        value instanceof DataView ? 'DataView' : value.constructor.name,
        await encode(value.buffer),
        value.byteOffset,
        value instanceof DataView ? value.byteLength : value.length,
      ];
    else if (value instanceof Date) node = ['date', await encode(value.getTime())];
    else if (value instanceof Blob)
      node = ['blob', value.type, await encode(await value.arrayBuffer())];
    else if (value instanceof Map)
      node = [
        'map',
        await Promise.all(
          [...value].map(async ([key, item]) => [await encode(key), await encode(item)]),
        ),
      ];
    else if (value instanceof Set) node = ['set', await Promise.all([...value].map(encode))];
    else if (Array.isArray(value))
      node = [
        'array',
        await Promise.all(
          Object.entries(value).map(async ([key, item]) => [key, await encode(item)]),
        ),
        value.length,
      ];
    else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== null && prototype !== Object.prototype)
        throw new TypeError('Checkpoint contains an unsupported object type');
      node = [
        prototype === null ? 'null-object' : 'object',
        await Promise.all(
          Object.entries(value).map(async ([key, item]) => [key, await encode(item)]),
        ),
      ];
    }
    nodes[id] = node;
    return ['ref', id];
  };
  const root = await encode(value),
    plain = new TextEncoder().encode(JSON.stringify({ root, nodes }));
  if (plain.length > PORTABLE_LIMIT)
    throw new Error('Checkpoint graph encoding exceeds file limit');
  const packed = await transform(plain, new CompressionStream('gzip'), CHECKPOINT_LIMIT),
    file = new Uint8Array(MAGIC.length + packed.length);
  file.set(MAGIC);
  file.set(packed, MAGIC.length);
  return file;
}

export async function deserializeCheckpoint(file) {
  if (
    !(file instanceof Uint8Array) ||
    file.length > CHECKPOINT_LIMIT ||
    file.length <= MAGIC.length ||
    MAGIC.some((byte, i) => file[i] !== byte)
  )
    throw new Error('Invalid CatSystem2 checkpoint file');
  const plain = await transform(
      file.subarray(MAGIC.length),
      new DecompressionStream('gzip'),
      PORTABLE_LIMIT,
    ),
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)),
    memo = new Map();
  if (!Array.isArray(data.nodes)) throw new Error('Invalid checkpoint graph');
  const decode = (value) => {
    if (!Array.isArray(value)) {
      if (value !== null && typeof value === 'object') throw new Error('Invalid checkpoint value');
      return value;
    }
    const [tag, argument] = value;
    if (tag === 'undefined' && value.length === 1) return undefined;
    if (
      tag === 'bigint' &&
      value.length === 2 &&
      typeof argument === 'string' &&
      /^-?\d+$/.test(argument)
    )
      return BigInt(argument);
    if (
      tag === 'number' &&
      value.length === 2 &&
      ['-0', 'NaN', 'Infinity', '-Infinity'].includes(argument)
    )
      return Number(argument);
    if (
      tag !== 'ref' ||
      value.length !== 2 ||
      !Number.isSafeInteger(argument) ||
      argument < 0 ||
      argument >= data.nodes.length
    )
      throw new Error('Invalid checkpoint reference');
    if (memo.has(argument)) return memo.get(argument);
    const node = data.nodes[argument];
    if (!Array.isArray(node)) throw new Error('Invalid checkpoint node');
    const [type, contents] = node;
    let result;
    const publish = (object) => {
      result = object;
      memo.set(argument, object);
    };
    if (type === 'buffer') publish(unbase64(contents));
    else if (type === 'DataView' || typedArrays[type]) {
      const buffer = decode(contents);
      if (
        !(buffer instanceof ArrayBuffer) ||
        !Number.isSafeInteger(node[2]) ||
        node[2] < 0 ||
        !Number.isSafeInteger(node[3]) ||
        node[3] < 0
      )
        throw new Error('Invalid checkpoint binary view');
      publish(
        type === 'DataView'
          ? new DataView(buffer, node[2], node[3])
          : new typedArrays[type](buffer, node[2], node[3]),
      );
    } else if (type === 'date') publish(new Date(decode(contents)));
    else if (type === 'blob') publish(new Blob([decode(node[2])], { type: contents }));
    else {
      if (!Array.isArray(contents)) throw new Error('Invalid checkpoint container');
      if (type === 'set') {
        publish(new Set());
        for (const item of contents) result.add(decode(item));
      } else if (type === 'map') {
        publish(new Map());
        for (const [key, item] of contents) result.set(decode(key), decode(item));
      } else if (type === 'object' || type === 'null-object' || type === 'array') {
        if (
          type === 'array' &&
          (!Number.isSafeInteger(node[2]) || node[2] < 0 || node[2] > 0xffffffff)
        )
          throw new Error('Invalid checkpoint array length');
        publish(
          type === 'array' ? new Array(node[2]) : type === 'null-object' ? Object.create(null) : {},
        );
        for (const entry of contents) {
          if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== 'string' ||
            Object.hasOwn(result, entry[0])
          )
            throw new Error('Invalid checkpoint object property');
          Object.defineProperty(result, entry[0], {
            value: decode(entry[1]),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      } else throw new Error(`Unsupported checkpoint node ${type}`);
    }
    return result;
  };
  const value = decode(data.root);
  checkpointBytes(value);
  return value;
}
