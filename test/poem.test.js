'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PoemStore } = require('../lib/poem');

function makeRoom(count) {
  const game = new PoemStore();
  const created = game.createRoom('甲');
  const players = [created.player];
  for (let index = 1; index < count; index += 1) {
    players.push(game.joinRoom(created.room.code, `乙${index}`).player);
  }
  return { game, room: created.room, host: created.player, players };
}

test('two-player acrostic mode is cooperative and continues by prompt', () => {
  const { game, room, host, players } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  assert.equal(room.phase, 'writing');
  const chars = Array.from(room.prompt);
  game.submitPoem(room.code, players[0].id, players[0].token, chars.map((char) => `${char}字`));
  game.submitPoem(room.code, players[1].id, players[1].token, chars.map((char) => `${char}句`));
  assert.equal(room.phase, 'reveal');
  const view = game.view(room, host.id);
  assert.equal(view.isCoop, true);
  assert.deepEqual(view.scores, []);
  assert.equal(view.result.isCoop, true);

  const chooser = players.find((player) => game.view(room, player.id).viewer.canChoosePrompt);
  const other = players.find((player) => player.id !== chooser.id);
  assert.ok(chooser);
  game.choosePrompt(room.code, chooser.id, chooser.token, '早八人');
  assert.equal(room.phase, 'writing');
  assert.equal(room.round, 2);
  assert.equal(room.prompt, '早八人');
  assert.equal(room.promptChooserId, other.id);
});

test('sentence chars timeout uses drafts before system fallbacks', () => {
  const { game, room, host } = makeRoom(3);
  game.setVariant(room.code, host.id, host.token, 'sentence');
  game.start(room.code, host.id, host.token);
  assert.equal(room.phase, 'chars');
  game.saveCharDraft(room.code, host.id, host.token, '风');
  game.finishChars(room);
  assert.equal(room.phase, 'writing');
  assert.equal(room.chars.get(host.id), '风');
  const hostFill = room.autoFilled.find((item) => item.playerId === host.id);
  assert.equal(hostFill.source, 'draft');
  assert.equal(room.autoFilled.filter((item) => item.source === 'system').length, 2);
});

test('three-player sentence mode: chars -> order + sentence -> vote', () => {
  const { game, room, host, players } = makeRoom(3);
  game.setVariant(room.code, host.id, host.token, 'sentence');
  game.start(room.code, host.id, host.token);
  assert.equal(room.phase, 'chars');
  game.submitChar(room.code, players[0].id, players[0].token, '我');
  game.submitChar(room.code, players[1].id, players[1].token, '真');
  game.submitChar(room.code, players[2].id, players[2].token, '了');
  assert.equal(room.phase, 'writing');
  assert.deepEqual(room.players.map((player) => room.chars.get(player.id)), ['我', '真', '了']);

  const order = ['我', '真', '了'];
  for (const player of players) {
    game.submitSentence(room.code, player.id, player.token, order, '我今天真的累了');
  }
  assert.equal(room.phase, 'voting');
  game.submitVote(room.code, players[0].id, players[0].token, players[1].id);
  game.submitVote(room.code, players[1].id, players[1].token, players[0].id);
  game.submitVote(room.code, players[2].id, players[2].token, players[1].id);
  assert.equal(room.phase, 'reveal');
  const result = game.view(room, host.id).result;
  assert.equal(result.variant, 'sentence');
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.find((entry) => entry.playerId === players[1].id).votes, 2);
  assert.equal(result.winnerId, players[1].id);

  const next = game.nextRound(room.code, host.id, host.token);
  assert.equal(next.room.phase, 'chars');
  assert.equal(next.room.round, 2);
});
