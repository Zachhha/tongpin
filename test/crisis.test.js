'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CrisisStore } = require('../lib/crisis');

function makeRoom(count = 3) {
  const game = new CrisisStore();
  const created = game.createRoom('房主');
  const players = [created.player];
  for (let index = 1; index < count; index += 1) {
    players.push(game.joinRoom(created.room.code, `公关${index}`).player);
  }
  return { game, room: created.room, players, host: created.player };
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected function to throw');
}

function proposal(name) {
  return {
    text: `${name}会先停业并公开监控，给所有受影响顾客退款，三天内给出整改清单。`,
  };
}

test('crisis mode runs one anonymous voting round for 3+ players', () => {
  const { game, room, players, host } = makeRoom(3);
  game.start(room.code, host.id, host.token);
  assert.equal(room.phase, 'writing');
  assert.ok(room.crisis.title);

  for (const player of players) {
    game.submitProposal(room.code, player.id, player.token, proposal(player.name));
  }
  assert.equal(room.phase, 'voting');
  assert.equal(game.view(room, players[0].id).proposals.every((item) => !item.author), true);

  game.submitVote(room.code, players[0].id, players[0].token, players[1].id);
  game.submitVote(room.code, players[1].id, players[1].token, players[2].id);
  assert.equal(room.phase, 'voting');
  game.submitVote(room.code, players[2].id, players[2].token, players[1].id);
  assert.equal(room.phase, 'reveal');

  const result = game.view(room, host.id).result;
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.find((entry) => entry.playerId === players[1].id).votes, 2);
  assert.equal(result.entries.find((entry) => entry.playerId === players[1].id).points, 2);
  assert.ok(result.entries.every((entry) => entry.author !== undefined || entry.name));
});

test('2-player crisis mode is cooperative and has no scoring', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  game.submitProposal(room.code, players[0].id, players[0].token, proposal('A'));
  game.submitProposal(room.code, players[1].id, players[1].token, proposal('B'));
  assert.equal(room.phase, 'reveal');
  const view = game.view(room, players[0].id);
  assert.equal(view.isCoop, true);
  assert.equal(view.ratingMode, false);
  assert.equal(view.proposals.length, 2);
  assert.deepEqual(view.scores, []);
  assert.equal(view.result.isCoop, true);
  assert.equal(view.result.entries.every((entry) => entry.points === 0), true);
  assert.equal(view.result.isFinal, false);
});

test('the host can reroll the crisis before anyone submits', () => {
  const { game, room, players, host } = makeRoom(3);
  game.start(room.code, host.id, host.token);
  const before = room.crisis.id;
  assert.equal(game.view(room, host.id).canReroll, true);
  game.rerollCrisis(room.code, host.id, host.token);
  assert.notEqual(room.crisis.id, before);
  const second = room.crisis.id;
  game.rerollCrisis(room.code, host.id, host.token);
  assert.notEqual(room.crisis.id, second);
  assert.equal(
    errorOf(() => game.rerollCrisis(room.code, players[1].id, players[1].token)).status,
    403,
  );

  game.submitProposal(room.code, players[1].id, players[1].token, proposal('先提交者'));
  assert.equal(game.view(room, host.id).canReroll, false);
  assert.equal(
    errorOf(() => game.rerollCrisis(room.code, host.id, host.token)).status,
    409,
  );
});

test('crisis mode supports spectators and host restart', () => {
  const { game, room, players, host } = makeRoom(3);
  game.start(room.code, host.id, host.token);
  const { spectator } = game.addSpectator(room.code, '看客');
  const spectatorView = game.view(room, spectator.id, 'spectator');
  assert.equal(spectatorView.role, 'spectator');
  assert.equal(spectatorView.viewer.isSpectator, true);
  assert.equal(spectatorView.canStart, false);

  for (const player of players) {
    game.submitProposal(room.code, player.id, player.token, proposal(player.name));
  }
  for (const [index, player] of players.entries()) {
    game.submitVote(room.code, player.id, player.token, players[(index + 1) % players.length].id);
  }
  assert.equal(room.phase, 'reveal');
  const result = game.view(room, spectator.id, 'spectator').result;
  assert.ok(result.entries.length === 3);

  game.restart(room.code, host.id, host.token);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.history.length, 0);
  assert.equal(room.scores.size, 0);
  assert.equal(room.players.length, 3);
  assert.equal(room.spectators.length, 1);
});
