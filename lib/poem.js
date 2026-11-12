'use strict';

const crypto = require('node:crypto');
const { GameError } = require('./game');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MAX_SPECTATORS = 20;
const TOTAL_ROUNDS = 3;
const FALLBACK_CHARS = Array.from(new Set(Array.from(
  '风花雪月山海云光星梦春秋夏冬晨夜雨雾霜露霞虹雷电江河湖海森林木火土金水石玉珠冰岚川原野岸岛沙泉溪谷峰岭天地日辰宇宙时岁年声色味香茶酒书琴棋画诗墨纸砚灯烛窗门庭院长街巷城桥舟车鸟鱼鹿鹤松竹梅兰菊荷莲桂柳桃杏梨枫樱草苔藤萝',
)));
const RECENT_FALLBACK_LIMIT = 18;
const ANON_LABELS = [
  '温吞的🍎',
  '曼妙的🫐',
  '性温的🫚',
  '有性格的🍊',
  '有内核的🥭',
  '很荞麦的🍜',
  '很多的💐',
];
const MAX_NAME_LENGTH = 12;
const MAX_LINE_LENGTH = 36;
const MAX_SENTENCE_LENGTH = 120;
const MAX_PROMPT_LENGTH = 4;
const CHAR_SECONDS = 20;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const VARIANTS = new Set(['acrostic', 'sentence']);

const THEMES = [
  { color: '#3f3a32', soft: '#e8e1d2', ink: '#1d1a15' },
  { color: '#7a4b2a', soft: '#f0e1cf', ink: '#2f1a0c' },
  { color: '#4b5d52', soft: '#e0e9e2', ink: '#1c2a22' },
  { color: '#6b3f3f', soft: '#efdede', ink: '#321818' },
  { color: '#43536b', soft: '#e1e7f0', ink: '#182333' },
  { color: '#5c4b6b', soft: '#e9e1f0', ink: '#251a30' },
];

const PROMPTS = [
  '垃圾桶', '洛克王国', '空调外机', '早八人', '已读不回', '电子榨菜',
  '恋爱脑', '显眼包', '打工人', '发疯文学', '互联网嘴替', '情绪价值',
  '电子木鱼', '凡尔赛', '社死现场', '摸鱼', '画大饼', '空耳',
  '嘴硬', '破防', '抽象', '玩梗', '热搜', '流量',
  '人设', '塌房', '洗白', '反转', '吃瓜', '开摆',
  '躺平', '电子宠物', '精神状态', '班味', '内耗', '松弛感',
  '赛博许愿', '社交牛杂', '深夜emo', '互联网坟场', '已老实', '求放过',
];

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

function cleanLine(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_LINE_LENGTH);
}

function cleanSentence(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_SENTENCE_LENGTH);
}

function cleanPrompt(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f\s]/g, '').trim().slice(0, MAX_PROMPT_LENGTH);
}

function cleanChar(value) {
  return Array.from(String(value || '').replace(/[\u0000-\u001f\u007f\s]/g, ''))[0] || '';
}

function tokenEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function shuffled(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const random = crypto.randomInt(0, index + 1);
    [copy[index], copy[random]] = [copy[random], copy[index]];
  }
  return copy;
}

function sameMultiset(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

class PoemStore {
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
      variant: 'acrostic',
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      hostId: null,
      prompt: '',
      usedPrompts: [],
      players: [],
      spectators: [],
      chars: new Map(),
      charDrafts: new Map(),
      poems: new Map(),
      votes: new Map(),
      scores: new Map(),
      history: [],
      winnerId: null,
      promptChooserId: null,
      charToken: 0,
      autoFilled: [],
      recentFallbackChars: [],
      phaseEndsAt: null,
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
    return player;
  }

  nameTaken(room, name) {
    const lower = name.toLowerCase();
    return [...room.players, ...room.spectators].some((entry) => entry.name.toLowerCase() === lower);
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
    return auth;
  }

  leave(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'lobby') throw new GameError(409, '游戏开始后不能退出。');
    room.players = room.players.filter((entry) => entry.id !== player.id);
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

  setVariant(code, playerId, token, variant) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以选玩法。');
    if (room.phase !== 'lobby') throw new GameError(409, '游戏开始后不能换玩法。');
    if (!VARIANTS.has(variant)) throw new GameError(400, '没有这个玩法。');
    room.variant = variant;
    this.touch(room);
    return { room };
  }

  start(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开始。');
    if (room.phase !== 'lobby') throw new GameError(409, '游戏已经开始了。');
    if (room.players.length < MIN_PLAYERS) throw new GameError(409, '至少需要两个人。');
    if (room.players.length > MAX_PLAYERS) throw new GameError(409, '房间人数太多了。');
    room.history = [];
    room.scores.clear();
    room.usedPrompts = [];
    room.chars.clear();
    room.poems.clear();
    room.votes.clear();
    room.promptChooserId = room.players.length === 2
      ? room.players[crypto.randomInt(0, room.players.length)].id
      : null;
    if (room.variant === 'sentence') this.beginChars(room, 1);
    else this.beginAcrostic(room, 1, this.pickPrompt(room));
    return { room };
  }

  pickPrompt(room) {
    let pool = PROMPTS.filter((item) => !room.usedPrompts.includes(item));
    if (!pool.length) {
      room.usedPrompts = [];
      pool = [...PROMPTS];
    }
    const prompt = shuffled(pool)[0];
    room.usedPrompts.push(prompt);
    return prompt;
  }

  beginAcrostic(room, round, prompt) {
    room.round = round;
    room.phase = 'writing';
    room.prompt = prompt;
    room.chars.clear();
    room.poems.clear();
    room.votes.clear();
    room.voteOrder = [];
    room.anonLabels = {};
    room.winnerId = null;
    room.autoFilled = [];
    room.phaseEndsAt = null;
    this.touch(room);
  }

  beginChars(room, round) {
    room.round = round;
    room.phase = 'chars';
    room.prompt = '';
    room.chars.clear();
    room.charDrafts.clear();
    room.poems.clear();
    room.votes.clear();
    room.voteOrder = [];
    room.anonLabels = {};
    room.winnerId = null;
    room.autoFilled = [];
    room.charToken += 1;
    room.phaseEndsAt = this.now() + CHAR_SECONDS * 1000;
    this.touch(room);
  }

  beginSentenceWriting(room) {
    room.phase = 'writing';
    room.prompt = room.players.map((player) => room.chars.get(player.id) || '？').join('');
    room.phaseEndsAt = null;
    this.touch(room);
  }

  submitChar(code, playerId, token, char) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'chars') throw new GameError(409, '现在不是出字时间。');
    if (room.variant !== 'sentence') throw new GameError(409, '这个房间不是造句模式。');
    const clean = cleanChar(char);
    if (!clean) throw new GameError(400, '先出一个字。');
    room.chars.set(player.id, clean);
    room.charDrafts.delete(player.id);
    if (room.chars.size >= room.players.length) this.beginSentenceWriting(room);
    else this.touch(room);
    return { room };
  }

  saveCharDraft(code, playerId, token, char) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'chars') return { room };
    const clean = cleanChar(char);
    if (clean) room.charDrafts.set(player.id, clean);
    else room.charDrafts.delete(player.id);
    return { room };
  }

  submitPoem(code, playerId, token, lines) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'writing') throw new GameError(409, '现在不是写诗时间。');
    if (room.variant !== 'acrostic') throw new GameError(409, '这个房间不是藏头诗模式。');
    if (!Array.isArray(lines)) throw new GameError(400, '诗句格式不对。');
    const chars = Array.from(room.prompt);
    if (lines.length !== chars.length) throw new GameError(400, '藏头词有几个字，就写几行。');
    const cleaned = lines.map(cleanLine);
    if (cleaned.some((line) => !line)) throw new GameError(400, '每一行都要写。');
    room.poems.set(player.id, { lines: cleaned });
    this.maybeFinishWriting(room);
    return { room };
  }

  submitSentence(code, playerId, token, order, text) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'writing') throw new GameError(409, '现在不是造句时间。');
    if (room.variant !== 'sentence') throw new GameError(409, '这个房间不是造句模式。');
    const chars = room.players.map((candidate) => room.chars.get(candidate.id) || '？');
    if (!Array.isArray(order) || !sameMultiset(order, chars)) {
      throw new GameError(400, '每个字都要用一次。');
    }
    const cleaned = cleanSentence(text);
    if (!cleaned) throw new GameError(400, '先把句子补完。');
    room.poems.set(player.id, { order: [...order], text: cleaned });
    this.maybeFinishWriting(room);
    return { room };
  }

  beginVoting(room) {
    room.phase = 'voting';
    const order = shuffled(room.players);
    const labels = shuffled(ANON_LABELS).slice(0, order.length);
    room.voteOrder = order.map((player) => player.id);
    room.anonLabels = Object.fromEntries(order.map((player, index) => [player.id, labels[index]]));
    room.phaseEndsAt = null;
    this.touch(room);
  }

  maybeFinishWriting(room) {
    if (room.poems.size < room.players.length) {
      this.touch(room);
      return;
    }
    if (room.players.length === 2) this.reveal(room);
    else this.beginVoting(room);
  }

  submitVote(code, playerId, token, targetId) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'voting') throw new GameError(409, '现在不是投票时间。');
    if (room.players.length === 2) throw new GameError(409, '双人局不计分，直接揭晓。');
    if (targetId === player.id) throw new GameError(400, '不能投自己。');
    if (!room.players.some((candidate) => candidate.id === targetId)) {
      throw new GameError(404, '找不到这首作品。');
    }
    if (room.votes.has(player.id)) throw new GameError(409, '你已经投过了。');
    room.votes.set(player.id, targetId);
    if (room.votes.size >= room.players.length) this.reveal(room);
    else this.touch(room);
    return { room };
  }

  reveal(room) {
    const isCoop = room.players.length === 2;
    const entries = room.players.map((player) => {
      const poem = room.poems.get(player.id) || (room.variant === 'acrostic' ? { lines: ['（未提交）'] } : { order: [], text: '（未提交）' });
      const votes = isCoop
        ? 0
        : [...room.votes.values()].filter((target) => target === player.id).length;
      return {
        playerId: player.id,
        name: player.name,
        color: player.color,
        lines: poem.lines || null,
        order: poem.order || null,
        text: poem.text || null,
        votes,
        points: isCoop ? 0 : votes,
      };
    });
    if (!isCoop) {
      for (const entry of entries) {
        room.scores.set(entry.playerId, (room.scores.get(entry.playerId) || 0) + entry.points);
      }
    }
    const sorted = [...entries].sort((a, b) => b.votes - a.votes);
    room.winnerId = sorted[0]?.votes > 0 ? sorted[0].playerId : null;
    const result = {
      round: room.round,
      variant: room.variant,
      prompt: room.prompt,
      chars: room.players.map((player) => room.chars.get(player.id) || '？'),
      entries,
      winnerId: room.winnerId,
      winnerName: room.players.find((player) => player.id === room.winnerId)?.name || null,
      isCoop,
      isFinal: room.round >= room.totalRounds,
      revealedAt: this.now(),
    };
    room.history.push(result);
    room.phase = 'reveal';
    room.phaseEndsAt = null;
    this.touch(room);
    return result;
  }

  choosePrompt(code, playerId, token, prompt) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'reveal' || room.variant !== 'acrostic') {
      throw new GameError(409, '现在不是接龙出题时间。');
    }
    if (room.round >= room.totalRounds) throw new GameError(409, '三轮已经结束了。');
    const isCoop = room.players.length === 2;
    if (isCoop ? room.promptChooserId !== player.id : room.winnerId !== player.id) {
      throw new GameError(403, '现在轮不到你出题。');
    }
    const clean = cleanPrompt(prompt);
    const length = Array.from(clean).length;
    if (length < 2 || length > MAX_PROMPT_LENGTH) throw new GameError(400, '藏头词需要 2–4 个字。');
    room.usedPrompts.push(clean);
    const chooser = room.promptChooserId;
    this.beginAcrostic(room, room.round + 1, clean);
    if (isCoop) room.promptChooserId = room.players.find((item) => item.id !== chooser)?.id || null;
    return { room };
  }

  nextRound(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开下一轮。');
    if (room.phase !== 'reveal' || room.variant !== 'sentence') {
      throw new GameError(409, '现在不能开下一轮。');
    }
    if (room.round >= room.totalRounds) throw new GameError(409, '三轮已经结束了。');
    this.beginChars(room, room.round + 1);
    return { room };
  }

  restart(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以重开。');
    if (room.phase === 'lobby') throw new GameError(409, '现在已经在准备大厅里了。');
    room.phase = 'lobby';
    room.round = 0;
    room.prompt = '';
    room.history = [];
    room.scores.clear();
    room.chars.clear();
    room.charDrafts.clear();
    room.poems.clear();
    room.votes.clear();
    room.voteOrder = [];
    room.anonLabels = {};
    room.winnerId = null;
    room.promptChooserId = null;
    room.autoFilled = [];
    room.recentFallbackChars = [];
    room.phaseEndsAt = null;
    this.touch(room);
    return { room };
  }

  finishChars(room) {
    if (room.phase !== 'chars') return false;
    room.autoFilled = [];
    const usedThisRound = new Set();
    for (const player of room.players) {
      if (room.chars.has(player.id)) continue;
      const saved = room.charDrafts.get(player.id);
      let char = saved;
      if (!char) {
        let pool = FALLBACK_CHARS.filter(
          (item) => !room.recentFallbackChars.includes(item) && !usedThisRound.has(item),
        );
        if (!pool.length) pool = FALLBACK_CHARS.filter((item) => !usedThisRound.has(item));
        if (!pool.length) pool = FALLBACK_CHARS;
        char = pool[crypto.randomInt(0, pool.length)];
        usedThisRound.add(char);
        room.recentFallbackChars.push(char);
        if (room.recentFallbackChars.length > RECENT_FALLBACK_LIMIT) {
          room.recentFallbackChars = room.recentFallbackChars.slice(-RECENT_FALLBACK_LIMIT);
        }
      }
      room.chars.set(player.id, char);
      room.autoFilled.push({
        playerId: player.id,
        name: player.name,
        char,
        source: saved ? 'draft' : 'system',
      });
    }
    this.beginSentenceWriting(room);
    return true;
  }

  finishWriting(room) {
    if (room.phase !== 'writing') return false;
    for (const player of room.players) {
      if (room.poems.has(player.id)) continue;
      if (room.variant === 'acrostic') {
        room.poems.set(player.id, { lines: ['（未提交）'] });
      } else {
        const order = room.players.map((candidate) => room.chars.get(candidate.id) || '？');
        room.poems.set(player.id, { order, text: '（未提交）' });
      }
    }
    if (room.players.length === 2) this.reveal(room);
    else this.beginVoting(room);
    return true;
  }

  finishVoting(room) {
    if (room.phase !== 'voting') return false;
    this.reveal(room);
    return true;
  }

  view(room, viewerId, role = 'player') {
    const isPlayer = role === 'player';
    const viewer = isPlayer
      ? room.players.find((candidate) => candidate.id === viewerId)
      : room.spectators.find((candidate) => candidate.id === viewerId);
    if (!viewer) throw new GameError(401, '你不在这个房间里。');
    const revealing = room.phase === 'reveal';
    const isCoop = room.players.length === 2;
    const chars = room.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      char: room.phase === 'chars' ? null : room.chars.get(player.id) || null,
    }));
    const orderedPlayers = room.voteOrder?.length
      ? room.voteOrder.map((id) => room.players.find((player) => player.id === id)).filter(Boolean)
      : room.players;
    const poems = room.poems.size
      ? orderedPlayers.map((player) => {
          const poem = room.poems.get(player.id) || {};
          return {
            id: player.id,
            label: revealing ? null : room.anonLabels?.[player.id] || '匿名作品',
            isYou: isPlayer && player.id === viewerId,
            author: revealing ? player.name : null,
            lines: poem.lines || null,
            order: poem.order || null,
            text: poem.text || null,
            votes: revealing && !isCoop
              ? [...room.votes.values()].filter((target) => target === player.id).length
              : null,
          };
        })
      : [];
    return {
      code: room.code,
      revision: room.revision,
      phase: room.phase,
      variant: room.variant,
      round: room.round,
      totalRounds: room.totalRounds,
      hostId: room.hostId,
      role,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      maxSpectators: MAX_SPECTATORS,
      prompt: room.prompt,
      phaseEndsAt: room.phaseEndsAt,
      charToken: room.charToken,
      autoFilled: room.autoFilled,
      chars,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        color: player.color,
        softColor: player.softColor,
        isHost: player.id === room.hostId,
        isYou: isPlayer && player.id === viewerId,
        submitted: room.variant === 'sentence' && room.phase === 'chars'
          ? room.chars.has(player.id)
          : room.poems.has(player.id),
        voted: room.votes.has(player.id),
      })),
      spectators: room.spectators.map((spectator) => ({
        id: spectator.id,
        name: spectator.name,
        isYou: !isPlayer && spectator.id === viewerId,
      })),
      spectatorCount: room.spectators.length,
      poems,
      submittedCount: room.variant === 'sentence' && room.phase === 'chars'
        ? room.chars.size
        : room.poems.size,
      votedCount: room.votes.size,
      winnerId: room.winnerId,
      promptChooserId: room.promptChooserId,
      isCoop,
      viewer: {
        id: viewer.id,
        name: viewer.name,
        isHost: isPlayer && viewer.id === room.hostId,
        isSpectator: !isPlayer,
        submitted: isPlayer && (room.variant === 'sentence' && room.phase === 'chars'
          ? room.chars.has(viewer.id)
          : room.poems.has(viewer.id)),
        voted: isPlayer && room.votes.has(viewer.id),
        canChoosePrompt:
          isPlayer &&
          revealing &&
          room.variant === 'acrostic' &&
          room.round < room.totalRounds &&
          (isCoop ? viewer.id === room.promptChooserId : room.winnerId === viewer.id),
      },
      scores: revealing && !isCoop
        ? room.players
            .map((player) => ({ id: player.id, name: player.name, score: room.scores.get(player.id) || 0 }))
            .sort((a, b) => b.score - a.score)
        : [],
      result: revealing ? room.history[room.history.length - 1] : null,
      history: room.history,
      canStart:
        isPlayer &&
        room.phase === 'lobby' &&
        viewer.id === room.hostId &&
        room.players.length >= MIN_PLAYERS &&
        room.players.length <= MAX_PLAYERS,
      canSetVariant: isPlayer && room.phase === 'lobby' && viewer.id === room.hostId,
      canNext:
        isPlayer &&
        revealing &&
        room.variant === 'sentence' &&
        viewer.id === room.hostId &&
        room.round < room.totalRounds,
      canRestart: isPlayer && revealing && room.round >= room.totalRounds && viewer.id === room.hostId,
      serverNow: this.now(),
    };
  }

  touch(room) {
    room.revision += 1;
    room.updatedAt = this.now();
  }
}

module.exports = {
  PoemStore,
  GameError,
  constants: {
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_SPECTATORS,
    TOTAL_ROUNDS,
    MAX_LINE_LENGTH,
    MAX_SENTENCE_LENGTH,
    MAX_PROMPT_LENGTH,
    CHAR_SECONDS,
  },
};
