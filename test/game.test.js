'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameStore, GameError, constants } = require('../lib/game');

function makeRoom(count = 3, name = '房主') {
  const game = new GameStore({ allowedDurations: [30, 60, 90] });
  const created = game.createRoom(name);
  const room = created.room;
  const players = [created.player];
  for (let index = 1; index < count; index += 1) {
    players.push(game.joinRoom(room.code, `玩家${index}`).player);
  }
  return { game, room, players, host: players[0] };
}

function errorOf(fn) {
  try {
    fn();
    assert.fail('expected an error');
  } catch (error) {
    assert.ok(error instanceof GameError, `expected GameError, got ${error}`);
    return error;
  }
}

test('room enforces 2–4 players and unique names', () => {
  const { game, room } = makeRoom(4);
  assert.equal(room.players.length, constants.MAX_PLAYERS);

  const full = errorOf(() => game.joinRoom(room.code, '第五位'));
  assert.equal(full.status, 409);

  const second = makeRoom(1);
  errorOf(() => second.game.joinRoom(second.room.code, '房主'));
  errorOf(() => second.game.joinRoom(second.room.code, ' 房主 '));

  const fifth = makeRoom(4);
  assert.throws(() => fifth.game.joinRoom(fifth.room.code, '迟到的人'), /坐满/);
});

test('only the host can start, and two players are enough', () => {
  const { game, room, players, host } = makeRoom(2);
  errorOf(() => game.start(room.code, players[1].id, players[1].token));
  assert.equal(room.phase, 'lobby');

  game.start(room.code, host.id, host.token);
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 1);
  assert.ok(room.phaseEndsAt > room.roundStartedAt);
  assert.equal(game.view(room, host.id).canStart, false);
});

test('words stay private until the reveal, then submissions lock', () => {
  const { game, room, players, host } = makeRoom(3);
  game.start(room.code, host.id, host.token);

  game.saveDraft(room.code, players[1].id, players[1].token, '草稿');
  const before = game.view(room, players[1].id);
  assert.equal(before.players.find((player) => player.id === host.id).word, null);

  game.submit(room.code, host.id, host.token, '海');
  const hostView = game.view(room, host.id);
  const otherView = game.view(room, players[1].id);
  assert.equal(hostView.players.find((player) => player.id === host.id).word, '海');
  assert.equal(otherView.players.find((player) => player.id === host.id).word, null);
  assert.equal(otherView.submittedCount, 1);

  const edit = errorOf(() => game.saveDraft(room.code, host.id, host.token, '改一下'));
  assert.equal(edit.status, 409);
  const resubmit = game.submit(room.code, host.id, host.token, '另一个');
  assert.equal(resubmit.alreadySubmitted, true);

  game.submit(room.code, players[1].id, players[1].token, '海');
  game.submit(room.code, players[2].id, players[2].token, '海');
  assert.equal(room.phase, 'won');
  assert.equal(game.view(room, host.id).result.allSame, true);
});

test('matching ignores case, width, and outer whitespace', () => {
  const first = makeRoom(2);
  first.game.start(first.room.code, first.host.id, first.host.token);
  first.game.submit(first.room.code, first.players[0].id, first.players[0].token, '  海  ');
  const result = first.game.submit(
    first.room.code,
    first.players[1].id,
    first.players[1].token,
    '海',
  );
  assert.equal(result.result.allSame, true);

  const second = makeRoom(2);
  second.game.start(second.room.code, second.host.id, second.host.token);
  second.game.submit(second.room.code, second.players[0].id, second.players[0].token, 'ＡＢＣ');
  const latin = second.game.submit(
    second.room.code,
    second.players[1].id,
    second.players[1].token,
    'abc',
  );
  assert.equal(latin.result.allSame, true);
});

test('a mismatch starts the next round only after every active player continues', () => {
  const { game, room, players, host } = makeRoom(3);
  game.start(room.code, host.id, host.token);
  game.submit(room.code, players[0].id, players[0].token, '夏天');
  game.submit(room.code, players[1].id, players[1].token, '海');
  game.submit(room.code, players[2].id, players[2].token, '蓝色');

  assert.equal(room.phase, 'reveal');
  assert.equal(game.view(room, host.id).result.allSame, false);

  const firstContinue = game.continueRound(room.code, players[0].id, players[0].token);
  assert.equal(firstContinue.advanced, false);
  assert.equal(room.phase, 'reveal');
  game.continueRound(room.code, players[1].id, players[1].token);
  assert.equal(room.phase, 'reveal');

  const lastContinue = game.continueRound(room.code, players[2].id, players[2].token);
  assert.equal(lastContinue.advanced, true);
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 2);
  assert.equal(players[0].draft, '');
  assert.equal(players[0].submitted, false);

  const view = game.view(room, host.id);
  assert.equal(view.lastRound.entries[0].word, '夏天');
  assert.equal(view.history.length, 1);
});

test('the deadline reveal commits the latest synced draft', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  game.saveDraft(room.code, players[0].id, players[0].token, '夏天');
  game.saveDraft(room.code, players[1].id, players[1].token, '海边');

  const result = game.reveal(room.code, 'timeout');
  assert.equal(result.endedBy, 'timeout');
  assert.equal(room.phase, 'reveal');
  assert.deepEqual(
    result.entries.map((entry) => entry.word),
    ['夏天', '海边'],
  );
  assert.equal(players[0].submitted, true);
  assert.equal(game.view(room, host.id).result.endedBy, 'timeout');
});

test('empty drafts can be revealed but can never win', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  game.saveDraft(room.code, players[0].id, players[0].token, '');
  game.saveDraft(room.code, players[1].id, players[1].token, '');
  const result = game.reveal(room.code, 'timeout');
  assert.equal(result.allSame, false);
  assert.equal(room.phase, 'reveal');
});

test('a reconnecting player can complete the continue gate', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  game.submit(room.code, players[0].id, players[0].token, 'A');
  game.submit(room.code, players[1].id, players[1].token, 'B');
  assert.equal(room.phase, 'reveal');

  game.continueRound(room.code, players[1].id, players[1].token);
  game.setConnected(room.code, players[1].id, false);
  game.continueRound(room.code, players[0].id, players[0].token);
  assert.equal(room.phase, 'reveal');

  const reconnect = game.setConnected(room.code, players[1].id, true);
  assert.equal(reconnect.advanced, true);
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 2);
});

test('host leaves the lobby and the next player takes over', () => {
  const { game, room, players, host } = makeRoom(3);
  const outcome = game.leaveLobby(room.code, host.id, host.token);
  assert.equal(outcome.deleted, false);
  assert.equal(room.players.length, 2);
  assert.equal(room.hostId, players[1].id);
  assert.equal(room.players[0].color, '#ff5a36');
  assert.equal(room.players[1].color, '#177d73');

  game.start(room.code, players[1].id, players[1].token);
  errorOf(() => game.leaveLobby(room.code, players[1].id, players[1].token));
});

test('a successful game can be replayed by the same players', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  game.submit(room.code, players[0].id, players[0].token, '海');
  game.submit(room.code, players[1].id, players[1].token, '海');
  assert.equal(room.phase, 'won');
  assert.equal(room.rounds.length, 1);

  game.continueRound(room.code, players[0].id, players[0].token);
  const advanced = game.continueRound(room.code, players[1].id, players[1].token);
  assert.equal(advanced.advanced, true);
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 1);
  assert.equal(room.rounds.length, 0);
  assert.equal(room.players.length, 2);
  assert.equal(game.view(room, host.id).lastRound, null);
});

test('actions from an old round are rejected', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  game.saveDraft(room.code, host.id, host.token, '海', 1);

  const staleDraft = errorOf(() =>
    game.saveDraft(room.code, host.id, host.token, '旧草稿', 0),
  );
  assert.equal(staleDraft.status, 409);
  const staleSubmit = errorOf(() =>
    game.submit(room.code, host.id, host.token, '旧词', 2),
  );
  assert.equal(staleSubmit.status, 409);

  game.submit(room.code, players[0].id, players[0].token, 'A');
  game.submit(room.code, players[1].id, players[1].token, 'B');
  const staleContinue = errorOf(() =>
    game.continueRound(room.code, host.id, host.token, 99),
  );
  assert.equal(staleContinue.status, 409);
  assert.equal(room.phase, 'reveal');
});

test('drafts are trimmed to 24 runes and invalid identities are rejected', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  const long = '一二三四五六七八九十一二三四五六七八九十一二三四五';
  game.saveDraft(room.code, host.id, host.token, long);
  assert.equal(Array.from(host.draft).length, 24);

  errorOf(() => game.saveDraft(room.code, players[1].id, 'bogus', '海'));
  errorOf(() => game.view(room, 'bogus'));
});
