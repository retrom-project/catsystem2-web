// SPDX-License-Identifier: MPL-2.0
// JS XML state shared by startup parsing and the Script XML native family.
import { XMLNode } from '../xml.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataFormat, nativeDataKey } from './data-text.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { parseNativeInteger } from './standard.mjs';

export function parseNativeXML(bytes, encoding) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    throw new Error('Native XML profile encoding declaration cannot follow a BOM');
  const declaration = /^\s*<\?xml\s+([\s\S]*?)\?>/.exec(
    new TextDecoder('utf-8').decode(bytes.subarray(0, 512)).replace(/^\uFEFF/, ''),
  );
  const attributes = new Map();
  for (const match of declaration?.[1]?.matchAll(/([\w-]+)\s*=\s*(['"])(.*?)\2/g) || [])
    attributes.set(match[1].toLowerCase(), match[3]);
  const declared = attributes.get('encoding')?.toLowerCase();
  if (
    attributes.get('version') !== '1.0' ||
    !['utf-8', 'shift_jis'].includes(declared) ||
    (encoding && declared !== encoding.toLowerCase())
  )
    throw new Error('Native XML requires version 1.0 and its engine profile encoding declaration');
  const text = new TextDecoder(declared, { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, '')
    .replaceAll('\r\n', '\n')
    .replace(/[\t\n]/g, ' ');
  if (text.length > 4 * 1024 * 1024) throw new Error('Native XML exceeds its document limit');
  const roots = [],
    stack = [];
  let count = 0;
  for (const token of text.slice(text.indexOf('?>') + 2).match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ||
    []) {
    if (token.startsWith('<!--')) continue;
    // This engine treats a top-level DOCTYPE as its first node and does not
    // expand it or continue to the following element.
    if (/^<!DOCTYPE\b/i.test(token) && !stack.length) return new XMLNode('!DOCTYPE');
    if (token.startsWith('</')) {
      if (!stack.length || stack.pop().name !== token.slice(2, -1).trim())
        throw new Error('Native XML mismatched close tag');
      if (!stack.length) return roots[0];
    } else if (token.startsWith('<')) {
      if (/^<[!?]/.test(token) || /\/\s*>$/.test(token))
        throw new Error('Native XML does not support this element syntax');
      const name = /^<\s*([^\s/>]+)/.exec(token)?.[1];
      if (!name || ++count > 100000 || stack.length > 128)
        throw new Error('Native XML element limit or invalid name');
      const node = new XMLNode(name);
      // The original vector inserts at its front, including duplicate names.
      (stack.length ? stack.at(-1).children : roots).unshift(node);
      stack.push(node);
    } else if (stack.length) {
      // The native parser preserves entity spellings as literal text.
      stack.at(-1).text += token;
    }
  }
  if (stack.length) throw new Error('Native XML incomplete document');
  return roots[0] || new XMLNode('');
}

export function findNativeXML(root, path, key = (name) => name) {
  const parts = path.split('/').filter(Boolean);
  const children = root.name === 'document' ? root.children : [root];
  const find = (nodes, at) => {
    if (at >= parts.length) return null;
    for (const node of nodes) {
      if (key(node.name) !== parts[at]) continue;
      if (at === parts.length - 1) return node;
      const result = find(node.children, at + 1);
      if (result) return result;
    }
    return null;
  };
  return find(children, 0);
}

export function nativeXML(id, args, machine, services) {
  if (id < 0x24e || id > 0x251) return undefined;
  const count = id === 0x24e || id === 0x24f ? 1 : 3;
  if (args.length !== count)
    throw new Error(`KCS XML native 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles || !services.format) return undefined;
  const handles = services.handles;
  if (id === 0x24e) {
    if (!services.read) return undefined;
    const formatted = nativeDataFormat(args, machine, services, 0);
    if (formatted === null) return nativeReply(1, 0);
    const file = new TextDecoder('shift_jis').decode(formatted);
    const finish = (bytes) => {
      if (bytes === null) return nativeReply(1, 0);
      try {
        return nativeReply(1, handles.add('xml', parseNativeXML(bytes, services.xmlEncoding)));
      } catch (error) {
        services.diagnostic?.({ resource: file, native: id, error: error.message });
        return nativeReply(1, 0);
      }
    };
    const bytes = services.read(file);
    return bytes && typeof bytes.then === 'function' ? bytes.then(finish) : finish(bytes);
  }
  if (id === 0x24f) {
    if (args[0]) handles.release(args[0], 'xml');
    return nativeReply(2);
  }
  if (!args[0]) return id === 0x250 ? nativeReply(1, args[1]) : nativeReply(2);
  const formatted = nativeDataFormat(args, machine, services, 2);
  if (formatted === null) throw new Error('Native XML query reads an unmapped path');
  const key = (name) =>
      nativeDataKey(
        services.xmlEncoding?.toLowerCase() === 'utf-8'
          ? new TextEncoder().encode(name)
          : encodeCP932(name),
      ),
    node = findNativeXML(handles.get(args[0], 'xml'), nativeDataKey(formatted), key);
  if (id === 0x250) return nativeReply(1, node ? (parseNativeInteger(node.text) ?? 0) : args[1]);
  if (node) {
    if (services.xmlEncoding?.toLowerCase() === 'utf-8')
      machine.writeStringBytes(new TextEncoder().encode(node.text), args[1]);
    else machine.writeString(node.text, args[1]);
  }
  return nativeReply(2);
}
