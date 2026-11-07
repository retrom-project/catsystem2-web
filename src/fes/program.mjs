// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESProgram (OWCramer).
export function parseProgram(text) {
  const program = {
    macros: {},
    definitions: [],
    tables: [],
    blocks: {},
    preload: [],
    subcommands: {},
  };
  let section = 'ignore',
    current;
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(\/\/|;)/.test(s))) {
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
          section = 'ignore';
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
  }
  return program;
}
