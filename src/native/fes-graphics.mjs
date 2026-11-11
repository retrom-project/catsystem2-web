// SPDX-License-Identifier: MPL-2.0
// FES object/task and retained drawing bridge: 628D60 / 62DA50,
// 65D1D0 / 661940 (planes), 65CD40 / 65E110 (CPU image entries).
import { MOTION_ABI, setMotionVector } from '../motion/abi.mjs';
import { objectMotionState } from '../motion/target.mjs';
import { identity, multiply } from '../motion/matrix.mjs';

const f = Math.fround;
const namespace = (owner, object) => (owner | (object.handle << 16)) >>> 0;
function planeChain(instance, object) {
  const result = [];
  let parent = instance.plane(object);
  while (parent) {
    if (result.includes(parent) || result.length >= 64)
      throw new Error(`FES plane cycle at ${object.key}`);
    result.push(parent);
    parent = instance.plane(parent);
  }
  return result;
}
export function planeState(instance, object) {
  const bytes = objectMotionState(object),
    parents = planeChain(instance, object);
  const pos = [object.x, object.y, object.z],
    base = [object.baseX, object.baseY, object.pri];
  const scale = [object.scaleX, object.scaleY, object.scaleZ];
  let matrix = identity();
  for (const parent of parents.toReversed()) {
    if (parent.isPlane)
      for (let i = 0; i < 3; i++) pos[i] = f(pos[i] + [parent.x, parent.y, parent.z][i]);
    if (parent.type === 'PLANE') {
      base[0] = f(base[0] + parent.baseX);
      base[1] = f(base[1] + parent.baseY);
      for (let i = 0; i < 3; i++)
        scale[i] = f(scale[i] * [parent.scaleX, parent.scaleY, parent.scaleZ][i]);
      if (parent.motionMatrix) matrix = multiply(matrix, parent.motionMatrix);
    }
  }
  if (object.motionMatrix) matrix = multiply(matrix, object.motionMatrix);
  setMotionVector(bytes, MOTION_ABI.pos, pos);
  setMotionVector(bytes, MOTION_ABI.base, base);
  setMotionVector(bytes, MOTION_ABI.scale, scale);
  setMotionVector(bytes, MOTION_ABI.vram, [0, 0, 0]);
  matrix.forEach((v, i) =>
    new DataView(bytes.buffer).setFloat32(MOTION_ABI.matrix + i * 4, v, true),
  );
  return bytes;
}
function imagePlacement(instance, object) {
  const parents = planeChain(instance, object);
  let x = object.x,
    y = object.y;
  for (const parent of parents)
    if (['IMAGE', 'CIMAGE', 'BUTTON'].includes(parent.type)) {
      x = f(x + parent.x);
      y = f(y + parent.y);
    }
  return { x, y, plane: parents.find((p) => p.type === 'PLANE') };
}

function bindFESGraphics(graphics, record, player) {
  if (!record || !player?.root) return;
  player.nativeGraphics = graphics;
  if (graphics.world.text) player.nativeText = graphics.world.text.fes;
  if (graphics.world.text) player.nativeLog = graphics.world.text.log;
  if (graphics.world.controlsFES) player.nativeControls = graphics.world.controlsFES;
  if (graphics.world.imagesFES) player.nativeImages = graphics.world.imagesFES;
  if (graphics.world.dataFES) player.nativeData = graphics.world.dataFES;
  if (graphics.world.particlesFES) player.nativeParticles = graphics.world.particlesFES;
  if (graphics.world.effectsFES) player.nativeEffects = graphics.world.effectsFES;
  if (graphics.world.planesFES) player.nativePlanes = graphics.world.planesFES;
  if (graphics.world.areaFES) player.nativeArea = graphics.world.areaFES;
  if (graphics.world.m2FES) player.nativeM2 = graphics.world.m2FES;
  const instance = player.root,
    owner = record.id;
  const surfaceID =
    record.implementation?.surface ??
    [...graphics.fesSurfaces].find(([, p]) => p.get(owner) === player)?.[0];
  const draw = surfaceID == null ? null : graphics.drawTasks.get(surfaceID);
  player.surface = graphics.rememberFESSurface(surfaceID, player) ? surfaceID : null;
  if (player.surface != null && graphics.fesSurfaces.get(surfaceID)?.get(owner) !== player)
    graphics.bindFES(surfaceID, player, owner);
  return { instance, owner, surfaceID, draw };
}

export async function initializeFESGraphics(graphics, record, player) {
  const state = bindFESGraphics(graphics, record, player);
  if (!state) return;
  const { instance } = state;
  await player.nativeInput?.initializeLowButton();
  // 628D60 / 500390 allocate wrappers and the eagerly owned child tasks.
  // Decoding and graph creation belong to 62DA50 / 504E50 after START runs.
  for (const object of instance.objects) {
    if (object.deleted) continue;
    if (player.nativeImages?.supports(object))
      await player.nativeImages.initialize(instance, object);
    else if (player.nativeControls?.supports(object))
      await player.nativeControls.initialize(instance, object);
    else if (player.nativeText?.supports(object))
      await player.nativeText.initialize(instance, object);
    else if (player.nativeData?.supports(object))
      await player.nativeData.initialize(instance, object);
    else if (player.nativeParticles?.supports(object))
      await player.nativeParticles.initialize(instance, object);
    else if (player.nativeEffects?.supports(object))
      await player.nativeEffects.initialize(instance, object);
    else if (player.nativePlanes?.supports(object))
      await player.nativePlanes.initialize(instance, object);
    else if (player.nativeArea?.supports(object))
      await player.nativeArea.initialize(instance, object);
    else if (player.nativeM2?.supports(object)) await player.nativeM2.initialize(instance, object);
    else if (player.nativeLog?.supports(object))
      await (await graphics.world.getNativeFeature('fes-objects')).create(instance, object);
  }
}

export async function syncFESGraphics(graphics, record, player, { restoring = false } = {}) {
  const state = bindFESGraphics(graphics, record, player);
  if (!state) return;
  const { instance, owner, draw } = state,
    sleeping = !!player.nativeInput?.state.sleeping;
  if (!restoring && graphics.world.nativeEngine?.module)
    await (
      await graphics.world.getNativeFeature('fes-objects')
    ).planeAssociationPhase(instance, false);
  // 62DA50 / 504E50 walk the FIFO resource list. An IMAGE's original
  // frame driver reads its PLANE's current rectangle, so keep these
  // drivers in declaration order rather than running every image first.
  for (const object of instance.objects) {
    const adapter = player.nativeImages?.supports(object)
      ? player.nativeImages
      : !restoring && player.nativePlanes?.supports(object)
        ? player.nativePlanes
        : null;
    if (adapter)
      await adapter.update(instance, object, {
        configurationDirty: graphics.world.configurationDirty,
      });
  }
  if (player.nativeControls) {
    for (const object of instance.objects)
      if (player.nativeControls.supports(object))
        await player.nativeControls.update(instance, object, {
          configurationDirty: graphics.world.configurationDirty,
        });
  }
  if (player.nativeLog) {
    for (const object of [...instance.objects])
      if (player.nativeLog.supports(object))
        await player.nativeLog.update(instance, object, {
          configurationDirty: graphics.world.configurationDirty,
        });
  }
  if (player.nativeText) {
    for (const object of instance.objects)
      if (player.nativeText.supports(object))
        await player.nativeText.update(instance, object, {
          configurationDirty: graphics.world.configurationDirty,
        });
  }
  if (player.nativeM2)
    for (const object of instance.objects)
      if (player.nativeM2.supports(object))
        await player.nativeM2.update(instance, object, {
          configurationDirty: graphics.world.configurationDirty,
        });
  if (player.nativeData)
    for (const object of instance.objects)
      if (player.nativeData.supports(object)) await player.nativeData.initialize(instance, object);
  if (!restoring && player.nativeParticles)
    for (const object of instance.objects)
      if (player.nativeParticles.supports(object))
        await player.nativeParticles.initialize(instance, object);
  if (!restoring && player.nativeArea)
    for (const object of instance.objects)
      if (player.nativeArea.supports(object)) await player.nativeArea.initialize(instance, object);
  if (
    !restoring &&
    player.nativeEffects &&
    instance.objects.some((object) => player.nativeEffects.supports(object))
  )
    await player.nativeEffects.update(instance);
  else if (
    !restoring &&
    instance.objects.some(
      (object) => player.nativeArea?.supports(object) || player.nativeParticles?.supports(object),
    )
  )
    await (await graphics.world.getNativeFeature('fes-objects')).runResourceDrivers(instance);
  for (const object of instance.objects.filter(
    (o) => o.isPlane && !player.nativeM2?.supports(o) && !player.nativePlanes?.supports(o),
  )) {
    if (object.deleted) {
      if (object.nativeTaskID != null) {
        await graphics.world.objects.destroy(object.nativeTaskID, owner);
        object.nativeTaskID = null;
      }
      continue;
    }
    if (object.nativeTaskID == null)
      object.nativeTaskID = await graphics.world.objects.create({
        kind: 2,
        parent: owner,
        creator: owner,
        name: 'FE Plane',
      });
    const task = graphics.get(object.nativeTaskID);
    if (!task)
      throw new Error(
        `FES ${instance.name} ${object.key} native plane ${object.nativeTaskID} disappeared`,
      );
    if (!task.graph || task.graph.width !== object.width || task.graph.height !== object.height)
      task.makeGraph({
        type: object.type === 'PLANE' ? 1 : 2,
        width: object.width,
        height: object.height,
        vram: object.type === 'PLANE',
        ...(object.type === 'CPLANE' ? { colors: [object.color ?? 0xffffffff] } : {}),
      });
    task.graph.kx2 = planeState(instance, object);
    task.graph.matrixExplicit = true;
    const offset = draw?.state.offset || [0, 0];
    setMotionVector(task.graph.textureTransform, MOTION_ABI.pos, [
      Math.trunc(object.vramX) + offset[0],
      Math.trunc(object.vramY) + offset[1],
      object.vramZ,
    ]);
    task.state.shown = object.disp && !sleeping;
    task.state.colorOverride = true;
    task.state.blendMode = object.blendMode ?? 0;
    task.sync();
  }
  if (!draw?.state.renderer) return;
  const width = draw.state.renderer.width,
    height = draw.state.renderer.height;
  for (const object of instance.objects.filter((o) => !o.isPlane)) {
    const key = namespace(owner, object);
    if (object.deleted) {
      await draw.remove(key);
      if (object.nativeImageHandle) {
        await graphics.images.release(object.nativeImageHandle);
        object.nativeImageHandle = null;
      }
      continue;
    }
    if (
      player.nativeImages?.supports(object) ||
      player.nativeText?.supports(object) ||
      player.nativeM2?.supports(object) ||
      player.nativeLog?.supports(object) ||
      player.nativeControls?.supports(object) ||
      player.nativeData?.supports(object) ||
      player.nativeParticles?.supports(object) ||
      player.nativeEffects?.supports(object) ||
      player.nativePlanes?.supports(object) ||
      player.nativeArea?.supports(object)
    )
      continue;
    if (!['IMAGE', 'BUTTON', 'CIMAGE'].includes(object.type)) {
      if (
        object.disp &&
        [
          'STRING',
          'STRING8',
          'LOGSTRING',
          'LOGSTRING8',
          'SAVEPANEL',
          'SLIDER',
          'SCROLL',
          'SCROLL2',
          'DIFIMAGE',
          'DIFIMAGE2',
          'PANEL',
          'IMGWND',
          'NVSTRING',
          'NUMIMG',
          'BGTABLE',
          'BGTABLE2',
          'CHTABLE',
          'CHTABLE2',
          'CHTABLE3',
        ].includes(object.type)
      )
        throw new Error(
          `FES ${instance.name} ${object.key} ${object.type} native retained-draw resource adapter is unavailable`,
        );
      continue;
    }
    const file = object.file && player.expand(object.file),
      imageKey =
        object.type === 'CIMAGE'
          ? `color:${object.width},${object.height},${object.color}`
          : `${file}:${object.currentID}`;
    if (object.nativeImageKey !== imageKey) {
      if (object.nativeImageHandle) await graphics.images.release(object.nativeImageHandle);
      object.nativeImageKey = imageKey;
      object.nativeImageHandle = 0;
      if (object.type === 'CIMAGE' && object.width > 0 && object.height > 0) {
        object.nativeImageHandle = graphics.images.create(object.width, object.height, owner);
        await graphics.images
          .get(object.nativeImageHandle)
          .fill(0, 0, object.width, object.height, object.color ?? 0xffffffff);
      } else if (file) {
        const task = graphics.world.objects?.objects.get(owner)?.implementation;
        object.nativeImageHandle =
          typeof task?.loadImage === 'function'
            ? await task.loadImage(file, object.currentID)
            : await graphics.images.load(file, object.currentID, owner);
      }
    }
    if (!object.nativeImageHandle) {
      await draw.remove(key);
      object.nativeImageMetrics = null;
      continue;
    }
    const bitmap = graphics.images.get(object.nativeImageHandle);
    object.nativeImageMetrics = Object.fromEntries(
      [
        'width',
        'height',
        'canvasWidth',
        'canvasHeight',
        'offsetX',
        'offsetY',
        'baseX',
        'baseY',
      ].map((key) => [key, bitmap.state[key]]),
    );
    const { x, y, plane } = imagePlacement(instance, object),
      offset = draw.state.offset || [0, 0];
    const vx = plane ? Math.trunc(plane.vramX) : 0,
      vy = plane ? Math.trunc(plane.vramY) : 0;
    const clip = plane ? [vx, vy, vx + plane.width, vy + plane.height] : [0, 0, width, height];
    const values = {
      image: object.nativeImageHandle,
      position: [f(vx + x), f(vy + y)],
      base: [object.baseX, object.baseY],
      rotation: f((object.rotation * Math.PI) / 180),
      scale: [object.scaleX, object.scaleY],
      alpha: object.alpha,
      visible: object.disp && !sleeping,
      mode: object.affineMode ?? 0,
      aux: 0,
    };
    const signature = JSON.stringify([values, clip, object.pri]);
    if (object.nativeDrawSignature === signature && draw.entry(key)) continue;
    object.nativeDrawSignature = signature;
    const entry = await draw.upsert(key, values);
    entry.clip = clip;
    entry.layer = object.pri;
    // Draw task offsets apply when the finished bitmap is copied to VRAM;
    // CPU entry coordinates remain local to the bitmap.
    if (offset.some((n) => !Number.isFinite(n)))
      throw new Error('Invalid FES retained drawing offset');
  }
}

export async function setFESBaseImage(graphics, instance, object) {
  const owner = instance.runtimeID,
    record = graphics.world.objects.objects.get(owner),
    player = instance.player;
  const surfaceID = [...graphics.fesSurfaces].find(
      ([, players]) => players.get(owner) === player,
    )?.[0],
    draw = surfaceID == null ? null : graphics.drawTasks.get(surfaceID);
  if (!draw?.state.renderer)
    throw new Error(`FES ${instance.name} baseimg requires its bound native drawing surface`);
  if (!object) {
    await draw.setBaseImage(0);
    return;
  }
  // The original command deliberately ignores non-image object classes.
  if (!['PLANE', 'CIMAGE', 'IMAGE', 'BUTTON', 'PANEL', 'SAVEPANEL', 'IMGWND'].includes(object.type))
    return;
  await syncFESGraphics(graphics, record, player);
  if (object.type === 'PLANE') {
    await draw.render();
    const x = Math.trunc(object.vramX),
      y = Math.trunc(object.vramY);
    await draw.setBaseImage(draw.state.renderer.bitmap, [
      x,
      y,
      x + object.width,
      y + object.height,
    ]);
  } else {
    if (!object.nativeImageHandle && ['PANEL', 'SAVEPANEL', 'IMGWND'].includes(object.type))
      throw new Error(
        `FES ${instance.name} baseimg ${object.key} requires its native bitmap resource adapter`,
      );
    await draw.setBaseImage(object.nativeImageHandle || 0);
  }
}

export async function closeFESGraphics(graphics, record, player) {
  for (const players of graphics.fesSurfaces.values()) players.delete(record.id);
  const effects = player?.root?.objects.some((object) => player.nativeEffects?.supports(object)),
    area = player?.root?.objects.some((object) => player.nativeArea?.supports(object)),
    particles = player?.root?.objects.filter((object) => player.nativeParticles?.supports(object));
  if (effects) await player.nativeEffects.closeOwner(player.root, { runDrivers: false });
  if (area) await player.nativeArea.closeOwner(player.root);
  for (const object of particles || []) await player.nativeParticles.close(player.root, object);
  if (effects || area || particles?.length)
    await (await graphics.world.getNativeFeature('fes-objects')).runResourceDrivers(player.root);
  const runtime = graphics.world.nativeEngine?.features.get('fes-objects'),
    order = new Map(runtime?.destructionOrder().map((pointer, i) => [pointer, i]) || []),
    objects = (player?.root?.objects || []).toSorted(
      (a, b) =>
        (order.get(a.nativeObjectPointer) ?? Infinity) -
        (order.get(b.nativeObjectPointer) ?? Infinity),
    );
  // A child destructor removes its link from the original parent's container.
  // Keep that container alive until every linked child has been released.
  for (const object of objects) {
    if (player.nativeText?.supports(object)) await player.nativeText.close(object);
    if (player.nativeLog?.supports(object)) await player.nativeLog.close(object);
    if (player.nativeM2?.supports(object)) await player.nativeM2.close(object);
    if (player.nativeControls?.supports(object)) await player.nativeControls.close(object);
    if (player.nativePlanes?.supports(object)) await player.nativePlanes.close(object);
    if (player.nativeImages?.supports(object)) await player.nativeImages.close(object);
    if (player.nativeData?.supports(object)) await player.nativeData.close(object);
    for (const draw of graphics.drawTasks.values()) await draw.remove(namespace(record.id, object));
    if (object.nativeImageHandle) {
      await graphics.images.release(object.nativeImageHandle);
      object.nativeImageHandle = null;
    }
  }
  await graphics.world.nativeEngine?.features
    .get('graphics-platform')
    ?.releaseOwnerImages(record.id);
}
