// SPDX-License-Identifier: MPL-2.0
const typeOf = (tile) => (tile >>> 4) & 63;
const sequence = (group) => Boolean(group & 0x20040000);
const terminal = (type) => type >>> 4 === 3 || (type & 15) === 0 || (type & 15) === 8;
const orphans = [0, 8, 16, 24, 32, 40, 48, 49, 50, 51, 52, 53, 54];
function countsOf(tiles) {
  const counts = new Int32Array(64);
  for (const tile of tiles) counts[typeOf(tile)]++;
  return counts;
}
function configurations(counts, needed) {
  const results = [];
  function groups(left, remaining, output, pair) {
    let type = 0;
    while (type < 64 && !left[type]) type++;
    if (type === 64) {
      if (!remaining) results.push({ pair, groups: output.slice() });
      return;
    }
    if (!remaining) return;
    if (left[type] >= 3) {
      left[type] -= 3;
      output.push(type | 0x10000000);
      groups(left, remaining - 1, output, pair);
      output.pop();
      left[type] += 3;
    }
    if (type < 48 && (type & 15) < 7 && left[type + 1] && left[type + 2]) {
      left[type]--;
      left[type + 1]--;
      left[type + 2]--;
      output.push(type | 0x20000000);
      groups(left, remaining - 1, output, pair);
      output.pop();
      left[type]++;
      left[type + 1]++;
      left[type + 2]++;
    }
  }
  for (let pair = 0; pair < 64; pair++)
    if (counts[pair] >= 2) {
      counts[pair] -= 2;
      groups(counts, needed, [], pair);
      counts[pair] += 2;
    }
  return results;
}
function shape(tiles, meldCount) {
  const counts = countsOf(tiles);
  if (tiles.length + 3 * meldCount !== 14) return [];
  const result = configurations(counts, 4 - meldCount);
  if (!meldCount && !result.length) {
    if (orphans.every((type) => counts[type]) && orphans.some((type) => counts[type] === 2))
      result.push({ special: 'orphans' });
    else if (Array.from(counts).filter((value) => value === 2).length === 7)
      result.push({ special: 'pairs' });
  }
  return result;
}
function handBytes(hand) {
  return new Uint8Array(hand.buffer, hand.byteOffset, 476);
}
export function sortTileHand(words) {
  const count = words[17] | 0;
  let index = 0;
  for (; index < count; index++) {
    let least = index,
      key = (words[index] & 0x800003ff) >>> 0;
    for (let next = index + 1; next < count; next++) {
      const candidate = (words[next] & 0x800003ff) >>> 0;
      if (candidate < key) {
        key = candidate;
        least = next;
      }
    }
    if (key & 0x80000000) break;
    [words[index], words[least]] = [words[least], words[index]];
  }
  words[17] = index;
}

export class NativeTileHands {
  constructor(model) {
    this.model = model;
  }
  tiles(player) {
    const hand = this.model.hand(player);
    return Array.from(hand.subarray(0, Math.max(0, hand[17])));
  }
  melds(player) {
    const hand = this.model.hand(player),
      result = [];
    for (let index = 0; index < hand[48]; index++) {
      const at = 18 + 6 * index,
        tiles = Array.from(hand.subarray(at, at + Math.max(0, hand[at + 4]))),
        flags = hand[at + 5];
      result.push({ tiles, flags });
    }
    return result;
  }
  waits(player, discard = -1) {
    const tiles = this.tiles(player),
      melds = this.melds(player);
    if (discard >= 0 && discard < tiles.length) tiles.splice(discard, 1);
    if (tiles.length + 3 * melds.length !== 13) return null;
    const available = [];
    for (let suit = 0; suit < 4; suit++)
      for (let rank = 0; rank < (suit === 3 ? 7 : 9); rank++) {
        const kind = (suit << 4) | rank;
        if (shape([...tiles, kind << 4], melds.length).length) available.push(kind);
      }
    return available;
  }
  remainingTiles(player) {
    const result = new Int32Array(64);
    for (let suit = 0; suit < 4; suit++)
      for (let rank = 0; rank < (suit === 3 ? 7 : 9); rank++) result[(suit << 4) | rank] = 4;
    for (let other = 0; other < this.model.get('players'); other++) {
      const river = this.model.river(other);
      for (let index = 0; index < river[32]; index++)
        if (!(river[index] & 4)) result[typeOf(river[index])]--;
      for (const meld of this.melds(other)) for (const tile of meld.tiles) result[typeOf(tile)]--;
    }
    for (const tile of this.tiles(player)) result[typeOf(tile)]--;
    return result;
  }
  score(player, overrideTiles = null, overrideDraw = null, overrideFlags = null) {
    const model = this.model,
      hand = model.hand(player),
      bytes = overrideFlags ?? handBytes(hand),
      tiles = overrideTiles ?? this.tiles(player),
      melds = this.melds(player),
      draw = overrideDraw ?? hand[16],
      winning = typeOf(draw),
      seat = (player + model.get('players') - model.get('dealer')) % model.get('players'),
      wind = model.get('wind'),
      selfDraw = Boolean(bytes[434]),
      closed = melds.every((meld) => !(meld.flags & 0xf0000)),
      open = melds.some((meld) => !(meld.flags & 0x100000)),
      allTiles = [...tiles, ...melds.flatMap((meld) => meld.tiles)],
      counts = countsOf(allTiles),
      suitCounts = [0, 0, 0, 0],
      rankMasks = [0, 0, 0, 0];
    let suitMask = 0;
    counts.forEach((count, type) => {
      if (count) {
        const suit = type >>> 4;
        suitMask |= 1 << suit;
        suitCounts[suit] += count;
        rankMasks[suit] |= 1 << (type & 15);
      }
    });
    const numberedMask = rankMasks[0] | rankMasks[1] | rankMasks[2],
      fixed = melds.map((meld) => {
        const kinds = meld.tiles.map(typeOf),
          kind = meld.flags & 0x40000 ? Math.min(...kinds) : kinds[0];
        return kind | (meld.flags & 0xffff0000);
      });
    let best = { score: 0, fu: 0, han: 0, limit: 0, multipliers: 0, patterns: [] };
    for (const configuration of shape(tiles, melds.length)) {
      const originalPatterns = [],
        add = (id, han = 1, yakuman = false) =>
          originalPatterns.push((han << 16) | id | (yakuman ? 0x100 : 0));
      let fu = 0;
      if (configuration.special === 'orphans') {
        add(
          counts[winning] >= 2 && !bytes[439] ? 6 : 5,
          counts[winning] >= 2 && !bytes[439] ? 2 : 1,
          true,
        );
      } else if (configuration.special === 'pairs') {
        add(9, 2);
        if (!numberedMask) add(9, 1, true);
        else if (!(numberedMask & 0xfe)) add(0x14, 2);
        if (!(suitMask & 8) && !(numberedMask & 0x101)) add(5);
        if ([1, 2, 4].includes(suitMask)) add(0x12, closed ? 6 : 5);
        else if ([9, 10, 12].includes(suitMask)) add(0x11, closed ? 3 : 2);
      } else {
        const groups = [...configuration.groups, ...fixed],
          pair = configuration.pair,
          types = [...groups.map((group) => group & 63), pair],
          suits = types.map((type) => type >>> 4),
          ranks = types.map((type) => type & 15),
          choices = [];
        for (let index = 0; index < 5; index++) {
          if (
            index === 4
              ? pair === winning
              : sequence(groups[index])
                ? types[index] >>> 4 === winning >>> 4 &&
                  winning >= types[index] &&
                  winning <= types[index] + 2
                : types[index] === winning
          )
            choices.push(index);
        }
        for (const wait of choices) {
          let groupFu = 0,
            ryanmen = false;
          const modified = groups.slice();
          if (!selfDraw && wait < 4 && !sequence(modified[wait]) && modified[wait] & 0x10000000)
            modified[wait] |= 0x10000;
          for (let index = 0; index < 4; index++) {
            const group = modified[index],
              type = types[index];
            let amount = 0;
            if (group & 0x10010000) amount = 4;
            if (group & 0x1a0000) amount = 16;
            if (amount) {
              if (terminal(type)) amount *= 2;
              if (group & 0xf0000) amount >>= 1;
              groupFu += amount;
            } else if (index === wait && sequence(group)) {
              const first = type & 15,
                last = winning & 15;
              if (last === first + 1 || ((first === 0 || first === 6) && (last & 7) !== 0))
                groupFu += 2;
              else ryanmen = true;
            }
          }
          if (wait === 4 && countsOf(tiles)[pair] === 2) groupFu += 2;
          if (pair >>> 4 === 3) {
            if ((pair & 15) >= 4) groupFu += 2;
            else {
              if ((pair & 15) === seat) groupFu += 2;
              if ((pair & 15) === wind) groupFu += 2;
            }
          }
          const patterns = [];
          const push = (id, han = 1, yakuman = false) =>
            patterns.push((han << 16) | id | (yakuman ? 0x100 : 0));
          const tanyao = !(suitMask & 8) && !(numberedMask & 0x101);
          if (tanyao) push(5);
          let pinfu =
            closed &&
            ryanmen &&
            modified.every(sequence) &&
            !(
              pair >>> 4 === 3 &&
              ((pair & 15) >= 4 || (pair & 15) === seat || (pair & 15) === wind)
            );
          if (pinfu) push(4);
          if (!open) {
            let duplicate = 0;
            for (let index = 0; index < 3; index++)
              if (groups[index] & 0x20000000)
                if (groups.slice(index + 1).includes(groups[index])) duplicate++;
            if (duplicate === 1) push(7);
            if (duplicate === 2) push(8, 3);
          }
          if (modified.every((group) => !sequence(group))) push(6, 2);
          for (const wantSequence of [true, false]) {
            let match = false;
            for (let first = 0; first < 2; first++)
              if (sequence(modified[first]) === wantSequence) {
                let mask = 1 << suits[first];
                for (let next = first + 1; next < 4; next++)
                  if (sequence(modified[next]) === wantSequence && ranks[first] === ranks[next])
                    mask |= 1 << suits[next];
                if (mask === 7) {
                  match = true;
                  break;
                }
              }
            if (match) push(wantSequence ? 0x0d : 0x0e, wantSequence && !closed ? 1 : 2);
          }
          let straight = false;
          for (let first = 0; first < 2; first++)
            if (sequence(modified[first])) {
              let mask = 0;
              for (let index = first; index < 4; index++)
                if (sequence(modified[index]) && suits[first] === suits[index]) {
                  if (ranks[index] === 0) mask |= 1;
                  if (ranks[index] === 3) mask |= 2;
                  if (ranks[index] === 6) mask |= 4;
                }
              if (mask === 7) {
                straight = true;
                break;
              }
            }
          if (straight) push(0x0c, open ? 1 : 2);
          let terminals = 31;
          for (let index = 0; index < 5; index++) {
            if (suits[index] === 3) terminals &= 0x13;
            else if (index < 4 && sequence(modified[index])) {
              if (ranks[index] !== 0 && ranks[index] !== 6) {
                terminals = 0;
                break;
              }
              terminals &= 5;
            } else if (ranks[index] === 0 || ranks[index] === 8) terminals &= 15;
            else {
              terminals = 0;
              break;
            }
          }
          if (terminals & 16) push(9, 1, true);
          else if (terminals & 8) push(0x0a, 1, true);
          else if (terminals & 4) push(0x0b, open ? 2 : 3);
          else if (terminals & 2) push(0x14, 2);
          else if (terminals & 1) push(0x0a, open ? 1 : 2);
          if ([1, 2, 4].includes(suitMask)) push(0x12, open ? 5 : 6);
          else if ([9, 10, 12].includes(suitMask)) push(0x11, open ? 2 : 3);
          const concealed = groups.filter(
            (group, index) => group & 0x10100000 && (selfDraw || types[index] !== winning),
          ).length;
          if (concealed === 3) push(0x0f, 2);
          if (concealed === 4)
            push(wait === 4 && !bytes[439] ? 2 : 1, wait === 4 && !bytes[439] ? 2 : 1, true);
          const kans = groups.filter((group) => Boolean(group & 0x1a0000)).length;
          if (kans === 3) push(0x10, 2);
          if (kans === 4) push(3, 1, true);
          let dragons = 0,
            winds = 0;
          for (let index = 0; index < 5; index++)
            if (suits[index] === 3) {
              const amount = index === 4 ? 1 : 2;
              if (ranks[index] >= 4) dragons += amount;
              else winds += amount;
            }
          if (dragons >= 5) push(dragons >= 6 ? 4 : 0x13, dragons >= 6 ? 1 : 4, dragons >= 6);
          if (winds >= 7) push(winds >= 8 ? 8 : 7, winds >= 8 ? 2 : 1, true);
          if (!(rankMasks[0] | rankMasks[1] | (rankMasks[3] & 0x5f) | (rankMasks[2] & 0x151)))
            push(0x0b, 1, true);
          for (let suit = 0; suit < 3; suit++)
            if (
              suitCounts[suit] >= 14 &&
              counts[suit << 4] >= 3 &&
              counts[(suit << 4) | 8] >= 3 &&
              Array.from({ length: 7 }, (_, i) => counts[(suit << 4) | (i + 1)]).every(Boolean)
            ) {
              const exact = counts[winning] === (winning & 7 ? 2 : 4);
              push(exact ? 0x0d : 0x0c, exact ? 2 : 1, true);
            }
          let dragonSets = 0,
            windSets = 0;
          for (let index = 0; index < 4; index++)
            if (suits[index] === 3) {
              if (ranks[index] >= 4) {
                if (dragons < 5) dragonSets++;
              } else {
                let value = Number(ranks[index] === wind) + Number(ranks[index] === seat);
                windSets = value >= 2 ? -1 : windSets + value;
              }
            }
          if (dragonSets) push(0x15, dragonSets);
          if (windSets) push(windSets < 0 ? 0x17 : 0x16, windSets < 0 ? 2 : windSets);
          groupFu += 20 + (selfDraw ? (pinfu ? 0 : 2) : open ? 0 : 10);
          if (tanyao && groupFu === 20) groupFu = 30;
          const candidate = this.finish(player, patterns, groupFu, allTiles, bytes, closed);
          if (
            candidate.score > best.score ||
            (candidate.score === best.score && candidate.han > best.han)
          )
            best = { ...candidate, groups: groups.slice(), wait };
        }
        continue;
      }
      const candidate = this.finish(player, originalPatterns, fu, allTiles, bytes, closed);
      if (
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.han > best.han)
      )
        best = candidate;
    }
    return best;
  }
  discardValue(player, index, available) {
    const waits = this.waits(player, index);
    if (!waits) return 0;
    const tiles = this.tiles(player);
    if (index >= 0 && index < tiles.length) tiles.splice(index, 1);
    let value = 0;
    for (const kind of waits)
      if (available[kind]) {
        const candidate = [...tiles, kind << 4],
          score = this.score(player, candidate, kind << 4).score;
        if (score >= 0) value += score * available[kind];
      }
    return value;
  }
  bestDiscard(player) {
    const tiles = this.tiles(player),
      available = this.remainingTiles(player);
    let best = -1,
      value = -1;
    for (let index = 0; index < tiles.length; index++) {
      const estimate = this.discardValue(player, index, available);
      if (estimate > 0 && value < estimate) {
        value = estimate;
        best = index;
      }
    }
    if (best >= 0) return best;
    const counts = countsOf(tiles),
      kinds = [];
    for (const tile of tiles) {
      const kind = typeOf(tile);
      if (kinds.at(-1) !== kind) kinds.push(kind);
    }
    const masks = [0, 0, 0],
      weights = new Map(),
      right = [100, 10, 20, 90, 100, 80, 95, 100],
      left = [100, 95, 80, 100, 90, 20, 10, 100],
      rankWeight = [0, 1, 2, 3, 3, 3, 2, 1, 0];
    for (const kind of kinds) {
      const suit = kind >>> 4,
        rank = kind & 15;
      if (suit < 3) masks[suit] |= 1 << rank;
      let weight = 0;
      if (counts[kind] >= 2) {
        weight = suit >= 3 ? (rank >= 4 ? 12000 : 11000) : rank === 0 || rank === 8 ? 11000 : 10000;
        if (counts[kind] < 3) weight = Math.trunc(weight / 10);
        else counts[kind] -= 3;
      }
      weights.set(kind, weight);
    }
    for (const kind of kinds) {
      const suit = kind >>> 4,
        rank = kind & 15;
      let weight = 0;
      if (suit < 3) {
        const shifted = masks[suit] << (8 - rank),
          lookup = (shifted >>> 11) & 7,
          upper = (shifted >>> 9) & 3,
          lower = (shifted & 255) >>> 6;
        if (upper === 1) weight = 5 * right[lookup];
        else if (upper === 2) weight = right[lookup];
        else if (upper === 3) weight = 10 * right[lookup];
        if (lower === 1) weight += left[lookup];
        else if (lower === 2) weight += 5 * left[lookup];
        else if (lower === 3) weight += 10 * left[lookup];
        weight += rankWeight[rank];
      } else if (rank >= 4) weight = 5;
      weights.set(kind, weights.get(kind) + weight);
    }
    let selected = -1,
      least = 0;
    for (const kind of kinds)
      if (selected < 0 || least >= weights.get(kind)) {
        selected = kind;
        least = weights.get(kind);
      }
    const index = tiles.findIndex((tile) => typeOf(tile) === selected);
    return index < 0 ? tiles.length - 1 : index;
  }
  finish(player, input, fu, tiles, bytes, closed) {
    const patterns = input.slice(),
      push = (id, han = 1, yakuman = false) =>
        patterns.push((han << 16) | id | (yakuman ? 0x100 : 0));
    if (bytes[441]) push(0x1a);
    if (bytes[439]) push(0x0e, 1, true);
    else if (bytes[440]) push(bytes[434] ? 0x0f : 0x10, 1, true);
    if (bytes[432]) {
      push(bytes[433] ? 1 : 0, bytes[433] ? 2 : 1);
      if (bytes[436]) push(2);
    }
    if (closed && bytes[434]) push(3);
    if (!bytes[441] && bytes[442]) push(0x1b);
    if (!this.model.get('remaining')) push(bytes[434] ? 0x18 : 0x19);
    if (patterns.length) {
      let dora = tiles.filter((tile) => tile & 0x1000).length;
      const count = countsOf(tiles),
        pair = bytes[432] ? 2 : 1;
      for (let index = 0; index < this.model.get('doraCount'); index++)
        for (let under = 0; under < pair; under++) {
          const tile = this.model.indicator(4 - index, under),
            type = typeOf(tile),
            suit = type >>> 4,
            rank = type & 15,
            next =
              suit === 3 ? (rank >= 4 ? 4 + ((rank - 3) % 3) : (rank + 1) % 4) : (rank + 1) % 9;
          dora += count[(suit << 4) | next];
        }
      if (dora) push(0x1c, dora);
      if (this.model.hand(player)[118]) push(0x1d, this.model.hand(player)[118]);
    }
    const factor = player === this.model.get('dealer') ? 6 : 4,
      multipliers = patterns.reduce(
        (total, value) => total + (value & 0x100 ? value >>> 16 : 0),
        0,
      );
    if (multipliers)
      return {
        score: 8000 * factor * multipliers,
        fu: 0,
        han: 0,
        limit: 0,
        multipliers,
        patterns: patterns
          .filter((value) => value & 0x100)
          .sort((a, b) => (a & 0xffff) - (b & 0xffff)),
      };
    const han = patterns.reduce((total, value) => total + (((value >> 16) << 16) >> 16), 0);
    if (!patterns.length)
      return { score: 0, fu: 0, han: 0, limit: 0, multipliers: 0, patterns: [] };
    const rounded = fu ? Math.trunc((fu + 9) / 10) * 10 : 0;
    let score,
      limit = 0,
      multiple = 0;
    if (han >= 5) {
      limit = han >= 11 ? 4 : han >= 8 ? 3 : han >= 6 ? 2 : 1;
      score = [0, 2000, 3000, 4000, 6000][limit] * factor;
      if (han >= 13) {
        limit = 5;
        multiple = Math.trunc(han / 13);
        score = 8000 * factor * multiple;
      }
    } else {
      score =
        100 *
        Math.trunc((4 * factor * (rounded || 50) * 2 ** (rounded ? han : han - 1) + 99) / 100);
      if (score >= 2000 * factor) {
        limit = 1;
        score = 2000 * factor;
      }
    }
    return {
      score,
      fu: rounded,
      han,
      limit,
      multipliers: multiple,
      patterns: patterns.sort((a, b) => (a & 0xffff) - (b & 0xffff)),
    };
  }
}
