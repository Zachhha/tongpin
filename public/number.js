'use strict';

const app = document.querySelector('#number-app');
const toastRegion = document.querySelector('#toast-region');
const SESSION_KEY = 'tongpin.number.session';
const params = new URLSearchParams(location.search);
let session = readSession();
let state = null;
let pollTimer = null;
let tickTimer = null;
let draftTimer = null;
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

async function refresh() {
  if (!session || !state) return;
  try {
    const response = await fetch(`/api/number/state?code=${encodeURIComponent(session.code)}&playerId=${encodeURIComponent(session.playerId)}&role=${encodeURIComponent(session.role)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败。');
    const typing = document.activeElement?.matches?.('.number-input');
    const phaseChanged = state.phase !== data.state.phase;
    const roundChanged = state.round !== data.state.round;
    state = data.state;
    if (!typing || phaseChanged || roundChanged) renderState();
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
      <p class="number-kicker">CLOCKWISE BULLS / 第五模式</p>
      <h1 class="number-title">猜数字<span>_</span></h1>
      <p class="number-subtitle">每人各设一个 4 位不重复数字，按座位顺时针猜下家。每轮 30 秒，只反馈“全对”和“错位”；先猜中下家 4 个全对的人获胜。</p>
      <div class="number-rules">
        <span class="number-chip">4 DIGITS</span>
        <span class="number-chip">NO REPEAT</span>
        <span class="number-chip">LEADING 0 OK</span>
        <span class="number-chip">全对 / 错位</span>
      </div>
      ${errorMessage ? `<p class="number-error">${esc(errorMessage)}</p>` : ''}
    </div>
    <div class="number-entry-grid">
      <div class="number-panel number-entry-card">
        <div class="number-panel-head"><span>CREATE / 创建房间</span><span>2–4 人</span></div>
        <div class="number-panel-body">
          <form data-form="create">
            <div class="number-field"><label>你的名字</label><input class="number-input" name="name" maxlength="12" autocomplete="nickname" placeholder="输入名字" /><span class="number-field-hint">2–12 个字符，房间内不能重名。</span></div>
            <button class="number-btn" type="submit">创建房间</button>
          </form>
          <div class="number-role-note"><b>创建后做什么</b><span>设置自己的 4 位数字，然后把玩家链接和观战链接发给朋友。</span></div>
        </div>
      </div>
      <div class="number-panel number-entry-card">
        <div class="number-panel-head"><span>JOIN / 加入房间</span><span>猜下家</span></div>
        <div class="number-panel-body">
          <form data-form="join">
            <div class="number-field"><label>房间码</label><input class="number-input" name="code" maxlength="4" value="${esc(code)}" placeholder="4 位房间码" style="text-transform:uppercase" /><span class="number-field-hint">房主发你的 4 位房间码。</span></div>
            <div class="number-field"><label>你的名字</label><input class="number-input" name="name" maxlength="12" autocomplete="nickname" placeholder="输入名字" /></div>
            <button class="number-btn secondary" type="submit">加入房间</button>
          </form>
          <div class="number-role-note"><b>进房后做什么</b><span>每个人都要设自己的数字；开始后只猜座位顺时针的下家。</span></div>
          <p class="number-muted" style="margin:9px 0 0"><a href="${watch ? '/number' : '/number?watch=1'}" style="color:var(--n-cyan)">${watch ? '我要玩' : '只看不玩 →'}</a></p>
        </div>
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
    <span class="${player.hasSecret ? 'number-ready' : 'number-waiting'}">${player.hasSecret ? '已设数字' : '未设数字'}${player.submitted ? ' · 已猜' : ''}</span>
  </div>`;
}

function roomHeaderTemplate(title, label) {
  return `<div class="number-panel-head"><span>${esc(title)}</span><span>${esc(label)}</span></div>`;
}

function lobbyTemplate() {
  const own = state.players.find((player) => player.isYou);
  const seats = state.players.slice();
  while (seats.length < 4) seats.push(null);
  return `<section class="number-grid-2 number-play-layout">
    <div class="number-panel number-panel-primary">
      ${roomHeaderTemplate('ROOM / 房间', state.code)}
      <div class="number-panel-body">
        <div class="number-room-code">${esc(state.code)}<small>房间码</small></div>
        <div>${seats.map(seatTemplate).join('')}</div>
        <div class="number-btn-row">
          ${state.canStart ? '<button class="number-btn" data-action="start">开始设置数字</button>' : ''}
          <button class="number-btn secondary" data-action="copy-links">复制双链接</button>
          <button class="number-btn secondary" data-action="copy-watch">观战链接</button>
          ${own ? '<button class="number-btn ghost" data-action="leave">离开</button>' : ''}
        </div>
        <p class="number-muted" style="margin:10px 0 0">2–4 人，每人设一个 4 位数字。人数够了由房主开始。</p>
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('RULES / 规则', 'READ ME')}
      <div class="number-panel-body number-muted">
        <p>· 每个人各设一个 4 位不重复数字，可以 0 开头。</p>
        <p>· 按座位顺时针，每个人只猜自己的下家。</p>
        <p>· 每轮 30 秒，所有人同时猜。</p>
        <p>· 全对 = 数字和位置都对；错位 = 数字对但位置不对。</p>
        <p>· 先猜中下家 4 个全对的人获胜。</p>
        <p>· 示例：下家 5234，猜 5346 → 全对 1，错位 2。</p>
      </div>
    </div>
  </section>`;
}

function secretTemplate() {
  const own = state.players.find((player) => player.isYou);
  const submitted = own?.hasSecret;
  return `<section class="number-grid-2 number-play-layout">
    <div class="number-panel number-panel-primary">
      ${roomHeaderTemplate('SET SECRET / 设置数字', `ROOM ${state.code}`)}
      <div class="number-panel-body">
        <div class="number-timer number-timer-large" data-number-timer>${remainingSeconds() ?? '--'}s</div>
        <p class="number-muted">设置你的 4 位秘密数字。不能重复，可以 0 开头。</p>
        ${submitted
          ? `<div class="number-digital">${[...own.secret].map((digit) => `<span>${esc(digit)}</span>`).join('')}</div><p class="number-ready" style="margin-top:12px">已设置，等待其他人…</p>`
          : `<form data-form="secret"><div class="number-field"><label>你的秘密数字</label><input class="number-input" name="secret" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="例如 0165" value="${esc(state.viewer.draft || '')}" /><span class="number-field-hint">4 位互不重复数字，可以 0 开头。</span></div><button class="number-btn" type="submit">锁定数字</button><p class="number-muted" style="margin:8px 0 0">草稿自动保存；超时未提交会随机补全后提交。</p></form>`}
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('PLAYERS / 玩家', 'WAITING')}
      <div class="number-panel-body">${state.players.map(seatTemplate).join('')}${Array.from({ length: Math.max(0, 4 - state.players.length) }, () => seatTemplate(null)).join('')}<p class="number-muted" style="margin-top:10px">所有人设置好后，立即进入第一轮。</p></div>
    </div>
  </section>`;
}

function resultLabel(entry) {
  return `全对 ${entry.a} · 错位 ${entry.b}`;
}

function historyTemplate(history = []) {
  if (!history.length) return '<p class="number-muted">还没有猜过。每次会得到“全对 / 错位”提示。</p>';
  return `<ul class="number-history">${history.slice().reverse().map((entry) => `<li class="${entry.a === 4 ? 'win' : ''}"><span>#${entry.round} <b>${esc(entry.guess)}</b>${entry.targetName ? ` → ${esc(entry.targetName)}` : ''}</span><span class="${entry.a === 4 ? 'hit' : ''}">${resultLabel(entry)}</span></li>`).join('')}</ul>`;
}

function guessingTemplate() {
  const own = state.players.find((player) => player.isYou);
  const target = state.players.find((player) => player.id === state.viewer.targetId);
  const submitted = own?.submitted;
  return `<section class="number-grid-2 number-play-layout">
    <div class="number-panel number-panel-primary">
      ${roomHeaderTemplate('GUESS / 顺时针猜下家', `ROUND ${state.round}`)}
      <div class="number-panel-body">
        <div class="number-timer" data-number-timer>${remainingSeconds() ?? '--'}s</div>
        <p class="number-muted">你的数字：<b style="color:var(--n-green)">${esc(own?.secret || '****')}</b></p>
        <p class="number-muted" style="margin-top:6px">本轮目标：<b style="color:var(--n-cyan)">${esc(target?.name || '等待')}</b> · 按座位顺时针</p>
        ${submitted
          ? `<p class="number-ready" style="margin-top:10px">这一轮已提交，等待结果…</p>`
          : `<form data-form="guess"><div class="number-field"><label>你对 ${esc(target?.name || '下家')} 的猜测</label><input class="number-input" name="guess" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="例如 5346" value="${esc(state.viewer.draft || '')}" /><span class="number-field-hint">全对 = 数字和位置都对；错位 = 数字对但位置不对。</span></div><button class="number-btn" type="submit">提交猜测</button><p class="number-muted" style="margin:8px 0 0">草稿自动保存；30 秒到自动提交，不足 4 位随机补全。</p></form>`}
        <div style="height:14px"></div>
        ${historyTemplate(own?.history || [])}
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('CLOCKWISE / 顺时针', target?.submitted ? '已猜' : '思考中')}
      <div class="number-panel-body">
        <p class="number-target-label">本轮目标 · 你的下家</p>
        <div class="number-target-name">${esc(target?.name || '等待')}</div>
        ${seatTemplate(target)}
        <p class="number-muted" style="margin-top:10px">每个人只猜自己的下家，座位顺序就是目标顺序。所有人的数字在结束前不会公开。</p>
        <div class="number-btn-row"><button class="number-btn secondary" data-action="copy-links">复制双链接</button></div>
      </div>
    </div>
  </section>`;
}

function finishedTemplate() {
  const winner = state.players.find((player) => player.id === state.winnerId);
  return `<section class="number-finish">
    <p class="number-kicker">GAME OVER / 结果</p>
    <h2>${state.tie ? '平局' : `${esc(winner?.name || '有人')} 猜中了`}</h2>
    <p>${state.tie ? '同一轮有多人猜中下家的 4 个全对。' : '先猜中下家 4 个全对的人获胜。'}</p>
    <div class="number-grid-2">
      ${state.players.map((player) => `<div class="number-panel"><div class="number-panel-head"><span>${esc(player.name)}${player.isYou ? ' · 你' : ''}</span><span>数字 ${esc(player.secret || '****')}</span></div><div class="number-panel-body">${historyTemplate(player.history)}</div></div>`).join('')}
    </div>
    <div class="number-btn-row">
      ${state.canRestart ? '<button class="number-btn" data-action="restart">再来一局</button>' : ''}
      <button class="number-btn secondary" data-action="share-result">分享结果</button>
      <button class="number-btn secondary" data-action="copy-result">复制文本</button>
      <button class="number-btn secondary" data-action="export-result">导出 TXT</button>
      <button class="number-btn secondary" data-action="copy-links">复制双链接</button>
      <button class="number-btn ghost" data-action="home">返回大厅</button>
    </div>
  </section>`;
}

function spectatorTemplate() {
  return `<section class="number-grid-2 number-play-layout">
    <div class="number-panel number-panel-primary">
      ${roomHeaderTemplate('WATCH / 观战', `ROOM ${state.code}`)}
      <div class="number-panel-body">
        <p class="number-muted">${state.phase === 'secrets' ? '玩家正在设置数字。' : state.phase === 'guessing' ? `第 ${state.round} 轮，30 秒。` : '对局结束。'}</p>
        ${state.players.map((player) => `<div class="number-seat"><span class="number-seat-name">${esc(player.name)}</span><span class="number-seat-meta">${player.hasSecret ? '已设数字' : '未设数字'}${player.submitted ? ' · 已猜' : ''}</span></div>`).join('')}
        ${state.phase === 'finished' ? `<div style="height:12px"></div>${state.players.map((player) => `<p class="number-muted">${esc(player.name)}：<b style="color:var(--n-green)">${esc(player.secret || '****')}</b></p>`).join('')}` : ''}
        <div class="number-btn-row"><button class="number-btn ghost" data-action="home">返回首页</button></div>
      </div>
    </div>
    <div class="number-panel">
      ${roomHeaderTemplate('SPECTATORS / 观战席', state.spectatorCount)}
      <div class="number-panel-body"><p class="number-muted">观战不显示数字，结束后公开。</p></div>
    </div>
  </section>`;
}

function renderState() {
  if (!state) return;
  startTicker();
  startPolling();
  if (state.viewer.isSpectator) app.innerHTML = spectatorTemplate();
  else if (state.phase === 'lobby') app.innerHTML = lobbyTemplate();
  else if (state.phase === 'secrets') app.innerHTML = secretTemplate();
  else if (state.phase === 'guessing') app.innerHTML = guessingTemplate();
  else if (state.phase === 'finished') app.innerHTML = finishedTemplate();
}

function scheduleDraft(kind, value) {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    if (!session || !state || state.viewer.submitted) return;
    try {
      await api('/api/number/draft', {
        code: session.code,
        playerId: session.playerId,
        token: session.token,
        kind,
        value,
      });
    } catch {}
  }, 900);
}

function resultText() {
  const winner = state.players.find((player) => player.id === state.winnerId);
  return [
    '🔢 同频猜数字',
    `房间：${state.code}`,
    `结果：${state.tie ? '平局' : `${winner?.name || '有人'} 获胜`}`,
    `回合：${state.round}`,
    '',
    ...state.players.map((player) => {
      const lines = (player.history || []).map((entry) => `${entry.guess} → ${resultLabel(entry)}`).join('；');
      return `${player.name}｜数字 ${player.secret || '****'}｜${lines || '无记录'}`;
    }),
    '',
    '4 位不重复数字 · 顺时针猜下家 · 4 个全对获胜',
  ].join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    toast('复制失败，请手动复制');
  }
}

function downloadResult() {
  const text = resultText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tongpin-number-${state.code}.txt`;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已开始下载 TXT 文件');
}

function dualLinks() {
  const player = `${location.origin}/number?code=${encodeURIComponent(state.code)}`;
  const watch = `${location.origin}/number?code=${encodeURIComponent(state.code)}&watch=1`;
  return `🔢 同频猜数字，房间 ${state.code}\n🎮 玩家链接：${player}\n👀 观战链接：${watch}`;
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
    } else if (action === 'copy-links') {
      await copyText(dualLinks());
    } else if (action === 'copy-watch') {
      await copyText(`👀 来观战同频猜数字：${location.origin}/number?code=${encodeURIComponent(state.code)}&watch=1`);
    } else if (action === 'share-result') {
      const text = resultText();
      if (navigator.share) {
        try {
          await navigator.share({ title: '同频猜数字', text });
          return;
        } catch {}
      }
      await copyText(text);
    } else if (action === 'copy-result') {
      await copyText(resultText());
    } else if (action === 'export-result') {
      downloadResult();
    } else if (action === 'random-secret') {
      const pool = Array.from('0123456789');
      for (let index = pool.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [pool[index], pool[swap]] = [pool[swap], pool[index]];
      }
      const input = document.querySelector('input[name="secret"]');
      if (input) {
        input.value = pool.slice(0, 4).join('');
        input.focus();
      }
    } else if (action === 'home') {
      saveSession(null);
      location.href = '/';
    }
  } catch (error) {
    toast(error.message);
  }
}

async function handleForm(form) {
  const type = form.dataset.form;
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    if (type === 'create') {
      const data = await api('/api/number/rooms', { name: values.name });
      saveSession({ code: data.code, playerId: data.playerId, token: data.token, role: 'player' });
      state = data.state;
      renderState();
    } else if (type === 'join') {
      const data = await api('/api/number/join', { code: values.code, name: values.name });
      saveSession({ code: data.code, playerId: data.playerId, token: data.token, role: 'player' });
      state = data.state;
      renderState();
    } else if (type === 'spectate') {
      const data = await api('/api/number/spectate', { code: values.code, name: values.name });
      saveSession({ code: data.code, playerId: data.playerId, token: data.token, role: 'spectator' });
      state = data.state;
      renderState();
    } else if (type === 'secret') {
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

async function rejoin() {
  if (!session) return false;
  try {
    const data = await api('/api/number/rejoin', session);
    saveSession({ ...session, role: data.role || session.role, name: data.name });
    state = data.state;
    renderState();
    return true;
  } catch (error) {
    saveSession(null);
    state = null;
    errorMessage = error.message === '房间不存在，可能已经结束了。' ? '' : error.message;
    return false;
  }
}

app.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  handleForm(form);
});

app.addEventListener('input', (event) => {
  const input = event.target.closest('.number-input');
  const form = input?.closest('form[data-form]');
  if (!input || !form) return;
  if (form.dataset.form === 'secret' || form.dataset.form === 'guess') {
    scheduleDraft(form.dataset.form, digits(input.value));
  }
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) handleAction(button.dataset.action);
});

async function boot() {
  const code = params.get('code');
  const watching = params.get('watch') === '1';
  if (session && (!code || code.toUpperCase() === session.code)) {
    if (await rejoin()) return;
  }
  if (watching && code) {
    app.innerHTML = `<div class="number-panel" style="max-width:520px;margin:0 auto"><div class="number-panel-head"><span>WATCH / 观战</span><span>ROOM ${esc(code)}</span></div><div class="number-panel-body"><form data-form="spectate"><div class="number-field"><label>你的名字</label><input class="number-input" name="name" maxlength="12" placeholder="观众" /></div><input type="hidden" name="code" value="${esc(code)}" /><button class="number-btn" type="submit">进入观战</button></form></div></div>`;
    return;
  }
  renderLanding();
}

setInterval(() => {
  const input = document.querySelector('.number-input:focus');
  const form = input?.closest('form[data-form]');
  if (!input || !form) return;
  if (form.dataset.form === 'secret' || form.dataset.form === 'guess') {
    scheduleDraft(form.dataset.form, digits(input.value));
  }
}, 3000);

boot();
