'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const P = {
  room: null,
  creds: null,
  name: '',
  code: '',
  tab: 'create',
  role: 'player',
  busy: false,
  error: '',
  lines: [],
  char: '',
  order: [],
  used: [],
  orderKey: '',
  gaps: [],
  promptInput: '',
  clockOffset: 0,
  lastSig: null,
};

let pollTimer = null;
let draftTimer = null;
let toastCounter = 0;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstChar(value) {
  return Array.from(String(value || '?'))[0] || '?';
}

async function saveCharDraft(char) {
  if (!P.creds) return;
  try {
    await api('/api/poem/char/draft', { ...P.creds, char });
  } catch {
    // Draft saving is best-effort; submitting the char is authoritative.
  }
}

function showToast(message) {
  const region = $('#toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.id = `poem-toast-${++toastCounter}`;
  toast.textContent = String(message);
  region.append(toast);
  while (region.children.length > 3) region.firstElementChild.remove();
  window.setTimeout(() => {
    toast.classList.add('out');
    window.setTimeout(() => toast.remove(), 260);
  }, 2800);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || '连接失败，再试一次。');
  return data;
}

async function getState(code, playerId, token, role) {
  const query = new URLSearchParams({ code, playerId, token, role });
  const response = await fetch(`/api/poem/state?${query}`);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || '读取失败。');
  return data.state;
}

function sessionKey(code) { return `tongpin.poem.session.${String(code || '').toUpperCase()}`; }
function loadSession(code) {
  try { const raw = localStorage.getItem(sessionKey(code)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveSession(creds) { try { localStorage.setItem(sessionKey(creds.code), JSON.stringify(creds)); } catch {} }
function clearSession(code) { try { localStorage.removeItem(sessionKey(code)); } catch {} }

function signature(state) {
  const { serverNow, ...stable } = state;
  void serverNow;
  return JSON.stringify(stable);
}

function resetInputs() {
  P.lines = [];
  P.char = '';
  P.order = [];
  P.used = [];
  P.orderKey = '';
  P.gaps = [];
  P.promptInput = '';
}

function adopt(data) {
  P.creds = {
    code: data.code,
    playerId: data.playerId,
    token: data.token,
    role: data.role || data.state.role || 'player',
  };
  P.role = P.creds.role;
  P.code = data.code;
  P.name = data.state.viewer.name || P.name;
  P.room = data.state;
  P.error = '';
  P.busy = false;
  resetInputs();
  P.clockOffset = Number(data.state.serverNow) - Date.now();
  P.lastSig = signature(data.state);
  saveSession(P.creds);
  const url = P.role === 'spectator'
    ? `/poem?room=${encodeURIComponent(data.code)}&watch=1`
    : `/poem?room=${encodeURIComponent(data.code)}`;
  if (location.pathname + location.search !== url) history.replaceState(null, '', url);
  startPolling();
  render();
}

function applyState(state) {
  if (!state) return;
  const next = signature(state);
  if (next === P.lastSig) return;
  const previous = P.room;
  P.lastSig = next;
  P.room = state;
  P.clockOffset = Number(state.serverNow) - Date.now();
  if (previous && (previous.round !== state.round || previous.phase !== state.phase)) {
    P.lines = [];
    P.order = [];
    P.used = [];
    P.orderKey = '';
    P.gaps = [];
    P.promptInput = '';
  }
  if (state.phase === 'writing' && state.variant === 'acrostic' && P.lines.length !== Array.from(state.prompt || '').length) {
    P.lines = Array.from(state.prompt || '').map(() => '');
  }
  if (state.phase === 'writing' && state.variant === 'sentence') {
    const chars = (state.chars || []).map((item) => item.char || '？');
    const key = `${state.round}:${state.charToken}:${chars.join('')}`;
    if (P.orderKey !== key) {
      P.order = chars.map(() => null);
      P.used = [];
      P.orderKey = key;
      P.gaps = chars.slice(0, -1).map(() => '');
    }
  }
  render();
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(refresh, 1100);
}

async function refresh() {
  if (!P.creds) return;
  try {
    const state = await getState(P.creds.code, P.creds.playerId, P.creds.token, P.creds.role);
    applyState(state);
  } catch (error) {
    if (/不存在|失效|重新加入|结束/.test(error.message)) {
      window.clearInterval(pollTimer);
      pollTimer = null;
      clearSession(P.creds.code);
      P.creds = null;
      P.room = null;
      P.error = error.message;
      render();
    }
  }
}

function header(room) {
  return `<header class="poem-head">
    <a class="poem-brand" href="/" aria-label="同频首页">
      <span class="poem-seal">文</span>
      <span><b>同频</b><small>TONGPIN · 大文豪</small></span>
    </a>
    <div class="poem-head-right">
      ${room?.viewer?.isSpectator ? '<span class="poem-room-pill">观战</span>' : ''}
      <a href="/">← 返回首页</a>
      ${room ? `<button class="poem-room-pill" data-action="poem-copy-code">ROOM <b>${esc(room.code)}</b></button>` : ''}
    </div>
  </header>`;
}

function foot() {
  return `<footer class="poem-foot"><span>TONGPIN © 2026</span><span>大文豪 · 藏头诗 / 首尾造句</span></footer>`;
}

function invite(room) {
  return `<section class="poem-invite">
    <p class="eyebrow">INVITE / 入席</p>
    <h2>请君入墨</h2>
    <div class="poem-code-display">${Array.from(room.code).map((char) => `<span>${esc(char)}</span>`).join('')}</div>
    <div class="poem-invite-actions">
      <button class="btn btn-light" data-action="poem-copy-code">复制房间码</button>
      <button class="btn btn-outline-light" data-action="poem-copy-invite">邀请链接</button>
    </div>
    <button class="btn btn-outline-light poem-share-all" data-action="poem-copy-watch">复制观战链接</button>
    <button class="btn btn-light poem-share-all" data-action="poem-copy-share">一键复制邀请 + 观战</button>
    <p class="poem-invite-url">${esc(inviteUrl(room.code))}</p>
  </section>`;
}

function inviteUrl(code) { return `${location.origin}/poem?room=${encodeURIComponent(code)}`; }
function watchUrl(code) { return `${location.origin}/poem?room=${encodeURIComponent(code)}&watch=1`; }
function shareText(code) {
  return `🖋️ 大文豪对局\n房间码：${code}\n${inviteUrl(code)}\n\n👀 观战席\n房间码：${code}\n${watchUrl(code)}`;
}

function landing() {
  const join = P.tab === 'join';
  const watch = P.tab === 'watch';
  return `<div class="poem-shell">
    ${header(null)}
    <main class="poem-landing" id="main">
      <section class="poem-hero">
        <p class="eyebrow">大文豪 · 2–6 人</p>
        <h1>一本正经，<br /><em>胡说八道。</em></h1>
        <p>藏头诗，或者首尾造句。大家各出一个字，再把它补成一句像样的话。越离谱，越像大文豪。</p>
        <div class="poem-brush"><i></i><span>墨 / 诗 / 造句</span></div>
      </section>
      <section>
        <div class="poem-entry">
          <p class="eyebrow">START / JOIN</p>
          <h2>铺纸，落座。</h2>
          <div class="poem-tabs" role="tablist" aria-label="进入方式">
            <button data-action="poem-tab" data-tab="create" aria-selected="${!join && !watch}">开新局</button>
            <button data-action="poem-tab" data-tab="join" aria-selected="${join}">加入</button>
            <button data-action="poem-tab" data-tab="watch" aria-selected="${watch}">观战</button>
          </div>
          <form id="poem-entry-form" novalidate>
            <label class="field"><span class="field-label"><span>${watch ? '观战称呼' : '你的称呼'}</span><span>${watch ? '可留空' : '最多 12 字'}</span></span><input class="text-input" id="poem-name" maxlength="12" placeholder="${watch ? '不填就是「观众」' : '给自己起个名字'}" value="${esc(P.name)}" /></label>
            ${join || watch ? `<label class="field"><span class="field-label"><span>房间码</span><span>四位</span></span><input class="text-input code-input" id="poem-code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(P.code)}" /></label>` : ''}
            ${P.error ? `<p class="form-error" role="alert">${esc(P.error)}</p>` : ''}
            <button class="btn btn-primary" type="submit" ${P.busy ? 'disabled' : ''}>${P.busy ? '正在入席…' : join ? '加入这一局' : watch ? '进入观战' : '开一局'} ${P.busy ? '' : ARROW}</button>
          </form>
          <p class="poem-entry-foot">2–6 人 · 3 轮 · 双人不计分</p>
        </div>
      </section>
      <section class="poem-rules">
        <article><span>01 / 藏头诗</span><h3>每行藏一个字</h3><p>给定藏头词，几个字写几行；每行第一个字固定，后面随便编。</p></article>
        <article><span>02 / 首尾造句</span><h3>先出字，再排位</h3><p>每人先出一个字；所有人出完后，各自把字排到首、句中、尾，再补成一句话。</p></article>
      </section>
    </main>
    ${foot()}
  </div>`;
}

function player(player) {
  return `<div class="poem-player">
    <span class="poem-avatar" style="--color:${esc(player.color)}">${esc(firstChar(player.name))}</span>
    <div class="poem-player-main"><b>${esc(player.name)}${player.isYou ? '<em>你</em>' : ''}</b><span>${player.isHost ? '房主 / 出题人' : '诗人'}</span></div>
    <span class="poem-player-state ${player.submitted ? 'done' : ''}">${player.submitted ? '已交' : '构思中'}</span>
  </div>`;
}

function lobby(room) {
  const host = room.viewer.isHost;
  return `<div class="poem-shell">
    ${header(room)}
    <main class="poem-page" id="main">
      <div class="poem-page-head">
        <div><p class="eyebrow">LOBBY / 入席</p><h1 class="poem-title">人来齐了，<br /><em>就开始胡说。</em></h1><p class="poem-sub">2–6 人，3 轮。双人局不计分，只互相看作品。</p></div>
        <div class="poem-code-block"><span>ROOM</span><b>${esc(room.code)}</b></div>
      </div>
      <div class="poem-lobby-grid">
        <section class="poem-panel">
          <div class="poem-panel-head"><h2>选玩法</h2><span>${room.players.length} / ${room.maxPlayers}</span></div>
          <div class="poem-variant">
            <button data-action="poem-variant" data-variant="acrostic" aria-pressed="${room.variant === 'acrostic'}" ${!host ? 'disabled' : ''}><b>藏头诗</b><span>给定藏头词<br />每行一字，往下编</span></button>
            <button data-action="poem-variant" data-variant="sentence" aria-pressed="${room.variant === 'sentence'}" ${!host ? 'disabled' : ''}><b>首尾造句</b><span>每人先出一字<br />再排首/句中/尾造句</span></button>
          </div>
          <div class="poem-panel-head"><h2>入席</h2><span>${room.players.length} 人</span></div>
          <div class="poem-player-list">${room.players.map(player).join('')}</div>
          ${host ? `<button class="btn btn-primary poem-wide" data-action="poem-start" ${!room.canStart || P.busy ? 'disabled' : ''}>${P.busy ? '正在开局…' : room.canStart ? '开始第一轮' : '还差一位诗人'}</button>` : '<div class="poem-wait" style="padding:18px 0"><p>等房主开局…</p></div>'}
          <button class="crisis-text-link poem-wide" data-action="poem-leave">退出房间</button>
        </section>
        <aside class="poem-side">
          ${invite(room)}
          <section class="poem-mini"><p class="eyebrow">RULES / 规则</p><ul><li><b>藏头诗</b> 每行第一个字固定</li><li><b>首尾造句</b> 所有人先各出一个字</li><li><b>3 人以上</b> 投最好笑的一首</li><li><b>2 人</b> 不计分，直接互看</li></ul></section>
        </aside>
      </div>
    </main>
    ${foot()}
  </div>`;
}

function timer(room) {
  return `<div class="poem-timer"><span>TIME LEFT</span><b data-poem-countdown>—</b><em>SECONDS</em></div>`;
}

function progress(room, mode) {
  const isChars = mode === 'chars';
  const isVoting = mode === 'voting';
  const count = isVoting ? room.votedCount : room.submittedCount;
  const title = isChars ? '出字进度' : isVoting ? '投票进度' : '落笔进度';
  const waiting = isChars ? '想字中' : isVoting ? '待投票' : '写字中';
  const done = isVoting ? '已投' : '已交';
  return `<section class="poem-status">
    <div class="poem-panel-head"><h2>${title}</h2><span>${count} / ${room.players.length}</span></div>
    <div class="poem-status-list">${room.players.map((item) => {
      const complete = isVoting ? item.voted : item.submitted;
      return `<div class="poem-status-item"><span>${esc(item.name)}${item.isYou ? ' · 你' : ''}</span><b class="${complete ? 'done' : ''}">${complete ? done : waiting}</b></div>`;
    }).join('')}</div>
  </section>`;
}

function charsMarkup(room) {
  const viewer = room.viewer;
  return `<div class="poem-shell">
    ${header(room)}
    <main class="poem-page" id="main">
      <div class="poem-page-head">
        <div><p class="eyebrow">CHAR / 先出一个字</p><h1 class="poem-title">各写一字，<br /><em>再排成句。</em></h1><p class="poem-sub">20 秒内选一个字交上去。所有人交完后，公开这组字，再各自排位置造句。</p></div>
        ${timer(room)}
      </div>
      ${progress(room, 'chars')}
      ${viewer.isSpectator ? `<section class="poem-wait"><h2>看他们出什么字</h2><p>所有人出完字后，会公开这组字，再进入造句。</p></section>` : viewer.submitted ? `<section class="poem-wait"><h2>字已交出</h2><p>等其他人出完，一起看这组字。</p></section>` : `<section class="poem-form">
        <div class="poem-panel-head"><h2>你的一个字</h2><span>最多 1 字</span></div>
        <label class="field"><span class="field-label"><span>写一个字</span><span>待会儿要排进句子里</span></span><input class="text-input poem-char-input" id="poem-char" maxlength="1" value="${esc(P.char)}" placeholder="字" /></label>
        <p class="poem-form-tip">输入后会自动存档。20 秒内没提交，会使用最后一次存档；如果完全没填，系统会代填一个字并提示。</p>
        <button class="btn btn-primary" data-action="poem-submit-char" ${P.busy ? 'disabled' : ''}>${P.busy ? '正在落笔…' : '交出这个字'}</button>
      </section>`}
      ${restart(room)}
    </main>
    ${foot()}
  </div>`;
}

function acrosticMarkup(room) {
  const viewer = room.viewer;
  const chars = Array.from(room.prompt || '');
  if (P.lines.length !== chars.length) P.lines = chars.map(() => '');
  return `<div class="poem-shell">
    ${header(room)}
    <main class="poem-page" id="main">
      <div class="poem-page-head">
        <div><p class="eyebrow">ACROSTIC / 藏头诗</p><h1 class="poem-title">藏头词：<br /><em>${esc(room.prompt)}</em></h1><p class="poem-sub">${chars.length} 个字，写 ${chars.length} 行。每行第一个字已经给你了，后面越离谱越好。不限时。</p></div>
      </div>
      <div class="poem-paper"><p class="eyebrow">PROMPT / 本轮藏头</p><h2>${esc(room.prompt)}</h2><div class="poem-big-prompt">${chars.map((char) => `<span>${esc(char)}</span>`).join('')}</div></div>
      ${progress(room, 'writing')}
      ${viewer.isSpectator ? `<section class="poem-wait"><h2>看他们怎么编</h2><p>所有人提交后匿名展示，再投票。</p></section>` : viewer.submitted ? `<section class="poem-wait"><h2>诗已交</h2><p>等其他人落笔，随后匿名展示。</p></section>` : `<section class="poem-form">
        <div class="poem-panel-head"><h2>你的藏头诗</h2><span>${chars.length} 行</span></div>
        <div class="poem-lines">${chars.map((char, index) => `<label class="poem-line"><span class="poem-line-prefix">${esc(char)}</span><input data-poem-line="${index}" maxlength="36" value="${esc(P.lines[index] || '')}" placeholder="接着写…" /></label>`).join('')}</div>
        <p class="poem-form-tip">每行都要写。可以没有逻辑，最好押韵。提交后不能改。</p>
        <button class="btn btn-primary" data-action="poem-submit-acrostic" ${P.busy ? 'disabled' : ''}>${P.busy ? '正在落笔…' : '交出这首诗'}</button>
      </section>`}
      ${restart(room)}
    </main>
    ${foot()}
  </div>`;
}

function sentenceMarkup(room) {
  const viewer = room.viewer;
  const chars = (room.chars || []).map((item) => item.char || '？');
  const labels = ['首', ...chars.slice(1, -1).map((_, index) => `句中 ${index + 1}`), '尾'];
  const key = `${room.round}:${room.charToken}:${chars.join('')}`;
  if (P.orderKey !== key) {
    P.order = chars.map(() => null);
    P.used = [];
    P.orderKey = key;
    P.gaps = chars.slice(0, -1).map(() => '');
  }
  if (P.gaps.length !== chars.length - 1) P.gaps = chars.slice(0, -1).map(() => '');
  const complete = P.order.every(Boolean);
  const preview = P.order
    .map((char, index) => (char ? `${char}${P.gaps[index] || ''}` : ''))
    .join('');
  const gapCount = chars.length - 1;
  return `<div class="poem-shell">
    ${header(room)}
    <main class="poem-page" id="main">
      <div class="poem-page-head">
        <div><p class="eyebrow">SENTENCE / 首尾造句</p><h1 class="poem-title">这组字，<br /><em>你说了算。</em></h1><p class="poem-sub">先把下面的字按顺序点进上方空方框，再在两个方框之间的输入框里补中间内容。点已填入方框的字，所有字会退回重排。不限时。</p></div>
      </div>
      <div class="poem-paper"><p class="eyebrow">CHARS / 本组字</p><h2>${chars.map(esc).join(' · ')}</h2><div class="poem-big-prompt">${chars.map((char) => `<span>${esc(char)}</span>`).join('')}</div></div>
      ${room.autoFilled?.length ? `<p class="poem-form-tip" style="text-align:center">出字超时：${room.autoFilled.map((item) => `${esc(item.name)}「${esc(item.char)}」${item.source === 'draft' ? '（使用存档）' : '（系统代填）'}`).join('、')}</p>` : ''}
      ${progress(room, 'writing')}
      ${viewer.isSpectator ? `<section class="poem-wait"><h2>看他们怎么排</h2><p>所有人提交后匿名展示，再投票。</p></section>` : viewer.submitted ? `<section class="poem-wait"><h2>句子已交</h2><p>等其他人排完，随后匿名展示。</p></section>` : `<section class="poem-form">
        <div class="poem-panel-head"><h2>排位 + 造句</h2><span>${chars.length} 个字 / ${chars.length - 1} 段中间内容</span></div>
        <div class="poem-sentence-board">
          <div class="poem-sentence-picker">
            <div class="poem-sentence-sequence">
              ${chars.map((char, index) => `<button class="poem-char-slot${P.order[index] ? ' filled' : ''}" data-action="${P.order[index] ? 'poem-reset-order' : ''}" aria-label="${esc(labels[index])}${P.order[index] ? `：${esc(P.order[index])}` : '空方框'}"><span class="poem-char-slot-label">${esc(labels[index])}</span><b>${P.order[index] ? esc(P.order[index]) : ''}</b><i></i></button>${index < chars.length - 1 ? `<input class="poem-gap-input" data-poem-gap="${index}" maxlength="40" value="${esc(P.gaps[index] || '')}" placeholder="中间内容" />` : ''}`).join('')}
            </div>
            <div class="poem-source-row">${chars.map((char, index) => `<button class="poem-source-chip${P.used.includes(index) ? ' used' : ''}" data-action="poem-place-char" data-index="${index}" ${P.used.includes(index) ? 'disabled' : ''}>${esc(char)}</button>`).join('')}</div>
            <p class="poem-sentence-preview" data-poem-preview>${preview ? esc(preview) : '按顺序点字，再补中间内容'}</p>
          </div>
          <aside class="poem-sentence-guide">
            <p><b>①</b><span>先按顺序点下面的字，让它们依次进入上方空方框。</span></p>
            <p><b>②</b><span>再在方框之间的 ${gapCount} 个输入框里补中间内容；中间可以留空。</span></p>
          </aside>
        </div>
        <p class="poem-form-tip">先排字，再补内容；中间内容可以留空。点已填入方框的字可以全部退回。</p>
        <button class="btn btn-primary" data-action="poem-submit-sentence" ${P.busy || !complete ? 'disabled' : ''}>${P.busy ? '正在落笔…' : '交出这句话'}</button>
      </section>`}
      ${restart(room)}
    </main>
    ${foot()}
  </div>`;
}

function sentenceReady() {
  return P.order.length > 0 && P.order.every(Boolean);
}

function syncSentenceControls() {
  const button = document.querySelector('[data-action="poem-submit-sentence"]');
  if (button) button.disabled = P.busy || !sentenceReady();
  const preview = document.querySelector('[data-poem-preview]');
  if (preview) {
    const text = P.order
      .map((char, index) => (char ? `${char}${P.gaps[index] || ''}` : ''))
      .join('');
    preview.textContent = text || '按顺序点字，再补中间内容';
  }
}

function poemCard(item, room, reveal = false) {
  const lines = item.lines || [];
  const order = item.order || [];
  const chars = (room.chars || []).map((entry) => entry.char || '？');
  const labels = ['首', ...chars.slice(1, -1).map((_, index) => `句中 ${index + 1}`), '尾'];
  const topVotes = Math.max(0, ...((room.result?.entries || []).map((entry) => entry.votes || 0)));
  const isWinner = reveal && !room.isCoop && topVotes > 0 && item.votes === topVotes;
  return `<article class="poem-card${item.isYou ? ' is-you' : ''}${isWinner ? ' is-winner' : ''}">
    <div class="poem-card-head"><span>${reveal ? esc(item.author || item.name || '佚名') : esc(item.label || '匿名作品')}</span><span>${reveal ? (room.isCoop ? '双人局' : `${item.votes || 0} 票`) : item.isYou ? '你的' : '匿名'}</span></div>
    ${room.variant === 'acrostic' ? `<h3>${esc(room.prompt)}</h3><div class="poem-card-lines">${lines.map((line, index) => `<p><b>${esc(Array.from(room.prompt)[index] || '')}</b>${esc(line)}</p>`).join('')}</div>` : `<div class="poem-card-order">${order.map((char, index) => `<span>${esc(labels[index] || '句')}：<b>${esc(char)}</b></span>`).join('')}</div><p class="poem-card-sentence">${esc(item.text)}</p>`}
    ${!reveal && !room.viewer.isSpectator && !item.isYou && !room.viewer.voted ? `<button class="btn btn-primary poem-vote-btn" data-action="poem-vote" data-id="${esc(item.id)}">投这首</button>` : ''}
  </article>`;
}

function votingMarkup(room) {
  return `<div class="poem-shell">
    ${header(room)}
    <main class="poem-page" id="main">
      <div class="poem-page-head">
        <div><p class="eyebrow">VOTE / 匿名投票</p><h1 class="poem-title">哪一首，<br /><em>最像大文豪？</em></h1><p class="poem-sub">${room.viewer.isSpectator ? '你在观战。所有人投完后揭晓。' : '不能投自己。每人一票，投最好笑的一首。不限时。'}</p></div>
      </div>
      ${progress(room, 'voting')}
      <div class="poem-cards">${room.poems.map((item) => poemCard(item, room)).join('')}</div>
      ${!room.viewer.isSpectator && room.viewer.voted ? '<p class="poem-form-tip" style="text-align:center;margin-top:15px">已投，等其他人…</p>' : ''}
      ${restart(room)}
    </main>
    ${foot()}
  </div>`;
}

function exportText(room) {
  const lines = ['大文豪 · 对局记录', '════════════════════════', `房间：${room.code}`, `玩法：${room.variant === 'acrostic' ? '藏头诗' : '首尾造句'}`, `导出：${new Date().toLocaleString('zh-CN', { hour12: false })}`, '════════════════════════'];
  for (const result of room.history) {
    lines.push('', `【第 ${result.round} 轮】`);
    if (result.variant === 'acrostic') lines.push(`藏头词：${result.prompt}`);
    else lines.push(`本组字：${(result.chars || []).join(' · ')}`);
    for (const entry of result.entries) {
      lines.push('────────────────────────────', `${entry.name}`);
      if (result.variant === 'acrostic') {
        (entry.lines || []).forEach((line, index) => lines.push(`  ${Array.from(result.prompt)[index] || ''}${line}`));
      } else {
        lines.push(`  位置：${(entry.order || []).join(' / ')}`);
        lines.push(`  句子：${entry.text}`);
      }
      lines.push(result.isCoop ? '  双人局：不计分' : `  得票：${entry.votes} 票`);
    }
    if (!result.isCoop) {
      lines.push('', '本轮排名：');
      [...result.entries].sort((a, b) => b.votes - a.votes).forEach((entry, index) => lines.push(`  ${index + 1}. ${entry.name} — ${entry.votes} 票`));
    }
  }
  lines.push('', '════════════════════════');
  if (!room.scores.length) lines.push('双人局不计分');
  else {
    lines.push(room.history.some((item) => item.isFinal) ? '最终排名' : '当前累计', '════════════════════════');
    room.scores.forEach((score, index) => lines.push(`${index + 1}. ${score.name} — ${score.score} 票`));
  }
  return lines.join('\n');
}

function revealMarkup(room) {
  const result = room.result;
  const coop = Boolean(result.isCoop);
  const nextChooser = room.players.find((item) => item.id === room.promptChooserId);
  const coopNext = result.isFinal
    ? '双人局不计分，只互相看作品。'
    : `双人局不计分，下一轮轮到 ${nextChooser?.name || '对方'} 出题。`;
  return `<div class="poem-shell">
    ${header(room)}
    <main class="poem-page" id="main">
      <div class="poem-page-head">
        <div><p class="eyebrow">${result.isFinal ? 'FINAL / 三轮结束' : 'REVEAL / 本轮揭晓'}</p><h1 class="poem-title">${coop ? '这一轮，<br /><em>看看对方怎么写。</em>' : '本轮大文豪，<br /><em>是谁？</em>'}</h1><p class="poem-sub">${coop ? coopNext : result.variant === 'acrostic' ? '本轮第一名指定下一轮藏头词。' : '房主可以开下一轮。'}</p></div>
      </div>
      <div class="poem-paper"><p class="eyebrow">${result.variant === 'acrostic' ? 'ACROSTIC / 藏头诗' : 'SENTENCE / 首尾造句'}</p><h2>${result.variant === 'acrostic' ? esc(result.prompt) : (result.chars || []).join(' · ')}</h2></div>
      <div class="poem-cards" style="margin-top:15px">${result.entries.map((item) => poemCard(item, room, true)).join('')}</div>
      ${!coop ? `<section class="poem-score"><h2>${result.isFinal ? '最终排名' : '当前累计'}</h2>${room.scores.map((score, index) => `<div class="poem-score-row"><span>${index + 1}. ${esc(score.name)}</span><b>${score.score} 票</b></div>`).join('')}</section>` : ''}
      ${!room.viewer.isSpectator && room.viewer.canChoosePrompt ? `<div class="poem-next"><p>你成了本轮大文豪。指定下一轮藏头词：</p><form class="poem-next-form" id="poem-next-form"><input id="poem-next-prompt" maxlength="4" value="${esc(P.promptInput)}" placeholder="2–4 个字" /><button class="btn btn-primary" type="submit">接龙</button></form></div>` : ''}
      ${!room.viewer.isSpectator && room.canNext ? `<div class="poem-next"><p>下一轮重新出字。</p><button class="btn btn-primary" data-action="poem-next">下一轮</button></div>` : ''}
      ${!room.viewer.isSpectator && room.canRestart ? `<div class="poem-next"><p>三轮结束，可以重开一局。</p><button class="btn btn-primary" data-action="poem-restart">重开一局</button></div>` : ''}
      ${room.viewer.isSpectator ? '<p class="poem-form-tip" style="text-align:center;margin-top:15px">你在观战。房主决定是否继续。</p>' : ''}
      <div class="poem-export"><button class="btn btn-soft" data-action="poem-export">导出对局数据</button><span>复制所有已完成轮次</span></div>
      ${restart(room)}
    </main>
    ${foot()}
  </div>`;
}

function restart(room) {
  if (room.phase === 'lobby' || !room.viewer.isHost) return '';
  return `<div class="poem-restart"><span>想重来？</span><button data-action="poem-restart">重开本局</button></div>`;
}

function render() {
  const app = $('#app');
  if (!app) return;
  if (!P.room) {
    app.innerHTML = landing();
    return;
  }
  if (P.room.phase === 'lobby') app.innerHTML = lobby(P.room);
  else if (P.room.phase === 'chars') app.innerHTML = charsMarkup(P.room);
  else if (P.room.phase === 'voting') app.innerHTML = votingMarkup(P.room);
  else if (P.room.phase === 'reveal') app.innerHTML = revealMarkup(P.room);
  else if (P.room.variant === 'sentence') app.innerHTML = sentenceMarkup(P.room);
  else app.innerHTML = acrosticMarkup(P.room);
  updateTimer();
}

function updateTimer() {
  if (!P.room?.phaseEndsAt) return;
  const remaining = Math.max(0, Math.ceil((P.room.phaseEndsAt - (Date.now() + P.clockOffset)) / 1000));
  for (const node of $$('[data-poem-countdown]')) node.textContent = String(remaining);
}

window.setInterval(updateTimer, 500);

async function submitEntry() {
  if (P.busy) return;
  const name = String($('#poem-name')?.value || P.name || '').trim() || (P.tab === 'watch' ? '观众' : '');
  const code = String($('#poem-code')?.value || P.code || '').trim().toUpperCase();
  if (!name) { P.error = '先给自己起个名字。'; render(); return; }
  if ((P.tab === 'join' || P.tab === 'watch') && !/^[A-Z0-9]{4}$/.test(code)) {
    P.error = '房间码是四位字母或数字。'; render(); return;
  }
  P.name = name;
  P.code = code;
  P.error = '';
  P.busy = true;
  render();
  try {
    const path = P.tab === 'watch' ? '/api/poem/spectate' : P.tab === 'join' ? '/api/poem/join' : '/api/poem/rooms';
    adopt(await api(path, { name, code }));
  } catch (error) {
    P.busy = false;
    P.error = error.message;
    render();
  }
}

async function action(path, body) {
  if (P.busy) return;
  P.busy = true;
  render();
  try {
    const data = await api(path, { ...P.creds, ...body });
    P.busy = false;
    if (data.state) applyState(data.state);
    else await refresh();
  } catch (error) {
    P.busy = false;
    showToast(error.message);
    render();
  }
}

function copy(text, message) {
  if (!text) return;
  const done = () => showToast(message);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    done();
  } catch { showToast('复制失败，请手动复制。'); }
}

document.addEventListener('submit', (event) => {
  if (event.target.id === 'poem-entry-form') {
    event.preventDefault();
    submitEntry();
  }
  if (event.target.id === 'poem-next-form') {
    event.preventDefault();
    action('/api/poem/prompt', { prompt: P.promptInput });
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'poem-name') P.name = event.target.value;
  if (event.target.id === 'poem-code') P.code = event.target.value.toUpperCase();
  if (event.target.id === 'poem-char') {
    P.char = event.target.value.slice(0, 1);
    if (draftTimer) window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => saveCharDraft(P.char), 500);
  }
  if (event.target.dataset.poemGap !== undefined) {
    P.gaps[Number(event.target.dataset.poemGap)] = event.target.value.slice(0, 40);
    syncSentenceControls();
  }
  if (event.target.id === 'poem-next-prompt') P.promptInput = event.target.value.slice(0, 4);
  if (event.target.dataset.poemLine !== undefined) {
    P.lines[Number(event.target.dataset.poemLine)] = event.target.value.slice(0, 36);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.dataset.poemOrder !== undefined) {
    P.order[Number(event.target.dataset.poemOrder)] = event.target.value;
  }
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const name = target.dataset.action;
  if (name === 'poem-tab') {
    event.preventDefault();
    P.tab = ['join', 'watch'].includes(target.dataset.tab) ? target.dataset.tab : 'create';
    P.error = '';
    render();
  } else if (name === 'poem-variant') {
    event.preventDefault();
    action('/api/poem/variant', { variant: target.dataset.variant });
  } else if (name === 'poem-start') {
    event.preventDefault();
    action('/api/poem/start', {});
  } else if (name === 'poem-submit-char') {
    event.preventDefault();
    action('/api/poem/char', { char: P.char });
  } else if (name === 'poem-submit-acrostic') {
    event.preventDefault();
    action('/api/poem/submit', { variant: 'acrostic', lines: P.lines });
  } else if (name === 'poem-place-char') {
    event.preventDefault();
    const chipIndex = Number(target.dataset.index);
    const chars = (P.room?.chars || []).map((item) => item.char || '？');
    if (!Number.isInteger(chipIndex) || !chars[chipIndex] || P.used.includes(chipIndex)) return;
    const slot = P.order.findIndex((value) => !value);
    if (slot < 0) return;
    P.order[slot] = chars[chipIndex];
    P.used.push(chipIndex);
    render();
  } else if (name === 'poem-reset-order') {
    event.preventDefault();
    P.order = P.order.map(() => null);
    P.used = [];
    render();
  } else if (name === 'poem-submit-sentence') {
    event.preventDefault();
    if (P.order.some((value) => !value)) {
      showToast('先把所有字放进方框。');
      return;
    }
    const hasEmptyGap = P.gaps.some((gap) => !gap.trim());
    if (hasEmptyGap && !window.confirm('还有输入框没填，确定要这样提交吗？提交后不能修改。')) {
      return;
    }
    const sentence = P.order.map((char, index) => `${char}${P.gaps[index] || ''}`).join('');
    action('/api/poem/submit', { variant: 'sentence', order: [...P.order], text: sentence });
  } else if (name === 'poem-vote') {
    event.preventDefault();
    action('/api/poem/vote', { targetId: target.dataset.id });
  } else if (name === 'poem-next') {
    event.preventDefault();
    action('/api/poem/next', {});
  } else if (name === 'poem-restart') {
    event.preventDefault();
    if (!P.room?.viewer.isHost) return;
    if (window.confirm('重开会清空本局记录，玩家和观战者保留。确定吗？')) action('/api/poem/restart', {});
  } else if (name === 'poem-export') {
    event.preventDefault();
    if (P.room?.history?.length) copy(exportText(P.room), '对局数据已复制');
  } else if (name === 'poem-copy-code' && P.room) {
    event.preventDefault();
    copy(P.room.code, '房间码已复制');
  } else if (name === 'poem-copy-invite' && P.room) {
    event.preventDefault();
    copy(inviteUrl(P.room.code), '邀请链接已复制');
  } else if (name === 'poem-copy-watch' && P.room) {
    event.preventDefault();
    copy(watchUrl(P.room.code), '观战链接已复制');
  } else if (name === 'poem-copy-share' && P.room) {
    event.preventDefault();
    copy(shareText(P.room.code), '邀请和观战链接已一起复制');
  } else if (name === 'poem-leave') {
    event.preventDefault();
    leave();
  }
});

function leave() {
  if (!P.creds) return;
  const creds = P.creds;
  const role = P.role;
  if (pollTimer) window.clearInterval(pollTimer);
  clearSession(creds.code);
  P.creds = null;
  P.room = null;
  P.code = '';
  P.role = 'player';
  if (location.pathname !== '/poem') history.replaceState(null, '', '/poem');
  render();
  api(role === 'spectator' ? '/api/poem/spectate/leave' : '/api/poem/leave', creds).catch(() => {});
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const code = String(params.get('room') || '').trim().toUpperCase();
  const watch = params.get('watch') === '1';
  if (code) {
    P.code = code;
    P.tab = watch ? 'watch' : 'join';
    P.role = watch ? 'spectator' : 'player';
    const saved = loadSession(code);
    if (saved && saved.playerId && saved.token && (!watch || saved.role === 'spectator')) {
      P.creds = { ...saved, code };
      P.name = saved.name || P.name;
      try {
        adopt(await api('/api/poem/rejoin', P.creds));
        return;
      } catch (error) {
        P.error = error.message;
      }
    }
  }
  render();
}

boot();
