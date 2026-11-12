'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GameStore, GameError } = require('./lib/game');
const { GuessStore } = require('./lib/guess');
const { CrisisStore } = require('./lib/crisis');
const { PoemStore } = require('./lib/poem');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_PORT = Number(process.env.PORT) || 8787;
const MAX_BODY_BYTES = 64 * 1024;

function normalizePublicUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/og-card.svg', ['og-card.svg', 'image/svg+xml']],
  ['/guess', ['guess.html', 'text/html; charset=utf-8']],
  ['/guess/', ['guess.html', 'text/html; charset=utf-8']],
  ['/guess.html', ['guess.html', 'text/html; charset=utf-8']],
  ['/guess.css', ['guess.css', 'text/css; charset=utf-8']],
  ['/guess.js', ['guess.js', 'text/javascript; charset=utf-8']],
  ['/crisis', ['crisis.html', 'text/html; charset=utf-8']],
  ['/crisis/', ['crisis.html', 'text/html; charset=utf-8']],
  ['/crisis.html', ['crisis.html', 'text/html; charset=utf-8']],
  ['/crisis.css', ['crisis.css', 'text/css; charset=utf-8']],
  ['/crisis.js', ['crisis.js', 'text/javascript; charset=utf-8']],
  ['/poem', ['poem.html', 'text/html; charset=utf-8']],
  ['/poem/', ['poem.html', 'text/html; charset=utf-8']],
  ['/poem.html', ['poem.html', 'text/html; charset=utf-8']],
  ['/poem.css', ['poem.css', 'text/css; charset=utf-8']],
  ['/poem.js', ['poem.js', 'text/javascript; charset=utf-8']],
  ['/ink-ring.png', ['ink-ring.png', 'image/png']],
  ['/ink-splatter.png', ['ink-splatter.png', 'image/png']],
  ['/ink-drip.png', ['ink-drip.png', 'image/png']],
  ['/ink-blot.png', ['ink-blot.png', 'image/png']],
  ['/ink-wash.png', ['ink-wash.png', 'image/png']],
]);

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new GameError(413, '请求内容太大了。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('invalid body');
        }
        resolve(parsed);
      } catch {
        reject(new GameError(400, '请求格式不正确。'));
      }
    });
    req.on('error', reject);
  });
}

function getLanUrls(port) {
  const entries = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const entry of addresses || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        entries.push({ name, address: entry.address });
      }
    }
  }

  // Prefer a real Wi-Fi/Ethernet adapter over Windows hotspot, VPN, and
  // virtual-machine adapters that friends on the LAN cannot reach.
  const interfaceScore = (name) => {
    const lower = name.toLowerCase();
    if (/本地连接\s*\*|local area connection\s*\*/.test(lower)) return 8;
    if (/vethernet|hyper-v|vmware|virtualbox|tailscale|zerotier|docker|wsl/.test(lower)) {
      return 7;
    }
    if (/wlan|wi-fi|wifi|无线/.test(lower)) return 0;
    if (/ethernet|以太网/.test(lower)) return 1;
    return 3;
  };
  const addressScore = (address) => {
    if (address.startsWith('192.168.')) return 0;
    if (address.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };

  const unique = new Map();
  for (const entry of entries) {
    if (!unique.has(entry.address)) unique.set(entry.address, entry);
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        interfaceScore(a.name) - interfaceScore(b.name) ||
        addressScore(a.address) - addressScore(b.address),
    )
    .map((entry) => `http://${entry.address}:${port}`);
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function createApp(options = {}) {
  const game = new GameStore({ allowedDurations: options.allowedDurations });
  const guess = new GuessStore();
  const crisis = new CrisisStore();
  const poem = new PoemStore();
  const publicUrl = normalizePublicUrl(
    options.publicUrl ||
      process.env.PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL,
  );
  // code -> memberId -> Set<ServerResponse>
  const streams = new Map();
  // code -> memberId -> number of open SSE connections
  const connectionCounts = new Map();

  function streamSet(code, memberId) {
    let byMember = streams.get(code);
    if (!byMember) {
      byMember = new Map();
      streams.set(code, byMember);
    }
    let set = byMember.get(memberId);
    if (!set) {
      set = new Set();
      byMember.set(memberId, set);
    }
    return set;
  }

  function countMap(code) {
    let byPlayer = connectionCounts.get(code);
    if (!byPlayer) {
      byPlayer = new Map();
      connectionCounts.set(code, byPlayer);
    }
    return byPlayer;
  }

  function writeEvent(res, event, data) {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(room) {
    const byMember = streams.get(room.code);
    if (!byMember) return;
    const members = [
      ...room.players.map((player) => ({ member: player, role: 'player' })),
      ...room.spectators.map((spectator) => ({ member: spectator, role: 'spectator' })),
    ];
    for (const { member, role } of members) {
      const set = byMember.get(member.id);
      if (!set || !set.size) continue;
      let state;
      try {
        state = game.view(room, member.id, role);
      } catch {
        continue;
      }
      for (const res of set) {
        try {
          writeEvent(res, 'state', state);
        } catch {
          // The close handler will remove a broken stream.
        }
      }
    }
  }

  function sendState(res, room, memberId, role = 'player') {
    sendJson(res, 200, { state: game.view(room, memberId, role) });
  }

  function maybeExpire(code) {
    const normalized = String(code || '').trim().toUpperCase();
    const room = game.rooms.get(normalized);
    if (!room || room.phase !== 'writing') return false;
    if (!room.phaseEndsAt || Date.now() < room.phaseEndsAt) return false;
    const result = game.reveal(room, 'timeout');
    if (result) {
      broadcast(room);
      return true;
    }
    return false;
  }

  function requireExpired(code) {
    if (!maybeExpire(code)) return;
    throw new GameError(409, '时间到了，已经揭晓。');
  }

  async function handleAction(req, res, action) {
    let body = {};
    try {
      body = await readJson(req);
      if (body.code) requireExpired(body.code);
      const payload = await action(body);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(payload));
    } catch (error) {
      if (error instanceof GameError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error('[tongpin] request failed:', error);
        sendJson(res, 500, { error: '服务器打了个喷嚏，再试一次。' });
      }
    }
  }

  function credentialsFrom(url) {
    return {
      code: url.searchParams.get('code') || '',
      playerId: url.searchParams.get('playerId') || '',
      token: url.searchParams.get('token') || '',
      role: url.searchParams.get('role') === 'spectator' ? 'spectator' : 'player',
    };
  }

  function openStream(req, res, url) {
    const { code, playerId, token, role } = credentialsFrom(url);
    let room;
    let member;
    try {
      const auth = game.authenticate(code, playerId, token, role);
      room = auth.room;
      member = role === 'spectator' ? auth.spectator : auth.player;
    } catch (error) {
      sendJson(res, error.status || 401, { error: error.message });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write('retry: 2200\n\n');
    const set = streamSet(room.code, member.id);
    set.add(res);

    const counts = countMap(room.code);
    const previousCount = counts.get(member.id) || 0;
    counts.set(member.id, previousCount + 1);
    if (previousCount === 0) {
      game.setConnected(room.code, member.id, true, role);
    }

    writeEvent(res, 'hello', { serverNow: Date.now(), code: room.code });
    writeEvent(res, 'state', game.view(room, member.id, role));
    broadcast(room);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      set.delete(res);
      if (!set.size) {
        streams.get(room.code)?.delete(member.id);
      }
      const current = counts.get(member.id) || 0;
      const next = Math.max(0, current - 1);
      if (next === 0) {
        counts.delete(member.id);
        const outcome = game.setConnected(room.code, member.id, false, role);
        if (outcome?.room) broadcast(outcome.room);
      } else {
        counts.set(member.id, next);
      }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
  }

  async function serveStatic(req, res, pathname) {
    const entry = STATIC_FILES.get(pathname);
    if (!entry) {
      sendJson(res, 404, { error: '页面不存在。' });
      return;
    }
    const [filename, type] = entry;
    try {
      const body = await fs.readFile(path.join(PUBLIC_DIR, filename));
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        'Content-Security-Policy':
          "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(body);
      }
    } catch (error) {
      console.error('[tongpin] static file failed:', error.message);
      sendJson(res, 500, { error: '页面加载失败。' });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, rooms: game.rooms.size });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/info') {
      const port = options.publicPort || server.address()?.port || DEFAULT_PORT;
      sendJson(res, 200, {
        name: '同频',
        port,
        publicUrl,
        lanUrls: getLanUrls(port),
        now: Date.now(),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      openStream(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const { code, playerId, token, role } = credentialsFrom(url);
      try {
        maybeExpire(code);
        const { room } = game.authenticate(code, playerId, token, role);
        sendState(res, room, playerId, role);
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      await handleAction(req, res, async (body) => {
        const { room, player } = game.createRoom(body.name);
        return {
          code: room.code,
          playerId: player.id,
          token: player.token,
          role: 'player',
          state: game.view(room, player.id, 'player'),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms/join') {
      await handleAction(req, res, async (body) => {
        const { room, player } = game.joinRoom(body.code, body.name);
        const entry = {
          code: room.code,
          playerId: player.id,
          token: player.token,
          role: 'player',
          state: game.view(room, player.id, 'player'),
        };
        broadcast(room);
        return entry;
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms/spectate') {
      await handleAction(req, res, async (body) => {
        const { room, spectator } = game.addSpectator(body.code, body.name);
        const entry = {
          code: room.code,
          playerId: spectator.id,
          spectatorId: spectator.id,
          token: spectator.token,
          role: 'spectator',
          state: game.view(room, spectator.id, 'spectator'),
        };
        broadcast(room);
        return entry;
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rejoin') {
      await handleAction(req, res, async (body) => {
        const role = body.role === 'spectator' ? 'spectator' : 'player';
        const outcome = game.rejoin(body.code, body.playerId, body.token, role);
        const member = role === 'spectator' ? outcome.spectator : outcome.player;
        const state = game.view(outcome.room, member.id, role);
        broadcast(outcome.room);
        return {
          code: outcome.room.code,
          playerId: member.id,
          token: member.token,
          role,
          state,
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/duration') {
      await handleAction(req, res, async (body) => {
        const { room } = game.setDuration(
          body.code,
          body.playerId,
          body.token,
          body.seconds,
        );
        broadcast(room);
        return { ok: true, state: game.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/leave') {
      await handleAction(req, res, async (body) => {
        const outcome = game.leaveLobby(body.code, body.playerId, body.token);
        if (outcome.room) broadcast(outcome.room);
        return { ok: true, deleted: outcome.deleted };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/spectate/leave') {
      await handleAction(req, res, async (body) => {
        const outcome = game.leaveSpectator(body.code, body.playerId, body.token);
        if (outcome.room) broadcast(outcome.room);
        return { ok: true, deleted: outcome.deleted };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      await handleAction(req, res, async (body) => {
        const { room } = game.start(body.code, body.playerId, body.token);
        broadcast(room);
        return { ok: true, state: game.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/like') {
      await handleAction(req, res, async (body) => {
        const role = body.role === 'spectator' ? 'spectator' : 'player';
        const outcome = game.likeWord(
          body.code,
          body.playerId,
          body.token,
          body.round,
          body.targetPlayerId,
          role,
        );
        broadcast(outcome.room);
        return {
          ok: true,
          liked: outcome.liked,
          alreadyLiked: outcome.alreadyLiked,
          count: outcome.count,
          state: game.view(outcome.room, body.playerId, role),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/restart') {
      await handleAction(req, res, async (body) => {
        const { room } = game.restart(body.code, body.playerId, body.token);
        broadcast(room);
        return { ok: true, state: game.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/draft') {
      await handleAction(req, res, async (body) => {
        const { room, player } = game.saveDraft(
          body.code,
          body.playerId,
          body.token,
          body.draft,
          body.round,
        );
        return { ok: true, draft: player.draft, savedAt: Date.now(), roomCode: room.code };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/submit') {
      await handleAction(req, res, async (body) => {
        const outcome = game.submit(
          body.code,
          body.playerId,
          body.token,
          body.word,
          body.round,
        );
        broadcast(outcome.room);
        if (outcome.revealed) {
          return { ok: true, revealed: true, state: game.view(outcome.room, body.playerId) };
        }
        return {
          ok: true,
          revealed: false,
          alreadySubmitted: Boolean(outcome.alreadySubmitted),
          state: game.view(outcome.room, body.playerId),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/continue') {
      await handleAction(req, res, async (body) => {
        const outcome = game.continueRound(
          body.code,
          body.playerId,
          body.token,
          body.round,
        );
        broadcast(outcome.room);
        return {
          ok: true,
          advanced: outcome.advanced,
          state: game.view(outcome.room, body.playerId),
        };
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/guess/state') {
      try {
        const room = guess.room(url.searchParams.get('code'));
        const role =
          url.searchParams.get('role') === 'spectator' ? 'spectator' : 'player';
        const state = guess.view(room, url.searchParams.get('playerId'), role);
        sendJson(res, 200, { ok: true, state });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.message || '读取失败。' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/rooms') {
      await handleAction(req, res, async (body) => {
        const { room, player } = guess.createRoom(body.name);
        return {
          code: room.code,
          playerId: player.id,
          token: player.token,
          state: guess.view(room, player.id),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/join') {
      await handleAction(req, res, async (body) => {
        const { room, player } = guess.joinRoom(body.code, body.name);
        return {
          code: room.code,
          playerId: player.id,
          token: player.token,
          state: guess.view(room, player.id),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/spectate') {
      await handleAction(req, res, async (body) => {
        const { room, spectator } = guess.addSpectator(body.code, body.name);
        return {
          code: room.code,
          playerId: spectator.id,
          spectatorId: spectator.id,
          token: spectator.token,
          role: 'spectator',
          name: spectator.name,
          state: guess.view(room, spectator.id, 'spectator'),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/spectate/leave') {
      await handleAction(req, res, async (body) => {
        const outcome = guess.leaveSpectator(body.code, body.playerId, body.token);
        return { ok: true, deleted: outcome.deleted };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/rejoin') {
      await handleAction(req, res, async (body) => {
        const role = body.role === 'spectator' ? 'spectator' : 'player';
        const outcome = guess.rejoin(body.code, body.playerId, body.token, role);
        const member = role === 'spectator' ? outcome.spectator : outcome.player;
        return {
          code: outcome.room.code,
          playerId: member.id,
          token: member.token,
          role,
          name: member.name,
          state: guess.view(outcome.room, member.id, role),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/restart') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.restart(body.code, body.playerId, body.token);
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/options') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.setOptions(
          body.code,
          body.playerId,
          body.token,
          body.qaMode,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/question') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.submitQuestion(
          body.code,
          body.playerId,
          body.token,
          body.question,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/question-draft') {
      await handleAction(req, res, async (body) => {
        const outcome = guess.saveQuestionDraft(
          body.code,
          body.playerId,
          body.token,
          body.question,
        );
        return { ok: true, draft: outcome.draft };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/answers') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.submitAnswers(
          body.code,
          body.playerId,
          body.token,
          body.answers,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/subject') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.setSubject(
          body.code,
          body.playerId,
          body.token,
          body.subject,
          body.subjectCustom,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/start') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.start(
          body.code,
          body.playerId,
          body.token,
          body.subject,
          body.subjectCustom,
          body.qaMode,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/describe') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.submitDescription(
          body.code,
          body.playerId,
          body.token,
          body.description,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/rate') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.submitGuess(
          body.code,
          body.playerId,
          body.token,
          body.score,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/next') {
      await handleAction(req, res, async (body) => {
        const { room } = guess.chooseNext(
          body.code,
          body.playerId,
          body.token,
          body.nextDescriptorId,
        );
        return { ok: true, state: guess.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/guess/leave') {
      await handleAction(req, res, async (body) => {
        const outcome = guess.leaveLobby(body.code, body.playerId, body.token);
        return { ok: true, deleted: outcome.deleted };
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/crisis/state') {
      try {
        const room = crisis.room(url.searchParams.get('code'));
        const role =
          url.searchParams.get('role') === 'spectator' ? 'spectator' : 'player';
        sendJson(res, 200, {
          ok: true,
          state: crisis.view(room, url.searchParams.get('playerId'), role),
        });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.message || '读取失败。' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/rooms') {
      await handleAction(req, res, async (body) => {
        const { room, player } = crisis.createRoom(body.name);
        return {
          code: room.code,
          playerId: player.id,
          token: player.token,
          role: 'player',
          state: crisis.view(room, player.id),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/join') {
      await handleAction(req, res, async (body) => {
        const { room, player } = crisis.joinRoom(body.code, body.name);
        return {
          code: room.code,
          playerId: player.id,
          token: player.token,
          role: 'player',
          state: crisis.view(room, player.id),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/spectate') {
      await handleAction(req, res, async (body) => {
        const { room, spectator } = crisis.addSpectator(body.code, body.name);
        return {
          code: room.code,
          playerId: spectator.id,
          token: spectator.token,
          role: 'spectator',
          name: spectator.name,
          state: crisis.view(room, spectator.id, 'spectator'),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/rejoin') {
      await handleAction(req, res, async (body) => {
        const role = body.role === 'spectator' ? 'spectator' : 'player';
        const outcome = crisis.rejoin(body.code, body.playerId, body.token, role);
        const member = role === 'spectator' ? outcome.spectator : outcome.player;
        return {
          code: outcome.room.code,
          playerId: member.id,
          token: member.token,
          role,
          name: member.name,
          state: crisis.view(outcome.room, member.id, role),
        };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/leave') {
      await handleAction(req, res, async (body) => {
        const outcome = crisis.leave(body.code, body.playerId, body.token);
        return { ok: true, deleted: outcome.deleted };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/spectate/leave') {
      await handleAction(req, res, async (body) => {
        crisis.leaveSpectator(body.code, body.playerId, body.token);
        return { ok: true };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/start') {
      await handleAction(req, res, async (body) => {
        const { room } = crisis.start(body.code, body.playerId, body.token);
        return { ok: true, state: crisis.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/reroll') {
      await handleAction(req, res, async (body) => {
        const { room } = crisis.rerollCrisis(body.code, body.playerId, body.token);
        return { ok: true, state: crisis.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/proposal') {
      await handleAction(req, res, async (body) => {
        const { room } = crisis.submitProposal(
          body.code,
          body.playerId,
          body.token,
          body,
        );
        return { ok: true, state: crisis.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/vote') {
      await handleAction(req, res, async (body) => {
        const { room } = crisis.submitVote(
          body.code,
          body.playerId,
          body.token,
          body.targetId,
        );
        return { ok: true, state: crisis.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/rating') {
      await handleAction(req, res, async (body) => {
        const { room } = crisis.submitRating(
          body.code,
          body.playerId,
          body.token,
          body.targetId,
          body.rating,
        );
        return { ok: true, state: crisis.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/next') {
      await handleAction(req, res, async (body) => {
        const { room } = crisis.nextRound(body.code, body.playerId, body.token);
        return { ok: true, state: crisis.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/crisis/restart') {
      await handleAction(req, res, async (body) => {
        const { room } = crisis.restart(body.code, body.playerId, body.token);
        return { ok: true, state: crisis.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/poem/state') {
      try {
        const room = poem.room(url.searchParams.get('code'));
        const role = url.searchParams.get('role') === 'spectator' ? 'spectator' : 'player';
        sendJson(res, 200, {
          ok: true,
          state: poem.view(room, url.searchParams.get('playerId'), role),
        });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.message || '读取失败。' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/rooms') {
      await handleAction(req, res, async (body) => {
        const { room, player } = poem.createRoom(body.name);
        return { code: room.code, playerId: player.id, token: player.token, role: 'player', state: poem.view(room, player.id) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/join') {
      await handleAction(req, res, async (body) => {
        const { room, player } = poem.joinRoom(body.code, body.name);
        return { code: room.code, playerId: player.id, token: player.token, role: 'player', state: poem.view(room, player.id) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/spectate') {
      await handleAction(req, res, async (body) => {
        const { room, spectator } = poem.addSpectator(body.code, body.name);
        return { code: room.code, playerId: spectator.id, token: spectator.token, role: 'spectator', name: spectator.name, state: poem.view(room, spectator.id, 'spectator') };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/rejoin') {
      await handleAction(req, res, async (body) => {
        const role = body.role === 'spectator' ? 'spectator' : 'player';
        const outcome = poem.rejoin(body.code, body.playerId, body.token, role);
        const member = role === 'spectator' ? outcome.spectator : outcome.player;
        return { code: outcome.room.code, playerId: member.id, token: member.token, role, name: member.name, state: poem.view(outcome.room, member.id, role) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/leave') {
      await handleAction(req, res, async (body) => {
        const outcome = poem.leave(body.code, body.playerId, body.token);
        return { ok: true, deleted: outcome.deleted };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/spectate/leave') {
      await handleAction(req, res, async (body) => {
        poem.leaveSpectator(body.code, body.playerId, body.token);
        return { ok: true };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/variant') {
      await handleAction(req, res, async (body) => {
        const { room } = poem.setVariant(body.code, body.playerId, body.token, body.variant);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/start') {
      await handleAction(req, res, async (body) => {
        const { room } = poem.start(body.code, body.playerId, body.token);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/char/draft') {
      await handleAction(req, res, async (body) => {
        poem.saveCharDraft(body.code, body.playerId, body.token, body.char);
        return { ok: true };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/char') {
      await handleAction(req, res, async (body) => {
        const { room } = poem.submitChar(body.code, body.playerId, body.token, body.char);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/submit') {
      await handleAction(req, res, async (body) => {
        const { room } = body.variant === 'sentence'
          ? poem.submitSentence(body.code, body.playerId, body.token, body.order, body.text)
          : poem.submitPoem(body.code, body.playerId, body.token, body.lines);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/vote') {
      await handleAction(req, res, async (body) => {
        const { room } = poem.submitVote(body.code, body.playerId, body.token, body.targetId);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/prompt') {
      await handleAction(req, res, async (body) => {
        const { room } = poem.choosePrompt(body.code, body.playerId, body.token, body.prompt);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/next') {
      await handleAction(req, res, async (body) => {
        const { room } = poem.nextRound(body.code, body.playerId, body.token);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/poem/restart') {
      await handleAction(req, res, async (body) => {
        const { room } = poem.restart(body.code, body.playerId, body.token);
        return { ok: true, state: poem.view(room, body.playerId) };
      });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: '不支持这个请求。' });
  });

  const heartbeat = setInterval(() => {
    for (const byPlayer of streams.values()) {
      for (const set of byPlayer.values()) {
        for (const res of set) {
          if (res.destroyed || res.writableEnded) continue;
          try {
            res.write(`: ping ${Date.now()}\n\n`);
          } catch {
            // Ignore; the close event will clean up.
          }
        }
      }
    }
  }, 20_000);

  const deadlineSweep = setInterval(() => {
    for (const room of game.rooms.values()) {
      if (room.phase === 'writing' && room.phaseEndsAt && Date.now() >= room.phaseEndsAt) {
        const result = game.reveal(room, 'timeout');
        if (result) broadcast(room);
      }
    }
    for (const room of guess.rooms.values()) {
      if (room.phase === 'question' && room.phaseEndsAt && Date.now() >= room.phaseEndsAt) {
        guess.finishQuestions(room);
      }
    }
    for (const room of poem.rooms.values()) {
      if (!room.phaseEndsAt || Date.now() < room.phaseEndsAt) continue;
      if (room.phase === 'chars') poem.finishChars(room);
      else if (room.phase === 'writing') poem.finishWriting(room);
      else if (room.phase === 'voting') poem.finishVoting(room);
    }
  }, 200);

  const cleanupSweep = setInterval(() => {
    const removed = game.cleanup(6 * 60 * 60 * 1000);
    if (removed.length) {
      console.log(`[tongpin] cleaned up ${removed.length} stale room(s)`);
    }
  }, 10 * 60 * 1000);

  for (const timer of [heartbeat, deadlineSweep, cleanupSweep]) timer.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(deadlineSweep);
    clearInterval(cleanupSweep);
    for (const byPlayer of streams.values()) {
      for (const set of byPlayer.values()) {
        for (const res of set) {
          try {
            res.end();
          } catch {
            // Ignore.
          }
        }
      }
    }
    streams.clear();
    connectionCounts.clear();
  });

  function listen(port = DEFAULT_PORT, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    });
  }

  return { server, game, listen, broadcast, isLoopbackHost };
}

async function main() {
  const app = createApp();
  const address = await app.listen(DEFAULT_PORT, '0.0.0.0').catch((error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n端口 ${DEFAULT_PORT} 被占用了。可以换一个端口启动：`);
      console.error(`  set PORT=8790 && node server.js\n`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
    throw error;
  });
  if (!address) return;

  const port = address.port;
  const lanUrls = getLanUrls(port);
  const publicUrl = normalizePublicUrl(
    process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL,
  );
  console.log('');
  console.log('  同频 · TONGPIN');
  console.log('  想到一起，才算数。');
  console.log('');
  if (publicUrl) {
    console.log(`  公网地址   ${publicUrl}`);
  }
  console.log(`  本机打开   http://localhost:${port}`);
  for (const url of lanUrls) {
    console.log(`  局域网     ${url}`);
  }
  if (!lanUrls.length) {
    console.log('  局域网     未检测到局域网 IPv4 地址');
  }
  console.log('');
  if (publicUrl) {
    console.log('  公网链接可以直接发给任何城市的朋友。');
  } else {
    console.log('  同一 Wi-Fi 下的朋友，用局域网地址加入。');
  }
  console.log('  按 Ctrl+C 停止服务。');
  console.log('');

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log('\n[tongpin] 正在关闭…');
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = { createApp, getLanUrls, isLoopbackHost, normalizePublicUrl };
