// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { actualSourceDependencies } from './check-no-exe-addresses.mjs';
import { reviewRenderIndirect } from './render-route-audit.mjs';

export function validateRenderSource(source, file) {
  if (Object.values(actualSourceDependencies(source, file)).some(Boolean))
    throw new Error('Render EXE dependency: ' + file);
  const forbidden = new Set([
    'call',
    'callAsync',
    'callFromHost',
    'invokeNative',
    'invokeRegion',
    'invokeOriginalNative',
    'runThread',
    'emu_start',
    'patch',
    'beforeInstruction',
    'ensureNativeEngine',
  ]);
  const messages = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              render: {
                create(context) {
                  const report = (node, message) => context.report({ node, message });
                  const property = (node) =>
                    node.computed ? node.property.value : node.property.name;
                  return {
                    ImportDeclaration(node) {
                      if (
                        /(?:oracle\/|\/(?:engine-process|kcs-memory|transitional-exe|backend|exe-profiles)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        report(node, 'Render imports an EXE capability');
                    },
                    MemberExpression(node) {
                      if (forbidden.has(property(node)))
                        report(node, 'Render references an EXE capability');
                    },
                    Property(node) {
                      if (
                        node.parent.type === 'ObjectPattern' &&
                        forbidden.has(node.key.name ?? node.key.value)
                      )
                        report(node, 'Render destructures an EXE capability');
                    },
                    CallExpression(node) {
                      if (
                        node.callee.type !== 'MemberExpression' ||
                        property(node.callee) !== 'getNativeFeature'
                      )
                        return;
                      if (
                        !reviewRenderIndirect(file, {
                          method: 'getNativeFeature',
                          feature: node.arguments[0]?.value,
                        })
                      )
                        report(node, 'Render constructs an unreviewed consumer feature');
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/render': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(file + ': ' + messages[0].message);
}

const RENDER_MODULES = Object.freeze([
  'src/native/area-effect-commands.mjs',
  'src/native/area-effect-geometry.mjs',
  'src/native/area-effect-pixels.mjs',
  'src/native/area-effect.mjs',
  'src/native/cursor.mjs',
  'src/native/divided-model.mjs',
  'src/native/draw-commands.mjs',
  'src/native/draw-task.mjs',
  'src/native/effect-commands.mjs',
  'src/native/graphics-render.mjs',
  'src/native/graphics-task.mjs',
  'src/native/graphics.mjs',
  'src/native/mesh.mjs',
  'src/native/particle-bounds.mjs',
  'src/native/particle-commands.mjs',
  'src/native/particle-projection.mjs',
  'src/native/particle-textures.mjs',
  'src/native/particles.mjs',
  'src/native/plane-model-command.mjs',
  'src/native/plane-models.mjs',
  'src/native/raster-kernel.mjs',
  'src/native/render-sources.mjs',
  'src/native/retained-animation.mjs',
  'src/native/retained-draw.mjs',
  'src/native/screen-capture.mjs',
  'src/native/screen-effect-geometry.mjs',
  'src/native/screen-effect-pixels.mjs',
  'src/native/screen-effect-render.mjs',
  'src/native/screen-effect.mjs',
  'src/native/texture-layout.mjs',
  'src/native/view.mjs',
  'src/particles.mjs',
  'src/ppi/geometry.mjs',
  'src/ppi/script.mjs',
  'src/render/canvas.mjs',
  'src/render/gl-bindings.mjs',
  'src/render/native-geometry.mjs',
  'src/render/native-lines.mjs',
  'src/render/native-text.mjs',
  'src/render/native-textured-geometry.mjs',
  'src/render/particles-gl.mjs',
  'src/render/stage.mjs',
  'src/render/surfaces.mjs',
  'src/render/transition.mjs',
  'src/stage.mjs',
]);

export async function checkRenderBoundary(root) {
  for (const file of RENDER_MODULES)
    validateRenderSource(await readFile(resolve(root, file), 'utf8'), file);
  console.log('Render source boundary checked against actual ordinary modules.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkRenderBoundary(fileURLToPath(new URL('..', import.meta.url)));
