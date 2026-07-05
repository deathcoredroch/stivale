// ============ УРОКИ: АВТОМАТИЧЕСКОЕ ПОДКЛЮЧЕНИЕ ИЗ ФАЙЛОВ ============
// Единственный ручной шаг для нового урока — положить файл lessons/lesson-N.html:
//
//   <script type="application/json" data-lesson-meta>
//   {"title": "...", "subtitle": "...", "time": "60 минут", "level": "A1"}
//   </script>
//   <div data-lesson-part="sections"> ... HTML тела урока ... </div>
//   <div data-lesson-part="homework"> ... HTML домашнего задания ... </div>
//
// Всё остальное происходит само, без правок index.html / app.js:
//  • урок попадает в сайдбар под свой этап (LESSON_STAGES) и в карточку на главной;
//  • блоки <div class="hw-answers"> / <div class="hw-translation"> / <div class="hw-hint">
//    автоматически превращаются в раскрывающиеся кнопки «Ответы» / «Перевод» / «Подсказка»
//    (details.reveal) — можно писать и сразу <details class="reveal answer|translation">,
//    и просто <details> с <summary> — все форматы приводятся к одному фирменному виду;
//  • количество заданий и время ДЗ для шапки модалки считаются из содержимого файла;
//  • дневник прогресса, карта Италии, словарный тренажёр (td[data-word]) и истории
//    пересчитываются сами по загруженным урокам.
//
// Как сайт находит файлы уроков (без ручного списка и без потолка):
//  1) lessons/manifest.json — его автоматически пересобирает GitHub Action при пуше;
//  2) поверх манифеста (или вместо него, если файла нет — например, локально)
//     идёт пробирование волнами по 10 номеров, пока волна не окажется пустой.
// Имена файлов допускаются и как lesson-3.html, и как lesson-03.html.
let lessons = []; // заполняется асинхронно в discoverLessons() при старте приложения

// ============ ПЛАН ОБУЧЕНИЯ (единственное место, где задан размер курса) ============
// Меняешь план здесь — оглавление сайдбара, бейдж «N занятий» на главной, уровни CEFR
// и поздравления в дневнике пересчитываются сами. PLANNED_TOTAL нигде не пишется руками.
const LESSON_STAGES = [
  { n: 1, from: 1,  to: 15, title: 'Базовое выживание + Presente', level: 'A0 → A1' },
  { n: 2, from: 16, to: 28, title: 'Повседневная жизнь и Passato', level: 'A1+' },
  { n: 3, from: 29, to: 43, title: 'Прокачка до A2',               level: 'A1+ → A2' },
];
const PLANNED_TOTAL = LESSON_STAGES[LESSON_STAGES.length - 1].to;

// Спец-занятия со звездой. Тип определяет метку и её цвет.
const LESSON_SPECIAL = {
  14: 'practice',  15: 'assessment',
  27: 'practice',  28: 'practice',
  39: 'practice',  40: 'practice',  41: 'practice',
  42: 'exam',      43: 'exam',
};
const SPECIAL_META = {
  practice:   { label: 'Практика' },
  assessment: { label: 'Аттестация' },
  exam:       { label: 'Экзамен' },
};

function getLessonStage(number)  { return LESSON_STAGES.find(s => number >= s.from && number <= s.to) || null; }
function getLessonSpecial(number){ const k = LESSON_SPECIAL[number]; return k ? { key: k, ...SPECIAL_META[k] } : null; }

// Гербовая звезда для спец-занятий (единый стиль иконок, заливка золотом через CSS)
const NAV_STAR_SVG = '<span class="nav-star"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 17.3l-5.8 3.7 1.6-6.6-5.2-4.4 6.8-.5z"/></svg></span>';

// ── Авто-апгрейд блоков ответов/перевода ──
// Автор урока пишет простые блоки .hw-answers / .hw-translation; при разборе файла
// они превращаются в нативные details.reveal (CSS стилит их сам). Кнопки «Ответы» /
// «Перевод» появляются без единой строки JS в уроке и без ручной регистрации.
function upgradeRevealBlocks(rootEl) {
  rootEl.querySelectorAll('.hw-answers, .hw-translation, .hw-hint').forEach(div => {
    const isTranslation = div.classList.contains('hw-translation');
    const isHint = div.classList.contains('hw-hint');
    const det = document.createElement('details');
    det.className = 'reveal ' + (isTranslation ? 'translation' : 'answer');
    const summary = document.createElement('summary');
    const titleEl = div.querySelector('.hw-rev-title');
    summary.textContent = (titleEl ? titleEl.textContent.trim() : '') || (isHint ? 'Подсказка' : isTranslation ? 'Перевод' : 'Ответы');
    if (titleEl) titleEl.remove();
    const body = document.createElement('div');
    body.className = 'reveal-body';
    while (div.firstChild) body.appendChild(div.firstChild);
    det.append(summary, body);
    div.replaceWith(det);
  });

  // Обычные <details> без класса (уроки, свёрстанные с инлайн-стилями) приводим
  // к тому же фирменному виду: класс reveal + чистка инлайн-стилей — CSS дизайн-системы
  // стилит их сам, и все раскрывашки в курсе выглядят одинаково.
  rootEl.querySelectorAll('details:not(.reveal)').forEach(det => {
    const summary = det.querySelector(':scope > summary');
    if (!summary) return;
    const isTranslation = /перевод/i.test(summary.textContent);
    det.className = 'reveal ' + (isTranslation ? 'translation' : 'answer');
    det.removeAttribute('style');
    summary.removeAttribute('style');
    let label = summary.textContent.replace(/^\s*показать\s+/i, '').trim() || (isTranslation ? 'Перевод' : 'Ответы');
    summary.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    [...det.children].forEach(child => { if (child !== summary) child.removeAttribute('style'); });
  });
}

// Статистика ДЗ для шапки модалки: сколько заданий и «≈ N минут» — складываем время
// из всех .hw-section-time («≈ 10 минут», «≈ 8–12 минут» → середина диапазона).
function computeHwStats(hwEl) {
  if (!hwEl) return { count: 0, minutes: 0 };
  const count = hwEl.querySelectorAll('.hw-section').length;
  let minutes = 0;
  hwEl.querySelectorAll('.hw-section-time').forEach(el => {
    const m = el.textContent.match(/(\d+)(?:\s*[–—-]\s*(\d+))?/);
    if (m) minutes += m[2] ? (parseInt(m[1], 10) + parseInt(m[2], 10)) / 2 : parseInt(m[1], 10);
  });
  return { count, minutes: Math.round(minutes) };
}

// Достаёт метаданные и два маркированных блока (sections/homework) из текста файла урока.
function parseLessonFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  let meta = {};
  const metaScript = tpl.content.querySelector('script[data-lesson-meta]');
  if (metaScript) {
    try { meta = JSON.parse(metaScript.textContent); }
    catch (e) { console.error('[lesson meta] не удалось разобрать метаданные урока', e); }
  }
  const sectionsEl = tpl.content.querySelector('[data-lesson-part="sections"]');
  const hwEl = tpl.content.querySelector('[data-lesson-part="homework"]');
  if (sectionsEl) upgradeRevealBlocks(sectionsEl);
  if (hwEl) upgradeRevealBlocks(hwEl);
  return {
    meta,
    sectionsHTML: sectionsEl ? sectionsEl.innerHTML : '',
    homeworkHTML: hwEl ? hwEl.innerHTML : '',
    hwStats: computeHwStats(hwEl)
  };
}

// Возможные имена файла урока N — поддерживаем и вариант с ведущим нулём.
function lessonFileCandidates(n) {
  const names = [`lessons/lesson-${n}.html`];
  if (n < 10) names.push(`lessons/lesson-0${n}.html`);
  return names;
}

// Пытается загрузить и разобрать урок N. null — файла нет (это норма, а не сбой).
// Файл без блока sections считается «не уроком»: это отсекает dev-серверы,
// которые на несуществующий адрес отвечают 200 с содержимым index.html.
async function fetchLesson(n) {
  for (const url of lessonFileCandidates(n)) {
    try {
      const html = await loadLessonFragment(url);
      const parsed = parseLessonFragment(html);
      if (!parsed.sectionsHTML) continue;
      return {
        id: `lesson-${n}`,
        number: n,
        title: parsed.meta.title || `Урок ${n}`,
        subtitle: parsed.meta.subtitle || '',
        time: parsed.meta.time || '',
        level: parsed.meta.level || '',
        sectionsHTML: parsed.sectionsHTML,
        homeworkHTML: parsed.homeworkHTML,
        hwStats: parsed.hwStats
      };
    } catch (e) { /* пробуем следующее имя-кандидат */ }
  }
  return null;
}

// Номера уроков из lessons/manifest.json (его пересобирает GitHub Action при каждом
// пуше). Нет манифеста или он битый — вернём пустой список и перейдём на пробирование.
async function manifestLessonNumbers() {
  try {
    const res = await fetch('lessons/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const m = await res.json();
    const list = Array.isArray(m) ? m : (m.lessons || []);
    return [...new Set(
      list.map(f => {
        const match = String(f).match(/lesson-0*(\d+)\.html$/);
        return match ? parseInt(match[1], 10) : null;
      }).filter(n => n && n > 0)
    )];
  } catch (e) { return []; }
}

// Находит все существующие уроки. Сначала — номера из манифеста (мгновенно, без
// лишних запросов), затем пробирование волнами: каждая волна из 10 номеров уходит
// параллельно, пустая волна означает конец списка. Ручного потолка нет — HARD_CAP
// стоит только как защита от сервера, отвечающего 200 на любой адрес.
async function discoverLessons() {
  const found = new Map();
  const probe = async (n) => {
    if (found.has(n)) return;
    const lesson = await fetchLesson(n);
    if (lesson) found.set(n, lesson);
  };

  // 1) манифест + дозаполнение пропусков в его диапазоне (манифест мог устареть)
  const known = await manifestLessonNumbers();
  const maxKnown = known.length ? Math.max(...known) : 0;
  const firstPass = new Set(known);
  for (let n = 1; n <= maxKnown; n++) firstPass.add(n);
  await Promise.all([...firstPass].map(probe));

  // 2) волны за пределами манифеста — подхватывают уроки, добавленные локально
  const WAVE = 10;
  const HARD_CAP = 500;
  let from = maxKnown + 1;
  while (from <= HARD_CAP) {
    const wave = [];
    for (let n = from; n < from + WAVE; n++) wave.push(n);
    const before = found.size;
    await Promise.all(wave.map(probe));
    if (found.size === before) break; // пустая волна — дальше уроков нет
    from += WAVE;
  }

  return [...found.values()].sort((a, b) => a.number - b.number);
}

// ============ СЛОВАРНЫЙ ТРЕНАЖЁР (идея №1) ============
// Автоматически собирает словарь из уже подключённых уроков (ищет пары
// <td data-word>слово</td><td>перевод</td> — тот же атрибут, что уже используется
// для кнопок озвучки) и даёт потренировать его карточками-перевертышами.
// Слова "вперемешку" — без разделения по урокам, только тег урока для справки.
const VOCAB_PROGRESS_KEY = 'vocab_progress'; // { 'casa': 0|1|2, ... } — мини-Лейтнер

function extractVocabFromHTML(html, lessonNumber) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out = [];
  tpl.content.querySelectorAll('td[data-word]').forEach(td => {
    const word = (td.dataset.word || '').trim();
    const nextTd = td.nextElementSibling;
    if (!word || !nextTd || nextTd.tagName !== 'TD') return;
    const translation = nextTd.textContent.trim();
    if (!translation) return;
    out.push({ it: word, ru: translation, lesson: lessonNumber });
  });
  return out;
}

// Служебный «мусор» из таблиц (артикли, союзы), который не нужен как слово для практики
const VOCAB_SKIP = new Set(['i', 'gli', 'le', 'il', 'lo', 'la', "l'", 'un', 'uno', 'una', "un'", 'e', 'è', 'o', 'a', 'di', 'da']);

function buildVocabPool() {
  const pool = [];
  const seen = new Set();
  lessons.forEach(lesson => {
    [lesson.sectionsHTML, lesson.homeworkHTML].forEach(html => {
      if (!html) return;
      extractVocabFromHTML(html, lesson.number).forEach(item => {
        const key = item.it.toLowerCase();
        if (seen.has(key)) return;
        if (key.length < 2 || VOCAB_SKIP.has(key)) return; // пропускаем артикли/однобуквенные
        seen.add(key);
        pool.push(item);
      });
    });
  });
  return pool;
}

function getVocabProgress() { return storageGet(VOCAB_PROGRESS_KEY) || {}; }
function setVocabProgress(map) { storageSet(VOCAB_PROGRESS_KEY, map); cloudPush(VOCAB_PROGRESS_KEY); }

// Слова, которые ещё "не закрепились" (box 0), показываются заметно чаще, чем те,
// что уже отмечены как известные (box 2) — простой аналог интервального повторения.
function pickVocabWord(pool, excludeWord) {
  if (!pool.length) return null;
  const progress = getVocabProgress();
  const candidates = pool.length > 1 ? pool.filter(w => w.it !== excludeWord) : pool;
  const weighted = [];
  candidates.forEach(item => {
    const box = progress[item.it.toLowerCase()] ?? 0;
    const weight = box === 0 ? 5 : box === 1 ? 2 : 1;
    for (let i = 0; i < weight; i++) weighted.push(item);
  });
  return weighted[Math.floor(Math.random() * weighted.length)];
}

let currentVocabItem = null;

// Иконки тренажёра
const ICON_TRAINER_OPEN = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5" width="12" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 5V3.8C8 3.4 8.3 3 8.8 3H19c.5 0 1 .4 1 1v13c0 .5-.5 1-1 1h-1.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_VOCAB_SWAP = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_VOCAB_CARDS = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="6" width="17" height="12" rx="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 10h17" stroke="currentColor" stroke-width="1.5"/></svg>';
const ICON_VOCAB_LIST = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_VOCAB_SPEAK = '<svg class="cs" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function renderVocabTrainer() {
  const card = document.getElementById('vocabTrainerCard');
  if (!card) return;

  const pool = buildVocabPool();
  if (!pool.length) {
    card.innerHTML = `
      <div class="vocab-card-head">
        <span class="vocab-card-icon"><span class="ico"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="6.5" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.5" transform="rotate(-7 10.5 12)"/><rect x="6.5" y="4.5" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/></svg></span></span>
        <div class="vocab-card-head-text">
          <span class="vocab-card-title">Словарный тренажёр</span>
          <span class="vocab-card-status vocab-card-status-soon"><span class="vocab-status-dot"></span>Пока пусто</span>
        </div>
      </div>
      <div class="vocab-card-body">
        <p class="vocab-trainer-empty">Здесь появятся слова для практики, как только подключится хотя бы один урок.</p>
      </div>
    `;
    return;
  }

  const progress = getVocabProgress();
  const knownCount = pool.filter(w => (progress[w.it.toLowerCase()] ?? 0) === 2).length;
  currentVocabItem = pickVocabWord(pool, currentVocabItem ? currentVocabItem.it : null);

  card.innerHTML = `
    <div class="vocab-card-head">
      <span class="vocab-card-icon"><span class="ico"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="6.5" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.5" transform="rotate(-7 10.5 12)"/><rect x="6.5" y="4.5" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/></svg></span></span>
      <div class="vocab-card-head-text">
        <span class="vocab-card-title">Словарный тренажёр</span>
        <span class="vocab-card-status"><span class="vocab-status-dot"></span>${pool.length} слов в копилке</span>
      </div>
    </div>
    <div class="vocab-card-body">
      <p class="vocab-trainer-sub">Слова из пройденных уроков, вперемешку — вспомни перевод</p>
      <div class="vocab-flip-area">
        <div class="hw-vocab-cloud"><span>${currentVocabItem.it}</span></div>
        <div class="vocab-translation" id="vocabTranslation" style="display:none;">
          <span class="vocab-translation-text">${currentVocabItem.ru}</span>
          <span class="vocab-lesson-tag">Урок ${currentVocabItem.lesson}</span>
        </div>
        <button class="vocab-reveal-btn" id="vocabRevealBtn" type="button">Показать перевод</button>
      </div>
      <div class="vocab-actions" id="vocabActions" style="display:none;">
        <button class="vocab-action-btn vocab-action-retry" data-action="retry" type="button">Повторить ещё раз</button>
        <button class="vocab-action-btn vocab-action-known" data-action="known" type="button">Запомнила!</button>
      </div>
      <div class="vocab-progress-bar-track"><div class="vocab-progress-bar-fill" style="width:${Math.round(knownCount / pool.length * 100)}%"></div></div>
      <p class="vocab-progress-label">${knownCount} из ${pool.length} уже закрепила</p>
      <button class="vocab-open-btn" id="vocabOpenBtn" type="button"><span class="ico">${ICON_TRAINER_OPEN}</span>Открыть тренажёр</button>
    </div>
  `;

  const revealBtn = document.getElementById('vocabRevealBtn');
  revealBtn.addEventListener('click', () => {
    document.getElementById('vocabTranslation').style.display = 'flex';
    document.getElementById('vocabActions').style.display = 'flex';
    revealBtn.style.display = 'none';
  });

  card.querySelectorAll('.vocab-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const map = getVocabProgress();
      const key = currentVocabItem.it.toLowerCase();
      // «Запомнила» сразу отмечает слово выученным (box 2) → счётчик прогресса реагирует;
      // «Повторить» сбрасывает в 0. (Раньше known давал box+1, и до «закреплено» почти не доходило.)
      map[key] = btn.dataset.action === 'known' ? 2 : 0;
      setVocabProgress(map);
      renderVocabTrainer();
    });
  });

  const openBtn = document.getElementById('vocabOpenBtn');
  if (openBtn) openBtn.addEventListener('click', openVocabModal);
}

// ============ МОДАЛКА СЛОВАРНОГО ТРЕНАЖЁРА ============
// Удобное окно: карточки с переворотом, озвучка, направление IT⇄RU,
// фильтр по урокам, список всех слов со статусами, кольцо прогресса, клавиши.
const vocabModalState = {
  filterLesson: 'all', direction: 'it-ru', view: 'card',
  current: null, revealed: false, sessionSeen: 0, sessionKnown: 0,
};

function vocabBoxOf(itWord) { return getVocabProgress()[itWord.toLowerCase()] ?? 0; }
function vocabFilteredPool() {
  const pool = buildVocabPool();
  return vocabModalState.filterLesson === 'all' ? pool : pool.filter(w => w.lesson === vocabModalState.filterLesson);
}
function vocabLessonsAvailable() {
  return [...new Set(buildVocabPool().map(w => w.lesson))].sort((a, b) => a - b);
}
function vocabPickNext() {
  const pool = vocabFilteredPool();
  vocabModalState.current = pickVocabWord(pool, vocabModalState.current ? vocabModalState.current.it : null);
  vocabModalState.revealed = false;
}

function renderVocabRing(learned, total) {
  const pct = total ? learned / total : 0;
  const R = 20, C = 2 * Math.PI * R, off = C * (1 - pct);
  return `<svg class="vocab-ring" viewBox="0 0 48 48" width="48" height="48">
    <circle cx="24" cy="24" r="${R}" fill="none" stroke="var(--line,#ece2d4)" stroke-width="5"/>
    <circle cx="24" cy="24" r="${R}" fill="none" stroke="var(--olive,#7a8a4e)" stroke-width="5"
      stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 24 24)"/>
    <text x="24" y="25" text-anchor="middle" dominant-baseline="middle" class="vocab-ring-pct">${Math.round(pct * 100)}%</text>
  </svg>`;
}

function renderVocabCardHTML() {
  const s = vocabModalState;
  const pool = vocabFilteredPool();
  if (!pool.length) return `<p class="vocab-empty-note">Нет слов для этого фильтра.</p>`;
  if (!s.current || !pool.some(w => w.it === s.current.it)) vocabPickNext();
  const w = s.current;
  const front = s.direction === 'it-ru' ? w.it : w.ru;
  const back = s.direction === 'it-ru' ? w.ru : w.it;
  return `
    <div class="vocab-card-view">
      <div class="vocab-flashcard${s.revealed ? ' is-revealed' : ''}" id="vocabFlashcard">
        <button class="vocab-fc-speak" id="vocabSpeakBtn" type="button" aria-label="Произнести">${ICON_VOCAB_SPEAK}</button>
        <span class="vocab-fc-word">${front}</span>
        <div class="vocab-fc-back">
          <span class="vocab-fc-divider"></span>
          <span class="vocab-fc-answer">${back}</span>
          <span class="vocab-lesson-tag">Урок ${w.lesson}</span>
        </div>
        <span class="vocab-fc-hint">нажми, чтобы увидеть перевод</span>
      </div>
      <div class="vocab-card-actions${s.revealed ? '' : ' is-hidden'}">
        <button class="vocab-act vocab-act-retry" data-action="retry" type="button">Повторить</button>
        <button class="vocab-act vocab-act-known" data-action="known" type="button">Запомнила!</button>
      </div>
      <p class="vocab-kbd-hint">Пробел — перевернуть · ← повторить · → запомнила</p>
    </div>`;
}

function renderVocabListHTML() {
  const pool = vocabFilteredPool();
  if (!pool.length) return `<p class="vocab-empty-note">Нет слов для этого фильтра.</p>`;
  const rows = pool.map(w => {
    const box = vocabBoxOf(w.it);
    const st = box === 2 ? 'learned' : (box === 1 ? 'learning' : 'new');
    const lab = box === 2 ? 'выучено' : (box === 1 ? 'учу' : 'новое');
    return `<button class="vocab-list-row" data-it="${w.it}" type="button">
      <span class="vocab-list-dot ${st}"></span>
      <span class="vocab-list-it">${w.it}</span>
      <span class="vocab-list-ru">${w.ru}</span>
      <span class="vocab-list-badge ${st}">${lab}</span>
    </button>`;
  }).join('');
  return `<div class="vocab-list">${rows}</div>`;
}

function renderVocabModalContent() {
  const content = document.getElementById('vocabModalContent');
  if (!content) return;
  const fullPool = buildVocabPool();
  const total = fullPool.length;
  const learned = fullPool.filter(w => vocabBoxOf(w.it) === 2).length;
  const s = vocabModalState;
  const chips = ['all', ...vocabLessonsAvailable()].map(l => {
    const active = (s.filterLesson === l) ? ' is-active' : '';
    return `<button class="vocab-chip${active}" data-lesson="${l}" type="button">${l === 'all' ? 'Все' : 'Урок ' + l}</button>`;
  }).join('');
  const dirLabel = s.direction === 'it-ru' ? 'IT → RU' : 'RU → IT';
  const body = s.view === 'list' ? renderVocabListHTML() : renderVocabCardHTML();

  content.innerHTML = `
    <div class="vocab-reader">
      <header class="vocab-reader-head">
        <div class="vocab-reader-titlewrap">
          <span class="vocab-reader-title">Словарный тренажёр</span>
          <span class="vocab-reader-sub">${learned} из ${total} слов выучено</span>
        </div>
        ${renderVocabRing(learned, total)}
      </header>
      <div class="vocab-reader-toolbar">
        <button class="vocab-tool-btn" id="vocabDirBtn" type="button"><span class="ico">${ICON_VOCAB_SWAP}</span>${dirLabel}</button>
        <button class="vocab-tool-btn${s.view === 'list' ? ' is-active' : ''}" id="vocabViewBtn" type="button"><span class="ico">${s.view === 'list' ? ICON_VOCAB_CARDS : ICON_VOCAB_LIST}</span>${s.view === 'list' ? 'Карточки' : 'Список'}</button>
        <div class="vocab-chips">${chips}</div>
      </div>
      <div class="vocab-reader-body">${body}</div>
      <footer class="vocab-reader-foot">
        <span class="vocab-foot-stat">За сессию: показано ${s.sessionSeen} · запомнила ${s.sessionKnown}</span>
        <button class="vocab-reset-btn" id="vocabResetBtn" type="button">Сбросить прогресс</button>
      </footer>
    </div>`;
  bindVocabModalContent();
}

function bindVocabModalContent() {
  const content = document.getElementById('vocabModalContent');
  if (!content) return;
  const dirBtn = content.querySelector('#vocabDirBtn');
  if (dirBtn) dirBtn.addEventListener('click', () => {
    vocabModalState.direction = vocabModalState.direction === 'it-ru' ? 'ru-it' : 'it-ru';
    vocabModalState.revealed = false; renderVocabModalContent();
  });
  const viewBtn = content.querySelector('#vocabViewBtn');
  if (viewBtn) viewBtn.addEventListener('click', () => {
    vocabModalState.view = vocabModalState.view === 'list' ? 'card' : 'list'; renderVocabModalContent();
  });
  content.querySelectorAll('.vocab-chip').forEach(chip => chip.addEventListener('click', () => {
    const l = chip.dataset.lesson;
    vocabModalState.filterLesson = (l === 'all') ? 'all' : Number(l);
    vocabModalState.current = null; vocabModalState.revealed = false; renderVocabModalContent();
  }));
  const fc = content.querySelector('#vocabFlashcard');
  if (fc) fc.addEventListener('click', () => {
    if (!vocabModalState.revealed) { vocabModalState.revealed = true; vocabModalState.sessionSeen++; renderVocabModalContent(); }
  });
  const speakBtn = content.querySelector('#vocabSpeakBtn');
  if (speakBtn) speakBtn.addEventListener('click', (e) => { e.stopPropagation(); vocabSpeakCurrent(e.currentTarget); });
  content.querySelectorAll('.vocab-act').forEach(btn => btn.addEventListener('click', () => vocabMark(btn.dataset.action)));
  content.querySelectorAll('.vocab-list-row').forEach(row => row.addEventListener('click', () => {
    row.classList.add('speaking');
    const p = window.speakIt ? window.speakIt(row.dataset.it) : Promise.resolve();
    if (p && p.then) p.then(() => row.classList.remove('speaking')); else setTimeout(() => row.classList.remove('speaking'), 600);
  }));
  const resetBtn = content.querySelector('#vocabResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (confirm('Сбросить весь прогресс изучения слов?')) {
      setVocabProgress({});
      vocabModalState.sessionSeen = 0; vocabModalState.sessionKnown = 0;
      renderVocabModalContent(); renderVocabTrainer();
    }
  });
}

function vocabSpeakCurrent(btn) {
  const w = vocabModalState.current; if (!w) return;
  if (btn) btn.classList.add('speaking');
  const p = window.speakIt ? window.speakIt(w.it) : Promise.resolve();
  if (p && p.then) p.then(() => btn && btn.classList.remove('speaking')); else setTimeout(() => btn && btn.classList.remove('speaking'), 600);
}

function vocabMark(action) {
  const w = vocabModalState.current; if (!w) return;
  const map = getVocabProgress();
  map[w.it.toLowerCase()] = action === 'known' ? 2 : 0;   // known → выучено сразу, retry → сброс
  setVocabProgress(map);
  if (action === 'known') vocabModalState.sessionKnown++;
  vocabPickNext();
  renderVocabModalContent();
  renderVocabTrainer(); // синхронизируем компактную карточку
}

function openVocabModal() {
  const modal = document.getElementById('vocabModal');
  if (!modal) return;
  vocabModalState.current = null; vocabModalState.revealed = false;
  vocabPickNext();
  renderVocabModalContent();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('vocabModalCloseBtn').onclick = closeVocabModal;
  modal.onclick = (e) => { if (e.target === modal) closeVocabModal(); };
  const panel = modal.querySelector('.story-modal-panel');
  if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus({ preventScroll: true }); }
}

function closeVocabModal() {
  if (window.stopSpeaking) window.stopSpeaking();
  const modal = document.getElementById('vocabModal');
  if (modal) modal.classList.remove('open');
  const hw = document.getElementById('hwModal'), st = document.getElementById('storyModal');
  if (!(hw && hw.classList.contains('open')) && !(st && st.classList.contains('open'))) document.body.style.overflow = '';
}

// Клавиши в окне тренажёра (регистрируем один раз)
if (!window.__vocabKeyBound) {
  window.__vocabKeyBound = true;
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('vocabModal');
    if (!modal || !modal.classList.contains('open')) return;
    if (e.key === 'Escape') { closeVocabModal(); return; }
    if (vocabModalState.view !== 'card') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!vocabModalState.revealed && vocabModalState.current) { vocabModalState.revealed = true; vocabModalState.sessionSeen++; renderVocabModalContent(); }
    } else if (vocabModalState.revealed && e.key === 'ArrowRight') { vocabMark('known'); }
    else if (vocabModalState.revealed && e.key === 'ArrowLeft') { vocabMark('retry'); }
  });
}

// ============ ГЕНЕРАТОР ИСТОРИЙ (вторая идея лексики) ============
// Система пишет СВЯЗНЫЕ, грамматически правильные мини-истории из лексики пройденных уроков.
// Не случайная подстановка слов, а грамматический движок: согласование рода/числа
// (allegro→allegra), правильные артикли (il/lo/la/l'/un/uno/una), спряжение essere,
// конструкция c'è / ci sono. Сценарии открываются по мере прохождения уроков.

// Иконки тем для блока «Истории» (заменяют эмодзи-стикеры) — должны быть объявлены
// раньше STORY_SCENARIOS, который их использует в значениях icon.
const ICON_STORY_BOOK_OPEN = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 6C10.2 4.7 7.7 4.3 5 4.7V17.3C7.7 16.9 10.2 17.3 12 18.6C13.8 17.3 16.3 16.9 19 17.3V4.7C16.3 4.3 13.8 4.7 12 6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><path d="M12 6V18.6" stroke="currentColor" stroke-width="1.3" opacity="0.5"/></svg>';
// Стрелка для CTA «Читать историю» и значок «развернуть» для кнопки открытия полноэкранного режима
const ICON_ARROW_RIGHT_HTML = '<span class="ico"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12H19M19 12L13.5 6.5M19 12L13.5 17.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
const ICON_EXPAND_HTML = '<span class="ico"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 4.5H4.5V9M15 4.5H19.5V9M9 19.5H4.5V15M15 19.5H19.5V15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
const ICON_STORY_GREETING = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 6C4.5 4.9 5.4 4 6.5 4H17.5C18.6 4 19.5 4.9 19.5 6V14C19.5 15.1 18.6 16 17.5 16H10L6 19.5V16H6.5C5.4 16 4.5 15.1 4.5 14V6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.5 9.5C9.1 10.5 10.3 11.2 12 11.2C13.7 11.2 14.9 10.5 15.5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_STORY_PERSON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 19.5C5 15.9 8.1 13 12 13C15.9 13 19 15.9 19 19.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_STORY_FRIENDS = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="16.5" cy="9.3" r="2.5" stroke="currentColor" stroke-width="1.4" opacity="0.8"/><path d="M3.5 19.5C3.5 16.1 6 13.5 9 13.5C12 13.5 14.5 16.1 14.5 19.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14.5 19.5C14.6 16.8 16.3 14.8 18.4 14.8C20.4 14.8 21.9 16.6 21.9 19.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.8"/></svg>';
const ICON_STORY_HOUSE = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 11.5L12 4.5L20.5 11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><rect x="6" y="10" width="12" height="10" rx="1.6" stroke="currentColor" stroke-width="1.6"/><rect x="10" y="14" width="4" height="6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const ICON_STORY_SOFA = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.3 12V8.8C6.3 7.8 7.1 7 8.1 7H15.9C16.9 7 17.7 7.8 17.7 8.8V12" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="3.7" y="12" width="16.6" height="5.3" rx="1.6" stroke="currentColor" stroke-width="1.5"/><path d="M5.3 17.3V19.3M18.7 17.3V19.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_STORY_WINDOW = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4.5" y="3.5" width="15" height="17" rx="1.8" stroke="currentColor" stroke-width="1.5"/><path d="M12 3.5V20.5M4.5 12H19.5" stroke="currentColor" stroke-width="1.3" opacity="0.6"/></svg>';
const ICON_STORY_SELF = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5" width="17" height="14" rx="2.2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10.8" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M6.2 15.5C6.7 13.9 7.7 13.1 9 13.1C10.3 13.1 11.3 13.9 11.8 15.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M14.5 9.3H18M14.5 12H18M14.5 14.7H16.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/></svg>';
const ICON_STORY_HOME_COZY = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 11.5L12 4.5L20.5 11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><rect x="6" y="10" width="12" height="10" rx="1.6" stroke="currentColor" stroke-width="1.6"/><rect x="10" y="14" width="4" height="6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 17C12 17 10 15.8 10 14.6C10 13.8 10.6 13.2 11.3 13.2C11.7 13.2 12 13.4 12 13.7C12 13.4 12.3 13.2 12.7 13.2C13.4 13.2 14 13.8 14 14.6C14 15.8 12 17 12 17Z" fill="currentColor" opacity="0.7"/></svg>';

// --- Словарная база с полными грамматическими данными ---
const STORY_BANK = {
  // Имена (подлежащие). g = грамматический род
  nomi: [
    { it: 'Marco',  ru: 'Марко',  g: 'm' },
    { it: 'Luca',   ru: 'Лука',   g: 'm' },
    { it: 'Paolo',  ru: 'Паоло',  g: 'm' },
    { it: 'Anna',   ru: 'Анна',   g: 'f' },
    { it: 'Sofia',  ru: 'София',  g: 'f' },
    { it: 'Giulia', ru: 'Джулия', g: 'f' },
  ],
  // Национальности (урок 2). type: 'o' (russo/russa) или 'e' (inglese — не меняется)
  nazioni: [
    { it: 'italiano', type: 'o', ruM: 'итальянец',   ruF: 'итальянка',  lesson: 2 },
    { it: 'russo',    type: 'o', ruM: 'русский',      ruF: 'русская',    lesson: 1 },
    { it: 'spagnolo', type: 'o', ruM: 'испанец',      ruF: 'испанка',    lesson: 2 },
    { it: 'americano',type: 'o', ruM: 'американец',   ruF: 'американка', lesson: 2 },
    { it: 'tedesco',  type: 'o', ruM: 'немец',        ruF: 'немка',      lesson: 2 },
    { it: 'francese', type: 'e', ruM: 'француз',      ruF: 'француженка',lesson: 2 },
    { it: 'inglese',  type: 'e', ruM: 'англичанин',   ruF: 'англичанка', lesson: 2 },
    { it: 'cinese',   type: 'e', ruM: 'китаец',       ruF: 'китаянка',   lesson: 2 },
  ],
  // Характер (урок 2). type 'o' или 'e'
  caratteri: [
    { it: 'allegro',     type: 'o', ruM: 'весёлый',     ruF: 'весёлая',     lesson: 2 },
    { it: 'simpatico',   type: 'o', ruM: 'милый',       ruF: 'милая',       lesson: 2 },
    { it: 'calmo',       type: 'o', ruM: 'спокойный',   ruF: 'спокойная',   lesson: 2 },
    { it: 'generoso',    type: 'o', ruM: 'щедрый',      ruF: 'щедрая',      lesson: 2 },
    { it: 'onesto',      type: 'o', ruM: 'честный',     ruF: 'честная',     lesson: 2 },
    { it: 'timido',      type: 'o', ruM: 'застенчивый', ruF: 'застенчивая', lesson: 2 },
    { it: 'serio',       type: 'o', ruM: 'серьёзный',   ruF: 'серьёзная',   lesson: 2 },
    { it: 'gentile',     type: 'e', ruM: 'добрый',      ruF: 'добрая',      lesson: 2 },
    { it: 'intelligente',type: 'e', ruM: 'умный',       ruF: 'умная',       lesson: 2 },
    { it: 'paziente',    type: 'e', ruM: 'терпеливый',  ruF: 'терпеливая',  lesson: 2 },
  ],
  // Комнаты (урок 3). poss = притяжательное «моя/мой», locIt = «в/на (ит.)», locRu = по-русски
  stanze: [
    { it: 'cucina',    ru: 'кухня',    g: 'f', art: 'la', indef: 'una', poss: 'la mia', locIt: 'In cucina',     locRu: 'На кухне',    lesson: 3 },
    { it: 'bagno',     ru: 'ванная',   g: 'm', art: 'il', indef: 'un',  poss: 'il mio', locIt: 'In bagno',      locRu: 'В ванной',    lesson: 3 },
    { it: 'camera',    ru: 'спальня',  g: 'f', art: 'la', indef: 'una', poss: 'la mia', locIt: 'In camera',     locRu: 'В спальне',   lesson: 3 },
    { it: 'soggiorno', ru: 'гостиная', g: 'm', art: 'il', indef: 'un',  poss: 'il mio', locIt: 'In soggiorno',  locRu: 'В гостиной',  lesson: 3 },
    { it: 'corridoio', ru: 'коридор',  g: 'm', art: 'il', indef: 'un',  poss: 'il mio', locIt: 'Nel corridoio', locRu: 'В коридоре',  lesson: 3 },
    { it: 'balcone',   ru: 'балкон',   g: 'm', art: 'il', indef: 'un',  poss: 'il mio', locIt: 'Sul balcone',   locRu: 'На балконе',  lesson: 3 },
  ],
  // Мебель (урок 3). plur = ит. мн.ч., ruGen = форма для «два/две» (родит. ед.)
  mobili: [
    { it: 'letto',     ru: 'кровать',         g: 'm', indef: 'un',  plur: 'letti',     ruPl: 'кровати', ruDue: 'две кровати', lesson: 3 },
    { it: 'armadio',   ru: 'шкаф',            g: 'm', indef: 'un',  plur: 'armadi',    ruPl: 'шкафы',   ruDue: 'два шкафа',   lesson: 3 },
    { it: 'scrivania', ru: 'письменный стол', g: 'f', indef: 'una', plur: 'scrivanie', ruPl: 'столы',   ruDue: 'два стола',   lesson: 3 },
    { it: 'sedia',     ru: 'стул',            g: 'f', indef: 'una', plur: 'sedie',     ruPl: 'стулья',  ruDue: 'два стула',   lesson: 3 },
    { it: 'divano',    ru: 'диван',           g: 'm', indef: 'un',  plur: 'divani',    ruPl: 'диваны',  ruDue: 'два дивана',  lesson: 3 },
    { it: 'specchio',  ru: 'зеркало',         g: 'm', indef: 'uno', plur: 'specchi',   ruPl: 'зеркала', ruDue: 'два зеркала', lesson: 3 },
    { it: 'lampada',   ru: 'лампа',           g: 'f', indef: 'una', plur: 'lampade',   ruPl: 'лампы',   ruDue: 'две лампы',   lesson: 3 },
  ],
  // Качества (для дома/комнат). type 'o'/'e'. ruM/ruF/ruN — по роду РУССКОГО слова
  qualita: [
    { it: 'bello',       type: 'o', ruM: 'красивый',   ruF: 'красивая',   ruN: 'красивое',   lesson: 3 },
    { it: 'grande',      type: 'e', ruM: 'большой',    ruF: 'большая',    ruN: 'большое',    lesson: 3 },
    { it: 'piccolo',     type: 'o', ruM: 'маленький',  ruF: 'маленькая',  ruN: 'маленькое',  lesson: 3 },
    { it: 'moderno',     type: 'o', ruM: 'современный', ruF: 'современная', ruN: 'современное', lesson: 3 },
    { it: 'nuovo',       type: 'o', ruM: 'новый',      ruF: 'новая',      ruN: 'новое',      lesson: 3 },
    { it: 'comodo',      type: 'o', ruM: 'удобный',    ruF: 'удобная',    ruN: 'удобное',    lesson: 3 },
    { it: 'luminoso',    type: 'o', ruM: 'светлый',    ruF: 'светлая',    ruN: 'светлое',    lesson: 3 },
    { it: 'accogliente', type: 'e', ruM: 'уютный',     ruF: 'уютная',     ruN: 'уютное',     lesson: 3 },
  ],
};
// Дом как тема рассказа: ит. casa — ж.р., рус. «дом» — м.р.
const STORY_HOME = { it: 'casa', poss: 'la mia', itG: 'f', ru: 'дом', ruG: 'm' };
// Русский род прилагательного по роду русского существительного
function qRu(q, ruGender) { return ruGender === 'f' ? q.ruF : (ruGender === 'n' ? q.ruN : q.ruM); }

// --- Грамматический движок ---
// Согласование прилагательного/национальности по роду (ед. число)
function agreeAdj(w, gender) {
  if (w.type === 'e') return w.it;                 // gentile, inglese — не меняются в ед.ч.
  const stem = w.it.slice(0, -1);                  // allegr- / russ-
  return stem + (gender === 'f' ? 'a' : 'o');      // allegra / allegro
}
function adjRu(w, gender) { return gender === 'f' ? w.ruF : w.ruM; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickTwo(arr) {
  if (arr.length < 2) return [arr[0], arr[0]];
  const a = pick(arr); let b = pick(arr); let guard = 0;
  while (b === a && guard++ < 20) b = pick(arr);
  return [a, b];
}
// n различных элементов (без повторов, если хватает)
function pickN(arr, n) {
  const copy = [...arr]; const out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}
// «друзья»: обе женского рода → amiche, иначе amici
function amiciForm(g1, g2) { return (g1 === 'f' && g2 === 'f') ? 'amiche' : 'amici'; }

// --- Сценарии. Каждый отдаёт {theme, icon, lesson, lines:[{it,ru}], words:[{it,ru}]} ---
const STORY_SCENARIOS = [
  // L1: Знакомство
  {
    theme: 'Знакомство', icon: ICON_STORY_GREETING, lesson: 1,
    build() {
      const p = pick(STORY_BANK.nomi);
      const naz = pick(STORY_BANK.nazioni.filter(n => n.lesson <= 1).length
        ? STORY_BANK.nazioni.filter(n => n.lesson <= 1) : STORY_BANK.nazioni);
      const nazIt = agreeAdj(naz, p.g);
      const profIt = p.g === 'f' ? 'studentessa' : 'studente';
      const profRu = p.g === 'f' ? 'студентка' : 'студент';
      const greet = pick(['Ciao', 'Buongiorno']);
      return {
        lines: [
          { it: `${greet}! Io sono ${p.it}.`, ru: `${greet === 'Ciao' ? 'Привет' : 'Добрый день'}! Я ${p.ru}.` },
          { it: `Sono ${nazIt} e sono ${profIt}. Piacere!`, ru: `Я ${adjRu(naz, p.g)}, я ${profRu}. Приятно познакомиться!` },
        ],
        words: [ { it: nazIt, ru: adjRu(naz, p.g) }, { it: profIt, ru: profRu } ],
      };
    },
  },
  // L2: Характер человека
  {
    theme: 'Характер', icon: ICON_STORY_PERSON, lesson: 2,
    build() {
      const p = pick(STORY_BANK.nomi);
      const naz = pick(STORY_BANK.nazioni);
      const [a1, a2] = pickTwo(STORY_BANK.caratteri);
      const adv = pick(['molto', 'davvero', 'sempre']);
      const advRu = { molto: 'очень', davvero: 'действительно', sempre: 'всегда' }[adv];
      const nazIt = agreeAdj(naz, p.g), a1It = agreeAdj(a1, p.g), a2It = agreeAdj(a2, p.g);
      return {
        lines: [
          { it: `${p.it} è ${nazIt}.`, ru: `${p.ru} — ${adjRu(naz, p.g)}.` },
          { it: `È ${adv} ${a1It} e ${a2It}.`, ru: `${cap(advRu)} ${adjRu(a1, p.g)} и ${adjRu(a2, p.g)}.` },
        ],
        words: [ { it: nazIt, ru: adjRu(naz, p.g) }, { it: a1It, ru: adjRu(a1, p.g) }, { it: a2It, ru: adjRu(a2, p.g) } ],
      };
    },
  },
  // L2: Два друга (контраст)
  {
    theme: 'Два друга', icon: ICON_STORY_FRIENDS, lesson: 2,
    build() {
      const [p1, p2] = pickTwo(STORY_BANK.nomi);
      const [a1, a2] = pickTwo(STORY_BANK.caratteri);
      const a1It = agreeAdj(a1, p1.g), a2It = agreeAdj(a2, p2.g);
      const amici = amiciForm(p1.g, p2.g);
      const amiciRu = amici === 'amiche' ? 'подруги' : 'друзья';
      return {
        lines: [
          { it: `${p1.it} e ${p2.it} sono ${amici}.`, ru: `${p1.ru} и ${p2.ru} — ${amiciRu}.` },
          { it: `${p1.it} è ${a1It}, ma ${p2.it} è ${a2It}.`, ru: `${p1.ru} ${adjRu(a1, p1.g)}, а ${p2.ru} ${adjRu(a2, p2.g)}.` },
        ],
        words: [ { it: a1It, ru: adjRu(a1, p1.g) }, { it: a2It, ru: adjRu(a2, p2.g) } ],
      };
    },
  },
  // L3: Моя квартира
  {
    theme: 'Мой дом', icon: ICON_STORY_HOUSE, lesson: 3,
    build() {
      const room = pick(STORY_BANK.stanze);
      const [m1, m2] = pickTwo(STORY_BANK.mobili);
      return {
        lines: [
          { it: `Questa è ${room.poss} ${room.it}.`, ru: `Это ${room.g === 'f' ? 'моя' : 'мой'} ${room.ru}.` },
          { it: `C'è ${m1.indef} ${m1.it} e ${m2.indef} ${m2.it}.`, ru: `Здесь есть ${m1.ru} и ${m2.ru}.` },
        ],
        words: [ { it: room.it, ru: room.ru }, { it: m1.it, ru: m1.ru }, { it: m2.it, ru: m2.ru } ],
      };
    },
  },
  // L3: Описание комнаты с c'è / ci sono
  {
    theme: 'Комната', icon: ICON_STORY_SOFA, lesson: 3,
    build() {
      const room = pick(STORY_BANK.stanze);
      const [m1, m2] = pickTwo(STORY_BANK.mobili);
      return {
        lines: [
          { it: `${room.locIt} c'è ${m1.indef} ${m1.it}.`, ru: `${room.locRu} есть ${m1.ru}.` },
          { it: `Ci sono anche due ${m2.plur}.`, ru: `Ещё есть ${m2.ruDue}.` },
        ],
        words: [ { it: m1.it, ru: m1.ru }, { it: m2.plur, ru: m2.ruPl } ],
      };
    },
  },
  // L3: Человек и его дом (объединяет урок 2 + 3)
  {
    theme: 'Человек и дом', icon: ICON_STORY_WINDOW, lesson: 3,
    build() {
      const p = pick(STORY_BANK.nomi);
      const car = pick(STORY_BANK.caratteri);
      const room = pick(STORY_BANK.stanze);
      const m1 = pick(STORY_BANK.mobili);
      const carIt = agreeAdj(car, p.g);
      return {
        lines: [
          { it: `${p.it} è una persona ${agreeAdj(car, 'f')}.`, ru: `${p.ru} по натуре ${adjRu(car, p.g)}.` },
          { it: `${room.locIt} c'è ${m1.indef} ${m1.it}.`, ru: `${room.locRu} есть ${m1.ru}.` },
        ],
        words: [ { it: agreeAdj(car, 'f'), ru: adjRu(car, p.g) }, { it: room.it, ru: room.ru }, { it: m1.it, ru: m1.ru } ],
      };
    },
  },

  // ===== БОЛЬШИЕ ТЕКСТЫ (несколько связных предложений) =====

  // L2: Автопортрет (большой)
  {
    theme: 'Рассказ о себе', icon: ICON_STORY_SELF, lesson: 2, big: true,
    build() {
      const p = pick(STORY_BANK.nomi);
      const naz = pick(STORY_BANK.nazioni);
      const [a1, a2, a3] = pickN(STORY_BANK.caratteri, 3);
      const prof = p.g === 'f' ? 'studentessa' : 'studente';
      const profRu = p.g === 'f' ? 'студентка' : 'студент';
      return {
        lines: [
          { it: `Ciao! Io sono ${p.it}.`, ru: `Привет! Я ${p.ru}.` },
          { it: `Sono ${agreeAdj(naz, p.g)} e sono ${prof}.`, ru: `Я ${adjRu(naz, p.g)}, я ${profRu}.` },
          { it: `Sono una persona ${agreeAdj(a1, 'f')}, ${agreeAdj(a2, 'f')} e molto ${agreeAdj(a3, 'f')}.`,
            ru: `Я очень ${adjRu(a1, p.g)}, ${adjRu(a2, p.g)} и ${adjRu(a3, p.g)}.` },
          { it: `E tu, come sei?`, ru: `А ты какой?` },
        ],
        words: [
          { it: agreeAdj(naz, p.g), ru: adjRu(naz, p.g) },
          { it: prof, ru: profRu },
          { it: agreeAdj(a1, 'f'), ru: adjRu(a1, p.g) },
          { it: agreeAdj(a3, 'f'), ru: adjRu(a3, p.g) },
        ],
      };
    },
  },

  // L3: Экскурсия по квартире (большой)
  {
    theme: 'Моя квартира', icon: ICON_STORY_HOME_COZY, lesson: 3, big: true,
    build() {
      const q1 = pick(STORY_BANK.qualita);
      const [r1, r2, r3] = pickN(STORY_BANK.stanze, 3);
      const [m1, m2, m3, m4] = pickN(STORY_BANK.mobili, 4);
      return {
        lines: [
          { it: `Questa è ${STORY_HOME.poss} ${STORY_HOME.it}. È ${agreeAdj(q1, STORY_HOME.itG)} e accogliente.`,
            ru: `Это мой ${STORY_HOME.ru}. Он ${qRu(q1, STORY_HOME.ruG)} и уютный.` },
          { it: `${r1.locIt} c'è ${m1.indef} ${m1.it}.`, ru: `${r1.locRu} есть ${m1.ru}.` },
          { it: `${r2.locIt} c'è ${m2.indef} ${m2.it} e ${m3.indef} ${m3.it}.`,
            ru: `${r2.locRu} есть ${m2.ru} и ${m3.ru}.` },
          { it: `${r3.locIt} ci sono anche due ${m4.plur}.`, ru: `${r3.locRu} есть ещё ${m4.ruDue}.` },
          { it: `Mi piace molto ${STORY_HOME.poss} ${STORY_HOME.it}!`, ru: `Мне очень нравится мой ${STORY_HOME.ru}!` },
        ],
        words: [
          { it: agreeAdj(q1, STORY_HOME.itG), ru: qRu(q1, STORY_HOME.ruG) },
          { it: m1.it, ru: m1.ru }, { it: m2.it, ru: m2.ru },
          { it: m3.it, ru: m3.ru }, { it: m4.plur, ru: m4.ruPl },
        ],
      };
    },
  },

  // L3: Человек и его дом — расширенный (большой, объединяет урок 2 + 3)
  {
    theme: 'Человек и его дом', icon: ICON_STORY_HOUSE, lesson: 3, big: true,
    build() {
      const p = pick(STORY_BANK.nomi);
      const naz = pick(STORY_BANK.nazioni);
      const [a1, a2] = pickN(STORY_BANK.caratteri, 2);
      const q = pick(STORY_BANK.qualita);
      const room = pick(STORY_BANK.stanze);
      const [m1, m2] = pickN(STORY_BANK.mobili, 2);
      return {
        lines: [
          { it: `${p.it} è ${agreeAdj(naz, p.g)}.`, ru: `${p.ru} — ${adjRu(naz, p.g)}.` },
          { it: `È una persona ${agreeAdj(a1, 'f')} e ${agreeAdj(a2, 'f')}.`,
            ru: `${p.g === 'f' ? 'Она' : 'Он'} ${adjRu(a1, p.g)} и ${adjRu(a2, p.g)}.` },
          { it: `La sua ${STORY_HOME.it} è ${agreeAdj(q, STORY_HOME.itG)}.`,
            ru: `${p.g === 'f' ? 'Её' : 'Его'} ${STORY_HOME.ru} ${qRu(q, STORY_HOME.ruG)}.` },
          { it: `${room.locIt} c'è ${m1.indef} ${m1.it} e ${m2.indef} ${m2.it}.`,
            ru: `${room.locRu} есть ${m1.ru} и ${m2.ru}.` },
          { it: `${p.it} è molto felice qui!`, ru: `${p.ru} здесь очень счастлив${p.g === 'f' ? 'а' : ''}!` },
        ],
        words: [
          { it: agreeAdj(naz, p.g), ru: adjRu(naz, p.g) },
          { it: agreeAdj(a1, 'f'), ru: adjRu(a1, p.g) },
          { it: agreeAdj(q, STORY_HOME.itG), ru: qRu(q, STORY_HOME.ruG) },
          { it: m1.it, ru: m1.ru }, { it: m2.it, ru: m2.ru },
        ],
      };
    },
  },
];

// Максимальный доступный урок (по загруженным урокам)
function maxAvailableLesson() {
  if (!Array.isArray(lessons) || !lessons.length) return 1;
  return Math.max(...lessons.map(l => l.number || 0));
}

let currentStory = null;
let lastStoryTheme = null;

// Грамматический движок знает лексику уроков 1–3 (STORY_BANK). Слова уроков выше
// этого номера движок корректно просклонять не может, поэтому показывает их отдельной
// безопасной строкой-витриной (список в кавычках) — так новые уроки тоже попадают в текст.
const BANK_MAX_LESSON = 3;

// Слова из уроков НОВЕЕ грамматического движка (авто-детект из реально загруженных уроков).
// Отсеиваем служебные слова и артикли, чтобы в витрину попадала только значимая лексика.
function freshLessonWords(afterLesson) {
  return buildVocabPool().filter(w => {
    if ((w.lesson || 0) <= afterLesson) return false;
    if (!w.it || !w.ru || w.it.length > 18 || /\d/.test(w.it)) return false;
    const bare = storyStripArticle(w.it.toLowerCase().trim());
    if (bare.length < 3) return false;
    if (STORY_FUNC_WORDS.has(bare) || STORY_FUNC_WORDS.has(w.it.toLowerCase().trim())) return false;
    return true;
  });
}

// Фабрика добавления выделенных слов (без дублей)
function storyAddWordFactory(words) {
  return (it, ru) => { if (it && ru && !words.some(w => w.it === it)) words.push({ it, ru }); };
}
// Витрина слов из совсем новых уроков (за пределами движка) — авто-подхват новых уроков.
// Добавляется к рассказам от 1-го лица.
function appendFreshWordsLine(lines, addWord) {
  const fresh = freshLessonWords(BANK_MAX_LESSON);
  if (!fresh.length) return;
  const picks = pickN(fresh, Math.min(3, fresh.length));
  lines.push({
    it: `Sto imparando anche parole nuove: ${picks.map(w => `«${w.it}»`).join(', ')}.`,
    ru: `Ещё я учу новые слова: ${picks.map(w => w.ru).join(', ')}.`,
  });
  picks.forEach(w => addWord(w.it, w.ru));
}

// ── Структура 1: автопортрет (1-е лицо) ──
function storyAutoportrait(maxL) {
  const p = pick(STORY_BANK.nomi), g = p.g;
  const lines = [], words = [], addWord = storyAddWordFactory(words);
  const greet = pick(['Ciao', 'Buongiorno']);
  lines.push({ it: `${greet}! Io sono ${p.it}.`, ru: `${greet === 'Ciao' ? 'Привет' : 'Добрый день'}! Я ${p.ru}.` });
  const naz = pick(STORY_BANK.nazioni), nazIt = agreeAdj(naz, g);
  const prof = g === 'f' ? 'studentessa' : 'studente', profRu = g === 'f' ? 'студентка' : 'студент';
  lines.push({ it: `Sono ${nazIt} e sono ${prof}.`, ru: `Я ${adjRu(naz, g)}, я ${profRu}.` });
  addWord(nazIt, adjRu(naz, g)); addWord(prof, profRu);
  if (maxL >= 2) {
    const [a1, a2, a3] = pickN(STORY_BANK.caratteri, 3);
    const adv = pick(['molto', 'davvero', 'sempre']);
    const advRu = { molto: 'очень', davvero: 'по-настоящему', sempre: 'всегда' }[adv];
    lines.push({ it: `Sono una persona ${agreeAdj(a1, 'f')}, ${agreeAdj(a2, 'f')} e ${adv} ${agreeAdj(a3, 'f')}.`,
      ru: `Я ${adjRu(a1, g)}, ${adjRu(a2, g)} и ${advRu} ${adjRu(a3, g)}.` });
    addWord(agreeAdj(a1, 'f'), adjRu(a1, g)); addWord(agreeAdj(a2, 'f'), adjRu(a2, g)); addWord(agreeAdj(a3, 'f'), adjRu(a3, g));
  }
  if (maxL >= 3) {
    const [q1, q2] = pickN(STORY_BANK.qualita, 2), room = pick(STORY_BANK.stanze), [m1, m2] = pickN(STORY_BANK.mobili, 2);
    lines.push({ it: `${cap(STORY_HOME.poss)} ${STORY_HOME.it} è ${agreeAdj(q1, STORY_HOME.itG)} e ${agreeAdj(q2, STORY_HOME.itG)}.`,
      ru: `Мой ${STORY_HOME.ru} ${qRu(q1, STORY_HOME.ruG)} и ${qRu(q2, STORY_HOME.ruG)}.` });
    lines.push({ it: `${room.locIt} c'è ${m1.indef} ${m1.it} e ${m2.indef} ${m2.it}.`,
      ru: `${room.locRu} есть ${m1.ru} и ${m2.ru}.` });
    addWord(agreeAdj(q1, STORY_HOME.itG), qRu(q1, STORY_HOME.ruG)); addWord(m1.it, m1.ru); addWord(m2.it, m2.ru);
  }
  appendFreshWordsLine(lines, addWord);
  lines.push({ it: `Mi piace molto studiare l'italiano!`, ru: `Мне очень нравится учить итальянский!` });
  return { theme: pick(['Обо мне', 'Рассказ о себе']), icon: ICON_STORY_SELF, lines, words };
}

// ── Структура 2: портрет человека (3-е лицо) ──
function storyThirdPerson(maxL) {
  const p = pick(STORY_BANK.nomi), g = p.g;
  const pron = g === 'f' ? 'Она' : 'Он', poss = g === 'f' ? 'Её' : 'Его';
  const lines = [], words = [], addWord = storyAddWordFactory(words);
  const naz = pick(STORY_BANK.nazioni), nazIt = agreeAdj(naz, g);
  lines.push({ it: `${p.it} è ${nazIt}.`, ru: `${p.ru} — ${adjRu(naz, g)}.` });
  addWord(nazIt, adjRu(naz, g));
  if (maxL >= 2) {
    const [a1, a2] = pickN(STORY_BANK.caratteri, 2);
    lines.push({ it: `È una persona ${agreeAdj(a1, 'f')} e molto ${agreeAdj(a2, 'f')}.`,
      ru: `${pron} ${adjRu(a1, g)} и очень ${adjRu(a2, g)}.` });
    addWord(agreeAdj(a1, 'f'), adjRu(a1, g)); addWord(agreeAdj(a2, 'f'), adjRu(a2, g));
  }
  if (maxL >= 3) {
    const q = pick(STORY_BANK.qualita), room = pick(STORY_BANK.stanze), [m1, m2] = pickN(STORY_BANK.mobili, 2);
    lines.push({ it: `La sua ${STORY_HOME.it} è ${agreeAdj(q, STORY_HOME.itG)}.`,
      ru: `${poss} ${STORY_HOME.ru} ${qRu(q, STORY_HOME.ruG)}.` });
    lines.push({ it: `${room.locIt} c'è ${m1.indef} ${m1.it} e ${m2.indef} ${m2.it}.`,
      ru: `${room.locRu} есть ${m1.ru} и ${m2.ru}.` });
    addWord(agreeAdj(q, STORY_HOME.itG), qRu(q, STORY_HOME.ruG)); addWord(m1.it, m1.ru); addWord(m2.it, m2.ru);
  }
  lines.push({ it: `${p.it} è molto felice!`, ru: `${p.ru} очень счастлив${g === 'f' ? 'а' : ''}!` });
  return { theme: pick(['Портрет', 'Человек']), icon: ICON_STORY_PERSON, lines, words };
}

// ── Структура 3: два друга (сравнение) ── (нужен урок 2)
function storyTwoFriends(maxL) {
  const [p1, p2] = pickTwo(STORY_BANK.nomi);
  const lines = [], words = [], addWord = storyAddWordFactory(words);
  const amici = amiciForm(p1.g, p2.g), amiciRu = amici === 'amiche' ? 'подруги' : 'друзья';
  lines.push({ it: `${p1.it} e ${p2.it} sono ${amici}.`, ru: `${p1.ru} и ${p2.ru} — ${amiciRu}.` });
  const [a1, a2] = pickTwo(STORY_BANK.caratteri);
  lines.push({ it: `${p1.it} è ${agreeAdj(a1, p1.g)}, ma ${p2.it} è ${agreeAdj(a2, p2.g)}.`,
    ru: `${p1.ru} ${adjRu(a1, p1.g)}, а ${p2.ru} ${adjRu(a2, p2.g)}.` });
  addWord(agreeAdj(a1, p1.g), adjRu(a1, p1.g)); addWord(agreeAdj(a2, p2.g), adjRu(a2, p2.g));
  const n1 = pick(STORY_BANK.nazioni), n2 = pick(STORY_BANK.nazioni);
  lines.push({ it: `${p1.it} è ${agreeAdj(n1, p1.g)}, ${p2.it} è ${agreeAdj(n2, p2.g)}.`,
    ru: `${p1.ru} ${adjRu(n1, p1.g)}, ${p2.ru} ${adjRu(n2, p2.g)}.` });
  addWord(agreeAdj(n1, p1.g), adjRu(n1, p1.g));
  if (maxL >= 3) {
    const [q1, q2] = pickN(STORY_BANK.qualita, 2);
    lines.push({ it: `La casa di ${p1.it} è ${agreeAdj(q1, 'f')}, la casa di ${p2.it} è ${agreeAdj(q2, 'f')}.`,
      ru: `Дом ${p1.ru} ${qRu(q1, 'm')}, а дом ${p2.ru} ${qRu(q2, 'm')}.` });
    addWord(agreeAdj(q1, 'f'), qRu(q1, 'm'));
  }
  return { theme: pick(['Два друга', 'Друзья']), icon: ICON_STORY_FRIENDS, lines, words };
}

// ── Структура 4: диалог (только essere / c'è) ──
function storyDialogue(maxL) {
  const p = pick(STORY_BANK.nomi), g = p.g;
  const lines = [], words = [], addWord = storyAddWordFactory(words);
  const naz = pick(STORY_BANK.nazioni), nazIt = agreeAdj(naz, g);
  lines.push({ it: `– Ciao! Chi sei?`, ru: `– Привет! Ты кто?` });
  lines.push({ it: `– Sono ${p.it}, sono ${nazIt}.`, ru: `– Я ${p.ru}, я ${adjRu(naz, g)}.` });
  addWord(nazIt, adjRu(naz, g));
  if (maxL >= 2) {
    const [a1, a2] = pickN(STORY_BANK.caratteri, 2);
    lines.push({ it: `– Come sei?`, ru: `– Какой ты?` });
    lines.push({ it: `– Sono ${agreeAdj(a1, g)} e ${agreeAdj(a2, g)}.`, ru: `– Я ${adjRu(a1, g)} и ${adjRu(a2, g)}.` });
    addWord(agreeAdj(a1, g), adjRu(a1, g)); addWord(agreeAdj(a2, g), adjRu(a2, g));
  }
  if (maxL >= 3) {
    const room = pick(STORY_BANK.stanze), m1 = pick(STORY_BANK.mobili), q = pick(STORY_BANK.qualita);
    lines.push({ it: `– Com'è la tua ${STORY_HOME.it}?`, ru: `– Какой у тебя ${STORY_HOME.ru}?` });
    lines.push({ it: `– È ${agreeAdj(q, STORY_HOME.itG)}. ${room.locIt} c'è ${m1.indef} ${m1.it}.`,
      ru: `– ${cap(qRu(q, STORY_HOME.ruG))}. ${room.locRu} есть ${m1.ru}.` });
    addWord(agreeAdj(q, STORY_HOME.itG), qRu(q, STORY_HOME.ruG)); addWord(m1.it, m1.ru);
  }
  return { theme: pick(['Диалог', 'Разговор']), icon: ICON_STORY_GREETING, lines, words };
}

// ── Структура 5: экскурсия по дому ── (нужен урок 3)
function storyHomeTour(maxL) {
  const lines = [], words = [], addWord = storyAddWordFactory(words);
  const [q1, q2] = pickN(STORY_BANK.qualita, 2);
  const [r1, r2, r3] = pickN(STORY_BANK.stanze, 3);
  const [m1, m2, m3, m4] = pickN(STORY_BANK.mobili, 4);
  lines.push({ it: `Questa è ${STORY_HOME.poss} ${STORY_HOME.it}. È ${agreeAdj(q1, STORY_HOME.itG)} e ${agreeAdj(q2, STORY_HOME.itG)}.`,
    ru: `Это мой ${STORY_HOME.ru}. Он ${qRu(q1, STORY_HOME.ruG)} и ${qRu(q2, STORY_HOME.ruG)}.` });
  lines.push({ it: `${r1.locIt} c'è ${m1.indef} ${m1.it} e ${m2.indef} ${m2.it}.`, ru: `${r1.locRu} есть ${m1.ru} и ${m2.ru}.` });
  lines.push({ it: `${r2.locIt} c'è ${m3.indef} ${m3.it}.`, ru: `${r2.locRu} есть ${m3.ru}.` });
  lines.push({ it: `${r3.locIt} ci sono anche due ${m4.plur}.`, ru: `${r3.locRu} есть ещё ${m4.ruDue}.` });
  addWord(agreeAdj(q1, STORY_HOME.itG), qRu(q1, STORY_HOME.ruG)); addWord(m1.it, m1.ru); addWord(m2.it, m2.ru); addWord(m3.it, m3.ru);
  appendFreshWordsLine(lines, addWord);
  lines.push({ it: `Mi piace molto ${STORY_HOME.poss} ${STORY_HOME.it}!`, ru: `Мне очень нравится мой ${STORY_HOME.ru}!` });
  return { theme: pick(['Мой дом', 'Моя квартира', 'Экскурсия по дому']), icon: ICON_STORY_HOUSE, lines, words };
}

// Диспетчер: каждый раз выбираем РАЗНУЮ структуру (не повторяем предыдущую),
// перемешивая лексику всех доступных уроков. Работает без сервера.
let lastStoryStructure = null;
function buildMixedStory() {
  const maxL = maxAvailableLesson();
  const builders = (maxL >= 3)
    ? [storyAutoportrait, storyThirdPerson, storyTwoFriends, storyDialogue, storyHomeTour]
    : (maxL >= 2)
      ? [storyAutoportrait, storyThirdPerson, storyTwoFriends, storyDialogue]
      : [storyAutoportrait];
  let pool = builders.filter(b => b !== lastStoryStructure);
  if (!pool.length) pool = builders;
  const builder = pick(pool);
  lastStoryStructure = builder;
  const built = builder(maxL);
  lastStoryTheme = built.theme;
  return { theme: built.theme, icon: built.icon, lesson: maxL, lines: built.lines, words: built.words.slice(0, 9) };
}

// Точка входа оффлайн-генератора: всегда строим перемешанный связный рассказ
function buildStory() { return buildMixedStory(); }

// Подсвечивает выделенные слова прямо в итальянском тексте (кликабельны → озвучка)
function highlightStoryLine(itText, words) {
  let html = itText;
  // сортируем по длине, чтобы сначала оборачивать длинные фразы
  const sorted = [...words].sort((a, b) => b.it.length - a.it.length);
  sorted.forEach(w => {
    const safe = w.it.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\wàèéìòù])(${safe})(?![\\wàèéìòù])`, 'i');
    html = html.replace(re, (m, pre, hit) =>
      `${pre}<span class="story-word" data-word="${w.it}" title="${w.ru} · нажми, чтобы послушать">${hit}</span>`);
  });
  return html;
}

// Один раз добавляет стили блока историй
function ensureStoryStyles() {
  if (document.getElementById('storyStyles')) return;
  const st = document.createElement('style');
  st.id = 'storyStyles';
  st.textContent = `
    .story-theme {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px;
      margin-bottom: 16px;
    }
    .story-theme-icon {
      flex-shrink: 0; width: 26px; height: 26px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9px;
      background: linear-gradient(150deg, rgba(193,84,58,0.16), rgba(193,84,58,0.06));
      color: var(--terracotta, #c1543a);
    }
    .story-theme-icon svg { width: 15px; height: 15px; }
    .story-theme-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-weight: 700; font-size: 15px;
      color: var(--ink, #2e2a24);
      white-space: nowrap;
    }
    .story-theme-meta {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      flex: 1 1 100%;
      padding-left: 34px; /* выравнивание с названием, под иконкой */
    }
    .story-tag {
      display: inline-flex; align-items: center; gap: 4px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      color: #9a8f80;
      background: rgba(154,143,128,0.1);
      padding: 4px 9px; border-radius: 100px;
    }
    .story-tag-ai {
      color: #8B5CF6;
      background: rgba(139,92,246,0.12);
    }
    .story-tag-ai .ico { width: 10px; height: 10px; }

    /* ── Компактное превью истории в правой колонке (карточка короткая, полный
       текст — в полноэкранном окне). Цитата растёт на всю свободную высоту и
       центрируется — поэтому колонка естественно дотягивается до длины левой,
       не оставляя пустоты и не требуя искусственного растягивания текста. ── */
    .story-preview-body { display: flex; flex-direction: column; }
    .story-preview-quote {
      flex: 1 1 auto; min-height: 110px;
      display: flex; align-items: center; justify-content: center;
      text-align: center;
      position: relative; overflow: hidden;
      background: linear-gradient(165deg, #fffaf3 0%, #fdf3e8 100%);
      border: 1px solid var(--line, #ece2d4);
      border-radius: 16px;
      padding: 30px 22px 26px;
      margin: 0 0 16px;
      box-shadow: 0 8px 24px rgba(35,25,15,.07), inset 0 1px 0 rgba(255,255,255,.5);
      cursor: pointer;
      font: inherit;
      transition: transform .18s ease, box-shadow .18s ease;
    }
    .story-preview-quote:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(35,25,15,.1), inset 0 1px 0 rgba(255,255,255,.5);
    }
    .story-preview-quote:active { transform: translateY(0); }
    .story-preview-quote-mark {
      position: absolute; top: 2px; left: 14px;
      font-family: Georgia, serif; font-size: 64px; line-height: 1;
      color: var(--terracotta, #c1543a); opacity: .14;
      pointer-events: none;
    }
    .story-preview-quote-text {
      position: relative; z-index: 1;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 18px; line-height: 1.5; font-style: italic;
      color: var(--ink, #2e2a24);
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4;
      overflow: hidden;
    }
    .story-preview-stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
    .story-preview-stat {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11.5px; font-weight: 600; color: #9a8f80;
      background: var(--cream, #f7f1e6);
      border: 1px solid var(--line, #ece2d4);
      padding: 5px 11px; border-radius: 100px;
    }
    /* ═══ Полноэкранный ридер истории ═══
       Каркас: шапка + тулбар закреплены сверху, кнопки — снизу, между ними
       прокручивается только область чтения. Всё всегда помещается в окне. */
    .story-reader { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
    .story-reader-head { flex: 0 0 auto; padding: 38px 56px 0 48px; margin-bottom: 16px; }
    .story-reader-head .story-theme { margin-bottom: 8px; }
    .story-reader .story-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 18px; font-style: italic; color: #75695a; margin: 6px 0 0;
    }
    /* Панель инструментов чтения (закреплена) */
    .story-reader-toolbar {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 0 48px 16px; margin: 0;
      border-bottom: 1px solid var(--line, #ece2d4);
    }
    .story-tool-btn {
      display: inline-flex; align-items: center; gap: 8px;
      font: inherit; font-size: 13.5px; font-weight: 600;
      padding: 9px 16px; border-radius: 100px; cursor: pointer;
      border: 1px solid var(--line, #ddd1c0); background: var(--cream, #f7f1e6);
      color: var(--ink, #2e2a24); transition: .15s ease;
    }
    .story-tool-btn:hover { border-color: #c9bfae; transform: translateY(-1px); }
    .story-tool-btn:active { transform: translateY(0); }
    .story-tool-btn-play {
      background: var(--terracotta, #c1543a); color: #fff; border-color: var(--terracotta, #c1543a);
      box-shadow: 0 6px 16px -7px rgba(193,84,58,.6);
    }
    .story-tool-btn-play:hover { background: #ad4631; border-color: #ad4631; }
    .story-tool-btn-play.is-playing { background: #8a3a28; border-color: #8a3a28; }
    .story-play-icon { display: inline-flex; width: 14px; height: 14px; }
    .story-play-icon svg { width: 14px; height: 14px; }
    .story-tool-btn.is-active {
      background: var(--terracotta-soft, #f6e0d8); border-color: rgba(193,84,58,.4); color: var(--terracotta, #c1543a);
    }
    .story-reader-progress {
      margin-left: auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12.5px; color: #9a8f80;
    }
    /* Тело: текст слева, словарь справа — ЕДИНСТВЕННАЯ прокручиваемая область */
    .story-reader-body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto;
      display: flex; gap: 32px; align-items: flex-start;
      padding: 20px 48px; margin: 0;
    }
    .story-reader-main { flex: 1 1 auto; min-width: 0; }
    .story-reader-aside { flex: 0 0 232px; }
    /* Связный текст: единый абзац, предложения идут подряд (это ТЕКСТ, а не список) */
    .story-prose {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 20px; line-height: 1.85; color: var(--ink, #2e2a24);
      letter-spacing: .1px;
    }
    .story-sentence {
      cursor: pointer; border-radius: 5px;
      padding: 1px 2px; margin: 0 -1px;
      transition: background .18s ease, box-shadow .18s ease;
      -webkit-box-decoration-break: clone; box-decoration-break: clone;
    }
    .story-sentence:hover { background: rgba(193,84,58,.07); }
    .story-sentence.is-active { background: rgba(193,84,58,.14); box-shadow: 0 0 0 1px rgba(193,84,58,.12); }
    /* Перевод — отдельным аккуратным блоком под текстом (а не построчно), читается как текст */
    .story-prose-ru {
      margin-top: 18px; padding: 16px 18px;
      background: var(--cream, #f7f1e6); border: 1px solid var(--line, #ece2d4);
      border-left: 3px solid var(--terracotta, #c1543a); border-radius: 12px;
      animation: hwRevealFade .25s ease;
    }
    .story-prose-ru[hidden] { display: none; }
    .story-prose-ru-label {
      display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em;
      color: #9a8f80; margin-bottom: 7px;
    }
    .story-prose-ru p { margin: 0; font-size: 15px; line-height: 1.6; color: #6e6052; }
    @keyframes hwRevealFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .story-word.flash { background: var(--terracotta, #c1543a) !important; color: #fff !important; border-bottom-color: transparent !important; }
    /* Разбор грамматики */
    .story-tool-icon { display: inline-flex; width: 15px; height: 15px; }
    .story-tool-icon svg { width: 15px; height: 15px; }
    .story-breakdown {
      margin-top: 18px; padding: 16px 18px;
      background: linear-gradient(180deg, #fbf7f0 0%, #f9f2e8 100%);
      border: 1px solid var(--line, #ece2d4); border-left: 3px solid #7a8a4e;
      border-radius: 12px; animation: hwRevealFade .25s ease;
    }
    .story-breakdown[hidden] { display: none; }
    .story-breakdown > .story-prose-ru-label { color: #6f7d44; }
    .story-bd-block { padding: 12px 0; border-bottom: 1px dashed var(--line, #ece2d4); }
    .story-bd-block:last-child { border-bottom: none; padding-bottom: 2px; }
    .story-bd-block:first-of-type { padding-top: 4px; }
    .story-bd-title {
      margin: 0 0 7px; font-family: Georgia, 'Times New Roman', serif;
      font-size: 15.5px; font-weight: 700; color: var(--ink, #2e2a24);
    }
    .story-bd-notes { margin: 0; padding-left: 18px; list-style: none; }
    .story-bd-notes li {
      position: relative; margin: 0 0 6px; font-size: 14px; line-height: 1.5; color: #5f5446;
    }
    .story-bd-notes li::before {
      content: ''; position: absolute; left: -14px; top: 8px;
      width: 5px; height: 5px; border-radius: 50%; background: #9fae6b;
    }
    .story-bd-notes li b { color: var(--terracotta, #c1543a); font-weight: 700; }
    .story-bd-loading {
      display: flex; align-items: center; gap: 10px;
      font-size: 14px; color: #8a7d6e; padding: 6px 0;
    }
    /* Словарь */
    .story-aside-title {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em;
      color: #9a8f80; margin: 0 0 12px; padding: 0 2px;
    }
    .story-vocab-list { display: flex; flex-direction: column; gap: 8px; }
    .story-vocab-item {
      display: flex; align-items: center; gap: 10px; text-align: left;
      padding: 11px 13px; border-radius: 12px; cursor: pointer; font: inherit;
      background: var(--cream, #f7f1e6); border: 1px solid var(--line, #ece2d4);
      transition: .15s ease;
    }
    .story-vocab-item:hover { border-color: rgba(193,84,58,.35); background: #fbf4ea; transform: translateX(2px); }
    .story-vocab-item.playing { background: var(--terracotta, #c1543a); border-color: var(--terracotta, #c1543a); }
    .story-vocab-it { font-weight: 700; color: var(--ink, #2e2a24); font-size: 14.5px; }
    .story-vocab-ru { flex: 1 1 auto; font-size: 12.5px; color: #9a8f80; }
    .story-vocab-item .cs { width: 16px; height: 16px; color: var(--terracotta, #c1543a); opacity: .7; flex-shrink: 0; }
    .story-vocab-item.playing .story-vocab-it,
    .story-vocab-item.playing .story-vocab-ru { color: #fff; }
    .story-vocab-item.playing .cs { color: #fff; opacity: 1; }
    .story-vocab-empty { font-size: 13px; color: #9a8f80; margin: 0; }
    /* Подвал */
    .story-reader-foot {
      flex: 0 0 auto;
      display: flex; gap: 10px; flex-wrap: wrap;
      margin: 0; padding: 16px 48px 20px;
      border-top: 1px solid var(--line, #ece2d4);
      background: var(--paper);
    }
    @media (max-width: 720px) {
      .story-reader-head { padding: 24px 56px 0 22px; }
      .story-reader-toolbar { padding: 0 22px 14px; }
      .story-reader-body { flex-direction: column; gap: 20px; padding: 16px 22px; }
      .story-reader-aside { flex: 1 1 auto; width: 100%; }
      .story-reader-progress { margin-left: 0; width: 100%; }
      .story-reader-foot { padding: 14px 22px 18px; }
    }
    .story-text {
      position: relative;
      background: linear-gradient(180deg, #fffaf3 0%, #fdf4ea 100%);
      border: 1px solid var(--line, #ece2d4);
      border-radius: 14px;
      padding: 22px 22px 20px;
      margin: 0 0 14px;
      box-shadow: 0 8px 24px rgba(35,25,15,.07);
    }
    .story-text::before {
      content: '\\201C'; position: absolute; top: -6px; left: 12px;
      font-family: Georgia, serif; font-size: 56px; line-height: 1;
      color: var(--terracotta, #c1543a); opacity: .16;
    }
    .story-line { margin: 0 0 8px; }
    .story-line:last-child { margin-bottom: 0; }
    .story-it {
      font-size: 19px; line-height: 1.5; color: var(--ink, #2e2a24);
      font-family: Georgia, 'Times New Roman', serif;
    }
    .story-word {
      color: var(--terracotta, #c1543a); font-weight: 600;
      border-bottom: 1.5px dotted rgba(193,84,58,.5);
      cursor: pointer; transition: background .15s, color .15s;
      border-radius: 3px; padding: 0 1px;
    }
    .story-word:hover { background: var(--terracotta, #c1543a); color: #fff; border-bottom-color: transparent; }
    .story-word.playing { background: var(--terracotta, #c1543a); color: #fff; }
    .story-ru {
      font-size: 13.5px; line-height: 1.45; color: #8a7d6e;
      margin-top: 3px; display: none;
    }
    .story-text.show-ru .story-ru { display: block; }
    .story-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .story-btn {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 600; padding: 9px 15px;
      border-radius: 9px; cursor: pointer; border: 1px solid transparent;
      transition: transform .12s, background .15s, border-color .15s, box-shadow .15s;
      font-family: inherit;
    }
    .story-btn:active { transform: translateY(1px); }
    .story-btn-primary {
      background: var(--terracotta, #c1543a); color: #fff;
      box-shadow: 0 4px 12px rgba(193,84,58,.28);
    }
    .story-btn-primary:hover { background: #ad4631; }
    .story-btn-ghost {
      background: transparent; color: #75695a; border-color: var(--line, #ddd1c0);
    }
    .story-btn-ghost:hover { border-color: #c9bfae; background: #fbf6ee; }
    .story-words-row { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 16px; }
    .story-chip {
      display: inline-flex; align-items: center; gap: 7px;
      background: rgba(193,84,58,.07); border: 1px solid rgba(193,84,58,.14);
      border-radius: 8px; padding: 6px 11px; cursor: pointer;
      transition: background .15s, transform .12s;
    }
    .story-chip:hover { background: rgba(193,84,58,.13); transform: translateY(-1px); }
    .story-chip:active { transform: translateY(0); }
    .story-chip .cw { font-weight: 600; color: var(--ink, #2e2a24); font-size: 13.5px; }
    .story-chip .cr { font-size: 11.5px; color: #9a8f80; }
    .story-chip .cs {
      width: 15px; height: 15px; color: var(--terracotta, #c1543a);
      opacity: .7; flex-shrink: 0;
    }
    .story-chip .cr:empty { display: none; }
    .story-loading {
      display: flex; align-items: center; gap: 12px;
      padding: 28px 22px; margin: 0 0 14px;
      background: linear-gradient(180deg, #fffaf3 0%, #fdf4ea 100%);
      border: 1px solid var(--line, #ece2d4); border-radius: 14px;
      color: #8a7d6e; font-size: 14px;
    }
    .story-spinner {
      width: 22px; height: 22px; flex-shrink: 0;
      border: 2.5px solid rgba(193,84,58,.22);
      border-top-color: var(--terracotta, #c1543a);
      border-radius: 50%; animation: story-spin .8s linear infinite;
    }
    @keyframes story-spin { to { transform: rotate(360deg); } }
    .story-btn[disabled] { opacity: .55; cursor: default; }
    .story-title {
      font-family: Georgia, serif; font-size: 13px; font-style: italic;
      color: #9a8f80; margin: 0 0 10px;
    }
    /* Адаптив компактного превью историй (масштаб под телефон) */
    @media (max-width: 600px) {
      .story-theme-name { font-size: 15px; }
      .story-preview-quote { padding: 22px 16px 20px; }
      .story-preview-quote-text { font-size: 16px; -webkit-line-clamp: 3; }
      .story-btn { font-size: 12px; padding: 9px 14px; }
      .story-preview-stat { font-size: 11px; }
    }
    @media (max-width: 380px) {
      .story-preview-quote-text { font-size: 15px; }
    }
  `;
  document.head.appendChild(st);
}

const STORY_SPEAKER_SVG = `<svg class="cs" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/>
  <path d="M15.5 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

function sayStory(word, el) {
  // одиночное слово/чип — останавливаем последовательное чтение, если оно идёт
  stopStoryPlayback();
  if (el) el.classList.add('playing');
  const p = (typeof window.speakIt === 'function') ? window.speakIt(word) : Promise.resolve();
  const clear = () => { if (el) el.classList.remove('playing'); };
  if (p && typeof p.then === 'function') p.then(clear); else setTimeout(clear, 650);
}

// --- Авто-анализ пройденных уроков: собираем изученную лексику (слово → перевод) ---
const STORY_FUNC_WORDS = new Set([
  'il','lo','la',"l'",'i','gli','le','un','uno','una',"un'",'e','ed','ma','o','anche','molto',
  'non','di','del','della','a','al','alla','da','in','nel','nella','con','su','sul','sulla','per','tra','fra',
  'io','tu','lui','lei','noi','voi','loro','mi','ti','si','ci','vi','che','chi','come','dove','qui','qua','là',
  'è','sono','sei','siamo','siete','ho','hai','ha','abbiamo','avete','hanno',"c'è",'ci sono','sì','no','più','meno',
]);
function storyStripArticle(s) {
  return s.replace(/^(il |lo |la |l'|i |gli |le |un |uno |una |un'|c'è |ci sono )/i, '').trim();
}
// Возвращает {map: {лемма: перевод}, list: [леммы в порядке появления]}
function collectLessonWords() {
  const map = {}; const list = [];
  const add = (w, ru) => {
    const k = w.toLowerCase().trim();
    if (!k) return;
    if (!(k in map)) { map[k] = ru || ''; list.push(k); }
    const st = storyStripArticle(k);
    if (st && st !== k && !(st in map)) { map[st] = ru || ''; list.push(st); }
  };
  (Array.isArray(lessons) ? lessons : []).forEach(les => {
    // читаем и тело урока, и ДЗ — так в общий словарь попадает вся лексика урока
    [les.sectionsHTML, les.homeworkHTML].forEach(html => {
      if (!html) return;
      const div = document.createElement('div');
      div.innerHTML = html;
      div.querySelectorAll('td[data-word], [data-word]').forEach(el => {
        const w = (el.getAttribute('data-word') || '').trim();
        if (!w) return;
        let ru = '';
        const nx = el.nextElementSibling;
        if (el.tagName === 'TD' && nx && !nx.hasAttribute('data-word')) ru = nx.textContent.trim();
        ru = ru.replace(/\s*\(.*?\)\s*/g, '').trim();
        add(w, ru);
      });
    });
  });
  return { map, list };
}
// Чистый список значимых слов для промпта (без артиклей и служебных, без дублей).
// Порядок ПЕРЕМЕШИВАЕТСЯ: иначе при срезе до 80 слов доминировали бы ранние уроки,
// а нам нужно, чтобы ИИ мешал лексику из РАЗНЫХ уроков (в т.ч. недавно добавленных).
function cleanAllowedWords(list) {
  const out = []; const seen = new Set();
  list.forEach(w => {
    let s = storyStripArticle(w.toLowerCase().trim());
    if (!s || s.length < 2) return;
    if (STORY_FUNC_WORDS.has(s)) return;
    if (/\d/.test(s)) return;
    if (seen.has(s)) return;
    seen.add(s); out.push(s);
  });
  // перемешивание (Fisher–Yates) для равномерного представительства всех уроков
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, 80);
}
// Грамматические темы по доступным урокам — что именно закрепляем
function storyGrammarTopics(maxL) {
  const t = [];
  if (maxL >= 1) t.push('il verbo essere', 'articoli il/la/un/una', 'maschile e femminile');
  if (maxL >= 2) t.push("accordo dell'aggettivo (genere e numero)", 'nazionalità', 'professioni', 'aggettivi di carattere');
  if (maxL >= 3) t.push("c'è / ci sono", 'preposizioni di luogo', 'la casa, le stanze e i mobili');
  if (maxL > 3) t.push('il lessico delle lezioni recenti'); // новые уроки тоже учитываются
  return t.join(', ');
}

// Запрос истории у ИИ через локальный сервер (с таймаутом)
async function fetchAIStory(allowed, topics, ruMap) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const url = `http://localhost:3002/api/story?words=${encodeURIComponent(allowed.join(','))}`
      + `&topics=${encodeURIComponent(topics)}&count=6&n=${Date.now()}`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('server ' + r.status);
    const d = await r.json();
    if (!d.story || !Array.isArray(d.story.sentences) || !d.story.sentences.length) throw new Error('empty story');
    const lines = d.story.sentences.map(s => ({ it: s.it, ru: s.ru || '' }));
    const words = (d.story.focus || []).map(w => ({ it: w, ru: ruMap[String(w).toLowerCase()] || '' }));
    return {
      theme: d.story.theme || 'История', icon: d.story.icon || ICON_STORY_BOOK_OPEN, title: d.story.title || '',
      lines, words, source: 'ai', provider: d.provider || 'ai',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Рендер состояния загрузки
function renderStoryLoading(section) {
  section.innerHTML = `
    <div class="vocab-card-head">
      <span class="vocab-card-icon"><span class="ico">${ICON_STORY_BOOK_OPEN}</span></span>
      <div class="vocab-card-head-text">
        <span class="vocab-card-title">Истории</span>
        <span class="vocab-card-status"><span class="vocab-status-dot"></span>ИИ пишет историю…</span>
      </div>
    </div>
    <div class="vocab-card-body">
      <div class="story-loading"><span class="story-spinner"></span>ИИ составляет текст из пройденной лексики…</div>
    </div>
  `;
}

// Общая часть разметки «шапка темы» — переиспользуется и в компактном превью, и в полноэкранном окне
function renderStoryThemeHTML(s) {
  const isAI = s.source === 'ai';
  const lessonTag = (!isAI && s.lesson) ? `<span class="story-tag">Урок ${s.lesson}</span>` : '';
  const srcTag = isAI
    ? `<span class="story-tag story-tag-ai">${ICON_SPARKLE_HTML}ИИ</span>`
    : `<span class="story-tag">грамматика</span>`;
  return `
    <div class="story-theme">
      <span class="story-theme-icon ico">${s.icon || ICON_STORY_BOOK_OPEN}</span>
      <span class="story-theme-name">${s.theme || 'История'}</span>
      <span class="story-theme-meta">${lessonTag}${srcTag}</span>
    </div>
  `;
}

// Компактное превью в правой колонке: тема + первая строка как «обложка», без полного
// текста — он открывается в полноэкранном окне (openStoryModal). Так карточка остаётся
// короткой и опрятной независимо от длины самой истории.
function renderStoryObject(s, section) {
  currentStory = s;
  const isAI = s.source === 'ai';
  const statusText = isAI ? 'Сгенерировано ИИ из твоих уроков' : 'Из твоих уроков · правильная грамматика';
  const previewText = s.lines?.[0]?.it || '';

  section.innerHTML = `
    <div class="vocab-card-head">
      <span class="vocab-card-icon"><span class="ico">${ICON_STORY_BOOK_OPEN}</span></span>
      <div class="vocab-card-head-text">
        <span class="vocab-card-title">Истории</span>
        <span class="vocab-card-status"><span class="vocab-status-dot"></span>${statusText}</span>
      </div>
    </div>
    <div class="vocab-card-body story-preview-body">
      ${renderStoryThemeHTML(s)}
      <button type="button" class="story-preview-quote" id="storyPreviewQuote">
        <span class="story-preview-quote-mark">&ldquo;</span>
        <span class="story-preview-quote-text">${previewText}</span>
        <span class="story-preview-fade"></span>
      </button>
      <div class="story-preview-stats">
        <span class="story-preview-stat">${s.lines.length} ${s.lines.length === 1 ? 'предложение' : 'предложения'}</span>
        <span class="story-preview-stat">${s.words.length} ${s.words.length === 1 ? 'слово' : 'слов'} для разбора</span>
      </div>
      <div class="story-controls">
        <button type="button" class="story-btn story-btn-primary" id="storyReadBtn">Читать историю ${ICON_ARROW_RIGHT_HTML}</button>
        <button type="button" class="story-btn story-btn-ghost" id="storyNewBtn">${ICON_SPARKLE_HTML} Новая</button>
      </div>
    </div>
  `;

  const openBtn = () => openStoryModal();
  section.querySelector('#storyPreviewQuote').addEventListener('click', openBtn);
  section.querySelector('#storyReadBtn').addEventListener('click', openBtn);
  section.querySelector('#storyNewBtn').addEventListener('click', () => loadStory(true));
}

// Иконки управления чтением
const ICON_PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7 5.2L19 12L7 18.8V5.2Z"/></svg>';
const ICON_STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/></svg>';
// Иконка «разбор грамматики» (лупа над строками)
const ICON_GRAMMAR_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h10M4 10h7M4 14h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="15.5" cy="15.5" r="3.5" stroke="currentColor" stroke-width="1.7"/><path d="M18.2 18.2L21 21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

// Русская плюрализация (1 слово / 2 слова / 5 слов)
function storyPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// Полная разметка истории — премиальный ридер: панель чтения слева, словарь справа,
// последовательное озвучивание с подсветкой, перевод по переключателю.
function renderStoryFullHTML(s) {
  // Связный текст: предложения идут подряд внутри одного абзаца (как настоящая проза),
  // а не отдельными карточками. Каждое предложение — кликабельный span (озвучка + подсветка).
  const proseHTML = s.lines.map((ln, i) =>
    `<span class="story-sentence" data-idx="${i}">${highlightStoryLine(ln.it, s.words)}</span>`
  ).join(' ');

  const ruText = s.lines.map(l => l.ru).filter(Boolean).join(' ');

  const vocabHTML = s.words.length
    ? s.words.map(w =>
        `<button type="button" class="story-vocab-item" data-word="${w.it}">
           <span class="story-vocab-it">${w.it}</span>
           <span class="story-vocab-ru">${w.ru || ''}</span>
           ${STORY_SPEAKER_SVG}
         </button>`).join('')
    : '<p class="story-vocab-empty">В этой истории нет выделенных слов.</p>';

  const titleHTML = s.title ? `<p class="story-title">«${s.title}»</p>` : '';
  const nSent = s.lines.length, nWords = s.words.length;
  const progress = `${nSent} ${storyPlural(nSent, 'предложение', 'предложения', 'предложений')} · ${nWords} ${storyPlural(nWords, 'слово', 'слова', 'слов')}`;

  return `
    <div class="story-reader">
      <header class="story-reader-head">
        ${renderStoryThemeHTML(s)}
        ${titleHTML}
      </header>

      <div class="story-reader-toolbar">
        <button type="button" class="story-tool-btn story-tool-btn-play" id="storyPlayAllBtn">
          <span class="story-play-icon">${ICON_PLAY_SVG}</span>
          <span class="story-play-label">Слушать историю</span>
        </button>
        <button type="button" class="story-tool-btn" id="storyTransBtnFull">
          <span class="story-tool-label">Перевод</span>
        </button>
        <button type="button" class="story-tool-btn" id="storyExplainBtn">
          <span class="story-tool-icon">${ICON_GRAMMAR_SVG}</span>
          <span class="story-tool-label">Разбор</span>
        </button>
        <span class="story-reader-progress">${progress}</span>
      </div>

      <div class="story-reader-body">
        <div class="story-reader-main">
          <p class="story-prose" id="storyTextFull">${proseHTML}</p>
          <div class="story-prose-ru" id="storyProseRu" hidden>
            <span class="story-prose-ru-label">Перевод</span>
            <p>${ruText}</p>
          </div>
          <div class="story-breakdown" id="storyBreakdown" hidden></div>
        </div>
        <aside class="story-reader-aside">
          <p class="story-aside-title">Слова истории</p>
          <div class="story-vocab-list">${vocabHTML}</div>
        </aside>
      </div>

      <footer class="story-reader-foot">
        <button type="button" class="story-btn story-btn-primary" id="storyNewBtnFull">${ICON_SPARKLE_HTML} Новая история</button>
        <button type="button" class="story-btn story-btn-ghost" id="storyCloseFootBtn">Закрыть</button>
      </footer>
    </div>
  `;
}

// ── РАЗБОР ГРАММАТИКИ (кнопка «Разбор») ───────────────────────────────────
// Запрос разбора у ИИ (низкая температура на сервере → точность)
async function fetchAIBreakdown(story) {
  const text = story.lines.map(l => l.it).join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const url = `http://localhost:3002/api/explain?text=${encodeURIComponent(text)}&n=${Date.now()}`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('server ' + r.status);
    const d = await r.json();
    if (!Array.isArray(d.breakdown) || !d.breakdown.length) throw new Error('empty breakdown');
    return { blocks: d.breakdown, source: 'ai' };
  } finally {
    clearTimeout(timer);
  }
}

// Оффлайн-разбор: определяем грамматические темы ПО ТЕКСТУ (по словам-якорям:
// артикли, essere, c'è, предлоги) и объясняем правилами. Работает без сервера.
function buildOfflineBreakdown(story) {
  const text = story.lines.map(l => l.it).join(' ');
  const blocks = [];
  const firstMatch = (re) => { const m = text.match(new RegExp(re, 'i')); return m ? m[0].trim() : ''; };

  // Глагол essere
  const essere = [];
  if (/\bsono\b/i.test(text)) essere.push({ term: 'sono', text: 'форма «быть» для Я и для ОНИ (io sono — я; loro sono — они)' });
  if (/\bsei\b/i.test(text)) essere.push({ term: 'sei', text: 'форма «быть» для ТЫ' });
  if (/(^|\s)[èÈ](\s|$)/.test(text)) essere.push({ term: 'è', text: 'форма «быть» для ОН/ОНА/ЭТО. Пишется с акцентом è — это глагол, а не союз «и» (e)' });
  if (/\bsiamo\b/i.test(text)) essere.push({ term: 'siamo', text: 'форма «быть» для МЫ' });
  if (essere.length) blocks.push({ title: 'Глагол essere (быть)', notes: essere });

  // c'è / ci sono
  const ce = [];
  if (/c'è/i.test(text)) { const ex = firstMatch("c'è\\s+\\S+\\s+\\S+"); ce.push({ term: "c'è", text: 'есть / находится (ОДИН предмет, ед. число)' + (ex ? '. Пример: «' + ex + '»' : '') }); }
  if (/ci sono/i.test(text)) ce.push({ term: 'ci sono', text: 'есть / находятся (НЕСКОЛЬКО предметов, мн. число)' });
  if (ce.length) blocks.push({ title: "Конструкция c'è / ci sono", notes: ce });

  // Артикли
  const art = [];
  if (/\b(un|uno|una)\s/i.test(text)) { const ex = firstMatch('\\b(un|uno|una)\\s+\\S+'); art.push({ term: 'un / uno / una', text: 'неопределённый артикль «один/одна»: un (м.р.), una (ж.р.), uno (м.р. перед s+согл., z)' + (ex ? '. Пример: «' + ex + '»' : '') }); }
  if (/\b(il|lo|la|i|gli|le)\s/i.test(text) || /\bl'/i.test(text)) art.push({ term: "il / la / l' / i / le", text: "определённый артикль (этот, конкретный): il (м.р.), la (ж.р.), l' (перед гласной), i/gli/le (мн. число)" });
  if (art.length) blocks.push({ title: 'Артикли', notes: art });

  // Согласование прилагательных (общее правило — всегда полезно)
  blocks.push({ title: 'Согласование прилагательных', notes: [
    { term: '-o / -a', text: 'окончание зависит от рода существительного: -o (муж.р.), -a (жен.р.). Напр. italiano (он) → italiana (она)' },
    { term: '-e', text: 'прилагательные на -e (gentile, grande) одинаковы для муж. и жен. рода' },
    { term: 'мн. число', text: 'во множественном: -i (муж.р.), -e (жен.р.)' },
  ]});

  // Предлоги места
  const prepEx = firstMatch('\\b(in|nel|nella|sul|sulla|su)\\s+\\S+');
  if (prepEx) blocks.push({ title: 'Предлоги места', notes: [
    { term: 'in / nel / sul', text: 'в / на: «In cucina» — на кухне, «sul balcone» — на балконе, «nel corridoio» — в коридоре. Пример: «' + prepEx + '»' },
  ]});

  // Притяжательные
  if (/\b(la mia|il mio|la sua|il suo|i miei|le mie)\b/i.test(text)) blocks.push({ title: 'Притяжательные (мой / его / её)', notes: [
    { term: 'la mia / il mio', text: 'моя / мой — с артиклем и по роду: la mia casa (ж.р.), il mio letto (м.р.)' },
    { term: 'la sua / il suo', text: 'его/её — выбирается по роду ПРЕДМЕТА, а не владельца' },
  ]});

  // Множественное число
  if (/\bdue\b/i.test(text)) blocks.push({ title: 'Множественное число', notes: [
    { term: 'due + …i / …e', text: 'после «due» (два) — множественное число: letto → letti, sedia → sedie' },
  ]});

  return { blocks, source: 'offline' };
}

function renderBreakdownHTML(blocks, source) {
  const label = source === 'ai' ? 'Разбор грамматики · ИИ' : 'Разбор грамматики';
  const blocksHTML = blocks.map(b => `
    <div class="story-bd-block">
      <p class="story-bd-title">${b.title}</p>
      <ul class="story-bd-notes">
        ${b.notes.map(n => `<li>${n.term ? `<b>${n.term}</b> — ` : ''}${n.text}</li>`).join('')}
      </ul>
    </div>`).join('');
  return `<span class="story-prose-ru-label">${label}</span>${blocksHTML}`;
}

// Кнопка «Разбор»: переключает панель; при первом открытии грузит разбор
// (ИИ → оффлайн-фолбэк) и кэширует на объекте истории.
async function toggleBreakdown(container) {
  const box = container.querySelector('#storyBreakdown');
  const btn = container.querySelector('#storyExplainBtn');
  if (!box || !btn) return;
  const setLabel = (t) => { const el = btn.querySelector('.story-tool-label'); if (el) el.textContent = t; };

  if (!box.hasAttribute('hidden')) {          // уже открыт → скрыть
    box.setAttribute('hidden', '');
    btn.classList.remove('is-active');
    setLabel('Разбор');
    return;
  }
  box.removeAttribute('hidden');
  btn.classList.add('is-active');
  setLabel('Скрыть разбор');

  if (currentStory && currentStory._breakdown) {  // уже загружено для этой истории
    box.innerHTML = renderBreakdownHTML(currentStory._breakdown.blocks, currentStory._breakdown.source);
    return;
  }
  box.innerHTML = `<div class="story-bd-loading"><span class="story-spinner"></span>ИИ разбирает грамматику…</div>`;
  const target = currentStory;
  let result = null;
  try { result = await fetchAIBreakdown(target); }
  catch (e) { result = null; }
  if (!result || !result.blocks || !result.blocks.length) result = buildOfflineBreakdown(target);
  if (target) target._breakdown = result;
  // окно могло смениться/закрыться, пока шла загрузка — проверяем актуальность
  const liveBox = document.querySelector('#storyBreakdown');
  if (liveBox && !liveBox.hasAttribute('hidden') && currentStory === target) {
    liveBox.innerHTML = renderBreakdownHTML(result.blocks, result.source);
  }
}

// ── Движок последовательного чтения истории (с подсветкой предложений) ──
let storyPlayToken = 0;   // увеличивается на каждой остановке/новом запуске → инвалидирует старый цикл
let storyPlaying = false;

function storyModalEl() { return document.getElementById('storyModalContent'); }

function setPlayAllBtn(playing) {
  const c = storyModalEl(); if (!c) return;
  const btn = c.querySelector('#storyPlayAllBtn'); if (!btn) return;
  btn.classList.toggle('is-playing', playing);
  btn.querySelector('.story-play-icon').innerHTML = playing ? ICON_STOP_SVG : ICON_PLAY_SVG;
  btn.querySelector('.story-play-label').textContent = playing ? 'Остановить' : 'Слушать историю';
}
function highlightSentence(idx) {
  const c = storyModalEl(); if (!c) return;
  c.querySelectorAll('.story-sentence').forEach(el =>
    el.classList.toggle('is-active', Number(el.dataset.idx) === idx));
}
function clearSentenceHighlight() {
  const c = storyModalEl(); if (!c) return;
  c.querySelectorAll('.story-sentence.is-active').forEach(el => el.classList.remove('is-active'));
}
function stopStoryPlayback() {
  storyPlayToken++;
  storyPlaying = false;
  if (window.stopSpeaking) window.stopSpeaking();
  clearSentenceHighlight();
  setPlayAllBtn(false);
}
async function playWholeStory() {
  if (storyPlaying) { stopStoryPlayback(); return; } // повторное нажатие = «Остановить»
  if (!currentStory) return;
  stopStoryPlayback();
  const token = ++storyPlayToken;
  storyPlaying = true;
  setPlayAllBtn(true);
  const lines = currentStory.lines;
  for (let i = 0; i < lines.length; i++) {
    if (token !== storyPlayToken) return;
    highlightSentence(i);
    const el = storyModalEl()?.querySelector(`.story-sentence[data-idx="${i}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    await (window.speakIt ? window.speakIt(lines[i].it) : Promise.resolve());
    if (token !== storyPlayToken) return;
    await new Promise(r => setTimeout(r, 180)); // короткая пауза между предложениями
  }
  if (token === storyPlayToken) { storyPlaying = false; clearSentenceHighlight(); setPlayAllBtn(false); }
}
async function playOneSentence(idx) {
  if (!currentStory) return;
  stopStoryPlayback();
  const token = ++storyPlayToken;
  highlightSentence(idx);
  await (window.speakIt ? window.speakIt(currentStory.lines[idx].it) : Promise.resolve());
  if (token === storyPlayToken) clearSentenceHighlight();
}
// Озвучка слова из словаря + кратковременная подсветка его вхождений в тексте
function sayVocab(word, el) {
  stopStoryPlayback();
  if (el) el.classList.add('playing');
  const c = storyModalEl();
  const matches = c ? [...c.querySelectorAll('.story-word')].filter(m => m.dataset.word === word) : [];
  matches.forEach(m => m.classList.add('flash'));
  const p = window.speakIt ? window.speakIt(word) : Promise.resolve();
  p.then(() => { if (el) el.classList.remove('playing'); matches.forEach(m => m.classList.remove('flash')); });
}

function bindStoryFullHandlers(container) {
  // слово → озвучка слова (не даём всплыть до клика по предложению)
  container.querySelectorAll('.story-word').forEach(el =>
    el.addEventListener('click', (e) => { e.stopPropagation(); sayStory(el.dataset.word, el); }));
  // клик по предложению → озвучка этого предложения с подсветкой
  container.querySelectorAll('.story-sentence').forEach(span =>
    span.addEventListener('click', () => playOneSentence(Number(span.dataset.idx))));
  container.querySelectorAll('.story-vocab-item').forEach(el =>
    el.addEventListener('click', () => sayVocab(el.dataset.word, el)));
  const playAll = container.querySelector('#storyPlayAllBtn');
  if (playAll) playAll.addEventListener('click', playWholeStory);
  const transBtn = container.querySelector('#storyTransBtnFull');
  if (transBtn) transBtn.addEventListener('click', () => {
    const ru = container.querySelector('#storyProseRu');
    const on = ru.hasAttribute('hidden');
    if (on) ru.removeAttribute('hidden'); else ru.setAttribute('hidden', '');
    transBtn.classList.toggle('is-active', on);
    transBtn.querySelector('.story-tool-label').textContent = on ? 'Скрыть перевод' : 'Перевод';
  });
  const explainBtn = container.querySelector('#storyExplainBtn');
  if (explainBtn) explainBtn.addEventListener('click', () => toggleBreakdown(container));
  container.querySelector('#storyNewBtnFull').addEventListener('click', () => loadStory(true));
  const closeFoot = container.querySelector('#storyCloseFootBtn');
  if (closeFoot) closeFoot.addEventListener('click', closeStoryModal);
}

// Открывает историю на весь экран. currentStory всегда заполнен к этому моменту —
// кнопка, вызывающая openStoryModal, существует только после первого рендера превью.
function openStoryModal() {
  if (!currentStory) return;
  const modal = document.getElementById('storyModal');
  const content = document.getElementById('storyModalContent');
  stopStoryPlayback();
  content.innerHTML = renderStoryFullHTML(currentStory);
  bindStoryFullHandlers(content);
  modal.classList.add('open');
  content.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  document.getElementById('storyModalCloseBtn').onclick = closeStoryModal;
  modal.onclick = (e) => { if (e.target === modal) closeStoryModal(); }; // клик по фону закрывает
  const panel = modal.querySelector('.story-modal-panel');
  if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus({ preventScroll: true }); }
}

function closeStoryModal() {
  stopStoryPlayback();
  document.getElementById('storyModal').classList.remove('open');
  if (!document.getElementById('hwModal').classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

// Esc закрывает полноэкранное окно истории (регистрируем один раз)
if (!window.__storyEscBound) {
  window.__storyEscBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('storyModal')?.classList.contains('open')) {
      closeStoryModal();
    }
  });
}

// Если полноэкранное окно открыто в момент, когда пришла новая история (например,
// пользователь нажал «Новая история» прямо в нём) — обновляем содержимое на лету.
function refreshStoryModalIfOpen() {
  const modal = document.getElementById('storyModal');
  if (!modal || !modal.classList.contains('open') || !currentStory) return;
  stopStoryPlayback();
  const content = document.getElementById('storyModalContent');
  content.innerHTML = renderStoryFullHTML(currentStory);
  bindStoryFullHandlers(content);
  content.scrollTop = 0;
}

// Оффлайн-история через грамматический движок (всегда корректна) → объект для рендера
function buildOfflineStory() {
  const off = buildStory();
  return { theme: off.theme, icon: off.icon, lesson: off.lesson, lines: off.lines, words: off.words, source: 'offline' };
}

const STORY_CACHE_KEY = 'story_last';
let storyBusy = false;

// Оркестратор: forceNew=true → пробуем ИИ (со спиннером), иначе показываем кэш/оффлайн мгновенно
async function loadStory(forceNew) {
  const section = document.querySelector('.vocab-section-idea2');
  if (!section) return;
  ensureStoryStyles();

  if (!forceNew) {
    // Быстрый старт: показать кэш, иначе мгновенно оффлайн-историю (без ожидания ИИ)
    const cached = storageGet(STORY_CACHE_KEY);
    if (cached && Array.isArray(cached.lines) && cached.lines.length) {
      renderStoryObject(cached, section);
    } else {
      const off = buildOfflineStory();
      storageSet(STORY_CACHE_KEY, off);
      renderStoryObject(off, section);
    }
    return;
  }

  if (storyBusy) return;
  storyBusy = true;
  renderStoryLoading(section);

  const { map, list } = collectLessonWords();
  const allowed = cleanAllowedWords(list);
  const topics = storyGrammarTopics(maxAvailableLesson());

  let story = null;
  if (allowed.length) {
    try {
      story = await fetchAIStory(allowed, topics, map);
    } catch (e) {
      console.warn('[story] ИИ недоступен, показываю грамматический генератор:', e.message);
    }
  }
  if (!story) story = buildOfflineStory();

  storageSet(STORY_CACHE_KEY, story);
  renderStoryObject(story, section);
  refreshStoryModalIfOpen();
  storyBusy = false;
}

// Точка входа (вызывается при инициализации)
function renderVocabIdea2() { loadStory(false); }

// ============ ГОРОДА ДЛЯ КАРТЫ ПРОГРЕССА (урок N открывает N-й город) ============
// Порядковый номер в этом списке и есть номер урока/зоны на SVG-карте (data-zone).
// Список — единственный источник числа остановок маршрута (PV_TOTAL_STOPS ниже).
const italyCities = [
  { lesson: 1,  name: 'Рим' },
  { lesson: 2,  name: 'Флоренция' },
  { lesson: 3,  name: 'Венеция' },
  { lesson: 4,  name: 'Милан' },
  { lesson: 5,  name: 'Турин' },
  { lesson: 6,  name: 'Генуя' },
  { lesson: 7,  name: 'Болонья' },
  { lesson: 8,  name: 'Верона' },
  { lesson: 9,  name: 'Падуя' },
  { lesson: 10, name: 'Пиза' },
  { lesson: 11, name: 'Сиена' },
  { lesson: 12, name: 'Перуджа' },
  { lesson: 13, name: 'Ассизи' },
  { lesson: 14, name: 'Урбино' },
  { lesson: 15, name: 'Анкона' },
  { lesson: 16, name: 'Неаполь' },
  { lesson: 17, name: 'Помпеи' },
  { lesson: 18, name: 'Амальфи' },
  { lesson: 19, name: 'Капри' },
  { lesson: 20, name: 'Бари' },
  { lesson: 21, name: 'Лечче' },
  { lesson: 22, name: 'Матера' },
  { lesson: 23, name: 'Реджо-Калабрия' },
  { lesson: 24, name: 'Палермо' },
  { lesson: 25, name: 'Катания' },
  { lesson: 26, name: 'Таормина' },
  { lesson: 27, name: 'Сиракузы' },
  { lesson: 28, name: 'Кальяри' },
  { lesson: 29, name: 'Сассари' },
  { lesson: 30, name: 'Лукка' },
  { lesson: 31, name: 'Парма' },
  { lesson: 32, name: 'Модена' },
  { lesson: 33, name: 'Равенна' },
  { lesson: 34, name: 'Триест' },
  { lesson: 35, name: 'Бергамо' },
  { lesson: 36, name: 'Комо' },
  { lesson: 37, name: 'Бреша' },
  { lesson: 38, name: 'Триент' },
  { lesson: 39, name: 'Больцано' },
  { lesson: 40, name: 'Аоста' },
  { lesson: 41, name: 'Сан-Марино' },
];

// ============ УНИВЕРСАЛЬНОЕ ХРАНИЛИЩЕ (localStorage + cookies как резерв) ============
// Данные сохраняются сразу в два места: localStorage и cookie.
// При загрузке читается то, что есть — даже если одно из хранилищ сбросилось.

const STORAGE_PREFIX = 'stivale_';

function storageSet(key, value) {
  const fullKey = STORAGE_PREFIX + key;
  const str = JSON.stringify(value);
  // 1. localStorage
  try { localStorage.setItem(fullKey, str); } catch(e) {}
  // 2. cookie (срок 3 года, путь /)
  try {
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 3);
    const encoded = encodeURIComponent(str);
    document.cookie = fullKey + '=' + encoded + '; expires=' + expires.toUTCString() + '; path=/; SameSite=Lax';
  } catch(e) {}
}

function storageGet(key) {
  const fullKey = STORAGE_PREFIX + key;
  // 1. Пробуем localStorage
  try {
    const raw = localStorage.getItem(fullKey);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  // 2. Резерв: cookie
  try {
    const match = document.cookie.split('; ').find(r => r.startsWith(fullKey + '='));
    if (match) {
      const val = decodeURIComponent(match.split('=').slice(1).join('='));
      // Восстанавливаем в localStorage
      try { localStorage.setItem(fullKey, val); } catch(e) {}
      return JSON.parse(val);
    }
  } catch(e) {}
  return null;
}

// ============ СТАТУС ДОМАШНЕГО ЗАДАНИЯ ============
const HW_STORAGE_KEY = 'hw_status';

function getHwStatus() {
  return storageGet(HW_STORAGE_KEY) || {};
}

function isHwDone(lessonId) {
  const status = getHwStatus();
  return !!status[lessonId];
}

// ============ ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ ДЗ МЕЖДУ УСТРОЙСТВАМИ (Firebase) ============
// localStorage/cookie живут только в одном браузере, поэтому статус ДЗ дополнительно
// зеркалится в Firebase Realtime Database — так отметка на телефоне сразу видна на
// компьютере и наоборот. Входа/пароля не нужно: используется анонимная авторизация
// Firebase, которая один раз "запоминает" устройство и дальше работает сама.
//
// Чтобы включить: завести бесплатный проект на https://console.firebase.google.com,
// открыть Project settings → SDK setup and configuration → Config и вписать 4 строки
// ниже. Пока apiKey не заполнен, блок сам себя выключает — сайт работает как раньше,
// только в этом браузере.
// Конфиг Firebase хранится в config.json (не коммитится в git для безопасности).
// Загружаем его через fetch перед инициализацией.
let FIREBASE_CONFIG = {};

// Ни одно устройство никогда не "отменяет" готовое ДЗ само по себе — если урок отмечен
// сданным хоть где-то (локально или в облаке), он остаётся сданным после слияния.
function mergeHwStatus(a, b) {
  const merged = { ...(a || {}), ...(b || {}) };
  Object.keys(a || {}).forEach(k => { if (a[k]) merged[k] = true; });
  Object.keys(b || {}).forEach(k => { if (b[k]) merged[k] = true; });
  return merged;
}

// Полный движок облачной синхронизации живёт ниже, после определения streak/словаря
// (initCloudSync и applyCloudSnapshot). Здесь остаётся только слияние ДЗ (mergeHwStatus)
// как одна из функций-стратегий реестра CLOUD_KEYS.

function toggleHwDone(lessonId) {
  const status = getHwStatus();
  status[lessonId] = !status[lessonId];
  storageSet(HW_STORAGE_KEY, status);
  cloudPush(HW_STORAGE_KEY); // зеркалим в общий узел → отметка видна на других устройствах
  if (status[lessonId]) {
    launchConfetti();
    registerStudyDay();
    updateSidebarStreakBadge();
    // Премиальная секвенция в дневнике — только когда открыт НОВЫЙ рубеж маршрута
    // (повторная отметка старого урока не двигает маркер и не открывает регион)
    const les = lessons.find(l => l.id === lessonId);
    const maxDone = Math.max(0, ...getCompletedLessonNumbers());
    if (les && les.number === maxDone) {
      setTimeout(() => {
        closeHwModal();
        pvCelebrate(les.number);
      }, 900);
    }
  }
  return status[lessonId];
}

// ============ УДАРНЫЙ РЕЖИМ (STREAK) И КАЛЕНДАРЬ ЗАНЯТИЙ ============
const STREAK_STORAGE_KEY = 'streak';
const COURSE_START_DATE = '2026-06-22'; // день, когда начали учить итальянский

function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dateKey(d) {
  const x = dateOnly(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
// Все календарные дни от startKey (YYYY-MM-DD) до endDate включительно.
// Дату строим из локальных компонентов, а не из строки, — иначе часовой пояс
// сдвигает полночь на сутки (в браузере пользователя и превью TZ разные).
function datesFromTo(startKey, endDate) {
  const out = [];
  const [y, m, d] = startKey.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  const end = dateOnly(endDate);
  let guard = 0;
  while (cur <= end && guard++ < 4000) {
    out.push(dateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ── Огонёк = «дни в пути»: сколько РАЗНЫХ дней ты заходил на сайт.
// Растёт на +1 в первый заход каждого нового дня. НИКОГДА не сбрасывается:
// пропустил день — огонёк не вырос и стал серым, но накопленное число сохранилось.
function getStreakData() {
  const data = storageGet(STREAK_STORAGE_KEY) || {};
  if (!Array.isArray(data.studyDays)) data.studyDays = [];
  if (!Array.isArray(data.visitDays)) {
    // Миграция: путь идёт с 22 июня, поэтому засеваем все дни от старта до сегодня —
    // так огонёк сразу отражает пройденный путь. Дальше он растёт только по заходам.
    const seed = new Set(datesFromTo(COURSE_START_DATE, new Date()));
    data.studyDays.forEach(d => seed.add(d));
    data.visitDays = [...seed];
  }
  data.visitDays = [...new Set(data.visitDays)].filter(Boolean).sort();
  return data;
}

function saveStreakData(data) { storageSet(STREAK_STORAGE_KEY, data); cloudPush(STREAK_STORAGE_KEY); }

// Длина огонька (число дней в пути)
function getFlameCount() { return getStreakData().visitDays.length; }
function getCurrentStreak() { return getFlameCount(); } // совместимость с остальным кодом

// Горит ли огонёк сегодня (был заход) — иначе он «серый»
function visitedToday() { return getStreakData().visitDays.includes(dateKey(new Date())); }

// Регистрирует сегодняшний заход. Возвращает { count, grewToday, prevCount }.
function registerVisit() {
  const data = getStreakData();
  const todayKey = dateKey(new Date());
  const prevCount = data.visitDays.length;
  const grewToday = !data.visitDays.includes(todayKey);
  if (grewToday) data.visitDays.push(todayKey);
  data.visitDays = [...new Set(data.visitDays)].sort();
  data.count = data.visitDays.length;
  data.lastDate = new Date().toISOString();
  saveStreakData(data);
  return { count: data.count, grewToday, prevCount };
}

// Отметка ДЗ тоже засчитывается как заход этого дня
function registerStudyDay() {
  const data = getStreakData();
  const todayKey = dateKey(new Date());
  if (!data.studyDays.includes(todayKey)) {
    data.studyDays.push(todayKey);
    if (data.studyDays.length > 500) data.studyDays = data.studyDays.slice(-500);
  }
  saveStreakData(data);
  return registerVisit().count;
}

// ============ ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ МЕЖДУ УСТРОЙСТВАМИ (общий узел, без логина) ============
// Пользователь выбрал модель «автоматически, общий»: все устройства читают и пишут ОДИН
// и тот же путь в Firebase Realtime Database, поэтому прогресс виден везде без кода и
// без входа. Приватность — уровня «знаешь адрес сайта → видишь данные» (это отметки ДЗ
// курса, не пароли). Правила базы см. в firebase-rules.json.
//
// Что синхронизируется, задаётся ОДНИМ реестром CLOUD_KEYS: ключ localStorage → функция
// слияния двух версий (локальной и облачной). Добавить новый синхронизируемый ключ =
// одна строка в реестре; писать в облако он начнёт сам. Уровень CEFR, карта, проценты и
// вся статистика дневника ВЫЧИСЛЯЮТСЯ из этих ключей, поэтому синхронизируются следом.
const CLOUD_NODE = 'stivale_shared/v1';

// Firebase web-config НЕ секрет: он и так уходит в браузер каждому посетителю, а доступ к
// данным ограничивают правила базы, а не «секретность» ключа. Поэтому конфиг зашит здесь
// (чтобы синхронизация работала на GitHub Pages), а config.json — необязательный локальный
// оверрайд для разработки.
const FIREBASE_INLINE_CONFIG = {
  apiKey: 'AIzaSyC1dHkIscv46RHJ2lp16wf1SGDRA1EmMb8',
  authDomain: 'stivale-5539f.firebaseapp.com',
  databaseURL: 'https://stivale-5539f-default-rtdb.firebaseio.com',
  projectId: 'stivale-5539f',
};

let cloudRef = null;        // ссылка на общий узел; null = облако выключено (работаем локально)
let cloudApplying = false;  // true, пока применяем снимок из облака, — чтобы не зациклить пуш

// Огонёк = объединение календарей заходов/занятий: дни только копятся и не сбрасываются,
// поэтому union по visitDays/studyDays корректен и не теряет накопленный путь.
function mergeStreakData(a, b) {
  a = a || {}; b = b || {};
  const visitDays = [...new Set([...(a.visitDays || []), ...(b.visitDays || [])])].filter(Boolean).sort();
  const studyDays = [...new Set([...(a.studyDays || []), ...(b.studyDays || [])])].filter(Boolean).sort();
  const lastDate = [a.lastDate, b.lastDate].filter(Boolean).sort().pop() || null;
  return { visitDays, studyDays, count: visitDays.length, lastDate };
}
// Слово выучено настолько, насколько его продвинуло самое «сильное» устройство — берём
// максимум коробки Лейтнера (0/1/2), чтобы синхронизация не откатывала прогресс словаря.
function mergeVocabProgress(a, b) {
  const out = { ...(a || {}) };
  Object.entries(b || {}).forEach(([k, v]) => { out[k] = Math.max(out[k] || 0, v || 0); });
  return out;
}
const CLOUD_KEYS = {
  [HW_STORAGE_KEY]:     mergeHwStatus,      // { 'lesson-1': true, ... } — union готовых ДЗ
  [STREAK_STORAGE_KEY]: mergeStreakData,    // календарь огонька
  [VOCAB_PROGRESS_KEY]: mergeVocabProgress, // прогресс словарного тренажёра
};

// Пишет текущее локальное значение ключа в общий узел (если облако включено и мы не в
// момент применения входящего снимка). Вызывается из saveStreakData/setVocabProgress/ДЗ.
function cloudPush(key) {
  if (!cloudRef || cloudApplying) return;
  const val = storageGet(key);
  if (val == null) return;
  cloudRef.child(key).set(val).catch(() => {});
}

// Перерисовывает всё, на что влияет прогресс, когда из облака пришли новые данные —
// чтобы на этом устройстве сразу обновились сайдбар, карточка ДЗ, дневник, огонёк, словарь.
function refreshAfterSync() {
  try {
    if (lessons.length) { renderNav(currentOpenLessonId); renderLessonGrid(); }
    updateSidebarStreakBadge();
    if (currentOpenLessonId) {
      const holder = document.getElementById('hwButtonHolder');
      const lesson = lessons.find(l => l.id === currentOpenLessonId);
      if (holder && lesson) { holder.innerHTML = renderHwButton(lesson); attachHwButtonListener(lesson.id); }
    }
    if (progressScreen && !progressScreen.classList.contains('hidden')) {
      renderProgressScreen(); pvMountMap(); pvAnimateCounters();
    }
    if (welcomeScreen && !welcomeScreen.classList.contains('hidden')) renderVocabTrainer();
  } catch (e) {}
}

// Применяет снимок общего узла: по каждому ключу сливает облако с локальным, недостающее
// дописывает и в localStorage, и обратно в облако. Так любые два устройства сходятся к
// объединению своих данных, и ни одно не «затирает» прогресс другого.
function applyCloudSnapshot(snap) {
  const cloud = snap.val() || {};
  const toPush = {};
  let changedLocal = false;
  cloudApplying = true;
  for (const [key, mergeFn] of Object.entries(CLOUD_KEYS)) {
    const local = storageGet(key) || {};
    const remote = cloud[key] || {};
    const merged = mergeFn(local, remote);
    const mergedStr = JSON.stringify(merged);
    if (mergedStr !== JSON.stringify(local))  { storageSet(key, merged); changedLocal = true; }
    if (mergedStr !== JSON.stringify(remote)) { toPush[key] = merged; }
  }
  cloudApplying = false;
  if (Object.keys(toPush).length) cloudRef.update(toPush).catch(() => {});
  if (changedLocal) refreshAfterSync();
}

// ── Инициализация Firebase. Конфиг берём из config.json (локальный оверрайд), иначе из
// зашитого FIREBASE_INLINE_CONFIG. Анонимный вход нужен лишь чтобы пройти правила базы —
// узел общий, поэтому uid устройства роли не играет. Любая ошибка облака не ломает сайт. ──
(async function initCloudSync() {
  try {
    if (typeof firebase === 'undefined') return; // SDK не загружен
    let cfg = FIREBASE_INLINE_CONFIG;
    try {
      const res = await fetch('./config.json', { cache: 'no-cache' });
      if (res.ok) { const j = await res.json(); if (j && j.firebase && j.firebase.apiKey) cfg = j.firebase; }
    } catch (e) { /* нет config.json — используем зашитый конфиг */ }
    if (!cfg || !cfg.apiKey) return;
    FIREBASE_CONFIG = cfg;

    firebase.initializeApp(FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged((user) => {
      if (!user) { firebase.auth().signInAnonymously().catch(() => {}); return; }
      cloudRef = firebase.database().ref(CLOUD_NODE);
      cloudRef.on('value', applyCloudSnapshot);
    });
  } catch (e) { /* облако недоступно — тихо работаем локально */ }
})();

// ── Тиры огонька: чем длиннее путь, тем «горячее» и другого цвета пламя.
// Логика настоящего огня: чем жарче, тем цвет уходит от красного к синему и дальше.
const FLAME_TIERS = {
  1: { name: 'Искра',             hot: '#FFCB6B', mid: '#F5872E', base: '#C43A12', glow: '#FF6A2A', spark: '#FFB25A' },
  2: { name: 'Пламя',             hot: '#FFE27A', mid: '#FF9E2C', base: '#E4550F', glow: '#FF8A1E', spark: '#FFC23E' },
  3: { name: 'Золотой огонь',     hot: '#FFF3B0', mid: '#FFC740', base: '#F0850C', glow: '#FFB320', spark: '#FFE07A' },
  4: { name: 'Лазурное пламя',    hot: '#EAF6FF', mid: '#66B8F0', base: '#2A6FD0', glow: '#4CA6F0', spark: '#BFE4FF' },
  5: { name: 'Аметистовое пламя', hot: '#F6E6FF', mid: '#B57BE8', base: '#6C33B0', glow: '#A65CE6', spark: '#E0BBFF' },
  6: { name: 'Аврора',            hot: '#E8FFF4', mid: '#4FD6A6', base: '#1E8F73', glow: '#46E0B0', spark: '#BFFFE8' },
};
function getFlameTier(count) {
  if (count >= 60) return 6;
  if (count >= 30) return 5;
  if (count >= 14) return 4;
  if (count >= 7)  return 3;
  if (count >= 3)  return 2;
  return 1;
}

// Плавный счётчик (rAF, меняет только textContent — без layout-трэшинга)
function countUpEl(el, from, to, dur = 900) {
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Многослойный SVG-огонёк: внешнее свечение, внешний язык пламени (терракотовый),
// внутренний язык (золотой) и яркое ядро — каждый слой анимируется отдельно через CSS
function flameSvgMarkup(tier = 2) {
  const t = FLAME_TIERS[tier] || FLAME_TIERS[2];
  const id = 'fl' + Math.floor(Math.random()*99999);
  return `
    <svg class="streak-flame" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="${id}g" cx="50%" cy="66%" r="60%">
          <stop offset="0%"   stop-color="${t.glow}" stop-opacity="0.8"/>
          <stop offset="45%"  stop-color="${t.glow}" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="${t.base}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="${id}o" x1="14" y1="2" x2="14" y2="33" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stop-color="${t.hot}"/>
          <stop offset="24%"  stop-color="${t.mid}"/>
          <stop offset="62%"  stop-color="${t.base}"/>
          <stop offset="100%" stop-color="${t.base}"/>
        </linearGradient>
        <linearGradient id="${id}m" x1="14" y1="10" x2="14" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stop-color="#FFFDF4"/>
          <stop offset="45%"  stop-color="${t.hot}"/>
          <stop offset="100%" stop-color="${t.mid}"/>
        </linearGradient>
        <radialGradient id="${id}c" cx="50%" cy="60%" r="58%">
          <stop offset="0%"   stop-color="#FFFFFF"/>
          <stop offset="45%"  stop-color="#FFFFFF"/>
          <stop offset="100%" stop-color="${t.hot}"/>
        </radialGradient>
      </defs>

      <!-- ambient glow halo -->
      <ellipse class="flame-glow" cx="14" cy="25" rx="13" ry="11.5" fill="url(#${id}g)"/>

      <!-- main outer flame body -->
      <path class="flame-outer"
        d="M14 2
           C 11.8 6.6 9 8.9 7.4 12.6
           C 5.5 16.8 5.3 20.8 7.1 24.6
           C 8.7 28 11.1 30.3 14 32.1
           C 16.9 30.3 19.4 27.9 20.8 24.3
           C 22.2 20.7 21.8 16.7 20 13.3
           C 19.1 15 18.2 15.8 17 16.2
           C 18.3 12.2 17.2 8.1 14.6 4.8
           C 15 7.9 14.4 10 13 11
           C 12.5 7.9 13 4.9 14 2 Z"
        fill="url(#${id}o)"/>

      <!-- inner flame -->
      <path class="flame-inner"
        d="M14.2 11.2
           C 12.7 14.2 11.1 15.9 10.3 18.8
           C 9.5 21.7 10.2 24.6 12.5 26.7
           C 13.2 27.4 13.7 28 14.2 29.1
           C 14.7 28 15.2 27.4 16 26.7
           C 18.3 24.6 18.9 21.7 18 18.8
           C 17.5 17 16.6 15.8 15.8 15
           C 16 16.4 15.6 17.2 14.8 17.6
           C 15.2 14.9 14.8 13 14.2 11.2 Z"
        fill="url(#${id}m)"/>

      <!-- bright core -->
      <ellipse class="flame-core" cx="14" cy="24.6" rx="2.7" ry="3.7" fill="url(#${id}c)"/>

      <!-- rising sparks -->
      <circle class="flame-spark flame-spark-1" cx="9.5" cy="15" r="1"    fill="${t.spark}"/>
      <circle class="flame-spark flame-spark-2" cx="18.5" cy="13" r="0.8" fill="${t.spark}"/>
      <circle class="flame-spark flame-spark-3" cx="14" cy="10" r="0.7"   fill="#FFFFFF"/>
    </svg>
  `;
}

function updateSidebarStreakBadge(opts = {}) {
  const badge = document.getElementById('sidebarStreakBadge');
  if (!badge) return;
  const count = getFlameCount();
  if (count <= 0) { badge.className = 'sidebar-streak-badge'; badge.innerHTML = ''; return; }
  const tier = getFlameTier(count);
  const lit = visitedToday();
  badge.className = 'sidebar-streak-badge show is-active flame-tier-' + tier + (lit && !opts.grew ? '' : ' flame-dormant');
  badge.innerHTML = `${flameSvgMarkup(tier)}<span class="sidebar-streak-count">${count}</span>`;

  if (opts.grew) {
    // Розжиг нового дня: серый уголёк → разгорается + число тикает вверх
    const countEl = badge.querySelector('.sidebar-streak-count');
    countEl.textContent = opts.prevCount;
    setTimeout(() => {
      badge.classList.remove('flame-dormant');
      badge.classList.add('flame-ignite');
      countUpEl(countEl, opts.prevCount, count, 900);
      setTimeout(() => badge.classList.remove('flame-ignite'), 1100);
    }, 450);
  }
}

// Единая точка входа при загрузке: регистрирует заход и, если это новый день,
// красиво разжигает огонёк в сайдбаре и показывает уведомление на любом экране.
function initStreakFlame() {
  const { count, grewToday, prevCount } = registerVisit();
  updateSidebarStreakBadge({ grew: grewToday, prevCount });
  if (grewToday && count > 1) setTimeout(() => showFlameToast(count, prevCount), 750);
}

function showFlameToast(count, prevCount) {
  const tier = getFlameTier(count);
  const word = count === 1 ? 'день' : (count % 10 >= 2 && count % 10 <= 4 && (count < 10 || count > 20) ? 'дня' : 'дней');
  const el = document.createElement('div');
  el.className = 'flame-toast flame-tier-' + tier;
  el.innerHTML = `
    <span class="flame-toast-flame">${flameSvgMarkup(tier)}</span>
    <span class="flame-toast-text">
      <b>Огонёк разгорелся</b>
      <span class="flame-toast-sub"><em class="flame-toast-num">${prevCount}</em> ${word} в пути · ${FLAME_TIERS[tier].name}</span>
    </span>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('flame-toast-in');
    countUpEl(el.querySelector('.flame-toast-num'), prevCount, count, 900);
  });
  setTimeout(() => { el.classList.remove('flame-toast-in'); el.classList.add('flame-toast-out'); }, 4200);
  setTimeout(() => el.remove(), 4900);
}

// ============ КОНФЕТТИ ============
function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('active');

  const colors = ['#C1543A', '#6B7A4D', '#C99A3D', '#FAF6EE', '#A8442E', '#8C9C6B'];
  const pieces = [];
  const count = 140;

  for (let i = 0; i < count; i++) {
    pieces.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 120,
      y: canvas.height * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -9 - 4,
      size: Math.random() * 7 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 14,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
      gravity: 0.25 + Math.random() * 0.15,
      drag: 0.992,
      opacity: 1,
    });
  }

  let frame = 0;
  const maxFrames = 130;

  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let anyVisible = false;
    pieces.forEach(p => {
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      if (frame > maxFrames * 0.6) {
        p.opacity = Math.max(0, p.opacity - 0.03);
      }
      if (p.opacity > 0 && p.y < canvas.height + 30) {
        anyVisible = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.65);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });

    if (anyVisible && frame < maxFrames + 20) {
      requestAnimationFrame(tick);
    } else {
      canvas.classList.remove('active');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  requestAnimationFrame(tick);
}

// ============ РЕНДЕР ============
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const navList = document.getElementById('navList');
const lessonGrid = document.getElementById('lessonGrid');
const welcomeScreen = document.getElementById('welcomeScreen');
const lessonScreen = document.getElementById('lessonScreen');
const progressScreen = document.getElementById('progressScreen');

function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
}
function openSidebar() {
  sidebar.classList.add('open');
  overlay.classList.add('open');
}

document.getElementById('menuBtn').addEventListener('click', () => {
  if (sidebar.classList.contains('open')) closeSidebar();
  else openSidebar();
});
document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

document.getElementById('logoBtn').addEventListener('click', () => {
  showWelcome();
  closeSidebar();
});

document.getElementById('homeNavBtn').addEventListener('click', () => {
  showWelcome();
  closeSidebar();
});

document.getElementById('hwModal').addEventListener('click', (e) => {
  if (e.target.id === 'hwModal') closeHwModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeHwModal();
    closeSidebar();
  }
});

function renderNav(activeId) {
  navList.innerHTML = '';
  let lastStageNum = null;
  lessons.forEach(lesson => {
    // Заголовок этапа печатается один раз перед первым его уроком — это и есть авто-оглавление
    const stage = getLessonStage(lesson.number);
    if (stage && stage.n !== lastStageNum) {
      const head = document.createElement('div');
      head.className = 'nav-stage';
      head.innerHTML = `
        <span class="nav-stage-num">Этап ${stage.n}</span>
        <span class="nav-stage-title">${stage.title}</span>
        <span class="nav-stage-level">${stage.level}</span>
      `;
      navList.appendChild(head);
      lastStageNum = stage.n;
    }

    const done = isHwDone(lesson.id);
    const special = getLessonSpecial(lesson.number);
    const item = document.createElement('div');
    item.className = 'nav-item' + (lesson.id === activeId ? ' active' : '') + (special ? ' nav-item-' + special.key : '');
    item.innerHTML = `
      <div class="nav-item-row">
        <span class="nav-item-lesson">${special ? NAV_STAR_SVG : ''}Урок ${lesson.number}</span>
        <span class="hw-badge ${done ? 'done' : 'pending'}">${done ? ICON_CHECK_HTML + ' ДЗ готово' : 'ДЗ не сдано'}</span>
      </div>
      <span class="nav-sub">${lesson.title}</span>
      ${special ? `<span class="nav-type nav-type-${special.key}">${special.label}</span>` : ''}
    `;
    item.addEventListener('click', () => {
      showLesson(lesson.id);
      closeSidebar();
    });
    navList.appendChild(item);
  });
}

function renderLessonGrid() {
  lessonGrid.innerHTML = '';

  // Показываем только последний урок
  const lesson = lessons[lessons.length - 1];
  if (!lesson) {
    lessonGrid.innerHTML = '<p style="padding:16px 4px;color:#9a8f80;font-size:14px;">Уроки не найдены — проверь папку lessons/.</p>';
    return;
  }
  const done = isHwDone(lesson.id);
  const card = document.createElement('div');
  card.className = 'lesson-card';
  card.innerHTML = `
    <div class="nav-item-row" style="margin-bottom:12px;">
      <span class="lesson-card-num" style="margin-bottom:0;">Урок ${lesson.number}</span>
      <span class="hw-badge ${done ? 'done' : 'pending'}">${done ? ICON_CHECK_HTML + ' ДЗ готово' : 'ДЗ не сдано'}</span>
    </div>
    <h3>${lesson.title}</h3>
    <p>${lesson.subtitle}</p>
    <div class="lesson-card-meta"><span>⏱ ${lesson.time}</span></div>
    <div class="hw-toggle-card ${done ? 'is-done' : ''}" data-role="hw-toggle">
      <span class="hw-checkbox ${done ? 'checked' : ''}">${done ? ICON_CHECK_HTML : ''}</span>
      <span class="hw-label ${done ? 'done-label' : ''}">${done ? 'Домашка сделана' : 'Отметить домашку сделанной'}</span>
    </div>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-role="hw-toggle"]')) {
      e.stopPropagation();
      toggleHwDone(lesson.id);
      renderLessonGrid();
      renderNav(null);
      return;
    }
    showLesson(lesson.id);
  });
  lessonGrid.appendChild(card);

  const futureCard = document.createElement('div');
  futureCard.className = 'lesson-card lesson-card-future';
  futureCard.innerHTML = `
    <span class="lesson-card-num">Скоро</span>
    <span class="lesson-card-future-icon">${ICON_LOCK_CLOSED_HTML}</span>
    <h3>Следующий урок</h3>
    <p>Появится здесь, когда будет готов</p>
  `;
  lessonGrid.appendChild(futureCard);
}

function showWelcome() {
  currentOpenLessonId = null;
  welcomeScreen.classList.remove('hidden');
  lessonScreen.classList.add('hidden');
  progressScreen.classList.add('hidden');
  document.getElementById('progressNavBtn').classList.remove('active');
  document.getElementById('homeNavBtn').classList.add('active');
  renderNav(null);
}

function renderHwButton(lesson) {
  const done = isHwDone(lesson.id);
  return `
    <button class="hw-open-btn ${done ? 'done' : 'pending'}" data-role="open-hw-modal">
      <span class="hw-open-btn-icon">${done ? ICON_CHECK_HTML : ICON_NOTE_HTML}</span>
      <span class="hw-open-btn-text">
        <span class="hw-open-btn-title">Домашнее задание</span>
        <span class="hw-open-status">${done ? 'Готово' : 'Не сделано'}</span>
      </span>
    </button>
  `;
}

// Кнопки «Ответы» / «Перевод» в ДЗ — это details.reveal: либо автор написал их сам,
// либо upgradeRevealBlocks (см. начало файла) сконвертировал .hw-answers/.hw-translation
// при разборе файла урока. Стиль даёт CSS, раскрытие нативное — JS здесь не нужен.

// Строка «N заданий · ≈ M минут» в шапке модалки ДЗ. Числа вычислены из содержимого
// файла урока (computeHwStats), а не написаны руками; время округляем до пяти минут.
function renderHwMetaRow(lesson) {
  const stats = lesson.hwStats || { count: 0, minutes: 0 };
  if (!stats.count) return '';
  const parts = [`${stats.count} ${storyPlural(stats.count, 'задание', 'задания', 'заданий')}`];
  if (stats.minutes >= 5) parts.push(`≈ ${Math.round(stats.minutes / 5) * 5} минут`);
  return `<div class="hw-sections-meta">${parts.map(p => `<span>${p}</span>`).join('')}</div>`;
}

// Домашнее задание — часть того же файла урока (lesson.homeworkHTML заполняется при
// подключении файла в discoverLessons), поэтому рендер модалки полностью синхронный.
function renderHwModalContent(lesson) {
  const done = isHwDone(lesson.id);
  return `
    <div class="hw-modal-head">
      <h2>${ICON_NOTE_HTML} Домашнее задание</h2>
    </div>
    <p class="hw-modal-lesson-name">${lesson.title}</p>
    <div class="hw-status-banner ${done ? 'done' : 'pending'}" data-role="hw-banner-toggle">
      <span class="hw-checkbox ${done ? 'checked' : ''}" style="background:${done ? 'var(--olive)' : 'transparent'}; border-color:${done ? 'var(--olive)' : '#C1543A'};">${done ? ICON_CHECK_HTML : ''}</span>
      <span>${done ? 'Домашнее задание отмечено как сделанное' : 'Домашнее задание ещё не отмечено как сделанное — нажми, чтобы отметить'}</span>
    </div>
    <div class="hw-modal-body">
      ${renderHwMetaRow(lesson)}
      ${lesson.homeworkHTML}
    </div>
    <div class="hw-status-banner ${done ? 'done' : 'pending'}" data-role="hw-banner-toggle-bottom" style="margin-top:24px;">
      <span class="hw-checkbox ${done ? 'checked' : ''}" style="background:${done ? 'var(--olive)' : 'transparent'}; border-color:${done ? 'var(--olive)' : '#C1543A'};">${done ? ICON_CHECK_HTML : ''}</span>
      <span>${done ? 'Домашнее задание отмечено как сделанное' : 'Всё сделано? Нажми, чтобы отметить домашку выполненной'}</span>
    </div>
  `;
}

function openHwModal(lessonId) {
  const lesson = lessons.find(l => l.id === lessonId);
  if (!lesson) return;
  const modal = document.getElementById('hwModal');
  const modalContent = document.getElementById('hwModalContent');
  modalContent.innerHTML = renderHwModalContent(lesson);
  modal.classList.add('open');
  modalContent.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  wrapResponsiveTables(modalContent);

  document.getElementById('hwModalCloseBtn').onclick = closeHwModal;

  const onToggle = () => {
    toggleHwDone(lessonId);
    openHwModal(lessonId);
    renderNav(lessonId);
    renderLessonGrid();
    // обновим кнопку в шапке урока, если она открыта
    const btnHolder = document.getElementById('hwButtonHolder');
    if (btnHolder) btnHolder.innerHTML = renderHwButton(lesson);
    attachHwButtonListener(lessonId);
  };

  modalContent.querySelectorAll('[data-role="hw-banner-toggle"], [data-role="hw-banner-toggle-bottom"]').forEach(el => {
    el.addEventListener('click', onToggle);
  });
}

function closeHwModal() {
  document.getElementById('hwModal').classList.remove('open');
  document.body.style.overflow = '';
}

function attachHwButtonListener(lessonId) {
  const btnHolder = document.getElementById('hwButtonHolder');
  if (!btnHolder) return;
  const btn = btnHolder.querySelector('[data-role="open-hw-modal"]');
  if (btn) btn.addEventListener('click', () => openHwModal(lessonId));
}

// Оборачивает каждую <table> внутри container в .table-scroll,
// чтобы на узких экранах таблица скроллилась горизонтально, а не
// вылезала за пределы экрана. Также включает тень-индикатор,
// когда контент шире видимой области (есть что доскроллить).
function wrapResponsiveTables(container) {
  if (!container) return;
  const tables = container.querySelectorAll('table');
  tables.forEach(table => {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  const updateScrollState = () => {
    container.querySelectorAll('.table-scroll').forEach(wrap => {
      wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth + 1);
    });
  };
  updateScrollState();

  // Пересчитываем при ресайзе/повороте экрана (один общий слушатель на окно)
  if (!window.__tableScrollResizeBound) {
    window.__tableScrollResizeBound = true;
    window.addEventListener('resize', () => {
      document.querySelectorAll('.table-scroll').forEach(wrap => {
        wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth + 1);
      });
    });
  }
}

// ============ ЗАГРУЗКА ФРАГМЕНТОВ УРОКОВ (используется discoverLessons выше) ============
// Общий fetch+кэш для текста .html-файлов из lessons/. Используется на старте, чтобы
// подключить все найденные уроки (см. discoverLessons в начале скрипта).
const lessonFragmentCache = new Map();

async function loadLessonFragment(url) {
  if (!url) return '';
  if (lessonFragmentCache.has(url)) return lessonFragmentCache.get(url);
  // no-cache: всегда сверяемся с сервером (условный запрос), чтобы после правки файла
  // урока изменения подхватывались сразу, а не отдавалась устаревшая версия из кэша.
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Не удалось загрузить фрагмент урока: ${url} (HTTP ${res.status})`);
  const html = await res.text();
  lessonFragmentCache.set(url, html);
  return html;
}

let currentOpenLessonId = null; // какой урок открыт сейчас — нужно только чтобы после
                                 // фоновой облачной синхронизации ДЗ восстановить подсветку в сайдбаре

function showLesson(id) {
  const lesson = lessons.find(l => l.id === id);
  if (!lesson) return;
  currentOpenLessonId = id;
  welcomeScreen.classList.add('hidden');
  progressScreen.classList.add('hidden');
  document.getElementById('progressNavBtn').classList.remove('active');
  document.getElementById('homeNavBtn').classList.remove('active');
  lessonScreen.classList.remove('hidden');
  lessonScreen.innerHTML = `
    <div class="header">
      <div class="header-text">
        <span class="header-lesson-badge">Урок ${lesson.number}</span>
        <h1 class="header-title">${lesson.title}</h1>
        <p class="header-subtitle">${lesson.subtitle}</p>
      </div>
      <div class="header-meta">
        <div class="header-meta-info">
          <span class="meta-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>${lesson.time}</span>
          <span class="meta-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 20.5v-1.8c0-2.6-2.4-4.7-5.3-4.7h-4.4c-2.9 0-5.3 2.1-5.3 4.7v1.8"/><circle cx="12" cy="7.8" r="3.8"/></svg>${lesson.level}</span>
        </div>
        <span id="hwButtonHolder">${renderHwButton(lesson)}</span>
      </div>
    </div>
    <div class="content">
      ${lesson.sectionsHTML}
    </div>
  `;
  renderNav(id);
  document.querySelector(".main").scrollTo(0, 0);
  attachHwButtonListener(id);
  const contentEl = lessonScreen.querySelector('.content');
  wrapResponsiveTables(contentEl);
}

// ============ ДНЕВНИК ПРОГРЕССА ============
function getCompletedLessonNumbers() {
  const status = getHwStatus();
  return lessons.filter(l => status[l.id]).map(l => l.number);
}

function buildItalyMapSVG() {
  const completed = getCompletedLessonNumbers();
  const maxDone = completed.length ? Math.max(...completed) : 0;

  const ZONES = [
    { zone: 1, d: "M 187.8 207.8 L 182.8 204.3 L 180.6 201.2 L 181.8 194.4 L 180.4 189.6 L 181.9 188.1 L 181.3 186.1 L 182.1 183.5 L 185.1 181.2 L 192.8 181.3 L 195.1 179.7 L 195.2 177.8 L 197.3 176.7 L 196.1 174.1 L 197.3 171.1 L 204.5 170.0 L 205.2 168.2 L 208.9 166.7 L 208.6 164.9 L 210.1 163.2 L 207.5 158.9 L 201.8 155.5 L 207.4 151.5 L 213.8 151.2 L 215.8 148.4 L 219.5 147.2 L 219.6 145.4 L 224.4 144.1 L 224.9 142.2 L 222.2 141.1 L 223.2 140.0 L 229.5 136.9 L 237.8 135.9 L 239.4 137.6 L 238.6 139.7 L 239.6 140.8 L 239.6 145.3 L 239.2 148.4 L 235.7 151.8 L 238.4 155.2 L 237.2 156.5 L 245.9 159.6 L 249.9 164.9 L 252.7 165.8 L 252.0 167.0 L 253.6 169.0 L 257.1 168.9 L 263.7 171.3 L 262.8 172.9 L 265.1 178.3 L 249.6 190.7 L 251.9 197.7 L 248.7 196.7 L 248.6 195.4 L 242.7 197.1 L 242.5 195.8 L 238.6 192.9 L 235.0 197.5 L 232.9 195.1 L 230.6 197.1 L 230.5 202.0 L 228.1 203.1 L 232.2 209.8 L 224.3 210.4 L 228.6 214.9 L 227.8 215.5 L 232.1 218.3 L 233.0 230.5 L 234.1 231.6 L 233.2 232.6 L 233.0 239.8 L 236.2 238.2 L 238.4 241.5 L 242.3 241.9 L 242.7 244.5 L 240.0 245.0 L 239.1 246.5 L 242.0 248.0 L 244.0 247.5 L 242.6 249.9 L 243.9 250.0 L 244.1 251.7 L 246.1 251.3 L 245.9 253.3 L 247.0 253.6 L 244.9 254.1 L 248.2 254.9 L 245.6 255.1 L 247.0 255.6 L 245.0 256.8 L 247.4 258.5 L 245.1 259.1 L 250.6 258.7 L 247.1 260.7 L 247.4 262.0 L 243.4 261.5 L 242.4 259.1 L 239.9 258.5 L 236.9 259.4 L 232.4 258.5 L 229.3 259.2 L 226.1 261.9 L 219.9 260.8 L 215.0 262.4 L 213.4 261.0 L 211.2 262.8 L 210.9 261.7 L 208.8 262.0 L 207.5 262.8 L 207.2 265.9 L 203.3 265.6 L 201.3 268.9 L 198.6 267.9 L 198.5 265.9 L 196.5 265.5 L 187.8 267.7 L 187.0 268.2 L 188.3 270.0 L 186.0 271.2 L 183.8 269.2 L 183.5 272.6 L 186.5 273.1 L 187.3 274.4 L 188.2 272.9 L 189.9 274.3 L 189.4 275.5 L 186.2 276.2 L 185.7 278.1 L 187.5 278.4 L 187.2 279.6 L 184.4 281.8 L 184.2 284.2 L 182.6 284.7 L 183.5 286.7 L 185.7 286.5 L 186.8 287.9 L 185.9 288.9 L 182.7 288.5 L 182.8 289.7 L 186.0 289.9 L 188.4 293.4 L 184.5 295.8 L 181.8 294.7 L 180.7 295.6 L 175.4 292.6 L 175.6 293.7 L 172.4 293.9 L 171.1 296.4 L 163.2 296.9 L 159.9 296.1 L 159.2 293.8 L 157.4 294.8 L 156.9 293.3 L 156.8 295.1 L 155.6 293.9 L 154.3 294.6 L 154.6 297.0 L 152.5 297.3 L 152.5 296.0 L 151.0 296.9 L 151.5 298.0 L 148.6 298.4 L 145.7 301.1 L 142.4 302.2 L 140.2 301.4 L 141.3 300.0 L 130.1 302.6 L 130.0 299.6 L 125.3 299.7 L 111.9 301.8 L 108.1 305.2 L 102.8 306.3 L 99.6 305.0 L 98.3 300.3 L 96.4 299.0 L 98.7 295.7 L 97.0 294.0 L 89.7 291.8 L 87.8 293.6 L 83.1 293.0 L 72.1 287.6 L 73.0 284.9 L 71.7 284.4 L 73.6 282.2 L 70.8 279.3 L 72.2 278.7 L 71.6 277.1 L 64.6 276.5 L 63.5 271.5 L 60.0 268.4 L 60.8 267.1 L 64.5 266.3 L 65.2 264.7 L 71.1 265.1 L 73.9 262.8 L 81.6 266.0 L 86.1 265.0 L 85.1 263.2 L 86.0 261.9 L 91.3 261.8 L 93.1 258.2 L 101.1 256.4 L 103.0 257.9 L 107.2 254.4 L 108.6 254.6 L 109.8 253.5 L 109.7 251.1 L 107.1 246.5 L 109.5 246.1 L 109.4 244.6 L 112.0 243.4 L 112.3 241.2 L 114.5 239.1 L 107.6 236.2 L 106.3 234.1 L 108.7 228.5 L 110.2 228.6 L 110.4 231.8 L 112.1 231.0 L 118.1 232.5 L 122.7 228.2 L 131.5 227.1 L 133.2 228.0 L 144.1 221.6 L 148.3 222.2 L 151.7 220.7 L 155.8 223.5 L 158.3 222.8 L 162.4 224.6 L 166.5 223.9 L 167.9 224.8 L 179.2 219.7 L 183.8 220.9 L 183.9 218.7 L 188.0 215.7 L 184.7 211.7 L 187.8 207.8 Z M 141.9 300.6 L 142.4 301.6 L 142.7 301.3 L 141.9 300.6 Z" },
    { zone: 2, d: "M 91.4 334.0 L 84.3 329.0 L 82.1 324.5 L 84.6 321.9 L 89.9 320.0 L 90.3 317.1 L 91.8 315.4 L 93.2 315.6 L 91.3 312.2 L 92.9 309.8 L 99.3 308.5 L 103.4 309.6 L 103.2 305.9 L 108.1 305.2 L 111.9 301.8 L 123.6 299.9 L 130.0 299.6 L 130.6 302.6 L 141.3 300.0 L 140.0 300.5 L 140.2 301.4 L 142.4 302.2 L 145.7 301.1 L 148.6 298.4 L 151.5 298.0 L 151.0 296.9 L 152.5 296.0 L 152.5 297.3 L 154.6 297.0 L 154.3 294.6 L 155.6 293.9 L 156.8 295.1 L 156.9 293.3 L 157.4 294.8 L 159.2 293.8 L 159.9 296.1 L 163.2 296.9 L 171.1 296.4 L 172.4 293.9 L 175.6 293.7 L 175.4 292.6 L 180.7 295.6 L 181.8 294.7 L 184.5 295.8 L 188.4 293.4 L 186.0 289.9 L 182.8 289.7 L 182.7 288.5 L 185.9 288.9 L 186.8 287.9 L 185.7 286.5 L 183.5 286.7 L 182.6 284.7 L 184.2 284.2 L 184.4 281.8 L 187.2 279.6 L 187.5 278.4 L 185.7 278.1 L 186.2 276.2 L 189.4 275.5 L 189.9 274.3 L 188.2 272.9 L 187.3 274.4 L 186.5 273.1 L 183.5 272.6 L 183.8 269.2 L 186.0 271.2 L 188.3 270.0 L 187.0 268.2 L 192.0 266.4 L 195.0 268.4 L 198.2 267.8 L 201.3 268.9 L 203.3 265.6 L 207.2 265.9 L 208.3 262.2 L 210.9 261.7 L 211.2 262.8 L 213.4 261.0 L 215.0 262.4 L 219.9 260.8 L 226.0 261.9 L 230.5 258.8 L 242.4 259.1 L 243.4 261.5 L 246.3 261.3 L 253.5 266.4 L 253.4 268.0 L 257.0 271.1 L 255.9 274.4 L 258.2 276.7 L 263.2 274.7 L 264.8 276.3 L 267.1 276.4 L 266.9 277.5 L 269.2 277.8 L 269.8 276.1 L 271.8 276.4 L 271.6 274.9 L 280.4 272.6 L 282.8 278.9 L 284.2 280.2 L 287.6 279.7 L 289.3 281.6 L 288.5 283.9 L 291.4 287.3 L 294.4 289.3 L 296.9 289.3 L 298.3 291.6 L 296.3 293.1 L 298.6 296.3 L 300.8 296.1 L 302.1 297.4 L 307.2 296.5 L 308.2 300.7 L 312.3 302.6 L 310.9 309.2 L 311.5 317.6 L 306.4 320.0 L 302.3 319.2 L 301.6 316.5 L 298.9 315.1 L 295.8 316.0 L 295.3 313.5 L 292.8 310.9 L 288.8 311.3 L 285.2 310.0 L 282.5 312.9 L 280.0 313.7 L 282.6 316.1 L 283.4 321.2 L 280.9 322.3 L 278.7 320.7 L 274.6 321.2 L 274.8 323.0 L 271.9 324.3 L 271.6 327.2 L 270.3 328.3 L 268.7 328.0 L 268.8 324.8 L 267.1 324.7 L 267.1 322.4 L 263.6 319.3 L 260.4 319.9 L 254.8 318.8 L 252.3 321.7 L 253.7 323.0 L 249.9 324.9 L 250.1 326.3 L 240.6 326.2 L 239.9 325.0 L 237.8 327.5 L 234.8 325.9 L 233.3 326.3 L 232.2 329.4 L 229.0 330.6 L 228.0 328.6 L 220.4 326.5 L 218.6 324.4 L 215.8 325.8 L 215.7 328.6 L 213.2 329.4 L 215.6 334.1 L 213.8 336.5 L 208.5 338.4 L 208.1 342.2 L 207.0 343.6 L 204.3 343.5 L 203.9 346.6 L 201.4 345.3 L 199.8 346.6 L 202.8 349.2 L 200.1 351.3 L 201.9 352.6 L 200.3 354.8 L 203.3 356.8 L 203.4 358.5 L 200.9 361.6 L 198.3 362.1 L 194.9 360.8 L 191.9 362.6 L 195.1 364.1 L 194.2 364.6 L 195.0 365.8 L 191.2 364.9 L 187.8 366.2 L 170.8 362.2 L 167.1 363.9 L 166.6 365.8 L 167.8 367.7 L 170.5 367.7 L 167.3 370.1 L 166.1 370.0 L 166.3 367.8 L 161.4 363.2 L 163.2 359.0 L 162.1 358.7 L 158.4 358.7 L 156.6 361.3 L 138.2 363.2 L 137.7 364.9 L 134.7 363.7 L 131.3 364.6 L 129.8 361.7 L 123.6 362.2 L 120.2 359.2 L 117.8 359.5 L 112.4 355.7 L 110.5 356.4 L 103.8 353.3 L 99.8 354.1 L 97.1 352.9 L 96.0 348.6 L 92.4 347.1 L 92.6 345.6 L 89.3 343.5 L 88.8 341.7 L 85.4 340.6 L 86.4 339.4 L 86.0 335.0 L 91.4 334.0 Z M 273.6 276.3 L 273.6 276.3 L 273.4 276.7 L 273.6 276.3 Z M 262.6 276.7 L 262.8 277.1 L 262.7 276.0 L 262.6 276.7 Z M 141.9 300.6 L 142.8 301.1 L 142.4 301.6 L 141.9 300.6 Z M 234.9 197.5 L 238.6 192.9 L 242.5 195.8 L 242.7 197.1 L 248.6 195.4 L 248.7 196.7 L 251.9 197.7 L 248.1 200.4 L 248.1 202.8 L 251.9 207.2 L 257.7 208.8 L 256.4 212.4 L 260.4 212.5 L 259.3 213.9 L 261.1 216.3 L 258.2 216.2 L 258.6 217.8 L 262.5 219.9 L 261.6 222.1 L 264.1 226.6 L 263.5 227.7 L 264.9 229.4 L 270.8 231.0 L 270.9 233.4 L 273.0 234.9 L 272.8 236.2 L 274.5 236.2 L 276.2 240.0 L 272.1 241.5 L 268.6 240.5 L 268.2 241.7 L 264.1 241.6 L 268.3 244.4 L 266.3 246.0 L 264.6 245.7 L 263.8 248.9 L 261.3 249.9 L 259.0 249.9 L 257.9 246.7 L 253.8 243.9 L 250.4 244.6 L 247.8 243.2 L 245.3 245.0 L 246.4 247.5 L 244.6 248.0 L 239.1 246.5 L 240.0 245.0 L 242.7 244.5 L 242.3 241.9 L 238.4 241.5 L 236.2 238.2 L 233.0 239.8 L 233.2 232.6 L 234.1 231.6 L 233.0 230.5 L 232.1 218.3 L 227.8 215.5 L 228.6 214.9 L 224.2 210.4 L 229.5 209.4 L 231.8 210.3 L 230.8 206.4 L 228.1 203.1 L 230.5 202.0 L 230.8 196.7 L 232.3 196.6 L 232.9 195.1 L 234.9 197.5 Z" },
    { zone: 3, d: "M 166.5 188.3 L 169.9 186.8 L 174.4 189.0 L 176.5 188.0 L 180.7 189.1 L 181.8 194.4 L 180.6 201.2 L 182.7 204.3 L 187.0 206.0 L 187.8 207.8 L 184.7 211.7 L 188.0 215.7 L 183.9 218.7 L 184.3 220.7 L 177.2 220.2 L 167.9 224.8 L 166.5 223.9 L 162.4 224.6 L 158.3 222.8 L 155.8 223.5 L 151.7 220.7 L 148.3 222.2 L 144.1 221.6 L 133.2 228.0 L 131.5 227.1 L 122.7 228.2 L 118.1 232.5 L 112.1 231.0 L 110.4 231.8 L 109.8 228.1 L 106.6 232.9 L 101.1 232.4 L 101.6 230.2 L 96.4 229.2 L 95.9 222.2 L 94.3 221.0 L 94.9 217.5 L 96.5 216.0 L 93.4 214.6 L 88.1 214.8 L 86.9 212.1 L 82.2 211.4 L 77.8 207.7 L 78.6 206.3 L 77.0 202.2 L 78.7 196.9 L 83.2 197.2 L 84.7 195.5 L 90.6 195.8 L 96.2 193.3 L 96.8 190.7 L 99.6 188.6 L 102.4 189.4 L 106.3 194.7 L 111.7 192.7 L 115.0 194.7 L 117.5 191.8 L 121.7 191.6 L 125.0 188.6 L 134.1 190.9 L 139.7 187.6 L 142.7 187.2 L 143.0 185.5 L 149.2 185.2 L 149.7 182.4 L 152.1 182.1 L 153.8 183.8 L 161.1 183.3 L 165.7 185.9 L 166.5 188.3 Z" },
    { zone: 4, d: "M 251.9 207.2 L 248.1 202.8 L 248.1 200.6 L 252.0 197.1 L 249.6 190.7 L 264.8 179.2 L 262.8 172.6 L 266.4 169.0 L 268.1 171.0 L 272.6 171.1 L 277.0 173.5 L 277.3 174.9 L 270.6 182.0 L 275.0 182.1 L 278.6 184.8 L 281.2 185.0 L 281.0 187.6 L 284.1 190.1 L 285.0 193.6 L 286.2 193.9 L 282.9 197.5 L 286.6 196.2 L 291.2 197.0 L 290.8 198.2 L 294.8 198.2 L 296.7 193.3 L 300.1 190.6 L 293.4 187.9 L 292.8 184.8 L 290.4 183.8 L 294.2 181.5 L 292.4 177.3 L 293.6 175.8 L 299.1 174.5 L 300.2 172.3 L 298.5 169.2 L 303.3 167.8 L 307.0 164.3 L 309.3 164.3 L 313.1 158.5 L 315.6 158.1 L 316.0 155.0 L 320.7 149.1 L 320.3 146.2 L 318.5 144.9 L 318.8 140.7 L 315.6 138.4 L 315.5 137.3 L 318.6 135.9 L 319.0 132.5 L 327.0 131.4 L 328.1 133.6 L 331.5 135.4 L 333.8 132.3 L 336.3 131.5 L 336.3 133.6 L 335.3 133.8 L 336.7 135.0 L 335.7 139.9 L 337.2 143.0 L 336.5 144.2 L 339.9 145.4 L 344.6 151.2 L 351.8 152.9 L 357.4 151.3 L 361.2 152.3 L 362.0 147.7 L 363.4 146.7 L 367.3 148.2 L 379.9 143.8 L 381.7 145.2 L 384.9 144.0 L 385.5 145.5 L 388.7 146.7 L 387.1 149.3 L 388.5 150.3 L 388.6 153.1 L 394.4 155.3 L 394.9 156.7 L 393.6 158.6 L 395.9 159.7 L 402.9 158.6 L 406.2 155.7 L 399.2 148.4 L 399.6 146.6 L 401.6 145.7 L 401.5 144.1 L 404.8 143.1 L 405.2 141.0 L 401.8 138.8 L 396.8 139.8 L 392.9 137.4 L 394.2 135.7 L 393.2 134.1 L 394.3 130.1 L 393.3 128.3 L 398.9 124.1 L 399.0 121.3 L 401.7 121.8 L 407.6 119.8 L 409.8 120.7 L 412.4 119.0 L 414.2 121.4 L 412.8 124.5 L 416.7 125.2 L 417.9 127.2 L 429.9 127.2 L 433.2 129.2 L 435.4 132.6 L 442.8 133.0 L 449.7 137.2 L 449.1 139.1 L 450.5 141.6 L 448.2 143.9 L 444.3 144.0 L 441.7 146.3 L 439.7 146.2 L 438.9 148.3 L 433.6 146.6 L 425.1 152.4 L 420.3 153.4 L 416.5 160.1 L 406.6 163.5 L 404.6 165.3 L 405.8 167.6 L 405.0 170.5 L 407.1 173.0 L 405.5 175.3 L 401.9 174.9 L 399.0 176.0 L 398.0 174.9 L 398.8 172.1 L 391.4 172.4 L 390.1 173.8 L 380.2 175.3 L 380.0 176.4 L 373.1 176.6 L 366.3 174.6 L 354.2 175.1 L 347.8 178.9 L 339.3 179.8 L 340.5 184.1 L 343.8 185.1 L 344.2 186.3 L 340.8 190.8 L 342.6 193.5 L 337.3 194.9 L 337.6 198.0 L 339.9 200.8 L 337.7 202.1 L 335.4 201.8 L 337.4 203.5 L 335.0 204.3 L 336.1 205.6 L 335.1 207.1 L 336.3 209.9 L 335.5 211.7 L 338.0 213.2 L 335.1 215.1 L 332.7 214.4 L 331.9 212.5 L 327.8 214.5 L 325.0 212.9 L 322.1 214.0 L 319.5 207.2 L 315.5 206.0 L 314.1 208.5 L 310.5 210.3 L 310.4 213.3 L 309.0 213.7 L 305.1 210.7 L 298.0 211.6 L 296.6 214.3 L 297.6 216.2 L 296.5 217.1 L 297.6 221.8 L 294.0 221.0 L 291.7 222.4 L 289.0 221.2 L 288.3 219.1 L 289.4 218.5 L 285.6 215.8 L 284.6 216.5 L 285.3 217.6 L 278.6 220.7 L 279.2 221.8 L 278.1 222.4 L 275.6 223.0 L 272.6 219.8 L 270.6 219.7 L 270.2 221.2 L 266.4 222.7 L 267.2 223.3 L 262.9 224.0 L 261.6 222.1 L 262.5 219.9 L 258.6 217.8 L 258.2 216.2 L 261.1 216.3 L 259.3 213.9 L 260.4 212.5 L 256.5 212.5 L 257.5 208.6 L 251.9 207.2 Z M 262.0 196.0 L 258.2 198.4 L 260.9 199.2 L 263.9 197.1 L 262.0 196.0 Z M 289.3 182.6 L 289.1 184.6 L 287.4 184.3 L 288.2 182.5 L 289.3 182.6 Z" },
    { zone: 5, d: "M 337.7 258.8 L 343.3 262.3 L 338.1 262.7 L 334.2 260.1 L 337.7 258.8 Z M 278.4 245.0 L 274.5 236.2 L 272.8 236.2 L 273.0 234.9 L 270.9 233.4 L 270.8 231.0 L 264.4 229.1 L 262.8 224.4 L 264.1 223.0 L 267.2 223.3 L 266.4 222.7 L 270.2 221.2 L 270.6 219.7 L 272.6 219.8 L 275.6 223.0 L 278.1 222.4 L 279.2 221.8 L 278.6 220.7 L 285.3 217.6 L 284.6 216.5 L 285.6 215.8 L 289.4 218.5 L 288.3 219.1 L 289.0 221.2 L 291.7 222.4 L 294.0 221.0 L 297.6 221.8 L 296.5 217.1 L 297.6 216.2 L 296.6 214.3 L 298.0 211.6 L 305.1 210.7 L 309.0 213.7 L 310.4 213.3 L 310.5 210.3 L 314.1 208.5 L 315.5 206.0 L 319.5 207.2 L 322.1 214.0 L 325.0 212.9 L 327.8 214.5 L 331.9 212.5 L 332.7 214.4 L 335.1 215.1 L 338.0 213.2 L 335.5 211.7 L 336.3 209.9 L 335.1 207.1 L 336.1 205.6 L 335.0 204.3 L 337.4 203.5 L 335.4 201.8 L 337.7 202.1 L 339.9 200.8 L 337.6 198.0 L 337.3 194.9 L 342.6 193.5 L 340.8 190.8 L 344.2 186.3 L 343.8 185.1 L 340.5 184.1 L 339.3 179.8 L 347.8 178.9 L 354.2 175.1 L 366.3 174.6 L 373.1 176.6 L 380.0 176.4 L 380.2 175.3 L 390.1 173.8 L 391.4 172.4 L 398.8 172.1 L 398.0 174.9 L 399.0 176.0 L 401.9 174.9 L 405.5 175.3 L 407.1 173.0 L 405.0 170.5 L 405.8 167.6 L 404.6 165.3 L 406.6 163.5 L 416.5 160.1 L 420.9 152.9 L 425.1 152.4 L 434.4 146.3 L 437.6 148.2 L 439.7 147.4 L 444.2 149.1 L 445.5 151.8 L 443.6 153.3 L 445.2 154.0 L 446.1 156.7 L 441.8 162.5 L 444.1 164.6 L 442.6 166.6 L 442.6 169.5 L 435.9 175.4 L 436.3 178.5 L 433.7 179.9 L 433.2 181.9 L 433.2 183.2 L 436.6 183.9 L 436.3 186.3 L 438.6 188.4 L 436.8 191.9 L 438.0 193.5 L 438.0 197.5 L 442.0 198.6 L 440.3 199.9 L 441.0 201.6 L 443.7 202.0 L 447.6 200.1 L 451.6 200.2 L 452.9 197.2 L 457.2 196.3 L 460.7 196.2 L 462.8 197.5 L 464.6 196.2 L 470.9 197.2 L 457.8 212.5 L 450.6 219.0 L 452.2 234.7 L 449.8 235.2 L 452.3 235.4 L 451.8 237.7 L 452.9 238.4 L 451.7 240.4 L 445.6 241.3 L 442.4 240.7 L 438.9 238.2 L 433.0 237.6 L 434.6 238.8 L 432.9 241.1 L 435.0 246.0 L 430.8 247.2 L 430.5 249.5 L 427.2 251.7 L 427.8 254.0 L 424.3 254.4 L 424.3 257.4 L 421.5 258.4 L 419.9 258.4 L 419.5 257.0 L 416.7 256.2 L 415.0 254.0 L 410.5 254.9 L 410.4 256.5 L 399.0 254.3 L 394.3 251.1 L 388.4 250.1 L 381.4 245.4 L 378.7 245.1 L 377.6 243.6 L 378.2 236.8 L 371.8 233.9 L 370.6 234.3 L 371.9 234.9 L 370.3 237.2 L 366.5 236.5 L 365.9 234.0 L 361.7 231.4 L 360.6 231.4 L 358.0 235.4 L 356.0 235.8 L 354.9 234.2 L 351.9 234.0 L 350.8 232.1 L 344.9 233.5 L 344.6 230.9 L 342.1 229.2 L 339.7 231.3 L 338.7 234.7 L 337.0 234.5 L 336.1 232.9 L 333.5 232.8 L 331.5 236.0 L 333.0 237.3 L 331.2 240.0 L 329.0 239.5 L 327.9 240.7 L 328.4 242.4 L 325.9 242.6 L 326.2 244.9 L 329.8 247.6 L 328.2 248.1 L 328.5 248.9 L 326.1 247.1 L 323.8 248.0 L 321.6 246.5 L 311.2 245.8 L 309.2 248.1 L 311.1 250.0 L 304.1 248.1 L 299.4 248.9 L 299.4 247.6 L 294.4 249.5 L 293.9 248.7 L 295.0 248.8 L 293.4 246.6 L 290.3 247.1 L 290.8 249.4 L 293.3 251.1 L 289.8 252.6 L 286.1 250.0 L 285.8 247.6 L 278.4 245.0 Z" },
    { zone: 6, d: "M 262.6 276.7 L 262.7 276.0 L 262.8 277.1 L 262.6 276.7 Z M 273.6 276.3 L 273.6 276.3 L 273.4 276.7 L 273.6 276.3 Z M 262.9 249.3 L 264.6 245.7 L 266.3 246.0 L 268.3 244.4 L 264.1 241.6 L 268.2 241.7 L 268.6 240.5 L 272.1 241.5 L 276.2 240.0 L 278.4 245.0 L 285.8 247.6 L 286.1 250.0 L 289.8 252.6 L 293.3 251.1 L 290.8 249.4 L 290.3 247.1 L 293.4 246.6 L 295.0 248.8 L 293.9 248.7 L 294.4 249.5 L 299.4 247.6 L 299.4 248.9 L 304.1 248.1 L 311.1 250.0 L 309.2 248.1 L 311.2 245.8 L 321.6 246.5 L 323.8 248.0 L 326.1 247.1 L 328.3 248.9 L 329.8 247.6 L 326.2 244.9 L 325.9 242.6 L 328.4 242.4 L 327.9 240.7 L 329.0 239.5 L 331.2 240.0 L 333.0 237.3 L 331.5 236.0 L 333.5 232.8 L 336.1 232.9 L 337.0 234.5 L 338.7 234.7 L 339.7 231.3 L 342.1 229.2 L 344.6 230.9 L 344.9 233.5 L 350.8 232.1 L 351.9 234.0 L 354.9 234.2 L 356.0 235.8 L 358.3 235.1 L 360.7 231.4 L 365.8 233.9 L 366.5 236.5 L 370.3 237.2 L 371.9 234.9 L 370.6 234.3 L 374.0 234.3 L 375.2 236.2 L 378.2 236.8 L 377.6 243.6 L 379.1 245.5 L 381.4 245.4 L 391.9 251.4 L 397.1 252.3 L 399.0 254.3 L 410.4 256.5 L 410.5 254.9 L 413.9 253.8 L 419.5 257.0 L 419.9 258.4 L 421.5 258.4 L 424.3 257.4 L 424.3 254.4 L 427.8 254.0 L 427.2 251.7 L 430.5 249.5 L 430.8 247.2 L 435.0 246.0 L 432.9 241.1 L 434.6 238.8 L 433.0 237.6 L 438.9 238.2 L 442.4 240.7 L 445.6 241.3 L 451.3 240.8 L 453.9 236.7 L 458.9 237.9 L 459.0 239.7 L 457.1 241.4 L 458.7 242.5 L 455.9 243.9 L 456.0 245.1 L 458.7 245.9 L 457.9 247.6 L 460.3 247.6 L 460.0 250.0 L 465.4 247.7 L 471.6 253.4 L 480.4 255.7 L 479.8 257.2 L 481.4 258.4 L 485.6 259.3 L 486.0 263.8 L 491.1 263.5 L 490.8 265.3 L 489.3 266.1 L 490.4 267.4 L 496.1 269.1 L 496.3 267.4 L 499.0 268.4 L 500.8 266.1 L 506.4 267.5 L 503.8 268.9 L 504.9 270.2 L 503.6 272.6 L 510.0 274.2 L 512.5 272.9 L 512.2 275.2 L 513.4 276.7 L 516.6 277.2 L 528.2 282.9 L 521.4 283.3 L 516.0 282.1 L 513.1 284.4 L 510.5 283.2 L 501.4 284.9 L 493.7 282.0 L 492.3 283.4 L 486.2 282.8 L 480.8 286.0 L 475.8 287.0 L 476.6 286.1 L 474.5 286.5 L 473.4 285.3 L 461.5 283.4 L 461.3 280.3 L 459.9 279.2 L 456.8 282.1 L 456.0 279.7 L 450.2 285.8 L 444.6 287.4 L 439.7 286.9 L 431.5 284.0 L 428.6 279.9 L 424.0 281.8 L 409.6 275.1 L 407.3 275.7 L 404.4 274.1 L 399.4 276.3 L 397.7 275.8 L 397.0 273.9 L 393.9 274.4 L 393.6 272.7 L 391.1 271.0 L 391.8 269.0 L 387.6 265.4 L 381.1 268.7 L 381.5 265.2 L 377.4 266.0 L 377.1 267.4 L 379.3 269.1 L 378.9 270.6 L 377.4 271.1 L 375.5 269.3 L 373.2 269.1 L 371.8 273.3 L 370.8 270.8 L 367.4 269.7 L 365.4 267.5 L 364.1 267.6 L 364.6 270.8 L 361.2 272.8 L 353.4 270.2 L 354.0 267.1 L 352.9 265.6 L 348.8 268.7 L 345.0 265.5 L 343.7 266.5 L 345.2 269.6 L 343.5 270.7 L 340.2 268.3 L 331.5 270.4 L 327.6 273.7 L 328.1 276.5 L 325.2 278.9 L 322.9 283.9 L 319.4 284.9 L 319.9 286.1 L 318.5 288.6 L 324.8 291.1 L 326.9 295.8 L 319.5 300.6 L 319.4 302.0 L 323.9 304.3 L 321.6 307.1 L 323.1 308.7 L 316.8 309.6 L 314.4 306.1 L 314.9 308.8 L 312.6 309.3 L 311.0 309.0 L 312.3 302.6 L 308.2 300.7 L 307.2 296.5 L 302.1 297.4 L 300.8 296.1 L 298.6 296.3 L 296.3 293.1 L 298.3 291.6 L 296.9 289.3 L 294.4 289.3 L 291.4 287.3 L 288.5 283.9 L 289.3 281.6 L 287.6 279.7 L 284.2 280.2 L 282.8 278.9 L 280.5 272.6 L 271.6 274.9 L 271.8 276.4 L 269.8 276.1 L 269.2 277.8 L 266.9 277.5 L 267.1 276.4 L 264.8 276.3 L 263.2 274.7 L 258.2 276.7 L 255.9 274.4 L 257.0 271.1 L 253.4 268.0 L 253.1 266.0 L 246.9 261.6 L 250.6 258.7 L 245.4 259.5 L 247.4 258.5 L 245.0 256.8 L 247.0 255.6 L 245.6 255.1 L 248.2 254.9 L 244.9 254.1 L 246.9 253.7 L 245.9 253.3 L 246.1 251.3 L 244.1 251.7 L 243.9 250.0 L 242.6 249.9 L 244.0 247.9 L 246.4 247.5 L 245.3 245.0 L 248.0 243.2 L 250.4 244.6 L 255.3 244.3 L 257.9 246.7 L 259.0 249.9 L 262.9 249.3 Z M 334.4 260.3 L 338.1 262.7 L 343.3 262.3 L 342.8 260.7 L 337.7 258.8 L 334.4 260.3 Z M 319.9 307.3 L 320.0 307.6 L 321.0 307.4 L 319.9 307.3 Z M 320.6 308.4 L 321.2 308.3 L 321.1 308.0 L 320.6 308.4 Z" },
    { zone: 7, d: "M 503.9 206.4 L 498.5 211.2 L 492.0 208.4 L 488.1 209.6 L 487.7 208.3 L 485.2 211.3 L 483.4 212.1 L 483.8 210.0 L 480.4 212.8 L 478.0 211.3 L 478.6 210.1 L 475.8 208.7 L 471.3 208.3 L 473.6 203.9 L 475.4 202.8 L 474.1 201.5 L 475.5 199.2 L 472.5 197.7 L 464.8 196.2 L 462.8 197.5 L 460.7 196.2 L 457.2 196.3 L 452.9 197.2 L 451.6 200.2 L 448.7 199.9 L 443.0 202.0 L 441.0 201.6 L 440.3 199.9 L 442.0 198.6 L 438.0 197.4 L 438.0 193.5 L 436.8 191.9 L 438.6 188.4 L 436.3 186.3 L 436.6 183.9 L 433.2 183.2 L 433.2 181.9 L 433.7 179.9 L 436.3 178.5 L 435.9 175.4 L 442.6 169.5 L 442.6 166.6 L 444.1 164.6 L 441.8 162.5 L 446.1 157.0 L 445.2 154.0 L 443.6 153.3 L 445.5 151.8 L 444.2 149.1 L 439.3 147.2 L 444.3 144.0 L 448.2 143.9 L 450.5 141.6 L 449.1 139.1 L 449.7 137.2 L 447.6 135.2 L 442.5 132.9 L 435.4 132.6 L 433.7 131.1 L 433.2 129.0 L 435.1 127.9 L 437.0 120.9 L 432.5 118.4 L 428.3 118.8 L 427.4 117.0 L 426.8 113.9 L 429.8 110.9 L 428.1 109.4 L 432.1 107.5 L 430.4 104.0 L 433.0 102.4 L 434.8 97.5 L 442.9 98.0 L 442.7 99.1 L 454.2 95.5 L 457.0 96.8 L 456.7 97.8 L 463.5 100.6 L 459.8 103.1 L 460.3 104.1 L 465.9 103.4 L 468.4 105.3 L 471.0 104.7 L 475.1 106.5 L 479.0 105.3 L 488.7 106.3 L 490.4 102.4 L 494.7 100.7 L 493.5 97.7 L 496.4 94.1 L 495.9 91.9 L 497.8 90.1 L 502.6 89.2 L 502.6 86.7 L 506.7 87.0 L 517.7 84.1 L 521.5 84.3 L 525.6 86.8 L 529.7 85.7 L 533.3 82.3 L 536.5 82.9 L 539.0 84.9 L 547.7 82.1 L 551.3 84.1 L 555.9 84.1 L 559.4 86.4 L 562.8 84.1 L 568.1 84.1 L 581.9 78.5 L 586.0 78.8 L 593.2 75.9 L 602.2 74.4 L 606.1 75.3 L 607.5 76.7 L 605.2 77.7 L 604.0 80.7 L 598.4 81.0 L 595.9 82.7 L 597.4 85.0 L 596.9 87.0 L 600.5 89.4 L 598.1 91.8 L 602.6 92.5 L 605.2 95.7 L 607.7 94.0 L 610.8 94.6 L 614.0 98.9 L 611.6 101.4 L 612.6 102.6 L 611.7 104.5 L 618.9 105.4 L 621.5 111.0 L 630.6 114.6 L 626.4 115.7 L 623.6 118.2 L 621.1 118.2 L 621.6 120.2 L 617.2 119.3 L 611.7 120.6 L 609.5 119.5 L 602.8 122.9 L 603.0 120.5 L 590.7 115.1 L 591.3 118.2 L 588.5 121.6 L 588.6 123.9 L 583.9 128.9 L 580.8 127.8 L 578.8 129.3 L 575.5 128.9 L 566.1 132.1 L 565.9 134.3 L 572.1 134.9 L 573.3 137.7 L 569.5 138.6 L 568.0 145.2 L 566.5 144.2 L 562.1 146.0 L 567.7 149.2 L 568.6 151.0 L 567.1 153.1 L 568.3 154.5 L 572.9 153.7 L 573.5 156.3 L 577.2 156.6 L 575.2 159.0 L 578.2 161.5 L 580.4 161.4 L 579.3 164.3 L 577.1 163.8 L 576.4 166.3 L 573.1 169.3 L 553.4 171.8 L 553.5 174.5 L 555.4 176.4 L 551.6 177.2 L 553.0 178.1 L 551.6 179.2 L 553.8 182.0 L 552.2 184.4 L 543.8 183.9 L 542.8 180.3 L 536.3 179.7 L 530.1 182.8 L 523.0 182.5 L 523.7 186.5 L 521.5 186.4 L 520.6 189.7 L 517.1 187.7 L 516.1 188.9 L 511.7 188.6 L 511.4 192.2 L 509.4 192.6 L 510.4 192.9 L 509.9 194.9 L 505.0 199.1 L 506.3 202.0 L 503.5 201.7 L 503.9 206.4 Z" },
    { zone: 8, d: "M 546.8 253.2 L 524.8 253.2 L 526.2 254.7 L 526.4 261.4 L 528.4 263.8 L 526.6 266.5 L 530.0 270.6 L 525.8 273.3 L 521.7 272.8 L 516.3 269.4 L 508.4 270.3 L 506.4 267.5 L 500.8 266.1 L 499.0 268.4 L 496.5 267.4 L 496.1 269.1 L 493.7 268.8 L 489.3 266.4 L 491.4 263.7 L 489.3 262.9 L 486.0 263.8 L 486.3 260.2 L 480.2 257.5 L 480.4 255.7 L 471.6 253.4 L 465.4 247.7 L 460.9 250.4 L 460.3 247.6 L 457.9 247.6 L 458.7 245.9 L 456.0 245.1 L 455.9 243.9 L 458.7 242.5 L 457.1 241.4 L 459.0 239.7 L 458.8 237.8 L 453.9 236.7 L 451.8 237.7 L 452.3 235.4 L 450.2 235.7 L 449.8 235.2 L 452.2 234.7 L 450.6 219.0 L 457.8 212.5 L 470.9 197.2 L 475.6 199.3 L 474.1 201.5 L 475.3 202.9 L 473.6 203.9 L 471.3 208.3 L 475.8 208.7 L 478.6 210.1 L 478.0 211.3 L 480.4 212.8 L 483.8 210.0 L 483.4 212.1 L 485.2 211.3 L 488.2 208.3 L 488.1 209.6 L 492.0 208.4 L 498.5 211.2 L 503.9 206.4 L 503.5 201.7 L 506.3 202.0 L 505.0 199.1 L 509.9 194.9 L 510.4 192.9 L 509.4 192.6 L 511.4 192.2 L 511.7 188.6 L 516.1 188.9 L 517.1 187.7 L 520.6 189.7 L 521.5 186.4 L 523.7 186.5 L 523.0 182.5 L 530.1 182.8 L 536.3 179.7 L 542.8 180.3 L 543.8 183.9 L 552.2 184.4 L 553.8 182.0 L 551.6 179.2 L 553.0 178.1 L 551.6 177.2 L 555.4 176.4 L 553.5 174.5 L 553.4 171.8 L 565.9 170.9 L 573.7 169.1 L 576.4 166.3 L 577.1 163.8 L 579.3 164.3 L 580.4 161.4 L 578.2 161.5 L 575.2 159.0 L 577.2 156.6 L 573.5 156.3 L 572.9 153.7 L 568.3 154.5 L 567.1 153.1 L 568.6 151.0 L 567.7 149.2 L 562.1 146.0 L 566.5 144.2 L 568.0 145.2 L 569.5 138.6 L 573.3 137.7 L 572.1 134.9 L 565.6 133.6 L 566.1 132.1 L 569.6 130.4 L 578.8 129.3 L 580.8 127.8 L 583.9 128.9 L 588.6 123.9 L 588.5 121.6 L 591.3 118.2 L 590.7 115.1 L 603.0 120.5 L 602.8 122.9 L 609.5 119.5 L 611.7 120.6 L 617.2 119.3 L 621.6 120.2 L 621.1 118.2 L 623.6 118.2 L 626.4 115.7 L 630.6 114.6 L 634.9 114.9 L 639.4 117.4 L 651.4 116.9 L 655.5 119.1 L 652.9 120.4 L 653.2 122.2 L 646.2 125.1 L 644.6 127.9 L 645.5 132.1 L 648.7 135.3 L 644.6 134.5 L 643.2 135.6 L 639.7 134.5 L 636.9 136.1 L 635.8 135.6 L 632.1 139.5 L 632.7 140.7 L 628.4 142.7 L 629.2 144.9 L 624.8 146.3 L 624.2 148.6 L 618.7 149.7 L 618.3 152.2 L 615.4 154.7 L 617.1 157.6 L 620.8 159.2 L 623.2 158.6 L 623.7 160.7 L 627.6 160.6 L 627.7 163.4 L 632.4 166.0 L 631.3 170.7 L 626.7 172.6 L 623.0 176.9 L 625.8 181.3 L 625.6 186.0 L 628.4 186.1 L 630.4 187.9 L 633.4 188.4 L 635.1 190.4 L 633.5 190.9 L 636.0 192.4 L 635.7 194.2 L 637.7 194.5 L 638.6 197.9 L 641.9 198.9 L 643.1 196.7 L 645.6 197.5 L 648.6 201.1 L 648.6 204.7 L 647.1 205.5 L 649.4 205.7 L 649.5 208.5 L 650.9 208.9 L 644.3 210.6 L 642.8 212.1 L 640.2 210.4 L 636.1 212.2 L 633.2 211.4 L 632.3 212.7 L 633.3 213.5 L 631.6 213.9 L 631.4 216.0 L 626.8 216.0 L 625.4 217.7 L 628.3 222.7 L 627.0 223.9 L 618.4 221.1 L 616.8 223.6 L 614.0 222.5 L 611.3 223.1 L 611.4 226.2 L 608.2 226.7 L 604.1 225.6 L 604.8 223.4 L 602.8 221.5 L 599.8 222.4 L 595.1 218.6 L 592.6 219.9 L 591.3 215.9 L 585.6 215.4 L 584.5 217.3 L 580.7 219.1 L 574.4 217.2 L 574.1 218.6 L 572.5 213.5 L 568.7 211.8 L 555.4 212.1 L 555.8 213.1 L 553.5 214.0 L 552.8 215.9 L 549.6 216.6 L 549.4 220.3 L 552.3 220.7 L 550.2 224.7 L 550.9 225.9 L 553.2 224.6 L 556.9 225.4 L 556.8 223.9 L 557.8 223.9 L 560.6 227.7 L 557.5 227.7 L 558.5 230.7 L 559.7 230.8 L 559.2 232.4 L 555.5 232.0 L 555.7 233.4 L 553.2 236.6 L 546.6 240.6 L 546.2 241.9 L 547.7 243.7 L 547.0 246.2 L 546.5 247.5 L 543.9 247.9 L 543.1 250.4 L 543.3 251.8 L 546.8 253.2 Z" },
    { zone: 9, d: "M 616.5 262.5 L 615.9 265.6 L 617.0 269.7 L 627.4 277.1 L 638.1 281.8 L 633.7 285.6 L 629.4 293.7 L 625.9 294.9 L 622.8 298.8 L 618.5 296.3 L 617.3 293.1 L 612.8 292.1 L 611.6 287.2 L 612.8 285.5 L 611.0 284.0 L 606.0 285.9 L 602.4 285.6 L 600.7 284.1 L 598.0 285.5 L 595.1 282.3 L 588.7 280.7 L 580.4 279.7 L 576.7 280.9 L 565.2 280.7 L 559.3 282.6 L 558.0 285.6 L 545.1 289.3 L 543.4 286.8 L 538.6 284.7 L 528.2 285.3 L 527.7 282.0 L 513.3 276.7 L 512.5 272.9 L 510.0 274.2 L 503.5 271.9 L 504.9 270.2 L 503.8 268.9 L 506.6 267.8 L 508.4 270.3 L 516.3 269.4 L 521.7 272.8 L 525.8 273.3 L 530.0 270.6 L 526.6 266.5 L 528.4 263.8 L 526.4 261.4 L 526.2 254.7 L 524.8 253.1 L 546.8 253.2 L 543.3 251.8 L 543.1 250.4 L 543.9 247.9 L 546.5 247.5 L 547.0 246.2 L 547.7 243.7 L 546.2 241.9 L 546.6 240.6 L 553.2 236.6 L 555.7 233.4 L 555.5 232.0 L 559.2 232.4 L 559.7 230.8 L 558.5 230.7 L 557.5 227.7 L 560.6 227.7 L 557.7 223.8 L 556.9 225.4 L 553.2 224.6 L 550.9 225.9 L 550.2 224.7 L 552.3 220.7 L 549.4 220.3 L 549.6 216.6 L 552.8 215.9 L 553.5 214.0 L 555.8 213.1 L 555.4 212.1 L 568.7 211.8 L 572.5 213.5 L 574.1 218.6 L 574.4 217.2 L 580.7 219.1 L 584.5 217.3 L 585.6 215.4 L 591.3 215.9 L 592.6 219.9 L 595.1 218.6 L 599.8 222.4 L 602.2 221.4 L 604.5 222.7 L 604.2 225.7 L 610.5 226.5 L 611.3 223.1 L 614.0 222.5 L 616.8 223.6 L 618.4 221.1 L 627.0 223.9 L 628.3 222.7 L 625.4 217.7 L 626.8 216.0 L 631.4 216.0 L 631.6 213.9 L 633.3 213.5 L 632.3 212.7 L 633.2 211.4 L 636.1 212.2 L 640.2 210.4 L 642.8 212.1 L 648.3 209.2 L 650.1 209.7 L 650.9 208.9 L 649.5 208.5 L 649.4 205.7 L 647.1 205.5 L 648.8 204.2 L 648.1 201.3 L 650.3 200.9 L 655.3 196.8 L 656.5 197.8 L 660.1 195.1 L 662.5 196.1 L 662.8 198.4 L 665.7 195.8 L 668.1 195.5 L 669.4 195.5 L 668.9 197.1 L 671.2 198.5 L 673.8 197.4 L 674.7 198.7 L 676.9 198.2 L 677.5 195.8 L 679.6 197.1 L 679.0 198.1 L 681.0 199.0 L 679.1 199.7 L 680.8 200.4 L 679.8 201.7 L 682.8 204.1 L 681.7 205.4 L 683.1 206.1 L 682.4 207.7 L 684.4 206.6 L 685.2 210.2 L 686.8 210.7 L 685.9 211.7 L 687.8 212.3 L 687.8 214.4 L 689.8 214.3 L 691.1 216.4 L 672.7 218.5 L 655.9 226.6 L 630.9 234.6 L 625.7 237.7 L 622.4 236.9 L 616.6 243.5 L 616.1 245.5 L 617.5 245.9 L 615.8 246.1 L 613.7 251.1 L 613.1 255.4 L 614.7 255.7 L 613.5 256.1 L 613.3 257.8 L 616.5 262.5 Z" },
    { zone: 10, d: "M 753.3 216.8 L 753.3 216.9 L 753.7 218.2 L 753.3 216.8 Z M 753.6 216.7 L 753.5 216.3 L 753.5 216.3 L 753.6 216.7 Z M 753.7 216.1 L 753.6 215.7 L 753.6 215.7 L 753.7 216.1 Z M 755.9 214.4 L 755.4 213.7 L 755.5 213.8 L 755.9 214.4 Z M 745.2 200.5 L 759.3 206.0 L 762.9 209.5 L 763.1 211.5 L 771.1 216.9 L 763.7 221.6 L 752.1 220.4 L 751.7 219.4 L 753.0 219.0 L 760.5 219.3 L 760.0 218.8 L 757.9 218.8 L 757.8 218.7 L 757.7 218.7 L 757.6 218.8 L 757.7 218.7 L 757.7 218.7 L 757.4 218.6 L 757.1 218.7 L 757.4 218.6 L 757.4 218.6 L 757.9 218.8 L 758.1 218.6 L 757.3 216.4 L 755.4 217.2 L 756.0 216.5 L 754.2 216.1 L 755.2 215.1 L 755.6 215.5 L 756.6 214.7 L 755.1 212.1 L 747.6 206.6 L 743.2 203.5 L 736.4 202.5 L 734.4 200.4 L 733.6 199.9 L 735.1 201.4 L 733.3 201.6 L 734.1 202.2 L 735.0 201.8 L 732.9 203.3 L 732.0 205.8 L 735.4 207.9 L 729.0 209.7 L 726.6 209.1 L 727.3 209.8 L 725.9 211.1 L 719.6 212.6 L 715.1 212.1 L 705.6 208.3 L 699.7 209.1 L 696.1 210.3 L 691.4 215.7 L 687.8 214.4 L 688.1 212.9 L 685.8 211.6 L 686.8 210.7 L 685.2 210.2 L 684.4 206.6 L 682.4 207.7 L 683.1 206.1 L 681.7 205.4 L 682.8 204.1 L 679.8 201.7 L 680.7 200.3 L 679.1 199.8 L 680.9 198.9 L 677.8 195.8 L 676.9 196.2 L 676.9 198.2 L 674.7 198.7 L 673.8 197.4 L 670.9 198.4 L 668.9 197.1 L 669.4 195.5 L 668.1 195.5 L 665.7 195.8 L 662.9 198.4 L 662.5 196.1 L 660.1 195.1 L 656.5 197.8 L 655.3 196.8 L 649.5 201.3 L 645.6 197.5 L 643.1 196.7 L 641.4 198.9 L 638.1 197.5 L 638.6 195.8 L 635.7 194.2 L 636.0 192.4 L 633.5 190.9 L 635.1 190.4 L 633.4 188.4 L 625.3 185.2 L 625.8 181.3 L 623.0 176.9 L 626.7 172.6 L 631.3 170.7 L 632.4 166.0 L 627.7 163.4 L 627.6 160.6 L 623.7 160.7 L 623.2 158.6 L 620.8 159.2 L 617.1 157.6 L 615.4 154.7 L 618.3 152.2 L 618.7 149.7 L 624.2 148.6 L 624.8 146.3 L 629.2 144.9 L 628.4 142.7 L 632.7 140.7 L 632.1 139.5 L 635.8 135.6 L 636.9 136.1 L 639.7 134.5 L 643.2 135.6 L 644.6 134.5 L 648.7 135.3 L 645.5 132.1 L 644.9 127.2 L 646.2 125.1 L 653.2 122.2 L 653.2 120.1 L 657.8 117.8 L 665.1 119.4 L 665.4 121.3 L 666.7 121.8 L 689.8 122.2 L 698.0 123.5 L 704.3 126.9 L 712.8 127.0 L 715.2 125.3 L 717.8 125.6 L 718.0 124.4 L 723.1 126.5 L 730.8 125.7 L 732.1 127.5 L 736.3 127.1 L 737.2 128.3 L 739.8 127.7 L 751.2 129.9 L 751.5 131.4 L 750.1 132.3 L 750.8 134.0 L 748.8 138.0 L 739.9 138.1 L 736.7 142.1 L 727.4 145.7 L 724.4 145.8 L 725.2 148.1 L 724.4 149.5 L 718.2 151.8 L 722.8 158.0 L 721.5 159.9 L 722.9 160.8 L 725.1 160.1 L 725.3 158.9 L 728.8 159.0 L 735.6 160.6 L 736.9 162.8 L 743.3 162.3 L 746.3 163.3 L 744.4 167.5 L 737.6 172.1 L 730.0 175.2 L 731.1 177.6 L 728.0 180.3 L 730.5 182.8 L 734.4 184.3 L 737.0 184.0 L 739.1 181.9 L 744.3 182.6 L 743.8 187.2 L 739.2 191.8 L 737.5 195.8 L 739.8 199.6 L 745.2 200.5 Z M 752.1 210.1 L 752.0 210.1 L 752.1 210.1 L 752.1 210.1 Z M 751.8 210.1 L 751.8 210.1 L 751.8 210.1 L 751.8 210.1 Z M 751.0 209.1 L 751.0 209.1 L 751.0 209.1 L 751.0 209.1 Z M 750.5 208.8 L 750.5 208.8 L 750.5 208.8 L 750.5 208.8 Z M 749.5 208.1 L 749.5 208.1 L 749.5 208.1 L 749.5 208.1 Z M 747.2 206.3 L 747.1 206.3 L 747.1 206.3 L 747.2 206.3 Z M 733.9 201.9 L 733.9 201.9 L 733.9 201.9 L 733.9 201.9 Z M 757.2 218.9 L 757.2 218.9 L 757.2 218.9 L 757.2 218.9 Z M 756.8 218.7 L 756.8 218.7 L 756.8 218.7 L 756.8 218.7 Z M 757.0 218.7 L 756.9 218.7 L 756.8 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 755.8 215.2 L 755.8 215.1 L 755.9 215.2 L 755.8 215.2 Z M 755.9 215.2 L 755.8 215.2 L 755.8 215.1 L 755.9 215.2 Z M 757.3 218.9 L 757.3 218.9 L 757.3 218.9 L 757.3 218.9 Z M 757.3 218.8 L 757.3 218.8 L 757.3 218.8 L 757.3 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.5 218.8 L 757.5 218.8 L 757.5 218.8 L 757.5 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.5 218.8 L 757.5 218.8 L 757.5 218.8 L 757.5 218.8 Z M 757.6 218.8 L 757.6 218.8 L 757.6 218.8 L 757.6 218.8 Z M 757.7 218.8 L 757.7 218.8 L 757.7 218.7 L 757.7 218.8 Z M 757.7 218.7 L 757.7 218.7 L 757.7 218.7 L 757.7 218.7 Z M 757.4 218.6 L 757.4 218.6 L 757.4 218.6 L 757.4 218.6 Z M 758.0 218.6 L 758.0 218.6 L 758.0 218.6 L 758.0 218.6 Z M 757.3 218.6 L 757.3 218.6 L 757.3 218.6 L 757.3 218.6 Z" },
    { zone: 11, d: "M 151.3 385.7 L 151.9 381.2 L 160.4 378.2 L 161.8 376.1 L 161.1 373.2 L 170.5 367.8 L 168.0 367.8 L 166.8 366.4 L 167.4 363.5 L 172.0 362.3 L 182.6 365.8 L 186.7 365.2 L 188.3 366.2 L 191.2 364.9 L 194.4 366.0 L 195.2 364.3 L 191.9 362.9 L 192.5 362.0 L 195.1 360.8 L 198.3 362.1 L 200.9 361.6 L 203.4 358.5 L 203.3 356.8 L 200.3 354.8 L 201.9 352.6 L 200.1 351.3 L 201.9 350.4 L 202.8 349.2 L 199.8 346.6 L 201.4 345.3 L 203.9 346.6 L 204.3 343.5 L 207.0 343.6 L 208.1 342.2 L 208.5 338.4 L 214.2 335.9 L 215.5 333.7 L 213.2 329.4 L 215.7 328.6 L 215.0 327.5 L 216.0 325.7 L 218.6 324.4 L 220.4 326.5 L 228.0 328.6 L 229.0 330.6 L 232.2 329.4 L 233.3 326.3 L 234.8 325.9 L 237.8 327.5 L 239.9 325.0 L 240.6 326.2 L 250.1 326.3 L 249.9 324.9 L 253.7 323.0 L 252.3 321.7 L 254.8 318.8 L 264.3 319.4 L 267.8 323.6 L 267.1 324.7 L 268.8 324.8 L 268.7 328.0 L 270.3 328.3 L 271.6 327.2 L 271.9 324.3 L 274.8 323.0 L 274.6 321.2 L 278.7 320.7 L 280.9 322.3 L 283.4 321.2 L 282.6 316.1 L 280.0 313.7 L 282.5 312.9 L 284.8 310.0 L 292.9 311.0 L 295.3 313.5 L 295.8 316.0 L 298.9 315.1 L 301.6 316.5 L 302.3 319.2 L 304.9 320.0 L 310.9 318.1 L 311.4 316.0 L 315.4 315.5 L 316.5 316.4 L 315.5 317.5 L 318.8 317.8 L 320.8 316.7 L 324.9 319.6 L 328.6 319.7 L 331.0 317.4 L 332.6 318.2 L 332.7 319.9 L 338.7 321.1 L 340.7 324.3 L 339.9 328.9 L 337.2 329.0 L 334.2 335.1 L 337.6 334.6 L 338.2 336.0 L 339.6 334.6 L 350.0 333.4 L 355.4 335.8 L 357.3 340.4 L 360.4 340.2 L 362.6 343.9 L 364.9 344.5 L 366.1 346.3 L 374.6 349.6 L 375.1 353.1 L 376.9 354.1 L 375.1 357.1 L 375.8 358.3 L 380.1 355.5 L 382.6 356.8 L 378.6 359.7 L 386.5 359.7 L 386.7 362.4 L 388.6 364.5 L 387.4 366.3 L 388.4 366.9 L 391.1 364.3 L 395.9 366.8 L 390.8 371.6 L 388.4 371.0 L 386.8 372.5 L 379.9 368.0 L 377.4 368.1 L 374.6 365.2 L 374.3 365.2 L 374.3 365.3 L 374.2 365.2 L 374.0 365.8 L 372.9 365.3 L 371.9 366.0 L 371.6 366.6 L 370.6 366.0 L 374.1 370.0 L 372.7 371.1 L 365.3 367.1 L 363.6 367.0 L 362.2 365.0 L 356.6 362.0 L 353.5 362.9 L 350.7 359.3 L 347.0 358.2 L 339.1 352.6 L 334.9 352.7 L 332.8 350.8 L 330.8 351.1 L 328.2 347.6 L 314.3 342.0 L 312.3 343.4 L 312.7 346.8 L 306.3 345.0 L 306.6 342.0 L 305.1 340.7 L 286.8 337.8 L 284.8 337.3 L 284.1 335.6 L 282.9 335.8 L 283.3 337.1 L 274.1 335.5 L 277.1 335.1 L 275.5 334.6 L 266.5 334.3 L 243.6 343.9 L 241.3 345.7 L 241.3 345.9 L 241.4 346.0 L 242.7 345.1 L 242.0 346.0 L 237.9 347.9 L 236.9 349.6 L 238.5 350.8 L 234.5 354.4 L 235.4 356.9 L 220.2 362.4 L 216.5 367.0 L 216.0 371.7 L 209.9 376.7 L 209.5 378.5 L 210.9 380.4 L 207.6 381.2 L 200.9 386.6 L 177.7 393.9 L 174.9 393.2 L 168.5 395.9 L 164.7 395.6 L 162.1 397.8 L 152.5 396.2 L 150.6 397.4 L 148.1 397.0 L 144.7 390.0 L 146.7 387.3 L 151.3 385.7 Z M 215.9 373.7 L 216.0 373.3 L 216.3 373.5 L 215.9 373.7 Z M 237.3 353.2 L 237.3 353.0 L 237.4 353.1 L 237.3 353.2 Z M 241.3 345.9 L 241.3 345.9 L 241.4 345.9 L 241.3 345.9 Z M 282.7 337.2 L 279.4 336.6 L 283.4 337.3 L 282.7 337.2 Z M 273.6 335.6 L 278.8 336.6 L 278.8 336.6 L 273.6 335.6 Z M 269.0 335.4 L 271.5 335.8 L 272.5 334.9 L 273.0 334.8 L 269.0 335.4 Z M 275.0 334.9 L 275.0 334.9 L 275.0 334.9 L 275.0 334.9 Z M 274.8 334.8 L 274.8 334.9 L 274.8 334.9 L 274.8 334.8 Z M 374.5 373.7 L 374.5 373.6 L 374.5 373.6 L 374.5 373.7 Z M 374.6 373.5 L 374.2 373.1 L 374.8 373.4 L 374.6 373.5 Z M 374.1 372.7 L 372.8 371.3 L 374.9 371.0 L 374.1 372.7 Z M 366.9 368.4 L 367.0 368.4 L 367.0 368.4 L 366.9 368.4 Z M 372.0 366.0 L 372.0 366.0 L 372.0 366.0 L 372.0 366.0 Z M 372.5 365.6 L 372.5 365.6 L 372.5 365.6 L 372.5 365.6 Z M 374.7 365.6 L 374.8 365.6 L 374.7 365.6 L 374.7 365.6 Z M 374.2 365.3 L 374.3 365.3 L 374.2 365.3 L 374.2 365.3 Z M 374.4 365.3 L 374.4 365.3 L 374.4 365.3 L 374.4 365.3 Z M 374.2 365.3 L 374.2 365.2 L 374.2 365.3 L 374.2 365.3 Z M 374.4 365.3 L 374.4 365.2 L 374.4 365.3 L 374.4 365.3 Z" },
    { zone: 12, d: "M 436.0 357.5 L 435.9 357.4 L 436.0 357.4 L 436.0 357.5 Z M 516.9 295.3 L 510.5 302.0 L 513.2 302.8 L 511.2 306.1 L 513.4 307.1 L 521.6 300.5 L 523.9 299.9 L 544.3 306.6 L 552.3 314.3 L 557.1 313.9 L 557.5 312.2 L 564.7 314.6 L 563.2 318.9 L 559.3 319.4 L 563.6 320.8 L 562.5 326.9 L 561.0 326.2 L 559.7 327.4 L 564.2 328.6 L 562.6 330.4 L 564.5 331.0 L 562.7 333.4 L 567.2 335.2 L 568.5 334.7 L 568.1 335.7 L 562.1 343.2 L 558.0 346.1 L 554.4 347.8 L 554.6 345.8 L 552.2 345.2 L 551.4 348.8 L 549.0 349.3 L 547.7 351.8 L 540.7 354.2 L 540.1 356.0 L 541.3 357.9 L 538.8 357.4 L 537.5 360.8 L 530.2 356.5 L 530.6 354.5 L 527.6 352.6 L 523.7 356.5 L 520.0 355.9 L 513.9 360.8 L 505.6 361.2 L 507.8 363.3 L 511.9 364.7 L 512.3 365.8 L 510.7 366.4 L 502.1 365.0 L 495.3 367.2 L 491.4 367.2 L 486.7 365.1 L 488.0 363.8 L 487.2 362.5 L 478.4 369.9 L 476.7 369.6 L 477.3 368.2 L 476.0 366.9 L 471.8 366.4 L 461.6 360.7 L 451.5 360.4 L 449.8 362.2 L 449.9 364.2 L 446.5 364.6 L 440.2 360.7 L 440.0 358.9 L 436.3 356.0 L 437.1 354.8 L 436.3 354.2 L 431.0 353.8 L 425.2 349.7 L 419.0 348.2 L 413.8 349.8 L 403.3 341.6 L 398.6 342.2 L 390.0 338.0 L 388.0 336.5 L 389.4 333.3 L 386.7 332.3 L 386.1 330.7 L 371.4 330.5 L 371.1 331.9 L 365.3 336.3 L 365.6 337.9 L 357.3 340.4 L 355.4 335.8 L 350.1 333.4 L 339.6 334.6 L 338.2 336.0 L 337.6 334.6 L 334.7 335.3 L 337.2 329.0 L 339.9 328.9 L 340.7 324.3 L 339.1 322.8 L 339.3 321.4 L 332.7 319.9 L 332.6 318.2 L 331.0 317.4 L 328.6 319.7 L 324.9 319.6 L 320.8 316.7 L 318.8 317.8 L 315.5 317.5 L 316.0 315.9 L 311.3 316.1 L 310.9 314.1 L 311.0 309.1 L 314.6 309.1 L 314.4 306.1 L 316.8 309.6 L 323.2 308.5 L 321.6 307.1 L 323.9 304.3 L 319.4 302.0 L 319.5 300.6 L 326.9 295.8 L 324.8 291.1 L 318.5 288.6 L 319.9 286.1 L 319.4 284.9 L 322.9 283.9 L 325.2 278.9 L 328.1 276.5 L 327.6 273.7 L 331.5 270.4 L 340.2 268.3 L 343.5 270.7 L 345.2 269.6 L 343.7 266.5 L 345.0 265.5 L 348.8 268.7 L 352.9 265.6 L 354.0 267.1 L 353.4 270.2 L 361.2 272.8 L 364.6 270.8 L 364.1 267.6 L 365.4 267.5 L 367.4 269.7 L 370.8 270.8 L 371.8 273.3 L 373.2 269.1 L 375.5 269.3 L 377.4 271.1 L 378.9 270.6 L 379.3 269.1 L 377.1 267.4 L 377.4 266.0 L 381.5 265.2 L 381.1 268.7 L 387.6 265.4 L 391.8 269.0 L 391.1 271.0 L 393.6 272.7 L 393.9 274.4 L 397.0 273.9 L 397.7 275.8 L 399.4 276.3 L 404.4 274.1 L 407.3 275.7 L 409.6 275.1 L 424.0 281.8 L 428.6 279.9 L 431.5 284.0 L 439.7 286.9 L 444.6 287.4 L 450.2 285.8 L 456.0 279.7 L 456.8 282.1 L 459.9 279.2 L 461.3 280.3 L 461.5 283.4 L 473.4 285.3 L 474.5 286.5 L 476.6 286.1 L 475.8 287.0 L 480.8 286.0 L 486.3 282.8 L 492.3 283.4 L 493.7 282.0 L 501.4 284.9 L 510.5 283.2 L 511.9 285.0 L 509.4 287.6 L 519.8 290.9 L 522.5 293.8 L 516.9 295.3 Z M 321.0 308.4 L 321.1 308.0 L 321.2 308.1 L 321.0 308.4 Z M 319.9 307.3 L 321.0 307.4 L 319.7 307.6 L 319.9 307.3 Z" },
    { zone: 13, d: "M 622.4 355.3 L 651.2 377.2 L 657.6 379.4 L 655.1 383.4 L 655.1 389.3 L 650.6 390.3 L 649.7 393.2 L 644.9 393.4 L 643.6 392.2 L 644.4 391.3 L 641.5 389.1 L 641.6 387.1 L 636.9 389.2 L 634.6 387.6 L 632.8 388.3 L 631.6 386.3 L 634.4 381.7 L 633.8 376.8 L 626.7 380.2 L 623.5 380.3 L 624.6 382.7 L 623.9 385.4 L 627.3 385.2 L 629.3 386.6 L 627.5 388.6 L 623.1 388.4 L 622.5 393.4 L 618.2 395.5 L 614.9 394.9 L 611.8 396.0 L 611.7 398.9 L 608.1 400.2 L 604.5 399.7 L 603.0 402.1 L 600.0 399.1 L 591.6 401.3 L 589.1 399.6 L 582.8 399.2 L 579.4 397.8 L 579.0 396.4 L 576.1 396.1 L 575.3 394.2 L 568.6 394.7 L 563.2 390.9 L 555.8 387.9 L 556.5 383.6 L 553.3 382.3 L 553.9 380.2 L 549.5 377.0 L 551.3 375.4 L 550.6 374.3 L 554.3 372.5 L 559.9 364.1 L 552.7 364.0 L 550.2 366.1 L 546.6 364.4 L 543.6 365.0 L 546.7 362.0 L 546.6 360.5 L 541.7 359.7 L 539.7 361.1 L 537.7 360.6 L 538.8 357.4 L 541.3 357.9 L 540.1 356.0 L 540.7 354.2 L 547.7 351.8 L 549.0 349.3 L 551.4 348.8 L 552.2 345.2 L 554.6 345.8 L 554.4 347.8 L 558.0 346.1 L 562.1 343.2 L 568.1 335.7 L 568.5 334.7 L 567.2 335.2 L 562.7 333.4 L 564.5 331.0 L 562.6 330.4 L 564.2 328.6 L 559.7 327.4 L 561.0 326.2 L 562.5 326.9 L 563.6 320.8 L 559.3 319.4 L 563.2 318.9 L 563.1 316.9 L 565.2 315.1 L 562.3 313.2 L 557.5 312.2 L 557.1 313.9 L 552.3 314.3 L 544.3 306.6 L 523.9 299.9 L 521.6 300.5 L 513.4 307.1 L 511.2 306.1 L 513.2 302.8 L 510.5 302.0 L 516.9 295.3 L 522.5 293.8 L 519.8 290.9 L 509.4 287.6 L 511.9 285.0 L 510.5 283.2 L 513.1 284.4 L 516.2 282.1 L 528.1 283.1 L 528.4 285.4 L 538.6 284.7 L 543.6 286.9 L 544.4 289.1 L 546.7 289.4 L 552.0 286.7 L 558.1 285.5 L 559.3 282.6 L 565.2 280.7 L 576.7 280.9 L 580.4 279.7 L 588.7 280.7 L 595.1 282.3 L 598.0 285.5 L 600.7 284.1 L 602.4 285.6 L 606.0 285.9 L 609.1 284.0 L 611.6 284.2 L 612.8 285.5 L 611.6 287.2 L 612.8 292.1 L 617.3 293.1 L 618.7 296.5 L 622.9 298.6 L 620.7 299.5 L 616.1 299.2 L 614.8 298.8 L 621.9 298.9 L 614.2 293.8 L 612.1 293.8 L 609.2 296.5 L 610.0 297.5 L 612.0 296.3 L 608.3 301.6 L 607.5 308.6 L 611.5 318.1 L 612.3 330.8 L 619.9 351.6 L 622.4 355.3 Z M 601.1 394.5 L 602.2 398.0 L 607.2 396.7 L 606.5 394.6 L 601.1 394.5 Z" },
    { zone: 14, d: "M 506.9 366.3 L 512.3 365.8 L 505.6 361.2 L 513.9 360.8 L 520.0 355.9 L 523.7 356.5 L 527.6 352.6 L 530.6 354.5 L 530.2 356.5 L 536.9 360.6 L 539.6 361.1 L 541.7 359.7 L 546.6 360.5 L 546.7 362.0 L 543.6 365.0 L 546.6 364.4 L 550.2 366.1 L 552.7 364.0 L 559.5 363.8 L 558.4 367.4 L 553.0 373.9 L 550.6 374.3 L 551.3 375.4 L 549.5 377.0 L 553.9 380.2 L 553.3 382.3 L 556.5 383.6 L 555.9 387.9 L 550.9 388.5 L 550.2 391.4 L 548.0 390.9 L 547.8 393.4 L 545.5 394.5 L 545.4 396.7 L 542.3 401.9 L 546.0 406.6 L 539.1 409.0 L 540.1 410.4 L 533.7 412.4 L 537.2 416.9 L 531.8 416.3 L 530.0 418.3 L 524.2 420.1 L 523.5 421.6 L 516.5 423.0 L 512.8 420.3 L 513.1 421.8 L 510.7 424.7 L 506.8 426.6 L 503.6 425.7 L 505.4 423.3 L 504.4 422.5 L 500.4 426.7 L 498.3 427.1 L 497.4 424.9 L 489.9 420.2 L 483.2 423.4 L 481.8 429.5 L 477.8 428.0 L 473.8 428.6 L 472.0 426.9 L 472.5 425.3 L 470.8 425.1 L 471.6 423.8 L 469.5 421.3 L 471.8 418.6 L 470.0 417.9 L 471.0 416.1 L 469.2 413.6 L 471.9 412.5 L 474.3 413.6 L 475.6 411.1 L 477.9 411.1 L 480.1 409.3 L 478.3 408.8 L 474.6 403.3 L 466.8 404.7 L 465.0 401.6 L 461.0 400.0 L 456.1 395.1 L 453.0 395.1 L 449.7 399.7 L 443.0 400.4 L 433.2 398.8 L 431.8 396.7 L 433.1 395.0 L 430.5 392.1 L 426.1 394.2 L 419.0 392.6 L 414.2 393.9 L 412.2 388.4 L 406.7 381.6 L 397.6 374.6 L 390.8 371.6 L 395.8 366.4 L 391.1 364.3 L 388.4 366.9 L 387.4 366.3 L 388.6 364.5 L 386.7 362.4 L 386.5 359.7 L 378.6 359.7 L 382.6 356.8 L 380.0 355.5 L 375.8 358.3 L 375.1 357.1 L 376.9 354.1 L 375.1 353.1 L 374.6 349.6 L 366.1 346.3 L 364.9 344.5 L 362.6 343.9 L 360.8 340.5 L 358.5 340.3 L 365.6 337.9 L 365.3 336.3 L 371.1 331.9 L 371.4 330.5 L 384.5 330.3 L 387.1 332.6 L 389.1 332.7 L 389.7 334.0 L 388.0 336.5 L 390.0 338.0 L 398.6 342.2 L 403.3 341.6 L 413.8 349.8 L 419.0 348.2 L 425.2 349.7 L 431.0 353.8 L 436.3 354.2 L 437.1 354.8 L 436.3 356.0 L 440.0 358.9 L 440.2 360.7 L 446.9 364.7 L 449.9 364.2 L 449.8 362.2 L 451.8 360.3 L 462.6 360.9 L 471.8 366.4 L 476.0 366.9 L 477.8 369.9 L 487.2 362.5 L 488.0 363.8 L 486.7 365.1 L 491.4 367.2 L 495.3 367.2 L 502.1 365.0 L 506.9 366.3 Z M 435.9 357.5 L 436.0 357.4 L 435.9 357.5 L 435.9 357.5 Z" },
    { zone: 15, d: "M 417.6 540.1 L 418.1 536.9 L 421.0 537.7 L 421.2 539.6 L 417.6 540.1 Z M 395.2 536.1 L 395.3 536.0 L 395.3 536.1 L 395.2 536.1 Z M 399.4 514.2 L 399.4 514.0 L 399.5 514.1 L 399.4 514.2 Z M 398.9 514.8 L 393.4 514.3 L 396.2 513.4 L 396.8 510.6 L 398.9 514.8 Z M 396.8 510.4 L 396.8 510.3 L 396.8 510.4 L 396.8 510.4 Z M 424.2 501.5 L 424.2 501.4 L 424.3 501.5 L 424.2 501.5 Z M 424.2 501.4 L 424.2 501.4 L 424.2 501.4 L 424.2 501.4 Z M 420.1 499.4 L 420.2 499.4 L 420.2 499.4 L 420.1 499.4 Z M 416.6 499.3 L 412.0 498.3 L 412.1 500.2 L 402.6 499.6 L 399.3 496.6 L 399.1 494.3 L 402.7 492.1 L 407.1 491.8 L 412.6 494.2 L 415.3 492.7 L 415.9 491.2 L 414.4 490.3 L 414.7 490.1 L 421.6 491.4 L 420.0 492.5 L 422.7 493.3 L 428.8 486.0 L 432.3 488.4 L 430.8 491.4 L 431.4 495.4 L 426.6 497.0 L 431.2 499.3 L 430.4 501.9 L 429.1 501.2 L 426.3 501.3 L 422.6 496.5 L 420.0 496.9 L 420.2 499.2 L 419.1 497.0 L 416.6 499.3 Z M 421.3 490.2 L 421.3 490.2 L 421.2 490.3 L 421.3 490.2 Z M 369.2 470.4 L 369.2 470.3 L 369.3 470.4 L 369.2 470.4 Z M 372.0 466.4 L 373.6 470.6 L 370.8 473.1 L 369.6 472.8 L 368.7 471.2 L 369.1 471.0 L 369.4 470.0 L 369.5 468.2 L 372.0 466.4 Z M 379.4 430.6 L 379.3 432.5 L 378.1 432.0 L 379.4 430.6 Z M 410.4 420.0 L 410.4 420.1 L 410.4 420.0 L 410.4 420.0 Z M 475.0 536.9 L 475.1 536.9 L 475.1 537.0 L 475.0 536.9 Z M 475.3 514.9 L 474.7 514.7 L 474.7 514.6 L 475.3 514.9 Z M 429.3 501.8 L 429.3 501.8 L 429.3 501.8 L 429.3 501.8 Z M 428.6 501.5 L 428.6 501.4 L 428.7 501.4 L 428.6 501.5 Z M 425.4 501.2 L 425.4 501.2 L 425.4 501.2 L 425.4 501.2 Z M 425.3 501.1 L 425.4 501.0 L 425.4 501.1 L 425.3 501.1 Z M 425.4 501.0 L 425.6 500.9 L 425.6 501.0 L 425.4 501.0 Z M 458.5 493.3 L 458.4 493.1 L 458.6 493.2 L 458.5 493.3 Z M 442.5 487.5 L 442.5 487.1 L 442.6 487.1 L 442.5 487.5 Z M 435.1 486.5 L 435.5 486.6 L 435.2 486.8 L 435.1 486.5 Z M 435.3 486.3 L 435.4 486.4 L 435.3 486.3 L 435.3 486.3 Z M 430.3 486.1 L 430.3 486.0 L 430.4 486.1 L 430.3 486.1 Z M 457.1 478.9 L 445.6 478.0 L 442.7 478.7 L 442.0 481.2 L 437.3 480.1 L 436.1 474.6 L 439.3 473.6 L 438.8 472.3 L 441.4 465.1 L 440.5 450.7 L 437.9 445.1 L 433.4 441.4 L 430.5 434.6 L 426.2 429.6 L 421.2 427.3 L 417.8 420.7 L 418.7 420.0 L 417.7 419.6 L 419.9 417.5 L 420.2 416.5 L 417.9 418.7 L 414.2 394.0 L 419.0 392.6 L 426.1 394.2 L 430.5 392.1 L 433.1 395.0 L 431.8 396.7 L 433.2 398.8 L 443.0 400.4 L 449.7 399.7 L 453.0 395.1 L 456.1 395.1 L 461.0 400.0 L 465.0 401.6 L 466.8 404.7 L 474.6 403.3 L 478.3 408.8 L 480.1 409.3 L 477.9 411.1 L 475.6 411.1 L 474.3 413.6 L 471.9 412.5 L 469.5 413.0 L 471.0 416.1 L 470.0 417.9 L 471.8 418.6 L 469.5 421.3 L 471.6 423.8 L 470.8 425.1 L 472.5 425.3 L 472.0 426.9 L 473.8 428.6 L 477.8 428.0 L 481.8 429.5 L 483.2 423.4 L 489.9 420.2 L 497.4 424.9 L 498.3 427.1 L 500.4 426.7 L 504.4 422.5 L 505.4 423.3 L 503.6 425.7 L 506.8 426.6 L 510.7 424.7 L 513.1 421.8 L 512.8 420.3 L 516.5 423.0 L 523.5 421.6 L 524.2 420.1 L 530.0 418.3 L 531.8 416.3 L 537.2 416.9 L 533.7 412.4 L 540.1 410.4 L 539.1 409.0 L 546.0 406.6 L 542.3 402.0 L 543.8 400.3 L 543.3 398.8 L 545.4 396.7 L 545.5 394.5 L 547.8 393.4 L 547.9 391.0 L 550.2 391.4 L 549.9 389.6 L 551.9 388.0 L 556.6 388.0 L 568.6 394.7 L 575.3 394.2 L 576.1 396.1 L 579.0 396.4 L 579.5 397.8 L 589.2 399.7 L 590.9 401.2 L 600.0 399.1 L 603.0 402.1 L 604.5 399.7 L 608.1 400.2 L 611.7 398.9 L 616.0 400.2 L 620.3 404.1 L 618.9 405.0 L 616.3 404.4 L 616.8 407.4 L 614.9 407.4 L 614.1 402.3 L 613.1 406.6 L 608.0 407.0 L 608.4 408.3 L 606.8 409.6 L 602.2 410.8 L 604.9 413.9 L 599.9 418.7 L 599.0 421.9 L 594.1 421.8 L 592.9 423.6 L 593.3 424.8 L 598.2 426.7 L 598.0 427.6 L 586.5 433.0 L 587.3 434.5 L 591.6 434.3 L 591.6 437.8 L 594.1 437.2 L 596.2 438.6 L 597.3 440.2 L 597.0 444.9 L 601.3 446.0 L 603.0 443.0 L 605.9 444.6 L 593.1 450.5 L 588.8 448.8 L 587.4 449.4 L 587.9 451.2 L 586.4 455.1 L 576.8 458.9 L 575.5 461.0 L 577.3 464.5 L 576.6 466.2 L 578.2 468.3 L 579.8 466.8 L 582.4 468.5 L 577.5 482.4 L 580.0 484.1 L 580.0 486.1 L 577.1 486.2 L 573.8 489.7 L 569.5 489.2 L 566.0 490.7 L 565.2 493.5 L 562.2 491.0 L 560.0 492.8 L 559.3 494.4 L 562.6 497.1 L 566.4 498.3 L 564.7 502.0 L 562.7 502.2 L 563.1 505.5 L 565.5 507.3 L 562.7 509.1 L 559.7 508.6 L 558.3 511.9 L 555.9 511.4 L 552.9 513.0 L 553.0 514.3 L 549.3 515.8 L 543.0 515.8 L 543.5 518.1 L 541.3 520.6 L 546.6 523.4 L 546.8 528.5 L 534.2 528.2 L 530.4 532.6 L 530.4 534.2 L 510.2 530.2 L 507.0 531.2 L 507.3 533.1 L 505.3 534.0 L 505.1 535.6 L 501.4 535.8 L 500.4 534.2 L 496.1 532.7 L 495.3 529.5 L 496.8 527.4 L 498.5 528.6 L 500.3 528.7 L 503.5 527.5 L 505.3 522.2 L 503.8 518.2 L 501.8 516.1 L 499.5 517.1 L 498.5 516.3 L 496.5 512.4 L 494.6 511.2 L 494.9 509.9 L 487.5 506.7 L 484.8 501.5 L 481.8 499.2 L 474.0 496.5 L 465.5 495.4 L 460.6 492.9 L 463.7 491.3 L 464.7 488.7 L 464.0 486.2 L 465.7 484.3 L 463.5 481.7 L 457.1 478.9 Z M 498.0 546.5 L 496.6 546.6 L 497.3 547.8 L 495.4 546.3 L 497.2 545.3 L 498.0 546.5 Z M 477.4 533.8 L 479.8 538.1 L 478.8 539.9 L 475.1 536.7 L 473.6 536.5 L 473.3 535.7 L 475.0 535.2 L 474.9 533.1 L 477.4 533.8 Z M 479.6 536.3 L 479.6 536.3 L 479.7 536.3 L 479.6 536.3 Z M 499.3 534.3 L 499.3 534.1 L 499.3 534.1 L 499.3 534.3 Z M 507.3 534.1 L 507.2 533.7 L 507.4 534.0 L 507.3 534.1 Z M 494.5 530.3 L 494.5 530.2 L 494.6 530.2 L 494.5 530.3 Z M 500.0 528.6 L 500.0 528.6 L 500.0 528.6 L 500.0 528.6 Z M 476.8 516.8 L 476.9 516.7 L 476.9 516.8 L 476.8 516.8 Z M 476.3 516.0 L 476.2 516.0 L 476.2 515.9 L 476.3 516.0 Z M 605.3 414.6 L 605.3 414.6 L 605.3 414.6 L 605.3 414.6 Z M 602.1 397.9 L 601.2 394.5 L 607.3 395.4 L 607.2 396.7 L 602.1 397.9 Z" },
    { zone: 16, d: "M 670.8 511.2 L 669.9 512.3 L 671.1 516.1 L 663.8 519.0 L 659.5 519.2 L 659.5 521.0 L 653.4 522.2 L 656.4 525.1 L 649.9 527.9 L 647.4 527.8 L 646.6 525.4 L 644.6 525.3 L 643.2 531.7 L 635.4 535.5 L 633.9 531.7 L 628.1 532.4 L 629.3 529.2 L 624.4 529.5 L 624.4 526.6 L 626.0 526.4 L 624.3 525.4 L 625.2 523.0 L 622.3 522.4 L 618.3 524.8 L 615.8 522.8 L 614.7 523.4 L 612.4 523.1 L 614.0 522.5 L 610.9 521.4 L 612.4 520.4 L 610.1 519.0 L 611.2 518.2 L 610.9 516.4 L 607.3 515.2 L 608.2 512.8 L 606.4 511.4 L 607.8 509.7 L 604.0 506.6 L 599.8 505.0 L 596.2 507.7 L 594.5 506.2 L 587.0 508.3 L 584.8 506.4 L 578.3 504.4 L 579.1 503.1 L 576.9 502.4 L 577.2 501.5 L 581.0 499.4 L 582.1 496.5 L 577.0 494.9 L 573.5 488.8 L 577.1 486.2 L 580.0 486.1 L 580.0 484.1 L 577.5 482.4 L 582.4 468.6 L 579.9 466.8 L 577.8 468.0 L 575.5 461.0 L 577.6 458.3 L 586.4 455.1 L 587.9 451.2 L 587.4 449.4 L 588.8 448.8 L 593.1 450.5 L 605.9 444.6 L 603.0 443.0 L 601.3 446.0 L 597.0 444.9 L 597.3 440.2 L 595.9 438.2 L 594.1 437.2 L 591.4 437.7 L 591.1 434.0 L 587.1 434.4 L 587.2 432.2 L 589.7 430.7 L 592.0 431.2 L 594.2 428.6 L 598.0 427.6 L 597.8 426.4 L 593.0 424.6 L 594.1 421.8 L 599.0 421.9 L 599.9 418.7 L 604.9 413.9 L 606.0 415.6 L 613.3 416.4 L 618.9 413.3 L 620.3 413.9 L 619.3 415.3 L 620.5 416.5 L 617.6 419.6 L 614.6 420.4 L 616.6 422.4 L 619.8 421.4 L 622.6 423.9 L 624.8 421.3 L 626.7 421.0 L 628.9 423.1 L 630.9 422.0 L 632.8 422.6 L 644.5 432.9 L 648.7 430.9 L 653.2 432.1 L 655.8 428.3 L 659.5 429.1 L 658.7 431.8 L 660.1 433.1 L 656.9 435.4 L 657.1 436.5 L 662.0 441.8 L 662.2 444.7 L 661.0 445.9 L 664.5 447.5 L 665.7 452.3 L 668.5 453.4 L 668.2 457.3 L 665.0 459.3 L 666.3 461.6 L 670.0 461.7 L 671.6 464.4 L 670.9 467.7 L 672.5 470.0 L 670.7 472.5 L 672.6 474.9 L 671.4 476.9 L 676.5 479.2 L 676.7 480.3 L 679.3 480.7 L 678.5 483.2 L 679.3 486.2 L 680.6 486.1 L 681.7 482.4 L 684.0 483.0 L 686.9 481.3 L 692.5 484.3 L 697.3 489.9 L 702.3 488.9 L 704.5 486.4 L 707.4 492.0 L 705.1 496.6 L 703.2 495.7 L 700.5 497.0 L 700.2 501.7 L 698.5 504.0 L 699.1 504.9 L 695.8 508.0 L 693.1 506.9 L 692.2 508.4 L 687.3 510.3 L 684.0 508.7 L 682.7 510.8 L 677.0 510.7 L 674.8 512.2 L 670.8 511.2 Z M 623.8 414.8 L 626.1 414.3 L 626.3 415.7 L 623.8 414.8 Z" },
    { zone: 17, d: "M 730.8 495.5 L 729.7 499.2 L 725.3 499.6 L 724.3 502.8 L 723.3 502.1 L 719.5 504.0 L 714.9 502.6 L 709.5 498.8 L 707.4 498.8 L 706.4 500.7 L 699.9 499.5 L 700.5 497.0 L 702.8 495.7 L 705.1 496.6 L 707.3 492.2 L 704.5 486.4 L 702.3 488.9 L 697.3 489.9 L 692.5 484.3 L 686.9 481.3 L 684.0 483.0 L 681.7 482.4 L 680.6 486.1 L 679.3 486.2 L 678.5 483.2 L 679.3 480.7 L 676.7 480.3 L 676.5 479.2 L 671.4 476.9 L 672.6 474.9 L 670.7 472.5 L 672.5 470.0 L 670.9 467.7 L 671.6 464.4 L 670.0 461.7 L 666.3 461.6 L 665.1 459.7 L 668.2 457.3 L 668.7 454.5 L 668.2 452.9 L 665.7 452.3 L 664.5 447.5 L 661.0 445.9 L 662.2 444.7 L 662.0 441.8 L 657.1 436.5 L 656.9 435.4 L 660.1 433.1 L 658.7 431.8 L 659.5 429.1 L 655.8 428.3 L 653.2 432.1 L 648.7 430.9 L 644.5 432.9 L 632.8 422.6 L 630.9 422.0 L 628.9 423.1 L 626.7 421.0 L 624.8 421.3 L 622.6 423.9 L 619.8 421.4 L 616.4 422.3 L 614.7 420.0 L 617.6 419.6 L 620.2 417.0 L 619.3 415.3 L 620.3 413.9 L 618.7 413.3 L 613.3 416.4 L 606.0 415.6 L 602.2 410.8 L 606.8 409.6 L 608.4 408.3 L 608.0 407.0 L 613.1 406.6 L 614.1 402.3 L 614.9 407.4 L 616.8 407.4 L 616.3 404.4 L 620.3 404.3 L 616.0 400.2 L 611.7 399.1 L 611.8 396.0 L 614.9 394.9 L 618.2 395.5 L 621.9 393.8 L 623.5 388.1 L 627.5 388.6 L 630.7 386.0 L 632.8 388.3 L 634.6 387.6 L 636.9 389.2 L 641.6 387.1 L 641.5 389.1 L 644.4 391.3 L 643.6 392.2 L 644.9 393.4 L 649.7 393.2 L 650.6 390.3 L 655.7 388.6 L 654.5 387.6 L 655.7 386.1 L 655.1 383.4 L 657.3 379.0 L 661.9 379.4 L 672.6 383.5 L 710.6 407.8 L 725.9 413.9 L 730.7 413.5 L 731.0 412.0 L 735.6 414.8 L 737.8 418.0 L 742.6 419.8 L 742.4 424.5 L 761.0 457.0 L 767.4 476.8 L 771.0 483.8 L 767.1 483.8 L 757.5 487.1 L 752.1 487.6 L 750.5 488.2 L 749.8 490.8 L 746.3 492.3 L 743.6 492.7 L 742.5 491.4 L 737.4 493.0 L 733.8 491.4 L 733.3 493.4 L 730.8 495.5 Z M 623.8 414.8 L 626.1 415.8 L 626.5 415.0 L 625.4 414.1 L 623.8 414.8 Z" },
    { zone: 18, d: "M 608.6 596.7 L 608.6 596.7 L 608.6 596.7 L 608.6 596.7 Z M 608.4 596.6 L 608.3 596.7 L 608.3 596.7 L 608.4 596.6 Z M 607.8 596.6 L 607.8 596.6 L 607.8 596.6 L 607.8 596.6 Z M 684.6 559.1 L 683.4 563.7 L 687.3 569.5 L 691.4 570.2 L 691.8 568.5 L 710.5 576.0 L 707.6 579.3 L 705.4 579.4 L 704.5 581.9 L 700.5 583.8 L 699.6 586.0 L 694.9 586.3 L 691.1 584.6 L 688.6 585.2 L 687.1 587.9 L 682.5 588.1 L 682.9 589.7 L 680.9 593.6 L 690.1 598.4 L 691.3 602.3 L 696.2 604.3 L 697.4 608.4 L 696.3 610.4 L 698.7 611.6 L 691.7 615.4 L 686.6 611.9 L 683.0 612.4 L 683.5 609.0 L 676.0 602.8 L 676.9 600.8 L 675.7 599.0 L 665.8 599.7 L 667.3 600.5 L 667.1 603.6 L 664.3 604.6 L 663.1 608.1 L 661.4 607.7 L 657.8 612.7 L 655.5 611.9 L 656.2 609.7 L 653.7 610.7 L 652.1 609.1 L 648.6 610.2 L 647.8 604.0 L 646.8 604.7 L 647.2 603.5 L 645.9 603.0 L 635.8 610.2 L 639.7 612.2 L 641.4 615.6 L 647.7 616.3 L 650.5 618.9 L 654.5 619.3 L 655.0 621.4 L 657.0 622.4 L 656.1 624.9 L 659.4 627.1 L 658.7 628.6 L 650.9 624.4 L 644.8 625.2 L 638.0 616.5 L 626.7 606.1 L 618.4 600.6 L 611.8 597.7 L 608.8 596.7 L 608.4 596.6 L 607.8 596.6 L 607.7 596.4 L 607.1 596.5 L 606.9 596.3 L 609.1 595.8 L 606.0 595.9 L 605.9 592.3 L 603.9 587.6 L 597.8 579.2 L 588.9 575.3 L 586.4 572.6 L 582.0 571.3 L 575.8 567.2 L 567.8 568.0 L 565.2 563.2 L 563.3 562.4 L 562.6 561.9 L 562.4 561.7 L 561.9 561.3 L 563.6 562.1 L 559.3 557.6 L 558.1 555.6 L 558.7 554.3 L 551.3 544.8 L 540.8 538.0 L 530.5 534.2 L 530.4 532.7 L 534.2 528.2 L 546.8 528.5 L 546.6 523.4 L 541.3 520.6 L 543.5 518.1 L 543.0 515.8 L 549.3 515.8 L 553.0 514.3 L 552.9 513.0 L 555.9 511.4 L 558.3 511.9 L 559.7 508.6 L 565.0 508.2 L 565.4 506.8 L 563.1 505.5 L 562.7 502.2 L 564.7 502.0 L 566.4 498.3 L 562.6 497.1 L 559.3 494.4 L 561.5 491.1 L 565.2 493.5 L 565.9 490.8 L 569.5 489.2 L 574.5 489.9 L 577.0 494.9 L 582.1 496.5 L 581.0 499.4 L 577.2 501.5 L 576.9 502.4 L 579.1 503.1 L 578.3 504.4 L 584.8 506.4 L 587.0 508.3 L 594.5 506.2 L 596.2 507.7 L 599.8 505.0 L 604.0 506.6 L 607.8 509.7 L 606.4 511.4 L 608.2 512.8 L 607.3 515.2 L 610.9 516.4 L 611.2 518.2 L 610.1 519.0 L 612.4 520.4 L 610.9 521.4 L 614.0 522.5 L 612.4 523.1 L 615.8 522.8 L 618.3 524.8 L 622.3 522.4 L 625.2 523.0 L 624.3 525.4 L 626.0 526.4 L 624.4 526.6 L 624.4 529.5 L 629.3 529.2 L 628.1 532.4 L 633.9 531.7 L 635.4 535.5 L 643.2 531.7 L 644.6 525.3 L 646.6 525.4 L 647.4 527.8 L 649.9 527.9 L 656.4 525.1 L 653.4 522.2 L 659.5 521.0 L 659.5 519.2 L 663.8 519.0 L 671.1 516.1 L 669.9 511.6 L 671.5 510.9 L 674.8 512.2 L 677.0 510.7 L 682.0 511.0 L 684.0 508.7 L 687.8 510.2 L 694.2 506.7 L 695.8 508.0 L 698.6 506.1 L 700.1 499.5 L 706.4 500.7 L 707.4 498.8 L 709.5 498.8 L 716.5 503.3 L 715.7 505.8 L 717.7 507.7 L 721.4 508.3 L 719.7 511.7 L 720.0 513.4 L 710.2 515.5 L 709.3 514.2 L 705.6 515.2 L 700.3 513.7 L 698.8 517.1 L 696.8 518.4 L 698.9 521.0 L 699.0 524.3 L 692.9 527.7 L 700.5 533.1 L 696.6 536.2 L 703.7 539.9 L 704.5 543.9 L 709.0 547.8 L 714.3 549.3 L 714.9 551.7 L 718.6 553.4 L 715.0 553.8 L 716.2 554.7 L 713.5 555.0 L 711.4 557.5 L 705.9 558.6 L 700.4 555.6 L 698.1 556.3 L 693.6 553.8 L 690.1 553.7 L 689.9 557.2 L 687.4 559.0 L 684.6 559.1 Z M 647.8 596.3 L 647.4 595.5 L 648.5 596.8 L 647.8 596.3 Z M 628.5 580.0 L 627.8 580.7 L 628.8 580.6 L 628.5 580.0 Z" },
    { zone: 19, d: "M 678.1 679.8 L 678.2 679.8 L 678.2 679.9 L 678.1 679.8 Z M 667.0 676.3 L 667.1 676.2 L 667.1 676.3 L 667.0 676.3 Z M 666.9 676.2 L 666.7 676.2 L 666.9 676.1 L 666.9 676.2 Z M 666.6 676.2 L 666.7 676.2 L 666.6 676.2 L 666.6 676.2 Z M 666.7 675.9 L 666.9 676.1 L 666.6 676.1 L 666.7 675.9 Z M 667.1 675.8 L 667.6 674.3 L 667.4 673.5 L 667.9 673.5 L 667.1 675.8 Z M 667.2 674.2 L 667.2 674.1 L 667.3 674.1 L 667.2 674.2 Z M 667.0 674.1 L 666.9 674.1 L 667.0 674.0 L 667.0 674.1 Z M 726.1 689.3 L 725.7 688.8 L 726.4 689.0 L 726.1 689.3 Z M 724.0 688.5 L 721.3 689.4 L 723.6 687.7 L 724.0 688.5 Z M 691.7 684.3 L 691.7 684.2 L 691.8 684.3 L 691.7 684.3 Z M 678.1 677.0 L 678.4 678.9 L 677.1 680.2 L 676.0 678.2 L 676.6 676.6 L 681.1 675.0 L 678.1 677.0 Z M 681.7 675.1 L 681.4 674.8 L 681.9 674.6 L 681.7 675.1 Z M 686.3 671.8 L 687.0 671.1 L 687.9 671.4 L 687.7 671.9 L 686.3 671.8 Z M 647.7 616.3 L 641.4 615.6 L 639.7 612.2 L 635.8 610.2 L 645.9 603.0 L 647.2 603.5 L 646.8 604.7 L 647.8 604.0 L 648.6 610.2 L 652.1 609.1 L 653.7 610.7 L 656.2 609.7 L 655.5 611.9 L 657.8 612.7 L 661.4 607.7 L 663.1 608.1 L 664.3 604.6 L 667.1 603.6 L 667.3 600.5 L 665.7 599.9 L 667.1 598.8 L 669.9 600.1 L 675.7 599.0 L 676.9 600.8 L 676.0 602.8 L 683.5 609.0 L 683.0 612.4 L 686.6 611.9 L 691.7 615.4 L 698.0 612.5 L 698.7 611.6 L 696.3 610.4 L 697.4 608.4 L 696.3 604.4 L 691.3 602.3 L 690.1 598.4 L 680.9 593.6 L 682.9 589.7 L 682.5 588.1 L 687.1 587.9 L 688.6 585.2 L 691.1 584.6 L 694.9 586.3 L 699.6 586.0 L 700.5 583.8 L 704.5 581.9 L 705.4 579.4 L 707.6 579.3 L 711.1 575.5 L 719.0 580.4 L 716.7 583.8 L 718.6 588.8 L 720.2 587.2 L 722.3 587.1 L 730.9 590.4 L 732.4 593.2 L 737.4 595.0 L 746.2 589.4 L 750.4 591.8 L 752.8 590.6 L 756.3 595.5 L 758.7 596.1 L 760.8 595.0 L 765.1 597.2 L 769.1 597.1 L 778.0 604.8 L 780.2 609.3 L 779.0 612.5 L 781.7 614.4 L 779.6 616.0 L 781.8 617.4 L 776.5 620.4 L 778.4 621.5 L 777.0 623.4 L 765.6 627.8 L 768.0 631.1 L 766.5 633.7 L 768.9 638.3 L 767.7 640.2 L 762.4 641.2 L 763.5 642.9 L 762.7 644.1 L 756.9 644.9 L 755.9 646.8 L 750.5 643.8 L 748.1 644.7 L 742.2 643.1 L 737.6 645.1 L 737.3 647.5 L 739.3 648.2 L 737.7 648.7 L 718.6 641.3 L 710.0 639.5 L 697.6 642.0 L 690.8 646.7 L 686.0 646.4 L 682.0 638.8 L 676.7 633.2 L 667.4 628.4 L 659.5 628.0 L 658.9 626.1 L 656.1 624.9 L 657.0 622.4 L 655.0 621.4 L 654.5 619.3 L 650.5 618.9 L 647.7 616.3 Z" },
    { zone: 20, d: "M 810.6 581.2 L 808.8 581.4 L 806.4 579.8 L 801.3 583.2 L 800.3 585.3 L 794.3 586.7 L 793.5 587.9 L 795.8 592.6 L 798.8 593.7 L 798.1 595.6 L 796.6 595.5 L 795.9 593.9 L 794.6 595.7 L 791.0 595.7 L 791.1 597.7 L 789.6 599.6 L 788.3 596.6 L 785.9 596.7 L 784.3 600.1 L 781.8 600.0 L 781.0 602.0 L 777.4 600.8 L 773.3 601.4 L 768.6 596.9 L 765.1 597.2 L 760.8 595.0 L 758.7 596.1 L 756.3 595.5 L 752.8 590.6 L 750.4 591.8 L 744.8 589.5 L 743.2 592.2 L 737.4 595.0 L 732.4 593.2 L 730.9 590.4 L 722.3 587.1 L 720.2 587.2 L 718.6 588.8 L 716.7 583.8 L 719.0 580.4 L 717.2 578.4 L 715.3 578.6 L 711.9 575.7 L 709.6 575.9 L 691.8 568.5 L 691.4 570.2 L 687.9 569.8 L 684.2 566.1 L 683.4 563.7 L 684.6 559.1 L 687.4 559.0 L 689.9 557.2 L 690.1 553.7 L 693.6 553.8 L 698.1 556.3 L 700.4 555.6 L 705.9 558.6 L 711.4 557.5 L 713.5 555.0 L 716.2 554.7 L 715.0 553.8 L 718.6 553.4 L 714.9 551.7 L 714.3 549.3 L 709.0 547.8 L 704.5 543.9 L 703.7 539.9 L 696.6 536.2 L 700.5 533.1 L 692.9 527.7 L 699.0 524.3 L 698.9 521.0 L 696.8 518.4 L 698.8 517.1 L 700.3 513.7 L 705.6 515.2 L 709.3 514.2 L 710.2 515.5 L 718.8 514.4 L 721.6 508.7 L 717.7 507.7 L 715.7 505.8 L 716.6 503.2 L 719.6 504.0 L 723.3 502.1 L 724.2 502.9 L 725.3 499.6 L 729.7 499.2 L 733.7 491.4 L 737.4 493.0 L 742.5 491.4 L 743.6 492.7 L 746.3 492.3 L 749.8 490.8 L 750.5 488.2 L 752.1 487.6 L 757.5 487.1 L 767.1 483.8 L 771.1 483.8 L 773.7 492.6 L 778.7 501.9 L 791.2 517.4 L 799.2 524.4 L 802.0 525.4 L 801.3 525.4 L 801.7 525.8 L 801.9 525.7 L 801.9 525.6 L 801.9 525.5 L 802.0 525.6 L 804.5 528.0 L 817.2 534.6 L 820.7 539.3 L 828.1 544.5 L 828.8 546.5 L 839.7 551.6 L 848.5 553.7 L 849.2 560.8 L 855.2 564.2 L 853.3 566.9 L 855.2 568.1 L 849.8 571.0 L 844.3 576.2 L 843.9 579.2 L 839.0 581.8 L 834.5 588.8 L 832.8 588.9 L 826.8 594.4 L 823.5 594.1 L 824.5 592.8 L 822.5 586.6 L 817.9 583.7 L 816.1 584.1 L 815.9 582.7 L 814.1 584.7 L 812.6 584.4 L 810.6 581.2 Z M 801.7 525.6 L 801.9 525.6 L 801.7 525.6 L 801.7 525.6 Z M 801.9 525.6 L 801.7 525.6 L 801.7 525.6 L 801.9 525.6 Z" },
    { zone: 21, d: "M 815.8 582.8 L 816.1 584.1 L 817.9 583.7 L 822.6 586.8 L 824.5 592.8 L 823.5 594.1 L 826.9 594.3 L 832.8 588.9 L 834.5 588.8 L 839.0 581.8 L 843.9 579.2 L 844.3 576.2 L 849.8 571.0 L 855.2 568.1 L 853.3 566.9 L 855.2 564.2 L 865.8 568.6 L 876.0 570.6 L 884.4 576.6 L 890.1 578.2 L 890.2 582.8 L 886.5 586.9 L 888.0 590.6 L 886.1 593.7 L 888.0 595.5 L 886.6 596.1 L 888.4 598.3 L 892.4 599.4 L 888.1 600.9 L 886.6 603.0 L 885.4 602.1 L 885.4 603.0 L 881.6 604.4 L 879.1 607.9 L 872.5 605.7 L 870.2 608.1 L 871.8 610.7 L 870.5 617.1 L 877.4 621.1 L 871.5 624.1 L 865.4 625.2 L 863.5 626.9 L 855.8 624.4 L 853.7 627.8 L 849.0 629.5 L 846.0 628.4 L 837.9 633.1 L 834.4 630.3 L 832.9 631.5 L 828.4 631.2 L 826.8 630.4 L 825.7 627.7 L 811.0 624.3 L 806.9 622.5 L 807.6 622.1 L 806.3 621.1 L 796.1 619.7 L 795.2 621.8 L 791.1 619.1 L 786.8 624.9 L 789.4 627.3 L 790.2 630.6 L 787.3 629.5 L 783.3 630.2 L 779.2 626.5 L 779.8 624.5 L 777.0 623.4 L 778.4 621.5 L 776.5 620.4 L 781.8 617.5 L 779.6 616.0 L 781.7 614.4 L 779.0 612.5 L 780.2 609.3 L 778.0 604.8 L 773.4 601.5 L 777.4 600.8 L 781.0 602.0 L 781.8 600.0 L 784.3 600.1 L 785.9 596.7 L 788.3 596.6 L 789.6 599.6 L 791.1 597.7 L 791.0 595.7 L 794.6 595.7 L 795.9 593.9 L 796.6 595.5 L 798.1 595.6 L 798.8 593.7 L 795.8 592.6 L 793.5 587.9 L 794.3 586.7 L 800.3 585.3 L 801.3 583.2 L 806.4 579.8 L 808.8 581.4 L 810.7 581.1 L 812.6 584.4 L 814.1 584.7 L 815.8 582.8 Z" },
    { zone: 22, d: "M 803.7 713.5 L 803.8 713.4 L 803.9 713.4 L 803.7 713.5 Z M 803.7 713.4 L 803.8 713.3 L 803.8 713.3 L 803.7 713.4 Z M 798.4 713.7 L 798.6 711.4 L 805.1 711.8 L 803.8 713.3 L 798.4 713.7 Z M 774.8 697.6 L 765.6 697.5 L 764.6 696.7 L 765.6 696.1 L 765.7 692.2 L 774.6 693.7 L 775.7 696.1 L 774.8 697.6 Z M 780.4 693.5 L 778.2 693.6 L 780.8 690.9 L 781.3 692.1 L 780.4 693.5 Z M 797.3 688.8 L 797.4 688.9 L 797.3 688.9 L 797.3 688.8 Z M 794.6 687.3 L 794.6 687.3 L 794.7 687.3 L 794.6 687.3 Z M 800.7 685.6 L 800.7 685.6 L 800.8 685.5 L 800.7 685.6 Z M 800.6 685.5 L 800.7 685.5 L 800.7 685.5 L 800.6 685.5 Z M 800.8 685.4 L 800.8 685.4 L 800.7 685.4 L 800.8 685.4 Z M 783.8 683.4 L 778.8 672.8 L 771.6 666.0 L 769.0 660.0 L 763.1 652.7 L 755.9 646.8 L 756.9 644.9 L 762.9 644.0 L 763.5 642.9 L 762.4 641.1 L 768.4 639.5 L 768.9 638.2 L 766.5 633.7 L 768.0 631.1 L 765.6 627.8 L 770.4 626.7 L 775.8 623.3 L 779.8 624.5 L 779.2 626.5 L 783.3 630.2 L 787.4 629.5 L 790.0 630.9 L 789.4 627.3 L 786.8 624.9 L 791.1 619.1 L 795.2 621.8 L 796.1 619.7 L 806.3 621.1 L 807.6 622.1 L 806.9 622.5 L 811.0 624.3 L 825.7 627.7 L 826.8 630.4 L 828.4 631.2 L 832.9 631.5 L 834.4 630.3 L 837.9 633.1 L 846.0 628.4 L 849.0 629.5 L 853.7 627.8 L 855.7 624.5 L 862.7 627.1 L 865.4 625.2 L 871.5 624.1 L 877.4 621.1 L 881.2 625.3 L 886.5 626.6 L 885.1 628.8 L 886.2 630.5 L 882.4 632.3 L 883.7 636.1 L 889.4 637.6 L 889.0 639.0 L 891.2 641.2 L 896.2 640.6 L 898.2 642.7 L 900.9 642.1 L 903.5 644.2 L 903.9 645.1 L 900.7 645.5 L 902.2 649.3 L 898.5 650.8 L 897.1 652.2 L 897.2 654.1 L 905.1 659.4 L 907.3 658.4 L 912.5 660.3 L 915.3 658.1 L 920.2 660.9 L 929.6 663.1 L 932.5 668.8 L 928.1 677.5 L 922.3 679.3 L 922.7 680.9 L 911.4 679.9 L 911.3 681.1 L 913.6 681.5 L 913.5 684.5 L 905.5 684.3 L 904.0 688.3 L 900.1 690.8 L 900.8 696.1 L 893.1 697.2 L 889.6 691.8 L 879.3 689.8 L 877.6 690.7 L 875.5 689.2 L 871.3 689.2 L 868.6 687.1 L 859.8 688.6 L 858.3 687.6 L 851.7 687.6 L 850.4 684.0 L 846.1 684.0 L 845.1 686.0 L 839.6 683.6 L 834.8 683.5 L 834.2 684.6 L 836.6 686.2 L 836.6 687.4 L 835.1 688.0 L 835.3 689.3 L 833.0 688.8 L 832.3 690.2 L 828.6 690.7 L 829.3 693.3 L 828.4 693.9 L 833.8 694.7 L 836.7 698.4 L 834.9 700.7 L 833.3 700.9 L 835.5 704.9 L 829.6 705.4 L 828.9 703.1 L 826.1 702.9 L 824.2 704.9 L 824.8 705.6 L 820.0 706.6 L 810.8 710.6 L 810.4 708.8 L 812.2 704.8 L 818.1 703.9 L 818.5 702.1 L 825.9 698.2 L 824.1 693.7 L 822.7 692.5 L 817.7 692.0 L 810.8 686.2 L 808.9 685.0 L 805.8 683.7 L 800.9 685.2 L 800.7 685.3 L 800.7 685.4 L 800.6 685.5 L 800.6 685.5 L 800.7 685.6 L 801.0 685.5 L 799.2 687.2 L 799.3 688.0 L 797.4 688.8 L 794.9 688.8 L 796.0 687.8 L 794.9 686.6 L 789.3 685.0 L 786.1 686.2 L 787.9 690.2 L 783.2 688.9 L 783.8 683.4 Z M 804.1 713.1 L 804.2 713.1 L 804.1 713.1 L 804.1 713.1 Z M 815.9 708.8 L 815.8 708.7 L 816.0 708.6 L 815.9 708.8 Z M 824.4 694.9 L 824.3 695.0 L 824.2 694.9 L 824.4 694.9 Z M 814.3 689.5 L 814.3 689.5 L 814.3 689.5 L 814.3 689.5 Z M 814.3 689.5 L 814.2 689.5 L 814.3 689.5 L 814.3 689.5 Z M 814.3 689.4 L 814.3 689.5 L 814.2 689.5 L 814.3 689.4 Z M 808.6 684.9 L 808.6 685.0 L 808.6 685.0 L 808.6 684.9 Z" },
    { zone: 23, d: "M 905.4 763.7 L 905.3 763.7 L 905.3 763.7 L 905.4 763.7 Z M 866.9 741.7 L 866.8 741.5 L 867.0 741.5 L 866.9 741.7 Z M 871.3 689.2 L 890.3 692.3 L 893.1 697.2 L 900.8 696.1 L 900.1 690.8 L 904.0 688.3 L 905.5 684.3 L 909.3 684.7 L 913.8 687.0 L 912.4 688.0 L 914.5 688.6 L 913.9 695.5 L 925.8 701.4 L 922.2 703.8 L 920.5 706.7 L 929.3 710.7 L 928.0 711.7 L 930.3 716.4 L 928.9 717.4 L 929.2 718.5 L 933.1 720.4 L 933.9 722.8 L 939.9 725.7 L 941.3 727.8 L 945.9 729.3 L 945.4 732.7 L 947.5 735.3 L 953.9 737.8 L 955.3 739.4 L 955.2 741.6 L 953.4 743.0 L 954.3 744.4 L 948.0 746.6 L 945.0 750.4 L 945.5 754.6 L 942.7 757.8 L 940.2 758.4 L 942.2 759.2 L 942.6 760.7 L 939.6 761.9 L 937.8 760.6 L 937.7 758.9 L 928.4 758.9 L 921.5 762.8 L 917.5 767.0 L 911.5 766.2 L 907.4 763.0 L 903.1 763.8 L 902.8 763.0 L 904.5 762.7 L 903.1 758.8 L 896.7 754.0 L 894.1 753.7 L 889.5 749.4 L 880.6 749.5 L 875.8 744.7 L 867.8 742.3 L 867.5 741.3 L 871.1 739.2 L 871.3 733.4 L 876.4 731.3 L 876.6 728.1 L 866.6 711.3 L 858.0 702.5 L 852.0 700.0 L 849.2 701.1 L 846.6 704.2 L 840.1 702.9 L 834.9 706.5 L 830.7 706.9 L 827.4 704.9 L 824.2 705.0 L 826.1 703.0 L 828.1 702.9 L 829.6 705.4 L 835.5 704.9 L 833.3 700.9 L 834.9 700.7 L 836.7 698.4 L 833.8 694.7 L 828.4 693.9 L 829.3 693.3 L 828.6 690.7 L 832.3 690.2 L 833.0 688.8 L 835.3 689.3 L 835.1 688.0 L 836.6 687.4 L 836.6 686.2 L 834.2 684.6 L 835.1 683.4 L 839.6 683.6 L 845.1 686.0 L 846.1 684.0 L 850.4 684.0 L 851.5 685.3 L 850.3 686.0 L 852.0 687.7 L 858.3 687.6 L 860.6 688.7 L 868.6 687.1 L 871.3 689.2 Z M 821.2 709.6 L 821.0 709.5 L 821.1 709.4 L 821.2 709.6 Z M 821.0 709.3 L 821.1 709.4 L 820.9 709.4 L 821.0 709.3 Z M 821.5 709.2 L 821.6 709.3 L 821.3 709.3 L 821.5 709.2 Z" },
    { zone: 24, d: "M 885.9 629.9 L 885.1 628.8 L 886.7 627.5 L 886.3 626.2 L 881.2 625.3 L 879.0 622.0 L 873.4 617.9 L 870.7 617.3 L 871.8 610.7 L 870.2 608.1 L 872.7 605.5 L 879.1 607.9 L 881.6 604.4 L 885.4 603.0 L 885.4 602.1 L 886.6 603.0 L 888.1 600.9 L 892.4 599.4 L 888.4 598.3 L 886.6 596.1 L 888.0 595.5 L 886.1 593.7 L 888.0 590.6 L 886.5 586.9 L 890.2 582.8 L 890.1 578.2 L 909.4 579.1 L 912.1 580.5 L 917.5 580.7 L 937.4 578.1 L 948.6 579.2 L 980.1 576.0 L 989.1 579.9 L 991.4 582.3 L 991.4 585.2 L 993.7 588.0 L 993.3 591.3 L 990.1 594.9 L 984.4 597.4 L 977.6 602.5 L 964.8 608.3 L 964.3 615.1 L 968.9 622.6 L 974.7 626.3 L 999.7 636.5 L 1026.1 645.3 L 1031.0 648.3 L 1050.0 652.9 L 1057.5 656.0 L 1059.1 655.2 L 1057.6 654.5 L 1058.9 654.6 L 1059.9 656.6 L 1077.0 660.9 L 1088.8 665.7 L 1091.5 668.3 L 1099.3 671.5 L 1105.9 677.7 L 1109.7 679.1 L 1104.8 681.6 L 1100.5 686.4 L 1103.6 686.9 L 1107.2 689.5 L 1110.7 689.5 L 1110.2 693.0 L 1101.4 693.6 L 1099.3 691.2 L 1100.7 690.7 L 1099.9 689.3 L 1101.1 689.6 L 1102.1 689.0 L 1099.7 687.7 L 1095.4 688.1 L 1095.9 691.4 L 1087.3 693.5 L 1086.3 696.8 L 1085.0 697.0 L 1077.6 695.7 L 1073.9 696.5 L 1071.8 694.7 L 1073.8 692.7 L 1073.2 692.0 L 1064.8 694.0 L 1064.9 696.6 L 1059.1 696.7 L 1057.7 695.5 L 1053.1 698.6 L 1050.9 694.6 L 1045.7 696.8 L 1038.9 693.0 L 1037.9 694.3 L 1035.9 692.6 L 1030.7 691.6 L 1029.5 692.5 L 1030.0 694.2 L 1028.3 692.2 L 1026.4 692.7 L 1026.7 695.4 L 1023.1 691.7 L 1019.4 695.5 L 1014.5 697.6 L 999.2 685.8 L 993.9 676.6 L 990.1 675.5 L 986.0 678.5 L 983.2 676.3 L 971.9 672.6 L 971.4 671.3 L 975.0 671.3 L 976.8 669.4 L 976.9 666.2 L 978.1 665.0 L 974.1 663.3 L 972.5 659.9 L 969.7 659.5 L 969.6 657.7 L 966.5 657.7 L 962.5 655.2 L 958.0 655.9 L 954.5 659.7 L 951.6 660.4 L 949.2 658.9 L 942.9 660.1 L 933.2 659.1 L 929.3 661.5 L 929.5 663.1 L 920.2 660.9 L 915.8 658.2 L 912.4 660.3 L 907.3 658.4 L 905.7 659.5 L 902.4 658.3 L 899.6 654.9 L 897.2 654.0 L 897.1 652.2 L 902.2 649.3 L 900.6 645.6 L 903.9 645.1 L 903.5 644.2 L 900.9 642.1 L 898.2 642.7 L 896.2 640.6 L 891.2 641.2 L 889.0 639.0 L 889.4 637.6 L 883.7 636.1 L 882.4 632.3 L 885.9 629.9 Z M 1036.0 692.5 L 1037.2 692.5 L 1036.0 692.5 L 1036.0 692.5 Z M 992.0 581.7 L 992.2 582.0 L 991.9 581.7 L 992.0 581.7 Z M 985.1 578.0 L 985.0 578.0 L 985.1 578.0 L 985.1 578.0 Z M 925.1 559.8 L 923.1 560.1 L 924.6 558.8 L 925.1 559.8 Z M 925.4 559.2 L 925.4 559.0 L 925.5 559.0 L 925.4 559.2 Z M 925.9 559.4 L 926.8 558.5 L 927.2 558.6 L 925.9 559.4 Z M 926.3 558.4 L 926.5 557.5 L 927.1 557.5 L 926.3 558.4 Z M 949.2 548.9 L 949.6 549.3 L 949.2 549.0 L 949.2 548.9 Z M 1099.0 690.1 L 1099.3 689.9 L 1099.3 690.1 L 1099.0 690.1 Z M 1100.9 689.3 L 1100.8 689.1 L 1100.9 689.2 L 1100.9 689.3 Z M 1100.0 689.1 L 1100.2 689.0 L 1100.1 689.1 L 1100.0 689.1 Z M 993.7 589.1 L 993.7 589.0 L 993.8 589.0 L 993.7 589.1 Z M 992.5 586.3 L 992.5 586.1 L 992.6 586.2 L 992.5 586.3 Z" },
    { zone: 25, d: "M 1163.9 761.6 L 1164.9 761.1 L 1164.6 761.6 L 1163.9 761.6 Z M 1166.2 760.8 L 1166.2 761.0 L 1166.2 760.9 L 1166.2 760.8 Z M 1158.6 741.4 L 1158.6 741.3 L 1158.6 741.4 L 1158.6 741.4 Z M 1158.3 741.3 L 1157.8 740.9 L 1157.7 740.5 L 1158.3 741.3 Z M 1156.2 739.9 L 1156.5 739.8 L 1156.5 739.9 L 1156.2 739.9 Z M 1088.7 723.3 L 1089.1 723.3 L 1089.2 723.5 L 1088.7 723.3 Z M 1088.0 722.4 L 1085.7 722.1 L 1087.4 721.4 L 1088.0 722.4 Z M 1155.3 738.2 L 1137.7 736.4 L 1121.2 737.3 L 1114.9 733.9 L 1109.4 733.2 L 1091.5 726.3 L 1096.6 723.1 L 1095.8 721.0 L 1093.2 719.3 L 1089.4 719.1 L 1089.3 718.0 L 1086.8 717.6 L 1087.6 716.7 L 1085.8 717.8 L 1086.0 716.4 L 1082.7 715.4 L 1071.3 717.8 L 1064.1 722.1 L 1058.7 727.3 L 1057.2 726.9 L 1053.1 723.8 L 1052.5 721.5 L 1046.7 720.8 L 1044.4 719.3 L 1046.1 716.6 L 1044.0 715.0 L 1044.8 713.9 L 1043.0 711.9 L 1043.6 708.3 L 1045.2 707.4 L 1043.4 704.4 L 1045.1 698.9 L 1042.1 697.6 L 1050.9 694.6 L 1053.1 698.6 L 1057.7 695.5 L 1063.1 697.1 L 1065.0 696.6 L 1064.8 694.0 L 1073.2 692.0 L 1073.8 692.7 L 1071.8 694.7 L 1073.9 696.5 L 1077.4 695.7 L 1086.0 696.9 L 1087.3 693.5 L 1095.9 691.4 L 1095.4 688.1 L 1099.7 687.7 L 1102.1 689.0 L 1101.1 689.6 L 1099.9 689.3 L 1100.7 690.7 L 1099.3 691.2 L 1101.4 693.6 L 1109.9 693.2 L 1110.7 689.5 L 1107.2 689.5 L 1103.6 686.9 L 1100.5 686.4 L 1104.8 681.6 L 1109.7 679.1 L 1121.9 686.7 L 1140.7 692.1 L 1153.5 698.7 L 1163.0 699.2 L 1164.7 701.3 L 1167.7 701.4 L 1162.1 703.7 L 1169.1 702.8 L 1173.6 707.8 L 1172.9 711.1 L 1177.1 714.8 L 1192.1 722.3 L 1210.5 737.4 L 1214.5 744.1 L 1214.0 746.2 L 1216.8 751.6 L 1219.7 752.9 L 1218.7 753.8 L 1219.8 755.9 L 1217.5 757.4 L 1216.4 758.6 L 1215.5 761.8 L 1211.7 763.7 L 1211.3 766.0 L 1209.0 768.5 L 1207.3 775.1 L 1208.2 776.9 L 1207.2 784.1 L 1205.2 786.2 L 1203.0 786.4 L 1195.5 782.2 L 1189.2 781.8 L 1183.8 779.5 L 1181.0 777.3 L 1173.9 773.1 L 1168.6 766.1 L 1171.0 765.4 L 1170.8 762.8 L 1166.5 760.8 L 1169.7 759.1 L 1170.2 755.4 L 1161.4 747.3 L 1161.6 744.0 L 1159.0 741.6 L 1160.4 742.5 L 1160.2 741.4 L 1155.3 738.2 Z M 1099.3 689.9 L 1099.0 690.1 L 1099.3 690.1 L 1099.3 689.9 Z M 1100.9 689.2 L 1100.7 689.2 L 1100.9 689.4 L 1100.9 689.2 Z M 1100.1 689.1 L 1100.0 688.9 L 1100.0 689.1 L 1100.1 689.1 Z M 1152.2 697.6 L 1152.2 697.5 L 1152.3 697.5 L 1152.2 697.6 Z M 1152.0 697.4 L 1152.1 697.5 L 1152.1 697.5 L 1152.0 697.4 Z M 1150.6 696.6 L 1150.7 696.6 L 1150.7 696.6 L 1150.6 696.6 Z M 1150.2 696.5 L 1150.3 696.4 L 1150.3 696.5 L 1150.2 696.5 Z M 1181.2 777.8 L 1181.2 777.8 L 1181.2 777.8 L 1181.2 777.8 Z M 1180.8 777.5 L 1180.8 777.5 L 1180.8 777.5 L 1180.8 777.5 Z M 1178.6 776.3 L 1178.7 776.4 L 1178.6 776.3 L 1178.6 776.3 Z M 1218.3 757.0 L 1218.3 757.1 L 1218.3 757.1 L 1218.3 757.0 Z M 1171.9 703.4 L 1171.9 703.4 L 1171.9 703.4 L 1171.9 703.4 Z M 1169.3 702.5 L 1169.4 702.2 L 1169.1 702.8 L 1169.3 702.5 Z M 1169.5 702.3 L 1169.6 702.2 L 1169.6 702.3 L 1169.5 702.3 Z M 1168.7 702.2 L 1168.6 702.1 L 1168.7 702.0 L 1168.7 702.2 Z M 1168.5 702.0 L 1168.5 702.0 L 1168.6 702.0 L 1168.5 702.0 Z M 1168.3 702.0 L 1168.4 701.9 L 1168.3 702.0 L 1168.3 702.0 Z M 1168.4 701.9 L 1168.4 701.9 L 1168.4 701.9 L 1168.4 701.9 Z" },
    { zone: 26, d: "M 946.4 769.3 L 946.4 769.2 L 946.6 769.3 L 946.4 769.3 Z M 998.6 684.7 L 1014.5 697.6 L 1019.4 695.5 L 1023.1 691.7 L 1026.7 695.4 L 1026.4 692.7 L 1028.3 692.2 L 1030.0 694.2 L 1029.5 692.5 L 1030.7 691.6 L 1035.9 692.6 L 1037.9 694.3 L 1038.9 693.0 L 1044.9 696.5 L 1042.1 697.6 L 1045.1 698.9 L 1043.4 704.4 L 1045.2 707.4 L 1043.6 708.3 L 1043.0 711.9 L 1044.8 713.9 L 1044.0 715.0 L 1046.1 716.6 L 1044.4 719.3 L 1046.7 720.8 L 1052.5 721.5 L 1054.5 725.2 L 1058.7 727.3 L 1050.8 736.7 L 1041.7 751.3 L 1037.1 754.6 L 1034.7 753.2 L 1025.9 754.6 L 1020.1 753.0 L 1016.5 753.6 L 1015.3 752.0 L 1014.1 754.3 L 1014.6 758.2 L 1012.5 761.9 L 1013.0 764.4 L 1007.1 772.3 L 1009.3 773.9 L 1008.5 775.9 L 1004.4 772.5 L 1000.4 772.3 L 995.1 773.2 L 995.1 776.2 L 989.7 773.9 L 987.6 775.7 L 984.3 775.2 L 979.0 776.3 L 975.8 773.3 L 974.8 770.2 L 977.5 767.8 L 977.2 766.7 L 972.2 767.8 L 967.2 766.0 L 964.2 767.9 L 963.5 766.6 L 961.3 767.0 L 959.6 765.5 L 956.6 765.9 L 952.0 769.9 L 950.4 773.5 L 948.3 771.7 L 948.0 769.6 L 943.1 765.5 L 942.4 763.2 L 939.5 762.0 L 942.6 760.7 L 942.2 759.2 L 940.2 758.4 L 942.7 757.8 L 945.5 754.6 L 945.0 750.6 L 946.1 748.7 L 948.3 746.4 L 954.2 744.5 L 953.4 743.0 L 955.2 741.6 L 955.3 739.4 L 953.9 737.8 L 947.5 735.3 L 945.4 732.7 L 945.9 729.3 L 941.3 727.8 L 939.9 725.7 L 933.9 722.8 L 933.1 720.4 L 929.2 718.5 L 928.9 717.4 L 930.3 716.4 L 928.0 711.7 L 929.3 710.7 L 920.5 706.7 L 922.2 703.8 L 925.8 701.4 L 913.9 695.5 L 914.5 688.5 L 912.4 688.2 L 913.8 687.0 L 909.3 684.7 L 913.5 684.5 L 913.6 681.5 L 911.3 681.1 L 911.2 680.0 L 921.6 681.5 L 922.8 680.8 L 922.3 679.3 L 928.1 677.5 L 932.2 670.5 L 931.6 665.6 L 929.3 661.7 L 931.3 659.9 L 936.9 658.9 L 942.9 660.1 L 948.6 658.8 L 951.6 660.4 L 954.5 659.7 L 957.8 656.0 L 961.5 654.9 L 966.5 657.7 L 969.6 657.7 L 969.7 659.5 L 972.5 659.9 L 974.1 663.3 L 978.1 665.0 L 976.9 666.2 L 976.8 669.4 L 975.0 671.3 L 971.4 671.3 L 971.9 672.6 L 983.2 676.3 L 986.0 678.5 L 990.1 675.5 L 993.9 676.6 L 998.6 684.7 Z M 1036.5 692.4 L 1036.8 692.8 L 1036.0 692.5 L 1036.5 692.4 Z" },
    { zone: 27, d: "M 1074.3 816.7 L 1076.3 820.3 L 1079.6 822.5 L 1087.0 824.5 L 1082.4 833.6 L 1082.1 838.9 L 1086.2 843.5 L 1082.3 853.1 L 1083.3 855.1 L 1085.0 855.5 L 1084.0 854.2 L 1084.9 855.1 L 1085.2 855.8 L 1084.5 857.0 L 1086.0 859.1 L 1091.9 860.8 L 1087.7 864.1 L 1088.3 867.8 L 1080.9 874.1 L 1080.0 872.2 L 1075.8 871.5 L 1073.8 872.8 L 1069.8 869.6 L 1061.0 870.6 L 1064.0 868.2 L 1061.1 866.2 L 1061.1 863.3 L 1054.1 858.6 L 1048.4 857.1 L 1045.8 857.9 L 1042.4 854.9 L 1040.4 854.6 L 1036.4 850.7 L 1040.6 850.8 L 1039.5 848.4 L 1035.5 847.7 L 1034.0 844.7 L 1026.5 849.5 L 1025.1 847.8 L 1023.4 848.0 L 1020.9 851.7 L 1024.2 852.9 L 1020.8 853.1 L 1021.1 857.9 L 1020.0 858.6 L 1017.3 856.8 L 1015.6 857.6 L 1012.6 853.5 L 1009.4 854.3 L 1008.0 852.8 L 1003.4 853.9 L 999.4 852.6 L 997.0 854.6 L 995.0 853.5 L 995.1 855.5 L 988.2 858.8 L 986.6 857.9 L 983.3 858.9 L 980.7 850.6 L 977.8 829.6 L 972.9 819.3 L 966.9 812.3 L 961.9 809.6 L 957.8 798.4 L 956.2 797.1 L 953.3 784.0 L 951.7 782.1 L 953.6 780.7 L 953.9 779.4 L 950.4 773.5 L 952.0 769.9 L 956.6 765.9 L 959.6 765.5 L 961.3 767.0 L 963.5 766.6 L 964.2 767.9 L 967.2 766.0 L 972.2 767.8 L 977.2 766.7 L 977.5 767.8 L 974.8 770.2 L 975.8 773.3 L 979.0 776.3 L 984.3 775.2 L 987.6 775.7 L 989.7 773.9 L 995.1 776.2 L 995.1 773.2 L 1000.4 772.3 L 1004.4 772.5 L 1008.4 776.0 L 1009.3 773.9 L 1007.1 772.3 L 1013.0 764.4 L 1012.5 761.9 L 1014.6 758.2 L 1014.1 754.3 L 1015.3 752.0 L 1016.5 753.6 L 1020.1 753.0 L 1025.9 754.6 L 1034.8 753.2 L 1037.1 754.6 L 1033.3 758.2 L 1032.6 762.1 L 1035.3 770.3 L 1026.7 778.7 L 1021.9 785.8 L 1022.3 790.5 L 1025.8 793.0 L 1025.2 799.3 L 1025.8 798.6 L 1034.9 803.0 L 1049.3 803.1 L 1058.7 811.1 L 1066.8 814.9 L 1074.3 816.7 Z M 955.0 795.5 L 954.7 795.3 L 954.8 795.3 L 955.0 795.5 Z M 952.6 780.9 L 952.6 780.9 L 952.7 780.9 L 952.6 780.9 Z M 953.5 780.1 L 953.6 780.0 L 953.6 780.0 L 953.5 780.1 Z M 952.7 778.6 L 952.2 778.2 L 952.8 778.4 L 952.7 778.6 Z" },
    { zone: 28, d: "M 990.3 947.9 L 985.5 962.9 L 980.5 968.4 L 974.0 969.4 L 966.7 968.0 L 952.5 969.3 L 948.1 968.4 L 942.8 965.6 L 938.7 960.3 L 940.7 957.3 L 938.1 952.0 L 940.6 948.1 L 938.5 943.0 L 938.6 938.7 L 949.7 936.1 L 954.3 933.6 L 956.4 931.7 L 957.9 926.4 L 964.3 917.1 L 967.4 907.9 L 957.3 900.8 L 959.4 896.8 L 969.1 893.7 L 972.8 890.6 L 978.3 890.2 L 984.6 891.7 L 987.6 891.0 L 992.5 887.4 L 995.6 879.7 L 995.5 871.4 L 989.4 868.3 L 983.3 858.9 L 986.6 857.9 L 988.2 858.8 L 995.1 855.5 L 995.0 853.5 L 997.0 854.6 L 999.4 852.6 L 1003.4 853.9 L 1008.0 852.8 L 1009.4 854.3 L 1012.6 853.5 L 1015.6 857.6 L 1017.3 856.8 L 1020.0 858.6 L 1021.1 857.9 L 1020.8 853.1 L 1024.2 852.9 L 1020.9 851.7 L 1023.4 848.0 L 1025.1 847.8 L 1026.5 849.5 L 1034.0 844.7 L 1035.5 847.7 L 1039.5 848.4 L 1040.6 850.8 L 1036.4 850.7 L 1040.4 854.6 L 1042.4 854.9 L 1045.8 857.9 L 1049.4 857.3 L 1056.3 859.5 L 1061.1 863.3 L 1061.1 866.2 L 1064.0 868.2 L 1061.0 870.6 L 1050.0 873.8 L 1035.0 880.7 L 1029.9 885.8 L 1026.3 891.9 L 1028.7 894.8 L 1031.0 915.4 L 1029.9 919.5 L 1019.6 928.0 L 1005.2 933.0 L 990.3 947.9 Z" },
    { zone: 29, d: "M 615.4 1200.0 L 615.3 1199.8 L 615.5 1199.9 L 615.4 1200.0 Z M 577.7 1075.1 L 585.4 1075.7 L 588.8 1078.2 L 589.5 1080.6 L 588.5 1083.4 L 586.5 1084.5 L 583.4 1084.3 L 576.9 1078.0 L 577.7 1075.1 Z M 628.6 974.5 L 628.7 974.5 L 628.6 974.5 L 628.6 974.5 Z M 629.4 973.9 L 629.8 974.4 L 629.4 974.4 L 629.4 973.9 Z M 627.6 971.4 L 628.1 975.5 L 627.6 976.4 L 625.9 971.6 L 628.5 970.4 L 627.6 971.4 Z M 629.2 972.9 L 628.5 972.1 L 629.4 973.0 L 629.2 972.9 Z M 613.2 969.8 L 613.1 969.6 L 613.2 969.7 L 613.2 969.8 Z M 612.3 969.5 L 612.4 969.5 L 612.3 969.6 L 612.3 969.5 Z M 613.5 969.3 L 613.5 969.5 L 613.3 969.4 L 613.5 969.3 Z M 615.7 968.0 L 618.1 967.5 L 620.1 968.7 L 619.9 970.1 L 617.0 969.0 L 612.0 969.3 L 610.8 967.4 L 614.1 965.4 L 615.7 968.0 Z M 590.4 961.8 L 593.0 966.3 L 588.4 965.2 L 586.8 962.0 L 590.4 961.8 Z M 616.1 962.4 L 616.1 962.5 L 616.0 962.4 L 616.1 962.4 Z M 625.6 962.4 L 625.4 962.1 L 625.7 962.2 L 625.6 962.4 Z M 624.7 962.4 L 624.3 962.0 L 624.1 961.9 L 624.7 962.4 Z M 616.6 959.1 L 618.5 961.8 L 616.2 962.4 L 615.5 960.4 L 616.6 959.1 Z M 638.5 1204.0 L 638.5 1203.9 L 638.7 1204.1 L 638.5 1204.0 Z M 636.8 1202.2 L 645.3 1203.0 L 645.8 1205.6 L 642.5 1205.4 L 639.5 1203.9 L 634.6 1203.0 L 636.8 1202.2 Z M 635.6 1202.2 L 635.6 1202.1 L 635.6 1202.2 L 635.6 1202.2 Z M 670.2 1169.9 L 667.9 1170.3 L 666.8 1169.0 L 669.4 1168.4 L 670.2 1169.9 Z M 765.1 1047.8 L 765.1 1047.7 L 765.2 1047.7 L 765.1 1047.8 Z M 745.4 1037.9 L 735.8 1030.8 L 725.3 1029.8 L 720.8 1026.2 L 708.1 1020.5 L 706.4 1017.3 L 698.1 1010.7 L 689.2 1009.3 L 683.6 1010.3 L 678.1 1003.9 L 673.6 1002.4 L 660.2 1002.0 L 649.7 1004.1 L 641.3 994.9 L 634.6 994.2 L 630.1 990.1 L 629.9 985.8 L 625.6 980.5 L 629.1 979.0 L 631.5 973.5 L 628.8 970.1 L 632.0 965.9 L 632.3 962.6 L 634.8 960.1 L 632.0 959.5 L 634.6 959.1 L 639.6 954.4 L 643.0 954.8 L 647.0 953.5 L 648.7 951.9 L 648.5 950.2 L 653.4 950.4 L 656.0 947.5 L 653.9 944.3 L 655.3 942.7 L 656.1 944.0 L 659.0 943.6 L 659.1 946.4 L 661.2 948.0 L 661.1 950.2 L 663.2 953.2 L 668.8 956.1 L 669.8 958.3 L 672.1 958.7 L 679.3 957.3 L 689.2 952.6 L 686.7 947.6 L 689.5 946.0 L 689.5 944.2 L 691.9 942.5 L 697.2 943.0 L 697.5 944.5 L 700.3 944.6 L 704.8 942.9 L 705.1 941.2 L 708.3 941.8 L 712.5 939.2 L 713.7 941.7 L 717.3 943.4 L 718.2 946.1 L 717.0 948.5 L 719.0 950.5 L 724.8 951.9 L 729.6 951.1 L 731.2 949.5 L 734.1 950.2 L 734.4 955.5 L 745.2 961.4 L 750.5 961.9 L 752.0 962.4 L 750.2 962.1 L 750.9 963.3 L 759.4 963.6 L 773.8 958.4 L 782.6 957.1 L 785.4 959.3 L 791.4 959.5 L 793.4 958.2 L 797.0 959.3 L 801.2 965.9 L 803.8 967.5 L 803.8 969.2 L 807.6 969.2 L 805.9 970.5 L 805.3 973.3 L 806.4 976.7 L 805.0 977.5 L 805.7 980.6 L 804.6 981.4 L 807.9 985.9 L 805.3 990.0 L 800.2 992.6 L 794.9 993.4 L 795.1 996.5 L 792.0 999.0 L 791.1 997.3 L 784.5 995.5 L 781.6 997.0 L 781.8 999.9 L 774.9 1001.6 L 769.3 998.4 L 769.8 994.5 L 767.3 992.3 L 761.0 989.9 L 761.4 987.8 L 760.2 986.0 L 757.4 988.2 L 757.3 990.2 L 754.1 989.8 L 753.0 992.1 L 759.6 991.5 L 760.2 992.8 L 761.8 992.8 L 760.7 996.1 L 762.6 998.3 L 758.5 997.9 L 755.1 1001.0 L 748.0 1001.4 L 746.7 1002.6 L 748.9 1004.5 L 748.9 1009.8 L 745.1 1013.7 L 748.5 1013.8 L 750.4 1015.7 L 754.7 1016.9 L 757.0 1015.7 L 764.4 1016.0 L 765.6 1019.3 L 768.9 1019.3 L 770.2 1020.9 L 768.1 1022.1 L 767.9 1023.9 L 772.0 1026.4 L 775.6 1026.6 L 778.8 1030.1 L 782.2 1030.2 L 779.8 1035.1 L 780.6 1036.5 L 778.3 1037.2 L 779.5 1039.8 L 777.4 1039.9 L 782.0 1043.6 L 782.7 1048.3 L 768.2 1049.0 L 762.0 1044.6 L 754.8 1044.1 L 746.3 1039.8 L 745.4 1037.9 Z M 782.3 994.7 L 787.7 992.4 L 786.7 991.3 L 787.8 989.7 L 783.4 987.9 L 782.0 990.0 L 783.2 991.4 L 780.2 991.4 L 779.7 993.1 L 782.3 994.7 Z M 629.8 987.4 L 629.8 987.4 L 629.9 987.4 L 629.8 987.4 Z M 632.5 960.0 L 631.8 960.0 L 632.5 960.0 L 632.5 960.0 Z M 631.7 959.9 L 631.7 959.9 L 631.7 959.9 L 631.7 959.9 Z M 635.7 954.9 L 635.7 954.8 L 635.7 954.8 L 635.7 954.9 Z M 704.4 940.5 L 704.8 940.8 L 704.4 940.8 L 704.4 940.5 Z M 700.6 891.4 L 699.7 893.2 L 696.5 893.5 L 697.2 891.7 L 700.6 891.4 Z" },
    { zone: 30, d: "M 747.0 1002.1 L 755.1 1001.0 L 758.5 997.9 L 762.6 998.3 L 760.7 996.1 L 761.8 992.8 L 760.2 992.8 L 759.6 991.5 L 753.0 992.1 L 754.1 989.8 L 757.3 990.2 L 757.4 988.2 L 760.2 986.0 L 761.4 987.8 L 761.0 989.9 L 767.3 992.3 L 769.8 994.5 L 769.3 998.4 L 774.9 1001.6 L 781.8 999.9 L 781.6 997.0 L 784.5 995.5 L 791.1 997.3 L 792.0 999.0 L 795.1 996.5 L 794.9 993.4 L 800.2 992.6 L 805.3 990.0 L 807.9 985.9 L 804.6 981.4 L 805.7 980.6 L 805.0 977.5 L 806.4 976.7 L 805.3 973.3 L 805.9 970.5 L 807.6 969.2 L 803.8 969.2 L 803.8 967.5 L 801.2 965.9 L 797.0 959.3 L 809.3 960.4 L 815.8 959.5 L 820.8 957.2 L 825.1 957.9 L 830.4 957.0 L 833.4 955.3 L 841.7 953.7 L 852.1 945.0 L 855.9 946.4 L 865.8 944.4 L 868.5 942.4 L 873.7 946.3 L 881.0 946.3 L 882.1 948.3 L 886.0 949.4 L 893.6 946.2 L 897.3 943.0 L 900.2 937.5 L 899.2 934.7 L 901.3 937.1 L 900.2 940.0 L 905.2 941.0 L 918.2 937.6 L 929.5 931.7 L 940.3 935.0 L 933.4 937.2 L 931.0 942.6 L 932.8 942.2 L 924.8 953.9 L 906.5 973.1 L 905.7 975.7 L 903.3 977.2 L 901.8 979.9 L 897.1 974.8 L 891.5 971.3 L 887.5 970.3 L 874.7 971.6 L 874.6 970.2 L 872.3 969.8 L 869.8 965.0 L 862.7 968.3 L 861.2 965.1 L 859.9 967.5 L 857.3 965.7 L 853.7 967.0 L 852.9 969.3 L 855.1 970.5 L 853.9 972.0 L 851.1 970.7 L 851.1 975.9 L 853.1 974.0 L 855.0 974.6 L 857.4 979.6 L 857.0 980.4 L 854.2 978.6 L 851.5 978.9 L 851.7 981.7 L 848.8 983.0 L 851.0 985.2 L 848.0 987.5 L 849.5 988.5 L 848.7 989.9 L 849.8 992.2 L 856.9 989.2 L 856.4 995.0 L 859.6 996.9 L 860.0 1001.2 L 856.3 1003.9 L 857.3 1005.3 L 855.7 1009.7 L 845.6 1004.3 L 841.0 1006.4 L 837.1 1006.4 L 835.8 1005.0 L 832.1 1005.7 L 830.5 1008.1 L 826.7 1008.9 L 830.6 1010.2 L 829.5 1012.2 L 832.0 1014.8 L 836.5 1014.8 L 840.9 1017.3 L 835.8 1019.4 L 836.7 1022.2 L 835.8 1023.2 L 826.9 1024.5 L 830.0 1027.0 L 828.2 1028.5 L 822.7 1024.7 L 820.3 1025.6 L 823.6 1028.5 L 821.4 1030.2 L 813.5 1028.8 L 813.5 1031.6 L 816.4 1030.8 L 817.4 1033.1 L 815.6 1038.7 L 816.3 1039.9 L 818.4 1041.4 L 821.3 1040.2 L 825.6 1045.6 L 823.2 1049.3 L 820.9 1049.5 L 822.2 1053.9 L 814.9 1058.0 L 812.1 1058.5 L 804.2 1052.9 L 795.4 1049.7 L 786.8 1048.0 L 782.7 1048.3 L 782.0 1043.6 L 777.4 1039.9 L 779.5 1039.8 L 778.3 1037.2 L 780.6 1036.5 L 779.8 1035.1 L 782.2 1030.2 L 778.8 1030.1 L 775.6 1026.6 L 772.0 1026.4 L 767.9 1023.9 L 768.1 1022.1 L 770.2 1020.9 L 768.9 1019.3 L 765.6 1019.3 L 764.4 1016.0 L 757.0 1015.7 L 754.7 1016.9 L 750.4 1015.7 L 748.5 1013.8 L 745.1 1013.7 L 748.9 1009.8 L 748.9 1004.5 L 747.0 1002.1 Z M 787.7 992.4 L 782.3 994.7 L 779.7 993.1 L 780.2 991.4 L 783.2 991.4 L 782.0 990.0 L 783.4 987.9 L 787.8 989.7 L 786.7 991.3 L 787.7 992.4 Z M 873.1 920.9 L 877.2 924.5 L 875.0 925.4 L 871.7 923.6 L 870.7 921.2 L 872.8 919.0 L 873.1 920.9 Z M 870.7 922.2 L 870.7 922.1 L 870.7 922.1 L 870.7 922.2 Z M 872.8 910.1 L 873.0 913.3 L 874.7 914.3 L 872.3 914.9 L 872.3 918.3 L 866.9 914.4 L 868.1 910.6 L 872.8 910.1 Z M 813.0 909.3 L 812.3 907.7 L 814.5 907.1 L 814.5 908.9 L 813.0 909.3 Z M 864.1 908.8 L 856.8 906.4 L 857.8 904.3 L 863.7 904.3 L 864.1 908.8 Z M 835.3 904.4 L 836.2 907.2 L 833.3 906.7 L 831.7 904.7 L 835.3 904.4 Z M 906.0 975.7 L 906.0 975.8 L 905.9 975.7 L 906.0 975.7 Z M 882.7 900.3 L 882.9 900.2 L 882.9 900.2 L 882.7 900.3 Z M 887.0 899.2 L 887.1 899.2 L 887.0 899.2 L 887.0 899.2 Z M 882.0 900.0 L 882.7 898.4 L 884.2 898.3 L 883.8 899.8 L 882.0 900.0 Z M 887.4 898.9 L 887.5 898.9 L 887.5 899.0 L 887.4 898.9 Z M 887.8 898.9 L 887.8 898.7 L 887.9 898.8 L 887.8 898.9 Z M 886.0 898.8 L 886.2 898.7 L 886.2 898.8 L 886.0 898.8 Z M 882.9 898.1 L 882.9 898.0 L 883.0 898.1 L 882.9 898.1 Z M 888.1 896.7 L 887.8 896.2 L 888.2 896.5 L 888.1 896.7 Z M 887.2 896.4 L 887.2 896.3 L 887.3 896.4 L 887.2 896.4 Z M 897.2 885.8 L 895.1 883.6 L 897.8 882.0 L 900.3 882.7 L 898.8 885.3 L 897.2 885.8 Z" },
    { zone: 31, d: "M 870.1 1089.3 L 870.0 1089.3 L 870.1 1089.3 L 870.1 1089.3 Z M 888.2 1084.2 L 888.2 1084.2 L 888.3 1084.2 L 888.2 1084.2 Z M 886.8 1079.0 L 887.0 1079.0 L 887.0 1079.1 L 886.8 1079.0 Z M 812.2 1058.4 L 822.2 1053.9 L 820.9 1049.5 L 823.2 1049.3 L 825.6 1045.6 L 821.3 1040.2 L 818.4 1041.4 L 816.3 1039.9 L 815.6 1038.7 L 817.4 1033.1 L 816.4 1030.8 L 813.5 1031.6 L 813.5 1028.8 L 821.4 1030.2 L 823.6 1028.5 L 820.3 1025.6 L 822.7 1024.7 L 828.2 1028.5 L 830.0 1027.0 L 826.9 1024.5 L 835.8 1023.2 L 836.7 1022.2 L 835.8 1019.4 L 840.9 1017.3 L 836.5 1014.8 L 832.0 1014.8 L 829.5 1012.2 L 830.6 1010.2 L 826.7 1008.9 L 830.5 1008.1 L 832.1 1005.7 L 835.8 1005.0 L 837.1 1006.4 L 841.0 1006.4 L 845.6 1004.3 L 855.7 1009.7 L 857.3 1005.3 L 856.3 1003.9 L 860.0 1001.2 L 859.6 996.9 L 856.4 995.0 L 856.9 989.2 L 849.8 992.2 L 848.7 989.9 L 849.5 988.5 L 848.0 987.5 L 851.0 985.2 L 848.8 983.0 L 851.7 981.7 L 851.5 978.9 L 854.2 978.6 L 857.0 980.4 L 857.4 979.6 L 855.0 974.6 L 853.1 974.0 L 851.1 975.9 L 851.1 970.7 L 853.9 972.0 L 855.1 970.5 L 852.9 969.3 L 853.7 967.0 L 857.3 965.7 L 859.9 967.5 L 861.2 965.1 L 862.7 968.3 L 869.8 965.0 L 872.3 969.8 L 874.6 970.2 L 874.9 971.7 L 887.6 970.3 L 891.6 971.4 L 898.2 975.7 L 900.6 979.8 L 901.8 979.9 L 896.7 986.4 L 898.0 989.6 L 896.1 994.9 L 893.7 997.0 L 893.9 1002.5 L 887.9 1006.9 L 886.4 1011.5 L 885.5 1009.9 L 885.8 1025.6 L 886.9 1028.4 L 890.2 1028.7 L 894.9 1031.4 L 896.8 1030.1 L 900.7 1034.7 L 901.8 1034.9 L 900.7 1036.0 L 898.7 1035.2 L 898.6 1037.6 L 897.6 1034.6 L 894.7 1035.6 L 895.7 1036.6 L 894.5 1037.6 L 894.8 1040.0 L 896.7 1043.7 L 899.4 1043.2 L 900.5 1044.4 L 899.0 1043.8 L 898.1 1044.7 L 899.8 1047.4 L 905.5 1048.3 L 905.6 1053.5 L 903.9 1052.3 L 903.1 1053.7 L 904.1 1055.4 L 907.4 1055.1 L 909.5 1058.5 L 905.8 1057.2 L 902.8 1058.4 L 901.9 1060.7 L 902.3 1061.1 L 897.0 1062.2 L 891.7 1066.9 L 890.0 1071.7 L 887.5 1073.5 L 885.9 1080.3 L 890.3 1089.4 L 889.6 1091.1 L 888.0 1090.4 L 884.3 1093.1 L 878.4 1087.7 L 872.4 1088.5 L 864.6 1084.9 L 860.5 1085.8 L 859.8 1086.5 L 861.0 1087.2 L 858.8 1086.3 L 855.3 1087.6 L 851.9 1086.0 L 846.4 1085.9 L 841.5 1082.0 L 836.5 1080.4 L 827.3 1079.5 L 824.0 1076.7 L 821.6 1069.9 L 812.2 1058.4 Z M 890.7 1089.7 L 890.9 1089.1 L 891.7 1089.0 L 890.7 1089.7 Z M 902.5 1060.8 L 902.4 1060.6 L 902.5 1060.7 L 902.5 1060.8 Z M 896.5 1035.7 L 896.7 1035.6 L 896.7 1035.7 L 896.5 1035.7 Z M 900.8 1034.5 L 900.8 1034.5 L 900.8 1034.5 L 900.8 1034.5 Z M 892.8 1004.1 L 892.9 1004.1 L 892.9 1004.1 L 892.8 1004.1 Z M 892.9 1004.0 L 893.0 1003.9 L 893.0 1004.0 L 892.9 1004.0 Z" },
    { zone: 32, d: "M 220.8 777.6 L 220.9 777.6 L 220.8 777.7 L 220.8 777.6 Z M 223.3 767.0 L 224.4 767.0 L 223.4 767.5 L 223.3 767.0 Z M 311.0 783.0 L 301.9 781.0 L 296.8 785.5 L 292.3 782.8 L 290.2 783.1 L 286.9 787.7 L 284.5 786.3 L 280.6 786.1 L 281.0 788.2 L 284.1 789.6 L 281.9 792.1 L 283.0 793.2 L 279.9 794.9 L 278.0 798.5 L 270.4 799.8 L 266.4 802.5 L 261.9 800.7 L 259.4 802.1 L 255.2 799.8 L 253.2 796.3 L 244.8 796.0 L 242.7 794.5 L 244.8 790.9 L 244.0 790.1 L 247.1 786.1 L 248.0 780.0 L 249.6 779.2 L 247.0 779.1 L 245.8 776.1 L 241.9 774.9 L 239.4 775.5 L 237.0 777.8 L 236.7 779.7 L 236.1 779.7 L 236.3 777.4 L 232.8 775.5 L 233.1 770.3 L 232.1 768.5 L 234.3 764.3 L 230.6 762.6 L 232.9 761.1 L 234.1 762.1 L 238.2 761.1 L 242.0 757.6 L 238.4 748.9 L 241.1 738.3 L 238.7 734.9 L 231.4 732.6 L 232.8 724.1 L 230.4 718.2 L 227.0 716.4 L 225.8 714.4 L 223.8 708.9 L 221.9 708.0 L 218.1 709.3 L 217.7 710.5 L 213.3 710.4 L 215.4 707.5 L 213.1 705.8 L 209.9 709.4 L 210.0 711.4 L 208.6 709.1 L 208.1 705.2 L 212.2 703.7 L 213.9 699.5 L 207.0 694.7 L 210.1 691.4 L 209.6 688.7 L 212.6 686.0 L 215.8 679.6 L 211.1 675.0 L 213.3 671.6 L 217.2 673.1 L 216.6 677.2 L 224.6 683.7 L 227.4 684.1 L 228.1 683.1 L 229.3 682.9 L 231.5 683.1 L 228.2 683.2 L 227.9 684.2 L 242.3 686.1 L 251.6 683.9 L 255.6 680.1 L 262.1 676.9 L 271.0 676.1 L 279.1 669.0 L 279.8 665.8 L 284.6 664.3 L 292.8 656.3 L 296.0 655.1 L 299.9 656.1 L 302.2 655.4 L 303.5 653.3 L 306.3 653.4 L 308.2 651.6 L 306.5 649.3 L 307.8 646.2 L 305.3 645.9 L 305.5 644.5 L 307.3 645.6 L 314.4 643.3 L 314.6 644.6 L 318.8 646.3 L 318.5 649.7 L 319.4 647.2 L 320.8 648.8 L 319.7 649.7 L 322.3 649.8 L 322.7 648.7 L 323.8 650.5 L 324.8 649.8 L 323.7 649.5 L 324.5 648.6 L 326.9 648.3 L 327.6 650.7 L 332.8 651.3 L 331.0 653.1 L 333.6 653.8 L 334.6 658.6 L 337.5 656.3 L 337.0 654.6 L 341.2 654.8 L 342.1 653.2 L 343.8 655.1 L 342.8 655.5 L 344.7 655.5 L 344.2 657.4 L 346.8 657.3 L 346.2 660.3 L 344.2 659.8 L 343.1 661.4 L 340.8 667.6 L 342.7 667.5 L 343.0 665.6 L 346.2 664.9 L 345.7 668.2 L 347.7 668.3 L 349.5 666.3 L 356.3 669.0 L 355.0 670.1 L 351.1 668.2 L 348.3 670.2 L 349.4 671.6 L 346.9 674.2 L 347.5 675.6 L 342.6 675.0 L 340.5 675.6 L 340.6 677.1 L 346.4 676.4 L 347.6 677.9 L 348.9 678.3 L 351.3 676.4 L 352.9 676.6 L 354.3 676.4 L 351.6 679.3 L 354.9 680.3 L 356.4 682.9 L 357.6 682.0 L 359.1 683.5 L 362.5 683.7 L 361.1 684.8 L 358.4 684.6 L 357.9 685.8 L 359.0 687.0 L 357.2 687.6 L 357.0 689.6 L 361.2 692.6 L 360.9 693.9 L 361.2 696.9 L 364.6 699.8 L 363.8 704.0 L 364.8 707.5 L 368.4 710.2 L 369.1 713.0 L 372.3 714.5 L 366.0 728.0 L 358.2 733.1 L 352.3 741.4 L 353.3 748.5 L 358.3 755.2 L 363.2 758.5 L 358.4 767.6 L 358.5 771.1 L 361.3 772.9 L 358.0 775.8 L 358.0 778.8 L 359.4 780.4 L 356.7 787.9 L 357.4 794.3 L 355.8 795.6 L 356.3 797.0 L 354.6 800.1 L 355.6 805.2 L 355.0 810.0 L 342.5 806.2 L 341.1 802.4 L 338.9 803.4 L 337.1 801.6 L 334.2 801.0 L 332.1 803.4 L 330.1 799.0 L 330.8 795.8 L 329.1 793.7 L 330.6 790.5 L 331.8 790.4 L 326.8 785.1 L 328.3 783.4 L 327.5 781.6 L 330.9 780.9 L 332.1 777.4 L 329.1 774.3 L 326.1 775.5 L 319.0 774.1 L 312.3 774.4 L 309.5 780.0 L 311.0 783.0 Z M 233.2 760.9 L 233.4 760.8 L 233.4 760.9 L 233.2 760.9 Z M 241.4 757.1 L 241.5 757.1 L 241.4 757.0 L 241.4 757.1 Z M 241.4 757.0 L 241.5 757.0 L 241.5 757.0 L 241.4 757.0 Z M 241.3 756.9 L 241.3 756.9 L 241.3 756.8 L 241.3 756.9 Z M 241.4 756.8 L 241.4 756.9 L 241.4 756.8 L 241.4 756.8 Z M 238.4 745.6 L 238.4 745.7 L 238.2 745.6 L 238.4 745.6 Z M 230.7 731.0 L 230.8 730.9 L 230.8 730.9 L 230.7 731.0 Z M 226.8 717.4 L 226.8 717.3 L 226.8 717.4 L 226.8 717.4 Z M 208.6 710.5 L 208.9 710.3 L 208.7 710.6 L 208.6 710.5 Z M 223.2 710.2 L 223.2 710.3 L 223.1 710.3 L 223.2 710.2 Z M 207.6 707.0 L 207.6 707.4 L 207.4 707.3 L 207.6 707.0 Z M 214.7 680.3 L 214.9 680.1 L 214.9 680.2 L 214.7 680.3 Z M 263.2 676.4 L 263.2 676.4 L 263.3 676.4 L 263.2 676.4 Z M 210.9 674.4 L 210.9 674.5 L 210.9 674.5 L 210.9 674.4 Z M 215.9 671.8 L 215.9 671.7 L 216.0 671.8 L 215.9 671.8 Z M 214.1 671.5 L 214.1 671.3 L 214.2 671.4 L 214.1 671.5 Z M 214.7 671.3 L 214.6 671.3 L 214.6 671.3 L 214.7 671.3 Z M 216.1 670.9 L 215.1 671.7 L 214.6 670.6 L 215.1 670.2 L 216.1 670.9 Z M 214.7 669.9 L 214.8 670.0 L 214.7 670.0 L 214.7 669.9 Z M 214.5 670.0 L 214.6 669.9 L 214.6 670.0 L 214.5 670.0 Z M 278.0 667.3 L 278.2 667.0 L 278.2 667.3 L 278.0 667.3 Z M 218.6 665.9 L 218.6 665.6 L 218.7 665.7 L 218.6 665.9 Z M 228.0 659.8 L 226.8 660.7 L 226.4 663.7 L 221.6 662.3 L 219.0 663.6 L 220.0 664.1 L 216.8 666.2 L 218.2 665.9 L 219.7 668.3 L 218.9 670.0 L 214.3 669.6 L 216.3 666.3 L 215.4 664.6 L 221.8 661.1 L 220.9 658.3 L 224.3 658.0 L 225.0 656.8 L 228.0 659.8 Z M 303.1 653.2 L 303.1 653.1 L 303.2 653.1 L 303.1 653.2 Z M 303.1 653.1 L 303.1 653.1 L 303.1 653.1 L 303.1 653.1 Z M 318.8 645.8 L 318.7 645.9 L 318.7 645.8 L 318.8 645.8 Z M 309.3 644.2 L 309.5 644.1 L 309.5 644.3 L 309.3 644.2 Z M 314.6 643.7 L 314.8 643.9 L 314.6 643.9 L 314.6 643.7 Z M 314.8 643.5 L 314.8 643.6 L 314.7 643.6 L 314.8 643.5 Z M 315.0 643.6 L 315.1 643.5 L 315.1 643.5 L 315.0 643.6 Z M 323.8 649.9 L 324.2 650.0 L 323.8 650.0 L 323.8 649.9 Z M 330.1 649.5 L 330.2 649.3 L 330.2 649.4 L 330.1 649.5 Z M 330.3 649.3 L 332.2 648.3 L 332.7 649.7 L 331.4 650.4 L 330.3 649.3 Z M 324.4 646.3 L 324.4 646.3 L 324.4 646.3 L 324.4 646.3 Z M 331.9 642.4 L 335.1 645.8 L 334.1 647.7 L 332.1 647.4 L 329.2 648.1 L 328.1 647.3 L 328.3 645.7 L 331.8 644.1 L 331.9 642.4 Z M 324.0 644.4 L 326.2 644.6 L 326.4 644.7 L 326.6 644.8 L 326.4 645.5 L 324.2 645.9 L 324.0 644.4 Z M 326.3 644.7 L 326.3 644.6 L 326.4 644.6 L 326.3 644.7 Z M 326.3 644.6 L 326.3 644.5 L 326.3 644.6 L 326.3 644.6 Z M 330.2 644.2 L 330.3 644.2 L 330.2 644.3 L 330.2 644.2 Z M 322.8 644.1 L 323.2 644.3 L 322.9 644.3 L 322.8 644.1 Z M 330.5 643.9 L 330.3 643.8 L 330.5 643.8 L 330.5 643.9 Z M 330.8 641.6 L 330.8 641.6 L 330.8 641.6 L 330.8 641.6 Z M 324.3 640.8 L 325.4 640.3 L 326.4 640.6 L 325.5 641.6 L 324.3 640.8 Z M 326.9 640.9 L 327.0 640.9 L 326.9 640.9 L 326.9 640.9 Z M 330.5 640.9 L 330.8 640.9 L 330.5 641.2 L 330.5 640.9 Z M 327.0 640.9 L 327.1 640.9 L 327.0 640.9 L 327.0 640.9 Z M 327.0 640.7 L 327.1 640.7 L 327.1 640.7 L 327.0 640.7 Z M 324.3 640.6 L 324.4 640.6 L 324.3 640.7 L 324.3 640.6 Z M 327.1 640.6 L 327.2 640.5 L 327.3 640.6 L 327.1 640.6 Z M 330.5 640.5 L 330.5 640.5 L 330.6 640.6 L 330.5 640.5 Z M 330.4 640.5 L 330.5 640.5 L 330.4 640.5 L 330.4 640.5 Z M 326.8 640.5 L 326.8 640.5 L 326.8 640.5 L 326.8 640.5 Z M 324.0 639.8 L 324.0 639.8 L 324.1 639.8 L 324.0 639.8 Z M 324.2 639.8 L 324.2 639.8 L 324.3 639.8 L 324.2 639.8 Z M 324.1 639.8 L 324.2 639.8 L 324.2 639.8 L 324.1 639.8 Z M 324.4 639.8 L 324.5 639.8 L 324.4 639.8 L 324.4 639.8 Z M 330.9 639.9 L 331.0 639.6 L 331.2 639.9 L 330.9 639.9 Z M 323.9 639.8 L 323.9 639.8 L 323.9 639.8 L 323.9 639.8 Z M 330.6 640.0 L 330.4 639.4 L 330.7 639.8 L 330.6 640.0 Z M 327.2 640.5 L 326.7 639.6 L 328.6 638.5 L 329.0 639.5 L 327.2 640.5 Z M 326.5 639.7 L 324.1 639.2 L 324.1 638.7 L 324.8 638.4 L 326.5 639.7 Z M 330.6 639.2 L 330.5 639.1 L 330.6 639.1 L 330.6 639.2 Z M 327.5 638.5 L 327.5 638.3 L 327.6 638.4 L 327.5 638.5 Z M 328.1 638.5 L 328.2 638.0 L 328.6 638.5 L 328.1 638.5 Z M 327.5 638.0 L 327.5 638.0 L 327.6 638.1 L 327.5 638.0 Z M 342.7 676.7 L 342.9 676.6 L 342.7 676.7 L 342.7 676.7 Z M 341.0 676.6 L 341.3 676.7 L 341.0 676.7 L 341.0 676.6 Z M 341.1 676.5 L 341.1 676.6 L 341.0 676.6 L 341.1 676.5 Z M 346.7 676.3 L 346.8 676.3 L 346.6 676.3 L 346.7 676.3 Z M 341.3 676.2 L 341.4 676.3 L 341.3 676.3 L 341.3 676.2 Z M 342.8 675.2 L 342.9 675.3 L 342.8 675.3 L 342.8 675.2 Z M 343.0 664.5 L 343.0 664.4 L 343.1 664.5 L 343.0 664.5 Z M 347.7 662.6 L 347.6 661.8 L 347.9 662.0 L 347.7 662.6 Z M 348.1 662.0 L 348.3 661.8 L 348.5 661.9 L 348.1 662.0 Z M 347.9 659.6 L 348.0 659.5 L 348.0 659.6 L 347.9 659.6 Z M 348.1 659.4 L 348.2 659.4 L 348.2 659.4 L 348.1 659.4 Z M 347.1 657.3 L 346.9 657.1 L 347.0 657.1 L 347.1 657.3 Z M 347.1 657.1 L 347.1 656.9 L 347.2 657.0 L 347.1 657.1 Z M 346.5 656.6 L 346.8 656.6 L 346.8 656.6 L 346.5 656.6 Z M 346.7 656.4 L 346.7 656.1 L 347.0 656.1 L 346.7 656.4 Z M 347.0 656.2 L 347.2 656.1 L 347.2 656.2 L 347.0 656.2 Z M 346.8 655.9 L 346.7 655.7 L 346.9 655.7 L 346.8 655.9 Z M 340.6 653.6 L 340.3 653.6 L 340.6 653.6 L 340.6 653.6 Z M 342.1 652.6 L 342.1 652.5 L 342.1 652.6 L 342.1 652.6 Z M 342.4 652.8 L 341.9 652.3 L 343.0 652.6 L 342.4 652.8 Z M 336.2 651.5 L 336.3 651.6 L 336.3 651.6 L 336.2 651.5 Z M 336.5 651.7 L 336.3 651.4 L 336.5 651.4 L 336.5 651.7 Z M 338.7 650.8 L 339.0 650.7 L 339.0 650.9 L 338.7 650.8 Z M 339.0 650.7 L 339.1 650.6 L 339.1 650.6 L 339.0 650.7 Z M 334.7 648.9 L 334.6 648.8 L 334.7 648.9 L 334.7 648.9 Z M 335.0 648.2 L 335.1 648.3 L 335.0 648.3 L 335.0 648.2 Z M 332.0 647.7 L 332.3 647.8 L 332.2 648.1 L 332.0 647.7 Z M 338.5 646.7 L 336.7 650.6 L 338.4 650.8 L 337.2 651.0 L 335.7 649.8 L 334.1 650.9 L 333.8 650.0 L 334.7 650.0 L 334.7 648.8 L 336.0 649.0 L 335.1 647.5 L 336.2 646.3 L 336.3 644.9 L 337.4 644.6 L 338.5 646.7 Z M 342.1 647.4 L 342.0 647.4 L 342.0 647.4 L 342.1 647.4 Z M 341.9 647.4 L 342.0 647.3 L 342.0 647.4 L 341.9 647.4 Z M 342.0 647.2 L 342.1 647.2 L 342.0 647.2 L 342.0 647.2 Z M 342.1 647.2 L 342.1 647.1 L 342.1 647.2 L 342.1 647.2 Z M 335.2 646.9 L 335.2 646.9 L 335.1 646.8 L 335.2 646.9 Z M 335.9 646.5 L 335.8 646.6 L 335.8 646.5 L 335.9 646.5 Z M 335.8 646.3 L 335.9 646.2 L 335.9 646.3 L 335.8 646.3 Z M 360.0 768.7 L 360.3 768.6 L 360.4 768.7 L 360.0 768.7 Z M 360.5 768.4 L 360.4 768.5 L 360.4 768.4 L 360.5 768.4 Z M 360.5 768.4 L 360.6 768.4 L 360.6 768.4 L 360.5 768.4 Z M 371.2 713.6 L 371.6 713.3 L 371.6 713.4 L 371.2 713.6 Z M 366.3 699.3 L 366.3 699.2 L 366.3 699.2 L 366.3 699.3 Z M 361.5 694.2 L 361.6 694.3 L 361.2 694.4 L 361.5 694.2 Z M 360.5 685.2 L 360.6 685.4 L 360.4 685.4 L 360.5 685.2 Z M 362.1 683.5 L 362.1 683.6 L 362.1 683.6 L 362.1 683.5 Z M 361.9 683.5 L 362.2 683.4 L 361.9 683.7 L 361.9 683.5 Z M 357.5 681.8 L 357.4 681.7 L 357.6 681.7 L 357.5 681.8 Z M 363.3 680.6 L 363.3 682.3 L 360.7 681.3 L 361.3 680.6 L 363.3 680.6 Z M 367.3 680.7 L 367.4 680.8 L 367.3 680.9 L 367.3 680.7 Z M 360.5 680.7 L 360.5 680.7 L 360.5 680.8 L 360.5 680.7 Z M 357.0 680.6 L 357.1 680.4 L 357.2 680.5 L 357.0 680.6 Z M 353.9 679.6 L 353.9 679.8 L 353.8 679.8 L 353.9 679.6 Z M 354.8 679.6 L 354.9 679.3 L 355.4 679.4 L 354.8 679.6 Z M 356.6 678.9 L 356.7 678.9 L 356.7 678.9 L 356.6 678.9 Z M 357.3 678.6 L 357.3 678.7 L 357.3 678.6 L 357.3 678.6 Z M 348.2 677.8 L 348.5 677.8 L 348.2 677.8 L 348.2 677.8 Z M 363.8 676.7 L 359.3 679.4 L 357.1 679.4 L 363.4 675.6 L 363.8 676.7 Z M 354.6 676.5 L 354.6 676.6 L 354.5 676.6 L 354.6 676.5 Z M 353.2 676.3 L 353.1 676.4 L 353.1 676.3 L 353.2 676.3 Z M 353.7 676.3 L 353.7 676.3 L 353.7 676.3 L 353.7 676.3 Z M 354.0 676.3 L 354.0 676.4 L 354.0 676.3 L 354.0 676.3 Z M 354.0 676.2 L 354.1 676.2 L 354.0 676.2 L 354.0 676.2 Z M 353.2 676.2 L 353.3 676.2 L 353.2 676.3 L 353.2 676.2 Z M 353.4 676.0 L 353.4 676.0 L 353.4 676.0 L 353.4 676.0 Z M 348.8 672.5 L 349.0 672.6 L 348.8 672.6 L 348.8 672.5 Z M 354.2 670.7 L 354.3 670.2 L 354.5 670.6 L 354.2 670.7 Z M 348.6 661.8 L 348.6 661.6 L 348.9 661.8 L 348.6 661.8 Z M 348.7 661.3 L 348.8 661.2 L 348.8 661.3 L 348.7 661.3 Z M 350.9 661.4 L 349.7 661.1 L 350.9 660.5 L 350.9 661.4 Z M 350.1 660.8 L 350.2 660.8 L 350.1 660.9 L 350.1 660.8 Z" },
    { zone: 33, d: "M 233.8 876.9 L 234.1 877.2 L 233.8 877.3 L 233.8 876.9 Z M 274.4 875.2 L 274.4 875.1 L 274.5 875.2 L 274.4 875.2 Z M 274.6 875.2 L 274.6 875.1 L 274.7 875.1 L 274.6 875.2 Z M 278.3 875.2 L 278.3 875.1 L 278.3 875.2 L 278.3 875.2 Z M 273.1 874.4 L 273.4 874.1 L 273.2 874.4 L 273.1 874.4 Z M 263.8 872.2 L 263.7 871.8 L 264.1 871.9 L 263.8 872.2 Z M 268.6 872.0 L 268.7 871.9 L 268.6 872.0 L 268.6 872.0 Z M 238.0 869.8 L 237.8 869.5 L 237.9 869.5 L 238.0 869.8 Z M 237.8 869.4 L 237.9 869.3 L 237.8 869.4 L 237.8 869.4 Z M 239.1 855.7 L 239.2 855.6 L 239.2 855.6 L 239.1 855.7 Z M 236.6 853.4 L 236.6 853.3 L 236.7 853.3 L 236.6 853.4 Z M 224.1 845.3 L 224.2 852.6 L 222.2 854.3 L 218.1 853.0 L 218.4 850.6 L 215.4 849.2 L 216.4 847.6 L 224.1 845.3 Z M 219.6 846.5 L 219.6 846.5 L 219.6 846.5 L 219.6 846.5 Z M 225.0 845.5 L 225.1 845.4 L 225.1 845.5 L 225.0 845.5 Z M 225.1 845.1 L 225.2 844.6 L 225.6 845.1 L 225.1 845.1 Z M 228.7 841.6 L 228.7 841.4 L 228.8 841.6 L 228.7 841.6 Z M 228.6 841.4 L 228.6 841.3 L 228.6 841.3 L 228.6 841.4 Z M 233.0 831.1 L 232.8 831.0 L 233.1 831.0 L 233.0 831.1 Z M 280.8 873.7 L 280.9 873.6 L 280.8 873.7 L 280.8 873.7 Z M 293.7 865.1 L 293.8 865.1 L 293.7 865.1 L 293.7 865.1 Z M 294.6 863.4 L 294.6 863.2 L 294.7 863.2 L 294.6 863.4 Z M 343.8 855.7 L 343.8 855.6 L 343.9 855.7 L 343.8 855.7 Z M 344.1 855.6 L 344.2 855.5 L 344.1 855.6 L 344.1 855.6 Z M 344.1 855.4 L 344.3 855.4 L 344.3 855.5 L 344.1 855.4 Z M 343.8 855.4 L 343.8 855.3 L 343.9 855.4 L 343.8 855.4 Z M 343.1 854.8 L 343.7 855.6 L 342.8 855.3 L 343.1 854.8 Z M 350.4 849.6 L 350.8 850.2 L 350.5 850.6 L 350.4 849.6 Z M 350.3 849.3 L 350.3 849.1 L 350.5 849.2 L 350.3 849.3 Z M 350.5 849.0 L 350.6 849.1 L 350.5 849.2 L 350.5 849.0 Z M 350.4 848.9 L 350.4 848.8 L 350.5 848.9 L 350.4 848.9 Z M 334.3 851.7 L 320.5 842.8 L 311.9 841.5 L 307.6 843.7 L 308.0 845.3 L 307.0 845.9 L 300.8 842.8 L 294.4 847.7 L 292.3 851.8 L 293.1 855.2 L 295.9 858.1 L 293.8 863.2 L 282.0 872.9 L 276.5 875.6 L 272.6 873.4 L 270.4 873.5 L 270.0 872.1 L 264.4 869.7 L 260.4 872.5 L 258.7 872.1 L 259.3 873.6 L 257.3 873.9 L 258.0 876.2 L 256.4 876.8 L 257.0 873.9 L 253.1 874.1 L 254.8 869.7 L 253.2 867.4 L 251.0 867.7 L 249.1 863.6 L 249.7 859.9 L 243.8 857.5 L 239.4 858.1 L 237.3 866.5 L 233.6 867.7 L 229.1 859.9 L 228.2 854.1 L 230.2 852.5 L 231.0 853.9 L 235.5 853.0 L 238.5 855.4 L 239.3 858.0 L 240.6 857.7 L 241.6 855.4 L 239.5 852.0 L 236.6 851.9 L 236.6 848.4 L 234.2 846.6 L 234.2 848.9 L 233.1 844.7 L 230.3 843.2 L 229.7 841.4 L 236.5 835.3 L 234.9 831.2 L 232.6 830.7 L 230.3 827.1 L 234.1 822.4 L 234.0 820.6 L 231.3 819.0 L 231.7 817.3 L 237.2 811.4 L 239.8 805.2 L 237.8 801.8 L 238.7 798.4 L 237.3 797.5 L 238.4 794.5 L 237.5 793.6 L 237.9 788.7 L 244.5 795.9 L 253.2 796.3 L 255.2 799.8 L 259.4 802.1 L 261.9 800.7 L 266.4 802.5 L 270.4 799.8 L 278.0 798.5 L 279.9 794.9 L 283.0 793.2 L 281.9 792.1 L 284.1 789.6 L 281.0 788.2 L 280.6 786.1 L 284.5 786.3 L 286.9 787.7 L 290.2 783.1 L 292.3 782.8 L 296.8 785.5 L 302.5 780.7 L 310.9 783.1 L 309.5 780.0 L 312.3 774.4 L 319.0 774.1 L 326.1 775.5 L 329.1 774.3 L 332.1 777.4 L 330.9 780.9 L 327.5 781.6 L 328.3 783.4 L 326.8 785.1 L 331.8 790.4 L 330.6 790.5 L 329.1 793.7 L 330.8 795.8 L 330.1 799.0 L 332.1 803.4 L 334.2 801.0 L 337.1 801.6 L 338.9 803.4 L 341.1 802.4 L 342.5 806.2 L 355.0 810.0 L 353.1 814.5 L 354.4 815.8 L 354.5 818.6 L 349.7 829.7 L 350.5 832.6 L 353.2 834.8 L 350.4 835.1 L 347.5 839.1 L 346.4 844.6 L 347.9 846.5 L 346.5 849.8 L 342.5 851.9 L 342.6 854.4 L 340.5 853.1 L 340.5 850.8 L 334.3 851.7 Z M 352.7 833.5 L 352.7 833.6 L 352.7 833.5 L 352.7 833.5 Z M 355.8 812.5 L 355.8 812.5 L 355.8 812.5 L 355.8 812.5 Z M 355.7 812.5 L 355.7 812.4 L 355.7 812.5 L 355.7 812.5 Z" },
    { zone: 34, d: "M 810.6 581.2 L 808.8 581.4 L 806.4 579.8 L 801.3 583.2 L 800.3 585.3 L 794.3 586.7 L 793.5 587.9 L 795.8 592.6 L 798.8 593.7 L 798.1 595.6 L 796.6 595.5 L 795.9 593.9 L 794.6 595.7 L 791.0 595.7 L 791.1 597.7 L 789.6 599.6 L 788.3 596.6 L 785.9 596.7 L 784.3 600.1 L 781.8 600.0 L 781.0 602.0 L 777.4 600.8 L 773.3 601.4 L 768.6 596.9 L 765.1 597.2 L 760.8 595.0 L 758.7 596.1 L 756.3 595.5 L 752.8 590.6 L 750.4 591.8 L 744.8 589.5 L 743.2 592.2 L 737.4 595.0 L 732.4 593.2 L 730.9 590.4 L 722.3 587.1 L 720.2 587.2 L 718.6 588.8 L 716.7 583.8 L 719.0 580.4 L 717.2 578.4 L 715.3 578.6 L 711.9 575.7 L 709.6 575.9 L 691.8 568.5 L 691.4 570.2 L 687.9 569.8 L 684.2 566.1 L 683.4 563.7 L 684.6 559.1 L 687.4 559.0 L 689.9 557.2 L 690.1 553.7 L 693.6 553.8 L 698.1 556.3 L 700.4 555.6 L 705.9 558.6 L 711.4 557.5 L 713.5 555.0 L 716.2 554.7 L 715.0 553.8 L 718.6 553.4 L 714.9 551.7 L 714.3 549.3 L 709.0 547.8 L 704.5 543.9 L 703.7 539.9 L 696.6 536.2 L 700.5 533.1 L 692.9 527.7 L 699.0 524.3 L 698.9 521.0 L 696.8 518.4 L 698.8 517.1 L 700.3 513.7 L 705.6 515.2 L 709.3 514.2 L 710.2 515.5 L 718.8 514.4 L 721.6 508.7 L 717.7 507.7 L 715.7 505.8 L 716.6 503.2 L 719.6 504.0 L 723.3 502.1 L 724.2 502.9 L 725.3 499.6 L 729.7 499.2 L 733.7 491.4 L 737.4 493.0 L 742.5 491.4 L 743.6 492.7 L 746.3 492.3 L 749.8 490.8 L 750.5 488.2 L 752.1 487.6 L 757.5 487.1 L 767.1 483.8 L 771.1 483.8 L 773.7 492.6 L 778.7 501.9 L 791.2 517.4 L 799.2 524.4 L 802.0 525.4 L 801.3 525.4 L 801.7 525.8 L 801.9 525.7 L 801.9 525.6 L 801.9 525.5 L 802.0 525.6 L 804.5 528.0 L 817.2 534.6 L 820.7 539.3 L 828.1 544.5 L 828.8 546.5 L 839.7 551.6 L 848.5 553.7 L 849.2 560.8 L 855.2 564.2 L 853.3 566.9 L 855.2 568.1 L 849.8 571.0 L 844.3 576.2 L 843.9 579.2 L 839.0 581.8 L 834.5 588.8 L 832.8 588.9 L 826.8 594.4 L 823.5 594.1 L 824.5 592.8 L 822.5 586.6 L 817.9 583.7 L 816.1 584.1 L 815.9 582.7 L 814.1 584.7 L 812.6 584.4 L 810.6 581.2 Z M 801.7 525.6 L 801.9 525.6 L 801.7 525.6 L 801.7 525.6 Z M 801.9 525.6 L 801.7 525.6 L 801.7 525.6 L 801.9 525.6 Z" },
    { zone: 35, d: "M 946.4 769.3 L 946.4 769.2 L 946.6 769.3 L 946.4 769.3 Z M 998.6 684.7 L 1014.5 697.6 L 1019.4 695.5 L 1023.1 691.7 L 1026.7 695.4 L 1026.4 692.7 L 1028.3 692.2 L 1030.0 694.2 L 1029.5 692.5 L 1030.7 691.6 L 1035.9 692.6 L 1037.9 694.3 L 1038.9 693.0 L 1044.9 696.5 L 1042.1 697.6 L 1045.1 698.9 L 1043.4 704.4 L 1045.2 707.4 L 1043.6 708.3 L 1043.0 711.9 L 1044.8 713.9 L 1044.0 715.0 L 1046.1 716.6 L 1044.4 719.3 L 1046.7 720.8 L 1052.5 721.5 L 1054.5 725.2 L 1058.7 727.3 L 1050.8 736.7 L 1041.7 751.3 L 1037.1 754.6 L 1034.7 753.2 L 1025.9 754.6 L 1020.1 753.0 L 1016.5 753.6 L 1015.3 752.0 L 1014.1 754.3 L 1014.6 758.2 L 1012.5 761.9 L 1013.0 764.4 L 1007.1 772.3 L 1009.3 773.9 L 1008.5 775.9 L 1004.4 772.5 L 1000.4 772.3 L 995.1 773.2 L 995.1 776.2 L 989.7 773.9 L 987.6 775.7 L 984.3 775.2 L 979.0 776.3 L 975.8 773.3 L 974.8 770.2 L 977.5 767.8 L 977.2 766.7 L 972.2 767.8 L 967.2 766.0 L 964.2 767.9 L 963.5 766.6 L 961.3 767.0 L 959.6 765.5 L 956.6 765.9 L 952.0 769.9 L 950.4 773.5 L 948.3 771.7 L 948.0 769.6 L 943.1 765.5 L 942.4 763.2 L 939.5 762.0 L 942.6 760.7 L 942.2 759.2 L 940.2 758.4 L 942.7 757.8 L 945.5 754.6 L 945.0 750.6 L 946.1 748.7 L 948.3 746.4 L 954.2 744.5 L 953.4 743.0 L 955.2 741.6 L 955.3 739.4 L 953.9 737.8 L 947.5 735.3 L 945.4 732.7 L 945.9 729.3 L 941.3 727.8 L 939.9 725.7 L 933.9 722.8 L 933.1 720.4 L 929.2 718.5 L 928.9 717.4 L 930.3 716.4 L 928.0 711.7 L 929.3 710.7 L 920.5 706.7 L 922.2 703.8 L 925.8 701.4 L 913.9 695.5 L 914.5 688.5 L 912.4 688.2 L 913.8 687.0 L 909.3 684.7 L 913.5 684.5 L 913.6 681.5 L 911.3 681.1 L 911.2 680.0 L 921.6 681.5 L 922.8 680.8 L 922.3 679.3 L 928.1 677.5 L 932.2 670.5 L 931.6 665.6 L 929.3 661.7 L 931.3 659.9 L 936.9 658.9 L 942.9 660.1 L 948.6 658.8 L 951.6 660.4 L 954.5 659.7 L 957.8 656.0 L 961.5 654.9 L 966.5 657.7 L 969.6 657.7 L 969.7 659.5 L 972.5 659.9 L 974.1 663.3 L 978.1 665.0 L 976.9 666.2 L 976.8 669.4 L 975.0 671.3 L 971.4 671.3 L 971.9 672.6 L 983.2 676.3 L 986.0 678.5 L 990.1 675.5 L 993.9 676.6 L 998.6 684.7 Z M 1036.5 692.4 L 1036.8 692.8 L 1036.0 692.5 L 1036.5 692.4 Z" },
    { zone: 36, d: "M 730.8 495.5 L 729.7 499.2 L 725.3 499.6 L 724.3 502.8 L 723.3 502.1 L 719.5 504.0 L 714.9 502.6 L 709.5 498.8 L 707.4 498.8 L 706.4 500.7 L 699.9 499.5 L 700.5 497.0 L 702.8 495.7 L 705.1 496.6 L 707.3 492.2 L 704.5 486.4 L 702.3 488.9 L 697.3 489.9 L 692.5 484.3 L 686.9 481.3 L 684.0 483.0 L 681.7 482.4 L 680.6 486.1 L 679.3 486.2 L 678.5 483.2 L 679.3 480.7 L 676.7 480.3 L 676.5 479.2 L 671.4 476.9 L 672.6 474.9 L 670.7 472.5 L 672.5 470.0 L 670.9 467.7 L 671.6 464.4 L 670.0 461.7 L 666.3 461.6 L 665.1 459.7 L 668.2 457.3 L 668.7 454.5 L 668.2 452.9 L 665.7 452.3 L 664.5 447.5 L 661.0 445.9 L 662.2 444.7 L 662.0 441.8 L 657.1 436.5 L 656.9 435.4 L 660.1 433.1 L 658.7 431.8 L 659.5 429.1 L 655.8 428.3 L 653.2 432.1 L 648.7 430.9 L 644.5 432.9 L 632.8 422.6 L 630.9 422.0 L 628.9 423.1 L 626.7 421.0 L 624.8 421.3 L 622.6 423.9 L 619.8 421.4 L 616.4 422.3 L 614.7 420.0 L 617.6 419.6 L 620.2 417.0 L 619.3 415.3 L 620.3 413.9 L 618.7 413.3 L 613.3 416.4 L 606.0 415.6 L 602.2 410.8 L 606.8 409.6 L 608.4 408.3 L 608.0 407.0 L 613.1 406.6 L 614.1 402.3 L 614.9 407.4 L 616.8 407.4 L 616.3 404.4 L 620.3 404.3 L 616.0 400.2 L 611.7 399.1 L 611.8 396.0 L 614.9 394.9 L 618.2 395.5 L 621.9 393.8 L 623.5 388.1 L 627.5 388.6 L 630.7 386.0 L 632.8 388.3 L 634.6 387.6 L 636.9 389.2 L 641.6 387.1 L 641.5 389.1 L 644.4 391.3 L 643.6 392.2 L 644.9 393.4 L 649.7 393.2 L 650.6 390.3 L 655.7 388.6 L 654.5 387.6 L 655.7 386.1 L 655.1 383.4 L 657.3 379.0 L 661.9 379.4 L 672.6 383.5 L 710.6 407.8 L 725.9 413.9 L 730.7 413.5 L 731.0 412.0 L 735.6 414.8 L 737.8 418.0 L 742.6 419.8 L 742.4 424.5 L 761.0 457.0 L 767.4 476.8 L 771.0 483.8 L 767.1 483.8 L 757.5 487.1 L 752.1 487.6 L 750.5 488.2 L 749.8 490.8 L 746.3 492.3 L 743.6 492.7 L 742.5 491.4 L 737.4 493.0 L 733.8 491.4 L 733.3 493.4 L 730.8 495.5 Z M 623.8 414.8 L 626.1 415.8 L 626.5 415.0 L 625.4 414.1 L 623.8 414.8 Z" },
    { zone: 37, d: "M 670.8 511.2 L 669.9 512.3 L 671.1 516.1 L 663.8 519.0 L 659.5 519.2 L 659.5 521.0 L 653.4 522.2 L 656.4 525.1 L 649.9 527.9 L 647.4 527.8 L 646.6 525.4 L 644.6 525.3 L 643.2 531.7 L 635.4 535.5 L 633.9 531.7 L 628.1 532.4 L 629.3 529.2 L 624.4 529.5 L 624.4 526.6 L 626.0 526.4 L 624.3 525.4 L 625.2 523.0 L 622.3 522.4 L 618.3 524.8 L 615.8 522.8 L 614.7 523.4 L 612.4 523.1 L 614.0 522.5 L 610.9 521.4 L 612.4 520.4 L 610.1 519.0 L 611.2 518.2 L 610.9 516.4 L 607.3 515.2 L 608.2 512.8 L 606.4 511.4 L 607.8 509.7 L 604.0 506.6 L 599.8 505.0 L 596.2 507.7 L 594.5 506.2 L 587.0 508.3 L 584.8 506.4 L 578.3 504.4 L 579.1 503.1 L 576.9 502.4 L 577.2 501.5 L 581.0 499.4 L 582.1 496.5 L 577.0 494.9 L 573.5 488.8 L 577.1 486.2 L 580.0 486.1 L 580.0 484.1 L 577.5 482.4 L 582.4 468.6 L 579.9 466.8 L 577.8 468.0 L 575.5 461.0 L 577.6 458.3 L 586.4 455.1 L 587.9 451.2 L 587.4 449.4 L 588.8 448.8 L 593.1 450.5 L 605.9 444.6 L 603.0 443.0 L 601.3 446.0 L 597.0 444.9 L 597.3 440.2 L 595.9 438.2 L 594.1 437.2 L 591.4 437.7 L 591.1 434.0 L 587.1 434.4 L 587.2 432.2 L 589.7 430.7 L 592.0 431.2 L 594.2 428.6 L 598.0 427.6 L 597.8 426.4 L 593.0 424.6 L 594.1 421.8 L 599.0 421.9 L 599.9 418.7 L 604.9 413.9 L 606.0 415.6 L 613.3 416.4 L 618.9 413.3 L 620.3 413.9 L 619.3 415.3 L 620.5 416.5 L 617.6 419.6 L 614.6 420.4 L 616.6 422.4 L 619.8 421.4 L 622.6 423.9 L 624.8 421.3 L 626.7 421.0 L 628.9 423.1 L 630.9 422.0 L 632.8 422.6 L 644.5 432.9 L 648.7 430.9 L 653.2 432.1 L 655.8 428.3 L 659.5 429.1 L 658.7 431.8 L 660.1 433.1 L 656.9 435.4 L 657.1 436.5 L 662.0 441.8 L 662.2 444.7 L 661.0 445.9 L 664.5 447.5 L 665.7 452.3 L 668.5 453.4 L 668.2 457.3 L 665.0 459.3 L 666.3 461.6 L 670.0 461.7 L 671.6 464.4 L 670.9 467.7 L 672.5 470.0 L 670.7 472.5 L 672.6 474.9 L 671.4 476.9 L 676.5 479.2 L 676.7 480.3 L 679.3 480.7 L 678.5 483.2 L 679.3 486.2 L 680.6 486.1 L 681.7 482.4 L 684.0 483.0 L 686.9 481.3 L 692.5 484.3 L 697.3 489.9 L 702.3 488.9 L 704.5 486.4 L 707.4 492.0 L 705.1 496.6 L 703.2 495.7 L 700.5 497.0 L 700.2 501.7 L 698.5 504.0 L 699.1 504.9 L 695.8 508.0 L 693.1 506.9 L 692.2 508.4 L 687.3 510.3 L 684.0 508.7 L 682.7 510.8 L 677.0 510.7 L 674.8 512.2 L 670.8 511.2 Z M 623.8 414.8 L 626.1 414.3 L 626.3 415.7 L 623.8 414.8 Z" },
    { zone: 38, d: "M 753.3 216.8 L 753.3 216.9 L 753.7 218.2 L 753.3 216.8 Z M 753.6 216.7 L 753.5 216.3 L 753.5 216.3 L 753.6 216.7 Z M 753.7 216.1 L 753.6 215.7 L 753.6 215.7 L 753.7 216.1 Z M 755.9 214.4 L 755.4 213.7 L 755.5 213.8 L 755.9 214.4 Z M 745.2 200.5 L 759.3 206.0 L 762.9 209.5 L 763.1 211.5 L 771.1 216.9 L 763.7 221.6 L 752.1 220.4 L 751.7 219.4 L 753.0 219.0 L 760.5 219.3 L 760.0 218.8 L 757.9 218.8 L 757.8 218.7 L 757.7 218.7 L 757.6 218.8 L 757.7 218.7 L 757.7 218.7 L 757.4 218.6 L 757.1 218.7 L 757.4 218.6 L 757.4 218.6 L 757.9 218.8 L 758.1 218.6 L 757.3 216.4 L 755.4 217.2 L 756.0 216.5 L 754.2 216.1 L 755.2 215.1 L 755.6 215.5 L 756.6 214.7 L 755.1 212.1 L 747.6 206.6 L 743.2 203.5 L 736.4 202.5 L 734.4 200.4 L 733.6 199.9 L 735.1 201.4 L 733.3 201.6 L 734.1 202.2 L 735.0 201.8 L 732.9 203.3 L 732.0 205.8 L 735.4 207.9 L 729.0 209.7 L 726.6 209.1 L 727.3 209.8 L 725.9 211.1 L 719.6 212.6 L 715.1 212.1 L 705.6 208.3 L 699.7 209.1 L 696.1 210.3 L 691.4 215.7 L 687.8 214.4 L 688.1 212.9 L 685.8 211.6 L 686.8 210.7 L 685.2 210.2 L 684.4 206.6 L 682.4 207.7 L 683.1 206.1 L 681.7 205.4 L 682.8 204.1 L 679.8 201.7 L 680.7 200.3 L 679.1 199.8 L 680.9 198.9 L 677.8 195.8 L 676.9 196.2 L 676.9 198.2 L 674.7 198.7 L 673.8 197.4 L 670.9 198.4 L 668.9 197.1 L 669.4 195.5 L 668.1 195.5 L 665.7 195.8 L 662.9 198.4 L 662.5 196.1 L 660.1 195.1 L 656.5 197.8 L 655.3 196.8 L 649.5 201.3 L 645.6 197.5 L 643.1 196.7 L 641.4 198.9 L 638.1 197.5 L 638.6 195.8 L 635.7 194.2 L 636.0 192.4 L 633.5 190.9 L 635.1 190.4 L 633.4 188.4 L 625.3 185.2 L 625.8 181.3 L 623.0 176.9 L 626.7 172.6 L 631.3 170.7 L 632.4 166.0 L 627.7 163.4 L 627.6 160.6 L 623.7 160.7 L 623.2 158.6 L 620.8 159.2 L 617.1 157.6 L 615.4 154.7 L 618.3 152.2 L 618.7 149.7 L 624.2 148.6 L 624.8 146.3 L 629.2 144.9 L 628.4 142.7 L 632.7 140.7 L 632.1 139.5 L 635.8 135.6 L 636.9 136.1 L 639.7 134.5 L 643.2 135.6 L 644.6 134.5 L 648.7 135.3 L 645.5 132.1 L 644.9 127.2 L 646.2 125.1 L 653.2 122.2 L 653.2 120.1 L 657.8 117.8 L 665.1 119.4 L 665.4 121.3 L 666.7 121.8 L 689.8 122.2 L 698.0 123.5 L 704.3 126.9 L 712.8 127.0 L 715.2 125.3 L 717.8 125.6 L 718.0 124.4 L 723.1 126.5 L 730.8 125.7 L 732.1 127.5 L 736.3 127.1 L 737.2 128.3 L 739.8 127.7 L 751.2 129.9 L 751.5 131.4 L 750.1 132.3 L 750.8 134.0 L 748.8 138.0 L 739.9 138.1 L 736.7 142.1 L 727.4 145.7 L 724.4 145.8 L 725.2 148.1 L 724.4 149.5 L 718.2 151.8 L 722.8 158.0 L 721.5 159.9 L 722.9 160.8 L 725.1 160.1 L 725.3 158.9 L 728.8 159.0 L 735.6 160.6 L 736.9 162.8 L 743.3 162.3 L 746.3 163.3 L 744.4 167.5 L 737.6 172.1 L 730.0 175.2 L 731.1 177.6 L 728.0 180.3 L 730.5 182.8 L 734.4 184.3 L 737.0 184.0 L 739.1 181.9 L 744.3 182.6 L 743.8 187.2 L 739.2 191.8 L 737.5 195.8 L 739.8 199.6 L 745.2 200.5 Z M 752.1 210.1 L 752.0 210.1 L 752.1 210.1 L 752.1 210.1 Z M 751.8 210.1 L 751.8 210.1 L 751.8 210.1 L 751.8 210.1 Z M 751.0 209.1 L 751.0 209.1 L 751.0 209.1 L 751.0 209.1 Z M 750.5 208.8 L 750.5 208.8 L 750.5 208.8 L 750.5 208.8 Z M 749.5 208.1 L 749.5 208.1 L 749.5 208.1 L 749.5 208.1 Z M 747.2 206.3 L 747.1 206.3 L 747.1 206.3 L 747.2 206.3 Z M 733.9 201.9 L 733.9 201.9 L 733.9 201.9 L 733.9 201.9 Z M 757.2 218.9 L 757.2 218.9 L 757.2 218.9 L 757.2 218.9 Z M 756.8 218.7 L 756.8 218.7 L 756.8 218.7 L 756.8 218.7 Z M 757.0 218.7 L 756.9 218.7 L 756.8 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.0 218.7 L 757.0 218.7 L 757.0 218.7 L 757.0 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 757.1 218.7 L 757.1 218.7 L 757.1 218.7 L 757.1 218.7 Z M 755.8 215.2 L 755.8 215.1 L 755.9 215.2 L 755.8 215.2 Z M 755.9 215.2 L 755.8 215.2 L 755.8 215.1 L 755.9 215.2 Z M 757.3 218.9 L 757.3 218.9 L 757.3 218.9 L 757.3 218.9 Z M 757.3 218.8 L 757.3 218.8 L 757.3 218.8 L 757.3 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.5 218.8 L 757.5 218.8 L 757.5 218.8 L 757.5 218.8 Z M 757.4 218.8 L 757.4 218.8 L 757.4 218.8 L 757.4 218.8 Z M 757.5 218.8 L 757.5 218.8 L 757.5 218.8 L 757.5 218.8 Z M 757.6 218.8 L 757.6 218.8 L 757.6 218.8 L 757.6 218.8 Z M 757.7 218.8 L 757.7 218.8 L 757.7 218.7 L 757.7 218.8 Z M 757.7 218.7 L 757.7 218.7 L 757.7 218.7 L 757.7 218.7 Z M 757.4 218.6 L 757.4 218.6 L 757.4 218.6 L 757.4 218.6 Z M 758.0 218.6 L 758.0 218.6 L 758.0 218.6 L 758.0 218.6 Z M 757.3 218.6 L 757.3 218.6 L 757.3 218.6 L 757.3 218.6 Z" },
    { zone: 39, d: "M 815.8 582.8 L 816.1 584.1 L 817.9 583.7 L 822.6 586.8 L 824.5 592.8 L 823.5 594.1 L 826.9 594.3 L 832.8 588.9 L 834.5 588.8 L 839.0 581.8 L 843.9 579.2 L 844.3 576.2 L 849.8 571.0 L 855.2 568.1 L 853.3 566.9 L 855.2 564.2 L 865.8 568.6 L 876.0 570.6 L 884.4 576.6 L 890.1 578.2 L 890.2 582.8 L 886.5 586.9 L 888.0 590.6 L 886.1 593.7 L 888.0 595.5 L 886.6 596.1 L 888.4 598.3 L 892.4 599.4 L 888.1 600.9 L 886.6 603.0 L 885.4 602.1 L 885.4 603.0 L 881.6 604.4 L 879.1 607.9 L 872.5 605.7 L 870.2 608.1 L 871.8 610.7 L 870.5 617.1 L 877.4 621.1 L 871.5 624.1 L 865.4 625.2 L 863.5 626.9 L 855.8 624.4 L 853.7 627.8 L 849.0 629.5 L 846.0 628.4 L 837.9 633.1 L 834.4 630.3 L 832.9 631.5 L 828.4 631.2 L 826.8 630.4 L 825.7 627.7 L 811.0 624.3 L 806.9 622.5 L 807.6 622.1 L 806.3 621.1 L 796.1 619.7 L 795.2 621.8 L 791.1 619.1 L 786.8 624.9 L 789.4 627.3 L 790.2 630.6 L 787.3 629.5 L 783.3 630.2 L 779.2 626.5 L 779.8 624.5 L 777.0 623.4 L 778.4 621.5 L 776.5 620.4 L 781.8 617.5 L 779.6 616.0 L 781.7 614.4 L 779.0 612.5 L 780.2 609.3 L 778.0 604.8 L 773.4 601.5 L 777.4 600.8 L 781.0 602.0 L 781.8 600.0 L 784.3 600.1 L 785.9 596.7 L 788.3 596.6 L 789.6 599.6 L 791.1 597.7 L 791.0 595.7 L 794.6 595.7 L 795.9 593.9 L 796.6 595.5 L 798.1 595.6 L 798.8 593.7 L 795.8 592.6 L 793.5 587.9 L 794.3 586.7 L 800.3 585.3 L 801.3 583.2 L 806.4 579.8 L 808.8 581.4 L 810.7 581.1 L 812.6 584.4 L 814.1 584.7 L 815.8 582.8 Z" },
    { zone: 40, d: "M 503.9 206.4 L 498.5 211.2 L 492.0 208.4 L 488.1 209.6 L 487.7 208.3 L 485.2 211.3 L 483.4 212.1 L 483.8 210.0 L 480.4 212.8 L 478.0 211.3 L 478.6 210.1 L 475.8 208.7 L 471.3 208.3 L 473.6 203.9 L 475.4 202.8 L 474.1 201.5 L 475.5 199.2 L 472.5 197.7 L 464.8 196.2 L 462.8 197.5 L 460.7 196.2 L 457.2 196.3 L 452.9 197.2 L 451.6 200.2 L 448.7 199.9 L 443.0 202.0 L 441.0 201.6 L 440.3 199.9 L 442.0 198.6 L 438.0 197.4 L 438.0 193.5 L 436.8 191.9 L 438.6 188.4 L 436.3 186.3 L 436.6 183.9 L 433.2 183.2 L 433.2 181.9 L 433.7 179.9 L 436.3 178.5 L 435.9 175.4 L 442.6 169.5 L 442.6 166.6 L 444.1 164.6 L 441.8 162.5 L 446.1 157.0 L 445.2 154.0 L 443.6 153.3 L 445.5 151.8 L 444.2 149.1 L 439.3 147.2 L 444.3 144.0 L 448.2 143.9 L 450.5 141.6 L 449.1 139.1 L 449.7 137.2 L 447.6 135.2 L 442.5 132.9 L 435.4 132.6 L 433.7 131.1 L 433.2 129.0 L 435.1 127.9 L 437.0 120.9 L 432.5 118.4 L 428.3 118.8 L 427.4 117.0 L 426.8 113.9 L 429.8 110.9 L 428.1 109.4 L 432.1 107.5 L 430.4 104.0 L 433.0 102.4 L 434.8 97.5 L 442.9 98.0 L 442.7 99.1 L 454.2 95.5 L 457.0 96.8 L 456.7 97.8 L 463.5 100.6 L 459.8 103.1 L 460.3 104.1 L 465.9 103.4 L 468.4 105.3 L 471.0 104.7 L 475.1 106.5 L 479.0 105.3 L 488.7 106.3 L 490.4 102.4 L 494.7 100.7 L 493.5 97.7 L 496.4 94.1 L 495.9 91.9 L 497.8 90.1 L 502.6 89.2 L 502.6 86.7 L 506.7 87.0 L 517.7 84.1 L 521.5 84.3 L 525.6 86.8 L 529.7 85.7 L 533.3 82.3 L 536.5 82.9 L 539.0 84.9 L 547.7 82.1 L 551.3 84.1 L 555.9 84.1 L 559.4 86.4 L 562.8 84.1 L 568.1 84.1 L 581.9 78.5 L 586.0 78.8 L 593.2 75.9 L 602.2 74.4 L 606.1 75.3 L 607.5 76.7 L 605.2 77.7 L 604.0 80.7 L 598.4 81.0 L 595.9 82.7 L 597.4 85.0 L 596.9 87.0 L 600.5 89.4 L 598.1 91.8 L 602.6 92.5 L 605.2 95.7 L 607.7 94.0 L 610.8 94.6 L 614.0 98.9 L 611.6 101.4 L 612.6 102.6 L 611.7 104.5 L 618.9 105.4 L 621.5 111.0 L 630.6 114.6 L 626.4 115.7 L 623.6 118.2 L 621.1 118.2 L 621.6 120.2 L 617.2 119.3 L 611.7 120.6 L 609.5 119.5 L 602.8 122.9 L 603.0 120.5 L 590.7 115.1 L 591.3 118.2 L 588.5 121.6 L 588.6 123.9 L 583.9 128.9 L 580.8 127.8 L 578.8 129.3 L 575.5 128.9 L 566.1 132.1 L 565.9 134.3 L 572.1 134.9 L 573.3 137.7 L 569.5 138.6 L 568.0 145.2 L 566.5 144.2 L 562.1 146.0 L 567.7 149.2 L 568.6 151.0 L 567.1 153.1 L 568.3 154.5 L 572.9 153.7 L 573.5 156.3 L 577.2 156.6 L 575.2 159.0 L 578.2 161.5 L 580.4 161.4 L 579.3 164.3 L 577.1 163.8 L 576.4 166.3 L 573.1 169.3 L 553.4 171.8 L 553.5 174.5 L 555.4 176.4 L 551.6 177.2 L 553.0 178.1 L 551.6 179.2 L 553.8 182.0 L 552.2 184.4 L 543.8 183.9 L 542.8 180.3 L 536.3 179.7 L 530.1 182.8 L 523.0 182.5 L 523.7 186.5 L 521.5 186.4 L 520.6 189.7 L 517.1 187.7 L 516.1 188.9 L 511.7 188.6 L 511.4 192.2 L 509.4 192.6 L 510.4 192.9 L 509.9 194.9 L 505.0 199.1 L 506.3 202.0 L 503.5 201.7 L 503.9 206.4 Z" },
    { zone: 41, d: "M 151.3 385.7 L 151.9 381.2 L 160.4 378.2 L 161.8 376.1 L 161.1 373.2 L 170.5 367.8 L 168.0 367.8 L 166.8 366.4 L 167.4 363.5 L 172.0 362.3 L 182.6 365.8 L 186.7 365.2 L 188.3 366.2 L 191.2 364.9 L 194.4 366.0 L 195.2 364.3 L 191.9 362.9 L 192.5 362.0 L 195.1 360.8 L 198.3 362.1 L 200.9 361.6 L 203.4 358.5 L 203.3 356.8 L 200.3 354.8 L 201.9 352.6 L 200.1 351.3 L 201.9 350.4 L 202.8 349.2 L 199.8 346.6 L 201.4 345.3 L 203.9 346.6 L 204.3 343.5 L 207.0 343.6 L 208.1 342.2 L 208.5 338.4 L 214.2 335.9 L 215.5 333.7 L 213.2 329.4 L 215.7 328.6 L 215.0 327.5 L 216.0 325.7 L 218.6 324.4 L 220.4 326.5 L 228.0 328.6 L 229.0 330.6 L 232.2 329.4 L 233.3 326.3 L 234.8 325.9 L 237.8 327.5 L 239.9 325.0 L 240.6 326.2 L 250.1 326.3 L 249.9 324.9 L 253.7 323.0 L 252.3 321.7 L 254.8 318.8 L 264.3 319.4 L 267.8 323.6 L 267.1 324.7 L 268.8 324.8 L 268.7 328.0 L 270.3 328.3 L 271.6 327.2 L 271.9 324.3 L 274.8 323.0 L 274.6 321.2 L 278.7 320.7 L 280.9 322.3 L 283.4 321.2 L 282.6 316.1 L 280.0 313.7 L 282.5 312.9 L 284.8 310.0 L 292.9 311.0 L 295.3 313.5 L 295.8 316.0 L 298.9 315.1 L 301.6 316.5 L 302.3 319.2 L 304.9 320.0 L 310.9 318.1 L 311.4 316.0 L 315.4 315.5 L 316.5 316.4 L 315.5 317.5 L 318.8 317.8 L 320.8 316.7 L 324.9 319.6 L 328.6 319.7 L 331.0 317.4 L 332.6 318.2 L 332.7 319.9 L 338.7 321.1 L 340.7 324.3 L 339.9 328.9 L 337.2 329.0 L 334.2 335.1 L 337.6 334.6 L 338.2 336.0 L 339.6 334.6 L 350.0 333.4 L 355.4 335.8 L 357.3 340.4 L 360.4 340.2 L 362.6 343.9 L 364.9 344.5 L 366.1 346.3 L 374.6 349.6 L 375.1 353.1 L 376.9 354.1 L 375.1 357.1 L 375.8 358.3 L 380.1 355.5 L 382.6 356.8 L 378.6 359.7 L 386.5 359.7 L 386.7 362.4 L 388.6 364.5 L 387.4 366.3 L 388.4 366.9 L 391.1 364.3 L 395.9 366.8 L 390.8 371.6 L 388.4 371.0 L 386.8 372.5 L 379.9 368.0 L 377.4 368.1 L 374.6 365.2 L 374.3 365.2 L 374.3 365.3 L 374.2 365.2 L 374.0 365.8 L 372.9 365.3 L 371.9 366.0 L 371.6 366.6 L 370.6 366.0 L 374.1 370.0 L 372.7 371.1 L 365.3 367.1 L 363.6 367.0 L 362.2 365.0 L 356.6 362.0 L 353.5 362.9 L 350.7 359.3 L 347.0 358.2 L 339.1 352.6 L 334.9 352.7 L 332.8 350.8 L 330.8 351.1 L 328.2 347.6 L 314.3 342.0 L 312.3 343.4 L 312.7 346.8 L 306.3 345.0 L 306.6 342.0 L 305.1 340.7 L 286.8 337.8 L 284.8 337.3 L 284.1 335.6 L 282.9 335.8 L 283.3 337.1 L 274.1 335.5 L 277.1 335.1 L 275.5 334.6 L 266.5 334.3 L 243.6 343.9 L 241.3 345.7 L 241.3 345.9 L 241.4 346.0 L 242.7 345.1 L 242.0 346.0 L 237.9 347.9 L 236.9 349.6 L 238.5 350.8 L 234.5 354.4 L 235.4 356.9 L 220.2 362.4 L 216.5 367.0 L 216.0 371.7 L 209.9 376.7 L 209.5 378.5 L 210.9 380.4 L 207.6 381.2 L 200.9 386.6 L 177.7 393.9 L 174.9 393.2 L 168.5 395.9 L 164.7 395.6 L 162.1 397.8 L 152.5 396.2 L 150.6 397.4 L 148.1 397.0 L 144.7 390.0 L 146.7 387.3 L 151.3 385.7 Z M 215.9 373.7 L 216.0 373.3 L 216.3 373.5 L 215.9 373.7 Z M 237.3 353.2 L 237.3 353.0 L 237.4 353.1 L 237.3 353.2 Z M 241.3 345.9 L 241.3 345.9 L 241.4 345.9 L 241.3 345.9 Z M 282.7 337.2 L 279.4 336.6 L 283.4 337.3 L 282.7 337.2 Z M 273.6 335.6 L 278.8 336.6 L 278.8 336.6 L 273.6 335.6 Z M 269.0 335.4 L 271.5 335.8 L 272.5 334.9 L 273.0 334.8 L 269.0 335.4 Z M 275.0 334.9 L 275.0 334.9 L 275.0 334.9 L 275.0 334.9 Z M 274.8 334.8 L 274.8 334.9 L 274.8 334.9 L 274.8 334.8 Z M 374.5 373.7 L 374.5 373.6 L 374.5 373.6 L 374.5 373.7 Z M 374.6 373.5 L 374.2 373.1 L 374.8 373.4 L 374.6 373.5 Z M 374.1 372.7 L 372.8 371.3 L 374.9 371.0 L 374.1 372.7 Z M 366.9 368.4 L 367.0 368.4 L 367.0 368.4 L 366.9 368.4 Z M 372.0 366.0 L 372.0 366.0 L 372.0 366.0 L 372.0 366.0 Z M 372.5 365.6 L 372.5 365.6 L 372.5 365.6 L 372.5 365.6 Z M 374.7 365.6 L 374.8 365.6 L 374.7 365.6 L 374.7 365.6 Z M 374.2 365.3 L 374.3 365.3 L 374.2 365.3 L 374.2 365.3 Z M 374.4 365.3 L 374.4 365.3 L 374.4 365.3 L 374.4 365.3 Z M 374.2 365.3 L 374.2 365.2 L 374.2 365.3 L 374.2 365.3 Z M 374.4 365.3 L 374.4 365.2 L 374.4 365.3 L 374.4 365.3 Z" },
  ];

  // Название города для нативной подсказки при наведении на регион
  const cityNameByZone = {};
  italyCities.forEach(c => { cityNameByZone[c.lesson] = c.name; });

  const zoneMarkup = (z) => {
    const isOpen = z.zone <= maxDone;
    const isNext = z.zone === maxDone + 1;
    const cls  = isOpen ? 'pv-zone pv-zone-open' : isNext ? 'pv-zone pv-zone-next' : 'pv-zone pv-zone-locked';
    const fill = isOpen ? 'url(#pvGoldFill)' : isNext ? '#E9D9A9' : '#BCAF9A';
    const tip  = cityNameByZone[z.zone] ? `<title>Урок ${z.zone} · ${cityNameByZone[z.zone]}</title>` : '';
    return `<path class="${cls}" d="${z.d}" fill="${fill}" data-zone="${z.zone}">${tip}</path>`;
  };

  // Открытые регионы — отдельной группой с золотым свечением (один композит на группу,
  // а не фильтр на каждый path — дёшево для GPU)
  const lockedPaths = ZONES.filter(z => z.zone > maxDone).map(zoneMarkup).join('');
  const openPaths   = ZONES.filter(z => z.zone <= maxDone).map(zoneMarkup).join('');

  return `<svg class="pv-map-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 1280" preserveAspectRatio="xMidYMid meet" aria-label="Карта Италии — прогресс по регионам">
    <defs>
      <linearGradient id="pvGoldFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"  stop-color="#EAC163"/>
        <stop offset="52%" stop-color="#D4A520"/>
        <stop offset="100%" stop-color="#BE8E14"/>
      </linearGradient>
      <radialGradient id="pvMarkerGrad" cx="50%" cy="38%" r="70%">
        <stop offset="0%"  stop-color="#E06A4C"/>
        <stop offset="100%" stop-color="#A8442E"/>
      </radialGradient>
      <filter id="pvGlow" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#E2B457" flood-opacity="0.55"/>
      </filter>
      <filter id="pvMapShadow" x="-15%" y="-15%" width="130%" height="130%">
        <feDropShadow dx="0" dy="9" stdDeviation="11" flood-color="#5A3A18" flood-opacity="0.24"/>
      </filter>
    </defs>
    <g filter="url(#pvMapShadow)">
      <g class="pv-zones-locked">${lockedPaths}</g>
      <g class="pv-zones-open" filter="url(#pvGlow)">${openPaths}</g>
    </g>
    <g class="pv-marker-layer" id="pvMarkerLayer"></g>
  </svg>`;
}

// ============ УРОВЕНЬ ВЛАДЕНИЯ CEFR ============
// 41 урок покрывает путь от нуля до уверенного A2.
// Пороги привязаны к реальному плану курса (43 занятия, LESSON_STAGES/LESSON_SPECIAL):
// A0 (0), A0+ (3), A1 (8, к концу этапа 1 занятие 15 — аттестация А1), A1+ (16, старт этапа 2),
// A2- (26), A2 (35), A2+ (43 — курс полностью пройден, включая оба экзамена 42-43).
function getCEFRLevel(doneCount) {
  const levels = [
    { min: 0,  code: 'A0',  label: 'Начинающий',          nextAt: 3,  desc: 'Первые слова итальянского' },
    { min: 3,  code: 'A0+', label: 'Начинающий+',         nextAt: 8,  desc: 'Базовые фразы и приветствия' },
    { min: 8,  code: 'A1',  label: 'Элементарный',        nextAt: 16, desc: 'Могу представиться и говорить о себе' },
    { min: 16, code: 'A1+', label: 'Элементарный+',       nextAt: 26, desc: 'Понимаю простые тексты и диалоги' },
    { min: 26, code: 'A2−', label: 'Ниже среднего',       nextAt: 35, desc: 'Справляюсь в повседневных ситуациях' },
    { min: 35, code: 'A2',  label: 'Ниже среднего',       nextAt: PLANNED_TOTAL, desc: 'Уверенно общаюсь на базовые темы' },
    { min: PLANNED_TOTAL, code: 'A2+', label: 'На пути к B1', nextAt: null, desc: 'Курс пройден — открыт уровень B1!' },
  ];
  let current = levels[0];
  for (const lvl of levels) {
    if (doneCount >= lvl.min) current = lvl;
  }
  // Прогресс внутри текущего уровня (0–100%)
  const nextLevel = levels.find(l => l.min === current.nextAt);
  let pct = 100;
  if (nextLevel) {
    const range = nextLevel.min - current.min;
    const done = doneCount - current.min;
    pct = Math.min(100, Math.round((done / range) * 100));
  }
  return { ...current, pct, nextCode: nextLevel ? nextLevel.code : null };
}

// Звучат как звания/титры — взросло, с лёгким эпическим оттенком, без наивных "бейджиков".
// Иконки — тонкие линейные SVG (один path/набор линий), не эмодзи.
function getProgressTitle(doneCount) {
  const tiers = [
    { min: 0,  text: 'Новичок на пороге Италии',
      svg: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 7L13.4 12L12 17L10.6 12Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/><path d="M12 7L13.4 12L10.6 12Z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="0.85" fill="currentColor" stroke="none"/><path d="M12 3.4V4.9M12 19.1V20.6M3.4 12H4.9M19.1 12H20.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>' },
    { min: 1,  text: 'Путник с разговорником',
      svg: '<rect x="4" y="3" width="11" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M7 7H12M7 10H12M7 13H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/><path d="M15 6H18C18.6 6 19 6.4 19 7V20C19 20.6 18.6 21 18 21H8C7.4 21 7 20.6 7 20V17" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>' },
    { min: 4,  text: 'Первооткрыватель апеннинских дорог',
      svg: '<path d="M3 17L7 7L10 13L13 7L17 17" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M1 17H19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="20" cy="9" r="2.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M20 6V4M20 14V12M17 9H15M25 9H23M18.2 7.2L16.8 5.8M23.2 12.2L21.8 10.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.7"/>' },
    { min: 8,  text: 'Покоритель итальянских улиц',
      svg: '<path d="M5 21V10.5L12 4L19 10.5V21" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M9 21V15H15V21" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M12 4V2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="9.5" y="9" width="5" height="4" rx="0.5" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.7"/>' },
    { min: 13, text: 'Свой человек в трактире',
      svg: '<path d="M7 3V11C7 12.7 8.3 14 10 14V21M10 14C11.7 14 13 12.7 13 11V3M10 3V8M7 3H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M17 21V13C17 13 15.2 11.8 15.2 9.5C15.2 7.2 17 3 17 3C17 3 18.8 7.2 18.8 9.5C18.8 11.8 17 13 17 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17" cy="9.5" r="1.2" stroke="currentColor" stroke-width="1" fill="none" opacity="0.5"/>' },
    { min: 19, text: 'Голос с акцентом Флоренции',
      svg: '<path d="M12 3C9.5 3 7.5 5.5 7.5 8.5C7.5 12 10 14.5 12 15.5C14 14.5 16.5 12 16.5 8.5C16.5 5.5 14.5 3 12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><circle cx="12" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.6"/><path d="M7 19C7 19 8 17 12 17C16 17 17 19 17 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M5 22C5 22 7 20 12 20C17 20 19 22 19 22" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" opacity="0.5"/>' },
    { min: 26, text: 'Хозяин итальянской речи',
      svg: '<path d="M12 2L20 6V11.5C20 16.5 16.5 20.5 12 22C7.5 20.5 4 16.5 4 11.5V6L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M9 11.5L11.2 13.8L15.5 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
    { min: 33, text: 'Душа Рима, разум Тосканы',
      svg: '<path d="M12 2L14 8.5L21 10.5L14 12.5L12 19L10 12.5L3 10.5L10 8.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/><circle cx="12" cy="10.5" r="2" stroke="currentColor" stroke-width="1.1" fill="none" opacity="0.5"/><path d="M12 19V22M9.5 21L12 22L14.5 21" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>' },
    { min: 39, text: 'Полиглот да Винчи',
      svg: '<ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="currentColor" stroke-width="1.4" fill="none"/><ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="currentColor" stroke-width="1.4" fill="none" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="currentColor" stroke-width="1.4" fill="none" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.3" fill="none"/>' },
  ];
  let current = tiers[0];
  for (const tier of tiers) {
    if (doneCount >= tier.min) current = tier;
  }
  return current;
}

function statusIconSvg(innerPaths) {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${innerPaths}</svg>`;
}

const ICON_CHECK_HTML = '<span class="ico ico-check"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 12.5L9 17L19.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
const ICON_LOCK_CLOSED_HTML = '<span class="ico"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="11" width="14" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 11V8.5C7.5 6 9.5 4 12 4C14.5 4 16.5 6 16.5 8.5V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="15.3" r="1.3" fill="currentColor"/></svg></span>';
const ICON_LOCK_OPEN_HTML = '<span class="ico"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="11" width="14" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 11V8.5C7.5 6 9.5 4 12 4C14 4 15.7 5.3 16.3 7.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="15.3" r="1.3" fill="currentColor"/></svg></span>';
const ICON_NOTE_HTML = '<span class="ico"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.5 4.5C17.4 3.6 18.8 3.6 19.6 4.5C20.5 5.3 20.5 6.7 19.6 7.6L9 18.2L4.5 19.5L5.8 15L16.5 4.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><path d="M14.5 6.5L17.5 9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>';
const ICON_SPARKLE_HTML = '<span class="ico ico-sparkle"><svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 3C12.3 6.2 13.1 8.5 14.3 10C15.5 11.5 17.5 12.4 20.5 12.7C17.5 13 15.5 13.9 14.3 15.4C13.1 16.9 12.3 19.2 12 22.4C11.7 19.2 10.9 16.9 9.7 15.4C8.5 13.9 6.5 13 3.5 12.7C6.5 12.4 8.5 11.5 9.7 10C10.9 8.5 11.7 6.2 12 3Z"/></svg></span>';

const ICON_CITY = '<path d="M3 6.5L9 4L15 6.5L21 4V17.5L15 20L9 17.5L3 20V6.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/><path d="M9 4V17.5M15 6.5V20" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/><circle cx="12" cy="11" r="1.7" fill="currentColor" stroke="none"/>';
const ICON_BOOK = '<path d="M12 4L22 8.5L12 13L2 8.5L12 4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M6 10.3V14.6C6 14.6 8.4 16.6 12 16.6C15.6 16.6 18 14.6 18 14.6V10.3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/><path d="M22 8.5V13.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="22" cy="13.8" r="0.8" fill="currentColor" stroke="none"/>';

// ============ ДНЕВНИК ПРОГРЕССА v3 ============
// Карта-доминанта слева (~65% ширины), информационная панель справа.
// Экран целиком помещается в один вьюпорт без прокрутки (desktop ≥ 1024px);
// на мобильных колонки складываются и экран прокручивается как обычно.

// Количество остановок маршрута = длина списка городов. Добавишь город в italyCities —
// карта, маршрут и подписи пересчитаются сами, руками число нигде не меняется.
const PV_TOTAL_STOPS = italyCities.length;

// Оценка времени обучения: урок ~75 мин + домашнее задание ~70 мин ≈ 2.4 ч на урок
function pvEstimateHours(doneCount) {
  return Math.round(doneCount * 2.4);
}

// Слова из пройденных уроков — реальные данные из таблиц лексики
function pvLearnedWordsCount(completedSet) {
  try {
    return buildVocabPool().filter(w => completedSet.has(w.lesson)).length;
  } catch (e) { return 0; }
}

// Темы грамматики — по подзаголовкам пройденных уроков («Алфавит, произношение, …»)
function pvGrammarTopicsCount(completedSet) {
  let n = 0;
  lessons.forEach(l => {
    if (completedSet.has(l.number) && l.subtitle) n += l.subtitle.split(',').length;
  });
  return n;
}

// Ступень «жара» серии — управляет яркостью пламени и количеством искр (CSS)
function renderProgressScreen() {
  const completed = getCompletedLessonNumbers();
  const completedSet = new Set(completed);
  const doneCount = completed.length;
  const maxDone = completed.length ? Math.max(...completed) : 0;
  const streak = getCurrentStreak();
  const streakData = getStreakData();
  const cefrLevel = getCEFRLevel(doneCount);
  const title = getProgressTitle(doneCount);
  const coursePct = Math.min(100, Math.round((doneCount / PV_TOTAL_STOPS) * 100));

  // Карта — это 41 реальный регион Италии, а курс идёт до 43 занятий (два финальных
  // экзамена 42-43 идут уже без новых регионов). Все обращения к italyCities/маршруту
  // используют mapProgress — maxDone, прижатый к границам карты, — иначе на последних
  // двух уроках индекс вылетает за массив и панель откатывается на «Начало пути».
  const mapProgress = Math.min(maxDone, PV_TOTAL_STOPS);
  const hereCity = mapProgress > 0 ? italyCities[mapProgress - 1] : null;
  const nextCity = maxDone < PV_TOTAL_STOPS ? italyCities[maxDone] : null;

  // — Маршрут: окно из 5 остановок. У начала — первые 5, у конца — прижимается
  // к последним 5, чтобы не схлопнуться в пустой список на завершающих занятиях —
  const from = Math.max(0, Math.min(mapProgress - 2, PV_TOTAL_STOPS - 5));
  const to = Math.min(PV_TOTAL_STOPS, from + 5);
  const stops = [];
  for (let i = from; i < to; i++) {
    const c = italyCities[i];
    // «ты здесь» — последний открытый город (совпадает с маркером на карте);
    // «следующая» — ближайший неоткрытый; остальное — пройдено / впереди.
    let st;
    if (mapProgress > 0 && c.lesson === mapProgress) st = 'here';
    else if (completedSet.has(c.lesson)) st = 'done';
    else if (c.lesson === maxDone + 1) st = 'next';
    else st = 'ahead';
    stops.push({ ...c, st });
  }
  const restCount = PV_TOTAL_STOPS - to;

  const stopDot = (st) => {
    if (st === 'done') return '<span class="pv-stop-dot"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5L10 17.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    if (st === 'here') return '<span class="pv-stop-dot"><i class="pv-stop-pulse"></i></span>';
    return '<span class="pv-stop-dot"></span>';
  };
  const stopMeta = { done: 'пройден', here: 'ты здесь', next: 'следующая', ahead: 'впереди' };
  const routeItems = stops.map(s => `
    <li class="pv-stop pv-stop-${s.st}">
      ${stopDot(s.st)}
      <span class="pv-stop-name">${s.name}</span>
      <span class="pv-stop-meta">Урок ${s.lesson} · ${stopMeta[s.st]}</span>
    </li>`).join('');

  const words = pvLearnedWordsCount(completedSet);
  const topics = pvGrammarTopicsCount(completedSet);
  const hours = pvEstimateHours(doneCount);
  const studyDaysN = (streakData.studyDays || []).length;
  const flameTier = getFlameTier(streak);
  const flameLit = visitedToday();
  const streakWord = streak === 1 ? 'день в пути' : (streak % 10 >= 2 && streak % 10 <= 4 && (streak < 10 || streak > 20) ? 'дня в пути' : 'дней в пути');

  const statTile = (icon, value, label, sub) => `
    <div class="pv-stat">
      <span class="pv-stat-ico">${statusIconSvg(icon)}</span>
      <span class="pv-stat-value" data-count="${value}">0</span>
      <span class="pv-stat-label">${label}</span>
      ${sub ? `<span class="pv-stat-sub">${sub}</span>` : ''}
    </div>`;

  const ICO_WORDS = '<rect x="4" y="3.5" width="16" height="17" rx="2.4" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M8 8H16M8 11.5H16M8 15H12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';
  const ICO_GRAMMAR = '<path d="M12 4C9 6.2 6.4 6.6 4 6.5V13C4 17 7.2 19.6 12 21C16.8 19.6 20 17 20 13V6.5C17.6 6.6 15 6.2 12 4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M9.2 12.4L11.3 14.5L15 10.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  const ICO_HW = '<path d="M9.5 4H17.5C18.6 4 19.5 4.9 19.5 6V18C19.5 19.1 18.6 20 17.5 20H6.5C5.4 20 4.5 19.1 4.5 18V9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M4.5 9L9.5 4V8C9.5 8.55 9.05 9 8.5 9H4.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M9 14L11.2 16.2L15.5 11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  const ICO_TIME = '<circle cx="12" cy="12.5" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 8V12.7L15.2 14.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M9.5 3H14.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  const ICO_PIN = '<path d="M12 21.5C12 21.5 18.5 14.8 18.5 9.5C18.5 5.9 15.6 3 12 3C8.4 3 5.5 5.9 5.5 9.5C5.5 14.8 12 21.5 12 21.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><circle cx="12" cy="9.5" r="2.6" stroke="currentColor" stroke-width="1.4" fill="none"/>';

  progressScreen.innerHTML = `
  <div class="pv">
    <header class="pv-top">
      <div class="pv-heading">
        <h2 class="pv-title">Дневник прогресса</h2>
        <p class="pv-sub">${title.text} · ${cefrLevel.desc}</p>
      </div>
      <div class="pv-level">
        <span class="pv-level-cap">уровень</span>
        <span class="pv-level-code">${cefrLevel.code}</span>
        <span class="pv-level-track"><span class="pv-level-fill" style="width:${cefrLevel.pct}%"></span></span>
        <span class="pv-level-next">${cefrLevel.nextCode ? 'далее ' + cefrLevel.nextCode : 'максимум'}</span>
      </div>
    </header>

    <div class="pv-grid">
      <section class="pv-map-panel">
        <div class="pv-map-head">
          <div class="pv-map-head-text">
            <span class="pv-map-title"><span class="pv-map-title-ico">${statusIconSvg(ICO_PIN)}</span>Карта путешествия</span>
            <span class="pv-map-count"><b data-count="${doneCount}">0</b>&nbsp;из ${PV_TOTAL_STOPS} ${storyPlural(PV_TOTAL_STOPS, 'региона', 'регионов', 'регионов')} открыто</span>
          </div>
          <div class="pv-map-bar"><span class="pv-map-bar-fill" style="width:${coursePct}%"></span></div>
        </div>
        <div class="pv-map-stage">${buildItalyMapSVG()}</div>
        <div class="pv-map-legend">
          <span class="pv-leg"><i class="pv-leg-dot pv-leg-open"></i>Открыто</span>
          <span class="pv-leg"><i class="pv-leg-dot pv-leg-next"></i>Следующий регион</span>
          <span class="pv-leg"><i class="pv-leg-dot pv-leg-lock"></i>Предстоит</span>
        </div>
      </section>

      <aside class="pv-rail">
        <div class="pv-card pv-now">
          <div class="pv-now-col">
            <span class="pv-cap">Ты сейчас</span>
            <span class="pv-now-city">${hereCity ? hereCity.name : 'Начало пути'}</span>
          </div>
          <span class="pv-now-arrow"><svg viewBox="0 0 24 24" fill="none"><path d="M4 12H20M20 12L13.5 5.5M20 12L13.5 18.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <div class="pv-now-col pv-now-colnext">
            <span class="pv-cap">Следующая остановка</span>
            <span class="pv-now-city pv-now-citynext">${nextCity ? nextCity.name : 'Курс пройден!'}</span>
          </div>
        </div>

        <div class="pv-card pv-route">
          <span class="pv-cap">Маршрут по Италии</span>
          <ol class="pv-route-list">${routeItems}</ol>
          ${restCount > 0 ? `<span class="pv-route-rest">… и ещё ${restCount} остановок впереди</span>` : ''}
        </div>

        <div class="pv-stats">
          ${statTile(ICO_WORDS, words, 'слов изучено', '')}
          ${statTile(ICO_GRAMMAR, topics, 'тем грамматики', '')}
          ${statTile(ICO_HW, doneCount, 'домашних сдано', '')}
          ${statTile(ICO_TIME, hours, 'часов обучения', studyDaysN ? studyDaysN + ' дн. занятий' : '')}
        </div>

        <div class="pv-card pv-streak flame-tier-${flameTier}${flameLit ? '' : ' flame-dormant'}">
          <span class="pv-streak-flame">${flameSvgMarkup(flameTier)}</span>
          <div class="pv-streak-text">
            <span class="pv-streak-value"><b data-count="${streak}">0</b> ${streakWord}</span>
            <span class="pv-streak-label">${FLAME_TIERS[flameTier].name}${flameLit ? '' : ' · сегодня ещё не горел'}</span>
          </div>
        </div>
      </aside>
    </div>
  </div>`;
}

// Подгоняет viewBox под реальные границы регионов (убирает пустые поля SVG)
// и ставит маркер текущего региона. Вызывается после вставки SVG в DOM (нужен getBBox).
function pvMountMap() {
  const svg = progressScreen.querySelector('.pv-map-svg');
  if (!svg) return;
  const zones = svg.querySelectorAll('.pv-zone');
  if (!zones.length) return;

  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  zones.forEach(p => {
    const b = p.getBBox();
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
  });
  const size = Math.max(x2 - x1, y2 - y1);
  const pad = size * 0.05;
  svg.setAttribute('viewBox', `${(x1 - pad).toFixed(1)} ${(y1 - pad).toFixed(1)} ${(x2 - x1 + pad * 2).toFixed(1)} ${(y2 - y1 + pad * 2).toFixed(1)}`);

  const completed = getCompletedLessonNumbers();
  const maxDone = completed.length ? Math.max(...completed) : 0;
  // Маркер стоит на последнем открытом городе («ты здесь»); до старта — на первом.
  // Карта — 41 регион, а курс идёт до 43 занятий (финальные экзамены без новых
  // регионов), поэтому прижимаем к границе карты — иначе на уроках 42-43 маркер
  // ищет несуществующую зону и просто не рисуется.
  const targetZone = maxDone >= 1 ? Math.min(maxDone, PV_TOTAL_STOPS) : 1;
  pvPlaceMarker(svg, targetZone, size);
}

function pvMarkerMarkup(scale) {
  return `
    <g class="pv-marker" style="transform: scale(${scale.toFixed(3)})">
      <circle class="pv-marker-ring pv-marker-ring1" r="30"/>
      <circle class="pv-marker-ring pv-marker-ring2" r="30"/>
      <g class="pv-marker-pin">
        <path d="M0 6 C -11 -8 -17 -14 -17 -25 A 17 17 0 1 1 17 -25 C 17 -14 11 -8 0 6 Z" fill="url(#pvMarkerGrad)" stroke="#FFF6E8" stroke-width="2.4"/>
        <circle cx="0" cy="-25" r="6" fill="#FFF6E8"/>
      </g>
    </g>`;
}

function pvZoneCenter(svg, zoneNumber) {
  const p = svg.querySelector(`.pv-zone[data-zone="${zoneNumber}"]`);
  if (!p) return null;
  const b = p.getBBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function pvPlaceMarker(svg, zoneNumber, mapSize) {
  const layer = svg.querySelector('#pvMarkerLayer');
  const c = pvZoneCenter(svg, zoneNumber);
  if (!layer || !c) return;
  layer.innerHTML = pvMarkerMarkup(mapSize / 640);
  layer.style.transform = `translate(${c.x}px, ${c.y}px)`;
}

// Плавный пересчёт цифр (rAF, transform-free — меняется только textContent)
function pvAnimateCounters(rootEl) {
  const els = (rootEl || progressScreen).querySelectorAll('[data-count]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.forEach(el => {
    const target = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (reduced || target === 0) { el.textContent = target; return; }
    const dur = 950;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function showProgress() {
  currentOpenLessonId = null;
  welcomeScreen.classList.add('hidden');
  lessonScreen.classList.add('hidden');
  progressScreen.classList.remove('hidden');
  document.getElementById('progressNavBtn').classList.add('active');
  document.getElementById('homeNavBtn').classList.remove('active');
  renderNav(null);
  renderProgressScreen();
  document.querySelector('.main').scrollTo(0, 0);
  pvMountMap();
  pvAnimateCounters();
}

// ============ АНИМАЦИЯ ЗАВЕРШЕНИЯ УРОКА (~2 секунды) ============
// Последовательность: регион плавно заливается золотом → маркер переезжает
// на следующий город → цифры пересчитываются → пламя вспыхивает → сообщение.
function pvCelebrate(lessonNumber) {
  showProgress();
  const svg = progressScreen.querySelector('.pv-map-svg');
  if (!svg) return;

  // Карта — 41 регион; занятия 42-43 (финальные экзамены) идут уже без новых
  // регионов, поэтому для них пропускаем «прорастание»/переезд маркера и ниже
  // показываем отдельное поздравление вместо «Регион открыт».
  const hasRegion = lessonNumber <= PV_TOTAL_STOPS;

  if (hasRegion) {
    // 1) Свежеоткрытый регион: мягкое «прорастание» золота
    const freshPath = svg.querySelector(`.pv-zone[data-zone="${lessonNumber}"]`);
    if (freshPath) freshPath.classList.add('pv-zone-bloom');

    // 2) Маркер переезжает с прежнего города на только что открытый («ты здесь»)
    const layer = svg.querySelector('#pvMarkerLayer');
    const fromC = pvZoneCenter(svg, Math.max(lessonNumber - 1, 1));
    const toC = pvZoneCenter(svg, lessonNumber);
    if (layer && fromC && toC) {
      layer.style.transition = 'none';
      layer.style.transform = `translate(${fromC.x}px, ${fromC.y}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        layer.style.transition = 'transform 1.1s cubic-bezier(0.22, 0.61, 0.36, 1)';
        layer.style.transform = `translate(${toC.x}px, ${toC.y}px)`;
      }));
    }
  }

  // 3) Вспышка пламени серии
  const streakCard = progressScreen.querySelector('.pv-streak');
  if (streakCard) {
    streakCard.classList.add('pv-streak-flare');
    setTimeout(() => streakCard.classList.remove('pv-streak-flare'), 1800);
  }

  // 4) Сообщение — о новом регионе, либо (для финальных экзаменов 42-43,
  // у которых нет региона на карте) отдельное поздравление с курсом
  const pvRoot = progressScreen.querySelector('.pv');
  const city = hasRegion ? italyCities[lessonNumber - 1] : null;
  let toastCap = null, toastBody = null;
  if (city) {
    toastCap = 'Регион открыт';
    toastBody = city.name;
  } else if (lessonNumber === PV_TOTAL_STOPS + 1) {
    toastCap = 'Экзамен сдан';
    toastBody = 'Ещё один шаг до финиша';
  } else if (lessonNumber >= PLANNED_TOTAL) {
    toastCap = 'Курс пройден!';
    toastBody = 'Уровень А2 покорён';
  }
  if (toastCap && pvRoot) {
    const toast = document.createElement('div');
    toast.className = 'pv-toast';
    toast.innerHTML = `<span class="pv-toast-cap">${toastCap}</span><span class="pv-toast-city">${toastBody}</span>`;
    pvRoot.appendChild(toast);
    setTimeout(() => toast.classList.add('pv-toast-out'), 2300);
    setTimeout(() => toast.remove(), 2900);
  }
}

document.getElementById('progressNavBtn').addEventListener('click', () => {
  showProgress();
  closeSidebar();
});

// ============ МИГРАЦИЯ СТАРЫХ ДАННЫХ ============
// Если раньше данные хранились под старыми ключами — переносим их, чтобы ничего не потерялось
(function migrateOldData() {
  try {
    const OLD_HW_KEY = 'italian_course_hw_status';
    const OLD_STREAK_KEY = 'italian_course_streak';
    const NEW_HW_KEY = STORAGE_PREFIX + HW_STORAGE_KEY;
    const NEW_STREAK_KEY = STORAGE_PREFIX + STREAK_STORAGE_KEY;

    if (!localStorage.getItem(NEW_HW_KEY)) {
      const old = localStorage.getItem(OLD_HW_KEY);
      if (old) {
        localStorage.setItem(NEW_HW_KEY, old);
        storageSet(HW_STORAGE_KEY, JSON.parse(old)); // запишем и в cookie
      }
    }
    if (!localStorage.getItem(NEW_STREAK_KEY)) {
      const old = localStorage.getItem(OLD_STREAK_KEY);
      if (old) {
        localStorage.setItem(NEW_STREAK_KEY, old);
        storageSet(STREAK_STORAGE_KEY, JSON.parse(old));
      }
    }
  } catch(e) {}
})();

// init — сначала подключаем все найденные файлы уроков (lessons/lesson-N.html),
// затем рисуем меню и карточку текущего урока.
(async function initLessons() {
  const grid = document.getElementById('lessonGrid');
  const nav = document.getElementById('navList');
  if (grid) grid.innerHTML = '<p style="padding:16px 4px;color:#9a8f80;font-size:14px;">Загрузка уроков…</p>';
  if (nav) nav.innerHTML = '<p style="padding:16px;color:#9a8f80;font-size:13px;">Загрузка…</p>';

  lessons = await discoverLessons();

  // Бейдж «N занятий» на главной — из плана курса, не из вёрстки
  const planBadge = document.getElementById('planBadgeCount');
  if (planBadge) planBadge.textContent = `${PLANNED_TOTAL} ${storyPlural(PLANNED_TOTAL, 'занятие', 'занятия', 'занятий')}`;

  renderLessonGrid();
  renderNav(null);
  initStreakFlame();
  renderVocabTrainer();
  renderVocabIdea2();
})();

// ============ SCROLL REVEAL (Design System v3) ============
// Секции уроков и карточки мягко проявляются при входе в кадр.
// IntersectionObserver + MutationObserver: новые элементы (экраны рендерятся
// через innerHTML) подхватываются автоматически, без ручных вызовов.
(function dsScrollReveal() {
  if (!('IntersectionObserver' in window)) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;

  const SELECTOR = '.content .section, .lesson-card, .video-card, .summary-box';
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('ds-in');
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

  const register = (rootEl) => {
    rootEl.querySelectorAll(SELECTOR).forEach(el => {
      if (el.classList.contains('ds-reveal')) return;
      el.classList.add('ds-reveal');
      io.observe(el);
    });
  };

  const mainEl = document.querySelector('.main');
  if (!mainEl) return;
  register(mainEl);
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) register(node);
      }
    }
  });
  mo.observe(mainEl, { childList: true, subtree: true });
})();
