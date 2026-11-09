// SPDX-License-Identifier: MPL-2.0
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

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

// Everything under src/ is runtime code: there are no exempt runtime directories.
// Oracle, offline tools and tests belong outside src/, in oracle/, tools/,
// scripts/ or tests/; those directories are the only intended exceptions.
// Numeric literals in either image range are conservatively counted, regardless
// of notation. Comments, strings, regexes and negative numbers are not addresses.
// If a literal is demonstrably an ordinary constant, attach exactly one block
// comment after it: /* exe-address-check: non-address - reason */. Closing
// parentheses or a semicolon may intervene when Prettier moves the comment.
// Explain the actual non-address meaning; this cannot exempt a real EXE address.
// Bare, misplaced or stale directives fail the check and need human review.
const directivePrefix = /^\s*exe-address-check:/;
const nonAddressDirective = /^\s*exe-address-check:\s*non-address\s+-\s+(.+?)\s*$/;
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

export function scanSource(source, filename = 'source.mjs') {
  const counts = zero();
  const consumedDirectives = new Set();
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
                create(context) {
                  const code = context.sourceCode;
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
                      let next = code.getTokenAfter(node, { includeComments: true });
                      while (
                        [')', ';'].includes(next?.value) &&
                        next.loc.start.line === node.loc.end.line
                      )
                        next = code.getTokenAfter(next, { includeComments: true });
                      if (next?.type === 'Block' && next.loc.start.line === node.loc.end.line) {
                        const match = nonAddressDirective.exec(next.value);
                        if (match && match[1].trim().length >= 8) {
                          consumedDirectives.add(next);
                          return;
                        }
                      }
                      counts.addresses++;
                    },
                    Identifier(node) {
                      if (node.name === 'NativeEngineProcess') counts.references++;
                    },
                    CallExpression(node) {
                      if (isTrackedCall(node)) counts.calls++;
                    },
                    'Program:exit'() {
                      for (const comment of code.getAllComments()) {
                        if (directivePrefix.test(comment.value) && !consumedDirectives.has(comment))
                          context.report({
                            loc: comment.loc,
                            message:
                              'non-address directive must immediately follow one in-range literal with a specific reason',
                          });
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

export async function transitionalRuntimeFiles(root) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, 'scripts/transitional-runtime.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.some(
      (file) =>
        typeof file !== 'string' || !/^(?:web|oracle)\/(?!.*(?:^|\/)\.\.?\/).+\.mjs$/.test(file),
    ) ||
    new Set(manifest.files).size !== manifest.files.length
  )
    throw new Error('Invalid transitional runtime include list');
  return manifest.files;
}

export async function scanRuntime(root) {
  const src = join(root, 'src');
  const files = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in runtime tree: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:[cm]?js|jsx)$/.test(entry.name)) {
        const name = relative(root, path).split('\\').join('/');
        const counts = scanSource(await readFile(path, 'utf8'), name);
        if (categories.some((category) => counts[category])) files[name] = counts;
      }
    }
  }
  await visit(src);
  for (const name of await transitionalRuntimeFiles(root)) {
    const path = join(root, name),
      info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`Invalid transitional runtime file ${name}`);
    const counts = scanSource(await readFile(path, 'utf8'), name);
    if (categories.some((category) => counts[category])) files[name] = counts;
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export function compareBaseline(baseline, current) {
  const increases = [],
    decreases = [];
  for (const name of [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()) {
    for (const category of categories) {
      const previous = baseline[name]?.[category] ?? 0;
      const next = current[name]?.[category] ?? 0;
      if (next > previous) increases.push(`${name}: ${category} ${previous} -> ${next}`);
      if (next < previous) decreases.push(`${name}: ${category} ${previous} -> ${next}`);
    }
  }
  return { increases, decreases };
}

function validateBaseline(data) {
  if (!data || data.version !== 1 || !data.files || Array.isArray(data.files))
    throw new Error('Invalid EXE dependency baseline');
  for (const [name, counts] of Object.entries(data.files)) {
    if (
      !/^(?:src|web|oracle)\/(?!.*(?:^|\/)\.\.?\/).+\.(?:[cm]?js|jsx)$/.test(name) ||
      !counts ||
      Object.keys(counts).length !== categories.length ||
      categories.some((key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0)
    )
      throw new Error(`Invalid baseline entry: ${name}`);
  }
}

export async function check(root, { update = false } = {}) {
  const baselinePath = join(root, 'scripts/exe-dependency-baseline.json');
  const references = JSON.parse(await readFile(join(root, 'references.json'), 'utf8'));
  validateReferences(references);
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  validateBaseline(baseline);
  const current = await scanRuntime(root);
  const { increases, decreases } = compareBaseline(baseline.files, current);
  if (increases.length) throw new Error(`EXE dependencies increased:\n${increases.join('\n')}`);
  if (decreases.length && update) {
    await writeFile(baselinePath, JSON.stringify({ version: 1, files: current }, null, 2) + '\n');
    console.log(`Updated EXE dependency baseline (${decreases.length} decreases).`);
  } else if (decreases.length) {
    console.log(
      `EXE dependencies decreased:\n${decreases.join('\n')}\n` +
        'Run node scripts/check-no-exe-addresses.mjs --update to lower the baseline.',
    );
  }
  const totals = Object.values(current).reduce((sum, counts) => {
    for (const category of categories) sum[category] += counts[category];
    return sum;
  }, zero());
  console.log(
    `EXE dependency check: ${totals.addresses} addresses, ${totals.calls} calls, ` +
      `${totals.references} references in ${Object.keys(current).length} files.`,
  );
}

const entry = process.argv[1] && resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--update')) {
    console.error('Usage: node scripts/check-no-exe-addresses.mjs [--update]');
    process.exitCode = 1;
  } else {
    try {
      await check(fileURLToPath(new URL('..', import.meta.url)), { update: args.length === 1 });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
