// SPDX-License-Identifier: MPL-2.0
// FES binds to a real Draw surface; its coordinator owns all family resources.
function bind(graphics, record, player) {
  if (!record || !player?.root) return null;
  const owner = record.id,
    surface =
      record.implementation?.surface ??
      [...graphics.fesSurfaces].find(([, players]) => players.get(owner) === player)?.[0];
  player.nativeGraphics = graphics;
  player.surface = graphics.rememberFESSurface(surface, player) ? surface : null;
  if (player.surface != null && graphics.fesSurfaces.get(surface)?.get(owner) !== player)
    graphics.bindFES(surface, player, owner);
  if (!player.root.runtime) throw new Error('World FES requires its JavaScript coordinator');
  return player.root.runtime;
}
export async function initializeFESGraphics(graphics, record, player) {
  const runtime = bind(graphics, record, player);
  if (!runtime) return;
  await player.nativeInput.initializeLowButton();
  await runtime.initializeResources();
}
export async function syncFESGraphics(graphics, record, player, options = {}) {
  const runtime = bind(graphics, record, player);
  if (runtime) await runtime.sync(options);
}
export async function setFESBaseImage(graphics, instance, object) {
  const draw = graphics.drawTasks.get(instance.player.surface);
  if (!draw?.state.renderer) throw new Error('FES baseimg requires its initialized Draw surface');
  if (!object) return draw.setBaseImage(0);
  if (![1, 2, 4, 6, 11, 12, 22].includes(object.nativeType)) return;
  await instance.runtime.sync();
  if (object.nativeType === 4) {
    await draw.render();
    const x = Math.trunc(object.vramX),
      y = Math.trunc(object.vramY);
    await draw.setBaseImage(draw.state.renderer.bitmap, [
      x,
      y,
      x + object.width,
      y + object.height,
    ]);
  } else await draw.setBaseImage(instance.runtime.images.currentBitmap(object));
}
export async function closeFESGraphics(graphics, record, player) {
  for (const players of graphics.fesSurfaces.values()) players.delete(record.id);
  for (const instance of player?.instances ?? []) await instance.runtime.close();
}
