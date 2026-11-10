// SPDX-License-Identifier: MPL-2.0
// Mounted-file resolution shared by JS decoders and the transitional IFile host.
export function nativeCategoryFilename(game, name, category) {
  if (game.nativeResources) return game.nativeResources.resolve(name, category);
  return /[\\/]/.test(name) ? name : `@cat/${category}/${name}`;
}
export async function readNativeResource(
  world,
  path,
  mode = 3,
  kernel = world.nativeEngine?.kernel,
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
    kernel?.readFile ?? (world.storage?.read ? (name) => world.storage.read(name) : null);
  if (game.nativeCandidates) {
    for (const candidate of game.nativeCandidates(resolved, mode)) {
      if (candidate.kind === 'loose' && readFile) {
        const bytes = await readFile(candidate.path);
        if (bytes !== null) return validate(bytes);
      }
      if (candidate.hit) {
        const { file, offset, size } = candidate.hit;
        return validate(await file.read(offset, size));
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
