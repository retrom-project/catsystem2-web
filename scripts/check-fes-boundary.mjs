// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { actualSourceDependencies } from './check-no-exe-addresses.mjs';
import { reviewFESIndirect } from './fes-route-audit.mjs';

function nativePointerGuard(node) {
  if (
    node?.type === 'MemberExpression' &&
    node.object.name === 'context' &&
    (node.computed ? node.property.value : node.property.name) === 'nativePointer'
  )
    return true;
  return (
    node?.type === 'LogicalExpression' &&
    node.operator === '&&' &&
    (nativePointerGuard(node.left) || nativePointerGuard(node.right))
  );
}
export function validateFESSource(source, file) {
  if (Object.values(actualSourceDependencies(source, file)).some(Boolean))
    throw new Error('FES EXE dependency: ' + file);
  const forbidden = new Set([
    'call',
    'callAsync',
    'callFromHost',
    'invokeNative',
    'invokeRegion',
    'invokeOriginalNative',
    'emu_start',
    'runThread',
    'patch',
    'beforeInstruction',
    'ensureNativeEngine',
    'nativeEngine',
    'nativeObjectPointer',
    'registerNativeFeature',
  ]);
  const errors = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              fes: {
                create(context) {
                  const property = (node) =>
                    node.computed ? node.property.value : node.property.name;
                  return {
                    ImportDeclaration(node) {
                      if (
                        /(?:oracle\/|\/(?:engine-process|kcs-memory|transitional-exe|backend|exe-profiles)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        context.report({ node, message: 'FES imports an EXE capability' });
                    },
                    MemberExpression(node) {
                      if (forbidden.has(property(node)))
                        context.report({ node, message: 'FES references an EXE capability' });
                    },
                    Property(node) {
                      if (
                        node.parent.type === 'ObjectPattern' &&
                        forbidden.has(node.key.name ?? node.key.value)
                      )
                        context.report({ node, message: 'FES destructures an EXE capability' });
                    },
                    CallExpression(node) {
                      if (
                        node.callee.type !== 'MemberExpression' ||
                        property(node.callee) !== 'getNativeFeature'
                      )
                        return;
                      const feature = node.arguments[0]?.value;
                      let guarded = false;
                      for (let parent = node.parent; parent; parent = parent.parent)
                        if (
                          parent.type === 'IfStatement' &&
                          nativePointerGuard(parent.test) &&
                          parent.consequent.range[0] <= node.range[0] &&
                          parent.consequent.range[1] >= node.range[1]
                        )
                          guarded = true;
                      if (
                        !reviewFESIndirect(file, { method: 'getNativeFeature', feature }) ||
                        !guarded
                      )
                        context.report({
                          node,
                          message: 'FES constructs an implicit or unreviewed EXE feature',
                        });
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/fes': 'error' },
      },
    ],
    { filename: file },
  );
  if (errors.length) throw new Error('FES boundary: ' + file + ': ' + errors[0].message);
}
const FES_MODULES = Object.freeze([
  'src/cst-syntax.mjs',
  'src/effekseer/camera.mjs',
  'src/effekseer/crt-random.mjs',
  'src/effekseer/crt-threads.mjs',
  'src/effekseer/effect-loads.mjs',
  'src/effekseer/effect-reader.mjs',
  'src/effekseer/generation.mjs',
  'src/effekseer/instance-operations.mjs',
  'src/effekseer/instance-transform.mjs',
  'src/effekseer/manager-lifecycle.mjs',
  'src/effekseer/materials.mjs',
  'src/effekseer/math43.mjs',
  'src/effekseer/mesh-batch.mjs',
  'src/effekseer/mesh-packet.mjs',
  'src/effekseer/numerical.mjs',
  'src/effekseer/render-state.mjs',
  'src/effekseer/resources.mjs',
  'src/effekseer/ribbon-track-geometry.mjs',
  'src/effekseer/ring-current-state.mjs',
  'src/effekseer/shared-device-view.mjs',
  'src/effekseer/sprite-ring-geometry.mjs',
  'src/effekseer/standard-batch.mjs',
  'src/effekseer/task-gpu.mjs',
  'src/effekseer/task.mjs',
  'src/effekseer/texture-decoder.mjs',
  'src/effekseer/texture-level0.mjs',
  'src/effekseer/world.mjs',
  'src/formats/scene.mjs',
  'src/native/abi/fes-common-heads.mjs',
  'src/native/fes-bitmap.mjs',
  'src/native/fes-button-navigation.mjs',
  'src/native/fes-common-commands.mjs',
  'src/native/fes-common-model.mjs',
  'src/native/fes-config.mjs',
  'src/native/fes-control-driver.mjs',
  'src/native/fes-control-model.mjs',
  'src/native/fes-coordinator.mjs',
  'src/native/fes-data.mjs',
  'src/native/fes-definitions.mjs',
  'src/native/fes-dif-image.mjs',
  'src/native/fes-effect-driver.mjs',
  'src/native/fes-effect-model.mjs',
  'src/native/fes-effekseer-driver.mjs',
  'src/native/fes-file-list.mjs',
  'src/native/fes-fonts.mjs',
  'src/native/fes-graphics.mjs',
  'src/native/fes-image-cache.mjs',
  'src/native/fes-image-control-commands.mjs',
  'src/native/fes-image-driver.mjs',
  'src/native/fes-image-filename.mjs',
  'src/native/fes-image-model.mjs',
  'src/native/fes-image-table-model.mjs',
  'src/native/fes-input.mjs',
  'src/native/fes-log-driver.mjs',
  'src/native/fes-log-model.mjs',
  'src/native/fes-log-text-service.mjs',
  'src/native/fes-motion-driver.mjs',
  'src/native/fes-motion-model.mjs',
  'src/native/fes-motion.mjs',
  'src/native/fes-object-collection.mjs',
  'src/native/fes-object-factory.mjs',
  'src/native/fes-object-graph.mjs',
  'src/native/fes-panel-driver.mjs',
  'src/native/fes-panel-model.mjs',
  'src/native/fes-particle-driver.mjs',
  'src/native/fes-plane-driver.mjs',
  'src/native/fes-platform-frontends.mjs',
  'src/native/fes-resource-commands.mjs',
  'src/native/fes-resource-entries.mjs',
  'src/native/fes-shell-errors.mjs',
  'src/native/fes-sound-config.mjs',
  'src/native/fes-sound-table.mjs',
  'src/native/fes-sound.mjs',
  'src/native/fes-source.mjs',
  'src/native/fes-string-driver.mjs',
  'src/native/fes-string-table.mjs',
  'src/native/fes-system-voice.mjs',
  'src/native/fes-task.mjs',
  'src/native/fes-tone-table.mjs',
  'src/native/fes-window-image.mjs',
  'src/native/fes.mjs',
  'src/scene.mjs',
]);

export async function checkFESBoundary(root) {
  for (const file of FES_MODULES)
    validateFESSource(await readFile(resolve(root, file), 'utf8'), file);
  console.log('FES source boundary checked against actual ordinary modules.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkFESBoundary(fileURLToPath(new URL('..', import.meta.url)));
