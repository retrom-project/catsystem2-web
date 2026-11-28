// SPDX-License-Identifier: MPL-2.0
// Only the explicitly injected backend constructs remaining DLL/FES consumers.
export class NativeRenderer {
  static open(engine, world) {
    return engine.createRendererProjection(world);
  }
}
