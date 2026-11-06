'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ICON_ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const TIERS = {
  exact: {
    title: '读心成功',
    sub: '完全猜中',
    mark: 'EXACT',
    className: 'exact',
  },
  one: {
    title: '心有灵犀',
    sub: '只差 1 分',
    mark: 'ONE',
    className: 'one',
  },
  two: {
    title: '同频成功',
    sub: '只差 2 分',
    mark: 'TWO',
    className: 'two',
  },
  miss: {
    title: '差一点',
    sub: '超过 2 分',
    mark: 'MISS',
    className: 'miss',
  },
};

const S = {
  room: null,
  creds: null,
  name: '',
  code: '',
  role: 'player',
  tab: 'create',
  busy: false,
  error: '',
  description: '',
  subjectMode: 'friend',
  subjectKeyword: '',
  selectedScore: null,
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

function countChars(value) {
  return Array.from(String(value || '')).length;
}

function showToast(message) {
  const region = $('#toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.id = `guess-toast-${++toastCounter}`;
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
    // Ignore malformed responses.
  }
  if (!response.ok) throw new Error(data.error || '连接失败，再试一次。');
  return data;
}

async function getState(code, playerId, token, role = 'player') {
  const query = new URLSearchParams({ code, playerId, token, role });
  const response = await fetch(`/api/guess/state?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
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
  return `tongpin.guess.session.${String(code || '').toUpperCase()}`;
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

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(refresh, 1200);
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = null;
}

async function refresh() {
  if (!S.creds) return;
  try {
    const state = await getState(
      S.creds.code,
      S.creds.playerId,
      S.creds.token,
      S.creds.role || 'player',
    );
    applyState(state);
  } catch (error) {
    if (/不存在|失效|重新加入|结束/.test(error.message)) {
      stopPolling();
      clearSession(S.creds.code);
      S.creds = null;
      S.room = null;
      S.error = error.message;
      render();
    }
  }
}

function stateSignature(state) {
  const { serverNow, ...stable } = state;
  void serverNow;
  return JSON.stringify(stable);
}

function applyState(state) {
  if (!state) return;
  const signature = stateSignature(state);
  if (signature === S.lastSig) return;
  const previous = S.room;
  S.lastSig = signature;
  S.room = state;
  if (
    previous &&
    (previous.round !== state.round ||
      (previous.phase === 'reveal' && state.phase === 'describe'))
  ) {
    S.description = '';
    S.selectedScore = null;
  }
  if (state.phase === 'lobby') {
    S.description = '';
    S.selectedScore = null;
    if (previous?.phase && previous.phase !== 'lobby') {
      S.subjectMode = state.subjectCustom ? 'custom' : 'friend';
      S.subjectKeyword = state.subjectCustom ? state.subject : '';
    }
  }
  render();
}

function adopt(data) {
  S.creds = {
    code: data.code,
    playerId: data.playerId,
    token: data.token,
    role: data.role || data.state.role || 'player',
  };
  S.role = S.creds.role;
  S.code = data.code;
  S.room = data.state;
  S.name = data.state.viewer.name || S.name;
  S.error = '';
  S.description = '';
  S.subjectMode = data.state.subjectCustom ? 'custom' : 'friend';
  S.subjectKeyword = data.state.subjectCustom ? data.state.subject : '';
  S.selectedScore = null;
  S.lastSig = stateSignature(data.state);
  saveSession(S.creds);
  const nextUrl =
    S.role === 'spectator'
      ? `/guess?room=${encodeURIComponent(data.code)}&watch=1`
      : `/guess?room=${encodeURIComponent(data.code)}`;
  if (location.pathname + location.search !== nextUrl) {
    history.replaceState(null, '', nextUrl);
  }
  startPolling();
  render();
}

function modeLink() {
  return '<a class="guess-mode-link" href="/">← 猜词模式</a>';
}

function headerMarkup(room) {
  return `<header class="guess-head">
    <a class="guess-brand" href="/" aria-label="同频首页">
      <span class="guess-brand-mark" aria-hidden="true"><i></i><i></i></span>
      <span class="guess-brand-word">同频<small>TONGPIN</small></span>
      <span class="guess-mode-tag">猜分</span>
    </a>
    <div class="guess-head-tools">
      ${room?.viewer?.isSpectator ? '<span class="guess-watch-badge">观战</span>' : ''}
      ${modeLink()}
      ${room ? `<button type="button" class="guess-room-pill" data-action="guess-copy-code" title="复制房间码"><span>ROOM</span><b>${esc(room.code)}</b></button>` : ''}
    </div>
  </header>`;
}

function footMarkup() {
  return `<footer class="guess-foot">
    <span>TONGPIN © 2026</span>
    <span>满分朋友，但是……</span>
  </footer>`;
}

function butClause(value) {
  return String(value || '')
    .replace(/^但是[，,：:]?\s*/, '')
    .trim();
}

function subjectDisplay(subject, custom) {
  return custom ? `（${subject || '……'}）` : subject || '朋友';
}

function currentSubjectDisplay() {
  return S.subjectMode === 'custom'
    ? subjectDisplay(S.subjectKeyword.trim(), true)
    : '朋友';
}

function fullFriendLine(subject, custom, value) {
  return `TA 是一个满分${subjectDisplay(subject, custom)}，但是${butClause(value)}`;
}

function landingMarkup() {
  const isJoin = S.tab === 'join';
  const isWatch = S.tab === 'watch';
  const needsCode = isJoin || isWatch;
  return `<div class="guess-shell">
    ${headerMarkup(null)}
    <main class="guess-landing" id="main">
      <section class="guess-hero">
        <p class="eyebrow">GUESS THE SCORE · 1 + 1—3 人</p>
        <h1>TA 是一个满分朋友，<br /><span>但是……</span></h1>
        <p class="guess-lede">描述者私密抽一个 0–10 分，补完「TA 是一个满分朋友，但是……」。默认是满分朋友，也可以切换成“满分（同事/男友/妈妈……）”。猜分者凭自己的标准打分，看看你们相差几分。</p>
        <div class="guess-hero-line" aria-hidden="true"></div>
        <div class="guess-hero-foot">
          <span>1 个描述者</span><i>·</i><span>1–3 个猜分者</span><i>·</i><span>无注册</span>
        </div>
        <div class="guess-score-float" aria-hidden="true">
          <small>ONLY YOU SEE</small>
          <b>7</b>
          <span>/ 10</span>
        </div>
      </section>

      <section class="guess-entry" aria-labelledby="guess-entry-title">
        <div class="guess-entry-card">
          <p class="guess-kicker">START / JOIN</p>
          <h2 id="guess-entry-title">先描述，还是先猜？</h2>
          <div class="guess-segmented guess-segmented-3" role="tablist" aria-label="进入方式">
            <button type="button" role="tab" data-action="guess-tab" data-tab="create" aria-selected="${!isJoin && !isWatch}">开新对局</button>
            <button type="button" role="tab" data-action="guess-tab" data-tab="join" aria-selected="${isJoin}">加入对局</button>
            <button type="button" role="tab" data-action="guess-tab" data-tab="watch" aria-selected="${isWatch}">观战</button>
          </div>
          <form id="guess-entry-form" novalidate>
            <label class="field">
              <span class="field-label"><span>${isWatch ? '观战称呼' : '你的称呼'}</span><span>${isWatch ? '可留空' : '最多 12 字'}</span></span>
              <input class="text-input" id="guess-name" type="text" maxlength="12" autocomplete="nickname" placeholder="${isWatch ? '不填就是「观众」' : '给自己起个名字'}" value="${esc(S.name)}" ${S.busy ? 'disabled' : ''} />
            </label>
            ${
              needsCode
                ? `<label class="field">
                    <span class="field-label"><span>房间码</span><span>四位字母或数字</span></span>
                    <input class="text-input code-input" id="guess-code" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" value="${esc(S.code)}" ${S.busy ? 'disabled' : ''} />
                  </label>`
                : ''
            }
            ${S.error ? `<p class="form-error" role="alert">${esc(S.error)}</p>` : ''}
            <button class="btn btn-primary guess-submit" type="submit" ${S.busy ? 'disabled' : ''}>
              ${S.busy ? '正在连接…' : isJoin ? '加入对局' : isWatch ? '进入观战' : '开一个房间'}
              ${S.busy ? '' : ICON_ARROW}
            </button>
          </form>
          <p class="guess-entry-foot">2–4 人 · 观战不限 · ${isWatch ? '不占玩家位' : '描述者也可以是房主'}</p>
        </div>
      </section>

      <section class="guess-rules" aria-label="玩法">
        <article><span>01 / SECRET</span><h3>抽一个分数</h3><p>描述者看到 0–10 的目标分，猜分者看不到。</p></article>
        <article><span>02 / DESCRIBE</span><h3>补完「但是」</h3><p>先选满分朋友或自定义对象，再补完「但是……」，别直接把分数说出来。</p></article>
        <article><span>03 / GUESS</span><h3>一起猜分</h3><p>1–3 个猜分者各自打 0–10 分，所有人提交后一起揭晓。</p></article>
        <article><span>04 / RESULT</span><h3>差几分？</h3><p>猜中、差 1 分、差 2 分、超过 2 分，各有不同反馈。</p></article>
      </section>
    </main>
    ${footMarkup()}
  </div>`;
}

function playerMarkup(player, room) {
  return `<div class="guess-player${player.isYou ? ' is-you' : ''}${player.isDescriptor ? ' is-descriptor' : ''}">
    <span class="guess-avatar" style="--soft:${esc(player.softColor)};--color:${esc(player.color)}">${esc(firstChar(player.name))}</span>
    <div class="guess-player-main">
      <b>${esc(player.name)}${player.isYou ? '<em>你</em>' : ''}</b>
      <span>${player.isDescriptor ? '本轮描述者' : '猜分者'}</span>
    </div>
    <span class="guess-player-state">${player.isDescriptor ? '描述中' : player.submitted ? '已打分' : player.connected ? '在线' : '掉线'}</span>
  </div>`;
}

function firstChar(name) {
  return Array.from(String(name || '?'))[0] || '?';
}

function prepMarkup(room, isHost) {
  const customMode = S.subjectMode === 'custom';
  const subjectText = subjectDisplay(room.subject, room.subjectCustom);
  if (!isHost) {
    return `<div class="guess-prep readonly">
      <span>本局满分对象</span>
      <b>满分${subjectText}</b>
    </div>`;
  }
  return `<div class="guess-prep">
    <div class="guess-prep-head"><b>满分对象</b><span>开局前选择</span></div>
    <div class="guess-subject-options">
      <button type="button" class="${!customMode ? 'active' : ''}" data-action="guess-prep-subject" data-mode="friend">满分朋友</button>
      <button type="button" class="${customMode ? 'active' : ''}" data-action="guess-prep-subject" data-mode="custom">满分（自定义）</button>
    </div>
    ${
      customMode
        ? `<label class="guess-subject-field">满分（<input id="guess-prep-subject" type="text" maxlength="8" placeholder="同事" value="${esc(S.subjectKeyword)}" autocomplete="off" />）</label>`
        : '<p class="guess-subject-hint">也可以换成同事、男友、妈妈、室友……</p>'
    }
  </div>`;
}

function lobbyMarkup(room) {
  const isHost = room.viewer.isHost;
  const count = room.players.length;
  const customMissing = S.subjectMode === 'custom' && !S.subjectKeyword.trim();
  return `<div class="guess-shell">
    ${headerMarkup(room)}
    <main class="guess-page" id="main">
      <div class="guess-page-head">
        <div>
          <p class="eyebrow">LOBBY / 等待集合</p>
          <h1 class="guess-title">人都到了，<br /><span>就开始描述。</span></h1>
          <p class="guess-sub">房主先当描述者。至少两个人，最多四个人；1 个描述者 + 1–3 个猜分者。</p>
        </div>
        <div class="guess-code-block">
          <span>ROOM CODE</span>
          <b>${esc(room.code)}</b>
        </div>
      </div>

      <div class="guess-lobby-grid">
        <section class="guess-panel">
          <div class="guess-panel-head"><h2>入座</h2><span>${count} / 4</span></div>
          <div class="guess-player-list">${room.players.map((player) => playerMarkup(player, room)).join('')}</div>
          ${prepMarkup(room, isHost)}
          <div class="guess-lobby-note">
            <b>开始后，房主先拿到一个只有自己能看到的分数。</b>
            <p>写下描述后，猜分者才能开始打分。每轮结束，描述者可以继续，也可以指定下一位。</p>
          </div>
          ${
            isHost
              ? `<button class="btn btn-primary guess-wide" data-action="guess-start" ${!room.canStart || S.busy || customMissing ? 'disabled' : ''}>${S.busy ? '正在开始…' : customMissing ? '先填满分关键词' : room.canStart ? '开始，抽分数' : count < 2 ? '还差一位玩家' : '准备中…'}</button>`
              : `<div class="guess-wait-button">等房主开始…</div>`
          }
          <button class="guess-text-link" data-action="guess-leave">退出对局</button>
        </section>

        <aside class="guess-side">
          <section class="guess-invite">
            <p class="eyebrow on-dark">INVITE / 邀请</p>
            <h2>把朋友叫进来</h2>
            <div class="guess-code-display">${Array.from(room.code).map((char) => `<span>${esc(char)}</span>`).join('')}</div>
            <div class="guess-invite-actions">
              <button class="btn btn-light" data-action="guess-copy-code">复制房间码</button>
              <button class="btn btn-outline-light" data-action="guess-copy-invite">邀请链接</button>
              <button class="btn btn-outline-light" data-action="guess-copy-watch">观战链接</button>
            </div>
            <button type="button" class="btn btn-light guess-share-all" data-action="guess-copy-share">一键复制两个邀请码</button>
            <p class="guess-invite-url">${esc(guessInviteUrl(room.code))}</p>
          </section>
          <section class="guess-mini-rules">
            <p class="eyebrow">HOW / 怎么算</p>
            <ul>
              <li><b>猜中</b> 一模一样，读心成功</li>
              <li><b>差 1 分</b> 心有灵犀</li>
              <li><b>差 2 分</b> 同频成功</li>
              <li><b>超过 2 分</b> 差一点，下轮再来</li>
            </ul>
          </section>
        </aside>
      </div>
    </main>
    ${footMarkup()}
  </div>`;
}

function guessInviteUrl(code) {
  return `${location.origin}/guess?room=${encodeURIComponent(code)}`;
}

function guessWatchUrl(code) {
  return `${location.origin}/guess?room=${encodeURIComponent(code)}&watch=1`;
}

function guessShareMessage(code) {
  return `🎮 猜分对局\n房间码：${code}\n${guessInviteUrl(code)}\n\n👀 观战席\n房间码：${code}\n${guessWatchUrl(code)}`;
}

function restartGuessBar(room) {
  if (room.phase === 'lobby' || room.viewer.isSpectator) return '';
  if (!room.viewer.isHost) {
    return '<div class="guess-restart-row"><span>想重来？等房主重开本局。</span></div>';
  }
  return `<div class="guess-restart-row">
    <button type="button" class="guess-text-link" data-action="guess-restart">重开对局</button>
    <span>放弃本局，原班人马回到准备大厅</span>
  </div>`;
}

function describeMarkup(room) {
  const viewer = room.viewer;
  const isDescriptor = viewer.isDescriptor;
  const target = room.target;
  const guesserCount = room.guesserCount;
  return `<div class="guess-shell">
    ${headerMarkup(room)}
    <main class="guess-page" id="main">
      <div class="guess-round-line"><span>ROUND ${String(room.round).padStart(2, '0')}</span><i></i><span>${isDescriptor ? '你来描述' : '等描述'}</span></div>
      <div class="guess-page-head">
        <div>
          <p class="eyebrow">DESCRIBE / 补完一句话</p>
          <h1 class="guess-title">${isDescriptor ? `TA 是一个满分${subjectDisplay(room.subject, room.subjectCustom)}，<br /><span>但是……</span>` : '描述者正在补完一句话，<br /><span>先别偷看。</span>'}</h1>
          <p class="guess-sub">${isDescriptor ? '本局的满分对象已经在大厅选好。用“但是”后面的部分，把这个对象拉到你手里的分数。' : `${esc(room.descriptorName || '描述者')} 正在补完「TA 是一个满分……，但是……」。猜分者现在看不到目标分，也不知道这句话会怎么收尾。`}</p>
        </div>
        ${
          isDescriptor
            ? `<div class="guess-secret-score" aria-label="只有你能看到的目标分数 ${target}"><span>ONLY YOU SEE</span><b>${target}</b><em>/ 10</em><small>目标分</small></div>`
            : `<div class="guess-hidden-score" aria-label="目标分数保密"><span>?</span><small>目标分保密</small></div>`
        }
      </div>

      ${
        isDescriptor
          ? `<section class="guess-write-card">
              <div class="guess-panel-head"><h2>补完这句话</h2><span>${countChars(S.description)} / 180</span></div>
              <div class="guess-fill-sentence">
                <span class="guess-sentence-lead">TA 是一个满分${subjectDisplay(room.subject, room.subjectCustom)}，但是</span>
                <div class="guess-blank-row">
                  <span class="guess-paren" aria-hidden="true">（</span>
                  <textarea id="guess-description" class="guess-textarea guess-blank-input" maxlength="180" rows="3" placeholder="比如：每次吵架都会消失两天。">${esc(S.description)}</textarea>
                  <span class="guess-paren" aria-hidden="true">）</span>
                </div>
              </div>
              <p class="guess-example">括号里只填“但是”后面的部分。好的描述要让猜分者大概感觉到你的目标分，但不要直接说数字。</p>
              <button class="btn btn-primary guess-wide" data-action="guess-describe" ${!S.description.trim() || S.busy ? 'disabled' : ''}>${S.busy ? '正在提交…' : '写好了，让猜分者开始'}</button>
            </section>`
          : `<section class="guess-wait-card">
              <div class="guess-wait-mark" aria-hidden="true"><i></i><i></i><i></i></div>
              <h2>${esc(room.descriptorName || '描述者')} 正在写</h2>
              <p>等描述者提交后，你会看到一段描述，然后给这个人打 0–10 分。</p>
              <div class="guess-small-players">${room.players.map((player) => playerMarkup(player, room)).join('')}</div>
            </section>`
      }
      <p class="guess-footnote">本轮有 ${guesserCount} 位猜分者。所有人提交后一起揭晓。</p>
      ${restartGuessBar(room)}
    </main>
    ${footMarkup()}
  </div>`;
}

function guessMarkup(room) {
  const viewer = room.viewer;
  const isDescriptor = viewer.isDescriptor;
  const isSpectator = Boolean(viewer.isSpectator);
  const submitted = viewer.submitted;
  const selected = S.selectedScore;
  const description = room.description;
  return `<div class="guess-shell">
    ${headerMarkup(room)}
    <main class="guess-page" id="main">
      <div class="guess-round-line"><span>ROUND ${String(room.round).padStart(2, '0')}</span><i></i><span>${isSpectator ? '观战' : isDescriptor ? '等打分' : submitted ? '已提交' : '你来猜'}</span></div>
      <div class="guess-page-head guess-page-head-small">
        <div>
          <p class="eyebrow">GUESS / ${isSpectator ? '观战中' : '给这个人打分'}</p>
          <h1 class="guess-title">${isSpectator ? '你在观战，<br /><span>看他们猜。</span>' : isDescriptor ? '描述已经给出，<br /><span>等他们猜。</span>' : '听完描述，<br /><span>你觉得他几分？</span>'}</h1>
          <p class="guess-sub">${isSpectator ? '你能看到描述和谁已提交，但看不到猜测分数，也不能打分。' : isDescriptor ? '猜分者看不到目标分。他们会按自己的真实标准打分。' : '不要猜描述者的目标分，按你自己的标准给这个人打 0–10 分。'}</p>
        </div>
        ${
          isDescriptor
            ? `<div class="guess-secret-score small" aria-label="只有你能看到的目标分数 ${room.target}"><span>ONLY YOU SEE</span><b>${room.target}</b><em>/ 10</em><small>目标分</small></div>`
            : `<div class="guess-hidden-score small" aria-label="目标分数保密"><span>?</span><small>目标分保密</small></div>`
        }
      </div>

      <section class="guess-description-card">
        <p class="eyebrow">THE DESCRIPTION / 这一句话</p>
        <blockquote>TA 是一个满分${subjectDisplay(room.subject, room.subjectCustom)}，但是<span class="guess-sentence-paren">（</span>${esc(butClause(description))}<span class="guess-sentence-paren">）</span></blockquote>
        <span>描述者：${esc(room.descriptorName || '')}</span>
      </section>

      ${
        isSpectator
          ? `<section class="guess-panel guess-waiting-panel">
              <div class="guess-panel-head"><h2>观战席</h2><span>${room.spectatorCount || 1} 人</span></div>
              <div class="guess-player-list">${room.players.filter((player) => !player.isDescriptor).map((player) => playerMarkup(player, room)).join('')}</div>
              <p class="guess-wait-copy">描述和提交状态会实时更新。所有人提交后，分数一起揭晓。</p>
            </section>`
          : isDescriptor
          ? `<section class="guess-panel guess-waiting-panel">
              <div class="guess-panel-head"><h2>猜分者</h2><span>${room.submittedCount} / ${room.guesserCount}</span></div>
              <div class="guess-player-list">${room.players.filter((player) => !player.isDescriptor).map((player) => playerMarkup(player, room)).join('')}</div>
              <p class="guess-wait-copy">所有人提交后，结果会一起揭晓。目标分暂时只有你能看到。</p>
            </section>`
          : `<section class="guess-score-card">
              <div class="guess-panel-head"><h2>给这个人打分</h2><span>0 — 10</span></div>
              <div class="guess-score-grid" role="group" aria-label="选择分数">
                ${Array.from({ length: 11 }, (_, score) => `<button type="button" class="guess-score${selected === score ? ' selected' : ''}" data-action="guess-score" data-score="${score}" aria-pressed="${selected === score}" ${submitted ? 'disabled' : ''}>${score}</button>`).join('')}
              </div>
              <div class="guess-score-scale"><span>完全不值</span><span>非常满分</span></div>
              <button class="btn btn-primary guess-wide" data-action="guess-submit-score" ${selected === null || submitted || S.busy ? 'disabled' : ''}>${submitted ? '已提交，等其他人…' : S.busy ? '正在提交…' : `提交 ${selected ?? ''} 分`}</button>
              <p class="guess-footnote">${submitted ? '你已提交。所有人提交后自动揭晓。' : '只能提交一次，提交后不能修改。'}</p>
            </section>`
      }
      ${restartGuessBar(room)}
    </main>
    ${footMarkup()}
  </div>`;
}

function revealMarkup(room) {
  const result = room.result;
  const viewer = room.viewer;
  const isDescriptor = viewer.isDescriptor;
  return `<div class="guess-shell">
    ${headerMarkup(room)}
    <main class="guess-page" id="main">
      <div class="guess-round-line"><span>ROUND ${String(room.round).padStart(2, '0')}</span><i></i><span>揭晓</span></div>
      <div class="guess-reveal-hero">
        <p class="eyebrow">THE REVEAL / 目标分揭晓</p>
        <div class="guess-target-big"><small>目标分</small><b>${result.target}</b><span>/ 10</span></div>
        <p>${esc(result.descriptorName)} 描述的人是 ${result.target} 分。</p>
      </div>

      <section class="guess-description-card reveal">
        <p class="eyebrow">THE DESCRIPTION / 这一句话</p>
        <blockquote>TA 是一个满分${subjectDisplay(result.subject, result.subjectCustom)}，但是<span class="guess-sentence-paren">（</span>${esc(butClause(result.description))}<span class="guess-sentence-paren">）</span></blockquote>
      </section>

      <section class="guess-results" aria-label="猜分结果">
        ${result.entries
          .map((entry) => {
            const tier = TIERS[entry.tier] || TIERS.miss;
            return `<article class="guess-result-card ${tier.className}">
              <div class="guess-result-top">
                <span class="guess-avatar" style="--soft:${esc(playerColor(room, entry.playerId, 'soft'))};--color:${esc(playerColor(room, entry.playerId, 'color'))}">${esc(firstChar(entry.name))}</span>
                <div><b>${esc(entry.name)}</b><span>猜了 <strong>${entry.score}</strong> 分</span></div>
                <span class="guess-tier-tag">${tier.mark}</span>
              </div>
              <div class="guess-result-diff"><strong>${entry.diff === 0 ? '猜中' : `差 ${entry.diff} 分`}</strong><span>${tier.title} · ${tier.sub}</span></div>
            </article>`;
          })
          .join('')}
      </section>

      ${
        isDescriptor
          ? `<section class="guess-next-card">
              <p class="eyebrow">NEXT / 下一轮</p>
              <h2>下一位描述者是谁？</h2>
              <p>你可以继续由自己描述，也可以把“出题人”交给另一个人。目标分会重新随机。</p>
              <div class="guess-next-actions">
                <button class="btn btn-primary" data-action="guess-next" data-id="${esc(room.viewer.id)}">继续由我描述</button>
                ${room.nextCandidates
                  .filter((player) => !player.isYou)
                  .map((player) => `<button class="btn btn-soft" data-action="guess-next" data-id="${esc(player.id)}">换成 ${esc(player.name)}</button>`)
                  .join('')}
              </div>
            </section>`
          : `<section class="guess-next-card waiting">
              <p class="eyebrow">NEXT / 下一轮</p>
              <h2>等描述者决定</h2>
              <p>描述者可以继续由自己描述，也可以指定下一位。决定后，新一局会自动开始。</p>
            </section>`
      }

      <div class="guess-export-row">
        <button type="button" class="btn btn-soft" data-action="guess-export">导出对局数据</button>
        <span>复制成文本，包含所有已完成轮次</span>
      </div>
      ${restartGuessBar(room)}
    </main>
    ${footMarkup()}
  </div>`;
}

function playerColor(room, playerId, key) {
  const player = room.players.find((candidate) => candidate.id === playerId);
  return player ? player[key] || '#7d776d' : '#7d776d';
}

function render() {
  const app = $('#app');
  if (!app) return;
  if (!S.room) {
    app.innerHTML = landingMarkup();
    return;
  }
  if (S.room.phase === 'lobby') app.innerHTML = lobbyMarkup(S.room);
  else if (S.room.phase === 'describe') app.innerHTML = describeMarkup(S.room);
  else if (S.room.phase === 'guess') app.innerHTML = guessMarkup(S.room);
  else app.innerHTML = revealMarkup(S.room);
}

async function submitEntry() {
  if (S.busy) return;
  const nameInput = $('#guess-name');
  const codeInput = $('#guess-code');
  const isWatch = S.tab === 'watch';
  const name = String(nameInput?.value || S.name || '').trim() || (isWatch ? '观众' : '');
  const code = String(codeInput?.value || S.code || '').trim().toUpperCase();
  if (!name) {
    S.error = '先给自己起个名字。';
    render();
    return;
  }
  if ((S.tab === 'join' || isWatch) && !/^[A-Z0-9]{4}$/.test(code)) {
    S.error = '房间码是四位字母或数字。';
    render();
    return;
  }
  S.name = name;
  S.code = code;
  S.error = '';
  S.busy = true;
  render();
  try {
    const path = isWatch
      ? '/api/guess/spectate'
      : S.tab === 'join'
        ? '/api/guess/join'
        : '/api/guess/rooms';
    const data = await api(path, { name, code });
    S.busy = false;
    adopt(data);
  } catch (error) {
    S.busy = false;
    S.error = error.message;
    render();
  }
}

async function rejoin() {
  if (!S.creds) return;
  try {
    const data = await api('/api/guess/rejoin', S.creds);
    S.busy = false;
    adopt(data);
  } catch (error) {
    stopPolling();
    clearSession(S.creds.code);
    S.creds = null;
    S.room = null;
    S.error = error.message;
    render();
  }
}

async function saveSubject() {
  if (!S.room || S.room.phase !== 'lobby' || !S.room.viewer.isHost || !S.creds) return;
  const custom = S.subjectMode === 'custom';
  if (custom && !S.subjectKeyword.trim()) return;
  try {
    const data = await api('/api/guess/subject', {
      ...S.creds,
      subject: custom ? S.subjectKeyword.trim() : '朋友',
      subjectCustom: custom,
    });
    if (data.state) applyState(data.state);
  } catch (error) {
    showToast(error.message);
  }
}

async function action(path, body) {
  if (S.busy) return;
  S.busy = true;
  render();
  try {
    const data = await api(path, { ...S.creds, ...body });
    S.busy = false;
    if (data.state) applyState(data.state);
    else await refresh();
  } catch (error) {
    S.busy = false;
    showToast(error.message);
    render();
  }
}

function buildGuessExport(room) {
  const lines = [
    '同频猜分 · 对局记录',
    `房间：${room.code}`,
    `满分对象：满分${subjectDisplay(room.subject, room.subjectCustom)}`,
    '',
  ];
  for (const round of room.history || []) {
    const tierText = (tier) => (TIERS[tier] ? TIERS[tier].title : '差一点');
    lines.push(`第 ${round.round} 轮`);
    lines.push(`描述者：${round.descriptorName}`);
    lines.push(`目标分：${round.target} / 10`);
    lines.push(
      `描述：TA 是一个满分${subjectDisplay(round.subject, round.subjectCustom)}，但是${butClause(round.description)}`,
    );
    lines.push('猜分：');
    for (const entry of round.entries) {
      const detail =
        entry.diff === 0
          ? '猜中，读心成功'
          : `差 ${entry.diff} 分，${tierText(entry.tier)}`;
      lines.push(`- ${entry.name}：${entry.score} 分（${detail}）`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function copyText(text, message) {
  const value = String(text || '');
  if (!value) return;
  const done = () => showToast(message);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(() => fallbackCopy(value, done));
  } else {
    fallbackCopy(value, done);
  }
}

function fallbackCopy(text, done) {
  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
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

function leave() {
  if (!S.creds) return;
  const creds = S.creds;
  stopPolling();
  clearSession(creds.code);
  const role = S.role;
  S.creds = null;
  S.room = null;
  S.code = '';
  S.role = 'player';
  S.description = '';
  S.selectedScore = null;
  if (location.pathname !== '/guess') history.replaceState(null, '', '/guess');
  render();
  api(role === 'spectator' ? '/api/guess/spectate/leave' : '/api/guess/leave', creds).catch(
    () => {},
  );
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const actionName = target.dataset.action;
  if (actionName === 'guess-tab') {
    event.preventDefault();
    S.tab = ['join', 'watch'].includes(target.dataset.tab) ? target.dataset.tab : 'create';
    S.error = '';
    render();
    return;
  }
  if (actionName === 'guess-copy-code' && S.room) {
    event.preventDefault();
    copyText(S.room.code, '房间码已复制');
    return;
  }
  if (actionName === 'guess-copy-invite' && S.room) {
    event.preventDefault();
    copyText(guessInviteUrl(S.room.code), '邀请链接已复制，发给朋友吧');
    return;
  }
  if (actionName === 'guess-copy-watch' && S.room) {
    event.preventDefault();
    copyText(guessWatchUrl(S.room.code), '观战链接已复制');
    return;
  }
  if (actionName === 'guess-copy-share' && S.room) {
    event.preventDefault();
    copyText(guessShareMessage(S.room.code), '房间邀请和观战邀请已一起复制');
    return;
  }
  if (actionName === 'guess-start') {
    event.preventDefault();
    const custom = S.subjectMode === 'custom';
    if (custom && !S.subjectKeyword.trim()) {
      showToast('先填一个满分关键词。');
      return;
    }
    action('/api/guess/start', {
      subject: custom ? S.subjectKeyword.trim() : '朋友',
      subjectCustom: custom,
    });
    return;
  }
  if (actionName === 'guess-prep-subject') {
    event.preventDefault();
    S.subjectMode = target.dataset.mode === 'custom' ? 'custom' : 'friend';
    render();
    if (S.subjectMode === 'custom') {
      window.requestAnimationFrame(() => $('#guess-prep-subject')?.focus());
      return;
    }
    saveSubject();
    return;
  }
  if (actionName === 'guess-describe') {
    event.preventDefault();
    action('/api/guess/describe', { description: S.description });
    return;
  }
  if (actionName === 'guess-score') {
    event.preventDefault();
    S.selectedScore = Number(target.dataset.score);
    render();
    return;
  }
  if (actionName === 'guess-submit-score') {
    event.preventDefault();
    if (S.selectedScore === null) return;
    action('/api/guess/rate', { score: S.selectedScore });
    return;
  }
  if (actionName === 'guess-next') {
    event.preventDefault();
    action('/api/guess/next', { nextDescriptorId: target.dataset.id });
    return;
  }
  if (actionName === 'guess-restart') {
    event.preventDefault();
    if (!S.room?.viewer.isHost || S.room.phase === 'lobby') return;
    const confirmed = window.confirm(
      '重开会放弃当前对局，清空本局描述、分数和历史。原班玩家会回到准备大厅。确定吗？',
    );
    if (confirmed) action('/api/guess/restart', {});
    return;
  }
  if (actionName === 'guess-export') {
    event.preventDefault();
    if (!S.room?.history?.length) {
      showToast('还没有已完成的对局。');
      return;
    }
    copyText(buildGuessExport(S.room), '对局数据已复制');
    return;
  }
  if (actionName === 'guess-leave') {
    event.preventDefault();
    leave();
    return;
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'guess-name') S.name = event.target.value;
  if (event.target.id === 'guess-code') S.code = event.target.value.toUpperCase();
  if (event.target.id === 'guess-prep-subject') {
    S.subjectKeyword = event.target.value.slice(0, 8);
    const start = $('[data-action="guess-start"]');
    if (start) {
      const missing = !S.subjectKeyword.trim();
      start.disabled = !S.room?.canStart || missing || S.busy;
      start.textContent = missing ? '先填满分关键词' : '开始，抽分数';
    }
  }
  if (event.target.id === 'guess-description') {
    S.description = event.target.value.slice(0, 180);
    const counter = $('.guess-write-card .guess-panel-head span');
    if (counter) counter.textContent = `${countChars(S.description)} / 180`;
    const submit = $('[data-action="guess-describe"]');
    if (submit) submit.disabled = !S.description.trim() || S.busy;
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'guess-prep-subject') saveSubject();
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'guess-entry-form') return;
  event.preventDefault();
  submitEntry();
});

async function boot() {
  const params = new URLSearchParams(location.search);
  const code = String(params.get('room') || '').trim().toUpperCase();
  const watch = params.get('watch') === '1';
  if (code) {
    S.code = code;
    S.tab = watch ? 'watch' : 'join';
    S.role = watch ? 'spectator' : 'player';
    const saved = loadSession(code);
    const canRejoin =
      saved &&
      saved.playerId &&
      saved.token &&
      (!watch || saved.role === 'spectator');
    if (canRejoin) {
      S.creds = { ...saved, code };
      S.name = saved.name || S.name;
      await rejoin();
      return;
    }
  }
  render();
}

boot();
