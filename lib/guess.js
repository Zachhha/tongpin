'use strict';

const crypto = require('node:crypto');
const { GameError } = require('./game');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MAX_GUESSERS = 3;
const MAX_SPECTATORS = 20;
const MAX_NAME_LENGTH = 12;
const MAX_DESCRIPTION_LENGTH = 180;
const MAX_SUBJECT_LENGTH = 8;
const DEFAULT_SUBJECT = '朋友';
const MAX_ROOMS = 500;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const PLAYER_THEMES = [
  { color: '#ff5a36', soft: '#ffe1d7', ink: '#3a130b' },
  { color: '#178b77', soft: '#d8f2eb', ink: '#083b32' },
  { color: '#536cdb', soft: '#e0e6ff', ink: '#172458' },
  { color: '#c18b13', soft: '#ffedc2', ink: '#4b3405' },
];

function cleanName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function cleanDescription(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);
}

function cleanSubject(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/^[（(]+|[）)]+$/g, '')
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH);
}

function tokenEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tierFor(diff) {
  if (diff === 0) return 'exact';
  if (diff === 1) return 'one';
  if (diff === 2) return 'two';
  return 'miss';
}

class GuessStore {
  constructor(options = {}) {
    this.rooms = new Map();
    this.now = options.now || (() => Date.now());
    this.maxRooms = options.maxRooms || MAX_ROOMS;
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
    if (this.rooms.size >= this.maxRooms) {
      throw new GameError(503, '现在开房的人有点多，稍后再试。');
    }
    const now = this.now();
    const room = {
      code: this.makeRoomCode(),
      createdAt: now,
      updatedAt: now,
      revision: 0,
      phase: 'lobby',
      round: 0,
      hostId: null,
      descriptorId: null,
      target: null,
      subject: DEFAULT_SUBJECT,
      subjectCustom: false,
      description: '',
      startedAt: null,
      guessStartedAt: null,
      players: [],
      spectators: [],
      guesses: new Map(),
      history: [],
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
      lastSeenAt: this.now(),
      submitted: false,
      score: null,
      ...PLAYER_THEMES[room.players.length % PLAYER_THEMES.length],
    };
    room.players.push(player);
    return player;
  }

  nameTaken(room, name) {
    const lower = name.toLowerCase();
    return (
      room.players.some((player) => player.name.toLowerCase() === lower) ||
      room.spectators.some((spectator) => spectator.name.toLowerCase() === lower)
    );
  }

  joinRoom(code, name) {
    const room = this.room(code);
    if (room.phase !== 'lobby') throw new GameError(409, '这一局已经开始了。');
    if (room.players.length >= MAX_PLAYERS) throw new GameError(409, '房间已经坐满了。');
    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    if (this.nameTaken(room, clean)) throw new GameError(409, '这个名字已经被占了。');
    const player = this.addPlayer(room, clean);
    this.touch(room);
    return { room, player };
  }

  addSpectator(code, name) {
    const room = this.room(code);
    if (room.spectators.length >= MAX_SPECTATORS) {
      throw new GameError(409, '观战席已经满了。');
    }
    const clean = this.makeNameUnique(room, cleanName(name) || '观众');
    const spectator = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('hex'),
      name: clean,
      connected: true,
      joinedAt: this.now(),
    };
    room.spectators.push(spectator);
    this.touch(room);
    return { room, spectator };
  }

  makeNameUnique(room, base) {
    const clean = cleanName(base) || '朋友';
    if (!this.nameTaken(room, clean)) return clean;
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${clean.slice(0, MAX_NAME_LENGTH - 2)}${index}`;
      if (!this.nameTaken(room, candidate)) return candidate;
    }
    return `${clean.slice(0, 8)}${crypto.randomInt(10, 99)}`;
  }

  room(code) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) throw new GameError(404, '房间不存在，可能已经结束了。');
    return room;
  }

  authenticate(code, playerId, token, role = 'player') {
    const room = this.room(code);
    const list = role === 'spectator' ? room.spectators : room.players;
    const member = list.find((entry) => entry.id === playerId);
    if (!member || !tokenEquals(member.token, token)) {
      throw new GameError(401, '身份已失效，请重新加入房间。');
    }
    member.lastSeenAt = this.now();
    return {
      room,
      player: role === 'player' ? member : null,
      spectator: role === 'spectator' ? member : null,
      role,
    };
  }

  rejoin(code, playerId, token, role = 'player') {
    const auth = this.authenticate(code, playerId, token, role);
    const member = role === 'spectator' ? auth.spectator : auth.player;
    member.connected = true;
    this.touch(auth.room);
    return { room: auth.room, player: auth.player, spectator: auth.spectator, role };
  }

  leaveSpectator(code, spectatorId, token) {
    const { room, spectator } = this.authenticate(code, spectatorId, token, 'spectator');
    room.spectators = room.spectators.filter((entry) => entry.id !== spectator.id);
    this.touch(room);
    return { room, deleted: false };
  }

  leaveLobby(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'lobby') throw new GameError(409, '游戏开始后不能退出房间。');
    room.players = room.players.filter((entry) => entry.id !== player.id);
    if (room.hostId === player.id) {
      room.hostId = room.players[0]?.id || null;
    }
    room.players.forEach((entry, index) => {
      entry.seat = index;
    });
    if (!room.players.length) {
      this.rooms.delete(room.code);
      return { room: null, deleted: true };
    }
    this.touch(room);
    return { room, deleted: false };
  }

  restart(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以重开对局。');
    if (room.phase === 'lobby') throw new GameError(409, '现在已经在准备大厅里了。');

    room.phase = 'lobby';
    room.round = 0;
    room.descriptorId = null;
    room.target = null;
    room.subject = DEFAULT_SUBJECT;
    room.subjectCustom = false;
    room.description = '';
    room.startedAt = null;
    room.guessStartedAt = null;
    room.guesses.clear();
    room.history = [];
    for (const member of room.players) {
      member.submitted = false;
      member.score = null;
    }
    this.touch(room);
    return { room };
  }

  setSubject(code, playerId, token, subject, subjectCustom) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以选择满分对象。');
    if (room.phase !== 'lobby') throw new GameError(409, '开局后不能改满分对象。');
    const custom = Boolean(subjectCustom);
    const cleanSubjectValue = custom ? cleanSubject(subject) : DEFAULT_SUBJECT;
    if (custom && !cleanSubjectValue) throw new GameError(400, '写一个满分对象，比如“同事”。');
    room.subject = cleanSubjectValue;
    room.subjectCustom = custom;
    this.touch(room);
    return { room };
  }

  start(code, playerId, token, subject, subjectCustom) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开始。');
    if (room.phase !== 'lobby') throw new GameError(409, '这一局已经开始了。');
    if (room.players.length < MIN_PLAYERS) throw new GameError(409, '至少需要两个人。');
    if (room.players.length > MAX_PLAYERS) throw new GameError(409, '房间人数太多了。');

    if (subject !== undefined || subjectCustom !== undefined) {
      const custom = Boolean(subjectCustom);
      const cleanSubjectValue = custom ? cleanSubject(subject) : DEFAULT_SUBJECT;
      if (custom && !cleanSubjectValue) throw new GameError(400, '写一个满分对象，比如“同事”。');
      room.subject = cleanSubjectValue;
      room.subjectCustom = custom;
    }

    room.round = 1;
    room.phase = 'describe';
    room.descriptorId = room.hostId;
    room.description = '';
    room.target = crypto.randomInt(0, 11);
    room.guesses.clear();
    room.startedAt = this.now();
    room.guessStartedAt = null;
    this.touch(room);
    return { room };
  }

  submitDescription(code, playerId, token, description) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'describe') throw new GameError(409, '现在不是描述时间。');
    if (room.descriptorId !== player.id) throw new GameError(403, '现在轮不到你描述。');
    const clean = cleanDescription(description);
    if (!clean) throw new GameError(400, '先写一段描述。');
    room.description = clean;
    room.phase = 'guess';
    room.guessStartedAt = this.now();
    this.touch(room);
    return { room };
  }

  submitGuess(code, playerId, token, score) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'guess') throw new GameError(409, '现在还不能打分。');
    if (room.descriptorId === player.id) throw new GameError(403, '描述者不能给自己打分。');
    const value = Number(score);
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      throw new GameError(400, '分数必须是 0 到 10 的整数。');
    }
    if (room.guesses.has(player.id)) throw new GameError(409, '你已经打过分了。');
    room.guesses.set(player.id, value);
    player.submitted = true;
    player.score = value;
    const guesserCount = room.players.length - 1;
    if (room.guesses.size >= guesserCount) this.reveal(room);
    this.touch(room);
    return { room, revealed: room.phase === 'reveal' };
  }

  reveal(room) {
    const descriptor = room.players.find((player) => player.id === room.descriptorId);
    const entries = room.players
      .filter((player) => player.id !== room.descriptorId)
      .map((player) => {
        const score = room.guesses.get(player.id);
        const diff = Math.abs(score - room.target);
        return {
          playerId: player.id,
          name: player.name,
          score,
          diff,
          tier: tierFor(diff),
        };
      });
    const result = {
      round: room.round,
      descriptorId: room.descriptorId,
      descriptorName: descriptor ? descriptor.name : '已离开的描述者',
      target: room.target,
      subject: room.subject,
      subjectCustom: room.subjectCustom,
      description: room.description,
      entries,
      revealedAt: this.now(),
    };
    room.history.push(result);
    room.phase = 'reveal';
    this.touch(room);
    return result;
  }

  chooseNext(code, playerId, token, nextDescriptorId) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'reveal') throw new GameError(409, '还没到换人的时候。');
    if (room.descriptorId !== player.id) throw new GameError(403, '只有当前描述者可以选择下一位。');
    const next = room.players.find((candidate) => candidate.id === nextDescriptorId);
    if (!next) throw new GameError(404, '找不到这位玩家。');

    room.round += 1;
    room.phase = 'describe';
    room.descriptorId = next.id;
    room.target = crypto.randomInt(0, 11);
    room.description = '';
    room.guesses.clear();
    for (const member of room.players) {
      member.submitted = false;
      member.score = null;
    }
    room.startedAt = this.now();
    room.guessStartedAt = null;
    this.touch(room);
    return { room };
  }

  view(room, viewerId, role = 'player') {
    const isPlayer = role === 'player';
    const viewer = isPlayer
      ? room.players.find((candidate) => candidate.id === viewerId)
      : room.spectators.find((candidate) => candidate.id === viewerId);
    if (!viewer) throw new GameError(401, '你不在这个房间里。');
    const revealing = room.phase === 'reveal';
    const isDescriptor = isPlayer && room.descriptorId === viewerId;
    const result = revealing ? room.history[room.history.length - 1] : null;
    const guesses = room.players
      .filter((candidate) => candidate.id !== room.descriptorId)
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        submitted: room.guesses.has(candidate.id),
        score: revealing ? room.guesses.get(candidate.id) : null,
      }));
    const publicPlayers = room.players.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      seat: candidate.seat,
      color: candidate.color,
      softColor: candidate.softColor,
      inkColor: candidate.inkColor,
      isHost: candidate.id === room.hostId,
      isYou: isPlayer && candidate.id === viewerId,
      isDescriptor: candidate.id === room.descriptorId,
      connected: candidate.connected,
      submitted: room.guesses.has(candidate.id),
      score: revealing ? room.guesses.get(candidate.id) ?? null : null,
    }));

    return {
      code: room.code,
      revision: room.revision,
      phase: room.phase,
      round: room.round,
      hostId: room.hostId,
      role,
      descriptorId: room.descriptorId,
      descriptorName:
        room.players.find((candidate) => candidate.id === room.descriptorId)?.name || null,
      target: isDescriptor || revealing ? room.target : null,
      subject: room.subject || DEFAULT_SUBJECT,
      subjectCustom: Boolean(room.subjectCustom),
      description: room.phase === 'guess' || revealing ? room.description : '',
      players: publicPlayers,
      guessers: guesses,
      guesserCount: room.players.length - 1,
      submittedCount: room.guesses.size,
      spectators: room.spectators.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        isYou: !isPlayer && candidate.id === viewerId,
      })),
      spectatorCount: room.spectators.length,
      maxSpectators: MAX_SPECTATORS,
      viewer: isPlayer
        ? {
            id: viewer.id,
            name: viewer.name,
            isHost: viewer.id === room.hostId,
            isDescriptor,
            isSpectator: false,
            submitted: room.guesses.has(viewer.id),
            score: revealing ? room.guesses.get(viewer.id) ?? null : null,
          }
        : {
            id: viewer.id,
            name: viewer.name,
            isHost: false,
            isDescriptor: false,
            isSpectator: true,
            submitted: false,
            score: null,
          },
      result,
      history: room.history,
      canStart:
        isPlayer &&
        room.phase === 'lobby' &&
        room.hostId === viewerId &&
        room.players.length >= MIN_PLAYERS &&
        room.players.length <= MAX_PLAYERS,
      canChooseNext: revealing && isDescriptor,
      nextCandidates: revealing && isDescriptor ? publicPlayers : [],
      serverNow: this.now(),
    };
  }

  touch(room) {
    room.revision += 1;
    room.updatedAt = this.now();
  }
}

module.exports = {
  GuessStore,
  GameError,
  constants: {
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_GUESSERS,
    MAX_NAME_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_SUBJECT_LENGTH,
    MAX_SPECTATORS,
    DEFAULT_SUBJECT,
  },
};
