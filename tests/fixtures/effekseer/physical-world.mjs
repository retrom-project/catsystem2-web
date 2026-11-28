// SPDX-License-Identifier: MPL-2.0
// Real default World/FES/factory/manager/resources with an explicit GL API
// boundary. No native engine, raster or pixel acceptance comes from this helper.
import { defaultFESWorld, loadDefaultFES } from '../default-fes-world.mjs';
import { files, PROFILE, step, task } from '../fes-effekseer-world.mjs';
import { glBindingRecorder } from '../gl-binding-recorder.mjs';
export async function openPhysicalWorld({ initialize = true, extra = {}, text } = {}) {
  const world = await defaultFESWorld(PROFILE, { ...files(text), ...extra }, { initialize: false }),
    api = glBindingRecorder(),
    original = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class extends EventTarget {
    constructor(width, height) {
      super();
      this.width = width;
      this.height = height;
    }
    getContext(type) {
      return type === 'webgl2' ? api.gl : {};
    }
  };
  try {
    world.stageRenderer.attach({ canvas: { width: 64, height: 48 } });
  } finally {
    if (original === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = original;
  }
  if (!initialize) return { world, api, gpu: world.stageRenderer.gpu };
  try {
    await world.initialize('case.kcs');
    const h = { world, ...(await loadDefaultFES(world)), api, gpu: world.stageRenderer.gpu };
    await step(h);
    await world.tick();
    await world.tick();
    return { ...h, effectTask: task(h) };
  } catch (error) {
    await world.close({ flushFiles: false });
    throw error;
  }
}
export const ages = (manager) => [...manager.instances.values()].map((i) => [i.id, i.age]);
