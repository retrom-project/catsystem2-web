// SPDX-License-Identifier: MPL-2.0
import { readPSB } from '../formats/psb.mjs';
import { boundedCount } from '../binary.mjs';

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('E-mote texture dimensions must be positive integers');
  return boundedCount(width * height, 67108864, 'E-mote texture pixels') * 4;
}

// PSB RGBA8 payloads use the DLL's BGRA byte order. Return canonical RGBA
// exactly once per source; StageRenderer owns the resulting texture upload.
function decodeTexture(psb, data) {
  if (data.type !== 'RGBA8') throw new Error(`Unsupported E-mote texture type ${data.type}`);
  const count = dimensions(data.width, data.height),
    stored = psb.resource(data.pixel?.resource),
    rgba = new Uint8Array(count);
  if (data.compress && data.compress !== 'RL')
    throw new Error(`Unsupported E-mote texture compression ${data.compress}`);
  if (data.compress === 'RL') {
    let input = 0,
      output = 0;
    while (output < count) {
      if (input >= stored.length) throw new Error('Truncated E-mote RL texture');
      const marker = stored[input++],
        repeat = Boolean(marker & 128),
        length = (repeat ? (marker & 127) + 3 : marker + 1) * 4;
      if (output + length > count || input + (repeat ? 4 : length) > stored.length)
        throw new Error('E-mote RL texture bounds');
      for (let i = 0; i < length; i += 4)
        rgba.set(
          stored.subarray(input + (repeat ? 0 : i), input + (repeat ? 4 : i + 4)),
          output + i,
        );
      input += repeat ? 4 : length;
      output += length;
    }
    if (input !== stored.length) throw new Error('Trailing E-mote RL texture bytes');
  } else {
    if (stored.length !== count) throw new Error('E-mote texture resource size mismatch');
    rgba.set(stored);
  }
  for (let at = 0; at < count; at += 4) [rgba[at], rgba[at + 2]] = [rgba[at + 2], rgba[at]];
  return { width: data.width, height: data.height, rgba };
}

export class EmoteDocument {
  static async open(bytes, options) {
    return new EmoteDocument(await readPSB(bytes), options);
  }
  constructor(psb, { name = '' } = {}) {
    const root = psb.root;
    if (root?.id !== 'motion' || !['win', 'krkr'].includes(root.spec))
      throw new Error(`Unsupported E-mote document ${name}: id=${root?.id}, spec=${root?.spec}`);
    if (!Number.isFinite(root.version) || root.version <= 0 || root.version > 3.0300001)
      throw new Error(`Unsupported E-mote motion version ${root.version} (${name})`);
    const metadata = root.metadata ?? {};
    if (
      (metadata.format != null && metadata.format !== 'emote') ||
      (metadata.version != null && metadata.version !== 1)
    )
      throw new Error(
        `Unsupported E-mote metadata ${metadata.format}/${metadata.version} (${name})`,
      );
    if (!root.object || !root.source) throw new Error(`Incomplete E-mote document ${name}`);
    this.psb = psb;
    this.name = name;
    this.containerVersion = psb.version;
    this.motionVersion = root.version;
    this.root = root;
    this.metadata = metadata;
    this.objects = new Map(Object.entries(root.object));
    this.sources = new Map(Object.entries(root.source));
    this.variables = new Map(
      (metadata.variableList ?? []).map((variable) => [variable.label, variable]),
    );
    this.timelines = new Map(
      (metadata.timelineControl ?? []).map((timeline) => [timeline.label, timeline]),
    );
    this.textures = new Map();
  }
  motion(object, name) {
    const motion = this.objects.get(object)?.motion?.[name];
    if (!motion) throw new Error(`Unknown E-mote motion ${object}/${name} (${this.name})`);
    return motion;
  }
  texture(sourceName, iconName) {
    const source = this.sources.get(sourceName),
      data = source?.texture ?? source?.icon?.[iconName],
      key = source?.texture ? sourceName : `${sourceName}/${iconName}`;
    if (!data?.pixel) throw new Error(`Unknown E-mote texture ${key} (${this.name})`);
    if (!this.textures.has(key)) {
      const texture = decodeTexture(this.psb, data);
      this.textures.set(key, texture);
    }
    return this.textures.get(key);
  }
  icon(sourceName, iconName) {
    const source = this.sources.get(sourceName),
      icon = source?.icon?.[iconName];
    if (!icon) throw new Error(`Unknown E-mote icon ${sourceName}/${iconName} (${this.name})`);
    const texture = this.texture(sourceName, iconName),
      left = source.texture ? (icon.left ?? 0) : 0,
      top = source.texture ? (icon.top ?? 0) : 0;
    if (
      ![left, top, icon.width, icon.height].every(Number.isSafeInteger) ||
      left < 0 ||
      top < 0 ||
      icon.width < 1 ||
      icon.height < 1 ||
      left + icon.width > texture.width ||
      top + icon.height > texture.height
    )
      throw new Error(`E-mote icon outside its texture: ${sourceName}/${iconName}`);
    return { ...icon, left, top, texture };
  }
}
