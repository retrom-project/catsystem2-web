// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit EmoteProfiles (OWCramer).
import { decodeText } from '../binary.mjs';
export function sections(text) {
  const result = {};
  let current = '';
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  for (const line of clean
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [head, ...rest] = line.split(/\s+/);
    if (head.startsWith('#')) current = head.slice(1).toLowerCase();
    else (result[current] ||= []).push([head, rest]);
  }
  return result;
}
function emptyExpressions() {
  return {
    scaleX: 1,
    scaleY: 1,
    positionX: 0,
    positionY: 0,
    scaleOffsetX: 0,
    scaleOffsetY: 0,
    defaults: {},
    patterns: {},
    blinks: [],
    lips: [],
    chains: {},
    materials: {},
    inertiaLR: [],
    inertiaUD: [],
    inertiaFromChange: [],
    attributes: {},
    hitVariables: [],
    touchMappings: {},
    touchTables: {},
  };
}
export class EmoteProfiles {
  constructor(texts) {
    this.texts = texts;
    this.profiles = new Map();
    this.expressionsCache = new Map();
    this.profileFiles = Object.fromEntries(
      (sections(this.text('m2view.cnf')).profile || []).map(([name, rest]) => [
        name.toLowerCase(),
        rest[0],
      ]),
    );
    this.actions = {};
    for (const [file] of sections(this.text('m2view.cnf')).action || []) {
      let action, step;
      for (const [head, rest] of sections(this.text(file)).action || []) {
        if (head.startsWith('$')) {
          action = this.actions[head.slice(1)] = [];
          step = null;
        } else if (head === 'frame' && action) {
          step = { frames: Number(rest[0]), variables: {}, easing: 0 };
          action.push(step);
        } else if (head === 'wait' && action) {
          action.push({ frames: Number(rest[0]), variables: {}, easing: 0 });
          step = null;
        } else if (step && head === 'easing') step.easing = Number(rest[0]);
        else if (step && head === 'var') step.variables[rest[0]] = Number(rest[1]);
        else if (step && head === 'restore') step.restore = true;
      }
    }
  }
  static async load(game) {
    const names = [...game.index.keys()].filter((n) => /\.(cnf|pfl|dif|inc|def|inf)$/.test(n));
    const texts = new Map(
      await Promise.all(names.map(async (n) => [n, decodeText(await game.require(n))])),
    );
    return new EmoteProfiles(texts);
  }
  text(name = '') {
    return this.texts.get(name.toLowerCase()) || '';
  }
  profile(name) {
    name = name.toLowerCase();
    if (this.profiles.has(name)) return this.profiles.get(name);
    if (!this.profileFiles[name]) throw new Error(`Missing E-mote profile: ${name}`);
    const s = sections(this.text(this.profileFiles[name])),
      p = { bodies: {}, expressions: {}, bodyFile: null, idles: {} };
    for (const [n, rest] of s.charaname || []) p.bodies[Number(n)] = rest.at(-1);
    for (const [n, rest] of s.motname || []) {
      if (rest.length >= 2 && /^\d+$/.test(rest[0]))
        (p.idles[Number(n)] ||= {})[Number(rest[0])] = rest[1];
      const difs = rest.filter((v) => /\.dif$/i.test(v));
      if (!p.expressions[n] && difs.length) {
        p.expressions[n] = difs[0];
        if (difs[1]) p.bodyFile = difs[1];
      }
    }
    this.profiles.set(name, p);
    return p;
  }
  expressions(file) {
    if (!file) return emptyExpressions();
    if (!this.expressionsCache.has(file)) {
      const e = emptyExpressions();
      this.read(file, e);
      this.expressionsCache.set(file, e);
    }
    return this.expressionsCache.get(file);
  }
  read(file, e, depth = 0) {
    if (depth > 16) throw new Error('E-mote profile include cycle');
    const s = sections(this.text(file));
    for (const [include] of s.include || []) this.read(include, e, depth + 1);
    for (const [section, keys] of Object.entries({
      scale: ['scaleX', 'scaleY'],
      position: ['positionX', 'positionY'],
      scaleoffset: ['scaleOffsetX', 'scaleOffsetY'],
    })) {
      if (s[section]?.[0]) {
        const [first, rest] = s[section][0];
        e[keys[0]] = Number(first);
        e[keys[1]] = rest.length ? Number(rest[0]) : section === 'scale' ? Number(first) : 0;
      }
    }
    for (const [name, rest] of s.defval || []) e.defaults[name] = Number(rest[0]);
    let pattern;
    for (const [head, rest] of s.pattern || []) {
      if (head.startsWith('%')) {
        pattern = { assignments: {}, isDefault: rest.includes('default') };
        (e.patterns[Number(head.slice(1))] ||= {})[rest[0].toLowerCase()] = pattern;
      } else if (pattern) pattern.assignments[head] = Number(rest[0]);
    }
    for (const [digit, rest] of s.blink || [])
      if (rest.length >= 6)
        e.blinks.push({
          digit: +digit,
          code: rest[0].toLowerCase(),
          from: +rest[1],
          to: +rest[2],
          frames: +rest[3],
          minWait: +rest[4],
          maxWait: +rest[5],
        });
    const lipVariables = Object.fromEntries(
      (s.lip_variable || []).map(([digit, rest]) => [`${digit}:${rest[0].toLowerCase()}`, rest[1]]),
    );
    for (const [digit, rest] of s.lip_table || [])
      if (rest.length >= 5)
        e.lips.push({
          digit: +digit,
          code: rest[0].toLowerCase(),
          low: +rest[2],
          high: +rest[3],
          levels: rest.slice(4).map(Number),
          variable: lipVariables[`${digit}:${rest[0].toLowerCase()}`] || 'face_talk',
          flow: [],
        });
    for (const [digit, rest] of s.lip_flow || []) {
      const lip = e.lips.find((l) => l.digit === +digit && l.code === rest[0]?.toLowerCase());
      if (lip)
        lip.flow = rest.slice(1).map((step) => {
          const n = step.split(',').map(Number);
          return { value: n[0], frames: Math.max(1, n[1]), mayStop: !!n[2] };
        });
    }
    for (const [n, rest] of s.attribute || [])
      e.attributes[+n] = { x: +rest[0], y: +rest[1], extra: rest.length > 2 ? +rest[2] : 3 };
    const tables = {},
      links = {};
    let table;
    for (const [head, rest] of s.chain || []) {
      if (head.startsWith('$') && !rest.length)
        table = tables[head] = { curve: 'fix', frames: 1, pairs: {} };
      else if (table) {
        if (head === 'default') table.curve = rest[0];
        else if (head === 'frame') table.frames = Number(rest[0]);
        else if (rest.length >= 3)
          table.pairs[`${head.toLowerCase()}>${rest[0].toLowerCase()}`] = {
            curve: rest[1],
            frames: Number(rest[2]),
          };
      } else if (rest[0]?.startsWith('$')) links[+head] = rest[0];
      else e.chains[+head] = { curve: rest[0], frames: Number(rest[1] || 1), pairs: {} };
    }
    for (const [digit, name] of Object.entries(links))
      if (tables[name]) e.chains[digit] = tables[name];
    for (const [name, rest] of s.material || []) {
      const n = rest.map(Number);
      if (n.length >= 5)
        e.materials[name] = {
          mass: Math.max(0.01, n[0]),
          spring: n[1],
          resistance: n[2],
          step: n[3],
          limit: n[4],
          inverted: !!n[5],
          scale: Math.max(1, n[6] || 30),
        };
    }
    e.inertiaLR.push(...(s.inertia_lr || []).map(([name]) => name));
    e.inertiaUD.push(...(s.inertia_ud || []).map(([name]) => name));
    for (const [source, rest] of s.inertia_dif || [])
      if (rest.length >= 3)
        e.inertiaFromChange.push({ source, target: rest[0], power: +rest[1], limit: +rest[2] });
    e.hitVariables.push(...(s.hittest || []).map(([name]) => name));
    let touchTable;
    for (const [head, rest] of s.touch || []) {
      if (head.startsWith('$')) touchTable = e.touchTables[head] = [];
      else if (/^0x[\da-f]+$/i.test(head)) e.touchMappings[Number(head) >>> 0] = rest;
      else if (touchTable) touchTable.push({ action: head, voice: rest[0] });
    }
  }
  pose(spec, body = []) {
    const fields = spec.split(',').map((s) => s.trim()),
      profile = this.profile(fields[0]),
      n = Number(fields[1] || 1);
    const model = profile.bodies[n] || Object.values(profile.bodies)[0];
    if (!model) throw new Error(`No model for E-mote profile ${fields[0]}`);
    const face = this.expressions(profile.expressions[n] || Object.values(profile.expressions)[0]),
      bodyProfile = this.expressions(profile.bodyFile);
    const digits = fields.slice(2);
    let idle = 0;
    if (digits.at(-1)?.includes(':')) {
      const parts = digits.at(-1).split(':');
      digits[digits.length - 1] = parts[0];
      idle = Number(parts[1]);
    }
    const variables = { ...face.defaults, ...bodyProfile.defaults },
      codes = {},
      bodyCodes = {};
    const apply = (profile, digits, codes) => {
      for (const [digit, options] of Object.entries(profile.patterns))
        for (const [code, pattern] of Object.entries(options))
          if (pattern.isDefault) {
            codes[digit] = code;
            Object.assign(variables, pattern.assignments);
          }
      digits.forEach((code, i) => {
        if (code === undefined || code === null || code === '@' || code === '') return;
        const p = profile.patterns[i + 1]?.[code.toLowerCase()];
        if (p) {
          codes[i + 1] = code.toLowerCase();
          Object.assign(variables, p.assignments);
        }
      });
    };
    apply(face, digits, codes);
    if ('face_talk' in variables) variables.face_talk = 0;
    apply(bodyProfile, body, bodyCodes);
    return {
      model,
      variables,
      codes,
      bodyCodes,
      face,
      body: bodyProfile,
      idle: profile.idles[n]?.[idle],
      scaleX: face.scaleX,
      scaleY: face.scaleY,
      positionX: face.positionX,
      positionY: face.positionY,
      scaleOffsetX: face.scaleOffsetX,
      scaleOffsetY: face.scaleOffsetY,
    };
  }
}
