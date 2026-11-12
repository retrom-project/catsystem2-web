// SPDX-License-Identifier: MPL-2.0
// Original layout handlers 60D280 (2.6.1.74) / 771730 (2.6.1.76).
// These records describe layout; glyph rasterization is a separate service.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { fesSourceBytes } from '../fes/tokens.mjs';

const fontDecoder = new TextDecoder('shift_jis');
export function fesConfigurationFontBytes(profile, configuration) {
  const abi = nativeABI(profile),
    data = configuration?.fields?.data,
    length = abi.text.configurationLayout.fontBytes;
  if (!(data instanceof Uint8Array) || data.length < length)
    throw new Error('FES font requires its current Settings font block');
  const face = data.subarray(0, length);
  if (abi.text.settingsCharacterBytes === 1) {
    const end = face.indexOf(0);
    if (end < 0) throw new RangeError('FES current font has no bounded terminator');
    return new Uint8Array(face.subarray(0, end));
  }
  const view = new DataView(face.buffer, face.byteOffset, face.byteLength);
  let text = '';
  for (let at = 0; at < face.length; at += 2) {
    const code = view.getUint16(at, true);
    if (!code) return new Uint8Array(encodeCP932(text));
    text += String.fromCharCode(code);
  }
  throw new RangeError('FES current font has no bounded terminator');
}
export function fesNativeFontFace(profile, value) {
  const source = fesSourceBytes(value);
  if (nativeABI(profile).text.settingsCharacterBytes === 1) {
    const face = new Uint8Array(source.length + 1);
    face.set(source);
    return face;
  }
  // Both Game STRING setters use the fixed CP932 converter, including STRING8.
  const text = fontDecoder.decode(source),
    face = new Uint8Array((text.length + 1) * 2),
    view = new DataView(face.buffer);
  for (let at = 0; at < text.length; at++) view.setUint16(at * 2, text.charCodeAt(at), true);
  return face;
}

export const FES_TEXT_LAYOUT_MODES = Object.freeze(
  'view color vcolor acolor vacolor pcolor vpcolor margin move ruby frame font fontind fontind_sub shadow size rsize indent weight d_prof c_prof prof shift shift_sub scrolltype wipewidth fontfix profmode profmode_sub prof_enable prof_enable_sub c_prof_sub prof_sub escape'.split(
    ' ',
  ),
);
const NATIVE_NOOP = new Set(
  'vcolor acolor vacolor pcolor vpcolor fontind_sub shift_sub profmode_sub prof_enable_sub c_prof_sub prof_sub'.split(
    ' ',
  ),
);
export class NativeFESTextLayout {
  constructor({ profile, type = 21, bytes, profiles = {}, revision = 0 } = {}) {
    const definition = nativeABI(profile);
    if (!Object.hasOwn(definition.text.fesLayouts, type))
      throw new Error(`Unrecovered FES text layout object type ${type} for ${profile}`);
    this.profile = profile;
    this.type = type;
    this.bytes = bytes ? new Uint8Array(bytes) : new Uint8Array(0x800);
    if (this.bytes.length !== 0x800) throw new Error('Invalid FES text layout record');
    this.profiles = structuredClone(profiles);
    this.revision = revision;
    this.abi = definition.text.fesLayouts[type];
    this.definition = definition;
  }
  word(index, value) {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    if (value !== undefined) view.setUint32(index * 4, value >>> 0, true);
    return view.getUint32(index * 4, true);
  }
  setWords(index, values) {
    values.forEach((value, i) => this.word(index + i, value));
  }
  config() {
    return this.bytes.slice(764, 764 + this.abi.configBytes);
  }
  fontName() {
    const face = this.bytes.subarray(892, 892 + this.abi.fontBytes);
    if (this.definition.text.settingsCharacterBytes === 1) {
      const end = face.indexOf(0);
      return new TextDecoder('shift_jis').decode(end < 0 ? face : face.subarray(0, end));
    }
    let result = '';
    const view = new DataView(face.buffer, face.byteOffset, face.byteLength);
    for (let i = 0; i < face.length; i += 2) {
      const code = view.getUint16(i, true);
      if (!code) break;
      result += String.fromCharCode(code);
    }
    return result;
  }
  setFont(value, index) {
    const bytes = fesNativeFontFace(this.profile, value);
    if (bytes.length > this.abi.fontBytes)
      throw new RangeError('FES font name exceeds the native font record');
    // The original setter writes the terminator, retaining bytes after it.
    this.bytes.set(bytes, 892);
    this.word(this.abi.flags, 0);
    this.word(this.abi.fontIndex, index);
  }
  apply(mode, args = [], evaluate = (value) => Number(value), defaults = {}) {
    const admitted = this.definition.text.layoutModes.includes(mode),
      abi = this.abi,
      p = (index, fallback = 0) =>
        args[index] === undefined ? fallback | 0 : evaluate(args[index]) | 0,
      dirty = () => this.word(abi.dirty, 1);
    // Both native handlers intentionally ignore unknown layout modes and
    // modes whose type dispatch does not include STRING/STRING8.
    if (!FES_TEXT_LAYOUT_MODES.includes(mode) || !admitted || NATIVE_NOOP.has(mode))
      return {
        recognized: FES_TEXT_LAYOUT_MODES.includes(mode) && admitted,
        applied: false,
      };
    let applied = true;
    switch (mode) {
      case 'view': {
        const values = [p(0, 800), p(1, 600)];
        this.setWords(44, values);
        this.setWords(192, values);
        // Game STRING8 also calls the older STRING view setter.
        this.word(this.type === 37 ? 249 : abi.dirty, 1);
        break;
      }
      case 'color': {
        const colors = Array.from(
          { length: 3 },
          (_, i) =>
            (0xff000000 |
              ((p(i * 3 + 2) & 255) << 16) |
              ((p(i * 3 + 1) & 255) << 8) |
              (p(i * 3) & 255)) >>>
            0,
        );
        this.setWords(194, colors);
        this.setWords(abi.colors, colors);
        dirty();
        break;
      }
      case 'margin':
        this.setWords(
          207,
          Array.from({ length: 4 }, (_, i) => p(i)),
        );
        dirty();
        break;
      case 'move':
        this.setWords(211, [p(0), p(1)]);
        dirty();
        break;
      case 'ruby':
        this.word(213, p(0));
        dirty();
        break;
      case 'frame': {
        const value = p(0, -1),
          frame = value === -1 ? (defaults.frame ?? 0) : value;
        this.setWords(219, [frame, frame]);
        dirty();
        break;
      }
      case 'font':
      case 'fontind': {
        let face = args[mode === 'fontind' ? 1 : 0];
        if (face === undefined) face = defaults.fontBytes?.();
        if (face === undefined) throw new Error('FES font requires its complete narrow face bytes');
        this.setFont(face, mode === 'fontind' ? p(0) : 0);
        dirty();
        break;
      }
      case 'shadow':
        this.setWords(abi.shadow, [p(0), p(1)]);
        this.word(abi.flags + 2, 0);
        dirty();
        break;
      case 'size':
      case 'rsize': {
        const first = p(0, mode === 'size' ? 20 : 10);
        this.setWords(
          mode === 'size' ? 197 : 202,
          Array.from({ length: 5 }, (_, i) => p(i, first)),
        );
        dirty();
        break;
      }
      case 'indent':
        this.word(218, p(0));
        dirty();
        break;
      case 'weight': {
        const value = p(0, -1);
        this.word(abi.weight, value === -1 ? (defaults.weight ?? 400) : value);
        this.word(abi.flags + 1, value === -1 ? 1 : 0);
        break;
      }
      case 'd_prof':
      case 'prof': {
        // Missing text reaches an invalid source pointer in the native
        // std::string constructor; it is not an empty profile contract.
        if (args.length < 2) throw new Error(`FES layout ${mode} requires profile text`);
        const index = abi.profile + (mode === 'prof' ? 2 : 0),
          category = p(0),
          source = fesSourceBytes(args[1]),
          end = source.indexOf(0),
          input = source.subarray(0, end < 0 ? source.length : end),
          previous = this.profiles[mode]?.bytes,
          bytes = new Uint8Array((previous?.length ?? 0) + input.length);
        if (previous) bytes.set(previous);
        bytes.set(input, previous?.length ?? 0);
        this.word(index, category);
        this.profiles[mode] = { index: category >>> 0, bytes };
        break;
      }
      case 'c_prof': {
        const category = p(0) >>> 0;
        if (category <= 3) this.word(abi.category + category, 1);
        else applied = false;
        break;
      }
      case 'shift':
        this.word(abi.shift, p(0));
        this.word(abi.shift + 1, 1);
        break;
      case 'scrolltype':
        this.word(191, p(0) ? 1 : 0);
        dirty();
        break;
      case 'wipewidth':
        this.word(abi.wipe, p(0, 100));
        dirty();
        break;
      case 'fontfix':
        this.word(abi.fix, p(0));
        dirty();
        break;
      case 'profmode':
        if (this.type === 37) {
          this.word(261, p(0));
          dirty();
        } else applied = false;
        break;
      case 'prof_enable':
        this.word(217, p(0));
        dirty();
        break;
      case 'escape':
        this.word(215, p(0));
        dirty();
        break;
      default:
        throw new Error(`Unrecovered FES text layout mode ${mode}`);
    }
    if (applied) this.revision++;
    return { recognized: true, applied };
  }
  snapshot() {
    return structuredClone({
      profile: this.profile,
      type: this.type,
      bytes: this.bytes,
      profiles: this.profiles,
      revision: this.revision,
    });
  }
}
