// SPDX-License-Identifier: MPL-2.0
import { readFile, lstat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { runtimeSourceFiles } from './runtime-source-files.mjs';

// PE32 ImageBase and SizeOfImage from the two EXEs identified by references.json.
// End addresses are exclusive. No private EXE is needed to run this check.
export const IMAGE_RANGES = Object.freeze([
  {
    reference: 'gameNativeReference',
    hashField: 'preparedEngineSha256',
    sha256: 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0',
    start: 0x400000,
    end: 0xbe5000, // ImageBase 0x400000 + SizeOfImage 0x7e5000
  },
  {
    reference: 'nativeReference',
    hashField: 'engineSha256',
    sha256: '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f',
    start: 0x400000,
    end: 0xce4000, // ImageBase 0x400000 + SizeOfImage 0x8e4000
  },
]);

// The actual ordinary app ESM graph is shipped runtime code. Explicit oracle
// includes, tools and tests remain outside this set. Every selected module
// retains its full address/call/reference counts; no tag suppresses a source.
// Numeric literals in either image range are conservatively counted, regardless
// of notation. Comments, strings, regexes and negative numbers are not addresses.
// All overlap literals are counted. A source comment cannot suppress a count.
const categories = ['addresses', 'calls', 'references'];
const zero = () => ({ addresses: 0, calls: 0, references: 0 });
const linter = new Linter();

export function validateReferences(references) {
  for (const image of IMAGE_RANGES) {
    if (references[image.reference]?.[image.hashField] !== image.sha256)
      throw new Error(
        `EXE fingerprint changed: rederive the PE image range for ${image.reference}`,
      );
  }
  if (Number(references.gameNativeReference.imageBase) !== IMAGE_RANGES[0].start)
    throw new Error('Game image base changed: rederive the PE image range');
}

function propertyName(member) {
  if (member.type !== 'MemberExpression') return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  return member.computed && member.property.type === 'Literal' ? member.property.value : null;
}

function isEngineReceiver(node) {
  if (node.type === 'Identifier') return /^(?:engine|nativeEngine)$/.test(node.name);
  if (node.type !== 'MemberExpression') return false;
  const property = propertyName(node);
  return (
    /^(?:engine|nativeEngine)$/.test(property) ||
    (property === 'process' && isEngineReceiver(node.object))
  );
}

function isTrackedCall(node) {
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name === 'callFromHost';
  const name = propertyName(callee);
  return (
    name === 'callFromHost' ||
    name === 'patch' ||
    (name === 'call' && isEngineReceiver(callee.object))
  );
}

export function scanSource(source, filename = 'source.mjs', evidence) {
  const counts = zero();
  const messages = linter.verify(
    source,
    [
      {
        files: ['**/*.{js,mjs,cjs,jsx}'],
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: filename.endsWith('.cjs') ? 'commonjs' : 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: {
          'exe-dependencies': {
            rules: {
              collect: {
                create() {
                  return {
                    Literal(node) {
                      if (
                        typeof node.value === 'string' &&
                        /(?:^|\/)engine-process\.mjs(?:[?#].*)?$/.test(node.value)
                      )
                        counts.references++;
                      if (typeof node.value !== 'number' && typeof node.value !== 'bigint') return;
                      if (node.parent.type === 'UnaryExpression' && node.parent.operator === '-')
                        return;
                      if (
                        !IMAGE_RANGES.some(
                          ({ start, end }) => node.value >= start && node.value < end,
                        )
                      )
                        return;
                      counts.addresses++;
                      evidence?.addresses.push(String(node.value));
                    },
                    Identifier(node) {
                      if (node.name === 'NativeEngineProcess') counts.references++;
                    },
                    CallExpression(node) {
                      if (isTrackedCall(node)) {
                        counts.calls++;
                        evidence?.calls.push(
                          node.callee.type === 'Identifier'
                            ? node.callee.name
                            : propertyName(node.callee),
                        );
                      }
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'exe-dependencies/collect': 'error' },
      },
    ],
    { filename },
  );
  if (messages.length)
    throw new Error(
      `${filename}:${messages[0].line}:${messages[0].column}: ${messages[0].message}`,
    );
  return counts;
}

// Keep conservative numeric overlaps visible, while classifying only these
// existing data operands by their actual AST use. No source tag exempts a file.
const numericOperandRoles = Object.freeze({
  'src/emote/geometry.mjs': [
    {
      type: 'number',
      value: '4194304',
      parent: 'VariableDeclarator',
      operand: 'skipParentTransform=0x400000',
      scope: [],
      meaning: 'PSB parent-transform bit flag',
    },
    {
      type: 'number',
      value: '8355711',
      parent: 'BinaryExpression',
      operand: '(color>>>1)&0x7f7f7f',
      scope: ['build'],
      meaning: 'RGB byte-halving mask',
    },
  ],
  'src/emote/m2-lip-samples.mjs': [
    {
      type: 'number',
      value: '4477004',
      parent: 'BinaryExpression',
      operand: 'view.getUint32(0,true)!==0x0044504c',
      scope: ['open'],
      meaning: 'LPD signature comparison',
    },
    {
      type: 'number',
      value: '10000000',
      parent: 'BinaryExpression',
      operand: 'length>10000000',
      scope: ['open'],
      meaning: 'bounded decoded lip sample length',
    },
  ],
  'src/emote/random.mjs': [
    {
      type: 'number',
      value: '8388607',
      parent: 'BinaryExpression',
      operand: 'words[3]&0x7fffff',
      scope: ['next'],
      meaning: 'IEEE754 fraction mask',
    },
    {
      type: 'number',
      value: '8388608',
      parent: 'BinaryExpression',
      operand: '(words[3]&0x7fffff)/8388608',
      scope: ['next'],
      meaning: 'fraction denominator 2^23',
    },
  ],
  'src/gallery.mjs': [
    {
      type: 'number',
      value: '4998979',
      parent: 'BinaryExpression',
      operand: 'b.u32(0)===0x004c4743',
      scope: ['readCGList'],
      meaning: 'CGL signature comparison',
    },
  ],
  'src/kcs/scheduler.mjs': [
    {
      type: 'number',
      value: '5000000',
      parent: 'AssignmentPattern',
      operand: 'budget=5000000',
      scope: ['constructor'],
      meaning: 'scheduler instruction budget',
    },
  ],
  'src/kcs/vm.mjs': [
    {
      type: 'number',
      value: '4194304',
      parent: 'BinaryExpression',
      operand: 'a|0x00400000',
      scope: ['arithmetic'],
      meaning: 'quiet NaN mask',
    },
    {
      type: 'number',
      value: '4194304',
      parent: 'BinaryExpression',
      operand: 'b|0x00400000',
      scope: ['arithmetic'],
      meaning: 'quiet NaN mask',
    },
    {
      type: 'number',
      value: '5000000',
      parent: 'AssignmentPattern',
      operand: 'options=5000000',
      scope: ['run'],
      meaning: 'VM instruction budget argument',
    },
    {
      type: 'number',
      value: '5000000',
      parent: 'AssignmentPattern',
      operand: 'budget=5000000',
      scope: ['run'],
      meaning: 'VM instruction budget',
    },
  ],
  'src/motion/instance.mjs': [
    {
      type: 'number',
      value: '5000000',
      parent: 'AssignmentPattern',
      operand: 'budget=5000000',
      scope: ['constructor'],
      meaning: 'motion instruction budget',
    },
  ],
  'src/motion/spline.mjs': [
    {
      type: 'number',
      value: '4194304',
      parent: 'BinaryExpression',
      operand: 'x|0x400000',
      scope: ['binary'],
      meaning: 'quiet NaN mask',
    },
    {
      type: 'number',
      value: '4194304',
      parent: 'BinaryExpression',
      operand: 'y|0x400000',
      scope: ['binary'],
      meaning: 'quiet NaN mask',
    },
  ],
  'src/native/bitmap-pixels.mjs': [
    {
      type: 'number',
      value: '8388608',
      parent: 'BinaryExpression',
      operand: 'product&0x800000',
      scope: ['bitmapBlur', 'pass'],
      meaning: 'integer blur rounding bit',
    },
  ],
  'src/native/engine-message.mjs': [
    {
      type: 'number',
      value: '5460803',
      parent: 'CallExpression',
      operand: 'view.setUint32(0,0x00535343,true)',
      scope: ['saveDump'],
      meaning: 'CSS header write',
    },
  ],
  'src/native/movie-browser.mjs': [
    {
      type: 'number',
      value: '10000000',
      parent: 'BinaryExpression',
      operand: 'duration*10000000',
      scope: ['metadata'],
      meaning: 'duration seconds to 100ns',
    },
    {
      type: 'number',
      value: '10000000',
      parent: 'BinaryExpression',
      operand: 'this.video.currentTime*10000000',
      scope: ['position'],
      meaning: 'playback seconds to 100ns',
    },
    {
      type: 'number',
      value: '10000000',
      parent: 'BinaryExpression',
      operand: 'Number(position)/10000000',
      scope: ['seek'],
      meaning: 'seek 100ns to seconds',
    },
  ],
  'src/native/movie-hap-audio.mjs': [
    {
      type: 'bigint',
      value: '10000000',
      parent: 'VariableDeclarator',
      operand: 'TIME_UNITS=10000000n',
      scope: [],
      meaning: '100ns time units',
    },
    {
      type: 'number',
      value: '8388608',
      parent: 'BinaryExpression',
      operand: '(view.getUint16(at,true)|(view.getInt8(at+2)<<16))/8388608',
      scope: ['sampleReader'],
      meaning: 'signed 24-bit PCM normalization',
    },
  ],
  'src/native/movie-hap-playback.mjs': [
    {
      type: 'bigint',
      value: '10000000',
      parent: 'BinaryExpression',
      operand: 'BigInt(scale)*10000000n',
      scope: ['frameStamp'],
      meaning: 'AVI time scale',
    },
  ],
  'src/native/movie-hap.mjs': [
    {
      type: 'bigint',
      value: '10000000',
      parent: 'VariableDeclarator',
      operand: 'TIME_UNITS=10000000n',
      scope: [],
      meaning: '100ns time units',
    },
  ],
  'src/native/persistence.mjs': [
    {
      type: 'number',
      value: '5460803',
      parent: 'CallExpression',
      operand: 'word(out,0,0x00535343)',
      scope: ['file'],
      meaning: 'CSS header write',
    },
    {
      type: 'number',
      value: '5460803',
      parent: 'BinaryExpression',
      operand: 'b.u32(0)!==0x00535343',
      scope: ['readCSS'],
      meaning: 'CSS signature comparison',
    },
    {
      type: 'number',
      value: '5460803',
      parent: 'BinaryExpression',
      operand: 'newBinary(bytes).u32(0)!==0x00535343',
      scope: ['nativePersistence'],
      meaning: 'CSS signature comparison',
    },
  ],
  'src/native/retained-animation.mjs': [
    {
      type: 'number',
      value: '5066305',
      parent: 'BinaryExpression',
      operand: 'view.getUint32(0,true)===0x004d4e41',
      scope: ['hasSignature'],
      meaning: 'ANM signature comparison',
    },
  ],
  'src/native/save-slots.mjs': [
    {
      type: 'number',
      value: '5460803',
      parent: 'BinaryExpression',
      operand: 'newDataView(data.buffer,data.byteOffset).getUint32(0,true)!==0x535343',
      scope: ['command'],
      meaning: 'CSS signature comparison',
    },
  ],
  'src/native/scalar-math.mjs': [
    {
      type: 'number',
      value: '4194304',
      parent: 'BinaryExpression',
      operand: 'word|0x00400000',
      scope: ['quiet'],
      meaning: 'quiet NaN mask',
    },
  ],
  'src/native/sound.mjs': [
    {
      type: 'number',
      value: '5002832',
      parent: 'BinaryExpression',
      operand: 'get32(plv,0)===0x4c5650',
      scope: ['auxiliaries'],
      meaning: 'PLV signature comparison',
    },
  ],
  'src/ppi/script.mjs': [
    {
      type: 'number',
      value: '5000000',
      parent: 'AssignmentPattern',
      operand: 'budget=5000000',
      scope: ['constructor'],
      meaning: 'particle instruction budget',
    },
  ],
});

export function ordinaryNumericConstants(source, file) {
  const constants = [],
    roles = numericOperandRoles[file] ?? [];
  const messages = linter.verify(
    source,
    [
      {
        plugins: {
          constants: {
            rules: {
              operands: {
                create() {
                  return {
                    Literal(node) {
                      if (!['number', 'bigint'].includes(typeof node.value)) return;
                      const p = node.parent,
                        scope = [];
                      for (let current = node.parent; current; current = current.parent) {
                        let name;
                        if (current.type === 'FunctionDeclaration') name = current.id?.name;
                        else if (current.type === 'MethodDefinition')
                          name = current.key.name ?? current.key.value;
                        else if (
                          ['FunctionExpression', 'ArrowFunctionExpression'].includes(
                            current.type,
                          ) &&
                          current.parent?.type === 'VariableDeclarator'
                        )
                          name = current.parent.id.name;
                        if (name && !scope.includes(name)) scope.unshift(name);
                      }
                      const operand = source
                        .slice(p.start, p.end)
                        .replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/\s+/g, '');
                      const role = roles.find(
                        (r) =>
                          r.type === typeof node.value &&
                          r.value === String(node.value) &&
                          r.parent === p.type &&
                          r.operand === operand &&
                          JSON.stringify(r.scope) === JSON.stringify(scope),
                      );
                      if (role)
                        constants.push({
                          file,
                          line: node.loc.start.line,
                          value: String(node.value),
                          parent: p.type,
                          operand,
                          scope,
                          meaning: role.meaning,
                        });
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'constants/operands': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(file + ': ' + messages[0].message);
  return constants;
}

export function actualSourceDependencies(source, file) {
  const raw = scanSource(source, file),
    constants = ordinaryNumericConstants(source, file);
  return { ...raw, addresses: raw.addresses - constants.length };
}

export function scanRuntimeCapabilities(source, file) {
  const owners = [],
    execution = [],
    memory = [];
  const forbidden = new Set([
    'getNativeFeature',
    'ensureNativeEngine',
    'registerNativeFeature',
    'loadUnicorn',
    'loadExecutable',
    'emu_start',
    'callFromHost',
    'callAsync',
    'runThread',
    'beforeInstruction',
  ]);
  const messages = linter.verify(
    source,
    [
      {
        plugins: {
          owner: {
            rules: {
              capabilities: {
                create() {
                  const property = (node) =>
                    node.computed ? node.property.value : node.property.name;
                  const original = (node, name) => {
                    if (!['nativeEngine', 'nativeEngineLoading'].includes(name)) return;
                    let fn = node;
                    while (fn && fn.type !== 'FunctionDeclaration') fn = fn.parent;
                    const serialized =
                      file === 'src/native/original-adapter.mjs' &&
                      fn?.id?.name === 'requireCheckpointRestoreOwner' &&
                      node.type === 'MemberExpression' &&
                      node.object.name === 'state';
                    owners.push({
                      file,
                      line: node.loc.start.line,
                      property: name,
                      serializedCheckpointGuard: serialized,
                    });
                  };
                  return {
                    MemberExpression(node) {
                      const name = property(node);
                      original(node, name);
                      if (forbidden.has(name))
                        execution.push({ file, line: node.loc.start.line, method: name });
                      if (name === 'process') {
                        const receiver = source.slice(node.object.start, node.object.end);
                        const owned =
                          (file === 'src/native/data-buffer.mjs' && receiver === 'this') ||
                          /^(?:(?:this\.)?world\.runtime|this(?:\.runtime)?)\.imageDataBuffers$/.test(
                            receiver,
                          ) ||
                          receiver === 'await services.imageDataBuffers()' ||
                          (file === 'src/native/heap-data.mjs' && receiver === 'heap');
                        memory.push({ file, line: node.loc.start.line, receiver, owned });
                      }
                    },
                    Property(node) {
                      if (node.parent.type !== 'ObjectPattern') return;
                      const name = node.key.name ?? node.key.value;
                      original(node, name);
                      if (forbidden.has(name))
                        execution.push({ file, line: node.loc.start.line, method: name });
                    },
                    CallExpression(node) {
                      if (
                        node.callee.type === 'Identifier' &&
                        ['eval', 'Function', 'loadUnicorn', 'callFromHost'].includes(
                          node.callee.name,
                        )
                      )
                        execution.push({
                          file,
                          line: node.loc.start.line,
                          constructor: node.callee.name,
                        });
                    },
                    NewExpression(node) {
                      if (
                        node.callee.type === 'Identifier' &&
                        [
                          'Function',
                          'NativeEngineProcess',
                          'PE32Process',
                          'Unicorn',
                          'QuickJS',
                        ].includes(node.callee.name)
                      )
                        execution.push({
                          file,
                          line: node.loc.start.line,
                          constructor: node.callee.name,
                        });
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'owner/capabilities': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(file + ': ' + messages[0].message);
  return { owners, execution, memory };
}

export async function scanRuntime(root) {
  const files = {};
  for (const name of await runtimeSourceFiles(root)) {
    let path = root;
    for (const component of name.split('/')) {
      path = join(path, component);
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlink in runtime path ' + name);
    }
    if (!resolve(path).startsWith(resolve(root) + sep))
      throw new Error('Runtime path escapes repository');
    const counts = scanSource(await readFile(path, 'utf8'), name);
    if (categories.some((category) => counts[category])) files[name] = counts;
  }
  return files;
}

export async function check(root) {
  validateReferences(JSON.parse(await readFile(join(root, 'references.json'), 'utf8')));
  const modules = await runtimeSourceFiles(root),
    raw = zero(),
    actual = zero(),
    constants = [],
    owners = [],
    execution = [],
    memory = [];
  for (const file of modules) {
    const source = await readFile(join(root, file), 'utf8');
    if (/exe-address-check:/.test(source))
      throw new Error('Product source cannot exempt EXE sites: ' + file);
    const counts = scanSource(source, file),
      data = ordinaryNumericConstants(source, file),
      capabilities = scanRuntimeCapabilities(source, file);
    constants.push(...data);
    owners.push(...capabilities.owners);
    execution.push(...capabilities.execution);
    memory.push(...capabilities.memory);
    for (const name of categories) {
      raw[name] += counts[name];
      actual[name] += counts[name];
    }
    actual.addresses -= data.length;
  }
  const guards = owners.filter((row) => row.serializedCheckpointGuard),
    live = owners.filter((row) => !row.serializedCheckpointGuard),
    unexpected = memory.filter((row) => !row.owned);
  // No mutable baseline, relocation or update can raise this ceiling.
  if (
    Object.values(actual).some((value) => value !== 0) ||
    execution.length ||
    live.length ||
    unexpected.length
  )
    throw new Error(
      'Ordinary execution dependency exceeds zero: ' +
        JSON.stringify({ actual, execution, live, unexpected }),
    );
  if (guards.length !== 1)
    throw new Error('Serialized checkpoint owner guard must remain visible exactly once');
  console.log(
    'Ordinary dependency ceiling 0: ' +
      JSON.stringify({
        modules: modules.length,
        actual,
        rawNumericOverlaps: raw.addresses,
        ordinaryNumericConstants: constants,
        serializedCheckpointGuards: guards.length,
        liveOriginalOwners: live.length,
        originalExecution: execution.length,
        ownedBufferMemoryMembers: memory.length,
      }),
  );
  return { raw, actual, constants, guards, live, execution, memory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-no-exe-addresses.mjs');
  await check(fileURLToPath(new URL('..', import.meta.url)));
}
