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
let winShown = false;
let starFrame = null;
let starParticles = [];

const REGION_PALETTE = Array.from({ length: 24 }, (_, index) => `hsl(${index * 15} 62% 78%)`);

function regionColorsFor(regions, size) {
  if (!regions || !size) return REGION_PALETTE;
  const count = Math.max(...regions) + 1;
  const adjacency = Array.from({ length: count }, () => new Set());
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      const region = regions[index];
      if (col + 1 < size) {
        const right = regions[index + 1];
        if (right !== region) { adjacency[region].add(right); adjacency[right].add(region); }
      }
      if (row + 1 < size) {
        const down = regions[index + size];
        if (down !== region) { adjacency[region].add(down); adjacency[down].add(region); }
      }
    }
  }
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => adjacency[b].size - adjacency[a].size);
  const colorIndex = Array(count).fill(-1);
  const circularDistance = (a, b) => {
    const diff = Math.abs(a - b) * 15;
    return Math.min(diff, 360 - diff);
  };
  for (const region of order) {
    const neighborColors = [...adjacency[region]].map((id) => colorIndex[id]).filter((id) => id >= 0);
    let best = -1;
    let bestScore = -1;
    for (let candidate = 0; candidate < REGION_PALETTE.length; candidate += 1) {
      if (neighborColors.includes(candidate)) continue;
      const score = neighborColors.length ? Math.min(...neighborColors.map((c) => circularDistance(candidate, c))) : 180;
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    colorIndex[region] = best >= 0 ? best : 0;
  }
  return colorIndex.map((index) => REGION_PALETTE[index]);
}

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
        <span class="dragon-chip">5×5 – 14×14</span>
        <span class="dragon-chip">每行 / 每列 / 每色块</span>
        <span class="dragon-chip">八方向不相邻</span>
      </div>
      ${errorMessage ? `<p class="dragon-hint" style="color:#b2372c">${esc(errorMessage)}</p>` : ''}
      <p class="dragon-preview-entry"><a href="/dragon?preview=win">预览 13×13 通关结算 →</a></p>
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
        ${isHost ? `<div class="dragon-option-group">
          <span class="dragon-option-label">玩法</span>
          <div class="dragon-option-list">
            <button type="button" class="dragon-option ${state.mode === 'race' ? 'active' : ''}" data-mode-option="race"><b>竞速</b><span>每人一块相同棋盘，先完成者赢</span></button>
            <button type="button" class="dragon-option ${state.mode === 'coop' ? 'active' : ''}" data-mode-option="coop"><b>合作</b><span>所有人共用一块棋盘，一起完成</span></button>
          </div>
        </div>
        <div class="dragon-option-group">
          <span class="dragon-option-label">棋盘大小</span>
          <div class="dragon-option-list dragon-size-list">
            ${state.sizes.map((size) => `<button type="button" class="dragon-option dragon-size-option ${!state.campaign && size === state.size ? 'active' : ''}" data-size-option="${size}">${size}×${size}</button>`).join('')}
            <button type="button" class="dragon-option dragon-size-option dragon-campaign-option ${state.campaign ? 'active' : ''}" data-size-option="campaign">闯关 <span>5→13</span></button>
          </div>
          <div class="dragon-custom-size">
            <label for="dragon-custom-size-input">自定义边长</label>
            <input id="dragon-custom-size-input" class="dragon-input" type="number" min="5" max="14" step="1" value="${state.size}" data-custom-size />
            <button type="button" class="dragon-btn secondary" data-action="apply-custom-size">应用</button>
          </div>
        </div>` : `<p class="dragon-hint">玩法：${state.campaign ? '闯关' : state.mode === 'race' ? '竞速' : '合作'} · 棋盘 ${state.size}×${state.size}</p>`}
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
        <p>5. 闯关模式 = 合作连续过关，从 5×5 自动升到 12×12。</p>
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
  const regionColors = regionColorsFor(state.regions, size);
  const cells = Array.from({ length: size * size }, (_, index) => {
    const region = state.regions?.[index] ?? 0;
    const value = board[index] || board[String(index)] || '';
    const color = regionColors[region] || REGION_PALETTE[0];
    const given = blocked.has(index);
    let content = '';
    if (given || value === 'x') {
      content = '<span class="cross">×</span>';
    } else if (value === 'dragon') {
      content = '<img class="nailong-img" src="/nailong.png" alt="" draggable="false" />';
    } else if (value === 'hypo') {
      content = '<img class="nailong-img hypo-img" src="/nailong.png" alt="" draggable="false" />';
    }
    return `<button type="button" class="dragon-cell ${given ? 'given' : ''} ${hintCell === index ? 'hinted' : ''}" data-cell="${index}" ${given ? 'data-blocked="1"' : ''} style="--cell:${color}" aria-label="第 ${Math.floor(index / size) + 1} 行第 ${index % size + 1} 列">${content}</button>`;
  }).join('');
  return `<div class="dragon-board-wrap">
    <div class="dragon-hud">
      <img class="dragon-hud-img" src="/nailong.png" alt="" draggable="false" />
      <span>剩余奶龙：<b>${remaining}</b></span>
      <span class="dragon-hud-mode">假设 ${state.hypoCount || 0}</span>
      <span class="dragon-hud-mode">${state.campaign ? `闯关 ${Number(state.campaignIndex) + 1}/${state.campaignTotal} · ${size}×${size}` : state.mode === 'coop' ? '合作' : '竞速'}</span>
    </div>
    <div class="dragon-board-frame" style="--n:${size}">
      <div class="dragon-row-labels">${Array.from({ length: size }, (_, i) => `<span>${size - i}</span>`).join('')}</div>
      <div class="dragon-board ${tool === 'x' ? 'x-mode' : ''}" style="--n:${size}">${cells}</div>
      <div class="dragon-col-labels">${Array.from({ length: size }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
    </div>
    <div class="dragon-tools">
      <button type="button" class="dragon-tool ${tool === 'dragon' ? 'active' : ''}" data-tool="dragon">放奶龙</button>
      <button type="button" class="dragon-tool dragon-hypo-tool ${tool === 'hypo' ? 'active' : ''}" data-tool="hypo">假设奶龙</button>
      <button type="button" class="dragon-tool ${tool === 'x' ? 'active' : ''}" data-tool="x">打叉排除</button>
      <button type="button" class="dragon-btn secondary" data-action="hint" ${state.hintLimit && state.hintsUsed >= state.hintLimit ? 'disabled' : ''}>${state.hintLimit ? `提示 ${state.hintsUsed}/${state.hintLimit}` : '提示 ∞'}</button>
    </div>
    <div class="dragon-tools dragon-action-tools">
      <button type="button" class="dragon-tool" data-action="undo" ${state.canUndo ? '' : 'disabled'}>撤回上个奶龙</button>
      <button type="button" class="dragon-tool" data-action="undo-hypo" ${state.canUndoHypo ? '' : 'disabled'}>撤回所有假设</button>
      <button type="button" class="dragon-tool" data-action="clear-dragons">清空奶龙</button>
      <button type="button" class="dragon-tool" data-action="clear-x">清空排除</button>
      <button type="button" class="dragon-tool ${state.autoExclude ? 'active' : ''}" data-action="toggle-auto">自动排除：${state.autoExclude ? '开' : '关'}</button>
    </div>
    <p class="dragon-note">${hintText || '每行、每列、每个色块各一只，八方向不相邻。'}</p>
    <div class="dragon-log"><span>操作记录</span>${state.log?.length ? state.log.slice().reverse().map((entry) => `<p><b>${esc(entry.name)}</b>${esc(entry.text)}</p>`).join('') : '<p class="dragon-log-empty">暂无操作</p>'}</div>
  </div>`;
}

function gameTemplate() {
  const own = state.players.find((player) => player.isYou);
  const count = own?.count || 0;
  return `<div class="dragon-two-col">
    <div class="dragon-panel">
      ${panelHead(state.campaign ? 'CAMPAIGN / 闯关找奶龙' : state.mode === 'coop' ? 'CO-OP / 合作找奶龙' : 'RACE / 竞速找奶龙', state.campaign ? `第 ${Number(state.campaignIndex) + 1}/${state.campaignTotal} 关 · ${state.size}×${state.size}` : `${state.size}×${state.size}`)}
      <div class="dragon-panel-body">
        <div class="dragon-status">
          <span class="dragon-pill">${state.campaign ? '合作闯关' : state.mode === 'coop' ? '共用棋盘' : '各自棋盘'}</span>
          <span class="dragon-pill">奶龙 ${count}/${state.size}</span>
          <span class="dragon-pill">假设 ${state.hypoCount || 0}</span>
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
  const regionColors = regionColorsFor(state.regions, size);
  const cells = Array.from({ length: size * size }, (_, index) => {
    const region = state.regions?.[index] ?? 0;
    const color = regionColors[region] || REGION_PALETTE[0];
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
    : state.campaign
      ? '闯关完成'
      : state.mode === 'coop'
        ? '奶龙全部找到了'
        : `${esc(winner?.name || '有人')} 先找到`;
  const note = revealed
    ? '本局已结束，绿色奶龙就是唯一答案。'
    : state.campaign
      ? '从 5×5 一路通关到 13×13，合作闯关完成。'
      : state.mode === 'coop'
        ? '合作模式完成，大家一起通关。'
        : '先正确放完所有奶龙的人获胜。';
  return `<div class="dragon-finish">
    <p class="dragon-kicker">${revealed ? 'ANSWER REVEALED' : state.campaign ? 'CAMPAIGN CLEAR' : state.mode === 'coop' ? 'CO-OP CLEAR' : 'RACE OVER'}</p>
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

function campaignComplete() {
  return Boolean(state?.campaign && state.phase === 'finished' && !state.revealed
    && Number(state.campaignIndex) === Number(state.campaignTotal) - 1);
}

function winTemplate(preview = false) {
  return `<div class="dragon-win">
    <canvas id="dragon-stars" class="dragon-stars" aria-hidden="true"></canvas>
    <div class="dragon-win-glow" aria-hidden="true"></div>
    <section class="dragon-win-card" role="dialog" aria-label="闯关完成">
      <p class="dragon-win-kicker">ALL CLEAR · 全 部 通 关</p>
      <video class="dragon-angel" src="/angel-nailong.mp4" poster="/angel-poster.png" autoplay muted loop playsinline preload="auto" aria-label="天使奶龙动画"></video>
      <h1>成功飞升天使奶龙</h1>
      <p class="dragon-win-copy">从 5×5 一路找到 13×13，<br />你已经把整片牧场都找遍了。</p>
      <div class="dragon-win-stats">
        <span><b>9</b> 关</span>
        <span><b>5→13</b> 棋盘</span>
        <span><b>100%</b> 唯一解</span>
      </div>
      ${preview ? `<div class="dragon-win-actions">
        <button class="dragon-btn" disabled>再闯一次</button>
        <button class="dragon-btn secondary" disabled>分享结果</button>
        <button class="dragon-btn secondary" disabled>复制双链接</button>
        <button class="dragon-btn ghost" disabled>退出本局</button>
      </div><p class="dragon-win-preview">预览模式</p>` : `<div class="dragon-win-actions">
        ${state?.canRestart ? '<button class="dragon-btn" data-action="restart">再闯一次</button>' : ''}
        <button class="dragon-btn secondary" data-action="share-result">分享结果</button>
        <button class="dragon-btn secondary" data-action="copy-links">复制双链接</button>
        <button class="dragon-btn ghost" data-action="exit">退出本局</button>
      </div>`}
    </section>
  </div>`;
}

function drawStar(ctx, x, y, radius, alpha, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.38;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function startStars() {
  stopStars();
  const canvas = document.querySelector('#dragon-stars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#e3a91b', '#ffd43b', '#f08bb4', '#9e7bdc', '#fff3b0', '#fffdf1'];
  starParticles = Array.from({ length: Math.min(180, Math.floor((width * height) / 7000)) }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: 2 + Math.random() * 4.2,
    speed: 0.55 + Math.random() * 1.5,
    drift: (Math.random() - 0.5) * 0.45,
    alpha: 0.55 + Math.random() * 0.45,
    phase: Math.random() * Math.PI * 2,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  let last = performance.now();
  function paint(delta) {
    ctx.clearRect(0, 0, width, height);
    for (const star of starParticles) {
      star.y += star.speed * delta;
      star.x += star.drift * delta;
      star.phase += 0.035 * delta;
      if (star.y > height + 30) {
        star.y = -30;
        star.x = Math.random() * width;
      }
      if (star.x < -30) star.x = width + 30;
      if (star.x > width + 30) star.x = -30;
      const alpha = star.alpha * (0.72 + Math.sin(star.phase) * 0.28);
      drawStar(ctx, star.x, star.y, star.r, alpha, star.color);
    }
  }
  paint(0);
  function frame(now) {
    const delta = Math.min(2.5, (now - last) / 16.67);
    last = now;
    paint(delta);
    starFrame = requestAnimationFrame(frame);
  }
  starFrame = requestAnimationFrame(frame);
}

function stopStars() {
  if (starFrame) cancelAnimationFrame(starFrame);
  starFrame = null;
  starParticles = [];
}

function showWin() {
  winShown = true;
  app.innerHTML = winTemplate(false);
  startStars();
}

function renderState() {
  if (!state) return;
  startPolling();
  if (campaignComplete()) {
    if (!winShown) showWin();
    return;
  }
  if (winShown) {
    winShown = false;
    stopStars();
  }
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
    : state.campaign
      ? '闯关完成'
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
    } else if (action === 'apply-custom-size') {
      const input = document.querySelector('[data-custom-size]');
      const size = Number(input?.value);
      if (!Number.isInteger(size) || size < 5 || size > 14) {
        toast('自定义边长只能是 5–14');
        return;
      }
      await saveSetting({ size });
    } else if (action === 'undo') {
      const data = await api('/api/dragon/undo', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'undo-hypo') {
      const data = await api('/api/dragon/undo-hypo', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'clear-dragons') {
      const data = await api('/api/dragon/clear-dragons', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'clear-x') {
      const data = await api('/api/dragon/clear-x', { code: session.code, playerId: session.playerId, token: session.token });
      state = data.state;
      renderState();
    } else if (action === 'toggle-auto') {
      const data = await api('/api/dragon/toggle-auto', {
        code: session.code,
        playerId: session.playerId,
        token: session.token,
        enabled: !state.autoExclude,
      });
      state = data.state;
      renderState();
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
  if (tool === 'x' && (current === 'dragon' || current === 'hypo')) return;
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
  if (value === 'dragon' || value === 'hypo') return;
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
  if (value === 'dragon' || value === 'hypo' || value === 'x') return;
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

async function saveSetting(values) {
  try {
    const data = await api('/api/dragon/settings', {
      code: session.code,
      playerId: session.playerId,
      token: session.token,
      ...values,
    });
    state = data.state;
    renderState();
  } catch (error) {
    toast(error.message);
  }
}

app.addEventListener('pointerdown', startDrag);
document.addEventListener('pointermove', moveDrag, { passive: false });
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

app.addEventListener('click', (event) => {
  if (suppressClick) return;
  const modeButton = event.target.closest('[data-mode-option]');
  if (modeButton) {
    saveSetting({ mode: modeButton.dataset.modeOption });
    return;
  }
  const sizeButton = event.target.closest('[data-size-option]');
  if (sizeButton) {
    const value = sizeButton.dataset.sizeOption;
    saveSetting({ size: value === 'campaign' ? 'campaign' : Number(value) });
    return;
  }
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
  if (params.get('preview') === 'win') {
    winShown = true;
    app.innerHTML = winTemplate(true);
    startStars();
    return;
  }
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
