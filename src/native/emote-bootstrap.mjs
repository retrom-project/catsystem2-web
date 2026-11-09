// SPDX-License-Identifier: MPL-2.0
// Discovery reads the mounted PE only. It never enters WinMain, TLS or Steam.
import { nativeABI } from './abi/index.mjs';
import { requireTransitionalHost } from './transitional-exe.mjs';

export const NATIVE_EMOTE_CREATE = '?EmoteCreate@@YAPAVIEmoteDevice@@ABUInitParam@1@@Z';

export async function inspectNativeM2Bootstrap(game, profile, transitionalExe) {
  nativeABI(profile);
  if (!game.names?.('exe').length) return null;
  return requireTransitionalHost(
    transitionalExe,
    profile,
    'plugin.bootstrap',
    'inspectBootstrap',
  ).inspectBootstrap(game, profile);
}
