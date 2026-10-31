'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

async function startServer(options = {}) {
  const app = createApp({
    allowedDurations: [1, 45, 60],
    ...options,
  });
  const address = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  async function post(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // Ignore.
    }
    return { status: response.status, payload };
  }

  async function get(path) {
    const response = await fetch(`${base}${path}`);
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // Ignore.
    }
    return { status: response.status, payload };
  }

  return { app, base, post, get };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function credentials(code, playerId, token) {
  return { code, playerId, token };
}

function stateUrl(code, playerId, token, role = 'player') {
  const query = new URLSearchParams({ code, playerId, token, role });
  return `/api/state?${query.toString()}`;
}

test('HTTP flow: create, fill four seats, start, submit, win', async (t) => {
  const { app, post, get } = await startServer();
  t.after(() => closeServer(app.server));

  const created = await post('/api/rooms', { name: '阿青' });
  assert.equal(created.status, 200);
  const host = created.payload;
  assert.equal(host.code.length, 4);

  const players = [
    { playerId: host.playerId, token: host.token, name: '阿青' },
  ];
  for (const name of ['小满', '阿树', '阿禾']) {
    const joined = await post('/api/rooms/join', { code: host.code, name });
    assert.equal(joined.status, 200);
    players.push({ playerId: joined.payload.playerId, token: joined.payload.token, name });
  }

  const fifth = await post('/api/rooms/join', { code: host.code, name: '第五位' });
  assert.equal(fifth.status, 409);

  const setDuration = await post('/api/duration', {
    ...credentials(host.code, host.playerId, host.token),
    seconds: 60,
  });
  assert.equal(setDuration.status, 200);
  assert.equal(setDuration.payload.state.durationSec, 60);

  const started = await post('/api/start', credentials(host.code, host.playerId, host.token));
  assert.equal(started.status, 200);
  assert.equal(started.payload.state.phase, 'writing');
  assert.equal(started.payload.state.round, 1);

  let last;
  for (const player of players) {
    last = await post('/api/submit', {
      ...credentials(host.code, player.playerId, player.token),
      word: '海',
    });
    assert.equal(last.status, 200);
  }
  assert.equal(last.payload.state.phase, 'won');
  assert.equal(last.payload.state.result.allSame, true);
  assert.equal(last.payload.state.result.entries.length, 4);

  const viewed = await get(stateUrl(host.code, host.playerId, host.token));
  assert.equal(viewed.status, 200);
  assert.equal(viewed.payload.state.phase, 'won');
});

test('HTTP flow: timeout reveals synced drafts, then everyone continues', async (t) => {
  const { app, post, get } = await startServer();
  t.after(() => closeServer(app.server));

  const host = (await post('/api/rooms', { name: '甲' })).payload;
  const guest = (await post('/api/rooms/join', { code: host.code, name: '乙' })).payload;

  await post('/api/duration', {
    ...credentials(host.code, host.playerId, host.token),
    seconds: 1,
  });
  await post('/api/start', credentials(host.code, host.playerId, host.token));
  await post('/api/draft', {
    ...credentials(host.code, host.playerId, host.token),
    draft: '夏天',
  });
  await post('/api/draft', {
    ...credentials(host.code, guest.playerId, guest.token),
    draft: '海边',
  });

  await new Promise((resolve) => setTimeout(resolve, 1350));

  const revealed = await get(stateUrl(host.code, host.playerId, host.token));
  assert.equal(revealed.status, 200);
  assert.equal(revealed.payload.state.phase, 'reveal');
  assert.equal(revealed.payload.state.result.endedBy, 'timeout');
  assert.deepEqual(
    revealed.payload.state.result.entries.map((entry) => entry.word),
    ['夏天', '海边'],
  );

  const firstContinue = await post('/api/continue', credentials(host.code, host.playerId, host.token));
  assert.equal(firstContinue.status, 200);
  assert.equal(firstContinue.payload.state.phase, 'reveal');
  assert.equal(firstContinue.payload.state.viewer.continued, true);

  const secondContinue = await post('/api/continue', credentials(host.code, guest.playerId, guest.token));
  assert.equal(secondContinue.status, 200);
  assert.equal(secondContinue.payload.state.phase, 'writing');
  assert.equal(secondContinue.payload.state.round, 2);
  assert.equal(secondContinue.payload.state.lastRound.entries[0].word, '夏天');
});

test('spectator API: joins without a seat, sees no words until reveal, cannot continue', async (t) => {
  const { app, post, get } = await startServer();
  t.after(() => closeServer(app.server));

  const host = (await post('/api/rooms', { name: '观主' })).payload;
  const guest = (await post('/api/rooms/join', { code: host.code, name: '观客' })).payload;
  const audience = await post('/api/rooms/spectate', { code: host.code, name: '路人' });
  assert.equal(audience.status, 200);
  assert.equal(audience.payload.role, 'spectator');
  assert.equal(audience.payload.state.viewer.role, 'spectator');
  assert.equal(audience.payload.state.players.length, 2);

  await post('/api/start', credentials(host.code, host.playerId, host.token));
  await post('/api/submit', {
    ...credentials(host.code, host.playerId, host.token),
    word: '海',
  });

  const writing = await get(
    stateUrl(host.code, audience.payload.playerId, audience.payload.token, 'spectator'),
  );
  assert.equal(writing.status, 200);
  assert.equal(writing.payload.state.role, 'spectator');
  assert.equal(writing.payload.state.players.find((p) => p.name === '观主').word, null);

  await post('/api/submit', {
    ...credentials(host.code, guest.playerId, guest.token),
    word: '海',
  });
  const revealed = await get(
    stateUrl(host.code, audience.payload.playerId, audience.payload.token, 'spectator'),
  );
  assert.equal(revealed.payload.state.phase, 'won');
  assert.equal(revealed.payload.state.result.entries.length, 2);

  const unauthorized = await post('/api/continue', {
    ...credentials(host.code, audience.payload.playerId, audience.payload.token),
    round: 1,
  });
  assert.equal(unauthorized.status, 401);
});

test('SSE sends room state and later broadcasts a submission', async (t) => {
  const { app, post } = await startServer();
  const controller = new AbortController();
  t.after(async () => {
    controller.abort();
    await closeServer(app.server);
  });
  const host = (await post('/api/rooms', { name: '流一' })).payload;
  const guest = (await post('/api/rooms/join', { code: host.code, name: '流二' })).payload;
  await post('/api/start', credentials(host.code, host.playerId, host.token));

  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sseQuery = new URLSearchParams({
    code: host.code,
    playerId: host.playerId,
    token: host.token,
  });
  const stream = await fetch(`${base}/api/events?${sseQuery.toString()}`, {
    signal: controller.signal,
    headers: { Accept: 'text/event-stream' },
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 2000;
  while (!buffer.includes('event: state') && Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 2000)),
    ]);
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
  }
  assert.match(buffer, /event: state/);
  assert.match(buffer, /"phase":"writing"/);

  await post('/api/submit', {
    ...credentials(host.code, guest.playerId, guest.token),
    word: '风',
  });

  buffer = '';
  const broadcastDeadline = Date.now() + 2000;
  while (!buffer.includes('"submittedCount":1') && Date.now() < broadcastDeadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE broadcast timeout')), 2000)),
    ]);
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
  }
  assert.match(buffer, /"submittedCount":1/);

  controller.abort();
  try {
    await reader.cancel();
  } catch {
    // The abort may close it first.
  }
});
