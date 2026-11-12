// SPDX-License-Identifier: MPL-2.0
// Offline inventory. Only constructors/registration and guarded fallback probes
// run here. No engine, DLL, resource, task or browser is opened.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { nativeTestGroups } from './test-native.mjs';
import { TRANSITIONAL_HEAP_POLICY } from '../oracle/transitional-heap.mjs';
import { NATIVE_IMAGE_OWNER_JS_IDS } from '../src/native/image-owner.mjs';
import { reviewedRenderRoute, reviewRenderIndirect } from './render-route-audit.mjs';
import { reviewedFESRoute, reviewFESIndirect } from './fes-route-audit.mjs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { format, resolveConfig } from 'prettier';
import {
  IMAGE_RANGES,
  scanRuntime,
  compareBaseline,
  transitionalRuntimeFiles,
} from './check-no-exe-addresses.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'docs/b-migration.json');
const linter = new Linter();
const zero = () => ({ addresses: 0, calls: 0, references: 0 });
const hash = (text) => createHash('sha256').update(text).digest('hex');
const unique = (items) => [...new Set(items)].sort();
const basename = (file) =>
  file
    .split('/')
    .at(-1)
    .replace(/\.mjs$/, '');

function ast(source, file) {
  let tree;
  const messages = linter.verify(
    source,
    [
      {
        plugins: {
          inventory: {
            rules: {
              parse: {
                create() {
                  return {
                    Program(node) {
                      tree = node;
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'inventory/parse': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(`${file}: ${messages[0].message}`);
  return tree;
}

function walk(node, visit) {
  if (!node?.type) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['parent', 'tokens', 'comments'].includes(key)) continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value?.type) walk(value, visit);
  }
}

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await filesBelow(file)));
    else if (entry.isFile() && file.endsWith('.mjs')) result.push(file);
    else throw new Error(`Unclassified runtime input ${file}`);
  }
  return result.sort();
}

// These are migration ownership decisions, independent of EXE address counts.
// Infrastructure is assigned to phase 8, with its cross-cutting role recorded.
const domains = {
  3: '纯计算',
  4: '数据与容器',
  5: '图像、编解码与文本',
  6: '绘制与渲染',
  7: 'FES/CST 对象与控件',
  8: '启动、平台、输入、音视频',
  9: '插件边界',
};
const ownedModules = {
  3: 'arguments calendar cp932 cp932-data utf8-codec calculation-math calculation-memory geometry matrix rectangles scalar-math view-geometry random-memory utf8 unicode-output standard',
  4: 'mission-table question-table record-sort selection-table compiled-table data-text buffer-memory image-buffer-info bank character-names comma-fields configuration-query content-databases database data-buffer dictionary gallery gallery-tables heap-data history-cursor nametable ordered-map persistence record-stack record-queue resource-cache resource-search resource-selection resources save-slots scene-checkpoint scene-data scene-history scene-memory section-table sparse-bytes storage string-bank motion-persistence script-xml tile-game tile-model tile-hands tile-actions tile-round tile-special',
  5: 'data-buffer-projection bitmap-memory bitmap-factory bitmap-operations image-owner image-composite image-file image-commands image image-owner-pixels image-owner-load bitmap-pixels image-affine image-persistence hg3-delta text text-log text-scanner text-legacy text-plain text-task text-windows text-core text-config text-layout text-parser text-profile-data text-raster legacy-text-state font-backend freetype-artifact fes-text fes-text-layout zlib zlib-artifact deflate',
  6: 'area-effect area-effect-geometry area-effect-pixels area-effect-commands cursor divided-model draw-commands draw-task retained-animation effect-commands graphics graphics-process graphics-render graphics-task mesh particle-bounds particle-commands particle-projection particle-textures particles plane-model-command plane-models raster-kernel renderer render-sources retained-draw screen-capture screen-effect screen-effect-render screen-effect-geometry screen-effect-pixels texture-layout texture-memory view',
};
function domain(file) {
  if (file.startsWith('src/effekseer/')) return 7;
  if (file === 'oracle/fes-screen-effect-projection.mjs') return 7;
  if (file === 'oracle/graphics-consumer-projection.mjs') return 8;
  if (file === 'oracle/renderer-consumer-projection.mjs') return 8;
  if (file === 'oracle/plane-movie-projection.mjs') return 8;
  if (file === 'oracle/text-consumer-view.mjs') return 8;
  if (file === 'oracle/area-geometry-projection.mjs') return 6;
  const name = basename(file);
  if (
    ['pe32', 'native-services', 'backend', 'backend-artifact'].includes(name) &&
    file.startsWith('src/ppi/')
  )
    return 8;
  if (file === 'src/native/xml.mjs') return 4;
  if (['src/native/data-buffer-projection.mjs', 'oracle/data-buffer-projection.mjs'].includes(file))
    return 8;
  if (['oracle/bitmap-memory.mjs', 'oracle/bitmap-projection.mjs'].includes(file)) return 8;
  if (['src/emote/native-d3d.mjs', 'src/emote/native-adapter.mjs'].includes(file)) return 8;
  if (
    file.startsWith('src/emote/') ||
    file === 'oracle/plugin-frames.mjs' ||
    name.startsWith('emote') ||
    (file.startsWith('src/ppi/') &&
      ![
        'script',
        'abi',
        'contracts',
        'geometry',
        'numeric',
        'random',
        'x87',
        'floating-point',
        'native-projection-math',
      ].includes(name))
  )
    return 9;
  if (file.startsWith('src/ppi/')) return name === 'script' || name === 'geometry' ? 6 : 3;
  for (const [phase, names] of Object.entries(ownedModules))
    if (names.split(' ').includes(name)) return Number(phase);
  if (name.startsWith('fes') || name.startsWith('cst') || name === 'scene') return 7;
  if (file.startsWith('src/motion/')) return 3;
  if (file.startsWith('src/formats/') || ['font', 'xml', 'raster', 'psd'].includes(name)) return 5;
  if (file.startsWith('src/render/') || ['stage', 'layer'].includes(name)) return 6;
  if (['saves', 'gallery'].includes(name)) return 4;
  return 8;
}

const originalWrappers = new Set(
  (
    'input-commands registry ' +
    'task-dump tile-plane-command ' +
    'plane-movie-command ' +
    'version-query sdk-javascript-task'
  ).split(' '),
);
const reviewedRegions = new Map();
const messageModules = new Set(
  'task task-command fes graphics draw-task mesh image input input-control movie sound particles script-task'.split(
    ' ',
  ),
);

function property(node) {
  if (node?.type !== 'MemberExpression') return null;
  return node.computed ? node.property.value : node.property.name;
}

function featureNames(node) {
  const names = [];
  walk(node, (item) => {
    if (
      item.type === 'CallExpression' &&
      property(item.callee) === 'getNativeFeature' &&
      typeof item.arguments[0]?.value === 'string'
    )
      names.push(item.arguments[0].value);
  });
  return unique(names);
}

function moduleFacts(file, source) {
  const tree = ast(source, file),
    imports = new Map(),
    functions = [],
    executionSites = [],
    indirectSites = [];
  for (const node of tree.body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
    const dependency = relative(root, resolve(root, dirname(file), node.source.value));
    for (const spec of node.specifiers) imports.set(spec.local.name, dependency);
  }
  walk(tree, (node) => {
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    )
      functions.push(node);
    if (node.type !== 'CallExpression') return;
    const name = property(node.callee);
    if (['getNativeFeature', 'ensureNativeEngine', 'sendNativeEngine', 'sendEngine'].includes(name))
      indirectSites.push({
        line: node.loc.start.line,
        method: name,
        feature: name === 'getNativeFeature' ? (node.arguments[0]?.value ?? null) : null,
        review: 'needs-review',
        reason: '间接进入共享进程 feature 或任务接收器，目标及输入决定 EXE 依赖。',
      });
    const directCodeWrite =
      basename(file) === 'task-dump' &&
      name === 'store' &&
      node.arguments[0]?.type === 'BinaryExpression' &&
      node.arguments[0].left.name === 'site' &&
      node.arguments[0].right.value === 1;
    const computed =
      node.callee.type === 'MemberExpression' &&
      node.callee.computed &&
      node.callee.property.type !== 'Literal';
    if (
      ![
        'call',
        'callAsync',
        'callFromHost',
        'patch',
        'beforeInstruction',
        'emu_start',
        'runThread',
        'invokeNative',
        'invokeRegion',
      ].includes(name) &&
      !(computed && /['"]call(?:FromHost)?['"]/.test(source.slice(...node.callee.range))) &&
      !directCodeWrite
    )
      return;
    const method = directCodeWrite ? 'direct-code-write' : (name ?? 'computed-call');
    const literalTarget = node.arguments[0]?.value;
    const knownExeTarget =
      file.startsWith('src/native/') &&
      typeof literalTarget === 'number' &&
      IMAGE_RANGES.some(({ start, end }) => literalTarget >= start && literalTarget < end);
    executionSites.push({
      line: node.loc.start.line,
      method,
      target: source
        .slice(...(node.arguments[0]?.range ?? [node.range[0], node.range[0]]))
        .slice(0, 240),
      review: knownExeTarget || directCodeWrite ? 'traced' : 'needs-review',
      reason: knownExeTarget
        ? '直接使用原 EXE image 范围内的目标。'
        : directCodeWrite
          ? 'SDK task dump 将已核验的 EXE send call rel32 改写为宿主 trap。'
          : '目标可能来自布局、vtable、回调或 DLL。需在迁移该调用点时核对目标来源和具体分支。',
    });
  });
  return { file, source, tree, imports, functions, executionSites, indirectSites };
}

// Instrument the actual fallback call expressions in memory. The loaded runtime
// retains its registration, reserved/zero priority, service guards and order.
let probeTrace = [];
const probeKey = '__catsystem2BMigrationProbe';
function instrumentRuntime(facts) {
  const edits = [];
  walk(facts.tree, (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return;
    const name = node.callee.name;
    if (!/^native[A-Z]/.test(name) || ['nativeReply', 'nativeCatalog'].includes(name)) return;
    edits.push([node.range[0], `globalThis.${probeKey}('${name}', () => `], [node.range[1], ')']);
  });
  let source = facts.source;
  for (const [offset, text] of edits.sort(([a], [b]) => b - a))
    source = source.slice(0, offset) + text + source.slice(offset);
  return source;
}

function functionLocation(fn, modules) {
  const text = fn.toString();
  const matches = [];
  for (const facts of modules.values()) {
    for (const node of facts.functions) {
      if (facts.source.slice(...node.range) === text)
        matches.push({ file: facts.file, line: node.loc.start.line, node });
    }
  }
  if (matches.length !== 1)
    throw new Error(`Ambiguous registration (${matches.length} matches): ${text}`);
  return matches[0];
}

function calledModules(location, modules) {
  const result = [];
  const facts = modules.get(location.file);
  walk(location.node, (node) => {
    if (!['CallExpression', 'NewExpression'].includes(node.type)) return;
    let callee = node.callee;
    while (callee?.type === 'MemberExpression') callee = callee.object;
    const target = callee?.type === 'Identifier' ? facts.imports.get(callee.name) : null;
    if (target?.startsWith('src/native/') || target?.startsWith('oracle/')) result.push(target);
  });
  return unique(result);
}

async function registrationWorld(profile, mounted, api) {
  const game = {
    width: 640,
    height: 480,
    index: new Map(),
    names: (extension) => (mounted && extension === 'exe' ? ['inventory.exe'] : []),
    read: async () => null,
  };
  const random = new api.ParticleRandom();
  const world = new api.NativeWorld({
    profile,
    game,
    random,
    host: {},
    images: {},
    configuration: new api.NativeConfiguration({ profile }),
    storage: {
      read: async () => null,
      write: () => {
        throw new Error('Inventory forbids writes');
      },
    },
    motionLibrary: new api.MotionLibrary(game, { profile, random }),
  });
  world.ensureNativeEngine = () => {
    throw new Error('Inventory forbids EXE execution');
  };
  world.getNativeFeature = () => {
    throw new Error('Inventory forbids feature construction');
  };
  return world;
}

function resolveFeatures(names, features, modules, visited = new Set()) {
  const files = [];
  for (const name of names) {
    if (visited.has(name)) continue;
    visited.add(name);
    const location = features.get(name);
    if (!location) continue;
    const implementations = calledModules(location, modules);
    files.push(location.file, ...implementations);
    const dependencies = unique([
      ...featureNames(location.node),
      ...implementations.flatMap((file) => featureNames(modules.get(file).tree)),
    ]);
    files.push(...resolveFeatures(dependencies, features, modules, visited));
  }
  return unique(files);
}

function classify(file, id, callback, features, modules) {
  const name = basename(file);
  const ownerTransition = name === 'image-owner' && !NATIVE_IMAGE_OWNER_JS_IDS.includes(id);
  const capturedGraph =
    name === 'effect-commands' &&
    [0x238, 0x35b].includes(id) &&
    modules.get('src/native/graphics-render.mjs')?.executionSites.length;
  const areaUpload =
    name === 'area-effect-commands' &&
    [0xc6, 0xcb].includes(id) &&
    modules.get('src/native/graphics-process.mjs')?.executionSites.length;
  const planeModelReceiver =
    name === 'plane-model-command' &&
    modules.get('src/native/graphics-task.mjs')?.executionSites.length;
  let names = callback ? featureNames(callback.node) : [];
  // Follow a callback's direct function delegation before following factories.
  // Scanning every function in its installer would, for example, attach the
  // formatted-output VM bridge to the unrelated pure-JS file.open fallback.
  if (callback)
    walk(callback.node, (node) => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return;
      const delegated = modules.get(file).functions.find((fn) => fn.id?.name === node.callee.name);
      if (delegated) names.push(...featureNames(delegated));
    });
  for (const [feature, factory] of features)
    if (calledModules(factory, modules).includes(file)) names.push(feature);
  names = unique(names);
  const reasons = [];
  let implementation;
  if (name === 'storage' || name === 'heap-data') {
    implementation = 'pure-js';
  } else if (name === 'image-owner') {
    implementation = ownerTransition ? 'original-handler' : 'pure-js';
    if (ownerTransition) {
      names.push('image-owner-projection');
      reasons.push(
        'JS持有逻辑句柄、所有层位图和像素操作。文件/ANM装载仍通过显式输入导入边界，阶段5.3删除。',
      );
    }
  } else if (capturedGraph) {
    implementation = 'exe-region';
    reasons.push(
      'JS捕获调用仍进入graphics-render的原GraphManager遍历，随6.6删除。效果本身与目标像素由JS持有。',
    );
  } else if (areaUpload || planeModelReceiver) {
    implementation = 'exe-region';
    reasons.push(
      areaUpload
        ? 'JS区域效果的结束上传仍经过原纹理页上传，随6.6删除。'
        : '包装器已迁移JS，Plane接收器仍执行EXE，随6.6删除。',
    );
    names.push(areaUpload ? 'graphics-platform' : 'task-memory');
  } else if (originalWrappers.has(name)) {
    implementation = 'original-handler';
  } else if (reviewedRegions.has(name)) {
    implementation = 'exe-region';
    names = unique([...names, ...reviewedRegions.get(name)]);
  } else if (reviewedRenderRoute(file, id)) {
    if (modules.get(file).executionSites.length)
      throw new Error('Reviewed render wrapper gained an execution site: ' + file);
    implementation = 'pure-js';
  } else if (reviewedFESRoute(file, id)) {
    if (modules.get(file).executionSites.length)
      throw new Error('Reviewed FES wrapper gained an execution site: ' + file);
    implementation = 'pure-js';
  } else if (messageModules.has(name)) {
    implementation = 'unknown';
    reasons.push(
      'JS 封装经任务消息、图像服务或对象生命周期分派。目标类型/EXE 挂载状态决定是否执行原接收器，不能把整个 ID 判为 pure-js。',
    );
  } else if (name === 'window-commands' || (name === 'world' && id === 0x41e)) {
    implementation = 'pure-js';
    reasons.push('本体只投递窗口消息，消息泵/WndProc 的后续 EXE 行为另列于非 native 入口。');
  } else if (name === 'script-message-box') implementation = 'exe-region';
  else if (name === 'image-persistence') {
    implementation = 'pure-js';
  } else {
    const facts = modules.get(file);
    implementation = facts.executionSites.length ? 'unknown' : 'pure-js';
    if (implementation === 'unknown')
      reasons.push('模块含执行入口，尚需逐输入确认该 ID 到调用点的可达性。');
  }
  if (implementation === 'pure-js' && name === 'standard' && [0x21, 0x22].includes(id)) {
    names = unique([...names, 'random-memory']);
    reasons.push('本体为 JS，随机流可能由 random-memory 绑定到 EXE 数据页，PE 状态依赖单列。');
  }
  if (
    implementation === 'original-handler' &&
    !modules.get(file).executionSites.length &&
    !ownerTransition
  ) {
    implementation = 'unknown';
    reasons.push('已审查的原处理器模块已无执行站点，需更新本脚本的路由分类。');
  }
  return {
    implementation,
    names,
    dependencies: unique([
      ...resolveFeatures(names, features, modules),
      ...(ownerTransition ? ['oracle/image-owner.mjs', 'oracle/image-owner-projection.mjs'] : []),
      ...(capturedGraph
        ? ['src/native/graphics-render.mjs', 'src/native/screen-effect-render.mjs']
        : []),
    ]),
    reasons,
  };
}

function documentation(files, docs) {
  const result = [];
  for (const [file, text] of docs)
    if (files.some((source) => text.includes(`../${source}`))) result.push(file);
  return unique(result.length ? result : ['docs/native-compatibility.md']);
}

async function nativeEntries(profile, world, unmounted, api, modules, docs) {
  const features = new Map(
    [...world.nativeFeatureFactories].map(([name, fn]) => [name, functionLocation(fn, modules)]),
  );
  const entries = [];
  for (const [table, declaration] of Object.entries(api.NATIVE_ABIS[profile].tables)) {
    for (const entry of api.nativeCatalog(profile, table)) {
      const reasons = [],
        reviewEvidence = [];
      let implementation,
        location,
        implementationFile,
        dependencies = [],
        route,
        names = [];
      if (table !== 'main') {
        implementationFile = table === 'generic' ? 'src/motion/instance.mjs' : 'src/ppi/script.mjs';
        const facts = modules.get(implementationFile);
        location = facts.tree.body
          .find(
            (node) =>
              node.type === 'ExportNamedDeclaration' &&
              node.declaration?.type === 'ClassDeclaration',
          )
          .declaration.body.body.find((node) => node.key.name === 'native');
        location = { file: implementationFile, line: location.loc.start.line };
        implementation = 'pure-js';
        route = table === 'generic' ? 'MotionInstance.native' : 'ParticleScriptInstance.native';
      } else if (['reserved', 'constant-zero'].includes(entry.status)) {
        implementation = entry.status;
        implementationFile = 'src/native/runtime.mjs';
        route = 'NativeRuntime.dispatchNative/status';
      } else {
        const handler = world.runtime.handlers.get(`main:${entry.id}`);
        if (handler) {
          location = functionLocation(handler, modules);
          const called = calledModules(location, modules).filter(
            (file) => !['runtime', 'world'].includes(basename(file)),
          );
          implementationFile =
            called.find((file) => basename(file).startsWith('input')) ?? called[0] ?? location.file;
          // Feature callbacks live in their installer module. A formatter or
          // reply import is not the implementation of an inline handler.
          if (featureNames(location.node).length) implementationFile = location.file;
          if (basename(implementationFile) === 'image') {
            implementationFile = `src/native/${entry.id === 0x7a ? 'bitmap-operations' : 'bitmap-factory'}.mjs`;
          }
          route = 'NativeWorld/registered-handler';
          const classification = classify(
            implementationFile,
            entry.id,
            location,
            features,
            modules,
          );
          ({ implementation, dependencies, names } = classification);
          reasons.push(...classification.reasons);
          const alternate = unmounted.runtime.handlers.get(`main:${entry.id}`);
          if (!alternate || alternate.toString() !== handler.toString())
            reasons.push('EXE 挂载与未挂载的注册结果不同，本记录以正常挂载路径为准。');
        } else {
          probeTrace = [];
          try {
            await world.runtime.native(
              'main',
              entry.id,
              [],
              {},
              { id: 1, name: 'inventory', context: {} },
              world.runtime.scheduler,
            );
          } catch (error) {
            if (!probeTrace.length) throw error;
          }
          const claimed = probeTrace.find((probe) => probe.claimed);
          if (claimed) {
            implementationFile = modules.get('src/native/runtime.mjs').imports.get(claimed.name);
            const facts = modules.get(implementationFile);
            const node = facts.functions.find((node) => node.id?.name === claimed.name);
            location = { file: implementationFile, line: node.loc.start.line, node };
            route = `NativeRuntime/fallback/${claimed.name}`;
            const classification = classify(
              implementationFile,
              entry.id,
              location,
              features,
              modules,
            );
            ({ implementation, dependencies, names } = classification);
            reasons.push(...classification.reasons);
          } else {
            implementation = entry.status === 'unknown' ? 'unknown' : 'unsupported';
            implementationFile = 'src/native/runtime.mjs';
            route = 'NativeRuntime/UnsupportedKCSNative';
            reasons.push('正常 World 无注册处理器，实际 fallback 链全部返回 undefined。');
          }
        }
      }
      if (declaration.entries[entry.id].signature?.reviewReason)
        reasons.push(declaration.entries[entry.id].signature.reviewReason);
      if (table === 'main' && entry.name === 'matrix.rotateXYZ')
        reasons.push(
          '正常角度已差分验证；|角度|>=2^63 时 FSINCOS 的空栈 pop 可读取原 oracle 已弹出的跨调用寄存器残值。JS 采用新进程规范 FP 状态的零残值；该超范围历史影响未复现。',
        );
      const renderRoute = table === 'main' && reviewedRenderRoute(implementationFile, entry.id);
      const fesRoute = table === 'main' && reviewedFESRoute(implementationFile, entry.id);
      const semanticName = renderRoute?.semanticName ?? entry.name;
      if (!semanticName && !fesRoute)
        reasons.push('catalog 未恢复该 ABI/ID 的语义名，不借用另一版本的同号语义。');
      if (renderRoute)
        reviewEvidence.push(
          '6.7 independently traced the installed wrapper, JS receiver and foreign consumer branches; catalog labels are preserved separately when corrected.',
        );
      if (fesRoute)
        reviewEvidence.push(
          'Stage7 traces each installed FES wrapper, canonical packet and default JS receiver; the registered raw SDK/game message difference remains in ABI data. This route review does not fill unknown structured signature metadata or claim every interpreter command is supported.',
        );
      if (
        (table === 'generic' && [39, 40].includes(entry.id)) ||
        (table.startsWith('particle-') && [33, 34].includes(entry.id))
      ) {
        dependencies = unique([...dependencies, 'src/native/random-memory.mjs']);
        (table.startsWith('particle-') ? reviewEvidence : reasons).push(
          'JS 随机数使用共享 ParticleRandom，World 可将随机状态绑定到原 EXE RAM。已登记的 phase-10 数据页投影，不执行原随机数处理器。',
        );
      }
      const phase =
        table === 'generic'
          ? 3
          : table.startsWith('particle-')
            ? 6
            : ['reserved', 'constant-zero'].includes(implementation)
              ? 8
              : route === 'NativeRuntime/UnsupportedKCSNative'
                ? entry.name?.startsWith('namePairs.')
                  ? 4
                  : null
                : domain(implementationFile);
      const reviewedUnsupported =
        implementation === 'unsupported' &&
        entry.migrationReview?.phase === 4 &&
        entry.migrationReview?.decision === 'retain-unsupported';
      entries.push({
        table,
        id: entry.id,
        hexID: `0x${entry.id.toString(16)}`,
        semanticName,
        ...(renderRoute ? { catalogSemanticName: entry.name, renderRoute } : {}),
        ...(fesRoute
          ? {
              fesRoute,
              ...(!semanticName
                ? {
                    metadataNotes: [
                      'This frozen catalog has no semantic name; the descriptive route label is separate and the ABI signature metadata remains unchanged.',
                    ],
                  }
                : {}),
            }
          : {}),
        catalogStatus: entry.status,
        implementation,
        module: implementationFile,
        domain: phase,
        route,
        registration: location ? `${location.file}:${location.line}` : null,
        features: names,
        dependencies,
        docs: documentation(unique([implementationFile, ...dependencies]), docs),
        review: reasons.length && !reviewedUnsupported ? 'needs-review' : 'traced',
        reviewReasons: reviewedUnsupported ? [] : reasons,
        ...(reviewEvidence.length ? { reviewEvidence } : {}),
        ...(entry.migrationReview ? { migrationReview: entry.migrationReview } : {}),
      });
    }
    if (entries.filter((entry) => entry.table === table).length !== declaration.count)
      throw new Error(`Missing native slots ${profile}/${table}`);
  }
  return {
    entries,
    features: [...features].map(([name, location]) => ({
      name,
      registration: `${location.file}:${location.line}`,
      modules: calledModules(location, modules),
      dependencies: featureNames(location.node),
    })),
  };
}

const nonNativeGroups = [
  {
    name: 'js-graphics-to-remaining-consumers',
    domain: 8,
    entry:
      'Explicit SDK JavaScript task transport and media consumers borrow JS view/device records',
    files: ['oracle/graphics-consumer-projection.mjs', 'oracle/renderer-consumer-projection.mjs'],
    modules: [],
    projection: {
      direction:
        'JS view/matrix/draw state into PE consumer records; explicit bitmap copies import at consumer boundaries',
      authority: 'StageRenderer surfaces, JS Plane models, texture pages and frame scheduling',
      fields: [
        'view and device identity',
        'manager matrix/shift',
        'draw/blend cache',
        'configured sampler words',
        'borrowed bitmap metadata/bytes',
        'consumer graph identity',
      ],
      consumers: [{ domain: 8, modules: ['sdk-javascript-task', 'directshow'], removePhase: 8 }],
      lifetime:
        'No EXE graph traversal or graphics worker. Consumer view/device construction remains lazy and owns only the registered PE records. The former area callback bridge is oracle-only.',
      removePhase: 8,
      operations: ['sync', 'pull', 'bitmap', 'initialize', 'snapshot', 'restore', 'close'],
    },
  },
  {
    name: 'plane-movie-decoded-texture-projection',
    domain: 8,
    entry: 'Plane movie messages 43/44 → original D8 decoder → JS geometry and texture submission',
    modules: [],
    files: ['oracle/plane-movie-projection.mjs'],
    projection: {
      direction:
        'PE decoder-owned D3D texture/COM identity into a borrowed StageRenderer texture source',
      authority:
        'JS Plane geometry, transforms, visibility, sort order and rendering; decoder owns media/COM state',
      fields: [
        'movie object identity',
        'VMR allocator or Texture Renderer texture',
        'decoded width/height',
        'GPU frame revision',
      ],
      consumers: [{ domain: 8, modules: ['directshow', 'vmr9', 'texture-movie-renderer'] }],
      lifetime:
        'Accepted D8 exception. No original Plane draw or GraphManager traversal runs. Release closes only the original media source; current checkpoints restore its registered identity.',
      removePhase: 8,
      operations: ['load', 'frame', 'release', 'snapshot', 'restore', 'close'],
    },
  },
  {
    name: 'renderer-surfaces-to-foreign-locks',
    domain: 8,
    entry: 'StageRenderer.surfaces → D3D LockRect/UnlockRect → remaining media/SDK consumers',
    modules: ['native-d3d', 'renderer', 'texture-memory'],
    projection: {
      direction: 'JS-to-PE on lock; explicit PE-to-JS commit on writable unlock',
      authority: 'StageRenderer.surfaces packed bytes; GPU targets are derived render resources',
      fields: ['surface identity', 'pitch', 'format', 'lock bytes', 'D3D resource handles'],
      consumers: [{ domain: 8, modules: ['vmr9', 'texture-movie-renderer'], removePhase: 8 }],
      lifetime:
        'Guest virtual regions contain temporary media-accessible pixel projections. Renderer snapshots preserve JS bytes once; locked surfaces reject checkpoints. Original D6 consumers were removed in phase 6 and D7 captures now use JS surfaces directly.',
      removePhase: 8,
      operations: [
        'LockRect',
        'UnlockRect',
        'UpdateSurface',
        'StretchRect',
        'readback',
        'snapshot',
      ],
    },
  },
  {
    name: 'temporary-x86-heap-capacity',
    domain: 9,
    entry: 'Explicit transitionalExe.open selects capacity from the ABI emoteDriver capability',
    modules: ['transitional-heap'],
    configuration: TRANSITIONAL_HEAP_POLICY,
    review: 'counted',
    reason:
      'Historical original M2 native 0x38a exhausted the guest heap with textures/models. Product M2 is JS from 9.4 and no longer uses this capacity. The accepted x86-only configuration is retained until phase 10; live heap measurements remain separate from JS ownership checks.',
  },
  {
    name: 'process-bootstrap',
    domain: 8,
    entry: 'NativeWorld.ensureNativeEngine → NativeEngineProcess.open/initializeOwner/releaseOwner',
    modules: [
      'engine-process',
      'engine-system-information',
      'engine-cpu-survey',
      'engine-executable-resources',
      'engine-file-server',
      'engine-language',
      'engine-preferences',
      'engine-desktop',
    ],
  },
  {
    name: 'winmain-regions',
    domain: 8,
    entry: 'NativeWorld.initialize → initializeNativeStartup*/initializeNativeApplicationWindow',
    modules: [
      'engine-startup-application',
      'engine-startup-block',
      'engine-startup-window',
      'engine-startup-menu',
      'engine-startup-accelerators',
      'transitional-exe',
      'engine-startup-instance',
      'engine-startup-sound',
      'engine-window-class',
      'engine-configuration-event',
    ],
  },
  {
    name: 'window-message-loop',
    domain: 8,
    entry: 'NativeWorld.processWindowMessages/NativeWindow → runNativeWindowPump/WndProc',
    modules: [
      'engine-window-pump',
      'window',
      'window-events',
      'input-browser',
      'input-device',
      'windows-messages',
      'windows-thread-handles',
      'engine-message',
    ],
  },
  {
    name: 'default-fes-and-text-lifecycle',
    domain: 7,
    entry:
      'Default World kind34 → FESCoordinator → typed collection, MOT, resource FIFO and JS family services',
    modules: [
      'fes-task',
      'fes-coordinator',
      'fes-object-collection',
      'fes-resource-entries',
      'fes-definitions',
      'fes-common-commands',
      'fes-image-control-commands',
      'fes-image-driver',
      'fes-plane-driver',
      'fes-control-driver',
      'fes-string-driver',
      'fes-log-driver',
      'fes-effect-driver',
      'fes-particle-driver',
      'emote-fes',
      'fes-data',
    ],
    review: 'traced',
    reason:
      'The ordinary factory, service routing and fresh restore do not request an EXE feature. Explicit Windows/SDK/media consumers remain separately counted; kind61/EFK is an unfinished subsystem.',
  },
  {
    name: 'vm-and-shared-state-bridges',
    domain: 8,
    entry: 'NativeTaskMemory/NativeSceneMemory and engine feature beforeCall/afterCall',
    modules: [
      'task-memory',
      'scene-memory',
      'kcs-memory',
      'config-memory',
      'global-strings-bridge',
      'script-replacements-bridge',
      'random-memory',
      'engine-files',
    ],
  },
  {
    name: 'js-image-data-to-exe-consumers',
    domain: 8,
    entry:
      'JS image-data bytes → independent PE descriptor snapshots for SDK JavaScript consumers; script image/text decoders use JS',
    modules: ['data-buffer-projection'],
    projection: {
      direction: 'JS-to-PE',
      authority: 'NativeRuntime.imageDataBuffers',
      fields: ['immutable source bytes', 'size', 'capacity'],
      consumers: [{ domain: 8, modules: ['sdk-javascript-task', 'engine-files'] }],
      lifetime:
        'No script image/text decoder needs this descriptor. D8 MemoryFile/SDK JavaScript consumers own independent PE lifetimes; semantic transfers consume the JS reference explicitly.',
      removePhase: 8,
      operations: ['projectPointer', 'lendPointer', 'transferPointer'],
    },
  },
  {
    name: 'js-bitmap-to-exe-consumers',
    domain: 8,
    entry:
      'JS bitmaps produce independent foreign-task input copies; JS Draw and texture pages never use these copies',
    modules: [],
    files: ['oracle/bitmap-memory.mjs', 'oracle/bitmap-projection.mjs'],
    projection: {
      direction: 'JS-to-PE',
      authority: 'NativeImages bitmap-data handles',
      fields: [
        'pixels/stride/bpp',
        'canvas/offset/base/clip',
        'alpha/mask/blend metadata',
        'attribute records',
        'independent bitmap/wrapper references',
      ],
      consumers: [
        { domain: 8, modules: ['input-commands', 'sdk-javascript-task'], removePhase: 8 },
      ],
      lifetime:
        'Projection references follow JS aliases and retained consumers. Revision changes refresh the source. Wipe3 mutates JS source RGB before projection; there is no global owned-state back-read.',
      removePhase: 8,
      operations: ['pointer', 'wrapper', 'beforeCall', 'release'],
    },
  },
  {
    name: 'exe-owned-bitmap-derived-views',
    domain: 8,
    entry:
      'Remaining foreign-task producers expose explicit derived views of their PE-owned bitmap records',
    modules: [],
    files: ['oracle/bitmap-projection.mjs'],
    projection: {
      direction: 'PE-to-JS-view',
      authority:
        'Producer-owned foreign-task buffers; ordinary script bitmaps and render targets stay JS-owned',
      fields: [
        'derived RGBA and metadata at explicit import/publish boundaries',
        'consumer-owned pointer identity',
      ],
      consumers: [{ domain: 8, modules: ['sdk-javascript-task'], removePhase: 8 }],
      lifetime:
        'The consumer owns storage and checkpoint identity. Script-created bitmaps keep independent JS authority; capture/adoption is an explicit value transfer.',
      removePhase: 8,
      operations: ['borrow', 'pixels', 'adopt'],
    },
  },
  {
    name: 'js-anm-table-to-exe-view',
    domain: 8,
    entry: 'Remaining SDK consumer view initialization reads immutable JS-owned anmtable.csv bytes',
    modules: ['engine-files'],
    projection: {
      direction: 'JS-to-PE',
      authority: 'NativeImageFiles bytes and lookup entries',
      fields: ['immutable encoded table bytes'],
      consumers: [{ domain: 8, modules: ['sdk-javascript-task'], removePhase: 8 }],
      lifetime:
        'The original view builds its private map once from the frozen input. Scripts query JS entries; consumer map mutations never flow back.',
      removePhase: 8,
      operations: ['read'],
    },
  },
  {
    name: 'js-text-to-exe-windows-consumer',
    domain: 8,
    modules: [],
    entry: 'Explicit Windows/GDI consumers borrow the World-owned JavaScript text runtime',
    files: ['oracle/text-consumer-view.mjs'],
    projection: {
      direction:
        'Borrowed JS text services and process-backed byte inputs at an explicit legacy boundary',
      authority:
        'World owns one text writer/font state and its checkpoint; the consumer view owns only Windows handle state',
      fields: [
        'borrowed writer identities',
        'GDI/DC/font handles',
        'explicit native resource byte inputs',
      ],
      consumers: [
        {
          domain: 8,
          modules: ['engine-process', 'windows-gdi', 'sdk-javascript-task'],
          removePhase: 8,
        },
      ],
      lifetime:
        'Ordinary text and LOG obtain the World core without EXE initialization. The explicit engine view does not snapshot, restore or close JS writers. Its Windows handles remain with the remaining D8 consumer.',
      removePhase: 8,
      operations: ['borrow', 'Windows snapshot', 'Windows restore', 'close view'],
    },
  },
  {
    name: 'js-raw-data-to-task-message',
    domain: 8,
    entry:
      'Script23B reads JS-owned raw data before dispatching message 445; legacy PE input words remain a domain 8 boundary',
    modules: ['script-task'],
    projection: {
      direction: 'JS-to-PE',
      authority: 'NativeRuntime.imageDataBuffers.process',
      fields: ['message 445 scalar payload'],
      consumers: [{ domain: 8, modules: ['script-task', 'task-memory'] }],
      removePhase: 8,
      operations: ['0x23b'],
    },
  },
  {
    name: 'js-configuration-query-words',
    domain: 8,
    entry: 'NativeConfiguration.queryWords → Settings tail words in config-memory.push',
    modules: ['config-memory'],
    projection: {
      direction: 'JS-to-PE',
      authority: 'NativeConfiguration.queryWords',
      fields: ['query24D[0]', 'query24D[1]'],
      consumers: [{ domain: 8, modules: ['config-memory'] }],
      removePhase: 8,
      operations: ['push'],
    },
  },
  {
    name: 'js-scene-to-exe-reader-history',
    domain: 8,
    entry:
      'Script175 exposes write-only PE projections of the JS reader and history; no EXE constructor/parser/import/export and no afterCall back-read',
    modules: ['scene-memory'],
    projection: {
      direction: 'JS-to-PE',
      authority: 'NativeSceneData/NativeSceneReader/NativeSceneHistory',
      fields: [
        'body and section offsets',
        'file value/name',
        'block/line',
        'language strings and CSTL rows',
        'seen/path records',
        'numbered strings',
        'checkpoint extra bytes',
      ],
      consumers: [{ domain: 8, modules: ['script-task', 'task-memory'] }],
      removePhase: 8,
      operations: ['pointers', 'beforeCall'],
    },
  },
  {
    name: 'js-ppi-host',
    domain: 9,
    entry:
      'Particles → JSPluginRuntime → reviewed named JS algorithms; no DLL execution or private heap',
    modules: [],
    files: [
      'src/ppi/js-runtime.mjs',
      'src/ppi/host.mjs',
      'src/ppi/records.mjs',
      'src/ppi/plugin-identity.mjs',
      'src/ppi/verified-versions.mjs',
    ],
    directories: ['src/ppi/plugins/'],
    review: 'traced',
    reason:
      'Named JS callback lifecycle, records, RNG, attachment and checkpoint data; identity reads are diagnostic only and do not map/execute a DLL. Twelve reviewed JS algorithms own particle state in the product. Original DLL hosts are oracle-only.',
  },
  {
    name: 'sdk-javascript-image-text-owners',
    domain: 8,
    entry:
      'Original SDK V8 CsImage/CsText callbacks create their own PE image/writer resources and bypass main GCALL handlers',
    modules: ['sdk-javascript-task', 'engine-sdk-javascript'],
    ownership: {
      authority: 'Original SDK JavaScript native objects',
      fields: [
        'native object +352 image/writer pointer',
        'CsImage +396 Draw reference',
        'CsText +368 configuration, +584 source and reveal flags',
      ],
      consumers: [
        { domain: 6, modules: ['graphics-process', 'retained-draw'] },
        { domain: 8, modules: ['sdk-javascript-task'] },
      ],
      lifetime:
        'Create/load/append/draw and destruction stay with the V8 native object; KCS typed bitmap handles have an independent JS lifetime.',
      removePhase: 8,
    },
  },
  {
    name: 'sdk-javascript-and-media',
    domain: 8,
    entry: 'SDK JavaScript task factory / DirectShow, VMR and movie lifecycle',
    modules: [
      'engine-sdk-javascript',
      'sdk-javascript-task',
      'sdk-javascript-banks',
      'directshow',
      'vmr9',
      'movie-texture-renderer',
      'movie-wmreader',
      'movie-hap-playback',
      'windows-directsound',
    ],
  },
];

function tally(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] ?? 'unassigned';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

// Remaining selections are tracked until the owning phase removes its EXE path.
const addressSelectorModules = new Set(
  'area-effect-commands bitmap-factory bitmap-operations configuration-query content-databases draw-commands effect-commands engine-files fes-objects image-commands image-composite image-file image-owner input-browser input-commands nametable particle-commands plane-model-command plane-movie-command registry render-sources retained-draw screen-capture script-replacements-bridge task-dump task-memory text tile-plane-command window-events'.split(
    ' ',
  ),
);
function profileSelections(modules) {
  function isExeLayout(facts, binding, visited = new Set()) {
    const key = facts.file + '/' + binding;
    if (visited.has(key)) return false;
    visited.add(key);
    const imported = facts.imports.get(binding);
    if (imported && modules.has(imported)) {
      const declaration = facts.tree.body.find(
        (node) =>
          node.type === 'ImportDeclaration' &&
          node.specifiers.some((spec) => spec.local.name === binding),
      );
      const specifier = declaration.specifiers.find((spec) => spec.local.name === binding);
      return isExeLayout(modules.get(imported), specifier.imported?.name ?? binding, visited);
    }
    let initializer;
    walk(facts.tree, (node) => {
      if (node.type === 'VariableDeclarator' && node.id.name === binding) initializer = node.init;
    });
    if (!initializer) return false;
    let addresses = false;
    walk(initializer, (node) => {
      if (
        node.type === 'Literal' &&
        typeof node.value === 'number' &&
        IMAGE_RANGES.some(({ start, end }) => node.value >= start && node.value < end)
      )
        addresses = true;
    });
    if (addresses) return true;
    if (initializer.type === 'Identifier') return isExeLayout(facts, initializer.name, visited);
    if (initializer.type === 'CallExpression' && initializer.arguments[0]?.type === 'Identifier')
      return isExeLayout(facts, initializer.arguments[0].name, visited);
    return false;
  }
  const profileIndexSites = [],
    versionGuards = [],
    addressSelections = [],
    identityChecks = [];
  const isProfile = (node) =>
    node?.type === 'ChainExpression'
      ? isProfile(node.expression)
      : (node?.type === 'Identifier' && node.name === 'profile') ||
        (node?.type === 'MemberExpression' &&
          ['profile', 'nativeProfile'].includes(property(node)));
  for (const facts of modules.values()) {
    const found = new Map();
    const add = (kind, node, target) => {
      const row = {
        kind,
        file: facts.file,
        line: node.loc.start.line,
        expression: facts.source.slice(...node.range).replace(/\s+/g, ' '),
        domain: domain(facts.file),
      };
      const key = (target === addressSelections ? 'va' : kind) + ':' + row.line;
      if (!found.has(key) || found.get(key).row.expression.length < row.expression.length)
        found.set(key, { row, target });
    };
    walk(facts.tree, (node) => {
      if (node.type === 'Identifier' && node.name === 'profileIndex')
        add('index', node, profileIndexSites);
      if (node.type === 'MemberExpression' && property(node) === 'profileIndex')
        add('index', node, profileIndexSites);
      if (
        node.type === 'CallExpression' &&
        property(node.callee) === 'startsWith' &&
        isProfile(node.callee.object)
      )
        add('guard', node, versionGuards);
      if (
        node.type === 'BinaryExpression' &&
        ['===', '!==', '==', '!='].includes(node.operator) &&
        (isProfile(node.left) || isProfile(node.right))
      ) {
        if (isProfile(node.left) && isProfile(node.right)) add('identity', node, identityChecks);
        else if (
          ['string', 'undefined'].includes(typeof node.left.value) &&
          ['string', 'undefined'].includes(typeof node.right.value)
        )
          add('guard', node, versionGuards);
      }
      if (
        ['ConditionalExpression', 'IfStatement'].includes(node.type) &&
        /\b(?:sdk|profileIndex)\b/.test(facts.source.slice(...node.test.range))
      ) {
        let addresses = false;
        walk(node, (child) => {
          if (
            child.type === 'Literal' &&
            typeof child.value === 'number' &&
            IMAGE_RANGES.some(({ start, end }) => child.value >= start && child.value < end)
          )
            addresses = true;
        });
        if (addresses) add('va-condition', node.test, addressSelections);
      }
      if (node.type !== 'MemberExpression' || !node.computed) return;
      if (
        isProfile(node.property) &&
        node.object.type === 'Identifier' &&
        isExeLayout(facts, node.object.name)
      )
        add('exe-layout', node, addressSelections);
      const selection = facts.source.slice(...node.property.range);
      const table = facts.source.slice(...node.object.range);
      if (
        (/\b(?:profileIndex|sdk)\b/.test(selection) &&
          /\b(?:ABI|LOG_ABI|handlers|addresses|wrapperLayouts|destroy)\b/.test(table)) ||
        (/\bNATIVE_EXE_PROFILES\b/.test(table) && /\bprofile\b/.test(selection))
      )
        add('va', node, addressSelections);
    });
    for (const { row, target } of found.values()) {
      const reviewed =
        target === addressSelections ||
        addressSelectorModules.has(basename(row.file)) ||
        row.file.startsWith('oracle/');
      if (target === identityChecks) target.push(row);
      else
        target.push({
          ...row,
          review: reviewed ? 'deferred-domain-migration' : 'needs-review',
          reason: reviewed
            ? '保留的 EXE handler/global/vtable/patch 布局选择，随所属领域删除。'
            : '新增或未审查的版本条件，需要确认其是否仅选择 EXE 地址。',
        });
    }
  }
  const order = (a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line;
  for (const list of [profileIndexSites, versionGuards, addressSelections, identityChecks])
    list.sort(order);
  return { profileIndexSites, versionGuards, addressSelections, identityChecks };
}

async function build() {
  const modules = new Map();
  for (const file of [...(await filesBelow('src')), ...(await transitionalRuntimeFiles(root))])
    modules.set(file, moduleFacts(file, await readFile(join(root, file), 'utf8')));
  const docs = new Map();
  for (const file of (await readdir(join(root, 'docs')))
    .filter((file) => /^native-.*\.md$/.test(file))
    .sort())
    docs.set(`docs/${file}`, await readFile(join(root, 'docs', file), 'utf8'));
  globalThis[probeKey] = (name, fn) => {
    const probe = { name, claimed: true };
    probeTrace.push(probe);
    const result = fn();
    probe.claimed = result !== undefined;
    return result;
  };
  const hook = registerHooks({
    load(url, context, next) {
      const loaded = next(url, context);
      return url === new URL('../src/native/runtime.mjs', import.meta.url).href
        ? { ...loaded, source: instrumentRuntime(modules.get('src/native/runtime.mjs')) }
        : loaded;
    },
  });
  let api;
  try {
    api = Object.assign(
      {},
      await import('../src/native/world.mjs'),
      await import('../src/native/catalog.mjs'),
      await import('../src/native/abi/index.mjs'),
      await import('../src/native/config.mjs'),
      await import('../src/motion/library.mjs'),
      await import('../src/ppi/random.mjs'),
      await import('../src/native/particle-commands.mjs'),
    );
  } finally {
    hook.deregister();
  }
  const profiles = [];
  try {
    for (const profile of Object.keys(api.NATIVE_ABIS)) {
      const world = await registrationWorld(profile, true, api);
      const unmounted = await registrationWorld(profile, false, api);
      const inventory = await nativeEntries(profile, world, unmounted, api, modules, docs);
      profiles.push({
        profile,
        tables: Object.fromEntries(
          Object.entries(api.NATIVE_ABIS[profile].tables).map(([name, table]) => [
            name,
            table.count,
          ]),
        ),
        ...inventory,
      });
    }
  } finally {
    delete globalThis[probeKey];
  }
  const counted = await scanRuntime(root);
  const baseline = JSON.parse(
    await readFile(join(root, 'scripts/exe-dependency-baseline.json'), 'utf8'),
  );
  const comparison = compareBaseline(baseline.files, counted);
  if (comparison.increases.length) throw new Error(comparison.increases.join('\n'));
  const files = [...modules.values()].map((facts) => ({
    file: facts.file,
    sourceSha256: hash(facts.source),
    domain: domain(facts.file),
    role: ['world', 'runtime', 'catalog', 'engine-process', 'handles'].includes(
      basename(facts.file),
    )
      ? 'cross-domain infrastructure'
      : 'domain implementation/support',
    exeDependencies: counted[facts.file] ?? zero(),
    dependencyTypes: unique([
      ...(counted[facts.file]?.addresses ? ['in-image-literals'] : []),
      ...(counted[facts.file]?.references ? ['engine-process-reference'] : []),
      ...facts.executionSites.map((site) => site.method),
      ...facts.indirectSites.map((site) => site.method),
      ...(/\.tables\.main\.va/.test(facts.source) ? ['native-table-lookup'] : []),
      ...(/\b(?:load|store|read|write|view)\([^)]*(?:this\.)?(?:layout|abi|bindings|refs)\./.test(
        facts.source,
      )
        ? ['profile-memory-layout']
        : []),
    ]),
    docs: documentation([facts.file], docs),
    executionSites: facts.executionSites,
    executionSiteCounts: tally(facts.executionSites, 'method'),
    indirectSites: facts.indirectSites.map((site) => {
      const reason = reviewRenderIndirect(facts.file, site) ?? reviewFESIndirect(facts.file, site);
      return reason ? { ...site, review: 'traced', reason } : site;
    }),
    review:
      facts.indirectSites.some(
        (site) => !reviewRenderIndirect(facts.file, site) && !reviewFESIndirect(facts.file, site),
      ) || facts.executionSites.some((site) => site.review === 'needs-review')
        ? 'needs-review'
        : 'counted',
  }));
  const assigned = new Set();
  const nonNativeEntries = nonNativeGroups.map((group) => {
    const selected = files.filter(
      ({ file }) =>
        group.modules.includes(basename(file)) ||
        group.files?.includes(file) ||
        group.directories?.some((directory) => file.startsWith(directory)),
    );
    for (const { file } of selected) assigned.add(file);
    return {
      name: group.name,
      domain: group.domain,
      ...(group.projection ? { projection: group.projection } : {}),
      ...(group.configuration ? { configuration: group.configuration } : {}),
      entry: group.entry,
      modules: selected.map(({ file }) => file),
      executionSites: selected.flatMap(({ file, executionSites }) =>
        executionSites.map((site) => ({ file, ...site })),
      ),
      review: group.review ?? 'needs-review',
      reason:
        group.reason ??
        '生命周期和消息路径与 native 调用共享部分实现，调用点是保守候选。需区分 EXE、宿主 thunk 与独立 DLL 目标。',
    };
  });
  nonNativeEntries.push({
    name: 'patch-points',
    domain: null,
    entry: 'engine.patch / process.beforeInstruction / feature boundary registration',
    executionSites: files.flatMap(({ file, executionSites }) =>
      executionSites
        .filter((site) => ['patch', 'beforeInstruction', 'direct-code-write'].includes(site.method))
        .map((site) => ({ file, ...site })),
    ),
    review: 'needs-review',
    reason: '单独列出所有 AST patch/hook 站点，涵盖 feature 间接安装的边界。',
  });
  nonNativeEntries.push({
    name: 'other-feature-lifecycle-candidates',
    domain: null,
    entry: 'feature constructors/destructors, callbacks and shared helpers',
    executionSites: files
      .filter(({ file }) => !assigned.has(file))
      .flatMap(({ file, executionSites }) => executionSites.map((site) => ({ file, ...site }))),
    review: 'needs-review',
    reason:
      '余下执行站点可能由 native 本体或生命周期调用，全部保留以供逐函数迁移，不能以未命中分组为由漏掉。',
  });
  const entries = profiles.flatMap((profile) => profile.entries);
  const profileAudit = profileSelections(modules);
  const remaining = new Map();
  for (const row of [...profileAudit.versionGuards, ...profileAudit.addressSelections]) {
    const key = row.file + ':' + row.line;
    if (!remaining.has(key) || remaining.get(key).expression.length < row.expression.length)
      remaining.set(key, row);
  }
  profileAudit.totals = {
    profileIndexSites: profileAudit.profileIndexSites.length,
    exeVASelectionSites: remaining.size,
    needsReview: [
      ...profileAudit.profileIndexSites,
      ...profileAudit.versionGuards,
      ...profileAudit.addressSelections,
    ].filter((row) => row.review === 'needs-review').length,
  };
  const testMigration = await nativeTestGroups(root);
  return {
    kind: 'B migration inventory',
    generation: {
      command: 'node scripts/b-migration.mjs',
      check: 'node scripts/b-migration.mjs --check',
      method:
        'Actual NativeWorld registration in mounted/unmounted scenarios; instrumented actual NativeRuntime fallback dispatch with empty arguments; source AST feature-factory edges and execution sites; check-no-exe-addresses.scanRuntime counts.',
      limitations:
        'Fallback probes establish ownership at ID/argument/service guards, not successful behavior. Generic/PTCL use their separate dispatchers. Message receivers, input-dependent calls, PE-backed data and unresolved semantic names remain needs-review. Direct checker counts are syntactic and include plugin-host calls. No private EXE is required.',
      baselineComparison: comparison,
    },
    domains,
    testMigration,
    remainingProfileSelections: profileAudit,
    summary: {
      nativeSlots: entries.length,
      remainingProfileIndexSites: profileAudit.totals.profileIndexSites,
      remainingExeVASelectionSites: profileAudit.totals.exeVASelectionSites,
      profileSelectionNeedsReview: profileAudit.totals.needsReview,
      implementations: {
        ...Object.fromEntries(
          [
            'pure-js',
            'original-handler',
            'exe-region',
            'patch',
            'reserved',
            'constant-zero',
            'unknown',
            'unsupported',
          ].map((kind) => [kind, 0]),
        ),
        ...tally(entries, 'implementation'),
      },
      nativeDomains: tally(entries, 'domain'),
      nativeNeedsReview: entries.filter((entry) => entry.review === 'needs-review').length,
      runtimeFiles: files.length,
      fileDomains: tally(files, 'domain'),
      fileNeedsReview: files.filter((file) => file.review === 'needs-review').length,
      exeDependencyFiles: Object.keys(counted).length,
      exeDependencies: Object.values(counted).reduce((sum, counts) => {
        for (const key of Object.keys(sum)) sum[key] += counts[key];
        return sum;
      }, zero()),
      nonNativeGroups: nonNativeEntries.length,
      executionSites: files.reduce((sum, file) => sum + file.executionSites.length, 0),
    },
    profiles,
    files,
    nonNativeEntries,
  };
}

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== '--check'))
  throw new Error('Usage: node scripts/b-migration.mjs [--check]');
const inventory = await build();
const serialized = await format(JSON.stringify(inventory), {
  ...(await resolveConfig(output)),
  parser: 'json',
});
if (args.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== serialized)
    throw new Error('docs/b-migration.json is stale; run node scripts/b-migration.mjs');
} else await writeFile(output, serialized);
console.log(JSON.stringify(inventory.summary, null, 2));
