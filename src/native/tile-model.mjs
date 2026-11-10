// SPDX-License-Identifier: MPL-2.0
import { NativeTileHands, sortTileHand as sortHand } from './tile-hands.mjs';
import { NativeTileSpecial } from './tile-special.mjs';
import { NativeTileRound } from './tile-round.mjs';
import { NativeTileActions } from './tile-actions.mjs';
import { NativeMT19937 } from '../ppi/random.mjs';
// The canonical JS record stores tile/hand/rule words and packed byte flags.
// Walls use 35 words, rivers 33, and hands 119. Hand words 0..17 hold cards,
// 18..47 hold melds, and bytes 432..468 hold declarations and abilities.
// The four action vectors, event continuation stack and tile MT stream are
// separately owned JS values. The record contains no process pointers.
const field = Object.freeze({
  players: 2066,
  rounds: 2067,
  startingDealer: 2068,
  red: 2069,
  profiles: 2073,
  startingScores: 2077,
  settings: 2081,
  firstDealer: 2096,
  dealer: 2097,
  wind: 2098,
  round: 2099,
  repeat: 2100,
  deposits: 2101,
  drawReason: 2102,
  current: 2103,
  specialPlayer: 2104,
  lastRound: 2105,
  dealMask: 2107,
  discardIndex: 2108,
  wallCursor: 2109,
  replacementCursor: 2110,
  remaining: 2111,
  doraIndex: 2112,
  doraCount: 2113,
  pendingDora: 2115,
  kans: 2116,
  kanMask: 2117,
  robbedTile: 2118,
  drawRow: 2122,
  drawColumn: 2123,
  lastDiscardPlayer: 2124,
  lastDiscardIndex: 2125,
  lastDiscardType: 2126,
  indicatorRow: 2127,
  indicatorColumn: 2128,
  discardChoice: 2129,
  next: 2133,
  event: 2134,
});
const styleFlags = [0, 3, 1, 3, 1, 1, 7, 0, 1, 3, 0, 1, 3, 3, 39, 3, 3, 3, 7, 3];
export class NativeTileModel {
  constructor() {
    this.random = new NativeMT19937();
    let seed = 4357;
    for (let index = 0; index < 624; index++) {
      this.random.words[index] = seed;
      seed = Math.imul(seed, 69069) >>> 0;
    }

    this.words = new Int32Array(2464);
    this.hands = new NativeTileHands(this);
    this.rules = new NativeTileActions(this);
    this.round = new NativeTileRound(this);
    this.special = new NativeTileSpecial(this);
    this.actions = Array.from({ length: 4 }, () => []);
    this.savedActions = Array.from({ length: 4 }, () => []);
    this.continuations = [];
    this.pendingActions = [];
    this.words.set(Array.from({ length: 136 }, (_, index) => index));
    this.words.set([4, 2, 0, 1, 2, 1, 0, 0, 0, 0, 0, 25000, 25000, 25000, 25000], 2066);
    this.words.set(this.words.slice(2066, 2081), 2081);
    for (let player = 0; player < 4; player++) this.resetHand(player);
  }
  get(name) {
    return this.words[field[name]];
  }
  set(name, value) {
    this.words[field[name]] = value;
    return value;
  }
  hand(player) {
    return this.words.subarray(408 + 119 * player, 527 + 119 * player);
  }
  wall(row) {
    return this.words.subarray(136 + 35 * row, 171 + 35 * row);
  }
  river(player) {
    return this.words.subarray(276 + 33 * player, 309 + 33 * player);
  }
  resetHand(player) {
    const words = this.hand(player),
      bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength);
    words[17] = words[48] = words[107] = 0;
    words[108] = 256;
    words[109] = 0x1000000;
    words[110] = 1;
    for (const index of [22, 28, 34, 40]) words[index] = 0;
    bytes.fill(0, 444, 469);
    words[118] = 0;
  }
  snapshot() {
    return {
      random: this.random.snapshot(),
      words: this.words.slice(),
      actions: structuredClone(this.actions),
      savedActions: structuredClone(this.savedActions),
      continuations: this.continuations.slice(),
      pendingActions: this.pendingActions.slice(),
    };
  }
  restore(state) {
    this.random.restore(state.random);
    this.words.set(state.words);
    this.actions = structuredClone(state.actions);
    this.savedActions = structuredClone(state.savedActions);
    this.continuations = state.continuations.slice();
    this.pendingActions = state.pendingActions.slice();
  }
  validPlayer(player) {
    return player >= 0 && player < this.get('players');
  }
  playerField(input, base) {
    if (!input.length) return Array.from(this.words.subarray(base, base + this.get('players')));
    return this.validPlayer(input[0] | 0) ? [this.words[base + (input[0] | 0)]] : null;
  }
  reference(reference) {
    const kind = reference & 0xff0000,
      row = (reference >>> 8) & 255,
      index = reference & 255;
    if (kind === 0) {
      const wall = this.wall(row);
      return wall && index < wall[34] ? { words: wall, index } : null;
    }
    if (!this.validPlayer(row)) return null;
    if (kind === 0x10000) {
      const river = this.river(row);
      return index < river[32] ? { words: river, index } : null;
    }
    if (kind === 0x20000) {
      const hand = this.hand(row);
      return index < hand[17] ? { words: hand, index } : null;
    }
    return null;
  }
  indicator(index, under) {
    const position = this.words[945 + index] - under,
      row = Math.trunc(position / 34),
      column = position % 34;
    this.set('indicatorRow', row);
    this.set('indicatorColumn', column);
    const wall = this.wall(row);
    return column >= 0 && column < wall?.[34] ? wall[column] : 0;
  }
  drawAt(position) {
    const absolute = this.words[884 + (position >> 1)] - (position & 1),
      row = Math.trunc(absolute / 34),
      column = absolute % 34,
      wall = this.wall(row);
    this.set('drawRow', row);
    this.set('drawColumn', column);
    if (!wall || column < 0 || column >= wall[34]) throw Error('Native tile draw crosses its wall');
    const tile = wall[column];
    if (tile < 0) return -1;
    wall[column] = tile | 0x80000000;
    return tile;
  }
  draw() {
    for (let attempt = 0; attempt < 136; attempt++) {
      const tile = this.drawAt(this.get('wallCursor'));
      this.set('wallCursor', (this.get('wallCursor') + 1) % 136);
      if (tile >= 0) return tile;
    }
    throw Error('Native tile wall has no remaining tile');
  }
  addDraw(words, tile) {
    const hand = this.hand(this.get('current'));
    words.push(
      tile,
      (this.get('drawRow') << 8) | this.get('drawColumn'),
      0x20000 | (this.get('current') << 8) | hand[17],
    );
    if (hand[17] < 16) hand[hand[17]++] = tile;
    hand[16] = tile;
    this.set('remaining', this.get('remaining') - 1);
  }
  settings(input) {
    let at = 0;
    while (at + 1 < input.length) {
      const kind = input[at++] | 0,
        value = input[at++] | 0;
      if (kind === 0) this.words[2081] = value === 2 ? 2 : 4;
      else if (kind === 1 || kind === 2) this.words[2081 + kind] = value;
      else if (kind === 3 && at + 1 < input.length) {
        this.words.set([value, input[at++], input[at++]], 2084);
      } else if ((kind === 4 || kind === 5) && at < input.length) {
        if (value >= 0 && value < this.words[2081])
          this.words[(kind === 4 ? 2088 : 2092) + value] = input[at];
        at++;
      }
    }
  }
  start() {
    this.words.copyWithin(2066, 2081, 2096);
    if (this.get('players') !== 2) this.set('players', 4);
    const dealer = this.get('startingDealer');
    this.set('firstDealer', dealer);
    this.set('dealer', dealer);
    for (const name of ['wind', 'round', 'repeat', 'deposits']) this.set(name, 0);
    this.set('lastRound', this.get('rounds'));
    for (let player = 0; player < this.get('players'); player++) {
      this.words[952 + player] = this.words[2077 + player];
      this.words[956 + player] = 0;
    }
    this.set('next', 10003);
    this.set('remaining', this.get('players') === 4 ? 122 : 61);
  }
  shuffle() {
    this.continuations = [];
    const bytes = new Uint8Array(this.words.buffer);
    bytes[8424] = 1;
    bytes[8425] = bytes[8456] = 0;
    this.set('pendingDora', 0);
    this.set('discardIndex', -1);
    for (let player = 0; player < 4; player++) {
      this.wall(player)[34] = this.river(player)[32] = 0;
      this.resetHand(player);
      const profile = this.words[2073 + player];
      const ai = this.words.subarray(962 + 276 * player, 1238 + 276 * player);
      ai[14] = profile >= 0 && profile < 20 ? profile : 0;
      ai[15] = styleFlags[ai[14]];
    }
    const deck = Array.from({ length: 136 }, (_, index) => index);
    for (let index = 0; index < 136; index++) {
      const other = this.random.nextUint32() % 136;
      [deck[index], deck[other]] = [deck[other], deck[index]];
    }
    for (let index = 0; index < 136; index++) {
      const identity = deck[index],
        copy = identity & 3,
        kind = identity >>> 2,
        suit = Math.trunc(kind / 9),
        rank = kind % 9,
        red = suit < 3 && rank === 4 && copy < this.words[field.red + suit];
      this.wall(Math.trunc(index / 34))[index % 34] =
        copy | (rank << 4) | (suit << 8) | (red ? 0x1000 : 0);
    }
    for (let row = 0; row < 4; row++) this.wall(row)[34] = 34;
    this.set('doraIndex', -1);
    this.set('remaining', this.get('players') === 4 ? 122 : 61);
    this.set('next', 10004);
  }
  dice(input) {
    if (input.length !== 2 || input.some((value) => (value | 0) < 1 || (value | 0) > 6))
      return false;
    const sum = input[0] + input[1];
    let row = (sum + this.get('dealer') - 1) & 3,
      column = 33 - 2 * sum;
    for (let index = 0; index < 68; index++) {
      this.words[884 + index] = column + 34 * row;
      if (column <= 1) {
        column = 33;
        row = (row - 1) & 3;
      } else column -= 2;
    }
    for (const name of [
      'wallCursor',
      'replacementCursor',
      'doraIndex',
      'doraCount',
      'kans',
      'kanMask',
    ])
      this.set(name, 0);
    this.set('next', 20001);
    return true;
  }
  wallReference(position) {
    const absolute = this.words[884 + (position >> 1)] - (position & 1),
      row = Math.trunc(absolute / 34),
      index = absolute % 34;
    if (row < 0 || row > 3 || index < 0 || index >= this.wall(row)[34])
      throw Error('Native tile reference crosses its wall');
    return { words: this.wall(row), index };
  }
  swapWall(a, b) {
    const first = this.wallReference(a),
      second = this.wallReference(b);
    [first.words[first.index], second.words[second.index]] = [
      second.words[second.index],
      first.words[first.index],
    ];
  }
  randomize(values, count = values.length) {
    for (let index = 0; index < Math.min(count, values.length); index++) {
      const other = (this.random.nextUint32() & 0xffff) % values.length;
      [values[index], values[other]] = [values[other], values[index]];
    }
  }
  dealPositions(player) {
    return Array.from({ length: 13 }, (_, index) =>
      index >= 12
        ? player + 12 * this.get('players')
        : (index & 3) + this.get('players') * (index & ~3) + 4 * player,
    );
  }
  buildPool(player) {
    this.words.fill(0, 2138, 2462);
    const add = (position) => {
      const ref = this.wallReference(position),
        kind = (ref.words[ref.index] >>> 4) & 63,
        count = 2138 + 5 * kind + 4;
      this.words[2138 + 5 * kind + this.words[count]++] = position;
      this.words[2458 + (kind >>> 4)]++;
    };
    for (let position = 13 * this.get('players'); position < 122; position++) add(position);
    if (new Uint8Array(this.words.buffer)[9848])
      for (let other = 0; other < this.get('players'); other++)
        if (other !== player) for (const position of this.dealPositions(other)) add(position);
  }
  poolCount(kind, value) {
    const index = 2142 + 5 * kind;
    if (value === undefined) return this.words[index];
    this.words[index] = value;
  }
  selectPool(output, size, count) {
    for (let groupSize = size, remaining = count; groupSize > 0 && remaining > 0; groupSize--) {
      const kinds = [];
      for (let kind = 0; kind < 64; kind++) if (this.poolCount(kind) >= groupSize) kinds.push(kind);
      this.randomize(kinds, remaining);
      const selected = Math.min(remaining, kinds.length);
      for (const kind of kinds.slice(0, selected))
        for (let item = 0; item < groupSize; item++) {
          const available = this.poolCount(kind);
          if (!available) break;
          const chosen = (this.random.nextUint32() & 0xffff) % available,
            last = available - 1,
            base = 2138 + 5 * kind;
          [this.words[base + chosen], this.words[base + last]] = [
            this.words[base + last],
            this.words[base + chosen],
          ];
          this.poolCount(kind, last);
          output.push(this.words[base + last]);
        }
      remaining -= selected;
    }
  }
  applyPool(player, selected) {
    const positions = this.dealPositions(player);
    this.randomize(positions);
    for (let index = 0; index < Math.min(positions.length, selected.length); index++)
      this.swapWall(positions[index], selected[index]);
    if (selected.length > 13) this.swapWall(player + 13 * this.get('players'), selected[12]);
  }
  preparePolicy(player, kind, strength) {
    const power = Math.max(1, Math.min(5, strength | 0)),
      selected = [];
    this.buildPool(player);
    if (kind === 2) {
      const count = power + 8;
      for (let tile = 0; tile < 64; tile++)
        if (tile >= 48 || (tile & 15) <= 1 || (tile & 15) >= 7)
          this.poolCount(tile, -this.poolCount(tile));
      for (let left = count; left > 0; left -= 3) this.selectPool(selected, 1, Math.min(3, left));
      for (let tile = 0; tile < 64; tile++) this.poolCount(tile, -this.poolCount(tile));
      for (let left = 13 - count; left > 0; left--) this.selectPool(selected, 1, 1);
    } else if (kind === 3) {
      for (let tile = 0; tile < 48; tile++) this.poolCount(tile, 0);
      this.selectPool(selected, 3, [1, 0, 1, 2, 2][power - 1]);
      this.selectPool(selected, 2, [0, 2, 1, 0, 1][power - 1]);
    } else if (kind === 4) {
      this.selectPool(selected, 3, Math.trunc((power + 1) / 2));
      this.selectPool(selected, 2, (power + 1) & 1);
    } else if (kind === 5 || kind === 6) {
      let suit = 0;
      if (this.words[2458] < this.words[2459]) suit = 1;
      if (this.words[2458 + suit] < this.words[2460]) suit = 2;
      for (let tile = 0; tile < (kind === 5 ? 48 : 64); tile++)
        if (tile >>> 4 !== suit) this.poolCount(tile, 0);
      if (kind === 6) {
        for (let left = power + 7; left > 0; left -= 3)
          this.selectPool(selected, 1, Math.min(3, left));
      } else {
        for (let tile = 48; tile <= 54; tile++) this.poolCount(tile, -this.poolCount(tile));
        for (let left = [5, 6, 5, 6, 6][power - 1]; left > 0; left -= 2)
          this.selectPool(selected, 1, Math.min(2, left));
        for (let tile = 0; tile < 48; tile++) this.poolCount(tile, 0);
        for (let tile = 48; tile <= 54; tile++) this.poolCount(tile, -this.poolCount(tile));
        let triples = [0, 0, 1, 1, 2][power - 1];
        if (triples > 0) {
          this.selectPool(selected, 3, 1);
          triples--;
        }
        this.selectPool(selected, 2, [2, 2, 1, 1, 0][power - 1]);
        if (triples > 0) {
          for (let tile = 52; tile <= 54; tile++) this.poolCount(tile, 0);
          this.selectPool(selected, 3, 1);
        }
      }
    } else if (this.special.policy(player, kind, kind === 7 ? strength | 0 : power, selected))
      return;
    this.applyPool(player, selected);
  }
  preparePlayers() {
    const policy = {
        0: [5, 1],
        1: [4, 1],
        2: [2, 2],
        4: [3, 1],
        5: [1, 1],
        7: [1, 1],
        8: [2, 1],
        10: [6, 1],
        11: [0, 1],
        12: [1, 1],
        13: [1, 1],
      },
      bytes = new Uint8Array(this.words.buffer);
    for (let player = 1; player < this.get('players'); player++) {
      if (this.get('dealMask') & (1 << player)) continue;
      this.set('dealMask', this.get('dealMask') | (1 << player));
      const profile = this.words[962 + 276 * player + 14],
        rule = policy[profile];
      bytes[9848] = 0;
      if (rule?.[0])
        this.preparePolicy(
          (player + this.get('players') - this.get('dealer')) % this.get('players'),
          ...rule,
        );
    }
  }
  command(code, input) {
    const words = input.map((value) => value | 0);
    let ok = false;
    if (code === 10001) {
      this.settings(words);
      ok = true;
    } else if (code === 10002) {
      this.start();
      ok = true;
    } else if (code === 10003 && this.get('next') === 10003) {
      this.shuffle();
      ok = true;
    } else if (code === 10004 && this.get('next') === 10004) ok = this.dice(words);
    else if (
      (this.get('next') === 20043 || this.get('next') === 20020) &&
      code === 10006 &&
      words.length
    ) {
      const hand = this.hand(this.get('current')),
        index = words[0];
      this.set('discardChoice', index);
      if (index < hand[17]) {
        if (index < 0) this.set('discardChoice', hand[17] - 1);
        this.set('next', 20017);
        ok = true;
      }
    } else if (
      code === 10009 &&
      [20051, 20053, 20055, 20057].includes(this.get('event')) &&
      words.length === this.get('players')
    ) {
      this.words.set(words, 956);
      ok = true;
    } else if (code === 10015) ok = true;
    else if (code === 10016 && words.length === 2) {
      const refs = words.map((value) => this.reference(value));
      if (refs.every((value) => value && (value.words[value.index] & 4) === 0)) {
        const [a, b] = refs;
        [a.words[a.index], b.words[b.index]] = [b.words[b.index], a.words[a.index]];
        ok = true;
      }
    } else if (code === 10017) {
      for (let player = 0; player < this.get('players'); player++) sortHand(this.hand(player));
      ok = true;
    } else if (code === 10010 && words.length) {
      const player = words.length >= 2 ? words[0] : this.get('current'),
        ability = words.length >= 2 ? words[1] : words[0];
      ok = this.activateAbility(player, ability);
    } else if (code === 10011) {
      const player = words.length ? words[0] : this.get('current');
      if (player >= 0 && player <= this.get('players')) {
        const bytes = new Uint8Array(this.words.buffer, 1632 + 476 * player);
        for (let i = 0; i < 8; i++) bytes[445 + 3 * i] = 0;
        ok = true;
      }
    } else if (code === 10005 && this.get('event') === 20001 && words.length >= 3) {
      const [kind, player, power] = words;
      if (this.validPlayer(player) && power >= 0) {
        new Uint8Array(this.words.buffer)[9848] = Number(player === 0);
        this.set('dealMask', this.get('dealMask') | (1 << player));
        if (kind >= 0 && kind <= 7) {
          this.preparePolicy(
            (player + this.get('players') - this.get('dealer')) % this.get('players'),
            kind,
            power,
          );
          ok = true;
        }
      }
    } else if (code === 10007 && [20020, 20021].includes(this.get('event')) && words.length) {
      const selected = this.actions[0][words[0]];
      if (words[0] >= 0 && selected !== undefined) {
        this.pendingActions = [selected];
        const kind = selected & 0xffff0000,
          next =
            this.get('event') === 20020
              ? ({ [0x1000000]: 20028, [0x80000]: 20032, [0x100000]: 20030, [0x20000000]: 20026 }[
                  kind
                ] ?? 20042)
              : ({ [0x40000]: 20040, [0x10000]: 20036, [0x20000]: 20038, [0x10000000]: 20034 }[
                  kind
                ] ?? 20046);
        this.set('next', next);
        if (next === 20028) this.set('discardChoice', (selected >>> 8) & 15);
        ok = true;
      }
    } else if (code === 10008 && [20020, 20021].includes(this.get('event')) && words.length >= 2) {
      const [player, mask] = words;
      if (this.validPlayer(player)) {
        this.actions[player] = this.savedActions[player].slice();
        if (this.actions[player].length && mask & 0xffff0000) {
          if (this.actions[player].some((action) => action & mask))
            this.actions[player] = this.actions[player].filter((action) => action & mask);
          words.splice(0, words.length, this.actions[player].length);
          ok = true;
        }
      }
    } else if (code === 10012 && this.get('event') === 20066 && words.length) {
      const action = this.pendingActions[words[0]];
      if (words[0] >= 0 && action !== undefined) {
        this.pendingActions = [action];
        const next = { [0x10000]: 20067, [0x20000]: 20069, [0x40000]: 20071 }[action & 0xffff0000];
        if (next) this.set('next', next);
        ok = true;
      }
    } else if (
      (code === 10013 || code === 10014) &&
      this.get('event') === 20066 &&
      words.length >= 2 &&
      this.validPlayer(words[0])
    ) {
      if (code === 10013 && !(words[1] & 0xffff0000)) return { ok: false, words };
      const mask =
          code === 10013 ? words[1] & 0xffff0000 : words.length >= 3 ? words[2] & 0xffff0000 : -1,
        choice = words[1] & 255;
      words.length = 0;
      if (this.historicalActions(mask)) {
        if (code === 10014)
          this.pendingActions = this.pendingActions.filter((action) => (action & 255) === choice);
        words.push(this.pendingActions.length);
        ok = true;
      }
    }
    return { ok, words };
  }
  query(selector, input = []) {
    const player = (input[0] ?? 0) | 0;
    switch (selector) {
      case 0:
        return this.nextEvent();
      case 1:
        return [this.get('players')];
      case 2:
        return [this.get('current')];
      case 3:
        return input.length ? [this.hand((input[0] >>> 0) % this.get('players'))[104]] : null;
      case 4: {
        if (!input.length) return null;
        const actions = this.actions[(input[0] >>> 0) % this.get('players')];
        if (input.length === 1) return actions.slice();
        const selected = [];
        for (const action of actions) {
          if (action < 0) break;
          if (action & input[1]) selected.push(action);
        }
        return selected;
      }
      case 5:
      case 6:
      case 7: {
        if (!input.length) return null;
        const record =
            selector === 5
              ? this.wall(player & 3)
              : selector === 6
                ? this.river(player & 3)
                : this.hand(player & 3),
          count = selector === 5 ? record[34] : selector === 6 ? record[32] : record[17];
        return Array.from(record.subarray(0, Math.max(0, count)));
      }
      case 8:
      case 9:
      case 10: {
        if (!input.length) return null;
        const hand = this.hand(input[0] & 3);
        if (selector === 10 && input.length === 1) return [hand[48]];
        if (input.length < 2) return null;
        const index = selector === 10 ? input[1] & 3 : input[1] | 0;
        if (index < 0 || index >= hand[48]) return selector === 10 ? [0] : null;
        const at = 18 + 6 * index;
        return selector === 8
          ? Array.from(hand.subarray(at, at + Math.max(0, hand[at + 4])))
          : [hand[at + (selector === 9 ? 5 : 4)]];
      }
      case 27: {
        if (!this.validPlayer(player)) return null;
        const bytes = this.rules.bytes(player);
        return Array.from({ length: 8 }, (_, i) => i).filter((i) => bytes[445 + 3 * i]);
      }
      case 31: {
        if (!this.validPlayer(player)) return null;
        const bytes = this.rules.bytes(player);
        return Array.from({ length: 8 }, (_, i) => [
          Number(Boolean(bytes[445 + 3 * i])),
          Number(Boolean(bytes[446 + 3 * i])),
        ]).flat();
      }
      case 11: {
        if (input.length) {
          if (input[0] >>> 0 > 7) return null;
          return [this.indicator(input[0], (input[1] ?? 0) & 1)];
        }
        if (this.get('doraIndex') < 0) return null;
        return Array.from({ length: 7 }, (_, index) => [
          this.indicator(index, 1),
          this.indicator(index, 0),
        ]).flat();
      }
      case 12:
        return [this.words[2113]];
      case 13:
        return this.validPlayer(player)
          ? [
              new Uint8Array(this.hand(player).buffer, this.hand(player).byteOffset, 476)[432]
                ? -1
                : 0,
            ]
          : null;
      case 14:
        return this.validPlayer(player) ? [this.hands.waits(player)?.length ? -1 : 0] : [0];
      case 15:
        return this.validPlayer(player) ? this.hands.score(player).patterns : null;
      case 16: {
        if (!this.validPlayer(player)) return null;
        const score = this.hands.score(player);
        return score.score
          ? [score.score, score.fu || 25, score.han, score.limit, score.multipliers]
          : [0];
      }
      case 17: {
        const current = this.get('current'),
          hand = this.hand(current);
        if (hand[17] + hand[48] * 3 !== 14) return null;
        const waits = this.hands.waits(current, input[0] | 0);
        return waits?.length ? waits : null;
      }
      case 26:
        return this.validPlayer(player) ? [this.hands.bestDiscard(player)] : null;
      case 18:
        return this.playerField(input, 952);
      case 19:
        return this.playerField(input, 956);
      case 20: {
        if (input.length && !this.validPlayer(player)) return null;
        const players = input.length
          ? [player]
          : Array.from({ length: this.get('players') }, (_, index) => index);
        return players.map(
          (index) =>
            Array.from(this.words.subarray(952, 952 + this.get('players'))).filter(
              (score, other) => other !== index && this.words[952 + index] > score,
            ).length,
        );
      }
      case 21:
        return [this.get('wind'), this.get('round'), this.get('firstDealer')];
      case 22: {
        if (input.length && !this.validPlayer(player)) return null;
        return (
          input.length ? [player] : Array.from({ length: this.get('players') }, (_, index) => index)
        ).map((index) => (index + this.get('players') - this.get('dealer')) % this.get('players'));
      }
      case 23:
        return [this.get('remaining')];
      case 24:
        return [this.get('repeat')];
      case 25:
        return [this.get('deposits')];
      case 28:
        return this.pendingActions.length
          ? [this.pendingActions.reduce((flags, action) => flags | (action & 0xffff0000), 0)]
          : null;
      case 29:
        return this.pendingActions.length ? this.pendingActions.slice() : null;
      case 30:
        return this.pendingActions.length
          ? [...new Set(this.pendingActions.map((action) => action & 255))]
          : null;
      default:
        return null;
    }
  }
  activateAbility(player, ability) {
    return this.special.activate(player, ability);
  }
  applyAbilities() {
    return this.special.apply(this.get('current'));
  }
  preAction(player) {
    return this.special.beforeAction(player);
  }
  beforeDrawAbility(player) {
    return this.special.beforeDraw(player);
  }
  afterWinAbility(player, payment) {
    return this.special.afterWin(player, payment);
  }
  forceDraw() {
    return this.special.forceDraw();
  }
  forceKan(action) {
    return this.special.forceKan(action);
  }
  historicalActions(mask) {
    return this.special.historical(mask);
  }
  nextEvent() {
    return this.round.next();
  }
  fourKans() {
    return this.get('kans') >= 4 && ![0, 1, 2, 4, 8].includes(this.get('kanMask'));
  }
}
