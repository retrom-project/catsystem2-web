// SPDX-License-Identifier: MPL-2.0
const entities = (text) =>
  text.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, e) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e] ??
      String.fromCodePoint(
        e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
      ),
  );
export class XMLNode {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.text = '';
  }
  node(...path) {
    let n = this;
    for (const name of path)
      n = n?.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return n;
  }
  value(...path) {
    return this.node(...path)?.text.trim() || '';
  }
}
export function parseXML(text) {
  if (/<!DOCTYPE/i.test(text) || text.length > 4 * 1024 * 1024)
    throw new Error('Unsupported XML document');
  const root = new XMLNode(''),
    stack = [root];
  let count = 0;
  for (const token of text
    .replace(/<!--[\s\S]*?-->/g, '')
    .match(/<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) {
      stack.at(-1).text += token.slice(9, -3);
      continue;
    }
    if (token.startsWith('</')) {
      if (stack.length <= 1 || stack.pop().name !== token.slice(2, -1).trim())
        throw new Error('Mismatched XML close tag');
    } else if (token.startsWith('<')) {
      if (++count > 100000 || stack.length > 128) throw new Error('XML node limit');
      const name = /^<\s*([^\s/>]+)/.exec(token)?.[1];
      if (!name) throw new Error('Invalid XML tag');
      const node = new XMLNode(name);
      stack.at(-1).children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else stack.at(-1).text += entities(token);
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new Error('Invalid XML root');
  return root.children[0];
}
