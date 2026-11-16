'use strict';

const app = document.querySelector('#dragon-app');
const toastRegion = document.querySelector('#toast-region');
const SESSION_KEY = 'tongpin.dragon.session';
const params = new URLSearchParams(location.search);
let session = readSession();
let state = null;
let pollTimer = null;
let tool = 'dragon';
let hintCell = null;
let hintText = '';
let lastInvalid = false;
let errorMessage = '';
let drag = null;
let suppressClick = false;

const REGION_COLORS = [
  '#ffe08a', '#bde7a4', '#ffc0b2', '#b9ddf3', '#e8c8f2', '#f6d2a0',
  '#c7e8d8', '#ffd6e0', '#d9dcf5', '#e9e2a3', '#c8e9e2', '#f3c7a8',
];

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

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refresh, 1100);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function refresh() {
  if (!session || !state) return;
  try {
    const response = await fetch(`/api/dragon/state?code=${encodeURIComponent(session.code)}&playerId=${encodeURIComponent(session.playerId)}&role=${encodeURIComponent(session.role)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败。');
    const previousPhase = state.phase;
    state = data.state;
    if (state.invalid && !lastInvalid) {
      lastInvalid = true;
      toast('放满了，但还不符合规则，再检查一下。');
    }
    if (!state.invalid) lastInvalid = false;
    if (state.phase !== previousPhase) {
      hintCell = null;
      hintText = '';
    }
    renderState();
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
  return `<section class="dragon-hero">
    <div>
      <p class="dragon-kicker">FIND THE NAILONG / 第六模式</p>
      <h1 class="dragon-title">找<em>奶龙</em></h1>
      <p class="dragon-subtitle">彩色格子里藏着一群奶龙。每行、每列、每个同色区域只能有一只；奶龙之间八个方向都不能相邻。靠排除法把它们全部找出来。</p>
      <div class="dragon-chips">
        <span class="dragon-chip">1–4 人</span>
        <span class="dragon-chip">5×5 – 12×12</span>
        <span class="dragon-chip">每行 / 每列 / 每色块</span>
        <span class="dragon-chip">八方向不相邻</span>
      </div>
      ${errorMessage ? `<p class="dragon-hint" style="color:#b2372c">${esc(errorMessage)}</p>` : ''}
      <div class="dragon-role-note"><b>两种玩法</b>竞速：每人一块相同棋盘，先完成者赢。合作：共用一块棋盘，一起完成。一个人也可以直接开始。</div>
    </div>
    <div class="dragon-entry-grid">
      <div class="dragon-panel">
        <div class="dragon-panel-head"><span>CREATE / 创建房间</span><span>1–4 人</span></div>
        <div class="dragon-panel-body">
          <form data-form="create">
            <div class="dragon-field"><label>你的名字</label><input class="dragon-input" name="name" maxlength="12" autocomplete="nickname" placeholder="输入名字" /><span class="dragon-hint">2–12 个字符，房间内不能重名。</span></div>
            <button class="dragon-btn" type="submit">创建房间</button>
          </form>
          <div class="dragon-role-note"><b>创建后做什么</b><span>选竞速或合作，再选棋盘大小，把双链接发给朋友。</span></div>
        </div>
      </div>
      <div class="dragon-panel">
        <div class="dragon-panel-head"><span>JOIN / 加入房间</span><span>找奶龙</span></div>
        <div class="dragon-panel-body">
          <form data-form="join">
            <div class="dragon-field"><label>房间码</label><input class="dragon-input" name="code" maxlength="4" value="${esc(code)}" placeholder="4 位房间码" style="text-transform:uppercase" /><span class="dragon-hint">房主发你的 4 位房间码。</span></div>
            <div class="dragon-field"><label>你的名字</label><input class="dragon-input" name="name" maxlength="12" autocomplete="nickname" placeholder="输入名字" /></div>
            <button class="dragon-btn secondary" type="submit">加入房间</button>
          </form>
          <div class="dragon-role-note"><b>进房后做什么</b><span>等房主开局，然后在棋盘上放奶龙、打叉排除。</span></div>
          <p class="dragon-hint" style="margin:9px 0 0"><a href="${watch ? '/dragon' : '/dragon?watch=1'}" style="color:#7fba58">${watch ? '我要玩' : '只看不玩 →'}</a></p>
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
  if (!player) return `<div class="dragon-seat empty"><span class="dragon-seat-name">等待玩家…</span><span class="dragon-seat-meta">OPEN</span></div>`;
  return `<div class="dragon-seat"><span class="dragon-seat-name">${esc(player.name)}${player.isYou ? ' · 你' : ''}</span><span class="dragon-seat-meta">${state.mode === 'coop' ? '共用棋盘' : `${player.count}/${state.size} 奶龙`}</span></div>`;
}

function panelHead(title, label) {
  return `<div class="dragon-panel-head"><span>${esc(title)}</span><span>${esc(label)}</span></div>`;
}

function lobbyTemplate() {
  const own = state.players.find((player) => player.isYou);
  const seats = state.players.slice();
  while (seats.length < 4) seats.push(null);
  const isHost = state.viewer.isHost;
  return `<div class="dragon-two-col">
    <div class="dragon-panel">
      ${panelHead('ROOM / 房间', state.code)}
      <div class="dragon-panel-body">
        <div class="dragon-room-code">${esc(state.code)}<small>房间码</small></div>
        <div>${seats.map(seatTemplate).join('')}</div>
        ${isHost ? `<div class="dragon-settings">
          <div class="dragon-field"><label>玩法</label><select class="dragon-select" data-setting="mode"><option value="race" ${state.mode === 'race' ? 'selected' : ''}>竞速 · 各解各的</option><option value="coop" ${state.mode === 'coop' ? 'selected' : ''}>合作 · 共用棋盘</option></select></div>
          <div class="dragon-field"><label>棋盘</label><select class="dragon-select" data-setting="size">${state.sizes.map((size) => `<option value="${size}" ${size === state.size ? 'selected' : ''}>${size}×${size}</option>`).join('')}</select></div>
        </div>` : `<p class="dragon-hint">玩法：${state.mode === 'race' ? '竞速' : '合作'} · 棋盘 ${state.size}×${state.size}</p>`}
        <div class="dragon-btn-row">
          ${state.canStart ? '<button class="dragon-btn" data-action="start">开始找奶龙</button>' : ''}
          <button class="dragon-btn secondary" data-action="copy-links">复制双链接</button>
          <button class="dragon-btn secondary" data-action="copy-watch">观战链接</button>
          ${own ? '<button class="dragon-btn ghost" data-action="leave">离开</button>' : ''}
        </div>
      </div>
    </div>
    <div class="dragon-panel">
      ${panelHead('RULES / 规则', '3 RULES')}
      <div class="dragon-panel-body dragon-hint">
        <p>1. 每一行只能有一只奶龙。</p>
        <p>2. 每一列只能有一只奶龙。</p>
        <p>3. 每一个同色区域只能有一只奶龙。</p>
        <p>4. 两只奶龙八个方向都不能相邻。</p>
        <p>点格子放奶龙，再点一次取消；切到「打叉」可以标记排除格。</p>
      </div>
    </div>
  </div>`;
}

function boardTemplate() {
  const size = state.size;
  const board = state.board || {};
  const own = state.players.find((player) => player.isYou);
  const remaining = Math.max(0, size - (own?.count || 0));
  const blocked = new Set(state.blocked || []);
  const cells = Array.from({ length: size * size }, (_, index) => {
    const region = state.regions?.[index] ?? 0;
    const value = board[index] || board[String(index)] || '';
    const color = REGION_COLORS[region % REGION_COLORS.length];
    const given = blocked.has(index);
    let content = '';
    if (given || value === 'x') {
      content = '<span class="cross">×</span>';
    } else if (value === 'dragon') {
      content = '<img class="nailong-img" src="/nailong.png" alt="" draggable="false" />';
    }
    return `<button type="button" class="dragon-cell ${given ? 'given' : ''} ${hintCell === index ? 'hinted' : ''}" data-cell="${index}" ${given ? 'data-blocked="1"' : ''} style="--cell:${color}" aria-label="第 ${Math.floor(index / size) + 1} 行第 ${index % size + 1} 列">${content}</button>`;
  }).join('');
  return `<div class="dragon-board-wrap">
    <div class="dragon-hud">
      <img class="dragon-hud-img" src="/nailong.png" alt="" draggable="false" />
      <span>剩余奶龙：<b>${remaining}</b></span>
      <span class="dragon-hud-mode">${state.mode === 'coop' ? '合作' : '竞速'}</span>
    </div>
    <div class="dragon-board-frame" style="--n:${size}">
      <div class="dragon-row-labels">${Array.from({ length: size }, (_, i) => `<span>${size - i}</span>`).join('')}</div>
      <div class="dragon-board ${tool === 'x' ? 'x-mode' : ''}" style="--n:${size}">${cells}</div>
      <div class="dragon-col-labels">${Array.from({ length: size }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
    </div>
    <div class="dragon-tools">
      <button type="button" class="dragon-tool ${tool === 'dragon' ? 'active' : ''}" data-tool="dragon">放奶龙</button>
      <button type="button" class="dragon-tool ${tool === 'x' ? 'active' : ''}" data-tool="x">打叉排除</button>
      <button type="button" class="dragon-btn secondary" data-action="hint" ${state.hintLimit && state.hintsUsed >= state.hintLimit ? 'disabled' : ''}>${state.hintLimit ? `提示 ${state.hintsUsed}/${state.hintLimit}` : '提示 ∞'}</button>
    </div>
    <p class="dragon-note">${hintText || '每行、每列、每个色块各一只，八方向不相邻。'}</p>
  </div>`;
}

function gameTemplate() {
  const own = state.players.find((player) => player.isYou);
  const count = own?.count || 0;
  return `<div class="dragon-two-col">
    <div class="dragon-panel">
      ${panelHead(state.mode === 'coop' ? 'CO-OP / 合作找奶龙' : 'RACE / 竞速找奶龙', `${state.size}×${state.size}`)}
      <div class="dragon-panel-body">
        <div class="dragon-status">
          <span class="dragon-pill">${state.mode === 'coop' ? '共用棋盘' : '各自棋盘'}</span>
          <span class="dragon-pill">奶龙 ${count}/${state.size}</span>
          <span class="dragon-pill">提示 ${state.hintLimit ? `${state.hintsUsed}/${state.hintLimit}` : `${state.hintsUsed} 次`}</span>
        </div>
        ${boardTemplate()}
      </div>
    </div>
    <div class="dragon-panel">
      ${panelHead('PLAYERS / 玩家', 'LIVE')}
      <div class="dragon-panel-body">
        ${state.players.map(seatTemplate).join('')}
        <div class="dragon-btn-row">
          <button class="dragon-btn secondary" data-action="copy-links">复制双链接</button>
          ${state.viewer.isHost ? '<button class="dragon-btn secondary" data-action="reveal">公布答案</button>' : ''}
          <button class="dragon-btn ghost" data-action="exit">退出本局</button>
        </div>
        <p class="dragon-hint" style="margin-top:10px">${state.mode === 'coop' ? '合作模式：所有人共用一块棋盘，提示不限次数。' : '竞速模式：每人一块同样棋盘，提示最多 3 次；先完成者赢。'}</p>
      </div>
    </div>
  </div>`;
}

function answerBoardTemplate() {
  const size = state.size;
  const answer = new Set(state.answer || []);
  const blocked = new Set(state.blocked || []);
  const cells = Array.from({ length: size * size }, (_, index) => {
    const region = state.regions?.[index] ?? 0;
    const color = REGION_COLORS[region % REGION_COLORS.length];
    let content = '';
    if (answer.has(index)) content = '<img class="nailong-img" src="/nailong.png" alt="" draggable="false" />';
    else if (blocked.has(index)) content = '<span class="cross">×</span>';
    return `<div class="dragon-cell ${blocked.has(index) ? 'given' : ''}" style="--cell:${color}">${content}</div>`;
  }).join('');
  return `<div class="dragon-answer-wrap"><p class="dragon-answer-label">ANSWER / 唯一解</p><div class="dragon-board" style="--n:${size}">${cells}</div></div>`;
}

function finishedTemplate() {
  const winner = state.players.find((player) => player.id === state.winnerId);
  const revealed = state.revealed;
  const title = revealed
    ? '答案已公布'
    : state.mode === 'coop'
      ? '奶龙全部找到了'
      : `${esc(winner?.name || '有人')} 先找到`;
  const note = revealed
    ? '本局已结束，绿色奶龙就是唯一答案。'
    : state.mode === 'coop'
      ? '合作模式完成，大家一起通关。'
      : '先正确放完所有奶龙的人获胜。';
  return `<div class="dragon-finish">
    <p class="dragon-kicker">${revealed ? 'ANSWER REVEALED' : state.mode === 'coop' ? 'CO-OP CLEAR' : 'RACE OVER'}</p>
    <h2>${title}</h2>
    <p>${note}</p>
    ${answerBoardTemplate()}
    <div class="dragon-btn-row">
      ${state.canRestart ? '<button class="dragon-btn" data-action="restart">再来一局</button>' : ''}
      <button class="dragon-btn secondary" data-action="share-result">分享结果</button>
      <button class="dragon-btn secondary" data-action="copy-result">复制文本</button>
      <button class="dragon-btn secondary" data-action="export-result">导出 TXT</button>
      <button class="dragon-btn secondary" data-action="copy-links">复制双链接</button>
      <button class="dragon-btn ghost" data-action="exit">退出本局</button>
    </div>
  </div>`;
}

function spectatorTemplate() {
  return `<div class="dragon-two-col">
    <div class="dragon-panel">
      ${panelHead('WATCH / 观战', `ROOM ${state.code}`)}
      <div class="dragon-panel-body">
        <p class="dragon-hint">观战不显示竞速玩家的私有棋盘。${state.phase === 'finished' ? '对局已结束。' : ''}</p>
        ${state.players.map(seatTemplate).join('')}
        <div class="dragon-btn-row"><button class="dragon-btn ghost" data-action="home">返回首页</button></div>
      </div>
    </div>
    <div class="dragon-panel">${panelHead('SPECTATORS / 观战席', state.spectators.length)}<div class="dragon-panel-body"><p class="dragon-hint">安静看，不打扰。</p></div></div>
  </div>`;
}

function renderState() {
  if (!state) return;
  startPolling();
  if (state.viewer.isSpectator) app.innerHTML = spectatorTemplate();
  else if (state.phase === 'lobby') app.innerHTML = lobbyTemplate();
  else if (state.phase === 'playing') app.innerHTML = gameTemplate();
  else if (state.phase === 'finished') app.innerHTML = finishedTemplate();
}

function dualLinks() {
  const base = `${location.origin}/dragon?code=${encodeURIComponent(state.code)}`;
  return `🐉 同频找奶龙，房间 ${state.code}\n🎮 玩家链接：${base}\n👀 观战链接：${base}&watch=1`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    toast('复制失败，请手动复制');
  }
}

function resultText() {
  const winner = state.players.find((player) => player.id === state.winnerId);
  const result = state.revealed
    ? '答案已公布'
    : state.mode === 'coop'
      ? '合作通关'
      : `${winner?.name || '有人'} 获胜`;
  return [
    '🐉 同频找奶龙',
    `房间：${state.code}`,
    `模式：${state.mode === 'coop' ? '合作' : '竞速'}`,
    `棋盘：${state.size}×${state.size}`,
    `结果：${result}`,
  ].join('\n');
}

function downloadResult() {
  const blob = new Blob([resultText()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tongpin-dragon-${state.code}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已开始下载 TXT 文件');
}

async function handleAction(action) {
  try {
    if (action === 'start') {
      const data = await api('/api/dragon/start', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'restart') {
      const data = await api('/api/dragon/restart', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'leave') {
      await api('/api/dragon/leave', { code: session.code, playerId: session.playerId, token: session.token });
      saveSession(null);
      state = null;
      stopPolling();
      renderLanding();
    } else if (action === 'copy-links') {
      await copyText(dualLinks());
    } else if (action === 'copy-watch') {
      await copyText(`👀 来观战同频找奶龙：${location.origin}/dragon?code=${encodeURIComponent(state.code)}&watch=1`);
    } else if (action === 'share-result') {
      const text = resultText();
      if (navigator.share) {
        try { await navigator.share({ title: '同频找奶龙', text }); return; } catch {}
      }
      await copyText(text);
    } else if (action === 'copy-result') {
      await copyText(resultText());
    } else if (action === 'export-result') {
      downloadResult();
    } else if (action === 'reveal') {
      if (!window.confirm('公布答案会结束本局，确定吗？')) return;
      const data = await api('/api/dragon/reveal', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'exit') {
      await api('/api/dragon/leave', { code: session.code, playerId: session.playerId, token: session.token });
      saveSession(null);
      state = null;
      stopPolling();
      location.href = '/';
    } else if (action === 'hint') {
      const data = await api('/api/dragon/hint', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      hintCell = data.hint.cell;
      hintText = data.hint.text;
      renderState();
    } else if (action === 'home') {
      saveSession(null);
      location.href = '/';
    }
  } catch (error) {
    toast(error.message);
  }
}

function markXLocal(index) {
  const cell = document.querySelector(`[data-cell="${index}"]`);
  if (!cell) return;
  cell.innerHTML = '<span class="cross">×</span>';
  if (state?.board) state.board[index] = 'x';
}

async function handleCell(index) {
  if (suppressClick) return;
  if (!state || state.viewer.isSpectator || state.phase !== 'playing') return;
  if ((state.blocked || []).includes(index)) return;
  const current = state.board[index] || state.board[String(index)] || 'empty';
  const value = current === tool ? 'empty' : tool;
  try {
    const data = await api('/api/dragon/tap', { code: session.code, playerId: session.playerId, token: session.token, index, value });
    state = data.state;
    hintCell = null;
    renderState();
  } catch (error) {
    toast(error.message);
  }
}

function startDrag(event) {
  if (tool !== 'x' || !state || state.viewer.isSpectator || state.phase !== 'playing') return;
  const cell = event.target.closest('[data-cell]');
  if (!cell || cell.dataset.blocked) return;
  const index = Number(cell.dataset.cell);
  const value = state.board[index] || state.board[String(index)] || 'empty';
  if (value === 'dragon') return;
  event.preventDefault();
  drag = { indexes: new Set(), seen: new Set(), removeIndex: value === 'x' ? index : null };
  if (value !== 'x') {
    drag.indexes.add(index);
    markXLocal(index);
  }
  drag.seen.add(index);
}

function moveDrag(event) {
  if (!drag) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-cell]');
  if (!target) return;
  const index = Number(target.dataset.cell);
  if (target.dataset.blocked) return;
  if (drag.seen.has(index)) return;
  drag.seen.add(index);
  const value = state.board[index] || state.board[String(index)] || 'empty';
  if (value === 'dragon' || value === 'x') return;
  drag.indexes.add(index);
  markXLocal(index);
  event.preventDefault();
}

async function endDrag() {
  if (!drag) return;
  const indexes = [...drag.indexes];
  const removeIndex = drag.removeIndex;
  drag = null;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 350);
  try {
    if (!indexes.length && removeIndex != null) {
      const data = await api('/api/dragon/tap', {
        code: session.code, playerId: session.playerId, token: session.token, index: removeIndex, value: 'empty',
      });
      state = data.state;
      hintCell = null;
      renderState();
      return;
    }
    if (!indexes.length) return;
    const data = await api('/api/dragon/paint', {
      code: session.code,
      playerId: session.playerId,
      token: session.token,
      indexes,
      value: 'x',
    });
    state = data.state;
    hintCell = null;
    renderState();
  } catch (error) {
    toast(error.message);
    renderState();
  }
}

async function handleForm(form) {
  const type = form.dataset.form;
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    if (type === 'create') {
      const data = await api('/api/dragon/rooms', { name: values.name });
      saveSession({ code: data.code, playerId: data.playerId, token: data.token, role: 'player' });
      state = data.state;
      renderState();
    } else if (type === 'join') {
      const data = await api('/api/dragon/join', { code: values.code, name: values.name });
      saveSession({ code: data.code, playerId: data.playerId, token: data.token, role: 'player' });
      state = data.state;
      renderState();
    } else if (type === 'spectate') {
      const data = await api('/api/dragon/spectate', { code: values.code, name: values.name });
      saveSession({ code: data.code, playerId: data.playerId, token: data.token, role: 'spectator' });
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
    const data = await api('/api/dragon/rejoin', session);
    saveSession({ ...session, role: data.role || session.role, name: data.name });
    state = data.state;
    renderState();
    return true;
  } catch (error) {
    saveSession(null);
    state = null;
    errorMessage = /房间不存在/.test(error.message) ? '' : error.message;
    return false;
  }
}

app.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  handleForm(form);
});

app.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-setting]');
  if (!select) return;
  try {
    const data = await api('/api/dragon/settings', {
      code: session.code,
      playerId: session.playerId,
      token: session.token,
      [select.dataset.setting]: select.value,
    });
    state = data.state;
    renderState();
  } catch (error) {
    toast(error.message);
  }
});

app.addEventListener('pointerdown', startDrag);
document.addEventListener('pointermove', moveDrag, { passive: false });
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

app.addEventListener('click', (event) => {
  if (suppressClick) return;
  const toolButton = event.target.closest('[data-tool]');
  if (toolButton) {
    tool = toolButton.dataset.tool;
    renderState();
    return;
  }
  const cell = event.target.closest('[data-cell]');
  if (cell) {
    handleCell(Number(cell.dataset.cell));
    return;
  }
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
    app.innerHTML = `<div class="dragon-panel" style="max-width:520px;margin:0 auto"><div class="dragon-panel-head"><span>WATCH / 观战</span><span>ROOM ${esc(code)}</span></div><div class="dragon-panel-body"><form data-form="spectate"><div class="dragon-field"><label>你的名字</label><input class="dragon-input" name="name" maxlength="12" placeholder="观众" /></div><input type="hidden" name="code" value="${esc(code)}" /><button class="dragon-btn" type="submit">进入观战</button></form></div></div>`;
    return;
  }
  renderLanding();
}

boot();
