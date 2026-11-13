'use strict';

const app = document.querySelector('#review-app');
const toastRegion = document.querySelector('#toast-region');
let cards = [];
let index = 0;
let kept = 0;
let deleted = 0;

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
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}

function render() {
  if (!cards.length) {
    app.innerHTML = `<div class="review-finish">
      <h2>卡池已经空了</h2>
      <p>所有卡都被删除了。刷新页面或检查卡池数据。</p>
      <a href="/">返回首页</a>
    </div>`;
    return;
  }

  if (index >= cards.length) {
    app.innerHTML = `<div class="review-finish">
      <h2>审核完成</h2>
      <p>本次审核 <strong>${cards.length}</strong> 张，保留 <strong>${kept}</strong> 张，删除 <strong>${deleted}</strong> 张。<br />刷新页面可查看剩余卡池。</p>
      <a class="btn btn-primary" href="/review">重新读取卡池</a>
    </div>`;
    return;
  }

  const card = cards[index];
  app.innerHTML = `<div class="review-backdrop">
    <section class="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div class="review-progress"><span>第 <b>${index + 1}</b> / ${cards.length} 张</span><span>保留 ${kept} · 删除 ${deleted}</span></div>
      <h2 class="review-card-title" id="review-title">${esc(card.title)}</h2>
      <ul class="review-facts">${card.facts.map((fact) => `<li>${esc(fact)}</li>`).join('')}</ul>
      ${card.pr?.length ? `<div class="review-pr"><b>公关点</b><ul>${card.pr.map((point) => `<li>${esc(point)}</li>`).join('')}</ul></div>` : ''}
      <div class="review-detail">${esc(card.detail)}</div>
      <div class="review-actions">
        <button type="button" class="btn review-delete" data-action="delete">删除这张</button>
        <button type="button" class="btn btn-primary" data-action="keep">保留这张</button>
      </div>
    </section>
  </div>`;
}

async function decide(action) {
  const card = cards[index];
  if (!card) return;
  try {
    if (action === 'delete') {
      await api('/api/crisis/cards/review', { id: card.id, action: 'delete' });
      deleted += 1;
      toast('已从卡池删除');
    } else {
      kept += 1;
    }
    index += 1;
    render();
  } catch (error) {
    toast(error.message);
  }
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'delete' || button.dataset.action === 'keep') {
    decide(button.dataset.action);
  }
});

async function boot() {
  try {
    const response = await fetch('/api/crisis/cards');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败');
    cards = data.cards || [];
    render();
  } catch (error) {
    app.innerHTML = `<div class="review-loading">读取卡池失败：${esc(error.message)}</div>`;
  }
}

boot();
