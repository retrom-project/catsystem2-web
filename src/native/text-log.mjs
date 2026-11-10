// SPDX-License-Identifier: MPL-2.0
// Script-visible log tables, byte columns and CSS wire state belong to JS.
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { Binary } from '../binary.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeDataFormat, nativeDataPair, nativeDataArgument } from './data-text.mjs';
import { parseNativeIntegerPrefix } from './standard.mjs';
import { readTranslation } from '../formats/scene.mjs';
import { NativeSceneData } from './scene-data.mjs';
import { nativeCategoryFilename, readNativeResource } from './resource-file.mjs';
import { evaluateNativeExpression } from './expression.mjs';
export const NATIVE_DISPLAY_LOG_IDS = Object.freeze([
  0x2b8, 0x2b9, 0x2ba, 0x2bb, 0x2bc, 0x311, 0x352, 0x353, 0x36c, 0x3d1, 0x40a,
]);
const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const empty = () => new Uint8Array();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const cstring = (bytes) => bytes.subarray(0, bytes.includes(0) ? bytes.indexOf(0) : bytes.length);
const unit = (bytes, at) => {
  const b = bytes[at] ?? 0;
  if (!b) return { code: 0, size: 0 };
  if (nativeDataPair(bytes, at)) return { code: (b << 8) | bytes[at + 1], size: 2 };
  if (b === 92 && [91, 92, 110].includes(bytes[at + 1]))
    return { code: 0x5c00 | bytes[at + 1], size: 2 };
  return { code: ((b << 24) >> 24) & 65535, size: 1 };
};
export function cleanDisplayLog(input, escape) {
  const bytes = cstring(input),
    out = [];
  const number = (at) => {
    const source = String.fromCharCode(...bytes.subarray(at, at + 260)),
      n = parseNativeIntegerPrefix(source);
    return n ? n.count + Number(bytes[at + n.count] === 59) : 0;
  };
  for (let at = 0; at < bytes.length; ) {
    if (bytes[at] !== 92) {
      const n = nativeDataPair(bytes, at) ? 2 : 1;
      out.push(...bytes.subarray(at, at + n));
      at += n;
      continue;
    }
    const q = String.fromCharCode(bytes[at + 1] ?? 0).toLowerCase(),
      r = String.fromCharCode(bytes[at + 2] ?? 0).toLowerCase();
    let skip = 0;
    if (escape) {
      if (q === '@') skip = 2;
      else if (q === 'r') skip = bytes[at + 2] === 92 && [110, 78].includes(bytes[at + 3]) ? 4 : 2;
    } else if (q === '@' || q === 'n') skip = 2;
    else if (q === 'c') skip = ['r', 's'].includes(r) ? 3 + number(at + 3) : 2 + number(at + 2);
    else if (q === 'f') {
      if (['+', '-', 'r'].includes(r)) skip = 3 + number(at + 3);
      else if (r === 'l' || r === 's') {
        skip = String.fromCharCode(bytes[at + 3] ?? 0).toLowerCase() === r ? 4 : 3;
        skip += Number(bytes[at + skip] === 59);
      } else if (r === 'n') skip = bytes[at + 4] === 59 ? 4 : 3;
      else skip = 2 + number(at + 2);
    } else if (q === 'p') skip = 2 + Number(['l', 'c', 'r'].includes(r));
    else if (['w', 'x', 'y'].includes(q)) skip = 2 + number(at + 2);
    else if (q === '[' || q === '\\') {
      out.push(...bytes.subarray(at, at + 2));
      at += 2;
      continue;
    } else skip = 1;
    if (skip) at += skip;
    else out.push(bytes[at++]);
  }
  return Uint8Array.from(out);
}
function rubySpan(bytes, at) {
  if (bytes[at] !== 91) return null;
  let i = at + 1,
    base = [],
    reading = false;
  while (i < bytes.length) {
    const u = unit(bytes, i);
    if (!u.size) break;
    if (u.code === 93) return { size: i - at + 1, width: base.length };
    if (u.code === 47 && !reading) reading = true;
    else if (!reading) base.push(...bytes.subarray(i, i + u.size));
    i += u.size;
  }
  return { size: i - at, width: base.length };
}
const firstIndent = new Set([0x8169, 0x816d, 0x816f, 0x8175, 0x8177]);
export function wrapDisplayLog(bytes, model, speaker, tag, crNext) {
  const cfg = model.config,
    rows = [];
  let stalled = null;
  let at = 0,
    prefix = model.config.dispName && !cfg.nameline ? speaker : empty(),
    indent = (cfg.nameindent | 0) - prefix.length;
  const first = unit(bytes, 0),
    pad = firstIndent.has(first.code) ? first.size : 0;
  while (at < bytes.length) {
    const start = at,
      padding = [];
    for (let i = 0; i < Math.max(0, indent); i += 2)
      padding.push(...(i + 1 < indent ? [0x81, 0x40] : [32]));
    prefix = concat(prefix, Uint8Array.from(padding));
    let width = 0,
      hard = false;
    if (prefix.length < cfg.col)
      while (at < bytes.length) {
        const ruby = rubySpan(bytes, at);
        if (ruby) {
          width += ruby.width;
          if (width + prefix.length > cfg.col + cfg.prof) break;
          at += ruby.size;
          if (width + prefix.length >= cfg.col) break;
          continue;
        }
        const u = unit(bytes, at);
        if (!u.size) break;
        if (crNext && u.code === 0x5c6e) {
          at += u.size;
          hard = true;
          break;
        }
        if (u.size + width + prefix.length >= cfg.col) break;
        at += u.size;
        width += u.size;
        if (width + prefix.length >= cfg.col) break;
      }
    if (at === start) {
      const key = at + ':' + Array.from(prefix).join(',');
      if (stalled === key)
        throw new RangeError('Display log column cannot advance the original byte-width loop');
      stalled = key;
    } else stalled = null;
    // The original kinsoku helpers modify unused candidate scratch, neither
    // this segment's start nor its actual end (verified against instructions).
    rows.push({
      tag,
      first: concat(prefix, bytes.subarray(start, at - (hard ? 2 : 0))),
      second: empty(),
    });
    prefix = empty();
    indent = pad + (cfg.nameindent | 0);
  }
  return rows;
}
export function encodeDisplayLog(model) {
  const sections = [[], [], [], []],
    word = (list, n) => list.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24),
    str = (list, b) => list.push(...b, 0);
  word(sections[0], model.scenes.length);
  model.scenes.forEach((b) => str(sections[0], b));
  word(sections[1], model.blocks.length);
  model.blocks.forEach((b) => b.forEach((n) => word(sections[1], n)));
  word(sections[2], model.rows.length);
  model.rows.forEach((r) => {
    word(sections[2], r.tag);
    str(sections[2], r.first);
  });
  word(sections[3], model.speakers.length);
  model.speakers.forEach((b) => str(sections[3], b));
  const out = new Uint8Array(24 + sections.reduce((n, s) => n + s.length, 0)),
    v = new DataView(out.buffer);
  let at = 24;
  sections.forEach((s, i) => {
    v.setUint32(i * 4, at, true);
    out.set(s, at);
    at += s.length;
  });
  v.setUint32(16, model.blockBase, true);
  v.setUint32(20, model.rowBase, true);
  return out;
}
export function decodeDisplayLog(bytes) {
  const b = new Binary(bytes, 'Native display log');
  b.range(0, 24);
  const model = {
    blockBase: b.u32(16),
    rowBase: b.u32(20),
    scenes: [],
    blocks: [],
    rows: [],
    speakers: [],
  };
  for (let side = 0; side < 4; side++) {
    const offset = b.u32(side * 4),
      count = b.u32(offset);
    let at = offset + 4;
    if (side === 1) {
      b.range(at, count * 28);
      for (let i = 0; i < count; i++, at += 28)
        model.blocks.push(Array.from({ length: 7 }, (_, j) => b.u32(at + j * 4)));
      continue;
    }
    for (let i = 0; i < count; i++) {
      let tag;
      if (side === 2) {
        tag = b.u32(at);
        at += 4;
      }
      const end = bytes.indexOf(0, at);
      if (end < 0) throw new Error('Native display log contains an unterminated string');
      const s = bytes.slice(at, end);
      at = end + 1;
      if (side === 2) model.rows.push({ tag, first: s, second: empty() });
      else (side === 0 ? model.scenes : model.speakers).push(s);
    }
  }
  return model;
}
export class NativeDisplayLogs {
  constructor(world) {
    this.world = world;
  }
  get(handle) {
    return this.world.runtime.handles.get(handle, 'display-log');
  }
  create(owner) {
    const config = structuredClone(this.world.configuration.fields.log);
    return this.world.runtime.handles.add('display-log', {
      owner,
      config,
      prefix: encodeCP932(config.nameFirst),
      suffix: encodeCP932(config.nameLast),
      limit: 100,
      blockBase: 0,
      rowBase: 0,
      scenes: [],
      blocks: [],
      rows: [],
      speakers: [],
      revision: 0,
    });
  }
  clear(model) {
    model.scenes = [];
    model.blocks = [];
    model.rows = [];
    model.speakers = [];
    model.revision++;
  }
  prune(model) {
    if (model.limit >>> 0 === 0xffffffff) return;
    while (model.blocks.length > model.limit >>> 0) {
      const b = model.blocks.shift();
      for (let i = b[3] >>> 0; i <= b[4] >>> 0; i++)
        if (i >= model.rowBase) {
          const count = i - model.rowBase + 1;
          model.rows.splice(0, count);
          model.rowBase = (model.rowBase + count) >>> 0;
        }
      while (model.rows.length && model.rows[0].tag === 0xffffffff) {
        model.rows.shift();
        model.rowBase = (model.rowBase + 1) >>> 0;
      }
      model.blockBase = (model.blockBase + 1) >>> 0;
    }
    model.revision++;
  }
  append(model, scene, cstBlock, name, text, voice, paragraph, path = -1) {
    scene = cstring(scene);
    let sceneIndex = -1;
    for (let i = model.scenes.length - 1; i >= 0; i--)
      if (same(model.scenes[i], scene)) {
        sceneIndex = i;
        break;
      }
    if (sceneIndex < 0) {
      sceneIndex = model.scenes.length;
      model.scenes.push(scene.slice());
    }
    const last = model.blocks.at(-1);
    if (last && last[1] === sceneIndex && last[2] === cstBlock >>> 0) return false;
    if (!model.config.space) paragraph = false;
    if (paragraph && model.rows.length)
      model.rows.push({ tag: 0xffffffff, first: empty(), second: empty() });
    const tag = (model.blockBase + model.blocks.length) >>> 0,
      b = [0, sceneIndex, cstBlock >>> 0, 0, 0, 0xffffffff, path >>> 0];
    name = cleanDisplayLog(name, model.config.escape);
    text = cleanDisplayLog(text, model.config.escape);
    let speaker = empty(),
      nameRow = -1;
    if (name.length) {
      b[0] |= 2;
      speaker = concat(model.prefix, name, model.suffix);
      let i = model.speakers.findIndex((n) => same(n, speaker));
      if (i < 0) {
        i = model.speakers.length;
        model.speakers.push(speaker.slice());
      }
      b[5] = i;
      if (model.config.nameline) {
        nameRow = model.rowBase + model.rows.length;
        model.rows.push({ tag, first: speaker, second: empty() });
      }
    }
    if (text.length) {
      const rows = wrapDisplayLog(
        text,
        model,
        speaker,
        tag,
        this.world.configuration.fields.log.crNext,
      );
      b[0] |= 1;
      b[3] = model.rowBase + model.rows.length;
      model.rows.push(...rows);
      b[4] = model.rowBase + model.rows.length - 1;
    }
    if (nameRow !== -1) b[3] = nameRow;
    if (voice) b[0] |= 4;
    model.blocks.push(b);
    this.prune(model);
    return true;
  }
  async rebuild(model, history, voiceName, paragraphName, language, task, utf8) {
    this.clear(model);
    let start = 0,
      paragraphState = 0;
    if (model.limit !== -1) {
      let n = 0,
        i = history.path.length - 1;
      for (; i > 0 && n < model.limit; i--) n += history.path[i].value - 1;
      start = i === 0 && n < model.limit ? 0 : Math.max(0, i + 1);
    }
    const bank = this.world.runtime.stringBank(task, false),
      expand = (b) => bank?.expandBytes(b) ?? b;
    for (let path = start; path < history.path.length; path++) {
      const entry = history.path[path],
        data = new NativeSceneData({ languages: [] }),
        read = (n, c) =>
          readNativeResource(this.world, nativeCategoryFilename(this.world.game, n, c));
      if (!(await data.load(entry.scene, read))) continue;
      for (let block = 0; block < entry.value; block++) {
        const parts = [],
          names = [];
        let voice = false,
          paragraph = !paragraphState;
        for (let line = 0; line < data.reader.type(block, -1); line++) {
          const kind = data.reader.type(block, line),
            raw = data.reader.text(block, line, { toUTF8: utf8, language: utf8 ? language : '' });
          if (raw === null) continue;
          if (kind === 2) paragraph = !paragraphState;
          else if (kind === 3) {
            if (paragraphState) paragraph = true;
          } else if (kind === 32) parts.push(raw);
          else if (kind === 33) {
            const sep = utf8 ? new TextEncoder().encode('＠') : Uint8Array.of(0x81, 0x97);
            let at = -1;
            for (let i = 0; i <= raw.length - sep.length; i++)
              if (sep.every((b, j) => raw[i + j] === b)) {
                at = i;
                break;
              }
            names.push(at < 0 ? raw : raw.subarray(at + sep.length));
          } else if (kind === 48) {
            const command = new TextDecoder('shift_jis').decode(raw),
              tokens = command.split(' ').filter(Boolean);
            if (!voice && tokens[0] === voiceName) {
              for (const name of tokens.slice(1))
                if ((await read(name, 'sound')) !== null) {
                  voice = true;
                  break;
                }
            } else {
              const token = command.split(' ')[0];
              if (paragraphName.slice(0, token.length).toLowerCase() === token.toLowerCase()) {
                const expression = command.includes(' ')
                  ? command.slice(token.length + 1).split(' ')[0]
                  : '';
                paragraphState = expression
                  ? Number(
                      evaluateNativeExpression(
                        expression,
                        this.world.runtime.variableBank(task, false),
                      ) !== 0,
                    )
                  : 0;
              }
            }
          }
        }
        this.append(
          model,
          encodeCP932(entry.scene),
          block,
          expand(concat(...names)),
          expand(concat(...parts)),
          voice,
          paragraph,
          path,
        );
      }
    }
  }
  async remake(model, mainLanguage, secondaryLanguage) {
    const scenes = new Map(),
      languages = [mainLanguage, secondaryLanguage].filter((x) => x !== null);
    const read = (name, category) =>
      readNativeResource(this.world, nativeCategoryFilename(this.world.game, name, category));
    for (const row of model.rows) {
      const block = model.blocks[(row.tag - model.blockBase) >>> 0];
      if (!block) continue;
      let data = scenes.get(block[1]);
      if (!data) {
        data = new NativeSceneData({ languages });
        const name = new TextDecoder('shift_jis').decode(model.scenes[block[1]]);
        await data.load(name, read);
        const translations = await read(name.replace(/\.[^\\/.]*$/, '') + '.cstl', 'scene');
        if (translations && languages.length) {
          const entries = readTranslation(translations);
          data.reader.translations = Object.fromEntries(
            Object.entries(entries).filter(([key]) => languages.includes(key)),
          );
        }
        scenes.set(block[1], data);
      }
      const first = [],
        second = [];
      for (let line = 0; line < data.reader.type(block[2], -1); line++)
        if (data.reader.type(block[2], line) === 32) {
          if (mainLanguage !== null) {
            const bytes = data.reader.text(block[2], line, {
              language: mainLanguage,
              toUTF8: true,
            });
            if (bytes) first.push(bytes);
          }
          if (secondaryLanguage !== null) {
            const bytes = data.reader.text(block[2], line, {
              language: secondaryLanguage,
              toUTF8: true,
            });
            if (bytes) second.push(bytes);
          }
        }
      row.first = concat(...first);
      row.second = concat(...second);
    }
    model.revision++;
  }
  async apply(id, args, machine, task) {
    if (
      !NATIVE_DISPLAY_LOG_IDS.includes(id) ||
      id >= nativeABI(this.world.profile).tables.main.count
    )
      return undefined;
    const a = (i) => nativeDataArgument(args, machine, i),
      done = () => nativeReply(2),
      value = (n) => nativeReply(1, n);
    if (id === 0x2b8) return value(this.create(task.id));
    if (id === 0x352 || id === 0x353) {
      if (!a(0) || !a(2)) return value(0);
      const file = this.world.runtime.handles.get(a(0), 'global-file'),
        model = this.get(a(2));
      if (id === 0x352) file.write(a(1), encodeDisplayLog(model));
      else {
        const bytes = file.read(a(1));
        if (bytes === null) return value(0);
        Object.assign(model, decodeDisplayLog(bytes));
        model.revision++;
        this.prune(model);
      }
      return value(1);
    }
    if (!a(0)) return done();
    const model = this.get(a(0));
    if (id === 0x2b9) {
      await this.world.nativeEngine?.features.get('display-log-projection')?.release(a(0));
      this.world.runtime.handles.release(a(0), 'display-log');
      return done();
    }
    if (id === 0x36c) {
      this.clear(model);
      return done();
    }
    if (id === 0x311) {
      model.limit = a(1) | 0;
      this.prune(model);
      return done();
    }
    const formatted = (i) =>
      nativeDataFormat(args, machine, this.world.runtime.services, i) ?? empty();
    if (id === 0x2ba || id === 0x3d1) {
      this.append(
        model,
        formatted(1),
        a(2),
        formatted(3),
        formatted(4),
        a(5),
        a(6),
        id === 0x3d1 ? a(7) : -1,
      );
      return done();
    }
    if (id === 0x2bc) {
      const row = model.rows[a(2) >>> 0],
        block = row && model.blocks[(row.tag - model.blockBase) >>> 0],
        name = block && model.speakers[block[5]];
      machine.bytes(a(1), (name?.length ?? 0) + 1).set([...(name ?? []), 0]);
      return done();
    }
    if (id === 0x2bb || id === 0x40a) {
      if (a(1)) {
        const history = this.world.runtime.handles.get(a(1), 'scene-data').history;
        await this.rebuild(
          model,
          history,
          new TextDecoder('shift_jis').decode(formatted(2)),
          new TextDecoder('shift_jis').decode(formatted(3)),
          id === 0x40a ? new TextDecoder('shift_jis').decode(formatted(4)) : '',
          task,
          id === 0x40a,
        );
      }
      return done();
    }
  }
  async materialize(handle) {
    return (await this.world.getNativeFeature('display-log-projection')).prepare(handle);
  }
  async lines(handle) {
    return this.get(handle).rows.map((r) => r.first.slice());
  }
  snapshot() {
    return {};
  }
  restore() {}
  close() {}
}
export function installNativeDisplayLogs(world) {
  const logs = (world.displayLogs = new NativeDisplayLogs(world));
  world.registerNativeFeature('display-logs', (engine) => {
    engine.registerFeature('display-logs', logs);
    return logs;
  });
  world.registerNativeFeature('display-log-projection', (engine) =>
    engine.createDisplayLogProjection(world),
  );
  for (const id of NATIVE_DISPLAY_LOG_IDS)
    if (id < nativeABI(world.profile).tables.main.count)
      world.runtime.register('main', id, (args, machine, task) =>
        logs.apply(id, args, machine, task),
      );
}
