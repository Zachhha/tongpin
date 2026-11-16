'use strict';

const crypto = require('node:crypto');
const { GameError } = require('./game');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MAX_SPECTATORS = 20;
const SECRET_SECONDS = 60;
const GUESS_SECONDS = 30;
const MAX_NAME_LENGTH = 12;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const THEMES = [
  { color: '#2563eb', soft: '#dbeafe', ink: '#0b1d3a' },
  { color: '#0f766e', soft: '#d1faf5', ink: '#082f2b' },
];

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

function cleanDigits(value, allowLeadingZero = false) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length !== 4) return '';
  if (!allowLeadingZero && digits[0] === '0') return '';
  return digits;
}

function tokenEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function matches(secret, guess) {
  return [...secret].reduce((count, digit, index) => count + (digit === guess[index] ? 1 : 0), 0);
}

function randomSecret() {
  const first = String(crypto.randomInt(1, 10));
  let rest = '';
  for (let index = 0; index < 3; index += 1) rest += String(crypto.randomInt(0, 10));
  return first + rest;
}

class NumberStore {
  constructor(options = {}) {
    this.rooms = new Map();
    this.now = options.now || (() => Date.now());
  }

  makeRoomCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let index = 0; index < 4; index += 1) {
        code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError(503, '房间号用完了，稍后再试。');
  }

  createRoom(name) {
    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    const room = {
      code: this.makeRoomCode(),
      createdAt: this.now(),
      updatedAt: this.now(),
      revision: 0,
      phase: 'lobby',
      hostId: null,
      players: [],
      spectators: [],
      secrets: new Map(),
      secretDrafts: new Map(),
      guessDrafts: new Map(),
      pending: new Map(),
      histories: new Map(),
      round: 0,
      roundEndsAt: null,
      winnerId: null,
      tie: false,
      autoFilled: [],
    };
    const player = this.addPlayer(room, clean);
    room.hostId = player.id;
    this.rooms.set(room.code, room);
    return { room, player };
  }

  addPlayer(room, name) {
    const player = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('hex'),
      name,
      seat: room.players.length,
      connected: true,
      ...THEMES[room.players.length % THEMES.length],
    };
    room.players.push(player);
    room.histories.set(player.id, []);
    return player;
  }

  nameTaken(room, name) {
    const lower = name.toLowerCase();
    return [...room.players, ...room.spectators].some((entry) => entry.name.toLowerCase() === lower);
  }

  joinRoom(code, name) {
    const room = this.room(code);
    if (room.phase !== 'lobby') throw new GameError(409, '这一局已经开始了。');
    if (room.players.length >= MAX_PLAYERS) throw new GameError(409, '这个模式最多四个人玩。');
    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    if (this.nameTaken(room, clean)) throw new GameError(409, '这个名字已经被占了。');
    const player = this.addPlayer(room, clean);
    this.touch(room);
    return { room, player };
  }

  addSpectator(code, name) {
    const room = this.room(code);
    if (room.spectators.length >= MAX_SPECTATORS) throw new GameError(409, '观战席已经满了。');
    let clean = cleanName(name) || '观众';
    if (this.nameTaken(room, clean)) clean = `${clean.slice(0, 10)}${crypto.randomInt(2, 99)}`;
    const spectator = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('hex'),
      name: clean,
      connected: true,
    };
    room.spectators.push(spectator);
    this.touch(room);
    return { room, spectator };
  }

  room(code) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) throw new GameError(404, '房间不存在，可能已经结束了。');
    return room;
  }

  authenticate(code, memberId, token, role = 'player') {
    const room = this.room(code);
    const list = role === 'spectator' ? room.spectators : room.players;
    const member = list.find((entry) => entry.id === memberId);
    if (!member || !tokenEquals(member.token, token)) {
      throw new GameError(401, '身份已失效，请重新加入房间。');
    }
    return { room, player: role === 'player' ? member : null, spectator: role === 'spectator' ? member : null, role };
  }

  rejoin(code, playerId, token, role = 'player') {
    const auth = this.authenticate(code, playerId, token, role);
    const member = role === 'spectator' ? auth.spectator : auth.player;
    member.connected = true;
    this.touch(auth.room);
    return auth;
  }

  leave(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'lobby') throw new GameError(409, '游戏开始后不能退出。');
    room.players = room.players.filter((entry) => entry.id !== player.id);
    room.histories.delete(player.id);
    if (room.hostId === player.id) room.hostId = room.players[0]?.id || null;
    room.players.forEach((entry, index) => { entry.seat = index; });
    if (!room.players.length) {
      this.rooms.delete(room.code);
      return { room: null, deleted: true };
    }
    this.touch(room);
    return { room, deleted: false };
  }

  leaveSpectator(code, playerId, token) {
    const { room, spectator } = this.authenticate(code, playerId, token, 'spectator');
    room.spectators = room.spectators.filter((entry) => entry.id !== spectator.id);
    this.touch(room);
    return { room };
  }

  start(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开始。');
    if (room.phase !== 'lobby') throw new GameError(409, '游戏已经开始了。');
    if (room.players.length < MIN_PLAYERS) throw new GameError(409, '猜数字至少需要两个人。');
    room.secrets.clear();
    room.secretDrafts.clear();
    room.guessDrafts.clear();
    room.pending.clear();
    room.autoFilled = [];
    room.round = 0;
    room.winnerId = null;
    room.tie = false;
    room.histories.forEach((list) => list.length = 0);
    room.phase = 'secrets';
    room.roundEndsAt = this.now() + SECRET_SECONDS * 1000;
    this.touch(room);
    return { room };
  }

  submitSecret(code, playerId, token, secret) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'secrets') throw new GameError(409, '现在不是设置数字的时间。');
    const clean = cleanDigits(secret);
    if (!clean) throw new GameError(400, '请输入 4 位数字，第一位不能是 0。');
    room.secrets.set(player.id, clean);
    room.secretDrafts.delete(player.id);
    if (room.secrets.size >= room.players.length) this.beginGuessing(room);
    else this.touch(room);
    return { room };
  }

  submitDraft(code, playerId, token, kind, value) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (kind === 'secret' && room.phase === 'secrets') {
      room.secretDrafts.set(player.id, String(value || '').replace(/\D/g, '').slice(0, 4));
      this.touch(room);
      return { room };
    }
    if (kind === 'guess' && room.phase === 'guessing') {
      room.guessDrafts.set(player.id, String(value || '').replace(/\D/g, '').slice(0, 4));
      this.touch(room);
      return { room };
    }
    throw new GameError(409, '现在不能保存这个草稿。');
  }

  fillDraft(value, isSecret) {
    let digits = String(value || '').replace(/\D/g, '').slice(0, 4);
    while (digits.length < 4) digits += String(crypto.randomInt(0, 10));
    if (isSecret && digits[0] === '0') {
      digits = String(crypto.randomInt(1, 10)) + digits.slice(1);
    }
    return digits;
  }

  targetFor(room, playerId) {
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index < 0 || room.players.length < 2) return null;
    return room.players[(index + 1) % room.players.length];
  }

  beginGuessing(room) {
    room.phase = 'guessing';
    room.round = 1;
    room.pending.clear();
    room.guessDrafts.clear();
    room.roundEndsAt = this.now() + GUESS_SECONDS * 1000;
    this.touch(room);
  }

  recordGuess(room, player, guess) {
    const target = this.targetFor(room, player.id);
    if (!target) return;
    const secret = room.secrets.get(target.id);
    const result = matches(secret, guess);
    room.pending.set(player.id, {
      guess,
      matches: result,
      targetId: target.id,
      targetName: target.name,
    });
    room.histories.get(player.id).push({
      round: room.round,
      guess,
      matches: result,
      targetId: target.id,
      targetName: target.name,
    });
  }

  submitGuess(code, playerId, token, guess) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'guessing') throw new GameError(409, '现在不是猜数字时间。');
    if (room.pending.has(player.id)) throw new GameError(409, '这一轮你已经猜过了。');
    const clean = cleanDigits(guess, true);
    if (!clean) throw new GameError(400, '请输入 4 位数字。');
    this.recordGuess(room, player, clean);
    room.guessDrafts.delete(player.id);
    if (room.pending.size >= room.players.length) this.resolveGuessing(room);
    else this.touch(room);
    return { room };
  }

  resolveGuessing(room) {
    const solved = room.players.filter((player) => room.pending.get(player.id)?.matches === 4);
    if (solved.length) {
      room.phase = 'finished';
      room.tie = solved.length > 1;
      room.winnerId = solved.length === 1 ? solved[0].id : null;
      room.roundEndsAt = null;
      room.guessDrafts.clear();
      this.touch(room);
      return;
    }
    room.round += 1;
    room.pending.clear();
    room.guessDrafts.clear();
    room.roundEndsAt = this.now() + GUESS_SECONDS * 1000;
    this.touch(room);
  }

  finishSecrets(room) {
    if (room.phase !== 'secrets') return false;
    for (const player of room.players) {
      if (!room.secrets.has(player.id)) {
        const draft = room.secretDrafts.get(player.id);
        const secret = this.fillDraft(draft, true) || randomSecret();
        room.secrets.set(player.id, secret);
        room.autoFilled.push({ playerId: player.id, name: player.name, secret });
      }
    }
    room.secretDrafts.clear();
    this.beginGuessing(room);
    return true;
  }

  finishRound(room) {
    if (room.phase !== 'guessing') return false;
    for (const player of room.players) {
      if (room.pending.has(player.id)) continue;
      const draft = room.guessDrafts.get(player.id);
      const guess = this.fillDraft(draft, false);
      this.recordGuess(room, player, guess);
    }
    this.resolveGuessing(room);
    return true;
  }

  restart(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以重开。');
    if (room.phase === 'lobby') throw new GameError(409, '现在已经在准备大厅里了。');
    room.phase = 'lobby';
    room.round = 0;
    room.secrets.clear();
    room.secretDrafts.clear();
    room.guessDrafts.clear();
    room.pending.clear();
    room.autoFilled = [];
    room.winnerId = null;
    room.tie = false;
    room.roundEndsAt = null;
    room.histories.forEach((list) => list.length = 0);
    this.touch(room);
    return { room };
  }

  view(room, viewerId, role = 'player') {
    const isPlayer = role === 'player';
    const viewer = isPlayer
      ? room.players.find((candidate) => candidate.id === viewerId)
      : room.spectators.find((candidate) => candidate.id === viewerId);
    if (!viewer) throw new GameError(401, '你不在这个房间里。');
    const finished = room.phase === 'finished';
    const revealSecrets = finished;
    return {
      code: room.code,
      revision: room.revision,
      phase: room.phase,
      hostId: room.hostId,
      role,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      maxSpectators: MAX_SPECTATORS,
      round: room.round,
      roundEndsAt: room.roundEndsAt,
      winnerId: room.winnerId,
      tie: room.tie,
      autoFilled: room.autoFilled,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        color: player.color,
        softColor: player.softColor,
        isHost: player.id === room.hostId,
        isYou: isPlayer && player.id === viewerId,
        hasSecret: room.secrets.has(player.id),
        submitted: room.pending.has(player.id),
        targetId: this.targetFor(room, player.id)?.id || null,
        targetName: this.targetFor(room, player.id)?.name || null,
        secret: revealSecrets || (isPlayer && player.id === viewerId) ? room.secrets.get(player.id) || null : null,
        history: (isPlayer && player.id === viewerId) || revealSecrets ? room.histories.get(player.id) || [] : [],
      })),
      spectators: room.spectators.map((spectator) => ({
        id: spectator.id,
        name: spectator.name,
        isYou: !isPlayer && spectator.id === viewerId,
      })),
      spectatorCount: room.spectators.length,
      viewer: {
        id: viewer.id,
        name: viewer.name,
        isHost: isPlayer && viewer.id === room.hostId,
        isSpectator: !isPlayer,
        hasSecret: isPlayer && room.secrets.has(viewer.id),
        submitted: isPlayer && room.pending.has(viewer.id),
        targetId: isPlayer ? this.targetFor(room, viewer.id)?.id || null : null,
        targetName: isPlayer ? this.targetFor(room, viewer.id)?.name || null : null,
        draft: isPlayer
          ? (room.phase === 'secrets'
            ? room.secretDrafts.get(viewer.id) || ''
            : room.phase === 'guessing'
              ? room.guessDrafts.get(viewer.id) || ''
              : '')
          : '',
        history: isPlayer ? room.histories.get(viewer.id) || [] : [],
      },
      canStart: isPlayer && room.phase === 'lobby' && viewer.id === room.hostId && room.players.length >= MIN_PLAYERS,
      canRestart: isPlayer && finished && viewer.id === room.hostId,
      serverNow: this.now(),
    };
  }

  touch(room) {
    room.revision += 1;
    room.updatedAt = this.now();
  }
}

module.exports = {
  NumberStore,
  GameError,
  constants: { MIN_PLAYERS, MAX_PLAYERS, MAX_SPECTATORS, SECRET_SECONDS, GUESS_SECONDS },
};
