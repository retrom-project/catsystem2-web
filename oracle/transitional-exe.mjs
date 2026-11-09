// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../src/native/abi/index.mjs';
import { runNativeGameWinMainSpan } from '../src/native/engine-startup-block.mjs';
export async function invokeRegion(operation, { engine }) {
  if (engine.profile !== 'nekopara-vol3-engine-2.6.1.76' || operation !== 'startup.accelerators')
    throw new Error(`Unreviewed transitional region ${operation}`);
  return runNativeGameWinMainSpan(engine, 0x52cdcb, 0x52cfed, (stack, cpu, uc) => {
    engine.process.store(stack + 0x14, engine.module.base);
    cpu.reg_write_i32(uc.X86_REG_EAX, engine.refs.settings);
    cpu.reg_write_i32(uc.X86_REG_EBX, 0);
  });
}

// Temporary view state projection, removed with the phase-6 EXE renderer.
// JS owns every field. This adapter never reads a value back as authority.
export function syncViewGeometry({ engine, graphics }) {
  const p = engine.process,
    refs = engine.features.get('graphics-platform').refs,
    view = graphics.view,
    width = view.virtualWidth,
    height = view.virtualHeight;
  const displacement = nativeABI(engine.profile).configuration.memory.layout.authorMode - 12;
  view.windowShift.forEach((word, i) => p.store(engine.refs.owner + displacement + i * 4, word));
  p.store(refs.manager + 224, graphics.cameraNearWord);
  p.store(refs.view + 24, width);
  p.store(refs.view + 28, height);
  const storeFloat = (address, value) =>
    p.write(address, new Uint8Array(Float32Array.of(value).buffer));
  view.deviceOffset.forEach((value, i) => storeFloat(refs.manager + 228 + i * 4, value));
  storeFloat(refs.manager + 484, view.deviceScale);
  const ratios = view.ratios ?? [
    Math.fround(width / view.clientWidth),
    Math.fround(height / view.clientHeight),
  ];
  ratios.forEach((value, i) => storeFloat(refs.view + 68 + i * 4, value));
  view.drawingRectangle.forEach((word, i) => p.store(refs.manager + 500 + i * 4, word));
}
