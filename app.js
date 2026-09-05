/**
 * UNT Math Core — Application Logic
 */

// ---------- Состояние ----------
let masteredList = JSON.parse(localStorage.getItem('unt_mastered_v2') || '[]');
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

// ---------- DOM ----------
const cardsContainer = document.getElementById('cards-container');
const searchInput = document.getElementById('search');
const clearSearchBtn = document.getElementById('clear-search');
const catPills = document.querySelectorAll('.cat-pill');
const statusBtns = document.querySelectorAll('.status-btn');
const progVal = document.getElementById('prog-val');
const progBarFill = document.getElementById('prog-bar-fill');
const toast = document.getElementById('toast');
const btnTop = document.getElementById('btnTop');

function renderMath(el) {
  if (window.renderMathInElement && el) {
    renderMathInElement(el, { delimiters: MATH_DELIMS, throwOnError: false });
  }
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1600);
}

// ---------- Прогресс ----------
function updateProgress() {
  progVal.textContent = `${masteredList.length}/${dataset.length}`;
  const pct = dataset.length ? Math.round((masteredList.length / dataset.length) * 100) : 0;
  if (progBarFill) progBarFill.style.width = `${pct}%`;
}

// ---------- Действия карточки ----------
function toggleMastered(id) {
  if (masteredList.includes(id)) {
    masteredList = masteredList.filter(x => x !== id);
    showToast('Убрано из изученного');
  } else {
    masteredList.push(id);
    showToast('Отмечено как изученное');
  }
  localStorage.setItem('unt_mastered_v2', JSON.stringify(masteredList));
  renderApp();
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
  let formulaObj = item.formulas[slideIdx];
  if (!formulaObj || !formulaObj.gen) {
    formulaObj = item.formulas.find(f => f.gen) || item.formulas[0];
  }
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

  if (promptEl) promptEl.textContent = newTask.prompt;
  if (mathEl) mathEl.innerHTML = `$$${newTask.latex}$$`;
  if (toggleBtn) toggleBtn.classList.remove('open');
  if (drawerEl) {
    drawerEl.classList.remove('open');
    drawerEl.innerHTML = `${newTask.steps.map(s => `<div class="solution-step">${s}</div>`).join('')}<div class="solution-final-ans">Ответ: ${newTask.ans}</div>`;
  }
  renderMath(practiceView);
}

function toggleSolutionDrawer(cardId) {
  const cardEl = document.getElementById(`card-${cardId}`);
  if (!cardEl) return;
  const drawer = cardEl.querySelector('.solution-drawer');
  const btn = cardEl.querySelector('.solution-toggle-btn');
  if (drawer && btn) { drawer.classList.toggle('open'); btn.classList.toggle('open'); }
}

// ---------- Поиск: нормализация ----------
function normalize(str) {
  return (str || '').toLowerCase().replace(/ё/g, 'е');
}

// ---------- Рендер ----------
function renderApp() {
  updateProgress();
  cardsContainer.innerHTML = '';

  const q = normalize(searchQuery);
  const filtered = dataset.filter(item => {
    const matchCat = currentCategory === 'all' || item.cat === currentCategory;
    const isMastered = masteredList.includes(item.id);
    let matchStatus = true;
    if (currentStatusFilter === 'mastered') matchStatus = isMastered;
    if (currentStatusFilter === 'unlearned') matchStatus = !isMastered;

    let matchQuery = true;
    if (q) {
      const formulasText = item.formulas.map(f => f.name + ' ' + f.latex + ' ' + (f.desc || '')).join(' ');
      const content = normalize(item.title + ' ' + item.tag + ' ' + item.theory.essence + ' ' + item.theory.points.join(' ') + ' ' + formulasText + ' ' + item.trap);
      matchQuery = content.includes(q);
    }
    return matchCat && matchStatus && matchQuery;
  });

  if (filtered.length === 0) {
    cardsContainer.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin: 0 auto 0.75rem; opacity: 0.4;">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        Ничего не найдено. Попробуйте другой запрос или сбросьте фильтр.
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  filtered.forEach(item => {
    const isMastered = masteredList.includes(item.id);
    const totalFormulas = item.formulas.length;
    const currentSlide = Math.min(activeSlideMap[item.id] || 0, totalFormulas - 1);
    const currentTab = activeCardTab[item.id] || 'formulas';

    if (!generatedTasksMap[item.id]) {
      const fObj = item.formulas[currentSlide].gen ? item.formulas[currentSlide] : (item.formulas.find(f => f.gen) || item.formulas[0]);
      if (fObj && fObj.gen) {
        generatedTasksMap[item.id] = fObj.gen();
      }
    }
    const currentTask = generatedTasksMap[item.id] || { prompt: '', latex: '', steps: [], ans: '' };

    let priorityClass = 'score';
    const pLower = item.priority.toLowerCase();
    if (pLower.includes('топ')) priorityClass = 'top';
    else if (pLower.includes('баг')) priorityClass = 'bug';

    const card = document.createElement('article');
    card.className = `card ${isMastered ? 'mastered' : ''}`;
    card.id = `card-${item.id}`;

    const dotsHtml = item.formulas.map((_, i) => `<div class="bar-dot ${i === currentSlide ? 'active' : ''}" onclick="setFormulaSlide('${item.id}', ${i})"></div>`).join('');

    card.innerHTML = `
      <div class="card-header">
        <div>
          <span class="tag-badge">${item.tag}</span>
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
              <button class="nav-arrow nav-prev" onclick="prevFormulaSlide('${item.id}')" ${currentSlide === 0 ? 'disabled' : ''} aria-label="Предыдущая формула">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.3" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <button class="nav-arrow nav-next" onclick="nextFormulaSlide('${item.id}')" ${currentSlide === totalFormulas - 1 ? 'disabled' : ''} aria-label="Следующая формула">
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
            <span class="practice-title">Случайная задача</span>
            <button class="gen-regen-btn" onclick="regenerateTask('${item.id}')">Новые числа</button>
          </div>
          <div class="problem-prompt">${currentTask.prompt}</div>
          <div class="math-preview-box">$$${currentTask.latex}$$</div>
          <button class="solution-toggle-btn" onclick="toggleSolutionDrawer('${item.id}')">
            <span>Пошаговое решение</span>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.1" d="M19 9l-7 7-7-7"/></svg>
          </button>
          <div class="solution-drawer">
            ${currentTask.steps.map(s => `<div class="solution-step">${s}</div>`).join('')}
            <div class="solution-final-ans">Ответ: ${currentTask.ans}</div>
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

// ---------- Обработчики событий ----------
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const val = e.target.value;
  clearSearchBtn.classList.toggle('visible', val.length > 0);
  searchTimeout = setTimeout(() => { searchQuery = val.trim(); renderApp(); }, 150);
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

// Быстрый доступ к поиску по "/"
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
});

// ---------- Инициализация ----------
document.addEventListener('DOMContentLoaded', () => {
  catPills.forEach(p => p.classList.toggle('active', p.getAttribute('data-cat') === currentCategory));
  renderApp();
});