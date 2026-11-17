'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GuessStore } = require('../lib/guess');

function makeRoom(count = 3) {
  const game = new GuessStore();
  const created = game.createRoom('描述者');
  const players = [created.player];
  for (let index = 1; index < count; index += 1) {
    players.push(game.joinRoom(created.room.code, `猜分者${index}`).player);
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

test('guess mode starts with one descriptor and 1–3 guessers', () => {
  const { game, room, players, host } = makeRoom(4);
  game.start(room.code, host.id, host.token);
  assert.equal(room.phase, 'describe');
  assert.equal(room.descriptorId, host.id);
  assert.equal(room.players.length, 4);
  assert.ok(Number.isInteger(room.target) && room.target >= 0 && room.target <= 10);

  const owner = game.view(room, host.id);
  assert.equal(owner.viewer.isDescriptor, true);
  assert.equal(owner.target, room.target);
  const guesser = game.view(room, players[1].id);
  assert.equal(guesser.viewer.isDescriptor, false);
  assert.equal(guesser.target, null);
  assert.equal(guesser.description, '');
  assert.equal(owner.guesserCount, 3);

  const tooMany = makeRoom(4);
  assert.equal(errorOf(() => tooMany.game.joinRoom(tooMany.room.code, '第五个')).status, 409);
});

test('descriptor submits a description, then all guessers rate and reveal together', () => {
  const { game, room, players, host } = makeRoom(4);
  game.start(room.code, host.id, host.token);
  const target = room.target;

  game.submitDescription(room.code, host.id, host.token, '他长得帅、收入高，但是每次吵架都会消失两天。');
  assert.equal(room.phase, 'guess');
  const viewed = game.view(room, players[1].id);
  assert.equal(viewed.description, room.description);
  assert.equal(viewed.target, null);
  assert.equal(viewed.submittedCount, 0);
  const descriptorGuess = errorOf(() =>
    game.submitGuess(room.code, host.id, host.token, 5),
  );
  assert.equal(descriptorGuess.status, 403);

  const oneScore = target >= 1 ? target - 1 : target + 1;
  const twoScore = target <= 8 ? target + 2 : target - 2;
  game.submitGuess(room.code, players[1].id, players[1].token, target);
  game.submitGuess(room.code, players[2].id, players[2].token, oneScore);
  assert.equal(room.phase, 'guess');
  game.submitGuess(room.code, players[3].id, players[3].token, twoScore);
  assert.equal(room.phase, 'reveal');

  const result = game.view(room, host.id).result;
  assert.equal(result.target, target);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0].diff, 0);
  assert.equal(result.entries[0].tier, 'exact');
  assert.equal(result.entries[1].diff, 1);
  assert.equal(result.entries[1].tier, 'one');
  assert.equal(result.entries[2].diff, 2);
  assert.equal(result.entries[2].tier, 'two');
});

test('the host chooses the subject during lobby preparation', () => {
  const { game, room, players, host } = makeRoom(3);
  game.setSubject(room.code, host.id, host.token, '同事', true);
  assert.equal(room.subject, '同事');
  assert.equal(room.subjectCustom, true);
  assert.equal(
    errorOf(() => game.setSubject(room.code, players[1].id, players[1].token, '同事', true)).status,
    403,
  );

  game.start(room.code, host.id, host.token);
  assert.equal(room.subject, '同事');
  assert.equal(room.subjectCustom, true);
  game.submitDescription(room.code, host.id, host.token, '每次开会都会把话题带到别的地方。');
  assert.equal(room.phase, 'guess');
  const guesserView = game.view(room, players[1].id);
  assert.equal(guesserView.subject, '同事');
  assert.equal(guesserView.subjectCustom, true);
  assert.equal(guesserView.target, null);

  const target = room.target;
  game.submitGuess(room.code, players[1].id, players[1].token, target);
  game.submitGuess(
    room.code,
    players[2].id,
    players[2].token,
    target === 0 ? 1 : target - 1,
  );
  const result = game.view(room, host.id).result;
  assert.equal(result.subject, '同事');
  assert.equal(result.subjectCustom, true);
  assert.deepEqual(
    result.entries.map((entry) => entry.tier),
    ['exact', 'one'],
  );
});

test('Q&A mode: questions, answers, then scoring', () => {
  const { game, room, players, host } = makeRoom(3);
  game.setOptions(room.code, host.id, host.token, true);
  game.start(room.code, host.id, host.token);
  assert.equal(room.qaMode, true);
  game.submitDescription(room.code, host.id, host.token, '他很温柔，但是从不主动道歉。');
  assert.equal(room.phase, 'question');
  assert.ok(room.phaseEndsAt - Date.now() > 39000);

  const guesserView = game.view(room, players[1].id);
  assert.equal(guesserView.target, null);
  assert.equal(guesserView.questions.length, 0);
  game.saveQuestionDraft(room.code, players[1].id, players[1].token, '那他会主动联系吗？');
  game.submitQuestion(room.code, players[1].id, players[1].token, '那他会主动联系吗？');
  game.submitQuestion(room.code, players[2].id, players[2].token, '他平时会记得纪念日吗？');
  assert.equal(room.phase, 'answer');
  assert.equal(room.questions.size, 2);

  const answerer = game.view(room, host.id);
  assert.equal(answerer.questions.length, 2);
  game.submitAnswers(room.code, host.id, host.token, {
    [players[1].id]: '会，但通常要等很久。',
    [players[2].id]: '会记得，但不会准备惊喜。',
  });
  assert.equal(room.phase, 'guess');
  const guesserAfter = game.view(room, players[1].id);
  assert.ok(guesserAfter.questions.every((item) => item.answer));
  game.submitGuess(room.code, players[1].id, players[1].token, 5);
  game.submitGuess(room.code, players[2].id, players[2].token, 5);
  const result = game.view(room, host.id).result;
  assert.equal(result.qaMode, true);
  assert.ok(result.entries.every((entry) => entry.question && entry.answer));
});

test('Q&A timeout uses the saved question draft', () => {
  const { game, room, players, host } = makeRoom(2);
  game.setOptions(room.code, host.id, host.token, true);
  game.start(room.code, host.id, host.token);
  game.submitDescription(room.code, host.id, host.token, '他很可靠，但是有点无聊。');
  game.saveQuestionDraft(room.code, players[1].id, players[1].token, '他会主动规划约会吗？');
  assert.equal(room.phase, 'question');
  game.finishQuestions(room);
  assert.equal(room.phase, 'answer');
  assert.equal(room.questions.get(players[1].id), '他会主动规划约会吗？');
});

test('spectators can watch but never see the target or act', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  const { spectator } = game.addSpectator(room.code, '看客');
  const spectatorView = game.view(room, spectator.id, 'spectator');
  assert.equal(spectatorView.role, 'spectator');
  assert.equal(spectatorView.viewer.isSpectator, true);
  assert.equal(spectatorView.target, null);
  assert.equal(spectatorView.spectatorCount, 1);
  assert.equal(spectatorView.canStart, false);

  game.submitDescription(room.code, host.id, host.token, '他很温柔，但是从不主动道歉。');
  const guessView = game.view(room, spectator.id, 'spectator');
  assert.ok(guessView.description);
  assert.equal(guessView.target, null);
  assert.equal(guessView.viewer.isDescriptor, false);

  assert.equal(
    errorOf(() => game.submitGuess(room.code, spectator.id, spectator.token, 5)).status,
    401,
  );
  game.submitGuess(room.code, players[1].id, players[1].token, 5);
  const revealView = game.view(room, spectator.id, 'spectator');
  assert.equal(revealView.target, room.target);
  assert.ok(revealView.result);
  assert.equal(revealView.canChooseNext, false);

  game.leaveSpectator(room.code, spectator.id, spectator.token);
  assert.equal(room.spectators.length, 0);
});

test('next candidates never expose player tokens', () => {
  const { game, room, players, host } = makeRoom(3);
  game.start(room.code, host.id, host.token);
  game.submitDescription(room.code, host.id, host.token, '他很温柔，但是从不主动道歉。');
  game.submitGuess(room.code, players[1].id, players[1].token, 5);
  game.submitGuess(room.code, players[2].id, players[2].token, 6);
  const view = game.view(room, host.id);
  assert.ok(view.nextCandidates.length === 3);
  assert.ok(view.nextCandidates.every((player) => !('token' in player)));
  assert.ok(view.players.every((player) => !('token' in player)));
});

test('the descriptor can continue or hand over to another player', () => {
  const { game, room, players, host } = makeRoom(3);
  game.start(room.code, host.id, host.token);
  game.submitDescription(room.code, host.id, host.token, '他很温柔，但是从不主动道歉。');
  game.submitGuess(room.code, players[1].id, players[1].token, 5);
  game.submitGuess(room.code, players[2].id, players[2].token, 6);
  assert.equal(room.phase, 'reveal');
  assert.equal(game.view(room, host.id).canChooseNext, true);
  assert.equal(game.view(room, players[1].id).canChooseNext, false);

  const forbidden = errorOf(() =>
    game.chooseNext(room.code, players[1].id, players[1].token, players[1].id),
  );
  assert.equal(forbidden.status, 403);

  game.chooseNext(room.code, host.id, host.token, players[1].id);
  assert.equal(room.phase, 'describe');
  assert.equal(room.round, 2);
  assert.equal(room.descriptorId, players[1].id);
  assert.equal(game.view(room, players[1].id).target, room.target);

  game.submitDescription(room.code, players[1].id, players[1].token, '她很有趣，但是总是迟到。');
  assert.equal(room.phase, 'guess');
  game.submitGuess(room.code, host.id, host.token, 5);
  game.submitGuess(room.code, players[2].id, players[2].token, 6);
  assert.equal(room.phase, 'reveal');

  game.chooseNext(room.code, players[1].id, players[1].token, players[1].id);
  assert.equal(room.round, 3);
  assert.equal(room.descriptorId, players[1].id);
});

test('guess mode only accepts integer scores from 0 to 10', () => {
  const { game, room, players, host } = makeRoom(2);
  game.start(room.code, host.id, host.token);
  game.submitDescription(room.code, host.id, host.token, '他很可靠，但是有点无聊。');
  assert.equal(errorOf(() => game.submitGuess(room.code, players[1].id, players[1].token, 11)).status, 400);
  assert.equal(errorOf(() => game.submitGuess(room.code, players[1].id, players[1].token, 4.5)).status, 400);
  game.submitGuess(room.code, players[1].id, players[1].token, 0);
  assert.equal(room.phase, 'reveal');
});
