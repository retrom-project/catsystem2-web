// SPDX-License-Identifier: MPL-2.0
// Authored unencrypted PSB3 model. Contains no proprietary model data or executable code.
const concat = (...arrays) => Uint8Array.from(arrays.flatMap((array) => [...array]));
const uint = (value, width) =>
  Array.from({ length: width }, (_, i) => Math.floor(value / 256 ** i) & 255);
const width = (value) => (value < 256 ? 1 : value < 65536 ? 2 : value < 16777216 ? 3 : 4);
const integers = (values) => {
  const countWidth = width(values.length),
    itemWidth = width(Math.max(0, ...values));
  return Uint8Array.from([
    12 + countWidth,
    ...uint(values.length, countWidth),
    12 + itemWidth,
    ...values.flatMap((value) => uint(value, itemWidth)),
  ]);
};

export function encodeAuthoredPSB(root, resources = []) {
  const names = new Set(),
    strings = new Map();
  const scan = (value) => {
    if (typeof value === 'string') strings.set(value, 0);
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === 'object' && !Object.hasOwn(value, 'resource'))
      for (const [name, item] of Object.entries(value)) {
        names.add(name);
        scan(item);
      }
  };
  scan(root);
  const keys = [...names].sort(),
    keyIDs = new Map(keys.map((name, i) => [name, i]));
  const trie = { id: 0, children: new Map() },
    terminals = [];
  for (const name of keys) {
    let node = trie;
    for (const byte of new TextEncoder().encode(name)) {
      if (!node.children.has(byte)) node.children.set(byte, { children: new Map() });
      node = node.children.get(byte);
    }
    const terminal = { children: new Map(), nameID: terminals.length };
    node.children.set(0, terminal);
    terminals.push(terminal);
  }
  const charset = [0],
    data = [0],
    occupied = new Set([0]),
    queue = [trie];
  for (const node of queue) {
    if (!node.children.size) {
      charset[node.id] = node.nameID ?? 0;
      continue;
    }
    let base = 1;
    while ([...node.children.keys()].some((byte) => occupied.has(base + byte))) base++;
    charset[node.id] = base;
    for (const [byte, child] of node.children) {
      child.id = base + byte;
      occupied.add(child.id);
      data[child.id] = node.id;
      queue.push(child);
    }
  }
  const tree = terminals.map((node) => node.id);
  for (let i = 0; i < data.length; i++) {
    data[i] ??= 0;
    charset[i] ??= 0;
  }
  const stringData = [],
    stringOffsets = [];
  for (const text of strings.keys()) {
    strings.set(text, stringOffsets.length);
    stringOffsets.push(stringData.length);
    stringData.push(...new TextEncoder().encode(text), 0);
  }
  const value = (item) => {
    if (item === null) return Uint8Array.of(1);
    if (typeof item === 'boolean') return Uint8Array.of(item ? 3 : 2);
    if (typeof item === 'number') {
      if (!item) return Uint8Array.of(4);
      if (Number.isInteger(item)) {
        const n = item < 0 ? 4 : width(item * 2);
        return Uint8Array.from([4 + n, ...uint(item >>> 0, n)]);
      }
      const bytes = new Uint8Array(5);
      bytes[0] = 30;
      new DataView(bytes.buffer).setFloat32(1, item, true);
      return bytes;
    }
    if (typeof item === 'string') {
      const id = strings.get(item),
        n = width(id);
      return Uint8Array.from([20 + n, ...uint(id, n)]);
    }
    if (Object.hasOwn(item, 'resource')) {
      const n = width(item.resource);
      return Uint8Array.from([24 + n, ...uint(item.resource, n)]);
    }
    const entries = Array.isArray(item)
      ? item
      : Object.entries(item).sort(([a], [b]) => keyIDs.get(a) - keyIDs.get(b));
    const children = entries.map((entry) => value(Array.isArray(item) ? entry : entry[1])),
      offsets = [];
    let at = 0;
    for (const child of children) {
      offsets.push(at);
      at += child.length;
    }
    return concat(
      [Array.isArray(item) ? 32 : 33],
      Array.isArray(item) ? [] : integers(entries.map(([key]) => keyIDs.get(key))),
      integers(offsets),
      ...children,
    );
  };
  const chunks = [],
    lengths = [];
  let chunkLength = 0;
  for (const resource of resources) {
    chunks.push(chunkLength);
    lengths.push(resource.length);
    chunkLength += resource.length;
  }
  const sections = [
    concat(integers(charset), integers(data), integers(tree)),
    value(root),
    integers(stringOffsets),
    stringData,
    integers(chunks),
    integers(lengths),
    concat(...resources),
  ];
  const header = new Uint8Array(44),
    view = new DataView(header.buffer);
  header.set([80, 83, 66, 0, 3]);
  view.setUint32(8, 44, true);
  let at = 44;
  sections.forEach((section, i) => {
    view.setUint32([12, 36, 16, 20, 24, 28, 32][i], at, true);
    at += section.length;
  });
  let sum = 1,
    high = 0;
  for (const byte of header.subarray(8, 40)) {
    sum = (sum + byte) % 65521;
    high = (high + sum) % 65521;
  }
  view.setUint32(40, (high * 65536 + sum) >>> 0, true);
  return concat(header, ...sections);
}

export function emotePSBFixture() {
  return encodeAuthoredPSB(
    {
      id: 'motion',
      spec: 'win',
      version: 3.03,
      label: 'authored-contract-model',
      source: {
        tex: {
          texture: { width: 2, height: 2, pixel: { resource: 0 }, type: 'RGBA8' },
          icon: { dot: { width: 2, height: 2, left: 0, top: 0, originX: 1, originY: 1 } },
        },
      },
      object: {
        body: {
          motion: {
            base: {
              type: 0,
              loopTime: -1,
              bounds: { bottom: 0, left: 0, right: 0, top: 0 },
              parameter: [],
              parameterize: null,
              variable: [],
              tag: [],
              metadata: null,
              priority: [
                { time: 0, type: 1, content: [0] },
                { time: 61, type: 1, content: null },
              ],
              layerIndexMap: { image: 0 },
              lastTime: 61,
              layer: [
                {
                  label: 'image',
                  type: 0,
                  parameterize: null,
                  children: [],
                  coordinate: 0,
                  exportSelf: 1,
                  groundCorrection: 0,
                  inheritMask: 0,
                  joinTarget: 1,
                  objTriPriority: 2,
                  meshCombine: 0,
                  meshTransform: 0,
                  metadata: null,
                  motionIndependentLayerInherit: 0,
                  stencilType: 0,
                  transformOrder: [0, 3, 2, 1],
                  frameList: [
                    {
                      time: 0,
                      type: 2,
                      content: { mask: 2, src: 'tex', icon: 'dot', coord: [0, 0, 0] },
                    },
                    { time: 61, type: 0 },
                  ],
                },
              ],
            },
          },
        },
      },
      metadata: {
        mirror: 0,
        scale: 1,
        bustControl: [],
        hairControl: [],
        partsControl: [],
        eyeControl: [],
        eyebrowControl: [],
        mouthControl: [],
        transitionControl: [],
        clampControl: [],
        loopControl: [],
        mirrorControl: { variableMatchList: [] },
        base: { chara: 'body', motion: 'base' },
        variableList: [
          {
            label: 'pose',
            frameList: [
              { frame: 0, label: 'rest' },
              { frame: 10, label: 'target' },
            ],
          },
        ],
        timelineControl: [],
      },
    },
    [Uint8Array.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255])],
  );
}
