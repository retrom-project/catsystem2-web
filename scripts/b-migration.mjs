// SPDX-License-Identifier: MPL-2.0
// Offline inventory. Only constructors/registration and guarded fallback probes
// run here. No engine, DLL, resource, task or browser is opened.
import { readFile, readdir, writeFile } from 'node:fs/promises';
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
  3: 'arguments calendar geometry matrix rectangles scalar-math view-geometry random-memory utf8 unicode-output standard',
  4: 'bank character-names comma-fields configuration-query content-databases database data-buffer dictionary gallery gallery-tables heap-data history-cursor nametable ordered-map persistence record-stack record-queue resource-cache resource-search resource-selection resources save-slots scene-checkpoint scene-data scene-history scene-memory section-table sparse-bytes storage string-bank motion-persistence script-xml tile-game',
  5: 'bitmap-memory bitmap-factory bitmap-operations image-owner image-composite image-file image-commands image image-affine image-persistence hg3-delta text text-log text-legacy text-plain text-task text-windows fes-text fes-text-layout zlib zlib-artifact deflate',
  6: 'area-effect area-effect-commands cursor divided-model draw-commands draw-task effect-commands graphics graphics-process graphics-render graphics-task mesh particle-bounds particle-commands particle-projection particle-textures particles plane-model-command raster-kernel renderer render-sources retained-draw screen-capture screen-effect screen-effect-render texture-layout texture-memory view',
};
function domain(file) {
  const name = basename(file);
  if (file === 'oracle/scalar-handlers.mjs') return 3;
  if (
    file.startsWith('src/emote/') ||
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
    'scalar-math geometry rectangles view-geometry database content-databases section-table nametable bitmap-factory ' +
    'image-owner draw-commands effect-commands screen-capture bitmap-operations image-commands ' +
    'configuration-query input-commands registry image-file image-composite render-sources ' +
    'unicode-output utf8 record-queue tile-game script-xml task-dump tile-plane-command ' +
    'plane-movie-command plane-model-command area-effect-commands particle-commands ' +
    'text-legacy text-log version-query storage sdk-javascript-task emote'
  ).split(' '),
);
const reviewedRegions = new Map([
  ['matrix', ['matrix']],
  ['text-plain', ['text']],
  ['gallery-tables', ['data-buffers', 'engine-files']],
  ['scene-checkpoint', ['scene-checkpoints', 'engine-files']],
  ['data-buffer', ['data-buffers']],
]);
const messageModules = new Set(
  'task task-command fes graphics draw-task mesh image input input-control text-task movie sound particles script-task'.split(
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
  if (
    (name === 'storage' && id !== 0x237) ||
    name === 'heap-data' ||
    (name === 'data-buffer' && [0x16d, 0x16e].includes(id))
  ) {
    implementation = 'pure-js';
    if (name !== 'storage') {
      names = unique([...names, 'data-buffers']);
      reasons.push(
        '本体由 JS 操作原进程堆/描述符，仍依赖 PE heap singleton 与 data-buffers feature 初始化，不能据此删除 EXE 数据状态。',
      );
    }
  } else if (
    originalWrappers.has(name) ||
    (name === 'gallery-tables' && ![0x195, 0x19c].includes(id))
  ) {
    implementation = 'original-handler';
    if (name === 'gallery-tables') names = unique([...names, 'data-buffers', 'task-memory']);
  } else if (reviewedRegions.has(name)) {
    implementation = 'exe-region';
    names = unique([...names, ...reviewedRegions.get(name)]);
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
    implementation = 'unknown';
    reasons.push(
      'JS 编解码经 NativeImages 的原位 bitmap 包装器访问像素，是否创建/导入 PE owner 取决于输入句柄。',
    );
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
  if (implementation === 'original-handler' && !modules.get(file).executionSites.length) {
    implementation = 'unknown';
    reasons.push('已审查的原处理器模块已无执行站点，需更新本脚本的路由分类。');
  }
  return {
    implementation,
    names,
    dependencies: resolveFeatures(names, features, modules),
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
  for (const [table, declaration] of Object.entries(api.NATIVE_PROFILES[profile].tables)) {
    for (const entry of api.nativeCatalog(profile, table)) {
      const reasons = [];
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
        if (table.startsWith('particle-') && entry.id === 38) {
          implementation = 'unknown';
          dependencies = ['src/native/particle-bounds.mjs', 'src/native/particles.mjs'];
          reasons.push(
            'PTCL screenBounds 默认使用 JS projectionBounds，NativeParticles 注入的回调可经当前 EXE 计算边界。',
          );
        }
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
          if (
            basename(implementationFile) === 'particles' &&
            api.NativeParticleCommands.has(entry.id)
          ) {
            implementationFile = 'src/native/particle-commands.mjs';
            reasons.push(
              '正常挂载路径调用原 wrapper，未挂载时闭包改走 nativeParticles JS 消息路径。',
            );
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
      if (implementationFile === 'src/native/scalar-math.mjs') {
        dependencies = unique([
          ...dependencies,
          'oracle/transitional-exe.mjs',
          'oracle/scalar-handlers.mjs',
        ]);
        reasons.push(
          '按当前 ABI 的语义名调用显式过渡 host，原算术/VM 写回继续由 oracle 层的原处理器完成。',
        );
      }
      if (!entry.name) reasons.push('catalog 未恢复该 ABI/ID 的语义名，不借用另一版本的同号语义。');
      if (
        (table === 'generic' && [39, 40].includes(entry.id)) ||
        (table.startsWith('particle-') && [33, 34].includes(entry.id))
      ) {
        dependencies = unique([...dependencies, 'src/native/random-memory.mjs']);
        reasons.push('JS 随机数使用共享 ParticleRandom，World 可将随机状态绑定到原 EXE RAM。');
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
      entries.push({
        table,
        id: entry.id,
        hexID: `0x${entry.id.toString(16)}`,
        semanticName: entry.name,
        catalogStatus: entry.status,
        implementation,
        module: implementationFile,
        domain: phase,
        route,
        registration: location ? `${location.file}:${location.line}` : null,
        features: names,
        ...(implementationFile === 'src/native/scalar-math.mjs'
          ? { transitionalOperation: entry.name }
          : {}),
        dependencies,
        docs: documentation(unique([implementationFile, ...dependencies]), docs),
        review: reasons.length ? 'needs-review' : 'traced',
        reviewReasons: reasons,
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
    name: 'graphics-thread-and-application-tasks',
    domain: 6,
    entry:
      'NativeGraphicsPlatform/NativeRenderer/NativePlane/NativeEngineWorkers → original task factory, receiver, vtable and worker',
    modules: [
      'graphics',
      'graphics-process',
      'graphics-render',
      'graphics-task',
      'renderer',
      'engine-workers',
      'retained-draw',
      'screen-effect',
      'screen-effect-render',
      'area-effect',
      'raster-kernel',
      'texture-memory',
    ],
  },
  {
    name: 'fes-and-text-lifecycle',
    domain: 7,
    entry:
      'createNativeFESTask → NativeFESObjectRuntime and registered FES type adapters; NativeTextRuntime lifecycle',
    modules: [
      'fes-objects',
      'fes-images',
      'fes-controls',
      'fes-effects',
      'fes-planes',
      'fes-area',
      'fes-log',
      'fes-data',
      'fes-gallery',
      'fes-particles',
      'fes-text',
      'text',
      'text-task',
      'text-log',
      'text-legacy',
      'control-task',
    ],
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
      'save-slots',
      'engine-files',
    ],
  },
  {
    name: 'emote-exe-glue',
    domain: 9,
    entry:
      'NativeM2/NativeSDKM2Tasks → EXE driver, configuration and FES/graphics glue before DLL exports',
    modules: [
      'emote',
      'emote-configuration',
      'emote-blocks',
      'emote-fes',
      'emote-graphics',
      'emote-sdk-task',
    ],
  },
  {
    name: 'ppi-and-dll-host',
    domain: 9,
    entry:
      'Particles → nativeThread/atlas/scriptBounds/projectGeometry; PPINativeRuntime/EmoteNativeAdapter → PE32Process',
    modules: ['particles', 'particle-projection', 'particle-bounds', 'particle-textures'],
    directories: ['src/ppi/', 'src/emote/'],
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
    for (const profile of Object.keys(api.NATIVE_PROFILES)) {
      const world = await registrationWorld(profile, true, api);
      const unmounted = await registrationWorld(profile, false, api);
      const inventory = await nativeEntries(profile, world, unmounted, api, modules, docs);
      profiles.push({
        profile,
        tables: Object.fromEntries(
          Object.entries(api.NATIVE_PROFILES[profile].tables).map(([name, table]) => [
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
    indirectSites: facts.indirectSites,
    review:
      facts.indirectSites.length ||
      facts.executionSites.some((site) => site.review === 'needs-review')
        ? 'needs-review'
        : 'counted',
  }));
  const assigned = new Set();
  const nonNativeEntries = nonNativeGroups.map((group) => {
    const selected = files.filter(
      ({ file }) =>
        group.modules.includes(basename(file)) ||
        group.directories?.some((directory) => file.startsWith(directory)),
    );
    for (const { file } of selected) assigned.add(file);
    return {
      name: group.name,
      domain: group.domain,
      entry: group.entry,
      modules: selected.map(({ file }) => file),
      executionSites: selected.flatMap(({ file, executionSites }) =>
        executionSites.map((site) => ({ file, ...site })),
      ),
      review: 'needs-review',
      reason:
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
    summary: {
      nativeSlots: entries.length,
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
