// SPDX-License-Identifier: MPL-2.0
// Source normalization, section indexing and runtime macro emission are separate.
import { prepareFESSource, splitFESLines } from './source.mjs';
import { tokenizeFESLine } from './tokens.mjs';

export function includeNames(text, { prepared = false, tokens = tokenizeFESLine } = {}) {
  if (prepared) return [];
  const result = [];
  let include = false;
  for (const line of prepareFESSource(text, { tokens })) {
    if (line.startsWith('#')) include = line === '#INCLUDE';
    else if (include && !line.startsWith(';')) result.push(line);
  }
  return result;
}

export function parseProgram(text, { prepared = false, include, tokens = tokenizeFESLine } = {}) {
  const program = {
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
    const lines = isPrepared ? splitFESLines(source) : prepareFESSource(source, { tokens }),
      result = [];
    let inserting = false;
    for (const line of lines) {
      if (!isPrepared && line.startsWith('#')) inserting = line === '#INCLUDE';
      if (inserting) {
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        if (stack.includes(line))
          throw new Error(`FES include cycle: ${[...stack, line].join(' -> ')}`);
        const contents = include?.(line);
        if (
          !contents ||
          typeof contents.text !== 'string' ||
          typeof contents.prepared !== 'boolean'
        )
          throw new Error(`Unresolved FES include ${line}`);
        result.push(...expand(contents.text, contents.prepared, [...stack, line]));
      } else result.push(line);
    }
    return result;
  }
  for (const line of expand(text, prepared)) {
    if (!line || line.startsWith(';')) continue;
    const [head, ...words] = tokens(line);
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
          current = { header: line, columns: words, rows: [] };
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
          program.keyblockCount = Number(words[0]);
          break;
        default:
          section = 'block';
          current = program.blocks[label] ??= [];
      }
    } else if (section === 'macro') program.macros.push([head, words[0] ?? '']);
    else if (section === 'define') {
      const match = /^(\w+)(?:\[(\d+)\])?;?$/.exec(words[0]);
      if (!match) throw new Error(`Invalid FES definition: ${line}`);
      program.definitions.push({
        type: head,
        name: match[1],
        count: match[2] === undefined ? null : Number(match[2]),
      });
    } else if (section === 'object')
      current.rows.push({ target: head, values: words, source: line });
    else if (section === 'block') current.push(line);
    else if (section === 'preload') program.preload.push(head);
    else if (section === 'subcommand')
      program.subcommands[words[0]] = { type: head, words: words.slice(1) };
    else if (section === 'keyblock') {
      const size = words[0]?.split(',').map(Number),
        links = words[1]?.split(',').map(Number),
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
