'use strict';

const app = document.querySelector('#number-app');
const toastRegion = document.querySelector('#toast-region');
const SESSION_KEY = 'tongpin.number.session';
const params = new URLSearchParams(location.search);
let session = readSession();
let state = null;
let pollTimer = null;
let tickTimer = null;
let errorMessage = '';

function readSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return parsed && parsed.code && parsed.playerId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  toastRegion.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 250);
  }, 2400);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || '操作失败。');
  return data;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function remainingSeconds() {
  if (!state?.roundEndsAt) return null;
  return Math.max(0, Math.ceil((state.roundEndsAt - Date.now()) / 1000));
}

function startTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const node = document.querySelector('[data-number-timer]');
    if (!node || !state?.roundEndsAt) return;
    const left = remainingSeconds();
    node.textContent = `${String(left).padStart(2, '0')}s`;
    node.classList.toggle('urgent', left <= 8);
  }, 250);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refresh, 900);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

async function refresh() {
  if (!session || !state) return;
  try {
    const response = await fetch(`/api/number/state?code=${encodeURIComponent(session.code)}&playerId=${encodeURIComponent(session.playerId)}&role=${encodeURIComponent(session.role)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败。');
    const previousPhase = state?.phase;
    const previousRound = state?.round;
    const previousSubmitted = state?.viewer?.submitted;
    state = data.state;
    const typing = document.activeElement?.matches?.('.number-input');
    const changed =
      previousPhase !== state.phase ||
      previousRound !== state.round ||
      previousSubmitted !== state.viewer?.submitted;
    if (!typing || changed) renderState();
  } catch (error) {
    if (/房间不存在|身份已失效/.test(error.message)) {
      saveSession(null);
      state = null;
      stopPolling();
      renderLanding(error.message);
    }
  }
}

function landingTemplate() {
  const code = params.get('code') || '';
  const watch = params.get('watch') === '1';
  return `<section class="number-hero">
    <div class="number-hero-copy">
      <p class="number-kicker">NUMBER DUEL / 第五模式</p>
      <h1 class="number-title">猜数字<span>_</span></h1>
      <p class="number-subtitle">2–4 人，各设一个 4 位数字。每轮按座位顺时针猜下家，30 秒，只报“几个位置正确”。先猜中自己目标 4 个位置的人赢。</p>
      <div class="number-rules">
        <span class="number-chip">4 DIGITS</span>
        <span class="number-chip">NO LEADING 0</span>
        <span class="number-chip">30 SEC / ROUND</span>
        <span class="number-chip">2–4 PLAYERS</span>
        <span class="number-chip">CLOCKWISE</span>
      </div>
      ${errorMessage ? `<p class="number-error">${esc(errorMessage)}</p>` : ''}
    </div>
    <div class="number-panel">
      <div class="number-panel-head"><span>${watch ? 'WATCH / 观战' : 'ENTER / 进入'}</span><span>2–4 PLAYERS</span></div>
      <div class="number-panel-body">
        <form data-form="${watch ? 'spectate' : 'create'}">
          <div class="number-field"><label>你的名字</label><input class="number-input" name="name" maxlength="12" autocomplete="nickname" placeholder="输入名字" /></div>
          ${watch ? `<div class="number-field"><label>房间码</label><input class="number-input" name="code" maxlength="4" value="${esc(code)}" placeholder="4 位房间码" style="text-transform:uppercase" /></div>` : ''}
          <div class="number-btn-row"><button class="number-btn" type="submit">${watch ? '进入观战' : '创建房间'}</button><a class="number-btn secondary" href="${watch ? '/number' : '/number?watch=1'}">${watch ? '我要玩' : '观战'}</a></div>
        </form>
        <div style="height:12px"></div>
        <form data-form="join">
          <div class="number-field"><label>已有房间</label><input class="number-input" name="code" maxlength="4" value="${esc(code)}" placeholder="输入房间码" style="text-transform:uppercase" /></div>
          <div class="number-field"><label>你的名字</label><input class="number-input" name="name" maxlength="12" autocomplete="nickname" placeholder="输入名字" /></div>
          <div class="number-btn-row"><button class="number-btn secondary" type="submit">加入房间</button></div>
        </form>
      </div>
    </div>
  </section>`;
}

function renderLanding(error) {
  errorMessage = error || '';
  stopPolling();
  app.innerHTML = landingTemplate();
}

function seatTemplate(player) {
  if (!player) {
    return `<div class="number-seat empty"><span class="number-seat-name">等待玩家…</span><span class="number-seat-meta">OPEN SLOT</span></div>`;
  }
  return `<div class="number-seat">
    <span class="number-seat-name">${esc(player.name)}${player.isYou ? ' · 你' : ''}</span>
    <span class="${player.hasSecret || player.submitted ? 'number-ready' : 'number-waiting'}">${player.hasSecret ? '已设数字' : '未设数字'}${player.submitted ? ' · 已猜' : ''}</span>
  </div>`;
}

function roomHeaderTemplate(title, label) {
  return `<div class="number-panel-head"><span>${esc(title)}</span><span>${esc(label)}</span></div>`;
}

function lobbyTemplate() {
  const own = state.players.find((player) => player.isYou);
  const seats = state.players.slice();
  while (seats.length < 4) seats.push(null);
  return `<section class="number-grid-2">
    <div class="number-panel">
      ${roomHeaderTemplate('ROOM / 房间', state.code)}
      <div class="number-panel-body">
        <div class="number-room-code">${esc(state.code)}<small>房间码</small></div>
        <div>${seats.map(seatTemplate).join('')}</div>
        <div class="number-btn-row">
          ${state.canStart ? '<button class="number-btn" data-action="start">开始设置数字</button>' : ''}
          <button class="number-btn secondary" data-action="copy-room">复制房间码</button>
          <button class="number-btn secondary" data-action="copy-watch">观战链接</button>
          ${own ? '<button class="number-btn ghost" data-action="leave">离开</button>' : ''}
        </div>
        <p class="number-muted" style="margin:10px 0 0">2–4 人，各设一个 4 位数字，首位不能是 0。人数够了由房主开始。</p>
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('RULES / 规则', 'READ ME')}
      <div class="number-panel-body number-muted">
        <p>· 每轮所有人同时猜一次，30 秒。</p>
        <p>· 按座位顺时针，每个人猜自己的下家，不用选对手。</p>
        <p>· 只报“几个位置正确”，不报是哪一位，也不报数字对但位置错。</p>
        <p>· 数字可以重复；猜中 4 个位置立即获胜。</p>
        <p>· 同一轮多人同时猜中，算平局。</p>
        <p>· 示例：目标 5821，猜 8888 → 1 个位置正确。</p>
      </div>
    </div>
  </section>`;
}

function secretTemplate() {
  const own = state.players.find((player) => player.isYou);
  const submitted = own?.hasSecret;
  return `<section class="number-grid-2">
    <div class="number-panel">
      ${roomHeaderTemplate('SET SECRET / 设置数字', `ROOM ${state.code}`)}
      <div class="number-panel-body">
        <div class="number-timer" data-number-timer>${remainingSeconds() ?? '--'}s</div>
        <p class="number-muted">设置你的 4 位秘密数字。首位不能是 0，数字可以重复。</p>
        ${submitted ? `<div class="number-digital">${[...own.secret].map((digit) => `<span>${esc(digit)}</span>`).join('')}</div><p class="number-ready" style="margin-top:12px">已设置，等待其他人…</p>` : `<form data-form="secret"><div class="number-field"><label>4 位数字</label><input class="number-input" name="secret" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="例如 5821" /></div><button class="number-btn" type="submit">锁定数字</button></form>`}
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('PLAYERS / 玩家', 'WAITING')}
      <div class="number-panel-body">${state.players.map(seatTemplate).join('')}${Array.from({length: Math.max(0, 4 - state.players.length)}, () => seatTemplate(null)).join('')}<p class="number-muted" style="margin-top:10px">所有人设置好后，立即进入第一轮。</p></div>
    </div>
  </section>`;
}

function resultText() {
  const winner = state.players.find((player) => player.id === state.winnerId);
  const title = state.tie ? '平局' : `${winner?.name || '玩家'} 获胜`;
  const lines = [
    '🔢 同频猜数字',
    `房间：${state.code}`,
    `结果：${title}`,
    `回合：${state.round}`,
    '',
    ...state.players.map((player) => {
      const history = player.history?.length
        ? player.history.map((entry) => `#${entry.round} ${entry.guess} → ${entry.matches}/4`).join('；')
        : '无猜测记录';
      return `${player.name}｜数字 ${player.secret || '****'}｜${history}`;
    }),
    '',
    '4 位数字 · 只报位置正确数 · 顺时针猜下家',
  ];
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    toast('复制失败，请手动选择文本');
  }
}

function downloadResult() {
  const blob = new Blob([resultText()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tongpin-number-${state.code}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('对局已导出');
}

function historyTemplate(history = []) {
  if (!history.length) return '<p class="number-muted">还没有猜过。只报位置正确的数量，不告诉你是哪一位。</p>';
  return `<ul class="number-history">${history.slice().reverse().map((entry) => `<li class="${entry.matches === 4 ? 'win' : ''}"><span>#${entry.round} <b>${esc(entry.guess)}</b>${entry.targetName ? ` → ${esc(entry.targetName)}` : ''}</span><span class="${entry.matches ? 'hit' : ''}">${entry.matches} / 4 位置</span></li>`).join('')}</ul>`;
}

function guessingTemplate() {
  const own = state.players.find((player) => player.isYou);
  const target = state.players.find((player) => player.id === state.viewer.targetId);
  const submitted = own?.submitted;
  return `<section class="number-grid-2">
    <div class="number-panel">
      ${roomHeaderTemplate('GUESS / 顺时针猜下家', `ROUND ${state.round}`)}
      <div class="number-panel-body">
        <div class="number-timer" data-number-timer>${remainingSeconds() ?? '--'}s</div>
        <p class="number-muted">你的数字：<b style="color:var(--n-green)">${esc(own?.secret || '****')}</b></p>
        <p class="number-muted" style="margin-top:6px">本轮目标：<b style="color:var(--n-cyan)">${esc(target?.name || '等待')}</b> · 不用选，按座位顺时针</p>
        ${submitted ? `<p class="number-ready" style="margin-top:10px">这一轮已提交，等待结果…</p>` : `<form data-form="guess"><div class="number-field"><label>输入你对 ${esc(target?.name || '下家')} 的猜测</label><input class="number-input" name="guess" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 位数字" /></div><button class="number-btn" type="submit">提交猜测</button></form>`}
        <div style="height:14px"></div>
        ${historyTemplate(own?.history || [])}
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('CLOCKWISE / 顺时针', target?.submitted ? '已猜' : '思考中')}
      <div class="number-panel-body">
        ${seatTemplate(target)}
        <p class="number-muted" style="margin-top:10px">每个人只猜自己的下家，座位顺序就是目标顺序。所有人的数字在结束前不会公开。</p>
        <div class="number-btn-row"><button class="number-btn secondary" data-action="copy-room">复制房间码</button></div>
      </div>
    </div>
  </section>`;
}

function finishedTemplate() {
  const winner = state.players.find((player) => player.id === state.winnerId);
  const own = state.players.find((player) => player.isYou);
  const title = state.tie ? '平局' : winner?.isYou ? '你赢了' : `${winner?.name || '对手'} 赢了`;
  return `<section class="number-finish">
    <p class="number-kicker">GAME OVER / 结果</p>
    <h2>${esc(title)}</h2>
    <p>${state.tie ? '双方在同一轮都猜中了 4 个位置。' : '先猜中对方 4 个位置的人获胜。'}</p>
    <div class="number-grid-2">
      ${state.players.map((player) => `<div class="number-panel"><div class="number-panel-head"><span>${esc(player.name)}${player.isYou ? ' · 你' : ''}</span><span>${esc(player.secret || '****')}</span></div><div class="number-panel-body">${historyTemplate(player.history)}</div></div>`).join('')}
    </div>
    <div class="number-btn-row">
      ${state.canRestart ? '<button class="number-btn" data-action="restart">再来一局</button>' : ''}
      <button class="number-btn secondary" data-action="share-result">分享结果</button>
      <button class="number-btn secondary" data-action="export-result">导出对局</button>
      <button class="number-btn secondary" data-action="copy-watch">观战链接</button>
      <button class="number-btn ghost" data-action="copy-room">复制房间码</button>
      <button class="number-btn ghost" data-action="home">返回大厅</button>
    </div>
  </section>`;
}

function spectatorTemplate() {
  return `<section class="number-grid-2">
    <div class="number-panel">
      ${roomHeaderTemplate('WATCH / 观战', `ROOM ${state.code}`)}
      <div class="number-panel-body">
        <p class="number-muted">${state.phase === 'secrets' ? '双方正在设置秘密数字。' : state.phase === 'guessing' ? `第 ${state.round} 轮，30 秒。` : '对局结束。'}</p>
        ${state.players.map((player) => `<div class="number-seat"><span class="number-seat-name">${esc(player.name)}</span><span class="number-seat-meta">${player.hasSecret ? '已设数字' : '未设数字'}${player.submitted ? ' · 已猜' : ''}</span></div>`).join('')}
        ${state.phase === 'finished' ? `<div style="height:12px"></div>${state.players.map((player) => `<p class="number-muted">${esc(player.name)}：<b style="color:var(--n-green)">${esc(player.secret || '****')}</b></p>`).join('')}` : ''}
        <div class="number-btn-row"><button class="number-btn ghost" data-action="home">返回首页</button></div>
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('SPECTATORS / 观战席', state.spectatorCount)}
      <div class="number-panel-body"><p class="number-muted">观战不显示双方数字，结束后公开。</p></div>
    </div>
  </section>`;
}

function renderState() {
  if (!state) return;
  startTicker();
  startPolling();
  if (state.viewer.isSpectator) {
    app.innerHTML = spectatorTemplate();
    return;
  }
  if (state.phase === 'lobby') app.innerHTML = lobbyTemplate();
  else if (state.phase === 'secrets') app.innerHTML = secretTemplate();
  else if (state.phase === 'guessing') app.innerHTML = guessingTemplate();
  else if (state.phase === 'finished') app.innerHTML = finishedTemplate();
}

async function enter(payload) {
  saveSession({ code: payload.code, playerId: payload.playerId, token: payload.token, role: payload.role || 'player' });
  state = payload.state;
  errorMessage = '';
  renderState();
}

async function createRoom(name) {
  const data = await api('/api/number/rooms', { name });
  await enter({ ...data, role: 'player' });
}

async function joinRoom(code, name) {
  const data = await api('/api/number/join', { code, name });
  await enter({ ...data, role: 'player' });
}

async function spectate(code, name) {
  const data = await api('/api/number/spectate', { code, name });
  await enter({ ...data, role: 'spectator' });
}

async function rejoin() {
  if (!session) return false;
  try {
    const data = await api('/api/number/rejoin', session);
    state = data.state;
    saveSession({ ...session, role: data.role || session.role, name: data.name });
    renderState();
    return true;
  } catch (error) {
    saveSession(null);
    state = null;
    errorMessage = error.message === '房间不存在，可能已经结束了。' ? '' : error.message;
    return false;
  }
}

function formValues(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

async function handleForm(form) {
  const type = form.dataset.form;
  const values = formValues(form);
  try {
    if (type === 'create') await createRoom(values.name);
    else if (type === 'join') await joinRoom(values.code, values.name);
    else if (type === 'spectate') await spectate(values.code, values.name);
    else if (type === 'secret') {
      const data = await api('/api/number/secret', { code: session.code, playerId: session.playerId, token: session.token, secret: digits(values.secret) });
      state = data.state;
      renderState();
    } else if (type === 'guess') {
      const data = await api('/api/number/guess', { code: session.code, playerId: session.playerId, token: session.token, guess: digits(values.guess) });
      state = data.state;
      renderState();
    }
  } catch (error) {
    toast(error.message);
  }
}

async function handleAction(action) {
  try {
    if (action === 'start') {
      const data = await api('/api/number/start', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'restart') {
      const data = await api('/api/number/restart', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'leave') {
      await api('/api/number/leave', { code: session.code, playerId: session.playerId, token: session.token });
      saveSession(null);
      state = null;
      stopPolling();
      renderLanding();
    } else if (action === 'copy-room') {
      const url = `${location.origin}/number?code=${encodeURIComponent(state.code)}`;
      await copyText(`同频猜数字，房间号 ${state.code}：${url}`);
    } else if (action === 'copy-watch') {
      const url = `${location.origin}/number?code=${encodeURIComponent(state.code)}&watch=1`;
      await copyText(`来观战同频猜数字：${url}`);
    } else if (action === 'share-result') {
      const text = resultText();
      if (navigator.share) {
        try {
          await navigator.share({ title: '同频猜数字', text });
          return;
        } catch {
          // Fall back to clipboard if the share sheet is dismissed.
        }
      }
      await copyText(text);
    } else if (action === 'export-result') {
      downloadResult();
    } else if (action === 'home') {
      saveSession(null);
      location.href = '/';
    }
  } catch (error) {
    toast(error.message);
  }
}

app.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  handleForm(form);
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) handleAction(button.dataset.action);
});

async function boot() {
  const code = params.get('code');
  const watching = params.get('watch') === '1';
  if (session && (!code || code.toUpperCase() === session.code)) {
    const ok = await rejoin();
    if (ok) return;
  }
  if (watching && code) {
    app.innerHTML = `<div class="number-panel" style="max-width:520px;margin:0 auto"><div class="number-panel-head"><span>WATCH / 观战</span><span>ROOM ${esc(code)}</span></div><div class="number-panel-body"><form data-form="spectate"><div class="number-field"><label>你的名字</label><input class="number-input" name="name" maxlength="12" placeholder="观众" /></div><input type="hidden" name="code" value="${esc(code)}" /><button class="number-btn" type="submit">进入观战</button></form></div></div>`;
    return;
  }
  renderLanding();
}

boot();
