'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ICON_ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const C = {
  room: null,
  creds: null,
  name: '',
  code: '',
  tab: 'create',
  role: 'player',
  busy: false,
  error: '',
  proposalText: '',
  rating: { credibility: 3, execution: 3, creativity: 3 },
  autoSubmitted: false,
  clockOffset: 0,
  lastSig: null,
};

let pollTimer = null;
let toastCounter = 0;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstChar(value) {
  return Array.from(String(value || '?'))[0] || '?';
}

function countChars(value) {
  return Array.from(String(value || '')).length;
}

function showToast(message) {
  const region = $('#toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.id = `crisis-toast-${++toastCounter}`;
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
  try {
    data = await response.json();
  } catch {
    // Ignore.
  }
  if (!response.ok) throw new Error(data.error || '连接失败，再试一次。');
  return data;
}

async function getState(code, playerId, token, role) {
  const query = new URLSearchParams({ code, playerId, token, role });
  const response = await fetch(`/api/crisis/state?${query}`);
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Ignore.
  }
  if (!response.ok) throw new Error(data.error || '读取失败。');
  return data.state;
}

function sessionKey(code) {
  return `tongpin.crisis.session.${String(code || '').toUpperCase()}`;
}

function loadSession(code) {
  try {
    const raw = localStorage.getItem(sessionKey(code));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(creds) {
  try {
    localStorage.setItem(sessionKey(creds.code), JSON.stringify(creds));
  } catch {
    // Ignore.
  }
}

function clearSession(code) {
  try {
    localStorage.removeItem(sessionKey(code));
  } catch {
    // Ignore.
  }
}

function stateSignature(state) {
  const { serverNow, ...stable } = state;
  void serverNow;
  return JSON.stringify(stable);
}

function adopt(data) {
  C.creds = {
    code: data.code,
    playerId: data.playerId,
    token: data.token,
    role: data.role || data.state.role || 'player',
  };
  C.role = C.creds.role;
  C.code = data.code;
  C.name = data.state.viewer.name || C.name;
  C.room = data.state;
  C.error = '';
  C.proposalText = '';
  C.rating = { credibility: 3, execution: 3, creativity: 3 };
  C.autoSubmitted = false;
  C.clockOffset = Number(data.state.serverNow) - Date.now();
  C.lastSig = stateSignature(data.state);
  saveSession(C.creds);
  const url =
    C.role === 'spectator'
      ? `/crisis?room=${encodeURIComponent(data.code)}&watch=1`
      : `/crisis?room=${encodeURIComponent(data.code)}`;
  if (location.pathname + location.search !== url) history.replaceState(null, '', url);
  startPolling();
  render();
}

function applyState(state) {
  if (!state) return;
  const signature = stateSignature(state);
  if (signature === C.lastSig) return;
  const previous = C.room;
  C.lastSig = signature;
  C.room = state;
  C.clockOffset = Number(state.serverNow) - Date.now();
  if (
    previous &&
    (previous.round !== state.round || (previous.phase !== 'writing' && state.phase === 'writing'))
  ) {
    C.proposalText = '';
    C.rating = { credibility: 3, execution: 3, creativity: 3 };
    C.autoSubmitted = false;
  }
  render();
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(refresh, 1200);
}

async function refresh() {
  if (!C.creds) return;
  try {
    const state = await getState(
      C.creds.code,
      C.creds.playerId,
      C.creds.token,
      C.creds.role,
    );
    applyState(state);
  } catch (error) {
    if (/不存在|失效|重新加入|结束/.test(error.message)) {
      window.clearInterval(pollTimer);
      pollTimer = null;
      clearSession(C.creds.code);
      C.creds = null;
      C.room = null;
      C.error = error.message;
      render();
    }
  }
}

function headerMarkup(room) {
  return `<header class="crisis-head">
    <a class="crisis-brand" href="/" aria-label="同频首页">
      <span class="crisis-brand-mark" aria-hidden="true"><i></i><i></i></span>
      <span class="crisis-brand-word">同频<small>TONGPIN</small></span>
      <span class="crisis-mode-tag">危机公关</span>
    </a>
    <div class="crisis-head-tools">
      ${room?.viewer?.isSpectator ? '<span class="crisis-watch-badge">观战</span>' : ''}
      <a href="/">← 返回首页</a>
      ${room ? `<button class="crisis-room-pill" data-action="crisis-copy-code"><span>ROOM</span> <b>${esc(room.code)}</b></button>` : ''}
    </div>
  </header>`;
}

function footMarkup() {
  return `<footer class="crisis-foot"><span>TONGPIN © 2026</span><span>危机公关 · 先处理，再解释</span></footer>`;
}

function landingMarkup() {
  const isJoin = C.tab === 'join';
  const isWatch = C.tab === 'watch';
  const needsCode = isJoin || isWatch;
  return `<div class="crisis-shell">
    ${headerMarkup(null)}
    <main class="crisis-landing" id="main">
      <section class="crisis-hero">
        <p class="eyebrow">CRISIS PR · 2—6 人</p>
        <h1>先别解释，<br /><span>先提案。</span></h1>
        <p class="crisis-lede">一场危机，所有人都是公关团队。写一句话、一份声明、一个补救动作，匿名投票。3 轮后，谁的提案最想被执行？</p>
        <div class="crisis-hero-stats"><span>2–6 人</span><i>·</i><span>3 轮</span><i>·</i><span>全文字</span><i>·</i><span>可观战</span></div>
        <div class="crisis-score-teaser"><span>2 人局：</span><b>不计分，直接看提案</b><span>3 人以上：匿名投票</span></div>
      </section>
      <section>
        <div class="crisis-entry-card">
          <p class="eyebrow">START / JOIN</p>
          <h2>这场危机，谁来处理？</h2>
          <div class="crisis-segmented" role="tablist" aria-label="进入方式">
            <button data-action="crisis-tab" data-tab="create" aria-selected="${!isJoin && !isWatch}">开新对局</button>
            <button data-action="crisis-tab" data-tab="join" aria-selected="${isJoin}">加入对局</button>
            <button data-action="crisis-tab" data-tab="watch" aria-selected="${isWatch}">观战</button>
          </div>
          <form id="crisis-entry-form" novalidate>
            <label class="field"><span class="field-label"><span>${isWatch ? '观战称呼' : '你的称呼'}</span><span>${isWatch ? '可留空' : '最多 12 字'}</span></span><input class="text-input" id="crisis-name" maxlength="12" placeholder="${isWatch ? '不填就是「观众」' : '给自己起个名字'}" value="${esc(C.name)}" ${C.busy ? 'disabled' : ''} /></label>
            ${needsCode ? `<label class="field"><span class="field-label"><span>房间码</span><span>四位</span></span><input class="text-input code-input" id="crisis-code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(C.code)}" ${C.busy ? 'disabled' : ''} /></label>` : ''}
            ${C.error ? `<p class="form-error" role="alert">${esc(C.error)}</p>` : ''}
            <button class="btn btn-primary crisis-submit" type="submit" ${C.busy ? 'disabled' : ''}>${C.busy ? '正在连接…' : isJoin ? '加入对局' : isWatch ? '进入观战' : '开一个房间'} ${C.busy ? '' : ICON_ARROW}</button>
          </form>
          <p class="crisis-entry-foot">2–6 人 · 3 轮 · 观战不占玩家位</p>
        </div>
      </section>
      <section class="crisis-rules">
        <article><span>01 / CRISIS</span><h3>发危机</h3><p>每轮一张公共危机卡，所有人看到的信息一样。</p></article>
        <article><span>02 / PROPOSE</span><h3>写提案</h3><p>用一段话写你的公关方案，不限时。</p></article>
        <article><span>03 / VOTE</span><h3>匿名投票</h3><p>3 人以上投别人；2 人局不计分。</p></article>
        <article><span>04 / SCORE</span><h3>三轮结算</h3><p>每轮累计分数，3 轮后最高者胜出。</p></article>
      </section>
    </main>
    ${footMarkup()}
  </div>`;
}

function crisisCard(crisis) {
  return `<section class="crisis-crisis-card">
    <p class="eyebrow">BREAKING / 本轮危机</p>
    <h2>${esc(crisis.title)}</h2>
    <ul class="crisis-facts">${crisis.facts.map((fact) => `<li>${esc(fact)}</li>`).join('')}</ul>
    <span class="crisis-heat">${esc(crisis.heat)}</span>
  </section>`;
}

function playerMarkup(player) {
  return `<div class="crisis-player">
    <span class="crisis-avatar" style="--soft:${esc(player.softColor)};--color:${esc(player.color)}">${esc(firstChar(player.name))}</span>
    <div class="crisis-player-main"><b>${esc(player.name)}${player.isYou ? '<em>你</em>' : ''}</b><span>${player.isHost ? '房主' : '公关团队'}</span></div>
    <span class="crisis-player-state">${player.submitted ? '已提案' : '写提案中'}</span>
  </div>`;
}

function inviteMarkup(room) {
  return `<section class="crisis-invite">
    <p class="eyebrow on-dark">INVITE / 邀请</p>
    <h2>叫人来开会</h2>
    <div class="crisis-code-display">${Array.from(room.code).map((char) => `<span>${esc(char)}</span>`).join('')}</div>
    <div class="crisis-invite-actions">
      <button class="btn btn-light" data-action="crisis-copy-code">复制房间码</button>
      <button class="btn btn-outline-light" data-action="crisis-copy-invite">邀请链接</button>
      <button class="btn btn-outline-light" data-action="crisis-copy-watch">观战链接</button>
    </div>
    <button class="btn btn-light crisis-share-all" data-action="crisis-copy-share">一键复制两个邀请码</button>
    <p class="crisis-invite-url">${esc(inviteUrl(room.code))}</p>
  </section>`;
}

function inviteUrl(code) {
  return `${location.origin}/crisis?room=${encodeURIComponent(code)}`;
}

function watchUrl(code) {
  return `${location.origin}/crisis?room=${encodeURIComponent(code)}&watch=1`;
}

function shareMessage(code) {
  return `🎯 危机公关对局\n房间码：${code}\n${inviteUrl(code)}\n\n👀 观战席\n房间码：${code}\n${watchUrl(code)}`;
}

function lobbyMarkup(room) {
  const isHost = room.viewer.isHost;
  return `<div class="crisis-shell">
    ${headerMarkup(room)}
    <main class="crisis-page" id="main">
      <div class="crisis-page-head">
        <div><p class="eyebrow">LOBBY / 准备开会</p><h1 class="crisis-title">人都到了，<br /><span>就开始公关。</span></h1><p class="crisis-sub">2–6 人，3 轮。所有人都是公关团队，没有品牌方。每轮写提案，匿名投票。</p></div>
        <div class="crisis-code-block"><span>ROOM CODE</span><b>${esc(room.code)}</b></div>
      </div>
      <div class="crisis-lobby-grid">
        <section class="crisis-panel">
          <div class="crisis-panel-head"><h2>入座</h2><span>${room.players.length} / ${room.maxPlayers}</span></div>
          <div class="crisis-player-list">${room.players.map(playerMarkup).join('')}</div>
          <div class="crisis-wait-button">${room.spectatorCount ? `${room.spectatorCount} 位观战者` : '还没有观战者'}</div>
          ${isHost ? `<button class="btn btn-primary crisis-wide" data-action="crisis-start" ${!room.canStart || C.busy ? 'disabled' : ''}>${C.busy ? '正在开始…' : room.canStart ? '开始第一轮' : '还差一位玩家'}</button>` : '<div class="crisis-wait-button">等房主开始…</div>'}
          <button class="crisis-text-link" data-action="crisis-leave">退出房间</button>
        </section>
        <aside class="crisis-side">
          ${inviteMarkup(room)}
          <section class="crisis-mini-rules"><p class="eyebrow">HOW / 一轮怎么走</p><ul><li><b>不限时</b> 写一段提案</li><li><b>全部提交</b> 后匿名亮出</li><li><b>3 人以上</b> 投别人一票</li><li><b>2 人</b> 不计分，直接互看</li></ul></section>
        </aside>
      </div>
    </main>
    ${footMarkup()}
  </div>`;
}

function progressMarkup(room, mode) {
  const isWriting = mode === 'writing';
  const count = isWriting ? room.submittedCount : room.votedCount;
  const label = isWriting ? '提案进度' : room.ratingMode ? '互评进度' : '投票进度';
  return `<section class="crisis-status-card">
    <div class="crisis-panel-head"><h2>${label}</h2><span>${count} / ${room.players.length}</span></div>
    <div class="crisis-status-list">
      ${room.players
        .map((player) => {
          const done = isWriting ? player.submitted : player.voted;
          const waiting = isWriting ? '写提案中' : room.ratingMode ? '待互评' : '待投票';
          return `<div class="crisis-status-item"><span>${esc(player.name)}${player.isYou ? ' · 你' : ''}</span><b class="${done ? 'done' : ''}">${done ? (isWriting ? '已提交' : '已完成') : waiting}</b></div>`;
        })
        .join('')}
    </div>
    ${room.viewer.isSpectator ? '<p class="crisis-form-tip">观战视角：可以看进度，不能操作。</p>' : ''}
  </section>`;
}

function writingMarkup(room) {
  const viewer = room.viewer;
  const isSpectator = viewer.isSpectator;
  const submitted = viewer.submitted;
  const isCoop = room.players.length === 2;
  return `<div class="crisis-shell">
    ${headerMarkup(room)}
    <main class="crisis-page" id="main">
      <div class="crisis-round-line"><span>ROUND ${room.round} / ${room.totalRounds}</span><i></i><span>${isSpectator ? '观战' : submitted ? '已提交' : '写提案中'}</span></div>
      <div class="crisis-page-head">
        <div><p class="eyebrow">PROPOSE / 写提案</p><h1 class="crisis-title">先处理，<br /><span>再解释。</span></h1><p class="crisis-sub">${isSpectator ? (isCoop ? '你在观战。双方提交后直接揭晓。' : '你在观战。玩家提交后，所有提案会匿名展示。') : isCoop ? '用一段话写你的公关方案。双人局不计分，全部提交后直接看对方怎么写。' : '用一段话写你的公关方案。不限时，全部提交后自动进入匿名投票。'}</p></div>
      </div>
      ${crisisCard(room.crisis)}
      ${room.canReroll ? `<div class="crisis-reroll-row"><button class="btn btn-soft" data-action="crisis-reroll">换一个危机</button><span>还没人提交，可以继续换</span></div>` : ''}
      ${progressMarkup(room, 'writing')}
      ${isSpectator ? `<section class="crisis-wait-card"><h2>看他们怎么处理</h2><p>${isCoop ? '双方提交后直接揭晓。' : '所有提案提交后，会匿名展示，然后进入投票。'}</p></section>` : submitted ? `<section class="crisis-wait-card"><h2>提案已提交</h2><p>${isCoop ? '等对方写完，直接揭晓双方提案。' : '等其他人写完，所有方案会匿名亮出。'}</p></section>` : `<section class="crisis-proposal-form">
        <div class="crisis-panel-head"><h2>你的提案</h2><span>${room.players.length} 家公关团队</span></div>
        <label class="field"><span class="field-label"><span>写一段公关方案</span><span>最多 400 字</span></span><textarea class="guess-textarea crisis-proposal-textarea" id="crisis-proposal" maxlength="400" rows="7" placeholder="比如：先停业并公开后厨监控，所有受影响顾客全额退款，三天内给出完整整改清单。">${esc(C.proposalText)}</textarea></label>
        <p class="crisis-form-tip">提交后不能修改。${isCoop ? '双人局提交后直接揭晓，不计分。' : '全部提交后进入匿名投票。'}</p>
        <button class="btn btn-primary crisis-wide" data-action="crisis-submit-proposal" ${C.busy ? 'disabled' : ''}>${C.busy ? '正在提交…' : '提交提案'}</button>
      </section>`}
      ${restartMarkup(room)}
    </main>
    ${footMarkup()}
  </div>`;
}

function votingMarkup(room) {
  const viewer = room.viewer;
  const isSpectator = viewer.isSpectator;
  const ratingMode = room.ratingMode;
  const proposals = room.proposals;
  return `<div class="crisis-shell">
    ${headerMarkup(room)}
    <main class="crisis-page" id="main">
      <div class="crisis-round-line"><span>ROUND ${room.round} / ${room.totalRounds}</span><i></i><span>${isSpectator ? '观战' : viewer.voted ? '已完成' : ratingMode ? '互评中' : '投票中'}</span></div>
      <div class="crisis-page-head">
        <div><p class="eyebrow">${ratingMode ? 'RATING / 互相评分' : 'VOTE / 匿名投票'}</p><h1 class="crisis-title">${ratingMode ? '给对方的三项，<br /><span>各打 1–5 分。</span>' : '哪份提案，<br /><span>你最想执行？</span>'}</h1><p class="crisis-sub">${isSpectator ? '你在观战。所有人提交后公布作者和得分。' : ratingMode ? '不能给自己打分。三项分数相加，成为对方本轮得分；不限时。' : '不能投自己。每人一票，票数就是本轮得分；不限时。'}</p></div>
      </div>
      ${crisisCard(room.crisis)}
      ${progressMarkup(room, 'voting')}
      <div class="crisis-proposals">${proposals.map((proposal) => proposalMarkup(proposal, room)).join('')}</div>
      ${!isSpectator && !viewer.voted && ratingMode ? `<button class="btn btn-primary crisis-wide" data-action="crisis-submit-rating" ${C.busy ? 'disabled' : ''}>${C.busy ? '正在提交…' : '提交互评'}</button>` : ''}
      ${!isSpectator && viewer.voted ? '<p class="crisis-form-tip" style="text-align:center;margin-top:16px">已提交，等其他人…</p>' : ''}
      ${restartMarkup(room)}
    </main>
    ${footMarkup()}
  </div>`;
}

function proposalMarkup(proposal, room) {
  const isSpectator = room.viewer.isSpectator;
  const ratingMode = room.ratingMode;
  const canVote = !isSpectator && !proposal.isYou && !room.viewer.voted;
  return `<article class="crisis-proposal-card${proposal.isYou ? ' is-you' : ''}">
    <div class="crisis-proposal-index"><span>PROPOSAL ${esc(proposal.id.slice(0, 4).toUpperCase())}</span><span>${proposal.isYou ? '你的方案' : '匿名方案'}</span></div>
    <p class="crisis-proposal-text">${esc(proposal.text)}</p>
    ${!ratingMode && canVote ? `<button class="btn btn-primary vote-btn" data-action="crisis-vote" data-id="${esc(proposal.id)}">投这份</button>` : ''}
    ${ratingMode && canVote ? `<div class="crisis-rating">
      <label>可信度<select data-rating-key="credibility" data-id="${esc(proposal.id)}">${[1,2,3,4,5].map((n) => `<option value="${n}" ${C.rating.credibility === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>可执行<select data-rating-key="execution" data-id="${esc(proposal.id)}">${[1,2,3,4,5].map((n) => `<option value="${n}" ${C.rating.execution === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>创意<select data-rating-key="creativity" data-id="${esc(proposal.id)}">${[1,2,3,4,5].map((n) => `<option value="${n}" ${C.rating.creativity === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>` : ''}
  </article>`;
}

function revealMarkup(room) {
  const result = room.result;
  const viewer = room.viewer;
  const isSpectator = viewer.isSpectator;
  const isCoop = Boolean(result.isCoop);
  return `<div class="crisis-shell">
    ${headerMarkup(room)}
    <main class="crisis-page" id="main">
      <div class="crisis-round-line"><span>ROUND ${room.round} / ${room.totalRounds}</span><i></i><span>${result.isFinal ? '最终结算' : '揭晓'}</span></div>
      <div class="crisis-page-head">
        <div><p class="eyebrow">${result.isFinal ? 'FINAL / 三轮结束' : 'REVEAL / 本轮结果'}</p><h1 class="crisis-title">${isCoop ? (result.isFinal ? '三轮结束，<br /><span>你们都写完了。</span>' : '这一轮，<br /><span>看看对方怎么写。</span>') : result.isFinal ? '三轮结束，<br /><span>看看谁的提案最硬。</span>' : '这一轮，<br /><span>谁说服了大家？</span>'}</h1><p class="crisis-sub">${isCoop ? '双人模式不计分，直接揭晓双方的提案。' : '每人一票，票数就是本轮得分。'}</p></div>
      </div>
      ${crisisCard(result.crisis)}
      <div class="crisis-proposals">${result.entries.map((entry) => resultCardMarkup(entry, result)).join('')}</div>
      ${isCoop ? '' : `<section class="crisis-scoreboard"><h2>${result.isFinal ? '最终排名' : '当前累计'}</h2>${room.scores.map((score, index) => `<div class="crisis-score-row"><span>${index + 1}. ${esc(score.name)}</span><b>${score.score} 分</b></div>`).join('')}</section>`}
      ${!isSpectator && room.canNext ? `<div class="crisis-next-row"><p>房主可以进入下一轮。</p><button class="btn btn-primary" data-action="crisis-next">下一轮</button></div>` : ''}
      ${!isSpectator && room.canRestart ? `<div class="crisis-next-row"><p>三局结束，可以重开一局。</p><button class="btn btn-primary" data-action="crisis-restart">重开一局</button></div>` : ''}
      ${isSpectator ? '<p class="crisis-form-tip" style="text-align:center;margin-top:16px">你在观战。房主决定是否继续。</p>' : ''}
      <div class="crisis-export-row"><button class="btn btn-soft" data-action="crisis-export">导出对局数据</button><span>复制所有已完成轮次</span></div>
      ${restartMarkup(room)}
    </main>
    ${footMarkup()}
  </div>`;
}

function resultCardMarkup(entry, result) {
  const isWinner = !result.isCoop && entry.points > 0 && entry.points === Math.max(...result.entries.map((item) => item.points));
  return `<article class="crisis-proposal-card crisis-result-card${isWinner ? ' is-winner' : ''}">
    <div class="crisis-proposal-index"><span>${esc(entry.name)}</span><span>${result.isCoop ? '双人局' : `${entry.votes} 票`}</span></div>
    <p class="crisis-proposal-text">${esc(entry.proposal.text)}</p>
    ${result.isCoop ? '' : `<div class="crisis-result-score"><strong>${entry.points} 分</strong><span>${entry.votes} 票</span></div>`}
  </article>`;
}

function restartMarkup(room) {
  if (room.phase === 'lobby' || room.viewer.isSpectator) return '';
  if (!room.viewer.isHost) return '';
  return `<div class="crisis-restart-row"><span>想重来？</span><button data-action="crisis-restart">重开本局</button></div>`;
}

function render() {
  const app = $('#app');
  if (!app) return;
  if (!C.room) {
    app.innerHTML = landingMarkup();
    return;
  }
  if (C.room.phase === 'lobby') app.innerHTML = lobbyMarkup(C.room);
  else if (C.room.phase === 'writing') app.innerHTML = writingMarkup(C.room);
  else if (C.room.phase === 'voting') app.innerHTML = votingMarkup(C.room);
  else app.innerHTML = revealMarkup(C.room);
  updateCountdown();
}

function updateCountdown() {
  // Crisp PR has no phase deadlines; progress is driven by submissions/votes.
}

async function submitEntry() {
  if (C.busy) return;
  const nameInput = $('#crisis-name');
  const codeInput = $('#crisis-code');
  const isWatch = C.tab === 'watch';
  const name = String(nameInput?.value || C.name || '').trim() || (isWatch ? '观众' : '');
  const code = String(codeInput?.value || C.code || '').trim().toUpperCase();
  if (!name) {
    C.error = '先给自己起个名字。';
    render();
    return;
  }
  if ((C.tab === 'join' || isWatch) && !/^[A-Z0-9]{4}$/.test(code)) {
    C.error = '房间码是四位字母或数字。';
    render();
    return;
  }
  C.name = name;
  C.code = code;
  C.error = '';
  C.busy = true;
  render();
  try {
    const path = isWatch ? '/api/crisis/spectate' : C.tab === 'join' ? '/api/crisis/join' : '/api/crisis/rooms';
    const data = await api(path, { name, code });
    C.busy = false;
    adopt(data);
  } catch (error) {
    C.busy = false;
    C.error = error.message;
    render();
  }
}

async function action(path, body) {
  if (C.busy) return;
  C.busy = true;
  render();
  try {
    const data = await api(path, { ...C.creds, ...body });
    C.busy = false;
    if (data.state) applyState(data.state);
    else await refresh();
  } catch (error) {
    C.busy = false;
    showToast(error.message);
    render();
  }
}

function copyText(text, message) {
  const value = String(text || '');
  if (!value) return;
  const done = () => showToast(message);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(() => fallbackCopy(value, done));
  } else fallbackCopy(value, done);
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
  } catch {
    showToast('复制失败，请手动复制。');
  }
}

function indentBlock(value, prefix = '     ') {
  return String(value || '（空）')
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function buildExport(room) {
  const rule = '────────────────────────────';
  const lines = [
    '危机公关 · 对局记录',
    '════════════════════════════',
    `房间：${room.code}`,
    `已完成：${room.history.length} / ${room.totalRounds} 轮`,
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '════════════════════════════',
  ];

  for (const result of room.history) {
    lines.push('');
    lines.push(`【第 ${result.round} 轮】`);
    lines.push(`危机：${result.crisis.title}`);
    lines.push(`热度：${result.crisis.heat}`);
    lines.push('事实：');
    result.crisis.facts.forEach((fact, index) => {
      lines.push(`  ${index + 1}. ${fact}`);
    });

    lines.push('');
    lines.push('提案：');
    result.entries.forEach((entry, index) => {
      lines.push(rule);
      lines.push(`${index + 1}. ${entry.name}`);
      lines.push('   提案：');
      lines.push(indentBlock(entry.proposal.text));
      if (result.isCoop) {
        lines.push('   双人局：不计分');
      } else if (result.ratingMode) {
        const rating = entry.rating;
        lines.push(
          rating
            ? `   互评：可信 ${rating.credibility} / 执行 ${rating.execution} / 创意 ${rating.creativity} → 本轮 ${entry.points} 分`
            : '   互评：未提交',
        );
      } else {
        lines.push(`   得票：${entry.votes} 票 → 本轮 ${entry.points} 分`);
      }
    });

    lines.push(rule);
    if (result.isCoop) {
      lines.push('本轮：双人局不计分');
    } else {
      lines.push('本轮排名：');
      [...result.entries]
        .sort((a, b) => b.points - a.points)
        .forEach((entry, index) => {
          lines.push(`  ${index + 1}. ${entry.name} — ${entry.points} 分`);
        });
    }
  }

  lines.push('');
  lines.push('════════════════════════════');
  lines.push(room.history.some((result) => result.isFinal) ? '最终排名' : '当前累计');
  lines.push('════════════════════════════');
  if (!room.scores.length) {
    lines.push('双人局不计分');
  } else {
    room.scores.forEach((score, index) => {
      lines.push(`${index + 1}. ${score.name} — ${score.score} 分`);
    });
  }
  return lines.join('\n');
}

function leave() {
  if (!C.creds) return;
  const creds = C.creds;
  const role = C.role;
  if (pollTimer) window.clearInterval(pollTimer);
  clearSession(creds.code);
  C.creds = null;
  C.room = null;
  C.code = '';
  C.role = 'player';
  if (location.pathname !== '/crisis') history.replaceState(null, '', '/crisis');
  render();
  api(role === 'spectator' ? '/api/crisis/spectate/leave' : '/api/crisis/leave', creds).catch(() => {});
}

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'crisis-entry-form') return;
  event.preventDefault();
  submitEntry();
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const actionName = target.dataset.action;
  if (actionName === 'crisis-tab') {
    event.preventDefault();
    C.tab = ['join', 'watch'].includes(target.dataset.tab) ? target.dataset.tab : 'create';
    C.error = '';
    render();
  } else if (actionName === 'crisis-copy-code' && C.room) {
    event.preventDefault();
    copyText(C.room.code, '房间码已复制');
  } else if (actionName === 'crisis-copy-invite' && C.room) {
    event.preventDefault();
    copyText(inviteUrl(C.room.code), '邀请链接已复制');
  } else if (actionName === 'crisis-copy-watch' && C.room) {
    event.preventDefault();
    copyText(watchUrl(C.room.code), '观战链接已复制');
  } else if (actionName === 'crisis-copy-share' && C.room) {
    event.preventDefault();
    copyText(shareMessage(C.room.code), '对局邀请和观战邀请已一起复制');
  } else if (actionName === 'crisis-start') {
    event.preventDefault();
    action('/api/crisis/start', {});
  } else if (actionName === 'crisis-reroll') {
    event.preventDefault();
    action('/api/crisis/reroll', {});
  } else if (actionName === 'crisis-submit-proposal') {
    event.preventDefault();
    action('/api/crisis/proposal', { text: C.proposalText });
  } else if (actionName === 'crisis-vote') {
    event.preventDefault();
    action('/api/crisis/vote', { targetId: target.dataset.id });
  } else if (actionName === 'crisis-submit-rating') {
    event.preventDefault();
    const proposal = C.room?.proposals.find((item) => !item.isYou);
    if (!proposal) return;
    action('/api/crisis/rating', { targetId: proposal.id, rating: C.rating });
  } else if (actionName === 'crisis-next') {
    event.preventDefault();
    action('/api/crisis/next', {});
  } else if (actionName === 'crisis-restart') {
    event.preventDefault();
    if (!C.room?.viewer.isHost) return;
    if (window.confirm('重开会清空本局分数和历史，玩家和观战者保留。确定吗？')) {
      action('/api/crisis/restart', {});
    }
  } else if (actionName === 'crisis-export') {
    event.preventDefault();
    if (!C.room?.history?.length) return;
    copyText(buildExport(C.room), '对局数据已复制');
  } else if (actionName === 'crisis-leave') {
    event.preventDefault();
    leave();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'crisis-name') C.name = event.target.value;
  if (event.target.id === 'crisis-code') C.code = event.target.value.toUpperCase();
  if (event.target.id === 'crisis-proposal') {
    C.proposalText = event.target.value.slice(0, 400);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.dataset.ratingKey) {
    C.rating[event.target.dataset.ratingKey] = Number(event.target.value);
  }
});

async function boot() {
  const params = new URLSearchParams(location.search);
  const code = String(params.get('room') || '').trim().toUpperCase();
  const watch = params.get('watch') === '1';
  if (code) {
    C.code = code;
    C.tab = watch ? 'watch' : 'join';
    C.role = watch ? 'spectator' : 'player';
    const saved = loadSession(code);
    if (saved && saved.playerId && saved.token && (!watch || saved.role === 'spectator')) {
      C.creds = { ...saved, code };
      C.name = saved.name || C.name;
      try {
        const data = await api('/api/crisis/rejoin', C.creds);
        adopt(data);
        return;
      } catch (error) {
        C.error = error.message;
      }
    }
  }
  render();
}

boot();
