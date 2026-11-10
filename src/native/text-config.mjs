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
  set(
    0,
    Number(
      Boolean(
        configuration?.blocks?.[1] &&
          new DataView(configuration.blocks[1].buffer).getUint32(56, true),
      ),
    ),
  );
  return out;
}
export function textPacket(profile, mode, configuration) {
  const abi = nativeABI(profile).layouts.textCores[mode],
    out = new Uint8Array(abi.packetSize ?? abi.configSize + 16),
    v = new DataView(out.buffer);
  v.setUint32(0, out.length, true);
  if (mode !== 'nv') out.set(textConfig(profile, mode, configuration), 4);
  else {
    const size = nativeABI(profile).layouts.textCores.cp932.configSize,
      second = 24 + size + 16;
    v.setUint32(4, 800, true);
    v.setUint32(8, 600, true);
    for (const at of [12, second - 12]) {
      v.setUint32(at + 8, 800, true);
      v.setUint32(at + 12, 600, true);
    }
    out.set(textConfig(profile, 'cp932', configuration), 28);
    out.set(textConfig(profile, 'cp932', configuration), second + 4);
    v.setUint32(second + 4 + 104, 0, true);
  }
  return out;
}
