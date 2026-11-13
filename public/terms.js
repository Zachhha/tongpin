'use strict';

const setup = document.querySelector('#setup');
const quiz = document.querySelector('#quiz');
const finish = document.querySelector('#finish');
const subjectGrid = document.querySelector('#subject-grid');
const chapterPanel = document.querySelector('#chapter-panel');
const chapterSubject = document.querySelector('#chapter-subject');
const chapterCount = document.querySelector('#chapter-count');
const chapterList = document.querySelector('#chapter-list');
const startScopeButton = document.querySelector('#start-scope');
const startAllButton = document.querySelector('#start-all');
const quizScope = document.querySelector('#quiz-scope');
const quizCount = document.querySelector('#quiz-count');
const promptNode = document.querySelector('#quiz-prompt');
const hintNode = document.querySelector('#quiz-hint');
const answerForm = document.querySelector('#answer-form');
const answerInput = document.querySelector('#answer-input');
const feedback = document.querySelector('#feedback');
const answerPanel = document.querySelector('#answer-panel');
const answerText = document.querySelector('#answer-text');
const revealBar = document.querySelector('#reveal-bar');
const revealOnly = document.querySelector('#reveal-only');
const nextButton = document.querySelector('#next-question');
const finishText = document.querySelector('#finish-text');
const finishAgain = document.querySelector('#finish-again');
const backSetup = document.querySelector('#back-setup');
const toastNode = document.querySelector('#terms-toast');

let allItems = [];
let subject = null;
let chapter = null;
let deck = [];
let index = 0;
let answered = false;
let correct = 0;
let scopeName = '';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastNode.classList.remove('show'), 1800);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function byBoard(board) {
  return allItems.filter((item) => item.board === board);
}

function chapterGroups(board) {
  const map = new Map();
  for (const item of byBoard(board)) {
    map.set(item.chapter, (map.get(item.chapter) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
}

function renderSetup() {
  const boards = [...new Set(allItems.map((item) => item.board))];
  subjectGrid.innerHTML = boards.map((board, i) => {
    const count = byBoard(board).length;
    const chapters = chapterGroups(board).length;
    return `<button type="button" class="subject-card ${subject === board ? 'active' : ''}" data-subject="${esc(board)}">
      <span class="subject-no">0${i + 1}</span>
      <span class="subject-name">${esc(board)}</span>
      <span class="subject-meta">${count} 个术语 · ${chapters} 个章节</span>
    </button>`;
  }).join('');

  if (!subject) {
    chapterPanel.hidden = true;
    startScopeButton.disabled = true;
    return;
  }

  const chapters = chapterGroups(subject);
  const total = byBoard(subject).length;
  chapterPanel.hidden = false;
  chapterSubject.textContent = subject;
  chapterCount.textContent = `${total} 个术语 · ${chapters.length} 章`;
  chapterList.innerHTML = `
    <button type="button" class="chapter-chip ${chapter === null ? 'active' : ''}" data-chapter="">整科随机<small>${total}</small></button>
    ${chapters.map(([name, count]) => `<button type="button" class="chapter-chip ${chapter === name ? 'active' : ''}" data-chapter="${esc(name)}">${esc(name)}<small>${count}</small></button>`).join('')}
  `;
  startScopeButton.disabled = false;
}

function showSetup() {
  quiz.hidden = true;
  finish.hidden = true;
  setup.hidden = false;
  renderSetup();
}

function startSession(items, label) {
  if (!items.length) {
    toast('这个范围暂时没有术语。');
    return;
  }
  deck = shuffle(items);
  index = 0;
  answered = false;
  correct = 0;
  scopeName = label;
  setup.hidden = true;
  finish.hidden = true;
  quiz.hidden = false;
  quizScope.textContent = label;
  renderQuestion();
}

function sanitizeAnswer(value) {
  return String(value || '')
    .trim()
    .replace(/[\s，。！？、；：""''（）()【】\[\]<>《》·.。,!?;:'"`]/g, '')
    .toLowerCase();
}

function renderQuestion() {
  const item = deck[index];
  if (!item) {
    showFinish();
    return;
  }
  answered = false;
  feedback.textContent = '';
  feedback.className = 'feedback';
  answerPanel.hidden = true;
  revealBar.hidden = false;
  answerInput.disabled = false;
  answerInput.value = '';
  quizCount.textContent = `第 ${index + 1} / ${deck.length} 题 · 答对 ${correct}`;
  promptNode.textContent = item.prompt;
  hintNode.textContent = `（${item.length} 个字）`;
  window.setTimeout(() => answerInput.focus(), 30);
}

function answerDisplay(item) {
  let body = String(item.answer || '');
  if (body.startsWith(item.term)) {
    body = body.slice(item.term.length).replace(/^[：:]\s*/, '');
  }
  if (body.startsWith(item.term)) {
    body = body.slice(item.term.length).trim();
  }
  const glue = body.startsWith('是') ? '' : '：';
  return `<b>${esc(item.term)}</b>${esc(glue + body)}`;
}

function showAnswer(isCorrect) {
  const item = deck[index];
  answered = true;
  answerInput.disabled = true;
  answerPanel.hidden = false;
  answerText.innerHTML = answerDisplay(item);
  revealBar.hidden = true;
  feedback.className = isCorrect ? 'feedback good' : 'feedback';
  feedback.textContent = isCorrect ? '答对了。' : '答案如下。';
  if (isCorrect) correct += 1;
  quizCount.textContent = `第 ${index + 1} / ${deck.length} 题 · 答对 ${correct}`;
  nextButton.focus();
}

function submitAnswer(event) {
  event.preventDefault();
  if (answered) {
    nextQuestion();
    return;
  }
  const item = deck[index];
  const value = sanitizeAnswer(answerInput.value);
  if (!value) {
    toast('先输入一个术语。');
    answerInput.focus();
    return;
  }
  if (value === sanitizeAnswer(item.term)) {
    showAnswer(true);
  } else {
    feedback.textContent = '还不对，再想想；也可以直接显示答案。';
  }
}

function nextQuestion() {
  if (!answered) {
    toast('先答完这一题，或者显示答案。');
    return;
  }
  if (index >= deck.length - 1) {
    showFinish();
    return;
  }
  index += 1;
  renderQuestion();
}

function showFinish() {
  quiz.hidden = true;
  setup.hidden = true;
  finish.hidden = false;
  finishText.textContent = `${scopeName}：共 ${deck.length} 题，答对 ${correct} 题。`;
}

subjectGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-subject]');
  if (!button) return;
  subject = button.dataset.subject;
  chapter = null;
  renderSetup();
});

chapterList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-chapter]');
  if (!button) return;
  chapter = button.dataset.chapter || null;
  renderSetup();
});

startScopeButton.addEventListener('click', () => {
  if (!subject) return;
  const items = chapter ? byBoard(subject).filter((item) => item.chapter === chapter) : byBoard(subject);
  startSession(items, chapter ? `${subject} · ${chapter}` : `${subject} · 整科随机`);
});

startAllButton.addEventListener('click', () => {
  startSession(allItems, '全部范围 · 随机');
});

answerForm.addEventListener('submit', submitAnswer);

revealOnly.addEventListener('click', () => {
  if (!answered) showAnswer(false);
});

nextButton.addEventListener('click', nextQuestion);

answerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && answered) {
    event.preventDefault();
    nextQuestion();
  }
});

backSetup.addEventListener('click', showSetup);
finishAgain.addEventListener('click', showSetup);

async function boot() {
  try {
    const response = await fetch('/terms-data.json');
    if (!response.ok) throw new Error('题库读取失败');
    allItems = await response.json();
    if (!Array.isArray(allItems) || !allItems.length) throw new Error('题库为空');
    showSetup();
  } catch (error) {
    setup.innerHTML = `<p class="terms-eyebrow">ERROR</p><h1>题库没读出来。</h1><p class="terms-intro">${esc(error.message)}</p>`;
  }
}

boot();
