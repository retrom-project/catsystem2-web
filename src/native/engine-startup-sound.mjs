// SPDX-License-Identifier: MPL-2.0
// The opening application callback reads the native SOUNDGROUP/MASTER/PART tree.
const layouts = {
  'sdk-4.01-engine-2.6.1.74': {
    load: 0x5c5ef0,
    parsed: 0x5c9542,
    preferencesParsed: 0x5c9c91,
    directory: 2672,
    base: 135236,
    wide: false,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    load: 0x7150b0,
    parsed: 0x718702,
    preferencesParsed: 0x718e51,
    directory: 3972,
    base: 163260,
    wide: true,
  },
};
const RECORD_BYTES = 196;
const defaults = ['volume', 'play', 'sysplay', 'voicevol', 'mute', 'skipvol'];
const current = ['volume', 'play', 'sysplay', 'voicevol', 'skipvol', 'mute'];
const recordStrings = { key: 0, name: 24, type: 52, head: 76, int: 104 };
const recordWords = { id: 48, group: 100, mastervol: 128, sameid: 156 };

function string(p, address, encoding) {
  const length = p.load(address + 16),
    capacity = p.load(address + 20),
    wide = encoding === 'utf-16le',
    inline = wide ? 7 : 15;
  if (length > capacity) throw new Error('Invalid original sound configuration string');
  if (!length) return '';
  const data = capacity > inline ? p.load(address) : address;
  return new TextDecoder(encoding).decode(p.read(data, length * (wide ? 2 : 1)));
}

function parts(p, address, read) {
  const first = p.load(address),
    end = p.load(address + 4),
    capacity = p.load(address + 8),
    bytes = p.allocations.get(first) ?? 0;
  if (
    end < first ||
    end > capacity ||
    (end - first) % RECORD_BYTES ||
    (first ? !bytes || bytes < capacity - first : capacity)
  )
    throw new Error('Invalid original sound configuration parts vector');
  return Array.from({ length: (end - first) / RECORD_BYTES }, (_, i) =>
    read(first + i * RECORD_BYTES, i),
  );
}

function readRecord(p, address, encoding) {
  const node = {
    defaults: {},
    current: {},
    children: parts(p, address + 184, (at) => readRecord(p, at, encoding)),
  };
  for (const [name, offset] of Object.entries(recordStrings))
    node[name] = string(p, address + offset, encoding);
  for (const [name, offset] of Object.entries(recordWords))
    node[name] = p.load(address + offset) | 0;
  defaults.forEach(
    (field, index) => (node.defaults[field] = p.load(address + 132 + index * 4) | 0),
  );
  current.forEach((field, index) => (node.current[field] = p.load(address + 160 + index * 4) | 0));
  return node;
}

function readGroups(p, address, encoding) {
  const head = p.load(address),
    count = p.load(address + 4),
    groups = new Map(),
    seen = new Set();
  const walk = (node) => {
    if (node === head) return;
    if (p.allocations.get(node) !== 104 || seen.has(node) || seen.size >= count)
      throw new Error('Invalid original sound configuration group map');
    seen.add(node);
    walk(p.load(node));
    const id = p.load(node + 16) | 0,
      value = node + 20;
    groups.set(id, {
      id,
      comment: string(p, value, encoding),
      label: string(p, value + 28, encoding),
      type: string(p, value + 52, encoding),
      min: p.load(value + 76) | 0,
      max: p.load(value + 80) | 0,
    });
    walk(p.load(node + 8));
  };
  walk(p.load(head + 4));
  if (groups.size !== count) throw new Error('Original sound configuration group count differs');
  return groups;
}

export async function readNativeStartupSoundConfiguration(engine, sound, readSaved, diagnostic) {
  const { process: p, kernel, refs } = engine,
    layout = layouts[engine.profile],
    base = refs.owner + layout.base,
    file = string(p, base + 4, layout.wide ? 'utf-16le' : 'shift_jis'),
    directory = p.string(refs.owner + layout.directory, layout.wide),
    preferencePath = kernel.path(directory + '\\' + file).toLowerCase(),
    saved = file ? ((await readSaved?.(file)) ?? null) : null,
    readFile = kernel.readFile,
    game = engine.options.game,
    encoding = layout.wide ? 'utf-8' : 'shift_jis',
    provider = 'startup-sound-configuration';
  if (
    refs.startupSoundConfiguration !== undefined ||
    engine.pendingCalls ||
    kernel.fileProviders.has(provider)
  )
    throw new Error('Original sound configuration requires an idle startup owner');
  let parsed = false,
    preferencesParsed = false;
  const detach = [];
  try {
    detach.push(
      p.beforeInstruction(layout.parsed, 'original sound XML accepted', () => {
        parsed = true;
      }),
    );
    if (saved)
      detach.push(
        p.beforeInstruction(layout.preferencesParsed, 'original sound preferences accepted', () => {
          preferencesParsed = true;
        }),
      );
    kernel.registerFiles(provider, {
      read: (name) => (kernel.path(name).toLowerCase() === preferencePath ? saved : undefined),
    });
    // The mounted XML and the user's same-named preferences are different files.
    kernel.readFile = (name) => (game.readLoose ? game.readLoose(name) : game.read(name));
    const loaded = await engine.call(layout.load, [], refs.owner);
    Object.assign(sound, {
      filename: file,
      loaded: Boolean(loaded),
      master: parsed ? readRecord(p, base + 48, encoding) : null,
      parts: parsed ? parts(p, base + 36, (at) => readRecord(p, at, encoding)) : [],
      groups: parsed ? readGroups(p, base + 28, encoding) : new Map(),
    });
    refs.startupSoundConfiguration = parsed;
    if (loaded && !parsed) diagnostic?.({ type: 'sound-configuration-invalid', file });
    if (parsed && saved && !preferencesParsed) diagnostic?.({ type: 'preferences-invalid', file });
  } finally {
    kernel.readFile = readFile;
    kernel.fileProviders.delete(provider);
    for (const unhook of detach.reverse()) unhook();
  }
}

export function syncNativeStartupSoundConfiguration(engine, sound) {
  const p = engine.process,
    base = engine.refs.owner + layouts[engine.profile].base;
  const write = (address, node) => {
    current.forEach((field, index) => p.store(address + 160 + index * 4, node.current[field]));
    writeParts(address + 184, node.children);
  };
  const writeParts = (address, nodes) => {
    const addresses = parts(p, address, (at) => at);
    if (addresses.length !== nodes.length)
      throw new Error('Native sound configuration part ownership changed');
    addresses.forEach((at, index) => write(at, nodes[index]));
  };
  write(base + 48, sound.master);
  writeParts(base + 36, sound.parts);
}
