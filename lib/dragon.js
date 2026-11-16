'use strict';

const crypto = require('node:crypto');
const { GameError } = require('./game');

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 4;
const MAX_SPECTATORS = 20;
const SIZES = [5, 6, 8, 10, 12];
const MAX_NAME_LENGTH = 12;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const THEMES = [
  { color: '#ffd43b', soft: '#3a2d08', ink: '#2c2410' },
  { color: '#7be3ff', soft: '#07303a', ink: '#08222a' },
  { color: '#ff9ec4', soft: '#3a1324', ink: '#2f0c1d' },
  { color: '#b8f36b', soft: '#21320c', ink: '#172407' },
];

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

function tokenEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function solutionFor(size) {
  const cols = Array(size).fill(-1);
  const used = new Set();
  function place(row) {
    if (row === size) return true;
    const candidates = shuffle(Array.from({ length: size }, (_, i) => i))
      .filter((col) => !used.has(col) && (row === 0 || Math.abs(col - cols[row - 1]) > 1));
    for (const col of candidates) {
      cols[row] = col;
      used.add(col);
      if (place(row + 1)) return true;
      used.delete(col);
      cols[row] = -1;
    }
    return false;
  }
  if (!place(0)) return null;
  return cols.map((col, row) => row * size + col);
}

function makeRegions(size, solution) {
  const total = size * size;
  const regions = Array(total).fill(-1);
  const queues = solution.map(() => []);
  solution.forEach((cell, id) => {
    regions[cell] = id;
    const row = Math.floor(cell / size);
    const col = cell % size;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) queues[id].push(nr * size + nc);
    }
  });
  let remaining = total - solution.length;
  while (remaining > 0) {
    const live = queues.map((queue, id) => ({ id, queue })).filter((entry) => entry.queue.length);
    if (!live.length) break;
    const pick = live[crypto.randomInt(0, live.length)];
    const queue = pick.queue;
    const index = crypto.randomInt(0, queue.length);
    const cell = queue[index];
    queue[index] = queue[queue.length - 1];
    queue.pop();
    if (regions[cell] !== -1) continue;
    regions[cell] = pick.id;
    remaining -= 1;
    const row = Math.floor(cell / size);
    const col = cell % size;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr * size + nc] === -1) {
        queue.push(nr * size + nc);
      }
    }
  }
  return regions;
}

function generatePuzzle(size) {
  const solution = solutionFor(size);
  if (!solution) throw new GameError(500, '棋盘生成失败，请重试。');
  return { size, solution, regions: makeRegions(size, solution) };
}

function validBoard(size, regions, marks) {
  const dragons = [...marks.entries()].filter(([, value]) => value === 'dragon').map(([index]) => Number(index));
  if (dragons.length !== size) return false;
  const rows = new Set();
  const cols = new Set();
  const areas = new Set();
  for (const index of dragons) {
    const row = Math.floor(index / size);
    const col = index % size;
    if (rows.has(row) || cols.has(col) || areas.has(regions[index])) return false;
    rows.add(row);
    cols.add(col);
    areas.add(regions[index]);
  }
  for (let i = 0; i < dragons.length; i += 1) {
    for (let j = i + 1; j < dragons.length; j += 1) {
      const dr = Math.abs(Math.floor(dragons[i] / size) - Math.floor(dragons[j] / size));
      const dc = Math.abs((dragons[i] % size) - (dragons[j] % size));
      if (dr <= 1 && dc <= 1) return false;
    }
  }
  return true;
}

class DragonStore {
  constructor() {
    this.rooms = new Map();
  }

  makeCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError(503, '房间号用完了，稍后再试。');
  }

  createRoom(name) {
    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    const room = {
      code: this.makeCode(),
      phase: 'lobby',
      hostId: null,
      mode: 'race',
      size: 6,
      puzzle: null,
      boards: new Map(),
      shared: new Map(),
      hints: new Map(),
      winnerId: null,
      coopWin: false,
      invalid: false,
      revision: 0,
      players: [],
      spectators: [],
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
      ...THEMES[room.players.length % THEMES.length],
    };
    room.players.push(player);
    room.boards.set(player.id, new Map());
    room.hints.set(player.id, 0);
    return player;
  }

  nameTaken(room, name) {
    return [...room.players, ...room.spectators].some((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  joinRoom(code, name) {
    const room = this.room(code);
    if (room.phase !== 'lobby') throw new GameError(409, '已经开局了。');
    if (room.players.length >= MAX_PLAYERS) throw new GameError(409, '最多四个人。');
    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    if (this.nameTaken(room, clean)) throw new GameError(409, '这个名字已经被占了。');
    const player = this.addPlayer(room, clean);
    this.touch(room);
    return { room, player };
  }

  addSpectator(code, name) {
    const room = this.room(code);
    if (room.spectators.length >= MAX_SPECTATORS) throw new GameError(409, '观战席满了。');
    let clean = cleanName(name) || '观众';
    if (this.nameTaken(room, clean)) clean = `${clean.slice(0, 10)}${crypto.randomInt(2, 99)}`;
    const spectator = { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), name: clean };
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
    if (!member || !tokenEquals(member.token, token)) throw new GameError(401, '身份已失效，请重新加入。');
    return { room, player: role === 'player' ? member : null, spectator: role === 'spectator' ? member : null, role };
  }

  rejoin(code, playerId, token, role = 'player') {
    const auth = this.authenticate(code, playerId, token, role);
    this.touch(auth.room);
    return auth;
  }

  leave(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'lobby') throw new GameError(409, '开局后不能退出。');
    room.players = room.players.filter((p) => p.id !== player.id);
    room.boards.delete(player.id);
    room.hints.delete(player.id);
    if (room.hostId === player.id) room.hostId = room.players[0]?.id || null;
    room.players.forEach((p, i) => { p.seat = i; });
    if (!room.players.length) {
      this.rooms.delete(room.code);
      return { deleted: true };
    }
    this.touch(room);
    return { deleted: false };
  }

  leaveSpectator(code, playerId, token) {
    const { room, spectator } = this.authenticate(code, playerId, token, 'spectator');
    room.spectators = room.spectators.filter((s) => s.id !== spectator.id);
    this.touch(room);
    return { room };
  }

  settings(code, playerId, token, values) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以改设置。');
    if (room.phase !== 'lobby') throw new GameError(409, '已经开局了。');
    if (values.mode && ['race', 'coop'].includes(values.mode)) room.mode = values.mode;
    if (values.size && SIZES.includes(Number(values.size))) room.size = Number(values.size);
    this.touch(room);
    return { room };
  }

  start(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开始。');
    if (room.phase !== 'lobby') throw new GameError(409, '已经开局了。');
    if (room.players.length < MIN_PLAYERS) throw new GameError(409, '房间里还没有玩家。');
    room.puzzle = generatePuzzle(room.size);
    room.boards.forEach((board) => board.clear());
    room.shared.clear();
    room.hints.forEach((_, id) => room.hints.set(id, 0));
    room.winnerId = null;
    room.coopWin = false;
    room.invalid = false;
    room.phase = 'playing';
    this.touch(room);
    return { room };
  }

  boardFor(room, playerId) {
    return room.mode === 'coop' ? room.shared : room.boards.get(playerId);
  }

  tap(code, playerId, token, index, value) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'playing') throw new GameError(409, '现在不能操作。');
    const cell = Number(index);
    if (!Number.isInteger(cell) || cell < 0 || cell >= room.size * room.size) throw new GameError(400, '格子不存在。');
    if (!['empty', 'dragon', 'x'].includes(value)) throw new GameError(400, '标记不对。');
    const board = this.boardFor(room, player.id);
    if (value === 'empty') board.delete(cell);
    else board.set(cell, value);
    room.invalid = false;
    if (value === 'dragon' && [...board.values()].filter((v) => v === 'dragon').length === room.size) {
      if (validBoard(room.size, room.puzzle.regions, board)) {
        room.phase = 'finished';
        room.coopWin = room.mode === 'coop';
        room.winnerId = room.mode === 'coop' ? null : player.id;
      } else {
        room.invalid = true;
      }
    }
    this.touch(room);
    return { room };
  }

  paint(code, playerId, token, indexes, value = 'x') {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'playing') throw new GameError(409, '现在不能操作。');
    if (value !== 'x' && value !== 'empty') throw new GameError(400, '滑动标记只支持打叉。');
    if (!Array.isArray(indexes) || !indexes.length || indexes.length > 144) throw new GameError(400, '滑动轨迹不对。');
    const board = this.boardFor(room, player.id);
    for (const raw of [...new Set(indexes)]) {
      const cell = Number(raw);
      if (!Number.isInteger(cell) || cell < 0 || cell >= room.size * room.size) continue;
      if (value === 'empty') board.delete(cell);
      else board.set(cell, 'x');
    }
    room.invalid = false;
    this.touch(room);
    return { room };
  }

  hint(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'playing') throw new GameError(409, '现在不能提示。');
    const used = room.hints.get(player.id) || 0;
    if (room.mode === 'race' && used >= 3) throw new GameError(409, '竞赛模式提示用完了。');
    const board = this.boardFor(room, player.id);
    const cell = room.puzzle.solution.find((index) => board.get(index) !== 'dragon');
    if (cell == null) throw new GameError(409, '已经放完所有奶龙了。');
    room.hints.set(player.id, used + 1);
    const row = Math.floor(cell / room.size) + 1;
    const col = (cell % room.size) + 1;
    this.touch(room);
    return {
      room,
      hint: {
        cell,
        text: `第 ${row} 行、第 ${col} 列这个格子一定是奶龙。`,
      },
    };
  }

  restart(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以重开。');
    if (room.phase === 'lobby') throw new GameError(409, '已经在准备厅了。');
    room.phase = 'lobby';
    room.puzzle = null;
    room.boards.forEach((board) => board.clear());
    room.shared.clear();
    room.hints.forEach((_, id) => room.hints.set(id, 0));
    room.winnerId = null;
    room.coopWin = false;
    room.invalid = false;
    this.touch(room);
    return { room };
  }

  view(room, viewerId, role = 'player') {
    const viewer = role === 'player'
      ? room.players.find((p) => p.id === viewerId)
      : room.spectators.find((s) => s.id === viewerId);
    if (!viewer) throw new GameError(401, '你不在这个房间里。');
    const board = role === 'player' ? this.boardFor(room, viewer.id) : room.shared;
    return {
      code: room.code,
      revision: room.revision,
      phase: room.phase,
      hostId: room.hostId,
      mode: room.mode,
      size: room.size,
      sizes: SIZES,
      regions: room.puzzle?.regions || null,
      board: Object.fromEntries(board || []),
      invalid: room.invalid,
      winnerId: room.winnerId,
      coopWin: room.coopWin,
      hintsUsed: room.hints.get(viewer.id) || 0,
      hintLimit: room.mode === 'race' ? 3 : null,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, seat: p.seat, color: p.color, isHost: p.id === room.hostId, isYou: role === 'player' && p.id === viewer.id,
        count: room.mode === 'coop' ? [...room.shared.values()].filter((v) => v === 'dragon').length : [...(room.boards.get(p.id) || new Map()).values()].filter((v) => v === 'dragon').length,
      })),
      spectators: room.spectators.map((s) => ({ id: s.id, name: s.name, isYou: role === 'spectator' && s.id === viewer.id })),
      viewer: { id: viewer.id, name: viewer.name, isHost: role === 'player' && viewer.id === room.hostId, isSpectator: role === 'spectator' },
      canStart: role === 'player' && room.phase === 'lobby' && viewer.id === room.hostId && room.players.length >= MIN_PLAYERS,
      canRestart: role === 'player' && room.phase === 'finished' && viewer.id === room.hostId,
    };
  }

  touch(room) {
    room.revision += 1;
  }
}

module.exports = { DragonStore, GameError, constants: { MIN_PLAYERS, MAX_PLAYERS, SIZES } };
