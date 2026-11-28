// SPDX-License-Identifier: MPL-2.0
// Native parsed text owns bytes. Unicode text is a read-only derived view.
import { XMLNode } from '../xml.mjs';

export class NativeXMLNode extends XMLNode {
  #bytes;
  #encoding;
  constructor(name, encoding, bytes = new Uint8Array(), children = []) {
    super(name);
    if (
      typeof name !== 'string' ||
      !['UTF-8', 'Shift_JIS'].includes(encoding) ||
      !(bytes instanceof Uint8Array) ||
      !Array.isArray(children)
    )
      throw new Error('Invalid native XML node');
    this.name = name;
    this.children = children;
    this.#encoding = encoding;
    this.#bytes = Uint8Array.from(bytes);
    new TextDecoder(encoding, { fatal: true }).decode(this.#bytes);
    Object.defineProperty(this, 'text', {
      enumerable: true,
      get: () => new TextDecoder(this.#encoding, { ignoreBOM: true }).decode(this.#bytes),
    });
  }
  get encoding() {
    return this.#encoding;
  }
  append(bytes) {
    const next = new Uint8Array(this.#bytes.length + bytes.length);
    next.set(this.#bytes);
    next.set(bytes, this.#bytes.length);
    this.#bytes = next;
  }
  bytes() {
    return this.#bytes.slice();
  }
}

export function nativeXMLTextBytes(node) {
  if (!(node instanceof NativeXMLNode)) throw new Error('Native XML bytes require a native node');
  return node.bytes();
}

function walk(value, mode, depth, budget) {
  if (depth > 128 || --budget.remaining < 0) throw new Error('Native XML node limit');
  const source = mode === 'snapshot',
    bytes = source ? nativeXMLTextBytes(value) : value?.bytes,
    encoding = value?.encoding,
    name = value?.name,
    children = value?.children;
  if (
    !(bytes instanceof Uint8Array) ||
    !['UTF-8', 'Shift_JIS'].includes(encoding) ||
    typeof name !== 'string' ||
    !Array.isArray(children)
  )
    throw new Error('Invalid native XML checkpoint node');
  const copied = children.map((child) => walk(child, mode, depth + 1, budget));
  if (source) return { name, encoding, bytes, children: copied };
  return new NativeXMLNode(name, encoding, bytes, copied);
}

export const nativeXMLHandleCodec = Object.freeze({
  snapshot: (node) => walk(node, 'snapshot', 0, { remaining: 100000 }),
  restore: (state) => walk(state, 'restore', 0, { remaining: 100000 }),
});
