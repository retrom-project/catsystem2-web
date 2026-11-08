// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESProgram (OWCramer).
// FES permits both C comment forms, including comments in initialization tables.
// Preserve newlines so a comment cannot join two script commands together.
export function uncomment(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (comment) =>
    comment.replace(/[^\r\n]/g, ' '),
  );
}

export function includeNames(text) {
  const result = [];
  let include = false;
  for (const line of uncomment(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) include = trimmed === '#INCLUDE';
    else if (include && trimmed && !trimmed.startsWith(';')) result.push(trimmed);
  }
  return result;
}

export function parseProgram(text, { include } = {}) {
  const program = {
    macros: {},
    definitions: [],
    tables: [],
    blocks: {},
    preload: [],
    subcommands: {},
    keyblocks: [],
  };
  let section = 'ignore',
    current;
  function expand(source, stack = []) {
    const result = [];
    let inserting = false;
    for (const line of uncomment(source).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) inserting = trimmed === '#INCLUDE';
      if (inserting) {
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
        if (stack.includes(trimmed))
          throw new Error(`FES include cycle: ${[...stack, trimmed].join(' -> ')}`);
        const contents = include?.(trimmed);
        if (typeof contents !== 'string') throw new Error(`Unresolved FES include ${trimmed}`);
        result.push(expand(contents, [...stack, trimmed]));
      } else result.push(line);
    }
    return result.join('\n');
  }
  const lines = expand(text)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith(';'));
  // Macro substitution also applies to command names, array lengths and variable
  // indices (e.g. \\COUNT), rather than only to expression operands.
  let macroSection = false;
  for (const line of lines) {
    if (line.startsWith('#')) macroSection = line === '#MACRO';
    else if (macroSection) {
      const [name, ...value] = line.split(/\s+/);
      program.macros[name] = value.join(' ');
    }
  }
  const substitute = (source, stack = []) =>
    source.replace(/[a-z_][a-z_\d]*/gi, (word) => {
      if (!Object.hasOwn(program.macros, word)) return word;
      if (stack.includes(word))
        throw new Error(`FES macro cycle: ${[...stack, word].join(' -> ')}`);
      return substitute(program.macros[word], [...stack, word]);
    });
  for (const raw of lines) {
    const line = section === 'macro' && !raw.startsWith('#') ? raw : substitute(raw);
    const [head, ...words] = line.split(/\s+/);
    if (line.startsWith('#')) {
      const label = head.slice(1);
      switch (label) {
        case 'MACRO':
          section = 'macro';
          break;
        case 'DEFINE':
          section = 'define';
          break;
        case 'OBJECT':
          section = 'object';
          current = { columns: words, rows: [] };
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
          current = program.blocks[label] = [];
      }
    } else if (section === 'macro') program.macros[head] = words.join(' ');
    else if (section === 'define') {
      const match = /^(\w+)(?:\[(\d+)\])?$/.exec(words[0]);
      if (!match) throw new Error(`Invalid FES definition: ${line}`);
      program.definitions.push({
        type: head,
        name: match[1],
        count: match[2] === undefined ? null : Number(match[2]),
      });
    } else if (section === 'object') current.rows.push([head, words]);
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
