// SPDX-License-Identifier: MPL-2.0
// Source normalization, section indexing and runtime macro emission are separate.
import { prepareFESSource, splitFESLines } from './source.mjs';
import { tokenizeFESByteLine, fesByteView, fesNarrowText, fesSourceBytes } from './tokens.mjs';

export function includeNames(source, { prepared = false, tokens = tokenizeFESByteLine } = {}) {
  if (prepared) return [];
  const result = [];
  let include = false;
  for (const bytes of prepareFESSource(source, { tokens })) {
    const line = fesByteView(bytes);
    if (line.startsWith('#')) include = line === '#INCLUDE';
    else if (include && !line.startsWith(';')) result.push(fesNarrowText(bytes));
  }
  return result;
}

export function parseProgram(
  source,
  { prepared = false, include, tokens = tokenizeFESByteLine } = {},
) {
  const program = {
    sources: [],
    macros: [],
    definitions: [],
    tables: [],
    blocks: Object.create(null),
    preload: [],
    subcommands: Object.create(null),
    keyblocks: [],
  };
  let section = 'ignore',
    current;
  function expand(source, isPrepared, stack = []) {
    program.sources.push({ bytes: fesSourceBytes(source).slice(), prepared: isPrepared });
    const lines = isPrepared ? splitFESLines(source) : prepareFESSource(source, { tokens }),
      result = [];
    let inserting = false;
    for (const bytes of lines) {
      const line = fesByteView(bytes);
      if (!isPrepared && line.startsWith('#')) inserting = line === '#INCLUDE';
      if (inserting) {
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        if (stack.includes(line))
          throw new Error(`FES include cycle: ${[...stack, line].join(' -> ')}`);
        const name = fesNarrowText(bytes),
          contents = include?.(name);
        if (
          !contents ||
          !(contents.bytes instanceof Uint8Array) ||
          typeof contents.prepared !== 'boolean'
        )
          throw new Error(`Unresolved FES include ${line}`);
        result.push(...expand(contents.bytes, contents.prepared, [...stack, line]));
      } else result.push(bytes);
    }
    return result;
  }
  for (const bytes of expand(fesSourceBytes(source), prepared)) {
    const line = fesByteView(bytes);
    if (!line || line.startsWith(';')) continue;
    const raw = tokens(bytes);
    if (!raw.every((token) => token instanceof Uint8Array))
      throw new TypeError('FES parameter scanner must preserve token bytes');
    const [first, ...words] = raw,
      head = first === undefined ? '' : fesNarrowText(first);
    if (!head) continue;
    if (head.startsWith('#')) {
      const label = head.slice(1);
      switch (label) {
        case 'INCLUDE':
          section = 'ignore';
          break;
        case 'MACRO':
          section = 'macro';
          break;
        case 'DEFINE':
          section = 'define';
          break;
        case 'OBJECT':
          section = 'object';
          current = { header: bytes, columns: words, rows: [] };
          program.tables.push(current);
          break;
        case 'PRELOAD':
          section = 'preload';
          break;
        case 'SUBCOMMAND':
          section = 'subcommand';
          break;
        case 'KEYBLOCK':
          section = 'keyblock';
          program.keyblockCount = Number(fesNarrowText(words[0]));
          break;
        default:
          section = 'block';
          current = program.blocks[label] ??= [];
      }
    } else if (section === 'macro') program.macros.push([first, ...words.slice(0, 1)]);
    else if (section === 'define') {
      const match = /^(\w+)(?:\[(\d+)\])?;?$/.exec(fesNarrowText(words[0]));
      if (!match) throw new Error(`Invalid FES definition: ${line}`);
      program.definitions.push({
        type: head,
        name: match[1],
        count: match[2] === undefined ? null : Number(match[2]),
      });
    } else if (section === 'object')
      current.rows.push({ target: first, values: words, source: bytes });
    else if (section === 'block') current.push(bytes);
    else if (section === 'preload') program.preload.push(first);
    else if (section === 'subcommand')
      program.subcommands[fesNarrowText(words[0])] = { type: head, words: words.slice(1) };
    else if (section === 'keyblock') {
      const size =
          words[0] === undefined ? undefined : fesNarrowText(words[0]).split(',').map(Number),
        links = words[1] === undefined ? undefined : fesNarrowText(words[1]).split(',').map(Number),
        index = Number(head);
      if (
        !Number.isInteger(index) ||
        size?.length !== 2 ||
        links?.length !== 4 ||
        [...size, ...links].some((n) => !Number.isInteger(n))
      )
        throw new Error(`Invalid FES keyblock: ${line}`);
      program.keyblocks[index] = { width: size[0], height: size[1], links };
    }
  }
  return program;
}
