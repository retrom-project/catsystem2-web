// SPDX-License-Identifier: MPL-2.0
// Borrowed submission view; Task remains the sole CPU batch/Ring owner.
import { EffekseerDeviceScope } from './materials.mjs';
import { EffekseerSharedDeviceView } from './shared-device-view.mjs';
export class EffekseerTaskGPU {
  constructor(task, stage, gpu) {
    this.task = task;
    this.stage = stage;
    this.gpu = gpu;
    this.viewport = new Float32Array(6);
    this.device = new EffekseerSharedDeviceView({
      context: task.world.graphics.d3dContext,
      gpu,
      viewport: () => this.viewport,
    });
    this.scope = new EffekseerDeviceScope(this.device);
  }
  getViewport() {
    return this.viewport;
  }
  bindNormalPipeline() {
    this.scope.bindNormalPipeline();
  }
  draw() {
    const { gpu, task } = this;
    this.scope.assertEntry();
    const viewport = gpu.gl.getParameter(gpu.gl.VIEWPORT),
      depth = gpu.gl.getParameter(gpu.gl.DEPTH_RANGE);
    this.viewport.set(viewport);
    this.viewport.set(depth, 4);
    return task.meshBatch.draw(task.manager, {
      hasCurrentEffect: task.currentEffect !== null,
      depthStencilEnabled: task.world.graphics.d3dContext.depthStencilEnabled,
      backend: this,
    });
  }
  close() {
    this.scope.close();
  }
}
