// SPDX-License-Identifier: MPL-2.0
import { originalView } from './original-adapter.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeDataPair } from './data-text.mjs';
// Mounted-file resolution shared by JS decoders and the transitional IFile host.
export function nativeCategoryFilename(game, name, category) {
  if (game.nativeResources) return game.nativeResources.resolve(name, category);
  return /[\\/]/.test(name) ? name : `@cat/${category}/${name}`;
}
export function nativeNarrowCategoryPath(game, name, category, count) {
  for (let at = 0; at < name.length; at++) {
    if (nativeDataPair(name, at)) at++;
    else if (at && (name[at] === 0x2f || name[at] === 0x5c)) {
      const path = new Uint8Array(name.length + 1);
      path.set(name);
      return path;
    }
  }
  const mount = game.nativeResources?.entries
    ?.slice(0, count)
    .find(({ name }) => name.toLowerCase() === category);
  if (!mount) return null;
  const prefix = encodeCP932(mount.directory ? mount.directory + '/' : ''),
    separator = Math.max(name.lastIndexOf(0x2f), name.lastIndexOf(0x5c)),
    suffix = encodeCP932(name.lastIndexOf(0x2e) > separator ? '' : '.' + mount.extension),
    path = new Uint8Array(prefix.length + name.length + suffix.length + 1);
  path.set(prefix);
  path.set(name, prefix.length);
  path.set(suffix, prefix.length + name.length);
  return path;
}
export async function readNativeResource(
  world,
  path,
  mode = 3,
  kernel = originalView(world, 'resourceKernel'),
  readHit,
) {
  const validate = (bytes) => {
    if (bytes !== null && !(bytes instanceof Uint8Array))
      throw new TypeError('Native file provider must return bytes or null');
    return bytes;
  };
  for (const provider of kernel?.fileProviders?.values() ?? []) {
    const bytes = await provider.read?.(path);
    if (bytes !== undefined) return validate(bytes);
  }
  const game = world.game,
    match = /^@cat\/([^/]+)\/(.*)$/.exec(path),
    resolved = match
      ? game.nativeResources
        ? game.nativeResources.resolve(match[2], match[1])
        : game.resolveCategory
          ? game.resolveCategory(match[2], match[1])
          : match[2]
      : path;
  if (resolved === null && game.nativeCandidates) return null;
  const cached =
    world.resourceCache && resolved !== null ? await world.resourceCache.peek(resolved) : null;
  if (cached !== null) return validate(cached);
  const readFile =
    kernel?.readFile ??
    (world.storage?.read
      ? (name) => (readHit ? world.storage.read(name, readHit) : world.storage.read(name))
      : null);
  if (game.nativeCandidates) {
    for (const candidate of game.nativeCandidates(resolved, mode)) {
      if (candidate.kind === 'loose' && readFile) {
        const bytes = await readFile(candidate.path);
        if (bytes !== null) return validate(bytes);
      }
      if (candidate.hit) {
        const { file, offset, size } = candidate.hit;
        return validate(await (readHit ? readHit(candidate.hit) : file.read(offset, size)));
      }
    }
    return null;
  }
  if (mode !== 3)
    throw new Error(
      `Native mounted file search mode ${mode} requires a native resource mount provider`,
    );
  let bytes = readFile ? await readFile(path) : null;
  if (bytes === null) {
    if (match) {
      if (game.readCategory) bytes = await game.readCategory(match[2], match[1]);
      else {
        const file = game.resolveCategory ? game.resolveCategory(match[2], match[1]) : match[2];
        bytes = file === null ? null : await game.read(file);
      }
    } else bytes = await game.read(path);
  }
  return validate(bytes);
}
