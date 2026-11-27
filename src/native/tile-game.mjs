// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { nativeABI } from './abi/index.mjs';
import { NativeTileModel } from './tile-model.mjs';

export const NATIVE_TILE_GAME_IDS = Object.freeze(
  Array.from({ length: 44 }, (_, index) => 0x1d6 + index),
);
export const nativeTileGameCodec = Object.freeze({
  snapshot: (context) => structuredClone(context),
  restore: (state) => structuredClone(state),
});
function actionWords(action, extended = true) {
  const words = [-1, -1, -1, -1],
    kind = action & 0xffff0000,
    first = (action >>> 8) & 15;
  if (kind === 0x10000 || kind === 0x40000) {
    words[0] = first;
    words[1] = (action >>> 12) & 15;
  } else if (kind === 0x20000 || (extended && kind === 0x100000)) {
    words[0] = first;
    words[1] = first + 1;
    words[2] = first + 2;
    if (kind === 0x100000) words[3] = (action >>> 12) & 15;
  } else if (kind === 0x80000 || (extended && kind === 0x1000000)) words[0] = first;
  return words;
}
export class NativeTileGame {
  constructor(world) {
    this.world = world;
    let seed;
    if (nativeABI(world.profile).tileGame?.seedFromLocalClock) {
      const date = new Date(world.clock.utcNow());
      seed = date.getFullYear() - 1900;
      for (const [width, part] of [
        [4, date.getMonth()],
        [5, date.getDate()],
        [5, date.getHours()],
        [6, date.getMinutes()],
        [6, date.getSeconds()],
      ])
        seed = (seed << width) | part;
    }
    this.model = new NativeTileModel(seed, nativeABI(world.profile).tileGame);
  }
  apply(id, args, machine, fromKCSFrame = false) {
    if (!NATIVE_TILE_GAME_IDS.includes(id)) return undefined;
    const abi = nativeABI(this.world.profile),
      declaration = abi.tables.main.entries[id],
      count = declaration.signature.argumentWords,
      readFrame = fromKCSFrame === true && abi.tileGame?.argumentsReadFrame;
    if (!readFrame && args.length !== count)
      throw new Error(`Native tile rules 0x${id.toString(16)} expects ${count} arguments`);
    const argument = (index) => (readFrame ? machine.nativeArgument(index) : args[index]),
      control = declaration.controlCodes[0],
      result = (value) => nativeReply(control, control === 1 ? value >>> 0 : undefined),
      handles = this.world.runtime.handles;
    if (id === 0x1d6)
      return result(
        handles.add('tile-game', {
          eventWords: [],
          choices: [],
          results: [],
          lastEvent: -1,
          pendingEvent: -1,
          pendingWords: [],
        }),
      );
    if (!argument(0)) return result(id === 0x1eb || id === 0x1fa ? -1 : 0);
    const context = handles.get(argument(0), 'tile-game');
    if (id === 0x1d7) {
      handles.release(argument(0), 'tile-game');
      return result();
    }
    const store = (address, value) => {
        try {
          machine.region(address >>> 0, 4);
        } catch (error) {
          if (readFrame) throw error;
          return;
        }
        machine.store(address >>> 0, value);
      },
      load = (address, numericPayment = false) => {
        const word = address >>> 0;
        if (
          readFrame &&
          numericPayment &&
          word < machine.nativeArgumentBase + 4 &&
          word + 4 > machine.nativeArgumentBase
        )
          throw new Error('Native tile payment consumes opaque context pointer bytes');
        try {
          return machine.load(word);
        } catch (error) {
          if (readFrame) throw error;
          return 0;
        }
      },
      write = (address, words) => words.forEach((word, index) => store(address + 4 * index, word)),
      query = (selector, input = []) => this.model.query(selector, input),
      first = (selector, input) => query(selector, input)?.[0] ?? 0,
      command = (code, input) => this.model.command(code, input);
    switch (id) {
      case 0x1d8: {
        const [players, rounds, dealer, redA, redB, redC, profiles, scores] = Array.from(
            { length: 8 },
            (_, index) => argument(index + 1),
          ),
          settings = [0, players, 1, rounds, 2, dealer, 3, redA, redB, redC];
        if ((players | 0) > 0x100000)
          throw new RangeError('Native tile player setup exceeds its resource limit');
        for (let index = 1; index < (players | 0); index++)
          settings.push(4, index, load(profiles + (index - 1) * 4));
        for (let index = 0; index < 4; index++) {
          const score = load(scores + index * 4);
          if ((score | 0) > 0) settings.push(5, index, score);
        }
        context.eventWords = settings;
        command(10001, settings);
        command(10002, settings);
        return result();
      }
      case 0x1d9: {
        if (context.pendingEvent !== -1) {
          context.eventWords = context.pendingWords.slice();
          context.pendingWords = [];
          const event = context.pendingEvent;
          context.pendingEvent = -1;
          return result(event);
        }
        context.eventWords = query(0) ?? [];
        const event = context.eventWords[0] ?? 0;
        if (event === 10003) command(10003, context.eventWords);
        if (event === 20050) context.results = query(15, [first(2)]) ?? [];
        if (event === 20066) context.choices = query(30, [0]) ?? [];
        context.lastEvent = event;
        return result(event);
      }
      case 0x1da:
        command(10006, [argument(1)]);
        return result();
      case 0x1db:
        return result(first(1));
      case 0x1dc:
        return result(first(2));
      case 0x1dd:
      case 0x1de:
      case 0x1df: {
        const words = query(5 + id - 0x1dd, [argument(1)]) ?? [];
        write(argument(2), words);
        return result(words.length);
      }
      case 0x1e0:
        return result(context.eventWords[((argument(1) >>> 0) + 1) >>> 0] ?? 0);
      case 0x1e1:
        return result(context.eventWords.length - 1);
      case 0x1e2: {
        const reference = argument(1),
          targets = Array.from({ length: 3 }, (_, index) => argument(index + 2));
        [reference & 0xff0000, (reference >>> 8) & 255, reference & 255].forEach((word, index) =>
          store(targets[index], word),
        );
        return result();
      }
      case 0x1e3:
        command(10004, [argument(1), argument(2)]);
        return result();
      case 0x1e4:
        return result(first(3, [0]));
      case 0x1e5: {
        const response = command(10008, [0, argument(1)]);
        context.choices = query(4, [0]) ?? [];
        return result(response.words[0] ?? 0);
      }
      case 0x1e6: {
        const action = context.choices[argument(1) >>> 0];
        if (action === undefined) return result(0);
        write(argument(2), actionWords(action));
        return result(1);
      }
      case 0x1e7:
      case 0x1fe: {
        const selector = id === 0x1e7 ? 4 : 29;
        if (id === 0x1e7) query(4, [0, -1]);
        const action = query(selector, id === 0x1e7 ? [0, argument(1)] : [argument(1)])?.[
          argument(2) >>> 0
        ];
        if (action === undefined) return result(0);
        write(argument(3), actionWords(action, id === 0x1e7));
        return result(1);
      }
      case 0x1e8:
        command(10007, [argument(1)]);
        return result();
      case 0x1e9:
        command(10005, [argument(2), argument(1), argument(3)]);
        return result();
      case 0x1ea: {
        const packed = context.results[argument(1) >>> 0];
        if (packed === undefined) return result(0);
        const low = packed & 0xffff,
          firstOutput = argument(2),
          secondOutput = argument(3);
        store(firstOutput, low >= 256 ? low - 157 : low);
        store(secondOutput, packed >>> 16);
        return result(1);
      }
      case 0x1eb:
        return result(query(11, [(4 - argument(1)) >>> 0, argument(2)])?.[0] ?? -1);
      case 0x1ec:
        return result(first(23));
      case 0x1ed:
        return result(first(26, [argument(1)]));
      case 0x1ee: {
        Array.from({ length: 5 }, (_, index) => argument(index + 2)).forEach((address) =>
          store(address, 0),
        );
        const words = query(16, [argument(1)]);
        if (words) words.slice(0, 5).forEach((word, index) => store(argument(2 + index), word));
        return result();
      }
      case 0x1ef:
        return result(first(18, [argument(1)]));
      case 0x1f0: {
        const targets = Array.from({ length: 4 }, (_, index) => argument(index + 1));
        targets.slice(0, 3).forEach((address) => store(address, 0));
        write(targets[3], [0, 1, 2, 3]);
        query(21)
          ?.slice(0, 3)
          .forEach((word, index) => store(targets[index], word));
        write(targets[3], query(22) ?? []);
        return result();
      }
      case 0x1f1:
        return result(Number(Boolean(first(14, [argument(1)]))));
      case 0x1f2: {
        const words = query(17, [argument(1)]);
        if (!words?.length) return result(0);
        write(
          argument(2),
          words.map((value) => value * 16),
        );
        return result(words.length);
      }
      case 0x1f3:
        return result(first(24));
      case 0x1f4:
        return result(first(25));
      case 0x1f5:
        context.pendingWords = context.eventWords.slice();
        context.pendingEvent = context.lastEvent;
        return result();
      case 0x1f6: {
        write(argument(1), [0, 0, 0, 0]);
        const words = query(19);
        if (!words?.length) return result(0);
        write(argument(1), words);
        return result(1);
      }
      case 0x1f7: {
        const size = first(1),
          input = argument(1),
          numericPayment = this.model.acceptsPayment(size),
          words = Array.from({ length: size }, (_, index) =>
            load(input + 4 * index, numericPayment),
          );
        return result(Number(command(10009, words).ok));
      }
      case 0x1f8:
        return result(first(12));
      case 0x1f9: {
        const code = argument(1),
          size = Math.max(0, argument(2) | 0),
          input = argument(3),
          numericPayment = code === 10009 && this.model.acceptsPayment(size);
        if (size > 0x1000000)
          throw new RangeError('Native tile command exceeds its resource limit');
        return result(
          Number(
            command(
              code,
              Array.from({ length: size }, (_, index) => load(input + 4 * index, numericPayment)),
            ).ok,
          ),
        );
      }
      case 0x1fa:
        return result(context.choices[argument(1) >>> 0] ?? -1);
      case 0x1fb:
        return result(Number(command(10014, [0, argument(1)]).ok));
      case 0x1fc:
        return result(first(28, [0]));
      case 0x1fd:
        return result(command(10014, [0, argument(1), argument(2)]).words[0] ?? 0);
      case 0x1ff:
        return result(Number(command(10012, [argument(1)]).ok));
      case 0x200: {
        const words = query(11);
        if (!words || words.length < 14) return result(0);
        write(argument(1), words.slice(0, 14));
        return result(1);
      }
      case 0x201:
        return result(first(4, [argument(1)]));
    }
  }
  snapshot() {
    return this.model.snapshot();
  }
  restore(state) {
    this.model.restore(state);
  }
}
export function installNativeTileGame(world) {
  world.tileGame = new NativeTileGame(world);
  for (const id of NATIVE_TILE_GAME_IDS)
    world.runtime.register('main', id, (args, machine, _task, scheduler) =>
      world.tileGame.apply(id, args, machine, Boolean(scheduler)),
    );
}
