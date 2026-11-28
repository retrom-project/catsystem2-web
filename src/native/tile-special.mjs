// SPDX-License-Identifier: MPL-2.0
export class NativeTileSpecial {
  constructor(model) {
    this.model = model;
  }
  bytes(player) {
    return this.model.rules.bytes(player);
  }
  activate(player, ability) {
    const model = this.model;
    // The original accepts player == playerCount. Its fourth record still
    // belongs to this JS model in a two-player game.
    if (player < 0 || player > model.get('players') || ability < 0 || ability > 7) return false;
    const bytes = new Uint8Array(model.words.buffer, 1632 + 476 * player),
      at = 445 + 3 * ability;
    bytes[at] = bytes[at + 2] = 1;
    if (!player) this.apply(player);
    return true;
  }
  apply(player) {
    const model = this.model,
      bytes = this.bytes(player);
    if (bytes[451]) {
      model.hand(player)[118]++;
      bytes[451] = 0;
      bytes[452] = 1;
    }
    if (bytes[463]) {
      for (let other = 0; other < model.get('players'); other++)
        if (other !== player) {
          const flags = this.bytes(other);
          if (flags[432]) {
            model.words[952 + other] += 1000;
            model.set('deposits', model.get('deposits') - 1);
          }
          flags[443] = 1;
          flags[432] = flags[436] = 0;
        }
      bytes[463] = 0;
      bytes[464] = 1;
    }
    if (bytes[466]) {
      for (let other = 0; other < model.get('players'); other++)
        if (other !== player) this.bytes(other)[444] = 1;
      bytes[466] = 0;
      bytes[467] = 1;
    }
  }
  declaration(player) {
    const model = this.model,
      tiles = model.hands.tiles(player);
    return tiles.some((_, index) => model.hands.waits(player, index)?.length);
  }
  beforeAction(player) {
    const model = this.model,
      bytes = this.bytes(player),
      profile = model.rules.profile(player),
      turns = Math.trunc(model.get('remaining') / model.get('players'));
    if (!player || model.get('players') > 2) return false;
    if (profile === 2 && turns >= 3 && !bytes[432] && this.declaration(player))
      return this.activate(player, 2);
    if (
      profile === 4 &&
      !bytes[458] &&
      !bytes[457] &&
      turns <= 5 &&
      turns >= 1 &&
      (bytes[432] || this.declaration(player))
    )
      return this.activate(player, 4);
    if (
      profile === 8 &&
      !bytes[464] &&
      !bytes[432] &&
      Array.from({ length: model.get('players') }, (_, other) => other).some(
        (other) => other !== player && this.bytes(other)[432],
      )
    )
      return this.activate(player, 6);
    if (
      profile === 9 &&
      !bytes[467] &&
      (bytes[432] ||
        (this.declaration(player) && model.get('remaining') >= 6 * model.get('players')))
    )
      return this.activate(player, 7);
    return false;
  }
  beforeDraw(player) {
    const model = this.model,
      bytes = this.bytes(player),
      profile = model.rules.profile(player),
      closed = model.hands.melds(player).every((meld) => !(meld.flags & 0xf0000));
    return (
      model.get('players') <= 2 &&
      profile === 3 &&
      !bytes[444] &&
      !bytes[432] &&
      !this.declaration(player) &&
      (!closed || Math.trunc(model.get('remaining') / model.get('players')) <= 4) &&
      this.activate(player, 3)
    );
  }
  afterWin(player, payment) {
    const model = this.model;
    if (
      model.get('players') > 2 ||
      model.rules.profile(player) !== 5 ||
      (model.words[952 + player] - payment > 8000 && payment < 8000)
    )
      return false;
    return this.activate(player, 5);
  }
  forceDraw() {
    const model = this.model,
      waits = model.hands.waits(model.get('current')) ?? [],
      start = model.get('wallCursor');
    for (let cursor = start; cursor < 136; cursor++) {
      const ref = model.wallReference(cursor),
        tile = ref.words[ref.index];
      if (!(tile & 0x80010000) && waits.includes((tile >>> 4) & 63)) {
        model.swapWall(start, cursor);
        break;
      }
    }
  }
  forceKan(action) {
    const model = this.model,
      player = model.get('current'),
      tile = model.hand(player)[(action >>> 8) & 15],
      kind = (tile >>> 4) & 63,
      suit = kind >>> 4,
      rank = kind & 15,
      before = suit >= 3 ? (rank >= 4 ? ((rank + 1) % 3) + 4 : (rank + 3) % 4) : (rank + 8) % 9;
    for (let cursor = model.get('wallCursor'); cursor < 136; cursor++) {
      const ref = model.wallReference(cursor),
        value = ref.words[ref.index];
      if (!(value & 0x80010000) && ((value >>> 4) & 63) === ((suit << 4) | before)) {
        model.swapWall(2 * (65 - model.get('doraCount')), cursor);
        break;
      }
    }
    const bytes = this.bytes(player);
    bytes[448] = 0;
    bytes[449] = 1;
  }
  historical(mask) {
    const model = this.model,
      player = model.get('current');
    if (this.bytes(player)[444]) return false;
    new Uint8Array(model.words.buffer)[8484] = 0;
    model.pendingActions = [];
    for (let other = 0; other < model.get('players'); other++)
      if (other !== player) {
        const river = model.river(other);
        for (let index = 0; index < river[32]; index++)
          if (!(river[index] & 4)) {
            model.rules.response(
              player,
              river[index],
              (player + model.get('players') - other) % model.get('players'),
              true,
            );
            model.pendingActions.push(
              ...model.actions[player].map((action) => action | (other << 6) | index),
            );
          }
      }
    model.pendingActions = model.pendingActions.filter((action) => action & (mask & 0xefffffff));
    return model.pendingActions.length > 0;
  }
  policy(player, kind, power, selected) {
    const model = this.model,
      pop = (type) => {
        const count = model.poolCount(type);
        if (count <= 0) return null;
        const index = (model.random.nextUint32() & 0xffff) % count,
          base = 2138 + 5 * type,
          value = model.words[base + index];
        model.poolCount(type, count - 1);
        model.words[base + index] = model.words[base + count - 1];
        return value;
      };
    if (kind === 0) {
      let remaining = power + 1,
        indicator = 130;
      while (remaining > 0) {
        const count = Math.min(remaining, 4);
        let ordinal = (model.random.nextUint32() & 0xffff) % 34,
          before,
          after;
        for (let attempt = 0; attempt < 34; attempt++) {
          before = (Math.trunc(ordinal / 9) << 4) | ordinal % 9;
          const rank = before & 15,
            suit = before >>> 4;
          after =
            (suit << 4) |
            (suit === 3 ? (rank >= 4 ? 4 + ((rank - 3) % 3) : (rank + 1) % 4) : (rank + 1) % 9);
          if (model.poolCount(after) >= count && model.poolCount(before) > 0) break;
          ordinal = (ordinal + 1) % 34;
        }
        if (model.poolCount(after) < count) break;
        for (let i = 0; i < count; i++) {
          const position = pop(after);
          if (position !== null) selected.push(position);
        }
        const left = model.poolCount(before) - 1;
        model.poolCount(before, left);
        model.swapWall(indicator, model.words[2138 + 5 * before + left]);
        remaining -= 4;
        indicator -= 2;
      }
    } else if (kind === 1) {
      if (power === 4)
        for (const type of [0, 8, 16, 24, 32, 40, 48, 49, 50, 51, 52, 53, 54])
          model.poolCount(type, 0);
      model.selectPool(selected, 2, power === 3 ? 4 : Math.min(power + 2, 5));
      if (power === 3) {
        for (let type = 0; type < 48; type++)
          if ((type & 15) !== 0 && (type & 15) !== 8) model.poolCount(type, 0);
        model.selectPool(selected, 2, 1);
      } else if (power >= 5)
        for (let index = 0; index < selected.length; index += 2) {
          const ref = model.wallReference(selected[index]),
            kind = (ref.words[ref.index] >>> 4) & 63,
            suit = kind >>> 4,
            rank = kind & 15,
            before =
              (suit << 4) |
              (suit >= 3 ? (rank >= 4 ? ((rank + 1) % 3) + 4 : (rank + 3) % 4) : (rank + 8) % 9);
          if (model.poolCount(before)) {
            model.swapWall(130, model.words[2138 + 5 * before]);
            break;
          }
        }
    } else if (kind === 7) {
      const roll = Math.trunc(((model.random.nextUint32() & 0xffff) % 100) / 25);
      let rule,
        extra = 0;
      if (power === 5) {
        extra = 1;
        rule = ['green', 'honors', 'terminals', 'rare'][roll];
        if (rule === 'rare') {
          const value = (model.random.nextUint32() & 0xffff) % 100;
          rule = value < 20 ? 'windsHidden' : value < 40 ? 'dragons' : 'winds';
        }
      } else if (power === 4) rule = ['green', 'honors', 'terminals', 'triplets'][roll];
      else if (power === 3) rule = ['terminals', 'terminals', 'triplets', 'orphans'][roll];
      else rule = power === 2 && roll < 3 ? 'triplets' : 'orphans';
      if (rule === 'triplets') {
        model.selectPool(selected, 3, 3);
        model.selectPool(selected, 2, 1);
      } else {
        for (let type = 0; type < 64; type++) {
          let keep = true;
          if (rule === 'orphans' || rule === 'terminals') keep = type >= 48 || !(type & 7);
          if (rule === 'terminals') keep = keep && type < 48;
          if (rule === 'honors') keep = type >= 48;
          if (rule === 'green') keep = [33, 34, 35, 37, 39, 53].includes(type);
          if (rule === 'winds' || rule === 'windsHidden' || rule === 'dragons') keep = type >= 48;
          if (rule === 'winds') keep = keep && type < 52;
          if (!keep) model.poolCount(type, 0);
        }
        if (rule === 'windsHidden' || rule === 'dragons') {
          for (let type = 52; type <= 54; type++) model.poolCount(type, -model.poolCount(type));
          model.selectPool(selected, 3, 4);
          if (rule === 'windsHidden') {
            model.selectPool(selected, 1, 1);
            model.applyPool(player, selected);
            let position = 135,
              placed = 0;
            for (let type = 48; type < 52 && placed < 3; type++)
              if (!model.poolCount(type)) {
                model.swapWall(position-- ^ 1, model.words[2138 + 5 * type]);
                placed++;
              }
            return true;
          }
          for (let type = 48; type < 52; type++) model.poolCount(type, 0);
          for (let type = 52; type <= 54; type++) model.poolCount(type, -model.poolCount(type));
          model.selectPool(selected, 2, 1);
        } else {
          const count =
            rule === 'orphans'
              ? 10
              : rule === 'terminals' || rule === 'green'
                ? 11 + extra
                : rule === 'honors'
                  ? 12 + extra
                  : 13;
          if (rule === 'orphans') model.selectPool(selected, 1, count);
          else
            for (let left = count; left > 0; left -= 3)
              model.selectPool(selected, 1, Math.min(3, left));
        }
      }
    }
    return false;
  }
}
