// SPDX-License-Identifier: MPL-2.0
// FES getsndconfex/setsndconfex: game 783630/783FD0, SDK 61C6B0/61D050.
// Tokens have already passed the FES string and language substitutions.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { parseNativeIntegerPrefix } from './standard.mjs';

// 6A5DD0/767550 preserve parenthesized expressions as a single token. The
// colon forms remove their delimiters; ordinary quotes retain two NUL bytes
// in the temporary token list, which can terminate subsequent token lookup.
export function tokenizeNativeFESSoundConfiguration(line, profile) {
  if (!profiles.has(profile))
    throw new Error('FES tokenization requires its native engine profile');
  const source = encodeCP932(line),
    output = new Uint8Array(source.length * 2 + 8);
  let input = 0,
    at = 0,
    boundary = true,
    previous = 0;
  while (input < source.length && source[input]) {
    const byte = source[input];
    if (byte === 40 || (byte === 34 && nativeABI(profile).sound.allowQuotedFesNames)) {
      if (((previous >= 65 && previous <= 90) || (previous >= 97 && previous <= 122)) && !boundary)
        output[at++] = 0;
      const start = input,
        stripped = source[input + 1] === 58;
      if (byte === 34) {
        input++;
        let written = at;
        while (input < source.length && source[input] && source[input] !== 34)
          output[written++] = source[input++];
        output[written] = output[written + 1] = 0;
        if (source[input] === 34) input++;
      } else {
        let depth = 0;
        do {
          const value = source[input++];
          output[at + input - start - 1] = value;
          if (value === 40) depth++;
          else if (value === 41) depth--;
        } while (input < source.length && source[input] && depth);
        output[at + input - start] = output[at + input - start + 1] = 0;
      }
      const count = input - start;
      if (stripped) {
        if (count > 3) output.copyWithin(at, at + 2, at + count - 1);
        if (count >= 2) output[at + count - 3] = 0;
        at -= 3;
      }
      at += count;
      boundary = false;
    } else {
      if (byte !== 32) {
        output[at++] = byte;
        boundary = false;
        previous = byte;
      } else if (!boundary) {
        output[at++] = 0;
        boundary = true;
        previous = 0;
      }
      input++;
    }
  }
  output[at] = output[at + 1] = 0;
  const tokens = [],
    decoder = new TextDecoder('shift_jis');
  for (let start = 0; output[start]; ) {
    const end = output.indexOf(0, start);
    tokens.push(decoder.decode(output.subarray(start, end)));
    start = end + 1;
  }
  return tokens;
}

export function expandNativeFESSoundConfigurationToken(token, { string, replace } = {}) {
  let result = '';
  for (let at = 0; at < token.length && token.charCodeAt(at); ) {
    if (token.startsWith('$str', at)) {
      const number = parseNativeIntegerPrefix(token.slice(at + 4));
      if (number) {
        if (typeof string !== 'function')
          throw new Error('FES string-bank expansion service is missing');
        result += String(string(number.value >>> 0) ?? '').split('\0')[0];
        at += number.count + 4;
        continue;
      }
    }
    result += token[at++];
  }
  return typeof replace === 'function' ? replace(result) : result;
}

const fields = Object.freeze({
  volume: 'volume',
  play: 'play',
  sysplay: 'sysplay',
  mute: 'mute',
  voicebgm: 'voicevol',
});
const profiles = new Set(['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']);
export const FES_SOUND_CONFIGURATION_GET_FIELDS = Object.freeze(
  ['', '_id', '_type'].flatMap((suffix) => Object.keys(fields).map((name) => name + suffix)),
);
export const FES_SOUND_CONFIGURATION_SET_FIELDS = Object.freeze(
  ['', '_id', '_type'].flatMap((suffix) =>
    [...Object.keys(fields), 'reset'].map((name) => name + suffix),
  ),
);

function selectSoundConfiguration(
  tokens,
  { write = false, evaluate, text = (value) => value } = {},
) {
  const name = tokens[0] === undefined ? undefined : text(tokens[0]),
    recognized = (
      write ? FES_SOUND_CONFIGURATION_SET_FIELDS : FES_SOUND_CONFIGURATION_GET_FIELDS
    ).includes(name);
  if (!recognized) return { name, recognized, selected: undefined };
  const match = /^(.*?)(_id|_type)?$/.exec(name),
    field = match[1] === 'reset' ? 'reset' : fields[match[1]];
  if (match[2] === '_id') {
    const ids = tokens.slice(1).map((token) => {
      if (typeof evaluate !== 'function')
        throw new Error('FES sound ID selectors require their numeric expression service');
      return evaluate(text(token)) | 0;
    });
    return { name, recognized, selected: { field, selector: { by: 'idPath', ids } } };
  }
  if (tokens[1] === undefined) return { name, recognized, selected: undefined };
  const query = text(tokens[1]);
  if (match[2] === '_type')
    return { name, recognized, selected: { field, selector: { by: 'type', query } } };
  // sysplay/voicebgm deliberately have no special master form. The literal
  // comparison is case-sensitive even though the subsequent name lookup is not.
  const master = query === 'master' && ['volume', 'play', 'mute', 'reset'].includes(match[1]);
  return {
    name,
    recognized,
    selected: { field, selector: master ? { by: 'master' } : { by: 'key', query } },
  };
}

export function nativeFESSoundSelector(tokens, context = {}) {
  return selectSoundConfiguration(tokens, context).selected;
}

export class NativeFESSoundConfiguration {
  constructor({ soundConfiguration, configuration, changed } = {}) {
    if (
      !profiles.has(soundConfiguration?.profile) ||
      soundConfiguration.profile !== configuration?.profile
    )
      throw new Error('FES sound configuration requires the shared native configuration pair');
    Object.assign(this, { soundConfiguration, configuration, changed });
  }
  selector(tokens, context = {}, write = false) {
    return nativeFESSoundSelector(tokens, { ...context, write });
  }
  tokens(line) {
    return tokenizeNativeFESSoundConfiguration(line, this.configuration.profile);
  }
  get(tokens, context = {}) {
    const selected = this.selector(tokens, context);
    return selected && this.soundConfiguration.get(selected.field, selected.selector);
  }
  set(tokens, value, context = {}) {
    if (tokens[0] === undefined) return false;
    const {
      name,
      recognized: known,
      selected,
    } = selectSoundConfiguration(tokens, { ...context, write: true });
    // Known plain/type forms with a missing selector leave before the shared
    // epilogue. An unknown field reaches that epilogue without touching a tree.
    if (known && !selected) return false;
    if (selected) {
      if (selected.field === 'reset') this.soundConfiguration.reset(selected.selector);
      else this.soundConfiguration.set(selected.field, value, selected.selector);
    }
    this.configuration.deriveVolumes();
    const result = this.changed?.(name, context, { recognized: !!selected });
    return result?.then ? result.then(() => !!selected) : !!selected;
  }
}
