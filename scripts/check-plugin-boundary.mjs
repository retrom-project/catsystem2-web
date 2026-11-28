// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { actualSourceDependencies } from './check-no-exe-addresses.mjs';
import { reviewRenderIndirect } from './render-route-audit.mjs';

export function validatePluginSource(source, file) {
  if (Object.values(actualSourceDependencies(source, file)).some(Boolean))
    throw new Error('Plugin EXE dependency: ' + file);
  const forbidden = new Set([
    'call',
    'callAsync',
    'callFromHost',
    'patch',
    'beforeInstruction',
    'invokeNative',
    'invokeRegion',
    'invokeOriginalNative',
    'loadModule',
    'loadExecutable',
    'emu_start',
    'runThread',
    'ensureNativeEngine',
  ]);
  const messages = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              plugin: {
                create(context) {
                  const report = (node, message) => context.report({ node, message }),
                    property = (n) => (n.computed ? n.property.value : n.property.name);
                  return {
                    ImportDeclaration(node) {
                      if (
                        /(?:oracle\/|\/(?:engine-process|kcs-memory|transitional-exe|backend|pe32|native-services|catalog)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        report(node, 'Plugin imports an execution capability');
                    },
                    ImportExpression(node) {
                      if (
                        typeof node.source.value !== 'string' ||
                        /(?:oracle\/|\/(?:backend|pe32|native-services)\.mjs$)/.test(
                          node.source.value,
                        )
                      )
                        report(node, 'Plugin dynamically imports an execution capability');
                    },
                    MemberExpression(node) {
                      if (
                        forbidden.has(property(node)) &&
                        (property(node) !== 'patch' ||
                          (node.parent.type === 'CallExpression' && node.parent.callee === node))
                      )
                        report(node, 'Plugin references ' + property(node));
                    },
                    Property(node) {
                      if (
                        node.parent.type === 'ObjectPattern' &&
                        forbidden.has(node.key.name ?? node.key.value)
                      )
                        report(node, 'Plugin destructures an execution capability');
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
                        report(node, 'Plugin constructs an unreviewed EXE consumer');
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/plugin': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(file + ': ' + messages[0].message);
}
export function validatePluginDistribution(files) {
  for (const file of files) {
    const name = typeof file === 'string' ? file : file.path;
    if (
      /(?:^|\/)(?:ppi-(?:dll-loader|native-original|runtime-original)|m2-.*-original)\.mjs$/.test(
        name,
      ) ||
      /^src\/ppi\/(?:native|native-runtime)\.mjs$/.test(name)
    )
      throw new Error('Distribution contains a plugin DLL execution path: ' + name);
  }
}
const PLUGIN_MODULES = Object.freeze([
  'src/emote/animation.mjs',
  'src/emote/bicubic-operations.mjs',
  'src/emote/controller-graph.mjs',
  'src/emote/controllers.mjs',
  'src/emote/document.mjs',
  'src/emote/draw-list.mjs',
  'src/emote/driver-identity.mjs',
  'src/emote/geometry-content.mjs',
  'src/emote/geometry.mjs',
  'src/emote/m2-actions.mjs',
  'src/emote/m2-blink.mjs',
  'src/emote/m2-controllers.mjs',
  'src/emote/m2-inertia.mjs',
  'src/emote/m2-lip-samples.mjs',
  'src/emote/m2-lip.mjs',
  'src/emote/m2-model.mjs',
  'src/emote/m2-render.mjs',
  'src/emote/m2-splines.mjs',
  'src/emote/m2-variables.mjs',
  'src/emote/materials.mjs',
  'src/emote/mesh.mjs',
  'src/emote/model.mjs',
  'src/emote/profiles.mjs',
  'src/emote/random.mjs',
  'src/emote/runtime.mjs',
  'src/emote/springs.mjs',
  'src/emote/timelines.mjs',
  'src/emote/wind.mjs',
  'src/native/emote-commands.mjs',
  'src/native/emote-fes.mjs',
  'src/native/emote-owner.mjs',
  'src/native/emote-task.mjs',
  'src/native/emote.mjs',
  'src/ppi/host.mjs',
  'src/ppi/js-runtime.mjs',
  'src/ppi/plugin-identity.mjs',
  'src/ppi/plugins/blur.mjs',
  'src/ppi/plugins/cmnptcl.mjs',
  'src/ppi/plugins/common.mjs',
  'src/ppi/plugins/dash.mjs',
  'src/ppi/plugins/emote-note.mjs',
  'src/ppi/plugins/emote-sweat.mjs',
  'src/ppi/plugins/emote-symbols.mjs',
  'src/ppi/plugins/filmnoise.mjs',
  'src/ppi/plugins/index.mjs',
  'src/ppi/plugins/rain.mjs',
  'src/ppi/plugins/spline.mjs',
  'src/ppi/plugins/steam.mjs',
  'src/ppi/records.mjs',
  'src/ppi/render-state.mjs',
  'src/ppi/verified-versions.mjs',
  'src/ppi/windows-multibyte.mjs',
  'src/render/emote-gl.mjs',
]);

export async function checkPluginBoundary(root) {
  for (const file of PLUGIN_MODULES)
    validatePluginSource(await readFile(resolve(root, file), 'utf8'), file);
  console.log('Plugin source boundary checked against actual ordinary modules.');
  const particle = await readFile(resolve(root, 'src/particles.mjs'), 'utf8');
  if (/NativePPI|nativeThread|unicornFactory/.test(particle))
    throw new Error('Particles retains a DLL sandbox dependency');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkPluginBoundary(fileURLToPath(new URL('..', import.meta.url)));
