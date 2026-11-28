// SPDX-License-Identifier: MPL-2.0
// The mounted PE32 version block stays in caller RAM. ANSI queries use the
// reserved conversion area of the same Win32 output buffer.
import { Binary } from '../binary.mjs';

const alignWord = (at) => (at + 3) & ~3;

function versionNode(data, start, limit) {
  if (start + 6 > limit) return null;
  const length = data.u16(start),
    count = data.u16(start + 2),
    text = data.u16(start + 4) === 1,
    end = start + length;
  if (length < 8 || end > limit) return null;
  let key = '';
  for (let at = start + 6; at + 2 <= end; at += 2) {
    const unit = data.u16(at);
    if (!unit) {
      const value = alignWord(at + 2),
        tail = value + count * (text ? 2 : 1);
      if (tail > end) return null;
      return { key, value, count, text, end, children: alignWord(tail) };
    }
    key += String.fromCharCode(unit);
  }
  return null;
}

export function queryVersionResource(bytes, subBlock) {
  const data = new Binary(bytes, 'Win32 version resource');
  let node = versionNode(data, 0, bytes.length);
  if (node?.key !== 'VS_VERSION_INFO') return null;
  for (const component of subBlock.split('\\').filter(Boolean)) {
    const key = component.toLowerCase();
    let match = null;
    for (let at = node.children; at < node.end; ) {
      const child = versionNode(data, at, node.end);
      if (!child) break;
      if (child.key.toLowerCase() === key) {
        match = child;
        break;
      }
      at = alignWord(child.end);
    }
    if (!match) return null;
    node = match;
  }
  return { offset: node.value, count: node.count, text: node.text };
}
