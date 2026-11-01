'use strict';

/* ------------------------------------------------------------------ *
 * 同频 · 客户端
 * 无构建步骤、无第三方依赖。服务端状态是唯一事实来源。
 * ------------------------------------------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);

// localtunnel gives us a stable public hostname but only a small pool of raw
// TCP pipes. Polling keeps the game usable without holding both pipes open with
// EventSource streams.
const FORCE_POLLING =
  location.hostname.endsWith('.loca.lt') ||
  location.hostname.endsWith('.onrender.com') ||
  new URLSearchParams(location.search).has('poll');

const S = {
  booting: true,
  name: '',
  tab: 'create',
  joinCode: '',
  formError: '',
  busy: false,
  startBusy: false,
  continueBusy: false,
  submitBusy: false,
  creds: null,
  room: null,
  info: null,
  draft: '',
  save: 'idle',
  sound: true,
  modal: null,
  stream: 'idle',
  streamErrors: 0,
  expiredRequested: false,
  clockOffset: 0,
  focusWord: false,
  focusField: null,
  lastFocus: null,
  lost: false,
  lastTitleSecond: null,
  lastStateSignature: null,
};

let eventSource = null;
let saveTimer = null;
let draftInFlight = false;
let draftQueued = false;
let lastSavedDraft = '';
let saveRetryTimer = null;
let refreshPromise = null;
let toastCounter = 0;

const ICONS = {
  arrow:
    '<svg class="arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h13M11.5 4.5 17 10l-5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="6.5" y="6.5" width="9" height="9" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M13.5 6.5v-1a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  help:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.7a2.1 2.1 0 1 1 2.7 2c-.5.2-.7.6-.7 1.1v.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="14" r=".9" fill="currentColor"/></svg>',
  sound:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3.5 8v4h3l4 3V5l-4 3h-3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.2 7.4a3.5 3.5 0 0 1 0 5.2M15.3 5.3a6.4 6.4 0 0 1 0 9.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  soundOff:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3.5 8v4h3l4 3V5l-4 3h-3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m13.2 8 3.2 3.2M16.4 8l-3.2 3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  check:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.2 8.2 3 3 6.6-6.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function firstRune(value) {
  return Array.from(String(value || '').trim())[0] || '?';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

function normalizeWord(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim();
}

function comparableDraft(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function countRunes(value) {
  return Array.from(String(value || '')).length;
}

function formatPhase(phase) {
  return (
    {
      lobby: '集合中',
      writing: '写词中',
      reveal: '已揭晓',
      won: '同频成功',
    }[phase] || ''
  );
}

function roomUrl(code) {
  return `${location.origin}/?room=${encodeURIComponent(code)}`;
}

function logoMarkup(interactive = false) {
  const inner =
    '<span class="brand-mark" aria-hidden="true"><i></i><i></i></span>' +
    '<span class="brand-copy"><b>同频</b><small>TONGPIN</small></span>';
  return interactive
    ? `<a class="brand" href="/" aria-label="同频首页">${inner}</a>`
    : `<div class="brand" aria-label="同频">${inner}</div>`;
}

function siteFoot() {
  return `<footer class="site-foot"><span>TONGPIN © 2026 · 想到一起，才算数</span><span>2–4 人 · 跨城联机 · 无需注册</span></footer>`;
}

function iconButton(action, icon, label, extra = '') {
  return `<button type="button" class="icon-btn" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${ICONS[icon]}</button>`;
}

function soundButton() {
  return iconButton(
    'toggle-sound',
    S.sound ? 'sound' : 'soundOff',
    S.sound ? '关闭声音' : '打开声音',
    `aria-pressed="${S.sound}"`,
  );
}

function roomPill(room) {
  return `<button type="button" class="room-mini" data-action="copy-code" title="复制房间码" aria-label="复制房间码 ${esc(room.code)}"><span class="connection-dot js-connection-dot" data-stream="${esc(S.stream)}" aria-hidden="true"></span><span>ROOM</span><b>${esc(room.code)}</b></button>`;
}

function homeHeader() {
  return `<header class="site-head">
    ${logoMarkup(true)}
    <nav class="site-nav" aria-label="站点导航">
      <button type="button" class="text-link" data-action="open-how">怎么玩</button>
    </nav>
  </header>`;
}

function spectatorTag(room) {
  return room.viewer?.isSpectator ? '<span class="spectator-tag">观战</span>' : '';
}

function roomHeader(room) {
  const label = formatPhase(room.phase);
  const round = room.phase === 'lobby' ? '—' : pad2(room.round);
  return `<header class="site-head game-head">
    ${logoMarkup(false)}
    <div class="round-chip" aria-label="第 ${esc(room.round)} 轮，${esc(label)}">
      <span>ROUND</span><b>${round}</b><i></i><em class="round-word">${esc(label)}</em>
    </div>
    <div class="game-tools">
      ${spectatorTag(room)}
      ${soundButton()}
      ${iconButton('open-how', 'help', '查看玩法')}
      ${roomPill(room)}
    </div>
  </header>`;
}

function lobbyHeader(room) {
  return `<header class="site-head">
    ${logoMarkup(false)}
    <div class="game-tools">
      ${spectatorTag(room)}
      ${soundButton()}
      ${iconButton('open-how', 'help', '查看玩法')}
      ${roomPill(room)}
    </div>
  </header>`;
}

function bootMarkup() {
  return `<div class="boot" role="status" aria-live="polite">
    <div class="boot-mark" aria-hidden="true"><i></i><i></i></div>
    <p>正在调频…</p>
  </div>`;
}

/* ----------------------------- Home ----------------------------- */

function homeMarkup() {
  const isJoin = S.tab === 'join';
  const isWatch = S.tab === 'watch';
  const needsCode = isJoin || isWatch;
  return `<div class="app-frame page-home">
    ${homeHeader()}
    <main class="home-main" id="main">
      <div class="hero-grid">
        <section class="hero-copy" aria-labelledby="hero-title">
          <p class="eyebrow">CO-OP WORD GAME · 2—4 人</p>
          <h1 class="hero-title" id="hero-title">想到一起，<br /><span>才算数。</span></h1>
          <p class="hero-lede">没有讨论，没有提示。<br />每人只写一个词，看看你们是不是<strong>同一频段</strong>。</p>
          <div class="hero-proof" aria-label="示例：四个人都写了海，同频成功">
            <div class="proof-avatars" aria-hidden="true">
              <span class="proof-avatar" style="--soft:#ffe1d7">青</span>
              <span class="proof-avatar" style="--soft:#d8f2eb">满</span>
              <span class="proof-avatar" style="--soft:#e0e6ff">树</span>
              <span class="proof-avatar" style="--soft:#ffedc2">禾</span>
            </div>
            <div class="proof-copy">
              <b>“海” × 4</b>
              <span>第 2 轮 · 成功同频</span>
            </div>
            <div class="proof-stamp" aria-hidden="true">同频<br />成功</div>
          </div>
        </section>

        <section aria-labelledby="entry-title">
          <div class="entry-card">
            <p class="card-kicker">START / JOIN A ROOM</p>
            <h2 id="entry-title">现在，和朋友对个频。</h2>

            <div class="segmented segmented-3" role="tablist" aria-label="进入房间的方式">
              <button type="button" role="tab" data-action="switch-tab" data-tab="create" aria-selected="${!isJoin && !isWatch}" aria-controls="entry-form">开新房间</button>
              <button type="button" role="tab" data-action="switch-tab" data-tab="join" aria-selected="${isJoin}" aria-controls="entry-form">加入房间</button>
              <button type="button" role="tab" data-action="switch-tab" data-tab="watch" aria-selected="${isWatch}" aria-controls="entry-form">观战</button>
            </div>

            <form id="entry-form" novalidate>
              <div class="field">
                <label class="field-label" for="player-name"><span>${isWatch ? '观战称呼' : '你的称呼'}</span><span>${isWatch ? '可留空' : '最多 12 字'}</span></label>
                <input class="text-input" id="player-name" name="name" type="text" maxlength="12" autocomplete="nickname" placeholder="${isWatch ? '不填就是「观众」' : '给自己起个名字'}" value="${esc(S.name)}" ${S.busy ? 'disabled' : ''} />
              </div>
              ${
                needsCode
                  ? `<div class="field">
                      <label class="field-label" for="join-code"><span>房间码</span><span>四位字母或数字</span></label>
                      <input class="text-input code-input" id="join-code" name="code" type="text" inputmode="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" value="${esc(S.joinCode)}" ${S.busy ? 'disabled' : ''} />
                    </div>`
                  : ''
              }
              ${S.formError ? `<p class="form-error" role="alert">${esc(S.formError)}</p>` : ''}
              <button class="btn btn-primary" type="submit" ${S.busy ? 'disabled' : ''}>
                ${S.busy ? '正在连接…' : isJoin ? '加入房间' : isWatch ? '进入观战' : '开一个房间'}
                ${S.busy ? '' : ICONS.arrow}
              </button>
            </form>

            <p class="entry-foot"><span>2–4 人</span><i>·</i><span>观战不限</span><i>·</i><span>无需注册</span></p>
          </div>
        </section>
      </div>

      <section class="rules-band" aria-label="玩法摘要">
        <article class="rule-item">
          <span class="rule-num">01 / WRITE</span>
          <h3>各写一个词</h3>
          <p>2–4 人，各自想一个词，不讨论、不提示。</p>
        </article>
        <article class="rule-item">
          <span class="rule-num">02 / REVEAL</span>
          <h3>一起揭晓</h3>
          <p>全员提交或倒计时结束，一起亮牌。超时使用已同步草稿。</p>
        </article>
        <article class="rule-item">
          <span class="rule-num">03 / MATCH</span>
          <h3>同词即成功</h3>
          <p>所有人写出相同的非空词语才算成功，不限轮数。</p>
        </article>
        <article class="rule-item">
          <span class="rule-num">04 / AGAIN</span>
          <h3>从词继续</h3>
          <p>没撞上就从上一轮的词继续联想；全员点击继续，才开始下一轮。</p>
        </article>
      </section>
    </main>
    ${siteFoot()}
  </div>`;
}

/* ----------------------------- Lobby ----------------------------- */

function playerSeat(player) {
  const badges = [
    player.isHost ? '<span class="badge host">房主</span>' : '',
    player.isYou ? '<span class="badge">你</span>' : '',
    !player.connected ? '<span class="badge">掉线</span>' : '',
  ]
    .filter(Boolean)
    .join('');
  return `<article class="seat${player.isYou ? ' is-you' : ''}" style="--seat-color:${esc(player.color)}">
    <div class="seat-top">
      <div class="avatar" style="--soft:${esc(player.softColor)}" aria-hidden="true">${esc(firstRune(player.name))}</div>
      <div class="seat-badges">${badges}</div>
    </div>
    <div class="seat-name"><span>${esc(player.name)}</span></div>
    <div class="seat-bottom"><i class="status-dot ${player.connected ? '' : 'offline'}"></i>${player.connected ? '在线' : '掉线'}</div>
  </article>`;
}

function emptySeat(index, playerCount) {
  const copy =
    playerCount === 0
      ? ['等朋友加入', '分享链接就能入座']
      : playerCount === 1
        ? ['还差一位朋友', '满 2 人即可开局']
        : playerCount === 2
          ? ['再来一位也可以', '最多坐满 4 人']
          : ['还有一个位置', '叫上最后一位朋友'];
  return `<article class="seat seat-empty" aria-label="空座位">
    <span class="empty-plus" aria-hidden="true">+</span>
    <p>${copy[0]}<small>${copy[1]}</small></p>
  </article>`;
}

function spectatorStrip(room) {
  const spectators = room.spectators || [];
  return `<div class="spectator-strip">
    <div class="spectator-strip-head">
      <span class="spectator-label"><i class="spectator-eye" aria-hidden="true"></i>观战席</span>
      <span class="spectator-count">${spectators.length} / ${room.maxSpectators}</span>
    </div>
    ${
      spectators.length
        ? `<div class="spectator-chips">${spectators
            .map(
              (spectator) =>
                `<span class="spectator-chip${spectator.isYou ? ' is-you' : ''}"><i class="status-dot ${spectator.connected ? '' : 'offline'}"></i>${esc(spectator.name)}${spectator.isYou ? ' · 你' : ''}</span>`,
            )
            .join('')}</div>`
        : `<p class="spectator-empty">还没有人观战，复制观战链接给不上场的朋友。</p>`
    }
  </div>`;
}

function durationControls(room) {
  const isHost = room.viewer.isHost;
  if (!isHost) {
    return `<span class="static-duration">每轮 ${room.durationSec} 秒</span>`;
  }
  return `<div class="duration-options" role="group" aria-label="每轮时间">${room.allowedDurations
    .map(
      (seconds) =>
        `<button type="button" class="chip${seconds === room.durationSec ? ' active' : ''}" data-action="set-duration" data-seconds="${seconds}" aria-pressed="${seconds === room.durationSec}">${seconds}s</button>`,
    )
    .join('')}</div>`;
}

function shareMessage(links = inviteLinks()) {
  return `🔗房间链接\n${links.primary}\n\n📺观战链接\n${links.watch}`;
}

function inviteLinks() {
  if (!S.room) return { primary: '', local: '', lan: '', public: '', watch: '' };
  const code = encodeURIComponent(S.room.code);
  const local = roomUrl(S.room.code);
  const lanAddress = S.info?.lanUrls?.[0];
  const lan = lanAddress ? `${lanAddress}/?room=${code}` : '';
  const publicBase = String(S.info?.publicUrl || '').replace(/\/+$/, '');
  const publicLink = publicBase ? `${publicBase}/?room=${code}` : '';
  const onLoopback =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '::1';

  let primary = local;
  if (publicLink) {
    primary = publicLink;
  } else if (lan && onLoopback) {
    primary = lan;
  }
  return {
    primary,
    local,
    lan,
    public: publicLink,
    watch: primary ? `${primary}&watch=1` : '',
  };
}

function lobbyMarkup(room) {
  const count = room.players.length;
  const full = count >= room.maxPlayers;
  const canStart = room.canStart;
  const isSpectator = Boolean(room.viewer.isSpectator);
  const seats = room.players.map(playerSeat).join('');
  const emptyCount = Math.max(0, room.maxPlayers - count);
  const empties = Array.from({ length: emptyCount }, (_, index) => emptySeat(index, count)).join('');
  const links = inviteLinks();
  const isPublic = Boolean(links.public);
  const isLanPrimary = !isPublic && links.primary === links.lan && links.lan;
  const title = isSpectator
    ? '观战席，<span>已就座。</span>'
    : full
      ? '人齐了，<br class="mobile-break" /><span>开局吧。</span>'
      : '等朋友<span>入座。</span>';

  return `<div class="app-frame page-lobby">
    ${lobbyHeader(room)}
    <main class="lobby-main" id="main">
      <div class="lobby-head">
        <div>
          <p class="eyebrow">${isSpectator ? 'SPECTATOR / 观战中' : 'LOBBY / 等待集合'}</p>
          <h1 class="lobby-title">${title}</h1>
          <p class="lobby-sub">${
            isSpectator
              ? '你在观战。玩家到齐后由房主开局；提交阶段只能看到谁已提交，揭晓时才能看到所有人的词。'
              : full
                ? '四个人都到齐了。房主按下开始，这一局就正式调频。'
                : '满 2 人即可开始，最多 4 人。把房间码发给朋友，等人齐了再开局。'
          }</p>
        </div>
        <div class="lobby-code" aria-label="房间码 ${esc(room.code)}">
          <small>ROOM CODE</small>
          <b>${esc(room.code)}</b>
        </div>
      </div>

      <div class="lobby-grid">
        <section class="panel seats-panel" aria-labelledby="seats-title">
          <div class="panel-head">
            <h2 id="seats-title">入座</h2>
            <span class="panel-head-meta">${count} / ${room.maxPlayers} SEATED</span>
          </div>
          <div class="seat-grid">${seats}${empties}</div>
          ${spectatorStrip(room)}

          <div class="settings-block">
            <div class="settings-row">
              <p class="settings-label">每轮时间<small>${room.viewer.isHost ? '开局前可以调整' : '由房主设置'}</small></p>
              ${durationControls(room)}
            </div>
            ${
              room.durationSec === 20
                ? `<div class="speed-mode-note">⚡ <strong>20 秒极速模式</strong>：没有提交按钮，倒计时结束自动用已同步草稿揭晓。</div>`
                : ''
            }
          </div>

          <div class="start-row">
            ${
              isSpectator
                ? `<button type="button" class="btn btn-soft btn-block" disabled>你正在观战 · 等房主开局</button>`
                : room.viewer.isHost
                  ? `<button type="button" class="btn btn-primary btn-block" data-action="start-game" ${!canStart || S.startBusy ? 'disabled' : ''}>${S.startBusy ? '正在开局…' : canStart ? '开始游戏' : count < 2 ? '还差一位朋友' : '人满才能开始'}${!S.startBusy ? ICONS.arrow : ''}</button>`
                  : `<button type="button" class="btn btn-soft btn-block" disabled>${count < 2 ? '等朋友加入' : '等房主开始'}</button>`
            }
            <p class="start-hint">${
              isSpectator
                ? '玩家开局后会自动进入观战画面，你不需要做任何操作。'
                : count < 2
                  ? '至少需要 2 人。复制邀请链接，再叫一位朋友。'
                  : room.viewer.isHost
                    ? '开局后不能加入新玩家。先确认人都到齐，再调频。'
                    : '房主准备好后就会开局，先把手指放在词上。'
            }</p>
            <p class="start-hint"><button type="button" class="text-link" data-action="leave-lobby">${isSpectator ? '退出观战' : '退出这个房间'}</button></p>
          </div>
        </section>

        <aside class="lobby-side">
          <section class="invite-card" aria-labelledby="invite-title">
            <p class="eyebrow on-dark">INVITE / 邀请</p>
            <h2 id="invite-title">把朋友叫进来</h2>
            <div class="room-code-display" aria-label="房间码 ${esc(room.code)}">${Array.from(room.code)
              .map((character) => `<span>${esc(character)}</span>`)
              .join('')}</div>
            <div class="invite-actions invite-actions-3">
              <button type="button" class="btn btn-light" data-action="copy-code">房间码</button>
              <button type="button" class="btn btn-outline-light" data-action="copy-invite">邀请链接</button>
              <button type="button" class="btn btn-outline-light" data-action="copy-watch">观战链接</button>
            </div>
            <p class="invite-watch-note">观战不占玩家名额，可随时加入；只能看，不能写词或点继续。</p>
            <button type="button" class="btn btn-light btn-block share-all" data-action="copy-share">一键复制两个链接</button>
            <div class="invite-url-box">
              <div class="invite-url-label"><span>${isPublic ? '公网邀请链接' : isLanPrimary ? '同一 WI-FI 邀请链接' : '邀请链接'}</span><span>${isPublic ? 'PUBLIC' : 'LINK'}</span></div>
              <span class="invite-url" title="${esc(links.primary)}">${esc(links.primary)}</span>
            </div>
            ${
              links.lan && links.primary !== links.lan
                ? `<div class="invite-url-box"><div class="invite-url-label"><span>局域网入口</span><span>LAN</span></div><span class="invite-url" title="${esc(links.lan)}">${esc(links.lan)}</span></div>`
                : ''
            }
            ${
              isPublic
                ? `<div class="invite-url-box"><div class="invite-url-label"><span>提示</span><span>PUBLIC</span></div><span class="invite-url">朋友在任何城市都能打开这个链接，用房间码入场。</span></div>`
                : !links.lan && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
                  ? `<div class="invite-url-box"><div class="invite-url-label"><span>提示</span><span>LOCAL</span></div><span class="invite-url">没检测到局域网地址。朋友需要和你在同一台电脑上打开。</span></div>`
                  : `<div class="invite-url-box"><div class="invite-url-label"><span>提示</span><span>WI-FI</span></div><span class="invite-url">朋友需要和你连同一个 Wi-Fi，直接打开链接即可。</span></div>`
            }
          </section>

          <section class="how-mini" aria-labelledby="mini-rules-title">
            <h3 id="mini-rules-title">这一局怎么玩</h3>
            <ol>
              <li><b>1</b><span>各自写一个词，不能讨论。</span></li>
              <li><b>2</b><span>全员提交或倒计时结束，一起揭晓。</span></li>
              <li><b>3</b><span>所有人写出同一个词就成功；没撞上，从上一轮的词继续。</span></li>
            </ol>
            <button type="button" class="text-link" data-action="open-how">看完整规则</button>
          </section>
        </aside>
      </div>
    </main>
    ${siteFoot()}
  </div>`;
}

/* ----------------------------- Writing ----------------------------- */

function previousStrip(room) {
  const completed = Array.isArray(room.history) ? room.history : [];
  const rounds = (completed.length ? completed.slice(-2).reverse() : [room.lastRound]).filter(
    (round) => round && round.entries.length,
  );
  if (!rounds.length) return '';

  return rounds
    .map((round, index) => {
      const isOlder = index > 0;
      const title = isOlder ? 'ROUND BEFORE / 上上轮' : 'LAST ROUND / 上一轮';
      const note = isOlder
        ? '再往前一轮，看看联想是怎么走过来的'
        : '从这里继续联想，但不要直接抄';
      return `<section class="previous${isOlder ? ' previous-older' : ''}" aria-labelledby="previous-title-${round.round}">
        <div class="previous-head">
          <p class="eyebrow" id="previous-title-${round.round}">${title} · R${pad2(round.round)}</p>
          <span class="previous-note">${note}</span>
        </div>
        <div class="previous-words cols-${Math.min(round.entries.length, 4)}">
          ${round.entries
            .map(
              (entry) => `<div class="prev-word" style="--color:${esc(entry.color)}">
                <span>${esc(entry.name)}</span>
                <b>${entry.word ? esc(entry.word) : '（空）'}</b>
              </div>`,
            )
            .join('')}
        </div>
      </section>`;
    })
    .join('');
}

function playerRows(room) {
  return room.players
    .map((player) => {
      let status = '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>思考中';
      let stateClass = '';
      if (!player.connected) {
        status = '掉线';
        stateClass = 'offline';
      } else if (player.submitted) {
        status = '已提交 ✓';
        stateClass = 'done';
      }
      return `<li class="player-row">
        <span class="avatar avatar-sm" style="--soft:${esc(player.softColor)}" aria-hidden="true">${esc(firstRune(player.name))}</span>
        <span class="player-id"><b>${esc(player.name)}${player.isYou ? ' · 你' : ''}</b><small>${player.isHost ? '房主' : `P${player.seat + 1}`}${player.isYou ? ' · YOU' : ''}</small></span>
        <span class="player-state ${stateClass}">${status}</span>
      </li>`;
    })
    .join('');
}

function syncLabel() {
  return (
    {
      idle: '自动同步草稿',
      pending: '等待同步',
      saving: '正在同步',
      saved: '草稿已同步',
      error: '同步失败，重试中',
    }[S.save] || '自动同步草稿'
  );
}

function spectatorView(room) {
  const autoSubmit = room.durationSec === 20;
  return `<div class="spectator-view">
    <span class="spectator-view-eye" aria-hidden="true"><i></i></span>
    <h2>你在观战</h2>
    <p>${
      autoSubmit
        ? '20 秒极速模式：所有人只写草稿，倒计时结束自动一起揭晓。'
        : `${room.submittedCount} / ${room.players.length} 人已提交。提交的词会在揭晓时公开，现在只能看到谁写完了。`
    }</p>
    <div class="spectator-view-note">不写词 · 不点继续 · 揭晓时可看全员答案</div>
  </div>`;
}

function writingMarkup(room) {
  const viewer = room.viewer;
  const isSpectator = Boolean(viewer.isSpectator);
  const autoSubmit = room.durationSec === 20;
  const isFirst = room.round <= 1;
  const submitted = viewer.submitted;
  const max = room.maxWordLength;
  const runes = countRunes(S.draft);
  const progress = room.players
    .map(
      (player) =>
        `<span class="avatar avatar-sm${player.submitted ? ' done' : ''}" style="--soft:${esc(player.softColor)}" title="${esc(player.name)}${player.submitted ? ' · 已提交' : ' · 思考中'}">${esc(firstRune(player.name))}</span>`,
    )
    .join('');

  return `<div class="app-frame page-play">
    ${roomHeader(room)}
    <main class="play-main" id="main">
      <div class="play-top">
        <div>
          <p class="eyebrow">ROUND ${pad2(room.round)} / ${isSpectator ? '观战席' : isFirst ? '第一次碰撞' : '继续联想'}</p>
          <h1 class="play-title">${isSpectator ? '看他们<span>想到一起。</span>' : isFirst ? '写下<span>一个词。</span>' : '再靠近<span>一点。</span>'}</h1>
          <p class="play-sub">${
            isSpectator
              ? '你在观战。提交阶段看不到大家的词，倒计时结束或全员提交后会一起揭晓。'
              : autoSubmit
                ? '20 秒极速模式：没有提交按钮，倒计时结束自动用你已同步的草稿揭晓。'
                : isFirst
                  ? '不用解释，凭直觉写。猜一个你们会同时想到的词。'
                  : '上一轮已经摊牌。从这些词出发，找一个你们会共同想到的新词。'
          }</p>
        </div>
        <div class="timer-block">
          <div class="timer-meta"><span>TIME LEFT</span><strong>每轮 ${room.durationSec} 秒</strong></div>
          <div class="timer-dial" role="timer" aria-label="剩余时间" data-duration="${room.durationSec}">
            <div class="timer-inner"><small>TIME</small><b data-countdown>${room.durationSec}</b><em>SECONDS</em></div>
          </div>
        </div>
      </div>

      ${previousStrip(room)}

      <div class="playing-grid">
        <section class="word-panel${isSpectator ? ' word-panel-spectator' : ''}" aria-labelledby="composer-label">
          <div class="composer-top">
            <p class="composer-label" id="composer-label">${isSpectator ? 'SPECTATOR / 观战中' : 'YOUR WORD / 你的词'}</p>
            ${!isSpectator && !submitted ? `<span class="sync-state ${S.save} js-sync-state" title="超时揭晓时将使用最后一次同步成功的草稿">${syncLabel()}</span>` : ''}
          </div>

          ${
            isSpectator
              ? spectatorView(room)
              : submitted
                ? `<div class="submitted-view">
                    <div class="submitted-word">${esc(viewer.word || S.draft || '（空）')}</div>
                    <div class="submitted-stamp">已提交 · 锁定</div>
                    <p class="submitted-help">提交后不能修改。等其他人提交，或等倒计时结束一起揭晓。</p>
                  </div>`
                : `<div class="composer-body">
                    <div class="word-line">
                      <input class="word-input" id="word-input" name="word" type="text" maxlength="${max}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="一个词" aria-describedby="word-hint" value="${esc(S.draft)}" />
                      <span class="word-count" id="word-count">${runes}/${max}</span>
                    </div>
                    <div class="composer-caption">
                      <p class="composer-hint" id="word-hint">${
                        autoSubmit
                          ? '20 秒极速模式：写完不用提交，倒计时结束自动揭晓。'
                          : isFirst
                            ? '想想你们最容易同时想到的那个词。'
                            : '从上一轮的词继续联想，但不要直接抄。'
                      }</p>
                    </div>
                    <div class="composer-actions${autoSubmit ? ' auto-submit-actions' : ''}">
                      ${
                        autoSubmit
                          ? `<span class="auto-submit-badge">⚡ 自动提交</span>
                             <span class="submit-note">不设提交按钮<br />倒计时结束用已同步草稿揭晓</span>`
                          : `<button type="button" class="btn btn-primary" data-action="submit-word" ${!S.draft.trim() || S.submitBusy ? 'disabled' : ''}>${S.submitBusy ? '提交中…' : '提交这个词'}${!S.submitBusy ? ICONS.arrow : ''}</button>
                             <span class="submit-note">提交后不能修改<br />超时使用已同步草稿</span>`
                      }
                    </div>
                  </div>`
          }

          <div class="word-progress">
            <div class="progress-copy">
              <strong>${autoSubmit ? '⚡ 20 秒极速模式' : `${room.submittedCount} / ${room.players.length} 已提交`}</strong>
              <span>${autoSubmit ? '倒计时结束自动揭晓' : room.submittedCount === room.players.length ? '正在揭晓…' : '全员提交后立即揭晓'}</span>
            </div>
            <div class="progress-avatars" aria-label="${autoSubmit ? '20 秒极速模式，倒计时结束统一揭晓' : `${room.submittedCount} 人已提交`}">${progress}</div>
          </div>
        </section>

        <aside class="game-side">
          <section class="side-card" aria-labelledby="players-title">
            <div class="side-card-head"><h2 id="players-title">玩家</h2><span>${room.players.length} / ${room.maxPlayers}</span></div>
            <ul class="player-list">${playerRows(room)}</ul>
            ${spectatorStrip(room)}
            <div class="rule-note" style="margin-top:15px">
              ${
                isSpectator
                  ? '<b>你正在观战</b><p>不能写词、不能点继续。揭晓时可以看到所有玩家提交的词。</p>'
                  : autoSubmit
                    ? '<b>20 秒极速模式</b><p>没有提交按钮。倒计时结束后，系统会用你<strong>最后一次同步成功的草稿</strong>自动揭晓。空词不算成功。</p>'
                    : '<b>倒计时结束怎么办？</b><p>没用提交也没关系，系统会用你<strong>最后一次同步成功的草稿</strong>揭晓。空词不算成功。</p>'
              }
            </div>
          </section>

          <section class="side-card side-tips">
            <div class="side-card-head"><h2>同频提示</h2><span>NOTES</span></div>
            <ul class="tip-list">
              <li>要写「同一个词」，不是近义词。</li>
              <li>大小写、全半角、首尾空格不影响判定。</li>
              <li>不限轮数。没撞上，就顺着上一轮的词再想。</li>
            </ul>
          </section>
        </aside>
      </div>

      ${isSpectator ? chainMarkup(room) : ''}
    </main>
    ${siteFoot()}
  </div>`;
}

/* ----------------------------- Reveal ----------------------------- */

function continueBar(room) {
  const active = room.players.filter((player) => player.connected);
  const canAdvance = active.length >= 2;
  const remaining = Math.max(0, room.ready.needed - room.ready.count);
  const allReady = room.ready.all;
  const won = room.phase === 'won';
  const isSpectator = Boolean(room.viewer.isSpectator);
  const viewerReady = room.viewer.continued;
  if (isSpectator) {
    const title = allReady
      ? '全员已继续'
      : remaining === active.length
        ? '等玩家看完'
        : `还差 ${remaining} 人继续`;
    const sub = allReady
      ? '正在进入下一轮…'
      : won
        ? '你在观战，等玩家点「再来一局」。'
        : '你在观战，玩家全部点继续后自动进入下一轮。';
    return `<section class="continue-bar spectator-continue" aria-label="观战继续状态">
      <div class="ready-cluster">
        <div class="ready-avatars" aria-hidden="true">
          ${room.players
            .map(
              (player) =>
                `<span class="avatar avatar-sm${player.continued ? ' ready' : ''}" style="--soft:${esc(player.softColor)}" title="${esc(player.name)}${player.continued ? ' · 已继续' : ' · 还在看'}">${esc(firstRune(player.name))}</span>`,
            )
            .join('')}
        </div>
        <div class="ready-copy"><strong>${title}</strong><span>${sub}</span></div>
      </div>
      <span class="spectator-continue-badge">观战席</span>
    </section>`;
  }
  let title = allReady ? '全员已继续' : `还差 ${remaining} 人继续`;
  if (!canAdvance) title = '等待其他人上线';
  let sub = allReady ? '正在进入下一轮…' : '全员点击后，下一轮自动开始。掉线玩家不计入。';
  if (!canAdvance) sub = '至少需要 2 人在线，才能开始下一轮。';
  if (won) {
    title = allReady
      ? '全员已继续'
      : remaining === active.length
        ? '等大家确认再来'
        : `还差 ${remaining} 人确认再来`;
    sub = allReady ? '正在用同一组人再来一局…' : '全员点击「再来一局」，用同一组人重新调频。';
  }

  return `<section class="continue-bar" aria-label="继续状态">
    <div class="ready-cluster">
      <div class="ready-avatars" aria-hidden="true">
        ${room.players
          .map(
            (player) =>
              `<span class="avatar avatar-sm${player.continued ? ' ready' : ''}" style="--soft:${esc(player.softColor)}" title="${esc(player.name)}${player.continued ? ' · 已继续' : ' · 还在看'}">${esc(firstRune(player.name))}</span>`,
          )
          .join('')}
      </div>
      <div class="ready-copy"><strong>${title}</strong><span>${sub}</span></div>
    </div>
    <button type="button" class="btn btn-light" data-action="continue" ${viewerReady || !canAdvance || S.continueBusy ? 'disabled' : ''}>
      ${S.continueBusy ? '正在继续…' : viewerReady ? '已继续 · 等待' : !canAdvance ? '等待中' : won ? '再来一局' : '继续下一轮'}
      ${!S.continueBusy && !viewerReady && canAdvance ? ICONS.arrow : ''}
    </button>
  </section>`;
}

function chainMarkup(room) {
  if (!room.history.length) return '';
  return `<section class="chain" aria-labelledby="chain-title">
    <div class="chain-head">
      <h2 id="chain-title">这一局的词链</h2>
      <span>${room.history.length} ROUND${room.history.length > 1 ? 'S' : ''} · UNLIMITED</span>
    </div>
    <div class="chain-list">
      ${room.history
        .map(
          (round) => `<div class="chain-round">
            <div class="chain-round-label"><b>第 ${pad2(round.round)} 轮</b><br />${round.endedBy === 'timeout' ? '时间到' : '全员提交'}</div>
            <div class="chain-words">
              ${round.entries
                .map(
                  (entry) => `<span class="chain-word" style="border-left:3px solid ${esc(entry.color)}"><small>${esc(entry.name)}</small><b>${entry.word ? esc(entry.word) : '（空）'}</b></span>`,
                )
                .join('')}
              ${round.allSame ? '<span class="chain-success">同频成功</span>' : ''}
            </div>
          </div>`,
        )
        .join('')}
    </div>
  </section>`;
}

function revealMarkup(room) {
  const result = room.result;
  if (!result) return lobbyMarkup(room);
  const isSpectator = Boolean(room.viewer.isSpectator);
  const allSame = result.allSame;
  const entries = result.entries;
  const emptyCount = entries.filter((entry) => !entry.word).length;
  const distinct = new Set(entries.map((entry) => normalizeWord(entry.word).toLocaleLowerCase()).filter(Boolean)).size;
  const count = entries.length;
  const reason = result.endedBy === 'timeout' ? '时间到，自动揭晓' : '全员提交，立即揭晓';
  let sub;
  if (allSame) {
    sub = `${count} 个人，在同一个词上碰头。${result.endedBy === 'timeout' ? '倒计时结束时完成了同频。' : '没有商量，就是想到一起了。'}`;
  } else if (emptyCount) {
    sub = `有 ${emptyCount} 个位置还空着。下一轮，从已经写下的词继续。`;
  } else {
    sub = `第 ${room.round} 轮，${count} 个人写出了 ${distinct} 种答案。看看彼此的联想，再从这些词出发。`;
  }

  return `<div class="app-frame page-reveal">
    ${roomHeader(room)}
    <main class="reveal-main" id="main">
      <section class="reveal-hero">
        <p class="eyebrow">ROUND ${pad2(room.round)} / REVEAL</p>
        <h1 class="reveal-title${allSame ? ' success' : ''}">${allSame ? '同频了。' : '差一点。'}</h1>
        <p class="reveal-sub">${sub}</p>
        <div class="reveal-badge"><i></i>${esc(reason)} · ${count} 个词</div>
      </section>

      <section class="reveal-grid" style="--cols:${count}" aria-label="本轮所有人写下的词">
        ${entries
          .map((entry, index) => {
            const sameCount = entries.filter(
              (candidate) =>
                normalizeWord(candidate.word) &&
                normalizeWord(candidate.word).toLocaleLowerCase() ===
                  normalizeWord(entry.word).toLocaleLowerCase(),
            ).length;
            return `<article class="reveal-card" style="--card-color:${esc(entry.color)};--delay:${(index * 0.075).toFixed(2)}s">
              <div class="reveal-card-head">
                <span class="avatar avatar-sm" style="--soft:${esc(entry.color)}33;border-color:${esc(entry.color)}" aria-hidden="true">${esc(firstRune(entry.name))}</span>
                <span class="reveal-player"><b>${esc(entry.name)}</b><span>PLAYER ${pad2(index + 1)}</span></span>
              </div>
              <div class="reveal-card-word${entry.word ? '' : ' empty'}">${entry.word ? esc(entry.word) : '（空词）'}</div>
              <div class="reveal-card-foot">
                <span>${ROUND_FOOT_LABELS[index] || `P${index + 1}`}</span>
                ${
                  entry.word && sameCount > 1
                    ? `<span class="match-mark">${sameCount} 人同词</span>`
                    : `<span>${entry.word ? '独自一词' : '未写词'}</span>`
                }
              </div>
            </article>`;
          })
          .join('')}
      </section>

      ${continueBar(room)}

      <div class="reveal-tip-row">
        <p><strong>${allSame ? '这一局结束。' : '没有标准答案。'}</strong>${
          isSpectator
            ? allSame
              ? '玩家点「再来一局」后会保留原班人马重新调频，你继续留在观战席。'
              : '玩家全员继续后，下一轮自动开始，你继续留在观战席。'
            : allSame
              ? '点击「再来一局」，保留原班人马重新调频。'
              : '点击「继续下一轮」，把这一轮留在词链里，再从这些词继续想。'
        }</p>
        <button type="button" class="text-link" data-action="open-how">查看完整规则</button>
      </div>

      ${chainMarkup(room)}
    </main>
    ${siteFoot()}
  </div>`;
}

const ROUND_FOOT_LABELS = ['A / 01', 'B / 02', 'C / 03', 'D / 04'];

/* ----------------------------- Modal ----------------------------- */

function renderModal() {
  const root = $('#modal-root');
  if (!root) return;
  if (!S.modal) {
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
    if (S.lastFocus && document.contains(S.lastFocus)) {
      try {
        S.lastFocus.focus({ preventScroll: true });
      } catch {
        // Ignore.
      }
    }
    S.lastFocus = null;
    return;
  }

  document.body.classList.add('modal-open');
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="how-title" tabindex="-1">
      <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭玩法说明">×</button>
      <p class="eyebrow">HOW TO PLAY / 玩法</p>
      <h2 id="how-title">想到一起，<br /><span>才算数。</span></h2>
      <p class="modal-lede">这是一个关于“默契”的合作实验。你们不是在互相猜，而是在寻找同一个联想方向。</p>
      <ol class="rules-list">
        <li>
          <span class="rule-index">01</span>
          <div><h3>各写一个词</h3><p>2–4 人各自想一个词，<strong>不能讨论</strong>，也不能提示队友。</p></div>
        </li>
        <li>
          <span class="rule-index">02</span>
          <div><h3>一起揭晓</h3><p>所有人提交后立即揭晓；如果时间到了，就用你<strong>最后一次同步成功的草稿</strong>。提交后不能修改。</p></div>
        </li>
        <li>
          <span class="rule-index">03</span>
          <div><h3>同词即成功</h3><p>所有人写出<strong>相同的非空词语</strong>才算成功，不限轮数。大小写、全半角和首尾空格不影响判定。</p></div>
        </li>
        <li>
          <span class="rule-index">04</span>
          <div><h3>从词继续</h3><p>没撞上也没关系。看看大家写了什么，从上一轮的词继续联想。揭晓后<strong>全员点击继续</strong>，才开始下一轮。</p></div>
        </li>
      </ol>
      <div class="modal-foot">
        <span>2–4 人 · 合作模式 · 一个链接</span>
        <button type="button" class="btn btn-primary" data-action="close-modal">知道了 ${ICONS.arrow}</button>
      </div>
    </section>
  </div>`;

  const closeButton = $('.modal-close');
  if (closeButton) {
    // Opening the dialog should put focus somewhere useful, but not steal it
    // when the modal is re-rendered by unrelated state.
    if (!root.dataset.focused) {
      root.dataset.focused = '1';
      requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));
    }
  }
}

function closeModal() {
  S.modal = null;
  const root = $('#modal-root');
  if (root) delete root.dataset.focused;
  renderModal();
}

function openHow() {
  S.lastFocus = document.activeElement;
  S.modal = 'how';
  const root = $('#modal-root');
  if (root) delete root.dataset.focused;
  renderModal();
}

/* ----------------------------- Render ----------------------------- */

function pageTitle() {
  if (!S.room) return '同频 · 想到一起，才算数';
  const prefix = S.room.viewer?.isSpectator ? '观战 · ' : '';
  if (S.room.phase === 'lobby') return `${prefix}房间 ${S.room.code} · 同频`;
  if (S.room.phase === 'writing') return `${prefix}第 ${S.room.round} 轮 · 同频`;
  return `${prefix}第 ${S.room.round} 轮揭晓 · 同频`;
}

function render() {
  const app = $('#app');
  if (!app) return;

  const active = document.activeElement;
  const activeId = active && active.id ? active.id : null;
  let selectionStart = null;
  let selectionEnd = null;
  if (activeId && typeof active.selectionStart === 'number') {
    selectionStart = active.selectionStart;
    selectionEnd = active.selectionEnd;
  }

  if (S.booting && !S.room) {
    app.innerHTML = bootMarkup();
  } else if (!S.room) {
    app.innerHTML = homeMarkup();
  } else if (S.room.phase === 'lobby') {
    app.innerHTML = lobbyMarkup(S.room);
  } else if (S.room.phase === 'writing') {
    app.innerHTML = writingMarkup(S.room);
  } else {
    app.innerHTML = revealMarkup(S.room);
  }

  document.title = pageTitle();
  document.body.dataset.phase = S.room ? S.room.phase : 'home';
  updateStreamUI();

  if (activeId) {
    const restored = document.getElementById(activeId);
    if (restored && typeof restored.focus === 'function') {
      try {
        restored.focus({ preventScroll: true });
        if (selectionStart !== null && typeof restored.setSelectionRange === 'function') {
          restored.setSelectionRange(selectionStart, selectionEnd);
        }
      } catch {
        // Ignore.
      }
    }
  }

  if (S.focusWord && S.room?.phase === 'writing' && !S.room.viewer.submitted) {
    S.focusWord = false;
    if (window.matchMedia?.('(pointer: fine)').matches) {
      requestAnimationFrame(() => $('#word-input')?.focus({ preventScroll: true }));
    }
  }

  if (S.focusField) {
    const selector = S.focusField;
    S.focusField = null;
    requestAnimationFrame(() => document.getElementById(selector)?.focus({ preventScroll: true }));
  }
}

/* ----------------------------- API ----------------------------- */

async function api(pathname, body, options = {}) {
  let response;
  try {
    response = await fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: Boolean(options.keepalive),
    });
  } catch {
    const error = new Error('连接不到服务器。请刷新页面；如果仍然不行，把最新链接重新发一次。');
    error.status = 0;
    error.network = true;
    throw error;
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Ignore malformed error responses.
  }
  if (!response.ok) {
    const error = new Error(payload.error || '请求失败，再试一次。');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function credentialsBody(extra = {}) {
  return {
    code: S.creds?.code || '',
    playerId: S.creds?.playerId || '',
    token: S.creds?.token || '',
    role: S.creds?.role || 'player',
    ...extra,
  };
}

async function refreshState() {
  if (!S.creds || refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const query = new URLSearchParams({
        code: S.creds.code,
        playerId: S.creds.playerId,
        token: S.creds.token,
        role: S.creds.role || 'player',
      });
      const response = await fetch(`/api/state?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        // Ignore.
      }
      if (!response.ok) {
        const error = new Error(payload.error || '无法同步房间状态。');
        error.status = response.status;
        throw error;
      }
      if (payload.state) applyState(payload.state);
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        lostRoom(error.message);
      }
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/* ----------------------------- Session ----------------------------- */

function sessionKey(code) {
  return `tongpin.session.${code}`;
}

function loadSession(code) {
  try {
    const raw = localStorage.getItem(sessionKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.playerId || !parsed.token) return null;
    return {
      ...parsed,
      role: parsed.role === 'spectator' ? 'spectator' : 'player',
    };
  } catch {
    return null;
  }
}

function saveSession(data) {
  try {
    localStorage.setItem(
      sessionKey(data.code),
      JSON.stringify({
        playerId: data.playerId,
        token: data.token,
        role: data.role === 'spectator' ? 'spectator' : 'player',
        name: S.name,
        savedAt: Date.now(),
      }),
    );
    localStorage.setItem('tongpin.name', S.name);
  } catch {
    // Private mode can reject storage; the game still works for this tab.
  }
}

function clearSession(code) {
  try {
    if (code) localStorage.removeItem(sessionKey(code));
  } catch {
    // Ignore.
  }
}

function loadPreferences() {
  try {
    S.name = localStorage.getItem('tongpin.name') || '';
    S.sound = localStorage.getItem('tongpin.sound') !== 'off';
  } catch {
    S.name = '';
    S.sound = true;
  }
}

/* ----------------------------- Room flow ----------------------------- */

function adoptCredentials(data) {
  const role = data.role === 'spectator' ? 'spectator' : 'player';
  S.creds = {
    code: data.code,
    playerId: data.playerId,
    token: data.token,
    role,
  };
  S.room = data.state;
  S.lastStateSignature = null;
  S.booting = false;
  S.busy = false;
  S.formError = '';
  S.lost = false;
  S.expiredRequested = false;
  S.clockOffset = data.state.serverNow - Date.now();
  S.modal = null;
  if (role === 'spectator') {
    const spectator = data.state.spectators.find((entry) => entry.isYou);
    if (spectator) S.name = spectator.name;
  } else {
    const player = data.state.players.find((entry) => entry.isYou);
    if (player) S.name = player.name;
  }
  S.draft = data.state.viewer?.draft || '';
  lastSavedDraft = S.draft;
  S.save = 'idle';
  S.focusWord =
    role === 'player' &&
    data.state.phase === 'writing' &&
    !data.state.viewer?.submitted;
  saveSession({ ...data, role });
  const nextUrl =
    role === 'spectator'
      ? `/?room=${encodeURIComponent(data.code)}&watch=1`
      : `/?room=${encodeURIComponent(data.code)}`;
  if (location.pathname + location.search !== nextUrl) {
    history.replaceState(null, '', nextUrl);
  }
  closeStream();
  connectStream();
  render();
  if (role === 'player' && data.state.phase === 'writing') {
    requestAnimationFrame(() => $('#word-input')?.focus({ preventScroll: true }));
  }
}

async function handleEntry() {
  if (S.busy) return;
  const rawName = $('#player-name')?.value.trim() || '';
  const isJoin = S.tab === 'join';
  const isWatch = S.tab === 'watch';
  const name = rawName || (isWatch ? '观众' : '');
  const code = normalizeCode($('#join-code')?.value || S.joinCode);
  S.name = rawName;
  S.joinCode = code;
  if (!name) {
    S.formError = '先给自己起个名字吧。';
    S.focusField = 'player-name';
    render();
    return;
  }
  if ((isJoin || isWatch) && code.length !== 4) {
    S.formError = '输入四位房间码，再试一次。';
    S.focusField = 'join-code';
    render();
    return;
  }
  S.formError = '';
  S.busy = true;
  render();
  try {
    const data = isWatch
      ? await api('/api/rooms/spectate', { code, name })
      : isJoin
        ? await api('/api/rooms/join', { code, name })
        : await api('/api/rooms', { name });
    S.busy = false;
    adoptCredentials(data);
  } catch (error) {
    S.busy = false;
    S.formError = error.message;
    render();
    S.focusField = isJoin || isWatch ? 'join-code' : 'player-name';
    render();
  }
}

async function setDuration(seconds) {
  if (!S.room || !S.creds || S.room.phase !== 'lobby' || !S.room.viewer.isHost) return;
  try {
    const data = await api('/api/duration', credentialsBody({ seconds: Number(seconds) }));
    if (data.state) applyState(data.state);
    if (Number(seconds) === 20) {
      showToast('20 秒极速模式：没有提交按钮，倒计时结束自动揭晓。');
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function startGame() {
  if (!S.room || !S.room.canStart || S.startBusy) return;
  S.startBusy = true;
  render();
  try {
    const data = await api('/api/start', credentialsBody());
    S.startBusy = false;
    if (data.state) applyState(data.state);
    else await refreshState();
  } catch (error) {
    S.startBusy = false;
    showToast(error.message);
    render();
  }
}

async function submitWord() {
  if (S.submitBusy) return;
  if (
    !S.room ||
    S.room.phase !== 'writing' ||
    S.room.viewer.isSpectator ||
    S.room.viewer.submitted
  ) {
    return;
  }
  if (S.room.durationSec === 20) {
    showToast('20 秒模式不用提交，倒计时结束会自动揭晓。');
    return;
  }
  const word = S.draft.trim();
  if (!word) {
    showToast('写一个词再提交。');
    $('#word-input')?.focus();
    return;
  }

  clearTimeout(saveTimer);
  saveTimer = null;
  S.submitBusy = true;
  updateComposerUI();
  try {
    const data = await api(
      '/api/submit',
      credentialsBody({ word, round: S.room.round }),
    );
    if (data.state?.phase !== 'won') playSound('submit');
    if (data.state) applyState(data.state);
    else await refreshState();
  } catch (error) {
    showToast(error.message);
    if (error.status === 409 || error.status === 401) await refreshState();
    if (canSaveDraft()) queueDraftSave(120);
  } finally {
    S.submitBusy = false;
    updateComposerUI();
  }
}

async function continueRound() {
  if (!S.room || S.continueBusy || S.room.viewer.continued) return;
  if (S.room.viewer.isSpectator) return;
  if (S.room.phase !== 'reveal' && S.room.phase !== 'won') return;
  if (S.room.players.filter((player) => player.connected).length < 2) return;
  S.continueBusy = true;
  const button = $('[data-action="continue"]');
  if (button) {
    button.disabled = true;
    button.textContent = '正在继续…';
  }
  try {
    const data = await api(
      '/api/continue',
      credentialsBody({ round: S.room.round }),
    );
    if (data.state) applyState(data.state);
    else await refreshState();
  } catch (error) {
    showToast(error.message);
    await refreshState();
    S.continueBusy = false;
    render();
  } finally {
    S.continueBusy = false;
  }
}

async function leaveLobby() {
  if (!S.room) return;
  const isSpectator = Boolean(S.room.viewer.isSpectator);
  if (!isSpectator && S.room.phase !== 'lobby') return;
  const confirmed = window.confirm(
    isSpectator ? '退出观战席？' : '退出这个房间？你的座位会空出来。',
  );
  if (!confirmed) return;
  const code = S.room.code;
  try {
    await api(
      isSpectator ? '/api/spectate/leave' : '/api/leave',
      credentialsBody(),
    );
    goHome(code);
  } catch (error) {
    showToast(error.message);
    await refreshState();
  }
}

function goHome(code) {
  closeStream();
  const leavingCode = code || S.creds?.code;
  if (leavingCode) clearSession(leavingCode);
  S.creds = null;
  S.room = null;
  S.modal = null;
  S.lastStateSignature = null;
  S.booting = false;
  S.busy = false;
  S.startBusy = false;
  S.continueBusy = false;
  S.submitBusy = false;
  S.draft = '';
  S.save = 'idle';
  S.formError = '';
  S.lost = false;
  S.stream = 'idle';
  S.tab = 'create';
  S.joinCode = '';
  closeModal();
  history.pushState(null, '', '/');
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function lostRoom(message) {
  if (S.lost) return;
  S.lost = true;
  const code = S.creds?.code || S.room?.code;
  closeStream();
  if (code) clearSession(code);
  S.creds = null;
  S.room = null;
  S.lastStateSignature = null;
  S.booting = false;
  S.busy = false;
  S.startBusy = false;
  S.continueBusy = false;
  S.submitBusy = false;
  S.formError = message || '房间已结束，或你的身份已经失效。请重新加入。';
  S.tab = 'join';
  S.joinCode = '';
  S.modal = null;
  closeModal();
  history.replaceState(null, '', '/');
  render();
  showToast('房间已结束，重新开一局吧。');
}

/* ----------------------------- State ----------------------------- */

function stateSignature(state) {
  const { serverNow, revision, viewer, ...stable } = state;
  const stableViewer = { ...viewer };
  // Drafts are owned by the composer locally; polling must not re-render the
  // input just because a debounced draft save reached the server.
  delete stableViewer.draft;
  void serverNow;
  void revision;
  return JSON.stringify({ ...stable, viewer: stableViewer });
}

function applyState(next) {
  const previous = S.room;
  if (
    previous &&
    Number.isInteger(previous.revision) &&
    Number.isInteger(next.revision) &&
    next.revision < previous.revision
  ) {
    return;
  }
  const signature = stateSignature(next);
  const onlyClockChanged = Boolean(previous) && signature === S.lastStateSignature;
  const roundChanged = !previous || previous.round !== next.round;
  const phaseChanged = !previous || previous.phase !== next.phase;
  const isNewWritingRound =
    next.phase === 'writing' && (!previous || previous.phase !== 'writing' || roundChanged);

  S.room = next;
  S.clockOffset = next.serverNow - Date.now();
  S.streamErrors = 0;

  if (onlyClockChanged) {
    return;
  }
  S.lastStateSignature = signature;

  if (next.viewer.submitted) {
    S.draft = next.viewer.word || S.draft;
  }

  if (isNewWritingRound) {
    S.draft = next.viewer.draft || '';
    lastSavedDraft = S.draft;
    S.save = 'idle';
    S.expiredRequested = false;
    S.focusWord = !next.viewer.isSpectator;
    S.submitBusy = false;
  }

  if (next.phase !== 'writing') {
    S.save = 'idle';
    S.submitBusy = false;
  }
  if (next.phase !== 'lobby') S.startBusy = false;

  if (phaseChanged || roundChanged) {
    if (previous?.phase === 'writing' && next.phase === 'won') {
      playSound('reveal');
      window.setTimeout(() => playSound('win'), 360);
      setTimeout(launchConfetti, 100);
    } else if (previous?.phase === 'writing' && next.phase === 'reveal') {
      playSound('reveal');
    } else if (previous?.phase === 'lobby' && next.phase === 'writing') {
      playSound('start');
    } else if (previous?.phase === 'reveal' && next.phase === 'writing') {
      playSound('start');
    } else if (previous?.phase === 'won' && next.phase === 'writing') {
      playSound('start');
    }
  }

  if (next.phase === 'won' && !previous) {
    // Reconnecting directly into a won screen should not replay confetti.
  }

  render();
  updateStreamUI();

  if (previous && (phaseChanged || roundChanged)) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (next.phase === 'writing' && !next.viewer.isSpectator) {
      requestAnimationFrame(() => $('#word-input')?.focus({ preventScroll: true }));
    }
  }
}

/* ----------------------------- Draft sync ----------------------------- */

function canSaveDraft() {
  return Boolean(
    S.creds &&
      S.room?.phase === 'writing' &&
      !S.room.viewer.isSpectator &&
      !S.room.viewer.submitted,
  );
}

function updateSaveUI() {
  const element = $('.js-sync-state');
  if (!element) return;
  element.classList.remove('idle', 'pending', 'saving', 'saved', 'error');
  element.classList.add(S.save);
  element.textContent = syncLabel();
}

function updateComposerUI() {
  const input = $('#word-input');
  const count = $('#word-count');
  const button = $('[data-action="submit-word"]');
  if (input) {
    const max = S.room?.maxWordLength || 24;
    if (count) count.textContent = `${countRunes(input.value)}/${max}`;
  }
  if (button) {
    button.disabled = Boolean(S.submitBusy) || !String(input?.value ?? S.draft).trim();
  }
  updateSaveUI();
}

function queueDraftSave(delay = 360) {
  if (!canSaveDraft()) return;
  S.save = S.save === 'error' ? 'error' : 'pending';
  updateSaveUI();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(sendDraft, delay);
}

async function sendDraft() {
  saveTimer = null;
  if (!canSaveDraft()) return;
  if (draftInFlight) {
    draftQueued = true;
    return;
  }
  if (comparableDraft(S.draft) === comparableDraft(lastSavedDraft)) {
    S.save = 'saved';
    updateSaveUI();
    return;
  }

  draftInFlight = true;
  draftQueued = false;
  S.save = 'saving';
  updateSaveUI();
  const sent = S.draft;
  const round = S.room.round;
  try {
    const data = await api('/api/draft', credentialsBody({ draft: sent, round }));
    lastSavedDraft = data.draft ?? sent;
    if (comparableDraft(S.draft) === comparableDraft(lastSavedDraft)) {
      S.save = 'saved';
    } else {
      S.save = 'pending';
    }
  } catch (error) {
    if (error.status === 401 || error.status === 404) {
      lostRoom(error.message);
      return;
    }
    if (error.status === 409) {
      await refreshState();
      return;
    }
    S.save = 'error';
    draftQueued = true;
  } finally {
    draftInFlight = false;
    updateSaveUI();
    if (canSaveDraft()) {
      const mismatch = comparableDraft(S.draft) !== comparableDraft(lastSavedDraft);
      if (draftQueued || mismatch) {
        draftQueued = false;
        queueDraftSave(S.save === 'error' ? 1800 : 140);
      } else if (S.save === 'error') {
        clearTimeout(saveRetryTimer);
        saveRetryTimer = setTimeout(sendDraft, 2200);
      }
    }
  }
}

function flushDraftKeepalive() {
  if (!canSaveDraft() || !S.creds) return;
  if (comparableDraft(S.draft) === comparableDraft(lastSavedDraft)) return;
  try {
    fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentialsBody({ draft: S.draft, round: S.room.round })),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore.
  }
}

/* ----------------------------- Streams ----------------------------- */

function updateStreamUI() {
  const dot = $('.js-connection-dot');
  if (!dot) return;
  const active = S.stream === 'live' || S.stream === 'polling';
  const reconnecting = S.stream === 'connecting' || S.stream === 'reconnecting';
  dot.classList.toggle('reconnecting', reconnecting);
  dot.classList.toggle('offline', !active && !reconnecting);
  dot.title = active
    ? S.stream === 'polling'
      ? '公网同步正常'
      : '实时连接正常'
    : reconnecting
      ? '正在连接房间…'
      : '未连接';
}

function closeStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  S.stream = 'idle';
  updateStreamUI();
}

function connectStream() {
  if (!S.creds) return;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (FORCE_POLLING) {
    S.stream = 'polling';
    updateStreamUI();
    return;
  }
  S.stream = 'connecting';
  updateStreamUI();
  const query = new URLSearchParams({
    code: S.creds.code,
    playerId: S.creds.playerId,
    token: S.creds.token,
    role: S.creds.role || 'player',
  });
  const source = new EventSource(`/api/events?${query.toString()}`);
  eventSource = source;

  source.addEventListener('open', () => {
    if (eventSource !== source) return;
    S.stream = 'live';
    S.streamErrors = 0;
    updateStreamUI();
  });

  source.addEventListener('state', (event) => {
    if (eventSource !== source) return;
    try {
      const next = JSON.parse(event.data);
      S.stream = 'live';
      S.streamErrors = 0;
      updateStreamUI();
      applyState(next);
    } catch {
      // Ignore malformed frames.
    }
  });

  source.onerror = () => {
    if (eventSource !== source) return;
    S.stream = 'reconnecting';
    S.streamErrors += 1;
    updateStreamUI();
    if (S.streamErrors === 3) showToast('连接有点不稳，正在重连…');
    if (S.streamErrors === 5) refreshState();
    if (source.readyState === EventSource.CLOSED) {
      window.setTimeout(() => {
        if (eventSource === source && S.room) connectStream();
      }, 3200);
    }
  };
}

/* ----------------------------- Timer ----------------------------- */

function tick() {
  if (!S.room || S.room.phase !== 'writing' || !S.room.phaseEndsAt) {
    return;
  }
  const remaining = Math.max(0, S.room.phaseEndsAt - (Date.now() + S.clockOffset));
  const seconds = Math.ceil(remaining / 1000);
  const dial = $('.timer-dial');
  const number = $('[data-countdown]');
  if (number) number.textContent = String(seconds);
  if (dial) {
    const total = Math.max(1, (S.room.phaseEndsAt - S.room.roundStartedAt) || S.room.durationSec * 1000);
    const progress = Math.max(0, Math.min(1, remaining / total));
    dial.style.setProperty('--progress', progress.toFixed(4));
    dial.classList.toggle('is-urgent', remaining <= 10_000 && remaining > 0);
    dial.setAttribute('aria-label', `剩余 ${seconds} 秒`);
  }

  if (S.lastTitleSecond !== seconds) {
    S.lastTitleSecond = seconds;
    document.title = `${S.room.viewer?.isSpectator ? '观战 · ' : ''}${seconds} 秒 · 第 ${S.room.round} 轮 · 同频`;
  }

  if (remaining <= 0 && !S.expiredRequested) {
    S.expiredRequested = true;
    window.setTimeout(async () => {
      await refreshState();
      if (S.room?.phase === 'writing' && Date.now() > (S.room.phaseEndsAt || 0) + 1500) {
        S.expiredRequested = false;
      }
    }, 280);
  }
}

/* ----------------------------- Audio ----------------------------- */

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioContext = new AudioCtor();
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function playSound(kind) {
  if (!S.sound) return;
  try {
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime + 0.01;
    const sequences = {
      click: [[520, 0, 0.055, 0.025]],
      submit: [[660, 0, 0.09, 0.035], [880, 0.06, 0.12, 0.025]],
      continue: [[440, 0, 0.08, 0.03], [590, 0.06, 0.1, 0.025]],
      start: [[392, 0, 0.1, 0.03], [523, 0.08, 0.13, 0.03]],
      reveal: [
        [1046.5, 0, 0.16, 0.055],
        [783.99, 0.16, 0.3, 0.045],
      ],
      win: [
        [523, 0, 0.13, 0.035],
        [659, 0.1, 0.13, 0.035],
        [784, 0.2, 0.15, 0.035],
        [1046, 0.31, 0.32, 0.03],
      ],
    };
    const notes = sequences[kind] || sequences.click;
    for (const [frequency, offset, duration, volume] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === 'win' || kind === 'reveal' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(volume, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + duration + 0.03);
    }
  } catch {
    // Audio is a nice-to-have; never let it interrupt the game.
  }
}

function toggleSound() {
  S.sound = !S.sound;
  try {
    localStorage.setItem('tongpin.sound', S.sound ? 'on' : 'off');
  } catch {
    // Ignore.
  }
  const button = $('[data-action="toggle-sound"]');
  if (button) {
    button.innerHTML = S.sound ? ICONS.sound : ICONS.soundOff;
    button.setAttribute('aria-pressed', String(S.sound));
    button.setAttribute('aria-label', S.sound ? '关闭声音' : '打开声音');
    button.title = S.sound ? '关闭声音' : '打开声音';
  }
  if (S.sound) playSound('click');
}

function launchConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = $('#confetti-layer');
  if (!layer) return;
  const colors = ['#ff5a36', '#177d73', '#3858d6', '#f0bf4c', '#17150f', '#f8f3e8'];
  const count = 44;
  const fragments = [];
  for (let index = 0; index < count; index += 1) {
    const x = Math.random() * 100;
    const width = 5 + Math.random() * 7;
    const height = 7 + Math.random() * 12;
    const color = colors[index % colors.length];
    const delay = Math.random() * 0.35;
    const duration = 2.1 + Math.random() * 1.4;
    const drift = `${(Math.random() - 0.5) * 28}vw`;
    const rotation = `${Math.random() * 360}deg`;
    fragments.push(
      `<span class="confetti" style="--x:${x.toFixed(2)}%;--w:${width.toFixed(1)}px;--h:${height.toFixed(1)}px;--c:${color};--delay:${delay.toFixed(2)}s;--dur:${duration.toFixed(2)}s;--drift:${drift};--r:${rotation}"></span>`,
    );
  }
  layer.innerHTML = fragments.join('');
  window.setTimeout(() => {
    if (layer) layer.innerHTML = '';
  }, 3800);
}

/* ----------------------------- Toast ----------------------------- */

function showToast(message) {
  const region = $('#toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.id = `toast-${++toastCounter}`;
  toast.textContent = String(message);
  region.append(toast);
  while (region.children.length > 3) region.firstElementChild.remove();
  window.setTimeout(() => {
    toast.classList.add('out');
    window.setTimeout(() => toast.remove(), 260);
  }, 2800);
}

/* ----------------------------- Copy ----------------------------- */

async function copyText(text, message) {
  const value = String(text || '');
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      throw new Error('clipboard unavailable');
    }
  } catch {
    try {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      input.style.top = '-1000px';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied) throw new Error('copy failed');
    } catch {
      showToast('复制失败，请手动选中链接。');
      return;
    }
  }
  showToast(message || '已复制');
}

/* ----------------------------- Events ----------------------------- */

function syncFormValues() {
  const nameInput = $('#player-name');
  const codeInput = $('#join-code');
  if (nameInput) S.name = nameInput.value;
  if (codeInput) S.joinCode = normalizeCode(codeInput.value);
}

function onClick(event) {
  const backdrop = $('#modal-backdrop');
  if (backdrop && event.target === backdrop) {
    closeModal();
    return;
  }

  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'open-how':
      event.preventDefault();
      openHow();
      break;
    case 'close-modal':
      event.preventDefault();
      closeModal();
      break;
    case 'switch-tab': {
      event.preventDefault();
      syncFormValues();
      const tab = target.dataset.tab;
      S.tab = tab === 'join' || tab === 'watch' ? tab : 'create';
      S.formError = '';
      render();
      requestAnimationFrame(() => {
        const id = S.tab === 'create' ? 'player-name' : 'join-code';
        document.getElementById(id)?.focus({ preventScroll: true });
      });
      break;
    }
    case 'copy-code':
      event.preventDefault();
      if (S.room) copyText(S.room.code, '房间码已复制');
      break;
    case 'copy-invite': {
      event.preventDefault();
      const links = inviteLinks();
      copyText(links.primary, '邀请链接已复制，发给朋友吧');
      break;
    }
    case 'copy-watch': {
      event.preventDefault();
      const links = inviteLinks();
      copyText(links.watch, '观战链接已复制，不占玩家名额');
      break;
    }
    case 'copy-share': {
      event.preventDefault();
      const links = inviteLinks();
      copyText(shareMessage(links), '房间链接和观战链接已一起复制');
      break;
    }
    case 'toggle-sound':
      event.preventDefault();
      toggleSound();
      break;
    case 'set-duration':
      event.preventDefault();
      setDuration(Number(target.dataset.seconds));
      break;
    case 'start-game':
      event.preventDefault();
      startGame();
      break;
    case 'submit-word':
      event.preventDefault();
      submitWord();
      break;
    case 'continue':
      event.preventDefault();
      continueRound();
      break;
    case 'leave-lobby':
      event.preventDefault();
      leaveLobby();
      break;
    default:
      break;
  }
}

function onInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.id === 'player-name') {
    S.name = target.value;
    return;
  }

  if (target.id === 'join-code') {
    const normalized = normalizeCode(target.value);
    if (target.value !== normalized) target.value = normalized;
    S.joinCode = normalized;
    return;
  }

  if (target.id === 'word-input') {
    const max = S.room?.maxWordLength || 24;
    let value = target.value;
    if (countRunes(value) > max) {
      value = Array.from(value).slice(0, max).join('');
      target.value = value;
    }
    S.draft = value;
    updateComposerUI();
    queueDraftSave(S.room?.durationSec === 20 ? 120 : 360);
  }
}

function onSubmit(event) {
  if (event.target.id !== 'entry-form') return;
  event.preventDefault();
  handleEntry();
}

function onKeydown(event) {
  if (event.key === 'Escape' && S.modal) {
    event.preventDefault();
    closeModal();
    return;
  }

  if (event.key === 'Tab' && S.modal) {
    const modal = $('.modal');
    if (!modal) return;
    const focusables = Array.from(
      modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }

  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing &&
    event.target instanceof HTMLInputElement &&
    event.target.id === 'word-input'
  ) {
    event.preventDefault();
    submitWord();
  }
}

/* ----------------------------- Boot ----------------------------- */

async function loadInfo() {
  try {
    const response = await fetch('/api/info', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    S.info = await response.json();
    if (!S.room || S.room.phase === 'lobby') {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT') render();
    }
  } catch {
    // The invite panel still works with the current origin.
  }
}

async function init() {
  bindEvents();
  loadPreferences();

  const params = new URLSearchParams(location.search);
  const code = normalizeCode(params.get('room'));
  const watchLink = params.get('watch') === '1';
  if (code) {
    S.joinCode = code;
    S.tab = watchLink ? 'watch' : 'join';
    const saved = loadSession(code);
    if (saved) {
      S.booting = true;
      render();
      try {
        const data = await api('/api/rejoin', {
          code,
          playerId: saved.playerId,
          token: saved.token,
          role: saved.role,
        });
        adoptCredentials(data);
      } catch (error) {
        clearSession(code);
        S.booting = false;
        S.tab = watchLink ? 'watch' : 'join';
        S.joinCode = code;
        S.formError =
          error.status === 404
            ? '这个房间已经结束了。输入房间码加入一个新房间，或者自己开一局。'
            : error.message;
        render();
        S.focusField = 'player-name';
        render();
      }
    }
  }

  if (!S.room) {
    S.booting = false;
    render();
  }

  loadInfo();
  window.setInterval(tick, 180);

  // SSE is the fast path. Polling is a safety net for networks/tunnels that
  // buffer event streams; identical snapshots do not trigger a re-render.
  window.setInterval(() => {
    if (S.room && document.visibilityState === 'visible') refreshState();
  }, FORCE_POLLING ? 1500 : 2500);
}

function bindEvents() {
  // Browsers create WebAudio in a suspended state until a real user gesture.
  // Unlock it as soon as someone clicks or types, so the later reveal chime
  // can play even when it is triggered by the server.
  let audioUnlocked = false;
  const unlockAudio = () => {
    if (audioUnlocked) return;
    audioUnlocked = true;
    if (S.sound) getAudioContext();
  };
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushDraftKeepalive();
    } else if (S.room) {
      refreshState();
    }
  });
  window.addEventListener('online', () => {
    if (S.room) refreshState();
  });
  window.addEventListener('pagehide', flushDraftKeepalive);
  window.addEventListener('beforeunload', flushDraftKeepalive);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
