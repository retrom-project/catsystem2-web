// SPDX-License-Identifier: MPL-2.0
// One synchronous enumeration owned by one FES interpreter.
import { nativeABI } from './abi/index.mjs';
import { nativeDataString } from './data-text.mjs';
import { encodeNativeCP932 } from './cp932.mjs';
import { nativeFontFamilyRows, nativeFontNameBytes } from './font-catalog.mjs';

const narrow = new TextDecoder('shift_jis'),
  wide = new TextDecoder('utf-16le', { ignoreBOM: true });
function nameBytes(font, isWide) {
  const bytes = nativeFontNameBytes(font, isWide);
  let end = 0;
  if (isWide) {
    while (bytes[end] || bytes[end + 1]) end += 2;
  } else end = bytes.indexOf(0);
  return bytes.slice(0, end);
}

export class FESFontEnumeration {
  constructor(world) {
    this.world = world;
    this.wide = nativeABI(world.profile).text.settingsCharacterBytes === 2;
    this.names = null;
  }
  enumerate(proportional) {
    const explicit = this.world.host.nativeFontFamilies,
      owner = explicit !== undefined ? this.world.host : this.world.bootstrapOwner,
      provider = explicit !== undefined ? explicit : owner?.fontFamilies;
    if (typeof provider !== 'function')
      throw new Error('FES font enumeration requires its platform font family data view');
    const enumerate = provider.bind(owner),
      rows = enumerate(this.world);
    if (!Array.isArray(rows)) throw new TypeError('FES font catalog must be synchronous rows');
    return nativeFontFamilyRows(rows)
      .filter(
        (font) =>
          ((font.type ?? 4) & 4) !== 0 &&
          (font.charset ?? 1) === 128 &&
          (proportional || ((font.pitchAndFamily ?? 0) & 15) === 1),
      )
      .map((font) => nameBytes(font, this.wide))
      .filter((bytes) => bytes[0] !== 64 || (this.wide && bytes[1] !== 0));
  }
  initialize() {
    this.close();
    const proportional = this.world.configuration.font.prop,
      capacity = this.enumerate(proportional).length,
      names = this.enumerate(proportional);
    // The native second callback resets and owns the final count. Growth can
    // overrun its first-pass allocation; that undefined memory domain is refused.
    if (names.length > capacity) throw new RangeError('FES font catalog grew beyond its capacity');
    this.names = names;
  }
  get(index) {
    const bytes = this.names[index >>> 0];
    return bytes
      ? this.wide
        ? encodeNativeCP932(wide.decode(bytes))
        : new Uint8Array(bytes)
      : new Uint8Array();
  }
  search(source) {
    const text = narrow.decode(nativeDataString(source)),
      decoder = this.wide ? wide : narrow;
    return this.names.findIndex((bytes) => decoder.decode(bytes) === text);
  }
  snapshot() {
    return this.names === null ? null : this.names.map((bytes) => new Uint8Array(bytes));
  }
  restore(names) {
    this.names = names === null ? null : names.map((bytes) => new Uint8Array(bytes));
  }
  close() {
    this.names = null;
  }
}
