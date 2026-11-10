// SPDX-License-Identifier: MPL-2.0
import { sortTileHand } from './tile-hands.mjs';
export class NativeTileRound {
  constructor(model) {
    this.model = model;
  }
  bytes(player) {
    return this.model.rules.bytes(player);
  }
  notify(player, next) {
    this.model.continuations.push(next);
    this.model.set('specialPlayer', player);
    this.model.set('next', 20063);
  }
  pending(player) {
    const bytes = this.bytes(player);
    return Array.from({ length: 8 }, (_, i) => bytes[447 + 3 * i]).some(Boolean);
  }
  resume() {
    this.model.set('next', this.model.continuations.pop() ?? 20060);
  }
  reveal(words) {
    const model = this.model;
    for (let i = 0; i < model.get('pendingDora'); i++) {
      const position = model.words[949 - model.get('doraCount')],
        row = Math.trunc(position / 34),
        index = position % 34,
        wall = model.wall(row),
        tile = wall[index],
        reference = (row << 8) | index;
      model.set('indicatorRow', row);
      model.set('indicatorColumn', index);
      words.push(tile, reference, reference);
      wall[index] = tile | 0x10000;
      model.set('doraCount', model.get('doraCount') + 1);
    }
    model.set('pendingDora', 0);
    new Uint8Array(model.words.buffer)[8456] = 0;
  }
  draw(words, replacement = false) {
    const model = this.model,
      player = model.get('current'),
      flags = this.bytes(player);
    if (!replacement) {
      if (flags[445]) {
        if (!flags[443]) {
          model.forceDraw();
          flags[445] = 0;
          flags[446] = 1;
        }
        flags[445] = 0;
      }
      if (model.get('remaining') === 1 && flags[457]) {
        model.forceDraw();
        flags[457] = 0;
        flags[458] = 1;
      }
      for (let other = 0; other < model.get('players'); other++) {
        const bytes = this.bytes(other),
          record = model.hand(other);
        if (other === player) {
          bytes[435] = 0;
          if (!bytes[432]) {
            bytes[437] = bytes[438] = 0;
            if (record[107]) bytes[433] = 0;
          }
        }
        if (bytes[437]) bytes[438] = 1;
      }
      model.addDraw(words, model.draw());
    } else {
      flags[440] = 0;
      flags[441] = 1;
      flags[435] = flags[436] = flags[433] = flags[439] = 0;
      let tile = -1;
      while (tile < 0) {
        const cursor = model.get('replacementCursor'),
          position = model.words[951 - (cursor >> 1)] - (cursor & 1),
          row = Math.trunc(position / 34),
          column = position % 34,
          wall = model.wall(row);
        model.set('drawRow', row);
        model.set('drawColumn', column);
        tile = wall[column];
        if (tile >= 0) wall[column] = tile | 0x80000000;
        model.set('replacementCursor', (cursor + 1) % 136);
      }
      model.addDraw(words, tile);
      new Uint8Array(model.words.buffer)[8484] = 0;
    }
  }
  responses(tile, allowCalls) {
    const model = this.model,
      bytes = new Uint8Array(model.words.buffer);
    for (let player = 0; player < model.get('players'); player++) {
      const flags = this.bytes(player);
      flags[434] = 0;
      flags[442] = bytes[8484];
      model.rules.response(
        player,
        tile,
        (player + model.get('players') - model.get('current')) % model.get('players'),
        allowCalls && model.get('remaining') > 0,
      );
      if (model.hand(player)[104] & 0x10000000) flags[437] = 1;
    }
  }
  discard(words) {
    const model = this.model,
      player = model.get('current'),
      hand = model.hand(player),
      river = model.river(player),
      index = model.get('discardChoice');
    for (let other = 0; other < model.get('players'); other++) {
      const flags = this.bytes(other);
      flags[441] = 0;
      if (other === player) {
        model.hand(other)[107]++;
        flags[439] = flags[440] = flags[436] = 0;
      } else flags[439] = 0;
    }
    const tile = hand[index],
      target = river[32];
    hand[index] = tile | 0x80000000;
    words.push(tile, 0x20000 | (player << 8) | index, 0x10000 | (player << 8) | target);
    if (target < 32) {
      river[target] = tile;
      river[32]++;
    }
    river[target] |= 0x10000;
    model.set('lastDiscardPlayer', player);
    model.set('lastDiscardIndex', target);
    model.set('lastDiscardType', (river[target] >>> 4) & 63);
    new Uint8Array(model.words.buffer)[8484] = 0;
    model.set('robbedTile', -1);
    this.responses(river[target], true);
  }
  aiResponses() {
    const model = this.model,
      tile =
        model.get('robbedTile') >= 0
          ? model.get('robbedTile')
          : model.river(model.get('lastDiscardPlayer'))[model.get('lastDiscardIndex')];
    model.pendingActions = [];
    for (let step = 0; step < model.get('players'); step++) {
      const player = (step + model.get('current')) % model.get('players');
      if (player) {
        const action = model.rules.responseChoice(player, tile);
        if (action) model.pendingActions.push(action | player);
      }
    }
    return model.pendingActions.length > 0;
  }
  ron(words) {
    const model = this.model,
      player = model.pendingActions[0] & 255;
    model.set('current', player);
    let tile, source;
    if (model.get('robbedTile') >= 0) {
      tile = model.get('robbedTile');
      model.set('lastDiscardPlayer', model.words[2120]);
      source = 0x30003 | (model.words[2120] << 8) | ((model.words[2119] & 15) << 4);
    } else {
      const river = model.river(model.get('lastDiscardPlayer')),
        index = model.get('lastDiscardIndex');
      tile = river[index];
      river[index] |= 4;
      source = 0x10000 | (model.get('lastDiscardPlayer') << 8) | index;
    }
    const hand = model.hand(player);
    words.push(tile, source, 0x20000 | (player << 8) | hand[17]);
    if (hand[17] < 16) hand[hand[17]++] = tile;
    hand[16] = tile;
    this.bytes(player)[434] = 0;
  }
  meld(words, historical = false) {
    const model = this.model,
      action = model.pendingActions[0],
      player = historical ? model.get('current') : action & 255;
    model.set('current', player);
    const hand = model.hand(player),
      group = hand[48];
    if (group >= 5) return;
    hand[48]++;
    const at = 18 + 6 * group,
      flags = action & 0xffff0000;
    hand.fill(0, at, at + 6);
    if (action & 0x1a0000 && this.bytes(player)[448]) model.forceKan(action);
    for (let other = 0; other < model.get('players'); other++) {
      const bytes = this.bytes(other);
      bytes[439] = bytes[440] = 0;
      if (other === player) bytes[435] = 1;
      else bytes[436] = 0;
    }
    const owner = historical ? (action >>> 6) & 3 : model.get('lastDiscardPlayer'),
      riverIndex = historical ? action & 63 : model.get('lastDiscardIndex'),
      river = model.river(owner);
    let position = (model.get('players') + player - owner) % model.get('players');
    if (model.get('players') === 4) position--;
    let packed = (action >>> 8) & 255,
      count = 3;
    if (flags === 0x20000) {
      count = 4;
      position += position >> 1;
      const start = (action >>> 8) & 15;
      packed = start | ((start + 1) << 4) | ((start + 2) << 8);
    }
    for (let index = 0; index < count; index++) {
      let tile, source;
      if (index === position) {
        tile = river[riverIndex];
        river[riverIndex] |= 4;
        source = 0x10000 | (owner << 8) | riverIndex;
      } else {
        const slot = packed & 15;
        packed >>= 4;
        tile = hand[slot];
        hand[slot] |= 0x80000000;
        source = 0x20000 | (player << 8) | slot;
      }
      words.push(tile, source, 0x30000 | (player << 8) | (group << 4) | index);
      hand[at + index] = tile | (index === position ? 0 : 0x10000);
      hand[at + 4]++;
    }
    hand[at + 5] = flags | position;
  }
  kan(words) {
    const model = this.model,
      player = model.get('current'),
      hand = model.hand(player),
      action = model.pendingActions[0];
    model.set('robbedTile', -1);
    if (action & 0x1a0000 && this.bytes(player)[448]) model.forceKan(action);
    const first = (action >>> 8) & 15;
    if (action & 0x100000) {
      const group = hand[48];
      if (group >= 5) return;
      hand[48]++;
      const at = 18 + 6 * group;
      hand.fill(0, at, at + 6);
      for (let index = 0; index < 4; index++) {
        const slot = index === 3 ? (action >>> 12) & 15 : first + index,
          tile = hand[slot];
        hand[slot] |= 0x80000000;
        words.push(
          tile,
          0x20000 | (player << 8) | slot,
          0x30000 | (player << 8) | (group << 4) | index,
        );
        hand[at + index] = tile;
        hand[at + 4]++;
      }
      hand[at + 5] = 0x100000;
    } else if (action & 0x80000) {
      const group = (action >>> 12) & 15,
        at = 18 + 6 * group,
        tile = hand[first];
      hand[first] |= 0x80000000;
      words.push(tile, 0x20000 | (player << 8) | first, 0x30003 | (player << 8) | (group << 4));
      if (hand[at + 4] < 4) hand[at + hand[at + 4]++] = tile;
      hand[at + 5] = (hand[at + 5] & 0xffff) | 0x80000;
      new Uint8Array(model.words.buffer)[8484] = 1;
      model.set('robbedTile', tile);
      model.words[2119] = group;
      model.words[2120] = player;
      this.responses(tile, false);
    }
  }
  countKan() {
    const model = this.model;
    model.set('pendingDora', model.get('pendingDora') + 1);
    model.set('kans', model.get('kans') + 1);
    model.set('kanMask', model.get('kanMask') | (1 << model.get('current')));
    new Uint8Array(model.words.buffer)[8456] = 1;
  }
  scorePayment(words) {
    const model = this.model,
      player = model.get('current'),
      score = model.hands.score(player).score,
      delta = model.words.subarray(956, 960);
    delta.fill(0);
    if (!this.bytes(player)[434]) {
      const loser = model.get('lastDiscardPlayer');
      words.push(loser);
      delta[player] += score;
      delta[loser] -= score;
    } else if (model.get('players') === 2) {
      delta[player] += score;
      delta[1 - player] -= score;
    } else
      for (let other = 0; other < model.get('players'); other++)
        if (other !== player) {
          const part =
              player === model.get('dealer')
                ? Math.trunc(score / 3)
                : other === model.get('dealer')
                  ? Math.trunc(score / 2)
                  : Math.trunc(score / 4),
            payment = Math.trunc((part + 99) / 100) * 100;
          delta[other] -= payment;
          delta[player] += payment;
        }
    words.push(...delta.subarray(0, model.get('players')));
  }
  applyPayment(words) {
    const model = this.model;
    for (let player = 0; player < model.get('players'); player++) {
      words.push(model.words[952 + player], model.words[956 + player]);
      model.words[952 + player] += model.words[956 + player];
      model.words[956 + player] = 0;
    }
  }
  advanceMatch() {
    const model = this.model,
      bytes = new Uint8Array(model.words.buffer);
    if (
      Array.from(model.words.subarray(952, 952 + model.get('players'))).some((score) =>
        model.get('players') === 2 ? score <= 0 : score < 0,
      )
    )
      return false;
    if (!bytes[8424]) {
      model.set('repeat', model.get('repeat') + 1);
      return true;
    }
    model.set('repeat', bytes[8425] ? 0 : model.get('repeat') + 1);
    model.set('round', (model.get('round') + 1) % model.get('players'));
    model.set('dealer', (model.get('dealer') + 1) % model.get('players'));
    if (
      model.get('dealer') === model.get('firstDealer') &&
      model.set('wind', model.get('wind') + 1) >= model.get('lastRound')
    ) {
      if (model.get('players') >= 4) return false;
      model.set('wind', 0);
    }
    return true;
  }
  next() {
    const model = this.model,
      event = model.get('next'),
      words = [event],
      bytes = new Uint8Array(model.words.buffer);
    model.set('event', event);
    const current = () => model.get('current'),
      flags = () => this.bytes(current()),
      action = () => model.pendingActions[0] & 0xffff0000,
      again = () => this.next(),
      continuation = (next) => {
        model.continuations.push(next);
        model.set('next', 20007);
      };
    switch (event) {
      case 20001:
        model.set('dealMask', 0);
        model.set('next', 20002);
        break;
      case 20002:
        model.preparePlayers();
        model.set('next', 20003);
        break;
      case 20003:
        model.set('current', model.get('dealer'));
        model.set('next', 20004);
        break;
      case 20004: {
        const hand = model.hand(current()),
          count = hand[17] >= 12 ? (current() === model.get('dealer') ? 2 : 1) : 4;
        for (let i = 0; i < count; i++) {
          const tile =
            (count | i) === 3
              ? model.drawAt((model.get('wallCursor') - 1 + model.get('players')) % 136)
              : model.draw();
          model.addDraw(words, tile);
        }
        model.set('current', (current() + 1) % model.get('players'));
        if (current() === model.get('dealer') && count < 4) model.set('next', 20005);
        break;
      }
      case 20005:
        model.set('next', 20006);
        break;
      case 20006:
        for (let player = 0; player < model.get('players'); player++) {
          words.push(player);
          sortTileHand(model.hand(player));
        }
        model.set('next', 20009);
        break;
      case 20007:
        words.push(current());
        model.set('next', 20008);
        break;
      case 20008:
        words.push(current());
        sortTileHand(model.hand(current()));
        this.resume();
        break;
      case 20009:
        model.set('next', 20010);
        break;
      case 20010:
        model.set('pendingDora', 1);
        this.reveal(words);
        model.set('next', 20019);
        break;
      case 20011:
        model.set('next', 20012);
        break;
      case 20012:
        this.reveal(words);
        this.resume();
        break;
      case 20013:
        words.push(current());
        model.set('next', 20014);
        break;
      case 20014:
        this.draw(words);
        model.set('next', 20019);
        break;
      case 20015:
        words.push(current());
        model.set('next', 20016);
        break;
      case 20016:
        this.draw(words, true);
        model.set('next', 20019);
        break;
      case 20017:
        model.set('next', 20018);
        break;
      case 20018:
      case 20027:
        this.discard(words);
        if (event === 20027) {
          model.set('discardIndex', current());
          flags()[432] = flags()[436] = 1;
          flags()[437] = flags()[438] = 0;
          model.words[952 + current()] -= 1000;
          model.set('deposits', model.get('deposits') + 1);
        }
        model.continuations.push(20021);
        if (bytes[8456]) {
          model.continuations.push(20011);
          bytes[8456] = 0;
        }
        model.set('next', 20007);
        break;
      case 20019:
        model.set('next', 20020);
        model.preAction(current());
        if (this.pending(current())) this.notify(current(), 20020);
        break;
      case 20020: {
        model.set('next', 20042);
        flags()[434] = 1;
        const available = model.rules.own(current());
        words.push(available);
        if (!available) return again();
        if (!current()) break;
        const choice = model.rules.selfChoice(current());
        model.pendingActions = choice ? [choice | current()] : [];
        model.set(
          'next',
          { [0x1000000]: 20028, [0x80000]: 20032, [0x100000]: 20030, [0x20000000]: 20026 }[
            action()
          ] ?? 20042,
        );
        if (model.get('next') === 20028) model.set('discardChoice', model.hand(current())[106]);
        if (!this.pending(current())) return again();
        this.notify(current(), model.get('next'));
        return again();
      }
      case 20021:
      case 20024: {
        if (this.aiResponses()) model.set('next', event === 20021 ? 20023 : 20025);
        else if (event === 20021) {
          model.continuations.push(20046);
          model.set('next', 20045);
        } else this.resume();
        const available = model.hand(0)[104];
        if (!available) return again();
        words.push(available, ...model.actions[0]);
        break;
      }
      case 20023: {
        const next = { [0x40000]: 20040, [0x10000]: 20036, [0x20000]: 20038, [0x10000000]: 20034 }[
          action()
        ];
        if (!next) {
          model.continuations.push(20046);
          model.set('next', 20045);
          return again();
        }
        if (next === 20034) {
          model.set('next', next);
          return again();
        }
        model.continuations.push(next);
        model.set('next', 20045);
        const player = model.pendingActions[0] & 255;
        if (this.pending(player)) {
          model.set('specialPlayer', player);
          model.continuations.push(20063);
        }
        return again();
      }
      case 20025:
        if (action() === 0x10000000) model.set('next', 20034);
        else this.resume();
        return again();
      case 20026:
        model.set('next', 20029);
        break;
      case 20028:
        model.set('next', 20027);
        break;
      case 20029:
        flags()[434] = 1;
        model.set('next', 20049);
        break;
      case 20030:
        words.push(current());
        model.set('next', 20031);
        break;
      case 20031:
      case 20033:
        this.kan(words);
        this.countKan();
        if (model.get('kans') >= 5) {
          model.set('drawReason', 5);
          model.set('next', 20048);
          break;
        }
        model.continuations.push(20015);
        if (event === 20031) model.continuations.push(20011);
        model.set('next', 20007);
        if (event === 20033 && model.get('robbedTile') >= 0) {
          model.continuations.push(20007);
          model.set('next', 20024);
        }
        break;
      case 20032:
        words.push(current());
        model.set('next', 20033);
        break;
      case 20034:
        words.push(model.pendingActions[0] & 255);
        model.set('next', 20035);
        break;
      case 20035:
        this.ron(words);
        model.set('next', 20049);
        break;
      case 20036:
      case 20038:
      case 20040:
        words.push(model.pendingActions[0] & 255);
        model.set('next', event + 1);
        break;
      case 20037:
      case 20039:
      case 20041:
        this.meld(words);
        if (event === 20039) {
          this.countKan();
          if (model.get('kans') >= 5) {
            model.set('drawReason', 5);
            model.set('next', 20048);
          } else continuation(20015);
        } else continuation(20042);
        break;
      case 20042:
        model.set('next', 20043);
        break;
      case 20043:
        if (flags()[432]) {
          model.command(10006, [-1]);
          return [20044];
        }
        break;
      case 20045:
        this.resume();
        if (model.get('discardIndex') < 0) return again();
        model.set('discardIndex', -1);
        break;
      case 20046:
        if (!flags()[432]) flags()[433] = 0;
        if (model.fourKans()) {
          model.set('drawReason', 3);
          model.set('next', 20048);
          break;
        }
        if (model.get('remaining') > 0) {
          model.set('current', (current() + 1) % model.get('players'));
          model.set('next', 20065);
        } else {
          model.set('next', 20047);
          for (let player = 0; player < model.get('players'); player++) {
            model.set('current', (current() + 1) % model.get('players'));
            if (flags()[457]) {
              model.set('remaining', model.get('remaining') + 1);
              model.set('next', 20065);
              break;
            }
          }
        }
        break;
      case 20047:
        model.words[960] = model.words[961] = 0;
        for (let player = 0; player < model.get('players'); player++) {
          const ready = Boolean(model.hands.waits(player)?.length);
          words.push(ready ? -1 : 0);
          if (ready) {
            model.words[961]++;
            model.words[960] |= 1 << player;
            if (player === model.get('dealer')) bytes[8424] = 0;
          }
        }
        model.continuations.push(20057);
        model.set('next', 20061);
        break;
      case 20048:
        words.push(model.get('drawReason'));
        model.set('next', 20059);
        bytes[8424] = 0;
        break;
      case 20049:
        words.push(current());
        if (!flags()[434]) words.push(model.get('lastDiscardPlayer'));
        model.set('next', 20050);
        this.scorePayment([]);
        for (let player = 0; player < model.get('players'); player++)
          if (player !== current() && model.afterWinAbility(player, model.words[956 + current()]))
            this.notify(player, model.get('next'));
        break;
      case 20050:
        if (current() === model.get('dealer')) bytes[8424] = 0;
        bytes[8425] = 1;
        words.push(current());
        if (!flags()[434]) words.push(model.get('lastDiscardPlayer'));
        model.continuations.push(20051);
        model.set('next', 20061);
        break;
      case 20051:
        this.scorePayment(words);
        model.set('next', 20052);
        break;
      case 20052:
        this.applyPayment(words);
        model.set('next', 20053);
        break;
      case 20053:
        if (flags()[434])
          for (let player = 0; player < model.get('players'); player++)
            model.words[956 + player] +=
              player === current()
                ? 300 * model.get('repeat')
                : Math.trunc((-300 * model.get('repeat')) / (model.get('players') - 1));
        else {
          model.words[956 + current()] += 300 * model.get('repeat');
          model.words[956 + model.get('lastDiscardPlayer')] -= 300 * model.get('repeat');
        }
        model.set('next', 20054);
        break;
      case 20054:
        this.applyPayment(words);
        model.set('next', 20055);
        break;
      case 20055:
        model.words[956 + current()] += 1000 * model.get('deposits');
        model.set('next', 20056);
        break;
      case 20056:
        this.applyPayment(words);
        model.set('deposits', 0);
        model.set('next', 20062);
        break;
      case 20057: {
        const count = model.words[961],
          players = model.get('players'),
          gain =
            count > 0 && count < players ? (players === 4 ? Math.trunc(3000 / count) : 1500) : 0,
          loss = gain ? (players === 4 ? Math.trunc(3000 / (4 - count)) : 1500) : 0;
        for (let player = 0; player < players; player++) {
          model.words[956 + player] += model.words[960] & (1 << player) ? gain : -loss;
          words.push(model.words[956 + player]);
        }
        model.set('next', 20058);
        break;
      }
      case 20058:
        this.applyPayment(words);
        model.set('next', 20062);
        break;
      case 20059:
        model.set('next', this.advanceMatch() ? 10003 : 20060);
        break;
      case 20061:
        this.resume();
        break;
      case 20062:
        model.set('next', 20059);
        break;
      case 20063: {
        const player = model.get('specialPlayer'),
          record = this.bytes(player);
        words.push(player);
        for (let i = 0; i < 8; i++)
          if (record[447 + 3 * i]) {
            words.push(i);
            record[447 + 3 * i] = 0;
          }
        model.set('next', 20064);
        break;
      }
      case 20064:
        model.applyAbilities(model.get('specialPlayer'));
        this.resume();
        break;
      case 20065:
        model.set('next', 20066);
        if (current() && model.beforeDrawAbility(current())) this.notify(current(), 20066);
        return again();
      case 20066:
        model.set('next', 20013);
        if (!flags()[454]) return again();
        flags()[454] = 0;
        if (!model.historicalActions(-1)) return again();
        if (!current()) break;
        {
          const choice = model.rules.historicalChoice(current());
          if (choice < 0) return again();
          model.pendingActions = [model.pendingActions[choice]];
          const next = { [0x10000]: 20067, [0x20000]: 20069, [0x40000]: 20071 }[action()];
          if (next) this.notify(current(), next);
          return again();
        }
      case 20067:
      case 20069:
      case 20071:
        words.push(model.pendingActions[0] & 255);
        model.set('next', event + 1);
        model.continuations.push(20007);
        break;
      case 20068:
      case 20070:
      case 20072:
        flags()[454] = 0;
        flags()[455] = 1;
        this.meld(words, true);
        if (event === 20070) {
          this.countKan();
          if (model.get('kans') >= 5) {
            model.set('drawReason', 5);
            model.set('next', 20048);
          } else continuation(20015);
        } else continuation(20042);
        break;
    }
    return words;
  }
}
