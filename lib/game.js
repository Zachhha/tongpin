'use strict';

const crypto = require('node:crypto');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MAX_SPECTATORS = 20;
const MAX_NAME_LENGTH = 12;
const MAX_WORD_LENGTH = 24;
const DEFAULT_DURATION_SEC = 60;
const AUTO_SUBMIT_DURATIONS = new Set([15, 20]);
const DEFAULT_DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const PLAYER_THEMES = [
  { color: '#ff5a36', soft: '#ffe1d7', ink: '#3a130b' },
  { color: '#177d73', soft: '#d8f2eb', ink: '#09342f' },
  { color: '#3858d6', soft: '#e0e6ff', ink: '#111f52' },
  { color: '#b67a00', soft: '#ffedc2', ink: '#3b2700' },
];

class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateRunes(value, max) {
  return Array.from(value).slice(0, max).join('');
}

function cleanName(value) {
  return truncateRunes(normalizeText(value), MAX_NAME_LENGTH);
}

function cleanDraft(value) {
  if (typeof value !== 'string') return '';
  return truncateRunes(
    value
      .normalize('NFKC')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' '),
    MAX_WORD_LENGTH,
  );
}

function normalizeWord(value) {
  return truncateRunes(cleanDraft(value).trim(), MAX_WORD_LENGTH);
}

function wordKey(value) {
  return normalizeWord(value).toLocaleLowerCase();
}

function tokenEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

class GameStore {
  constructor(options = {}) {
    this.rooms = new Map();
    this.allowedDurations = options.allowedDurations || DEFAULT_DURATIONS;
    this.maxRooms = options.maxRooms || 500;
    this.now = options.now || (() => Date.now());
  }

  room(code) {
    const normalized = String(code || '').trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) throw new GameError(404, '没有找到这个房间，检查一下房间码。');
    return room;
  }

  touch(room) {
    room.updatedAt = this.now();
    room.revision += 1;
  }

  makeRoomCode() {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      let code = '';
      const bytes = crypto.randomBytes(4);
      for (let i = 0; i < 4; i += 1) {
        code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError(503, '房间太多了，稍后再试。');
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
      hostId: null,
      phase: 'lobby',
      round: 0,
      durationSec: DEFAULT_DURATION_SEC,
      roundStartedAt: null,
      phaseEndsAt: null,
      players: [],
      spectators: [],
      rounds: [],
      continueSet: new Set(),
      wordLikes: new Map(),
    };

    const player = this.addPlayer(room, clean);
    room.hostId = player.id;
    this.rooms.set(room.code, room);
    return { room, player };
  }

  nameTaken(room, name) {
    const key = cleanName(name).toLocaleLowerCase();
    return [...room.players, ...room.spectators].some(
      (member) => member.name.toLocaleLowerCase() === key,
    );
  }

  joinRoom(code, name) {
    const room = this.room(code);
    if (room.phase !== 'lobby') {
      throw new GameError(409, '这一局已经开始了，等下一局再来。');
    }
    if (room.players.length >= MAX_PLAYERS) {
      throw new GameError(409, '房间已经坐满四个人了。');
    }

    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    if (this.nameTaken(room, clean)) {
      throw new GameError(409, '这个名字已经有人用了，换一个吧。');
    }

    const player = this.addPlayer(room, clean);
    this.touch(room);
    return { room, player };
  }

  uniqueSpectatorName(room, requested) {
    const base = cleanName(requested) || '观众';
    if (!this.nameTaken(room, base)) return base;
    for (let index = 2; index < 100; index += 1) {
      const candidate = truncateRunes(`${base} ${index}`, MAX_NAME_LENGTH);
      if (!this.nameTaken(room, candidate)) return candidate;
    }
    return truncateRunes(`${base} ${crypto.randomUUID().slice(0, 4)}`, MAX_NAME_LENGTH);
  }

  addSpectator(code, name) {
    const room = this.room(code);
    if (room.spectators.length >= MAX_SPECTATORS) {
      throw new GameError(409, '观战席满了，等有人离开再来。');
    }
    const clean = this.uniqueSpectatorName(room, name);
    const now = this.now();
    const spectator = {
      id: crypto.randomUUID(),
      token: randomToken(),
      name: clean,
      joinedAt: now,
      lastSeenAt: now,
      connected: true,
    };
    room.spectators.push(spectator);
    this.touch(room);
    return { room, spectator };
  }

  addPlayer(room, name) {
    const seat = room.players.length;
    const theme = PLAYER_THEMES[seat];
    const player = {
      id: crypto.randomUUID(),
      token: randomToken(),
      name,
      seat,
      color: theme.color,
      softColor: theme.soft,
      inkColor: theme.ink,
      joinedAt: this.now(),
      lastSeenAt: this.now(),
      connected: true,
      draft: '',
      submitted: false,
      word: '',
      continued: false,
    };
    room.players.push(player);
    return player;
  }

  authenticate(code, memberId, token, role = 'player') {
    const room = this.room(code);
    const list = role === 'spectator' ? room.spectators : room.players;
    const member = list.find((entry) => entry.id === memberId);
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

  rejoin(code, memberId, token, role = 'player') {
    const auth = this.authenticate(code, memberId, token, role);
    const member = role === 'spectator' ? auth.spectator : auth.player;
    member.connected = true;
    member.lastSeenAt = this.now();
    this.touch(auth.room);
    return { room: auth.room, player: auth.player, spectator: auth.spectator, role };
  }

  setConnected(code, memberId, connected, role = 'player') {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return null;
    const list = role === 'spectator' ? room.spectators : room.players;
    const member = list.find((entry) => entry.id === memberId);
    if (!member) return null;

    const changed = member.connected !== connected;
    member.connected = connected;
    member.lastSeenAt = this.now();

    if (role === 'spectator') {
      this.touch(room);
      return { room, changed, advanced: false };
    }

    let advanced = false;
    if (!connected && room.hostId === member.id && room.phase === 'lobby') {
      const nextHost = room.players.find((entry) => entry.connected);
      if (nextHost) room.hostId = nextHost.id;
    }
    advanced = this.maybeAdvance(room);

    this.touch(room);
    return { room, changed, advanced };
  }

  setDuration(code, playerId, token, seconds) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以改时间。');
    if (room.phase !== 'lobby') throw new GameError(409, '游戏开始后不能改时间。');
    const value = Number(seconds);
    if (!Number.isInteger(value) || !this.allowedDurations.includes(value)) {
      throw new GameError(400, '这个时长不可用。');
    }
    room.durationSec = value;
    this.touch(room);
    return { room };
  }

  start(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开始游戏。');
    if (room.phase !== 'lobby') throw new GameError(409, '游戏已经开始了。');
    if (room.players.length < MIN_PLAYERS) throw new GameError(409, '至少要有两个人才能开始。');
    if (room.players.length > MAX_PLAYERS) throw new GameError(409, '这个房间人太多了。');

    room.rounds = [];
    room.continueSet.clear();
    this.beginWriting(room, 1);
    return { room };
  }

  assertRound(room, expectedRound) {
    if (expectedRound === undefined || expectedRound === null) return;
    if (Number(expectedRound) !== room.round) {
      throw new GameError(409, '轮次已经更新，请跟着新的这一轮继续。');
    }
  }

  beginWriting(room, round) {
    const now = this.now();
    room.round = round;
    room.phase = 'writing';
    room.roundStartedAt = now;
    room.phaseEndsAt = now + room.durationSec * 1000;
    room.continueSet.clear();
    for (const player of room.players) {
      player.draft = '';
      player.submitted = false;
      player.word = '';
      player.continued = false;
    }
    this.touch(room);
  }

  saveDraft(code, playerId, token, draft, expectedRound) {
    const { room, player } = this.authenticate(code, playerId, token);
    this.assertRound(room, expectedRound);
    if (room.phase !== 'writing') throw new GameError(409, '现在不是写作时间。');
    if (player.submitted) throw new GameError(409, '提交后不能修改。');
    player.draft = cleanDraft(draft);
    player.lastSeenAt = this.now();
    this.touch(room);
    return { room, player };
  }

  submit(code, playerId, token, word, expectedRound) {
    const { room, player } = this.authenticate(code, playerId, token);
    this.assertRound(room, expectedRound);
    if (room.phase !== 'writing') throw new GameError(409, '这一轮已经揭晓了。');
    if (AUTO_SUBMIT_DURATIONS.has(room.durationSec)) {
      throw new GameError(
        409,
        `${room.durationSec} 秒模式不设提交按钮，倒计时结束会自动揭晓。`,
      );
    }
    if (player.submitted) {
      return { room, player, revealed: false, alreadySubmitted: true };
    }

    const clean = normalizeWord(word);
    if (!clean) throw new GameError(400, '写一个词再提交。');

    player.draft = clean;
    player.word = clean;
    player.submitted = true;
    this.touch(room);

    const everyoneSubmitted = room.players.every((entry) => entry.submitted);
    if (!everyoneSubmitted) {
      return { room, player, revealed: false };
    }
    const result = this.reveal(room, 'all-submitted');
    return { room, player, revealed: true, result };
  }

  reveal(roomOrCode, reason = 'timeout') {
    const room = typeof roomOrCode === 'string' ? this.room(roomOrCode) : roomOrCode;
    if (room.phase !== 'writing') return null;

    const now = this.now();
    const entries = room.players.map((player) => {
      const word = player.submitted
        ? normalizeWord(player.word)
        : normalizeWord(player.draft);
      player.word = word;
      player.draft = word;
      player.submitted = true;
      player.continued = false;
      return { playerId: player.id, word };
    });

    const allSame =
      entries.length > 0 &&
      entries.every((entry) => entry.word.length > 0) &&
      entries.every((entry) => wordKey(entry.word) === wordKey(entries[0].word));

    const groups = new Map();
    for (const entry of entries) {
      const key = wordKey(entry.word);
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, {
          word: entry.word,
          count: 0,
          playerIds: [],
        });
      }
      const group = groups.get(key);
      group.count += 1;
      group.playerIds.push(entry.playerId);
    }
    const wordGroups = [...groups.values()].sort((a, b) => b.count - a.count);
    const partialMatches = allSame
      ? []
      : wordGroups.filter((group) => group.count >= 2);

    const result = {
      round: room.round,
      entries,
      allSame,
      wordGroups,
      partialMatches,
      startedAt: room.roundStartedAt,
      endedBy: reason,
      revealedAt: now,
      durationSec: room.durationSec,
    };

    room.rounds.push(result);
    room.phase = allSame ? 'won' : 'reveal';
    room.phaseEndsAt = null;
    room.continueSet.clear();
    this.touch(room);
    return result;
  }

  continueRound(code, playerId, token, expectedRound) {
    const { room, player } = this.authenticate(code, playerId, token);
    this.assertRound(room, expectedRound);
    if (room.phase !== 'reveal' && room.phase !== 'won') {
      throw new GameError(409, '现在还不能继续。');
    }
    player.continued = true;
    room.continueSet.add(player.id);
    this.touch(room);
    const advanced = this.maybeAdvance(room);
    return { room, player, advanced };
  }

  leaveLobby(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'lobby') {
      throw new GameError(409, '游戏已经开始，这一局不能退出。');
    }

    room.players = room.players.filter((entry) => entry.id !== player.id);
    room.players.forEach((entry, index) => {
      entry.seat = index;
      const theme = PLAYER_THEMES[index];
      entry.color = theme.color;
      entry.softColor = theme.soft;
      entry.inkColor = theme.ink;
    });
    room.continueSet.delete(player.id);

    if (!room.players.length) {
      this.rooms.delete(room.code);
      return { deleted: true, room: null };
    }

    if (room.hostId === player.id) {
      const nextHost = room.players.find((entry) => entry.connected) || room.players[0];
      room.hostId = nextHost.id;
    }
    this.touch(room);
    return { deleted: false, room };
  }

  leaveSpectator(code, spectatorId, token) {
    const { room, spectator } = this.authenticate(
      code,
      spectatorId,
      token,
      'spectator',
    );
    room.spectators = room.spectators.filter((entry) => entry.id !== spectator.id);
    if (!room.players.length && !room.spectators.length) {
      this.rooms.delete(room.code);
      return { deleted: true, room: null };
    }
    this.touch(room);
    return { deleted: false, room };
  }

  maybeAdvance(room) {
    if (room.phase !== 'reveal' && room.phase !== 'won') return false;

    const active = room.players.filter((player) => player.connected);
    if (active.length < MIN_PLAYERS) return false;
    if (!active.every((player) => room.continueSet.has(player.id))) return false;

    if (room.phase === 'won') {
      room.rounds = [];
      room.wordLikes.clear();
      this.beginWriting(room, 1);
    } else {
      this.beginWriting(room, room.round + 1);
    }
    return true;
  }

  lastRound(room) {
    return room.rounds.length ? room.rounds[room.rounds.length - 1] : null;
  }

  serializeRound(room, round, viewerKey = null) {
    if (!round) return null;
    return {
      round: round.round,
      allSame: round.allSame,
      endedBy: round.endedBy,
      startedAt: round.startedAt || null,
      revealedAt: round.revealedAt,
      durationSec: round.durationSec,
      wordGroups: round.wordGroups || [],
      partialMatches: round.partialMatches || [],
      entries: round.entries.map((entry) => {
        const player = room.players.find((candidate) => candidate.id === entry.playerId);
        const likes = room.wordLikes.get(`${round.round}:${entry.playerId}`);
        return {
          playerId: entry.playerId,
          name: player ? player.name : '已离开的玩家',
          color: player ? player.color : '#7d776d',
          word: entry.word,
          likeCount: likes ? likes.size : 0,
          liked: viewerKey ? Boolean(likes && likes.has(viewerKey)) : false,
        };
      }),
    };
  }

  likeWord(code, memberId, token, targetRound, targetPlayerId, role = 'player') {
    const { room, player } = this.authenticate(code, memberId, token, role);
    if (!['writing', 'reveal', 'won'].includes(room.phase)) {
      throw new GameError(409, '现在还不能给词点赞。');
    }

    const round = room.rounds.find((candidate) => candidate.round === Number(targetRound));
    if (!round) throw new GameError(409, '这一轮还没有揭晓。');
    const entry = round.entries.find((candidate) => candidate.playerId === targetPlayerId);
    if (!entry || !entry.word) throw new GameError(404, '找不到这个词。');
    if (role === 'player' && player.id === entry.playerId) {
      throw new GameError(400, '不能给自己的词点赞。');
    }

    const key = `${round.round}:${entry.playerId}`;
    let likes = room.wordLikes.get(key);
    if (!likes) {
      likes = new Set();
      room.wordLikes.set(key, likes);
    }
    const actorKey = `${role}:${memberId}`;
    const alreadyLiked = likes.has(actorKey);
    if (!alreadyLiked) {
      likes.add(actorKey);
      this.touch(room);
    }
    return {
      room,
      liked: true,
      alreadyLiked,
      count: likes.size,
      round: round.round,
      targetPlayerId: entry.playerId,
    };
  }

  view(roomOrCode, viewerId, role = 'player') {
    const room = typeof roomOrCode === 'string' ? this.room(roomOrCode) : roomOrCode;
    const now = this.now();
    const isPlayer = role === 'player';
    const viewer = isPlayer
      ? room.players.find((player) => player.id === viewerId)
      : room.spectators.find((spectator) => spectator.id === viewerId);
    if (!viewer) throw new GameError(401, '你不在这个房间里。');
    const viewerKey = `${role}:${viewerId}`;

    const revealing = room.phase === 'reveal' || room.phase === 'won';
    const active = room.players.filter((player) => player.connected);
    const ready = active.filter((player) => room.continueSet.has(player.id));
    const submittedCount = room.players.filter((player) => player.submitted).length;

    return {
      code: room.code,
      revision: room.revision,
      phase: room.phase,
      round: room.round,
      hostId: room.hostId,
      durationSec: room.durationSec,
      roundStartedAt: room.roundStartedAt,
      phaseEndsAt: room.phaseEndsAt,
      serverNow: now,
      maxWordLength: MAX_WORD_LENGTH,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      maxSpectators: MAX_SPECTATORS,
      allowedDurations: this.allowedDurations,
      submittedCount,
      role,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        color: player.color,
        softColor: player.softColor,
        inkColor: player.inkColor,
        connected: player.connected,
        isHost: player.id === room.hostId,
        isYou: isPlayer && player.id === viewerId,
        submitted: player.submitted,
        continued: room.continueSet.has(player.id),
        word: revealing
          ? player.word
          : isPlayer && player.id === viewerId && player.submitted
            ? player.word
            : null,
      })),
      spectators: room.spectators.map((spectator) => ({
        id: spectator.id,
        name: spectator.name,
        connected: spectator.connected,
        isYou: !isPlayer && spectator.id === viewerId,
      })),
      spectatorCount: room.spectators.length,
      viewer: isPlayer
        ? {
            id: viewer.id,
            name: viewer.name,
            role: 'player',
            isSpectator: false,
            isHost: viewer.id === room.hostId,
            draft: viewer.draft,
            submitted: viewer.submitted,
            continued: room.continueSet.has(viewer.id),
            word: viewer.word || null,
          }
        : {
            id: viewer.id,
            name: viewer.name,
            role: 'spectator',
            isSpectator: true,
            isHost: false,
            draft: '',
            submitted: false,
            continued: false,
            word: null,
          },
      result: revealing
        ? this.serializeRound(room, this.lastRound(room), viewerKey)
        : null,
      lastRound:
        room.phase === 'writing'
          ? this.serializeRound(room, this.lastRound(room), viewerKey)
          : null,
      history: room.rounds.map((round) => this.serializeRound(room, round, viewerKey)),
      ready: {
        count: ready.length,
        needed: active.length,
        activeCount: active.length,
        all: active.length >= MIN_PLAYERS && ready.length === active.length,
      },
      canStart:
        isPlayer &&
        room.phase === 'lobby' &&
        room.hostId === viewerId &&
        room.players.length >= MIN_PLAYERS &&
        room.players.length <= MAX_PLAYERS,
    };
  }

  cleanup(maxAgeMs, now = this.now()) {
    const removed = [];
    for (const [code, room] of this.rooms) {
      if (now - room.updatedAt > maxAgeMs) {
        removed.push(code);
        this.rooms.delete(code);
      }
    }
    return removed;
  }
}

module.exports = {
  GameStore,
  GameError,
  constants: {
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_SPECTATORS,
    MAX_NAME_LENGTH,
    AUTO_SUBMIT_DURATIONS,
    MAX_WORD_LENGTH,
    DEFAULT_DURATION_SEC,
    DEFAULT_DURATIONS,
  },
  helpers: {
    normalizeText,
    cleanName,
    cleanDraft,
    normalizeWord,
    wordKey,
  },
};
