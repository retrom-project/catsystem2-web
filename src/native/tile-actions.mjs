// SPDX-License-Identifier: MPL-2.0
import { sortTileHand } from './tile-hands.mjs';
const kindOf = (tile) => (tile >>> 4) & 63;
export class NativeTileActions {
  constructor(model) {
    this.model = model;
    this.hands = model.hands;
  }
  bytes(player) {
    const hand = this.model.hand(player);
    return new Uint8Array(hand.buffer, hand.byteOffset, 476);
  }
  profile(player) {
    return this.model.words[962 + 276 * player + 14];
  }
  flags(player) {
    return this.model.words[962 + 276 * player + 15];
  }
  withHand(player, callback) {
    const hand = this.model.hand(player),
      saved = hand.slice(),
      actions = this.model.actions[player].slice(),
      original = this.model.savedActions[player].slice();
    try {
      return callback(hand);
    } finally {
      hand.set(saved);
      this.model.actions[player] = actions;
      this.model.savedActions[player] = original;
    }
  }
  own(player) {
    const model = this.model,
      hand = model.hand(player),
      bytes = this.bytes(player),
      tiles = this.hands.tiles(player),
      melds = this.hands.melds(player),
      result = [];
    let flags = 0;
    hand[105] = -1;
    if (model.get('remaining') > 0 && !bytes[435]) {
      for (let first = 0; first < tiles.length - 1; first++) {
        let count = 1,
          last = first;
        for (let next = first + 1; next < tiles.length; next++)
          if (kindOf(tiles[first]) === kindOf(tiles[next])) {
            count++;
            last = next;
          }
        if (count !== 4) continue;
        let valid = true;
        if (bytes[432]) {
          const before = this.hands.waits(player, tiles.length - 1) ?? [];
          valid = this.withHand(player, (record) => {
            const remaining = tiles.filter((tile, index) => index < first || index > last),
              at = 18 + record[48] * 6;
            record[48]++;
            record.set(
              [tiles[first], tiles[first + 1], tiles[first + 2], tiles[last], 4, 0x100000],
              at,
            );
            record.set(remaining);
            record[17] = remaining.length;
            const after = this.hands.waits(player) ?? [];
            return before.length === after.length && before.every((kind) => after.includes(kind));
          });
        }
        if (valid) result.push(0x100000 | (last << 12) | (first << 8));
      }
      for (let index = 0; index < melds.length; index++)
        if (melds[index].flags & 0x10000) {
          const tile = tiles.findIndex((value) => kindOf(value) === kindOf(melds[index].tiles[0]));
          if (tile >= 0) result.push(0x80000 | (index << 12) | (tile << 8));
        }
      if (result.length) flags |= 0x1a0000;
    }
    if (
      !bytes[432] &&
      melds.every((meld) => !(meld.flags & 0xf0000)) &&
      model.words[952 + player] >= 1000 &&
      model.get('remaining') >= model.get('players') &&
      !bytes[443]
    ) {
      let declared = false;
      for (let index = 0; index < tiles.length; index++)
        if (this.hands.waits(player, index)?.length) {
          result.push(0x1000000 | (index << 8));
          declared = true;
        }
      if (declared) flags |= 0x1000000;
    }
    if (this.hands.score(player).score) {
      result.push(0x20000000);
      flags |= 0x20000000;
    }
    model.actions[player] = result;
    model.savedActions[player] = result.slice();
    hand[104] = flags;
    return flags;
  }
  ron(player, tile) {
    const tiles = this.hands.tiles(player),
      melds = this.hands.melds(player),
      bytes = this.bytes(player).slice();
    if (tiles.length + 3 * melds.length !== 13) return 0;
    const waits = this.hands.waits(player) ?? [];
    bytes[434] = 0;
    const score = this.hands.score(player, [...tiles, tile], tile, bytes);
    if (!score.score) return 0;
    const river = this.model.river(player),
      seen = Array.from(river.subarray(0, Math.max(0, river[32]))).map(kindOf);
    if (seen.some((kind) => waits.includes(kind))) return -1;
    if (!score.patterns.some((value) => [9, 261, 262].includes(value & 0xffff)))
      for (const group of score.groups ?? [])
        if (group & 0x20040000) {
          const kind = group & 63,
            rank = kind & 15,
            win = kindOf(tile),
            winningRank = win & 15;
          if (kind >>> 4 !== win >>> 4) continue;
          const other =
            winningRank === rank && rank + 3 <= 8
              ? kind + 3
              : winningRank === rank + 2 && rank - 1 >= 0
                ? kind - 1
                : -1;
          if (other >= 0 && seen.includes(other)) return -2;
        }
    return 1;
  }
  response(player, tile, relative, allowCalls = true) {
    const model = this.model,
      hand = model.hand(player),
      bytes = this.bytes(player),
      tiles = this.hands.tiles(player),
      result = [],
      seenChi = new Set(),
      seenPon = new Set(),
      kind = kindOf(tile),
      suit = (tile >>> 8) & 3,
      rank = (tile >>> 4) & 15;
    let flags = 0;
    hand[105] = -1;
    if (relative && !bytes[444]) {
      if (allowCalls && !bytes[432] && !model.fourKans()) {
        if (relative === 1 && suit < 3)
          for (let first = 0; first < tiles.length - 1; first++) {
            if (((tiles[first] >>> 8) & 3) !== suit) continue;
            const a = (tiles[first] >>> 4) & 15;
            if (a === rank || Math.abs(a - rank) > 2) continue;
            for (let second = first + 1; second < tiles.length; second++) {
              const value = tiles[second];
              if (((value >>> 8) & 3) !== suit) break;
              const b = (value >>> 4) & 15;
              if (
                b === rank ||
                a === b ||
                Math.abs(b - rank) > 2 ||
                Math.abs(a - rank) + Math.abs(b - rank) + Math.abs(a - b) !== 4
              )
                continue;
              const key = ((tiles[first] >>> 4) & 0x13f) | ((value & 0x13f0) << 12);
              if (!seenChi.has(key)) {
                seenChi.add(key);
                result.push(0x40000 | (second << 12) | (first << 8));
              }
            }
          }
        if (seenChi.size) flags |= 0x40000;
        for (let first = 0; first < tiles.length - 1; first++)
          if (kindOf(tiles[first]) === kind)
            for (let second = first + 1; second < tiles.length; second++)
              if (kindOf(tiles[second]) === kind) {
                const key = ((tiles[first] >>> 4) & 0x13f) | ((tiles[second] & 0x13f0) << 12);
                if (!seenPon.has(key)) {
                  seenPon.add(key);
                  result.push(0x10000 | (second << 12) | (first << 8));
                }
              }
        if (seenPon.size) flags |= 0x10000;
        const matches = tiles
          .map((value, index) => (kindOf(value) === kind ? index : -1))
          .filter((index) => index >= 0);
        if (matches.length >= 3) {
          result.push(0x20000 | (matches[0] << 8));
          flags |= 0x20000;
        }
      }
      if (!bytes[438]) {
        const win = this.ron(player, tile);
        if (win) {
          result.push(win > 0 ? 0x10000000 : win === -1 ? 0x40000000 : 0x80000000);
          flags |= win > 0 ? 0x10000000 : 0x40000000;
        }
      }
    }
    hand[104] = flags;
    model.actions[player] = result;
    model.savedActions[player] = result.slice();
    return flags;
  }
  potential(player) {
    const available = this.hands.remainingTiles(player),
      tiles = this.hands.tiles(player);
    if (tiles.length + 3 * this.hands.melds(player).length === 13)
      return this.hands.discardValue(player, -1, available);
    let score = 0;
    for (let index = 0; index < tiles.length; index++)
      score += this.hands.discardValue(player, index, available);
    return score;
  }
  withMeld(player, action, tile, callback) {
    return this.withHand(player, (hand) => {
      if (hand[48] >= 5) return 0;
      const flags = action & 0xffff0000,
        indices =
          flags === 0x20000
            ? [(action >>> 8) & 15, ((action >>> 8) & 15) + 1, ((action >>> 8) & 15) + 2]
            : [(action >>> 8) & 15, (action >>> 12) & 15],
        cards = [tile, ...indices.map((index) => hand[index])],
        remaining = this.hands.tiles(player).filter((_, index) => !indices.includes(index)),
        at = 18 + 6 * hand[48];
      hand[48]++;
      hand.fill(0, at, at + 6);
      hand.set(cards, at);
      hand[at + 4] = cards.length;
      hand[at + 5] = flags;
      hand.set(remaining);
      hand[17] = remaining.length;
      sortTileHand(hand);
      this.bytes(player)[434] = 0;
      return callback();
    });
  }
  selfChoice(player) {
    const model = this.model,
      tiles = this.hands.tiles(player),
      available = this.hands.remainingTiles(player),
      profile = this.profile(player),
      bytes = this.bytes(player);
    const count = (kind) => tiles.filter((tile) => kindOf(tile) === kind).length;
    let checked = false;
    for (const action of model.actions[player]) {
      const kind = action & 0xffff0000;
      if (action & 0x20000000) return action;
      if (action & 0x1000000) {
        if (checked) continue;
        checked = true;
        if (profile === 4 && Math.trunc(model.get('remaining') / model.get('players')) !== 5)
          continue;
        let best = 0,
          weight = 0;
        for (const candidate of model.actions[player])
          if (candidate & 0x1000000) {
            const estimate = this.hands.discardValue(player, (candidate >>> 8) & 15, available);
            if (weight < estimate) {
              best = candidate;
              weight = estimate;
            }
          }
        if (best) {
          model.hand(player)[106] = (model.actions[player].at(-1) >>> 8) & 15;
          if (model.get('players') <= 2 && profile === 0 && !bytes[446] && !bytes[443])
            model.activateAbility(player, 0);
          return best;
        }
      }
      if (kind & 0x1a0000) {
        const type = kindOf(tiles[(action >>> 8) & 15]);
        if (type < 48 && count(type - 1) + count(type + 1)) continue;
        if (model.get('players') <= 2 && profile === 1 && !bytes[444])
          model.activateAbility(player, 1);
        return action;
      }
    }
    return 0;
  }
  responseChoice(player, tile) {
    const model = this.model,
      tiles = this.hands.tiles(player),
      melds = this.hands.melds(player),
      profile = this.profile(player),
      bytes = this.bytes(player),
      closed = melds.every((meld) => !(meld.flags & 0xf0000));
    const count = (kind) => tiles.filter((tile) => kindOf(tile) === kind).length;
    for (const action of model.actions[player]) {
      const flags = action & 0xffff0000;
      if (flags === 0x10000000) return action;
      const type = kindOf(tiles[(action >>> 8) & 15]);
      if (flags & 0x20000) {
        if (closed) continue;
        if (type < 48 && count(type - 1) + count(type + 1)) continue;
        if (model.get('players') <= 2 && profile === 1 && !bytes[444])
          model.activateAbility(player, 1);
        return action;
      }
      if (flags & 0x10000) {
        if (count(type) >= 3) continue;
        const rank = type & 15,
          seat = (player + model.get('players') - model.get('dealer')) % model.get('players');
        let importance = 0;
        if (type < 48) {
          importance = 48;
          if (rank < 8 && count(type + 1)) importance = 32;
          if (rank && count(type - 1)) importance &= 32;
        } else if (rank >= 4 || rank === seat || rank === model.get('wind')) {
          importance = rank === seat && rank === model.get('wind') ? 2 : 4;
          const riverCount = Array.from({ length: model.get('players') }, (_, other) =>
            this.model.river(other),
          ).reduce(
            (sum, river) =>
              sum +
              Array.from(river.subarray(0, river[32])).filter((value) => kindOf(value) === type)
                .length,
            0,
          );
          if (riverCount) importance = 1;
          if (!closed) return action;
        }
        if (importance & this.flags(player)) return action;
      }
      if (closed && model.get('remaining') >= 6 * model.get('players')) continue;
      if (this.hands.waits(player)?.length) continue;
      if (this.withMeld(player, action, tile, () => this.model.special.declaration(player)))
        return action;
    }
    return 0;
  }
  historicalChoice(player) {
    const model = this.model;
    if (model.get('players') > 2) return -1;
    const before = this.potential(player);
    let score = before,
      best = -1;
    for (let index = 0; index < model.pendingActions.length; index++) {
      const action = model.pendingActions[index],
        river = model.river((action >>> 6) & 3),
        tile = river[action & 63],
        candidate = this.withMeld(player, action, tile, () => this.potential(player));
      if (candidate > score) {
        score = candidate;
        best = index;
      }
    }
    return best;
  }
}
