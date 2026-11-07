// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit EmoteModel (OWCramer).
const contentDefaults = {
  x: 0,
  y: 0,
  z: 0,
  ox: 0,
  oy: 0,
  angle: 0,
  scaleX: 1,
  scaleY: 1,
  slantX: 0,
  slantY: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  blend: 0,
  timeOffset: 0,
};
function content(c = {}) {
  const mask = c.mask || 0,
    v = { ...contentDefaults, src: c.src, icon: c.icon };
  if (v.icon === undefined && v.src?.startsWith('src/')) {
    v.src = v.src.slice(4);
    v.icon = v.src.split('/').pop();
  }
  if (v.icon === undefined && v.src?.startsWith('motion/')) {
    const parts = v.src.slice(7).split('/');
    v.icon = parts.pop();
    v.src = parts.join('/');
  }
  if (mask & 1) {
    v.ox = c.ox || 0;
    v.oy = c.oy || 0;
  }
  if (mask & 2) [v.x, v.y, v.z] = [c.coord?.[0] || 0, c.coord?.[1] || 0, c.coord?.[2] || 0];
  if (mask & 0x400) v.opacity = Math.max(0, Math.min(1, (c.opa ?? 255) / 255));
  if (mask & 16) v.angle = c.angle || 0;
  if (mask & 4) v.flipX = !!c.fx;
  if (mask & 8) v.flipY = !!c.fy;
  if (mask & 0x60) {
    v.scaleX = c.zx ?? 1;
    v.scaleY = c.zy ?? 1;
  }
  if (mask & 0x80) v.slantX = c.sx || 0;
  if (mask & 0x100) v.slantY = c.sy || 0;
  if (mask & 0x20000) v.blend = c.bm || 0;
  if (mask & 0x2000000 && c.mesh?.bp?.length === 32) v.mesh = c.mesh.bp;
  if (mask & 0x80000) v.timeOffset = c.motion?.timeOffset || 0;
  return v;
}
function layer(v) {
  return {
    label: v.label || '',
    type: v.type || 0,
    parameterize: v.parameterize,
    masks: v.stencilCompositeMaskLayerList || [],
    divisions: Math.max(1, Math.min(32, v.meshDivision || 16)),
    frames: (v.frameList || [])
      .map((f) => ({ time: f.time || 0, type: f.type || 0, content: content(f.content) }))
      .sort((a, b) => a.time - b.time),
    children: (v.children || []).map(layer),
    shape: v.shape,
  };
}
function runLength(input, count) {
  const result = new Uint8Array(count);
  let at = 0,
    out = 0;
  while (out < count) {
    if (at >= input.length) throw new Error('E-mote truncated RL texture');
    const n = input[at++],
      length = (n & 128 ? (n & 127) + 3 : n + 1) * 4;
    if (out + length > count || at + (n & 128 ? 4 : length) > input.length)
      throw new Error('E-mote RL run bounds');
    if (n & 128) {
      for (let i = 0; i < length; i += 4) result.set(input.subarray(at, at + 4), out + i);
      at += 4;
    } else {
      result.set(input.subarray(at, at + length), out);
      at += length;
    }
    out += length;
  }
  return result;
}
export class EmoteModel {
  constructor(psb) {
    const root = psb.root;
    if (root.id !== 'motion') throw new Error('PSB is not an E-mote motion model');
    this.sources = {};
    this.textures = [];
    this.objects = {};
    this.maskLabels = new Set();
    for (const [name, source] of Object.entries(root.source || {})) {
      const icons = source.icon || {},
        t = source.texture;
      if (t) {
        const height = Math.min(
          t.height,
          Math.max(...Object.values(icons).map((i) => i.top + i.height), 1),
        );
        const pixels = psb.resource(t.pixel.resource).slice(0, t.width * height * 4);
        if (pixels.length !== t.width * height * 4) throw new Error('E-mote texture size mismatch');
        const texture = { width: t.width, height, pixels };
        this.sources[name] = { icons, texture: this.textures.length };
        this.textures.push(texture);
      } else
        for (const [iconName, icon] of Object.entries(icons)) {
          if (!icon.pixel) continue;
          const stored = psb.resource(icon.pixel.resource),
            count = icon.width * icon.height * 4;
          const pixels = icon.compress === 'RL' ? runLength(stored, count) : stored.slice(0, count);
          if (pixels.length !== count) throw new Error('E-mote texture size mismatch');
          this.sources[`${name}/${iconName}`] = {
            icons: { [iconName]: { ...icon, left: 0, top: 0 } },
            texture: this.textures.length,
          };
          this.textures.push({ width: icon.width, height: icon.height, pixels });
        }
    }
    const collect = (layers) => {
      for (const l of layers) {
        for (const label of l.masks) this.maskLabels.add(label);
        collect(l.children);
      }
    };
    for (const [objectName, object] of Object.entries(root.object || {})) {
      const motions = (this.objects[objectName] = {});
      for (const [name, m] of Object.entries(object.motion || {})) {
        motions[name] = {
          parameters: m.parameter || [],
          defaultParameter: m.parameterize,
          layers: (m.layer || []).map(layer),
          layerIndex: m.layerIndexMap || {},
          priority: m.priority || [],
          lastTime: m.lastTime || 0,
          loopTime: m.loopTime ?? -1,
        };
        collect(motions[name].layers);
      }
    }
    const meta = root.metadata || {};
    this.baseObject = meta.base?.chara || 'all_parts';
    this.baseMotion = meta.base?.motion || '';
    this.variables = (meta.variableList || []).map((v) => v.label);
    this.selectors = meta.selectorControl || [];
    this.timelines = Object.fromEntries(
      (meta.timelineControl || []).map((t) => [
        t.label,
        {
          ...t,
          tracks: Object.fromEntries(
            (t.variableList || []).map((v) => [
              v.label,
              (v.frameList || []).map((f) => ({
                time: f.time || 0,
                value: f.type ? f.content?.value : null,
                weight:
                  f.content?.easing > 0
                    ? f.content.easing + 1
                    : f.content?.easing < 0
                      ? 1 / (1 - f.content.easing)
                      : 1,
              })),
            ]),
          ),
        },
      ]),
    );
  }
  selectorsFor(v) {
    for (const s of this.selectors)
      (s.optionList || []).forEach((o, i) => {
        v[o.label] = (v[s.label] | 0) === i ? (o.onValue ?? 0) : (o.offValue ?? 1);
      });
    return v;
  }
  resting() {
    const v = Object.fromEntries(this.variables.map((n) => [n, 0]));
    for (const [name, keys] of Object.entries(this.timelines['初期化']?.tracks || {}))
      if (keys[0]?.value !== undefined && keys[0].value !== null) v[name] = keys[0].value;
    return this.selectorsFor(v);
  }
  timeline(name, time) {
    const t = this.timelines[name];
    if (!t) return {};
    const looping = t.loopBegin >= 0 && t.loopEnd > t.loopBegin;
    if (looping && time >= t.loopBegin)
      time = t.loopBegin + ((time - t.loopBegin) % (t.loopEnd - t.loopBegin));
    const result = {};
    for (const [name, keys] of Object.entries(t.tracks)) {
      const valued = keys.filter((k) => k.value !== null && k.value !== undefined);
      if (!valued.length) continue;
      const key = valued.findLast((k) => k.time <= time) || valued[0],
        index = keys.indexOf(key),
        valueIndex = valued.indexOf(key);
      const previous = valued[valueIndex - 1]?.value ?? (looping ? valued.at(-1).value : key.value),
        duration = Math.max(0, (keys[index + 1]?.time || 0) - key.time - 1);
      result[name] = duration
        ? previous +
          (key.value - previous) *
            Math.max(0, Math.min(1, (time - key.time) / duration)) ** key.weight
        : key.value;
    }
    return result;
  }
}
export { contentDefaults };
