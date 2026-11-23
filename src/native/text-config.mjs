// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { parserDefaults } from './text-parser.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
export function textConfig(profile, mode, configuration, { fes = false } = {}) {
  const out = parserDefaults(profile, mode),
    v = new DataView(out.buffer),
    set = (at, n) => v.setInt32(at, n | 0, true),
    font = configuration?.fields?.font ?? {};
  for (let i = 6; i <= 10; i++) set(i * 4, 24);
  set(100, 0);
  set(104, 1);
  set(124, fes ? (font.prop ?? 0) : 0);
  const length =
    mode === 'utf8' ? 128 : nativeABI(profile).text.settingsCharacterBytes === 2 ? 64 : 32;
  const name = font.name ?? '';
  if (nativeABI(profile).text.settingsCharacterBytes === 2) {
    for (let i = 0; i < Math.min(name.length, length / 2 - 1); i++)
      v.setUint16(128 + i * 2, name.charCodeAt(i), true);
  } else out.set(encodeCP932(name).subarray(0, length - 1), 128);
  const at = 128 + length;
  set(at, font.weight ? 700 : 400);
  set(at + 4, font.rightdown ?? 0);
  set(at + 8, font.around ?? 0);
  set(at + 12, font.prop ? (font.fix ?? 0) : 1);
  set(at + 16, 60);
  set(at + 20, 0);
  const message = configuration?.blocks?.[1];
  if (message?.byteLength >= 60)
    set(
      0,
      Number(
        Boolean(
          new DataView(message.buffer, message.byteOffset, message.byteLength).getUint32(56, true),
        ),
      ),
    );
  else set(0, 0);
  return out;
}
export function textPacket(profile, mode, configuration) {
  const abi = nativeABI(profile).layouts?.textCores?.[mode];
  if (!abi) throw new Error(`Unavailable text mode ${mode} for ${profile}`);
  return packTextConfiguration(
    abi,
    mode === 'nv' ? nvTextConfig(profile, configuration) : textConfig(profile, mode, configuration),
  );
}

export function nvTextConfig(profile, configuration, { fes = false } = {}) {
  const abi = nativeABI(profile),
    { cp932, nv } = abi.layouts.textCores;
  if (!nv) throw new Error(`Unavailable text mode nv for ${profile}`);
  const out = new Uint8Array(nv.configSize),
    v = new DataView(out.buffer),
    second = 24 + cp932.configSize + 16,
    section = textConfig(profile, 'cp932', configuration, { fes });
  v.setUint32(0, 800, true);
  v.setUint32(4, 600, true);
  for (const at of [8, second - 16]) {
    v.setUint32(at + 8, 800, true);
    v.setUint32(at + 12, 600, true);
  }
  out.set(section, 24);
  out.set(section, second);
  if (!fes || !abi.text.nvFesSecondaryUsesDefaults) v.setUint32(second + 104, 0, true);
  return out;
}

const nativeParts = ({ parts, offsetInParser, size }) => parts ?? [[offsetInParser, size]];

export function packTextConfiguration(binding, config, x = 0, y = 0, output = 0) {
  const native = binding.nativeConfig,
    size = native?.size ?? config.length,
    out = new Uint8Array(binding.packetSize ?? size + 16),
    v = new DataView(out.buffer),
    at = 4 + size;
  v.setUint32(0, out.length, true);
  if (native) {
    let cursor = 4;
    for (const [start, length] of nativeParts(native)) {
      out.set(config.subarray(start, start + length), cursor);
      cursor += length;
    }
  } else out.set(config, 4);
  v.setInt32(at, x, true);
  v.setInt32(at + 4, y, true);
  v.setUint32(at + 8, output, true);
  return out;
}

export function unpackTextConfiguration(binding, packet, defaults) {
  const native = binding.nativeConfig;
  if (!native) return packet.subarray(4, 4 + binding.configSize);
  let cursor = 4;
  for (const [start, length] of nativeParts(native)) {
    defaults.set(packet.subarray(cursor, cursor + length), start);
    cursor += length;
  }
  return defaults;
}
