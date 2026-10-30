'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GameStore, GameError } = require('./lib/game');

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
  const publicUrl = normalizePublicUrl(
    options.publicUrl ||
      process.env.PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL,
  );
  // code -> playerId -> Set<ServerResponse>
  const streams = new Map();
  // code -> playerId -> number of open SSE connections
  const connectionCounts = new Map();

  function streamSet(code, playerId) {
    let byPlayer = streams.get(code);
    if (!byPlayer) {
      byPlayer = new Map();
      streams.set(code, byPlayer);
    }
    let set = byPlayer.get(playerId);
    if (!set) {
      set = new Set();
      byPlayer.set(playerId, set);
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
    const byPlayer = streams.get(room.code);
    if (!byPlayer) return;
    for (const player of room.players) {
      const set = byPlayer.get(player.id);
      if (!set || !set.size) continue;
      let state;
      try {
        state = game.view(room, player.id);
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

  function sendState(res, room, playerId) {
    sendJson(res, 200, { state: game.view(room, playerId) });
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
    };
  }

  function openStream(req, res, url) {
    const { code, playerId, token } = credentialsFrom(url);
    let room;
    let player;
    try {
      const auth = game.authenticate(code, playerId, token);
      room = auth.room;
      player = auth.player;
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
    const set = streamSet(room.code, player.id);
    set.add(res);

    const counts = countMap(room.code);
    const previousCount = counts.get(player.id) || 0;
    counts.set(player.id, previousCount + 1);
    if (previousCount === 0) {
      game.setConnected(room.code, player.id, true);
    }

    writeEvent(res, 'hello', { serverNow: Date.now(), code: room.code });
    writeEvent(res, 'state', game.view(room, player.id));
    broadcast(room);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      set.delete(res);
      if (!set.size) {
        streams.get(room.code)?.delete(player.id);
      }
      const current = counts.get(player.id) || 0;
      const next = Math.max(0, current - 1);
      if (next === 0) {
        counts.delete(player.id);
        const outcome = game.setConnected(room.code, player.id, false);
        if (outcome?.room) broadcast(outcome.room);
      } else {
        counts.set(player.id, next);
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
      const { code, playerId, token } = credentialsFrom(url);
      try {
        maybeExpire(code);
        const { room } = game.authenticate(code, playerId, token);
        sendState(res, room, playerId);
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
          state: game.view(room, player.id),
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
          state: game.view(room, player.id),
        };
        broadcast(room);
        return entry;
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rejoin') {
      await handleAction(req, res, async (body) => {
        const { room, player } = game.rejoin(body.code, body.playerId, body.token);
        const state = game.view(room, player.id);
        broadcast(room);
        return { code: room.code, playerId: player.id, token: player.token, state };
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

    if (req.method === 'POST' && url.pathname === '/api/start') {
      await handleAction(req, res, async (body) => {
        const { room } = game.start(body.code, body.playerId, body.token);
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
