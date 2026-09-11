/**
 * UNT Math Core — Enhanced Application Logic
 * Поддержка SRS (Spaced Repetition), Active Recall, Exam Mode, Deep Links, JSON Sync
 */

// ---------- Состояние системы ----------
let userProfile = JSON.parse(localStorage.getItem('unt_user_profile_v3')) || {
  theme: 'dark',
  fontSize: 16,
  streak: 0,
  lastActiveDate: '',
  stats: { solved: 0, correct: 0, errors: 0 }
};

// Хранилище прогресса: { [cardId]: { level: 1..5, nextReview: timestamp, mastered: bool, lastReviewed: timestamp } }
let srsStore = JSON.parse(localStorage.getItem('unt_srs_store_v3')) || {};

// Миграция старого списка изученного
const oldMastered = JSON.parse(localStorage.getItem('unt_mastered_v2') || '[]');
if (oldMastered.length > 0 && Object.keys(srsStore).length === 0) {
  oldMastered.forEach(id => {
    srsStore[id] = { level: 4, nextReview: Date.now() + 7 * 86400000, mastered: true, lastReviewed: Date.now() };
  });
  localStorage.setItem('unt_srs_store_v3', JSON.stringify(srsStore));
}

let currentCategory = localStorage.getItem('unt_last_cat') || 'all';
let currentStatusFilter = 'all';
let searchQuery = '';
let searchTimeout = null;

const activeSlideMap = {};
const generatedTasksMap = {};
const activeCardTab = {};

const MATH_DELIMS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false }
];

// SRS интервалы (в днях) по уровням Лейтнера
const SRS_INTERVALS = [1, 3, 7, 14, 30];

// ---------- DOM элементы ----------
const cardsContainer = document.getElementById('cards-container');
const searchInput = document.getElementById('search');
const clearSearchBtn = document.getElementById('clear-search');
const catPills = document.querySelectorAll('.cat-pill');
const statusBtns = document.querySelectorAll('.status-btn');
const progVal = document.getElementById('prog-val');
const progBarFill = document.getElementById('prog-bar-fill');
const toastEl = document.getElementById('toast');
const toastTextEl = document.getElementById('toast-text');
const toastUndoBtn = document.getElementById('toast-undo');
const btnTop = document.getElementById('btnTop');
const streakBadge = document.getElementById('streak-badge');
const srsCountBadge = document.getElementById('srs-count');
const itemsFoundCounter = document.getElementById('items-found-counter');

let lastToggleUndoAction = null;

function renderMath(el) {
  if (window.renderMathInElement && el) {
    renderMathInElement(el, { delimiters: MATH_DELIMS, throwOnError: false });
  }
}

function showToast(text, undoCallback = null) {
  toastTextEl.textContent = text;
  toastUndoBtn.style.display = undoCallback ? 'inline-block' : 'none';
  lastToggleUndoAction = undoCallback;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), undoCallback ? 4000 : 2000);
}

toastUndoBtn.addEventListener('click', () => {
  if (lastToggleUndoAction) {
    lastToggleUndoAction();
    lastToggleUndoAction = null;
    toastEl.classList.remove('show');
  }
});

// ---------- Streak & Profile ----------
function checkStreak() {
  const today = new Date().toISOString().slice(0, 10);
  if (userProfile.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (userProfile.lastActiveDate === yesterday) {
      userProfile.streak += 1;
    } else if (!userProfile.lastActiveDate) {
      userProfile.streak = 1;
    } else {
      userProfile.streak = 1; // стрик сброшен
    }
    userProfile.lastActiveDate = today;
    saveProfile();
  }
  if (streakBadge) streakBadge.textContent = `🔥 ${userProfile.streak} дн.`;
}

function saveProfile() {
  localStorage.setItem('unt_user_profile_v3', JSON.stringify(userProfile));
}

function saveSRS() {
  localStorage.setItem('unt_srs_store_v3', JSON.stringify(srsStore));
}

// ---------- SRS логика ----------
function isSRSReady(cardId) {
  const data = srsStore[cardId];
  if (!data || !data.mastered) return false;
  return Date.now() >= (data.nextReview || 0);
}

function voteSRS(cardId, remembered) {
  let record = srsStore[cardId] || { level: 1, mastered: true, errors: 0 };
  if (remembered) {
    record.level = Math.min(5, (record.level || 1) + 1);
    userProfile.stats.correct += 1;
    showToast(`Уровень повышен до ${record.level}!`);
  } else {
    record.level = 1;
    record.errors = (record.errors || 0) + 1;
    userProfile.stats.errors += 1;
    showToast('Сброшено на повторение через 1 день');
  }
  const days = SRS_INTERVALS[record.level - 1] || 1;
  record.nextReview = Date.now() + days * 86400000;
  record.lastReviewed = Date.now();
  record.mastered = true;
  srsStore[cardId] = record;
  userProfile.stats.solved += 1;

  saveSRS();
  saveProfile();
  renderApp();
}

function toggleMastered(id) {
  const isMastered = !!(srsStore[id] && srsStore[id].mastered);
  if (isMastered) {
    delete srsStore[id];
    saveSRS();
    renderApp();
    showToast('Убрано из изученного', () => {
      srsStore[id] = { level: 2, mastered: true, nextReview: Date.now() + 3 * 86400000, lastReviewed: Date.now() };
      saveSRS();
      renderApp();
    });
  } else {
    srsStore[id] = { level: 2, mastered: true, nextReview: Date.now() + 3 * 86400000, lastReviewed: Date.now() };
    saveSRS();
    renderApp();
    showToast('Изучено! Повторение через 3 дня');
  }
}

// ---------- Прогресс ----------
function updateProgress() {
  const masteredCount = Object.values(srsStore).filter(x => x.mastered).length;
  const total = dataset.length;
  const pct = total ? Math.round((masteredCount / total) * 100) : 0;

  progVal.textContent = `${masteredCount}/${total} (${pct}%)`;
  if (progBarFill) progBarFill.style.width = `${pct}%`;

  // Подсчёт SRS к повторению
  const readyCount = dataset.filter(d => isSRSReady(d.id)).length;
  if (srsCountBadge) srsCountBadge.textContent = `${readyCount}`;

  // Обновление счетчиков на кнопках категорий
  catPills.forEach(pill => {
    const cat = pill.getAttribute('data-cat');
    const badge = pill.querySelector('.cat-count');
    if (!badge) return;
    if (cat === 'all') {
      badge.textContent = `${total}`;
    } else {
      const cTotal = dataset.filter(d => d.cat === cat).length;
      badge.textContent = `${cTotal}`;
    }
  });
}

// ---------- Карточки & Слайды ----------
function setCardTab(cardId, tabName) {
  activeCardTab[cardId] = tabName;
  const cardEl = document.getElementById(`card-${cardId}`);
  if (!cardEl) return;
  cardEl.querySelectorAll('.card-nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabName));
  cardEl.querySelectorAll('.card-view').forEach(v => v.classList.toggle('active', v.getAttribute('data-view') === tabName));
  renderMath(cardEl);
}

function prevFormulaSlide(cardId) { setFormulaSlide(cardId, (activeSlideMap[cardId] || 0) - 1); }
function nextFormulaSlide(cardId) { setFormulaSlide(cardId, (activeSlideMap[cardId] || 0) + 1); }

function setFormulaSlide(cardId, idx) {
  const item = dataset.find(d => d.id === cardId);
  if (!item) return;
  const total = item.formulas.length;
  if (idx < 0 || idx >= total) return;
  activeSlideMap[cardId] = idx;

  const cardEl = document.getElementById(`card-${cardId}`);
  if (!cardEl) return;

  const infoEl = cardEl.querySelector('.carousel-info');
  if (infoEl) infoEl.innerHTML = `<strong>${idx + 1}/${total}</strong> · ${item.formulas[idx].name}`;

  const bodyEl = cardEl.querySelector('.carousel-body');
  if (bodyEl) bodyEl.innerHTML = `$$${item.formulas[idx].latex}$$`;

  let descEl = cardEl.querySelector('.formula-desc');
  if (item.formulas[idx].desc) {
    if (!descEl) {
      descEl = document.createElement('div');
      descEl.className = 'formula-desc';
      const barsEl = cardEl.querySelector('.carousel-bars');
      if (barsEl) barsEl.before(descEl);
      else bodyEl.after(descEl);
    }
    descEl.innerHTML = item.formulas[idx].desc;
  } else if (descEl) {
    descEl.remove();
  }

  const prevBtn = cardEl.querySelector('.nav-prev');
  const nextBtn = cardEl.querySelector('.nav-next');
  if (prevBtn) prevBtn.disabled = (idx === 0);
  if (nextBtn) nextBtn.disabled = (idx === total - 1);

  cardEl.querySelectorAll('.bar-dot').forEach((d, i) => d.classList.toggle('active', i === idx));

  regenerateTask(cardId, idx);
  if (bodyEl) renderMath(bodyEl);
  if (descEl) renderMath(descEl);
}

function regenerateTask(cardId, optionalIdx) {
  const item = dataset.find(d => d.id === cardId);
  if (!item) return;
  const slideIdx = optionalIdx !== undefined ? optionalIdx : (activeSlideMap[cardId] || 0);
  let formulaObj = item.formulas[slideIdx] && item.formulas[slideIdx].gen ? item.formulas[slideIdx] : (item.formulas.find(f => f.gen) || item.formulas[0]);
  if (!formulaObj || !formulaObj.gen) return;

  const newTask = formulaObj.gen();
  generatedTasksMap[cardId] = newTask;

  const cardEl = document.getElementById(`card-${cardId}`);
  if (!cardEl) return;
  const practiceView = cardEl.querySelector('.card-view[data-view="practice"]');
  if (!practiceView) return;

  const promptEl = practiceView.querySelector('.problem-prompt');
  const mathEl = practiceView.querySelector('.math-preview-box');
  const drawerEl = practiceView.querySelector('.solution-drawer');
  const toggleBtn = practiceView.querySelector('.solution-toggle-btn');
  const inputEl = practiceView.querySelector('.recall-input');
  const feedbackEl = practiceView.querySelector('.recall-feedback');

  if (promptEl) promptEl.textContent = newTask.prompt;
  if (mathEl) mathEl.innerHTML = `$$${newTask.latex}$$`;
  if (inputEl) inputEl.value = '';
  if (feedbackEl) { feedbackEl.className = 'recall-feedback'; feedbackEl.textContent = ''; }
  if (toggleBtn) toggleBtn.classList.remove('open');
  if (drawerEl) {
    drawerEl.classList.remove('open');
    drawerEl.innerHTML = `
      ${newTask.steps.map(s => `<div class="solution-step">${s}</div>`).join('')}
      <div class="solution-final-ans">Ответ: ${newTask.ans}</div>
      <div class="srs-vote-box">
        <span class="srs-vote-label">Оценка для повторения:</span>
        <div class="srs-btn-group">
          <button class="srs-vote-btn pass" onclick="voteSRS('${item.id}', true)">✓ Помню</button>
          <button class="srs-vote-btn fail" onclick="voteSRS('${item.id}', false)">✕ Ошибка</button>
        </div>
      </div>
    `;
  }
  renderMath(practiceView);
}

function checkRecallAnswer(cardId) {
  const cardEl = document.getElementById(`card-${cardId}`);
  if (!cardEl) return;
  const input = cardEl.querySelector('.recall-input');
  const feedback = cardEl.querySelector('.recall-feedback');
  const currentTask = generatedTasksMap[cardId];
  if (!input || !feedback || !currentTask) return;

  const val = input.value.trim().replace(/\s+/g, '').toLowerCase();
  const rawAns = currentTask.ans.replace(/\$/g, '').replace(/\\;/g, '').replace(/\s+/g, '').toLowerCase();

  if (!val) return;

  userProfile.stats.solved += 1;
  if (rawAns.includes(val) || val.includes(rawAns)) {
    feedback.className = 'recall-feedback show correct';
    feedback.textContent = '🎉 Отлично! Ответ совпал с решением.';
    userProfile.stats.correct += 1;
  } else {
    feedback.className = 'recall-feedback show wrong';
    feedback.textContent = 'Разбор ниже. Сверьтесь с эталоном:';
    userProfile.stats.errors += 1;
    toggleSolutionDrawer(cardId, true);
  }
  saveProfile();
}

function toggleSolutionDrawer(cardId, forceOpen = false) {
  const cardEl = document.getElementById(`card-${cardId}`);
  if (!cardEl) return;
  const drawer = cardEl.querySelector('.solution-drawer');
  const btn = cardEl.querySelector('.solution-toggle-btn');
  if (drawer && btn) {
    if (forceOpen) {
      drawer.classList.add('open');
      btn.classList.add('open');
    } else {
      drawer.classList.toggle('open');
      btn.classList.toggle('open');
    }
  }
}

function copyFormulaLatex(cardId) {
  const item = dataset.find(d => d.id === cardId);
  if (!item) return;
  const slideIdx = activeSlideMap[cardId] || 0;
  const latex = item.formulas[slideIdx].latex;
  navigator.clipboard.writeText(latex).then(() => {
    showToast(`LaTeX скопирован (${slideIdx + 1}/${item.formulas.length})`);
  }).catch(() => showToast('Не удалось скопировать'));
}

// ---------- Нормализация и Рендер ----------
function normalize(str) {
  return (str || '').toLowerCase().replace(/ё/g, 'е');
}

function renderApp() {
  updateProgress();
  cardsContainer.innerHTML = '';

  const q = normalize(searchQuery);
  const filtered = dataset.filter(item => {
    const matchCat = currentCategory === 'all' || item.cat === currentCategory;
    const isMastered = !!(srsStore[item.id] && srsStore[item.id].mastered);
    const isDue = isSRSReady(item.id);

    let matchStatus = true;
    if (currentStatusFilter === 'mastered') matchStatus = isMastered;
    if (currentStatusFilter === 'unlearned') matchStatus = !isMastered;
    if (currentStatusFilter === 'srs') matchStatus = isDue;

    let matchQuery = true;
    if (q) {
      const formulasText = item.formulas.map(f => f.name + ' ' + f.latex + ' ' + (f.desc || '')).join(' ');
      const content = normalize(item.title + ' ' + item.tag + ' ' + item.theory.essence + ' ' + item.theory.points.join(' ') + ' ' + formulasText + ' ' + item.trap);
      matchQuery = content.includes(q);
    }
    return matchCat && matchStatus && matchQuery;
  });

  if (itemsFoundCounter) itemsFoundCounter.textContent = `Показано: ${filtered.length}`;

  if (filtered.length === 0) {
    cardsContainer.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity: 0.4;">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>Ничего не найдено по заданным фильтрам.</span>
        <button class="empty-reset-btn" onclick="resetAllFilters()">Сбросить фильтры</button>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  filtered.forEach(item => {
    const srsData = srsStore[item.id];
    const isMastered = !!(srsData && srsData.mastered);
    const isDue = isSRSReady(item.id);
    const totalFormulas = item.formulas.length;
    const currentSlide = Math.min(activeSlideMap[item.id] || 0, totalFormulas - 1);
    const currentTab = activeCardTab[item.id] || 'formulas';

    if (!generatedTasksMap[item.id]) {
      const fObj = item.formulas[currentSlide].gen ? item.formulas[currentSlide] : (item.formulas.find(f => f.gen) || item.formulas[0]);
      if (fObj && fObj.gen) generatedTasksMap[item.id] = fObj.gen();
    }
    const currentTask = generatedTasksMap[item.id] || { prompt: '', latex: '', steps: [], ans: '' };

    let priorityClass = 'score';
    const pLower = item.priority.toLowerCase();
    if (pLower.includes('топ')) priorityClass = 'top';
    else if (pLower.includes('баг')) priorityClass = 'bug';

    const card = document.createElement('article');
    card.className = `card ${isMastered ? 'mastered' : ''} ${isDue ? 'srs-due' : ''}`;
    card.id = `card-${item.id}`;

    const dotsHtml = item.formulas.map((_, i) => `<div class="bar-dot ${i === currentSlide ? 'active' : ''}" onclick="setFormulaSlide('${item.id}', ${i})"></div>`).join('');

    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="tag-row">
            <span class="tag-badge">${item.tag}</span>
            ${srsData ? `<span class="srs-pill ${isDue ? 'due' : ''}">SRS Ур.${srsData.level} ${isDue ? '• Пора повторить' : ''}</span>` : ''}
          </div>
          <h2 class="card-title">${item.title}</h2>
        </div>
        <span class="priority-badge ${priorityClass}">${item.priority}</span>
      </div>

      <div class="card-nav-tabs">
        <button class="card-nav-btn ${currentTab === 'formulas' ? 'active' : ''}" data-tab="formulas" onclick="setCardTab('${item.id}', 'formulas')">Формулы <span class="tab-count">${totalFormulas}</span></button>
        <button class="card-nav-btn ${currentTab === 'theory' ? 'active' : ''}" data-tab="theory" onclick="setCardTab('${item.id}', 'theory')">Теория</button>
        <button class="card-nav-btn ${currentTab === 'practice' ? 'active' : ''}" data-tab="practice" onclick="setCardTab('${item.id}', 'practice')">Тренажёр</button>
      </div>

      <div class="card-view ${currentTab === 'formulas' ? 'active' : ''}" data-view="formulas">
        <div class="formula-carousel">
          <div class="carousel-top">
            <span class="carousel-info"><strong>${currentSlide + 1}/${totalFormulas}</strong> · ${item.formulas[currentSlide].name}</span>
            <div class="carousel-controls">
              <button class="nav-arrow nav-prev" onclick="prevFormulaSlide('${item.id}')" ${currentSlide === 0 ? 'disabled' : ''} aria-label="Предыдущая">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.3" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <button class="nav-arrow nav-next" onclick="nextFormulaSlide('${item.id}')" ${currentSlide === totalFormulas - 1 ? 'disabled' : ''} aria-label="Следующая">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.3" d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>
          <div class="carousel-body">$$${item.formulas[currentSlide].latex}$$</div>
          ${item.formulas[currentSlide].desc ? `<div class="formula-desc">${item.formulas[currentSlide].desc}</div>` : ''}
          ${totalFormulas > 1 ? `<div class="carousel-bars">${dotsHtml}</div>` : ''}
        </div>
      </div>

      <div class="card-view ${currentTab === 'theory' ? 'active' : ''}" data-view="theory">
        <div class="theory-block">
          <div class="essence-box">${item.theory.essence}</div>
          <div class="points-list">
            ${item.theory.points.map(p => `<div class="point-row"><span class="point-dot"></span><div>${p}</div></div>`).join('')}
          </div>
          <div class="takeaway-box"><strong>Инсайт ЕНТ:</strong> ${item.theory.takeaway}</div>
        </div>
      </div>

      <div class="card-view ${currentTab === 'practice' ? 'active' : ''}" data-view="practice">
        <div class="practice-container">
          <div class="practice-header">
            <span class="practice-title">Active Recall Тренажёр</span>
            <button class="gen-regen-btn" onclick="regenerateTask('${item.id}')">Новые числа</button>
          </div>
          <div class="problem-prompt">${currentTask.prompt}</div>
          <div class="math-preview-box">$$${currentTask.latex}$$</div>

          <div class="active-recall-row">
            <input type="text" class="recall-input" placeholder="Введите ваш ответ…" onkeydown="if(event.key==='Enter') checkRecallAnswer('${item.id}')">
            <button class="recall-check-btn" onclick="checkRecallAnswer('${item.id}')">Проверить</button>
          </div>
          <div class="recall-feedback"></div>

          <button class="solution-toggle-btn" onclick="toggleSolutionDrawer('${item.id}')">
            <span>Пошаговое решение</span>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.1" d="M19 9l-7 7-7-7"/></svg>
          </button>
          <div class="solution-drawer">
            ${currentTask.steps.map(s => `<div class="solution-step">${s}</div>`).join('')}
            <div class="solution-final-ans">Ответ: ${currentTask.ans}</div>
            <div class="srs-vote-box">
              <span class="srs-vote-label">Оценка для повторения:</span>
              <div class="srs-btn-group">
                <button class="srs-vote-btn pass" onclick="voteSRS('${item.id}', true)">✓ Помню</button>
                <button class="srs-vote-btn fail" onclick="voteSRS('${item.id}', false)">✕ Ошибка</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="trap-box"><strong>Ловушка ЕНТ:</strong> ${item.trap}</div>

      <div class="card-footer">
        <button class="card-action-btn ${isMastered ? 'mastered-btn' : ''}" onclick="toggleMastered('${item.id}')">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.1" d="${isMastered ? 'M5 13l4 4L19 7' : 'M12 4v16m8-8H4'}"/></svg>
          ${isMastered ? 'Изучено' : 'Отметить'}
        </button>
        <button class="card-action-btn" onclick="copyFormulaLatex('${item.id}')">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.1" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
          LaTeX
        </button>
      </div>
    `;
    frag.appendChild(card);
  });

  cardsContainer.appendChild(frag);
  renderMath(cardsContainer);
}

function resetAllFilters() {
  searchInput.value = '';
  searchQuery = '';
  clearSearchBtn.classList.remove('visible');
  currentCategory = 'all';
  currentStatusFilter = 'all';
  catPills.forEach(p => p.classList.toggle('active', p.getAttribute('data-cat') === 'all'));
  statusBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-status') === 'all'));
  renderApp();
}

// ---------- Случайная карточка & Deep Links ----------
document.getElementById('btn-random-card').addEventListener('click', () => {
  const item = pick(dataset);
  if (!item) return;
  window.location.hash = item.id;
  currentCategory = 'all';
  currentStatusFilter = 'all';
  searchQuery = '';
  renderApp();
  setTimeout(() => {
    const el = document.getElementById(`card-${item.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
});

function handleHashNavigation() {
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    const el = document.getElementById(`card-${hash}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ---------- Экзамен «Мини-ЕНТ» ----------
let examQuestions = [];
let examCurrentIdx = 0;
let examUserAnswers = {};
let examTimerInterval = null;
let examSecondsLeft = 900;

document.getElementById('btn-exam-open').addEventListener('click', startExam);

function startExam() {
  // Выбираем 10 случайных формул
  const shuffled = [...dataset].sort(() => 0.5 - Math.random()).slice(0, 10);
  examQuestions = shuffled.map(item => {
    const fObj = item.formulas.find(f => f.gen) || item.formulas[0];
    return {
      title: item.title,
      cat: item.cat,
      task: fObj.gen()
    };
  });

  examCurrentIdx = 0;
  examUserAnswers = {};
  examSecondsLeft = 900;

  document.getElementById('exam-modal').classList.add('active');
  renderExamQuestion();

  clearInterval(examTimerInterval);
  examTimerInterval = setInterval(() => {
    examSecondsLeft--;
    const m = Math.floor(examSecondsLeft / 60).toString().padStart(2, '0');
    const s = (examSecondsLeft % 60).toString().padStart(2, '0');
    document.getElementById('exam-timer').textContent = `${m}:${s}`;
    if (examSecondsLeft <= 0) finishExam();
  }, 1000);
}

function renderExamQuestion() {
  const q = examQuestions[examCurrentIdx];
  const container = document.getElementById('exam-body-container');
  document.getElementById('exam-q-title').textContent = `Вопрос ${examCurrentIdx + 1} из ${examQuestions.length}`;

  const dotsHtml = examQuestions.map((_, i) => `
    <div class="exam-dot ${i === examCurrentIdx ? 'active' : ''} ${examUserAnswers[i] ? 'answered' : ''}" onclick="goExamQ(${i})">${i + 1}</div>
  `).join('');

  container.innerHTML = `
    <div class="exam-nav-dots">${dotsHtml}</div>
    <div style="font-size: 0.8rem; color: var(--accent); font-weight: 700; margin-bottom: 0.3rem;">${q.title}</div>
    <div style="font-size: 0.95rem; font-weight: 600; margin-bottom: 0.6rem;">${q.task.prompt}</div>
    <div class="math-preview-box" style="margin-bottom: 0.8rem;">$$${q.task.latex}$$</div>
    <input type="text" class="recall-input" id="exam-ans-input" placeholder="Введите ваш ответ…" value="${examUserAnswers[examCurrentIdx] || ''}" oninput="saveExamAns(this.value)">

    <div class="exam-actions-footer">
      <button class="icon-tool-btn" onclick="goExamQ(${examCurrentIdx - 1})" ${examCurrentIdx === 0 ? 'disabled' : ''}>← Назад</button>
      ${examCurrentIdx === examQuestions.length - 1
        ? `<button class="modal-btn primary" onclick="finishExam()">Завершить тест</button>`
        : `<button class="modal-btn primary" onclick="goExamQ(${examCurrentIdx + 1})">Далее →</button>`
      }
    </div>
  `;
  renderMath(container);
}

function saveExamAns(val) {
  examUserAnswers[examCurrentIdx] = val;
  const dots = document.querySelectorAll('.exam-dot');
  if (dots[examCurrentIdx]) dots[examCurrentIdx].classList.toggle('answered', val.trim().length > 0);
}

function goExamQ(idx) {
  if (idx >= 0 && idx < examQuestions.length) {
    examCurrentIdx = idx;
    renderExamQuestion();
  }
}

function finishExam() {
  clearInterval(examTimerInterval);
  const container = document.getElementById('exam-body-container');
  let correctCount = 0;

  const resultsHtml = examQuestions.map((q, i) => {
    const uAns = (examUserAnswers[i] || '').trim().replace(/\s+/g, '').toLowerCase();
    const rAns = q.task.ans.replace(/\$/g, '').replace(/\\;/g, '').replace(/\s+/g, '').toLowerCase();
    const isCorrect = uAns && (rAns.includes(uAns) || uAns.includes(rAns));
    if (isCorrect) correctCount++;

    return `
      <div style="padding: 0.6rem; background: var(--surface-2); border-radius: 6px; font-size: 0.8rem;">
        <div style="font-weight: 700; color: ${isCorrect ? 'var(--good)' : 'var(--danger-text)'};">Вопрос ${i + 1}: ${isCorrect ? '✓ Верно' : '✕ Ошибка'}</div>
        <div style="color: var(--text-secondary); margin: 0.2rem 0;">Ваш ответ: <code>${examUserAnswers[i] || '—'}</code> | Эталон: <code>${q.task.ans}</code></div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="text-align: center; padding: 0.5rem 0;">
      <div style="font-size: 2.2rem; font-weight: 800; font-family: var(--font-mono); color: var(--accent);">${correctCount} / ${examQuestions.length}</div>
      <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">Набрано баллов на мини-экзамене</div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 0.4rem; max-height: 40vh; overflow-y: auto;">
      ${resultsHtml}
    </div>
    <button class="modal-btn primary" style="margin-top: 0.5rem;" onclick="closeExam()">Закрыть</button>
  `;
}

function closeExam() {
  clearInterval(examTimerInterval);
  document.getElementById('exam-modal').classList.remove('active');
}

// ---------- Статистика и Экспорт / Импорт ----------
document.getElementById('btn-stats-modal').addEventListener('click', () => {
  openStatsModal();
});

function openStatsModal() {
  document.getElementById('stat-solved').textContent = userProfile.stats.solved;
  const totalAttempts = userProfile.stats.correct + userProfile.stats.errors;
  const acc = totalAttempts ? Math.round((userProfile.stats.correct / totalAttempts) * 100) : 0;
  document.getElementById('stat-acc').textContent = `${acc}%`;

  const readyCount = dataset.filter(d => isSRSReady(d.id)).length;
  document.getElementById('stat-srs-ready').textContent = readyCount;

  // Разбивка по темам
  const cats = [
    { id: 'algebra', name: 'Алгебра' },
    { id: 'progressions', name: 'Прогрессии' },
    { id: 'trig', name: 'Тригонометрия' },
    { id: 'log', name: 'Логарифмы' },
    { id: 'calculus', name: 'Анализ' },
    { id: 'planimetry', name: 'Планиметрия' },
    { id: 'stereometry', name: 'Стереометрия' },
    { id: 'vectors', name: 'Векторы' },
    { id: 'probability', name: 'Вероятность' }
  ];

  const breakdownContainer = document.getElementById('cat-breakdown');
  breakdownContainer.innerHTML = cats.map(c => {
    const total = dataset.filter(d => d.cat === c.id).length;
    const mastered = dataset.filter(d => d.cat === c.id && srsStore[d.id] && srsStore[d.id].mastered).length;
    const pct = total ? Math.round((mastered / total) * 100) : 0;
    return `
      <div class="cat-stat-row">
        <div class="cat-stat-labels"><span>${c.name}</span><span>${mastered}/${total} (${pct}%)</span></div>
        <div class="cat-stat-bar-track"><div class="cat-stat-bar-val" style="width: ${pct}%;"></div></div>
      </div>
    `;
  }).join('');

  document.getElementById('stats-modal').classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function exportProgressJSON() {
  const exportPayload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    userProfile,
    srsStore
  };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unt_math_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Резервная копия сохранена');
}

function importProgressJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.srsStore) {
        srsStore = data.srsStore;
        userProfile = data.userProfile || userProfile;
        saveSRS();
        saveProfile();
        closeModal('stats-modal');
        renderApp();
        showToast('Прогресс успешно импортирован!');
      } else {
        showToast('Неверный формат файла');
      }
    } catch (err) {
      showToast('Ошибка чтения файла');
    }
  };
  reader.readAsText(file);
}

// ---------- Тема и Масштаб шрифта ----------
const themeBtn = document.getElementById('btn-theme-toggle');
themeBtn.addEventListener('click', () => {
  const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nextTheme);
  userProfile.theme = nextTheme;
  saveProfile();
});

document.getElementById('btn-font-inc').addEventListener('click', () => {
  userProfile.fontSize = Math.min(22, (userProfile.fontSize || 16) + 1);
  document.documentElement.style.setProperty('--base-font-size', `${userProfile.fontSize}px`);
  saveProfile();
});

document.getElementById('btn-font-dec').addEventListener('click', () => {
  userProfile.fontSize = Math.max(13, (userProfile.fontSize || 16) - 1);
  document.documentElement.style.setProperty('--base-font-size', `${userProfile.fontSize}px`);
  saveProfile();
});

// ---------- Поиск & Фильтры ----------
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const val = e.target.value;
  clearSearchBtn.classList.toggle('visible', val.length > 0);
  searchTimeout = setTimeout(() => { searchQuery = val.trim(); renderApp(); }, 120);
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  clearSearchBtn.classList.remove('visible');
  searchInput.focus();
  renderApp();
});

catPills.forEach(pill => {
  pill.addEventListener('click', () => {
    catPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentCategory = pill.getAttribute('data-cat');
    localStorage.setItem('unt_last_cat', currentCategory);
    renderApp();
  });
});

statusBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    statusBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentStatusFilter = btn.getAttribute('data-status');
    renderApp();
  });
});

window.addEventListener('scroll', () => {
  btnTop.classList.toggle('visible', window.scrollY > 400);
}, { passive: true });

btnTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.key === 'Escape') {
    closeModal('stats-modal');
    closeModal('exam-modal');
  }
});

// ---------- Инициализация ----------
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.setAttribute('data-theme', userProfile.theme || 'dark');
  if (userProfile.fontSize) {
    document.documentElement.style.setProperty('--base-font-size', `${userProfile.fontSize}px`);
  }
  catPills.forEach(p => p.classList.toggle('active', p.getAttribute('data-cat') === currentCategory));
  checkStreak();
  renderApp();
  handleHashNavigation();
});