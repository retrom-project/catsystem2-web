// SPDX-License-Identifier: MPL-2.0
// Optional identity diagnostics, not a loader or a condition for JS playback.
export const VERIFIED_EMOTE_DRIVERS = Object.freeze([
  '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce',
]);
const warned = new Set();
export async function describeEmoteDriver(
  bytes,
  {
    name = 'emotedriver.dll',
    verified = VERIFIED_EMOTE_DRIVERS,
    warn = (message) => console.warn(message),
  } = {},
) {
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  let build = 'unknown';
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      pe = view.getUint32(60, true);
    if (view.getUint16(0, true) === 0x5a4d && view.getUint32(pe, true) === 0x4550)
      build =
        'timestamp-' +
        view
          .getUint32(pe + 8, true)
          .toString(16)
          .padStart(8, '0');
  } catch {
    /* Missing metadata never blocks the same JS implementation. */
  }
  if (!verified.includes(sha256)) {
    const key = name + '/' + sha256;
    if (!warned.has(key)) {
      warned.add(key);
      warn(
        'Unverified E-mote driver ' +
          name +
          ': build=' +
          build +
          ', sha256=' +
          sha256 +
          '; continuing with emote-js',
      );
    }
  }
  return { name, build, sha256, implementation: 'emote-js' };
}
export async function diagnoseMountedEmoteDriver(game, options) {
  for (const name of game.names?.('dll') ?? []) {
    if (name.replaceAll('\\', '/').split('/').at(-1).toLowerCase() !== 'emotedriver.dll') continue;
    const bytes = await game.read(name);
    if (bytes) await describeEmoteDriver(bytes, { ...options, name });
  }
}
