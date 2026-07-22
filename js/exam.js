// ============ ФИНАЛЬНЫЙ ПИСЬМЕННЫЙ ЭКЗАМЕН (lesson-43, «data-final-exam») ============
// Урок кладёт в раздел один холдер:
//   <div class="final-exam" data-final-exam>
//     <script type="application/json">{"questions":[…],"lettura":[…],"ascolto":[…],"produzione":[…]}</script>
//   </div>
// Типы автопроверяемых вопросов (в "questions" и внутри "lettura[].questions"):
//   single     — {"type":"single","q":"…","options":[…],"correct":0,"explain":"…"}
//   multi      — {"type":"multi","options":[…],"correct":[0,2],"explain":"…"} (несколько верных)
//   text       — {"type":"text","correct":"слово" | ["вариант1","вариант2"],"explain":"…"}
//   truefalse  — {"type":"truefalse","correct":true|false,"explain":"…"}
//   match      — {"type":"match","left":[…],"right":[…],"correct":[индексы right по порядку left]}
// "ascolto[]" — те же поля single + "say" (текст для window.speakIt), без явного "type".
// "produzione[]" — {"prompt":"…","minSentences":N}, не проверяется автоматически, уходит в ИИ-фидбек.
//
// Балл считается по всем автопроверяемым вопросам сразу (лексика+грамматика+чтение+аудирование).
// Результат (последняя и лучшая попытка) сохраняется в localStorage под ключом 'final_exam'
// и синхронизируется через реестр CLOUD_KEYS в app.js (см. FINAL_EXAM_KEY / mergeFinalExam там же).

(function () {
  const EXAM_STORAGE_KEY = 'final_exam';
  const AI_FEEDBACK_URL = 'http://localhost:3002/api/exam-feedback';

  const EXAM_BADGES = [
    { min: 90, cls: 'exc',  label: 'Eccellente',  note: 'Курс освоен уверенно — можно закрывать A2.' },
    { min: 75, cls: 'good', label: 'Molto bene',  note: 'Отдельные пробелы, но база прочная.' },
    { min: 60, cls: 'ok',   label: 'Sufficiente', note: 'Стоит точечно повторить темы с низким процентом ниже.' },
    { min: 0,  cls: 'low',  label: 'Da ripetere', note: 'Рекомендовано отдельное занятие-повтор перед завершением курса.' },
  ];
  function badgeFor(pct) { return EXAM_BADGES.find(b => pct >= b.min) || EXAM_BADGES[EXAM_BADGES.length - 1]; }

  const LISTEN_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M18.07 5.93a9 9 0 0 1 0 12.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  // Лавровый венок со звездой — эмблема стартового экрана экзамена
  const LAUREL_ICON = '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M32 12l3.4 6.9 7.6 1.1-5.5 5.4 1.3 7.6L32 29.4l-6.8 3.6 1.3-7.6-5.5-5.4 7.6-1.1z" fill="currentColor"/>' +
    '<path d="M15.5 26c-2.8 8.6-.9 17.6 5.8 24.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M48.5 26c2.8 8.6.9 17.6-5.8 24.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M14.8 32.5c3.1-.4 5.6.8 7 3.1-3.1.5-5.6-.7-7-3.1z" fill="currentColor"/>' +
    '<path d="M15.6 39.4c3-.1 5.4 1.3 6.5 3.8-3.1.2-5.4-1.2-6.5-3.8z" fill="currentColor"/>' +
    '<path d="M17.8 45.8c2.9.3 5 1.9 5.9 4.5-3-.2-5.1-1.8-5.9-4.5z" fill="currentColor"/>' +
    '<path d="M49.2 32.5c-3.1-.4-5.6.8-7 3.1 3.1.5 5.6-.7 7-3.1z" fill="currentColor"/>' +
    '<path d="M48.4 39.4c-3-.1-5.4 1.3-6.5 3.8 3.1.2 5.4-1.2 6.5-3.8z" fill="currentColor"/>' +
    '<path d="M46.2 45.8c-2.9.3-5 1.9-5.9 4.5 3-.2 5.1-1.8 5.9-4.5z" fill="currentColor"/></svg>';

  function examEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  function examGapify(s) { return examEsc(s).replace(/_{2,}/g, '<span class="exam-gap"></span>'); }
  function examNorm(s) {
    return String(s == null ? '' : s).toLowerCase().trim()
      .replace(/[''`´]/g, "'")
      .replace(/\s+/g, ' ');
  }
  // Снять диакритику: «perché» → «perche», «città» → «citta». Для мягкой проверки акцентов.
  function stripAccents(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  // Расстояние Левенштейна — распознаём опечатку «в один символ» (settantoto → settantotto).
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  // Умная проверка текстового ответа. Возвращает статус:
  //   correct/exact  — точное совпадение (в балл);
  //   correct/accent — верно, но потерян акцент (в балл, с мягкой пометкой);
  //   near/typo      — одна опечатка в слове ≥4 симв. (НЕ в балл, но фиксируем близость);
  //   wrong          — мимо.
  function gradeTextAnswer(userVal, correct) {
    const accepted = (Array.isArray(correct) ? correct : [correct]).map(examNorm);
    const u = examNorm(userVal);
    if (!u) return { status: 'wrong', kind: 'empty' };
    if (accepted.some(a => a === u)) return { status: 'correct', kind: 'exact' };
    const uNoAcc = stripAccents(u);
    if (accepted.some(a => stripAccents(a) === uNoAcc)) return { status: 'correct', kind: 'accent' };
    const near = accepted.some(a => {
      const an = stripAccents(a);
      if (Math.max(an.length, uNoAcc.length) < 4) return false;
      return levenshtein(an, uNoAcc) <= 1;
    });
    return near ? { status: 'near', kind: 'typo' } : { status: 'wrong', kind: 'wrong' };
  }
  // Тип вопроса → навык (узнавание vs активная продукция) + человекочитаемое имя.
  const TYPE_META = {
    single:    { skill: 'recognition', label: 'Выбор варианта' },
    listen:    { skill: 'recognition', label: 'Аудирование' },
    truefalse: { skill: 'recognition', label: 'Верно / неверно' },
    multi:     { skill: 'recognition', label: 'Множественный выбор' },
    match:     { skill: 'recognition', label: 'Сопоставление' },
    text:      { skill: 'production',  label: 'Ввод формы' },
  };
  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} с`;
    const m = Math.floor(s / 60), r = s % 60;
    return r ? `${m} мин ${r} с` : `${m} мин`;
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function ruPlural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  // Скролл к вопросу + короткая золотая подсветка (используют «прыжок к пропуску» и штурман по ошибкам)
  function flashQuestion(qEl) {
    qEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    qEl.classList.remove('exam-q-flash');
    void qEl.offsetWidth;
    qEl.classList.add('exam-q-flash');
    setTimeout(() => qEl.classList.remove('exam-q-flash'), 1600);
  }

  // ── Точка входа: вызывается из showLesson() в app.js, как и initLessonGames ──
  function initFinalExam(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-final-exam]').forEach(holder => {
      let bank = null;
      const src = holder.querySelector('script[type="application/json"]');
      try { bank = JSON.parse(src ? src.textContent : ''); }
      catch (e) { console.error('[exam] не удалось разобрать банк вопросов', e); }
      if (!bank || !Array.isArray(bank.questions)) { holder.style.display = 'none'; return; }
      bank.lettura = bank.lettura || [];
      bank.ascolto = bank.ascolto || [];
      bank.produzione = bank.produzione || [];
      buildFinalExam(holder, bank);
    });
  }

  // Раздел (section) — крупная группа для компактной сводки результата: всего 4 штуки
  // вместо ~50 мелких «тем» (q.cat). Порядок фиксирован для стабильного вывода.
  const SECTION_ORDER = ['Лексика', 'Грамматика', 'Чтение', 'Аудирование'];
  function buildGradedList(bank) {
    const list = bank.questions.map(q => ({ ...q, section: q.block === 'grammatica' ? 'Грамматика' : 'Лексика' }));
    bank.lettura.forEach(l => l.questions.forEach(q => list.push({ ...q, section: 'Чтение' })));
    bank.ascolto.forEach(q => list.push({ ...q, type: 'listen', section: 'Аудирование' }));
    return list;
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // Перемешивает порядок вариантов ответа (single/multi/listen) — в банке верный
  // вариант почти всегда написан первым, иначе экзамен решается по позиции без
  // знания языка. Мутирует вопрос на месте, поэтому рендер и проверка видят один
  // и тот же порядок; match/truefalse/text не трогаем — у них нет q.options.
  function shuffleQuestionOptions(q) {
    if (!Array.isArray(q.options)) return;
    const order = shuffleArray(q.options.map((_, i) => i)); // order[newIndex] = oldIndex
    const oldToNew = {};
    order.forEach((oldIdx, newIdx) => { oldToNew[oldIdx] = newIdx; });
    q.options = order.map(i => q.options[i]);
    if (Array.isArray(q.correct)) q.correct = q.correct.map(i => oldToNew[i]);
    else if (typeof q.correct === 'number') q.correct = oldToNew[q.correct];
  }

  function buildFinalExam(holder, bank) {
    // Реshuffle при каждом заходе (в т.ч. «Пройти заново») — заодно и от заучивания позиции спасает.
    bank.questions.forEach(shuffleQuestionOptions);
    bank.lettura.forEach(l => l.questions.forEach(shuffleQuestionOptions));
    bank.ascolto.forEach(shuffleQuestionOptions);
    const state = { holder, bank, gradedList: buildGradedList(bank) };
    holder.innerHTML = renderExamShell(bank, state.gradedList.length);
    wireExamShell(state);
  }

  // ══════════════════════════ РЕНДЕР ВОПРОСОВ ══════════════════════════

  function renderChoiceInput(qid, options, inputType) {
    const name = `f_${qid}`;
    return `<div class="exam-opts">${options.map((opt, i) => `
      <label class="exam-opt">
        <input type="${inputType}" name="${examEsc(name)}" value="${i}" data-role="opt">
        <span>${examEsc(opt)}</span>
      </label>`).join('')}</div>`;
  }
  function renderTrueFalseInput(qid) {
    const name = `tf_${qid}`;
    return `<div class="exam-opts exam-opts-tf">
      <label class="exam-opt"><input type="radio" name="${examEsc(name)}" value="true" data-role="tf"><span>Vero</span></label>
      <label class="exam-opt"><input type="radio" name="${examEsc(name)}" value="false" data-role="tf"><span>Falso</span></label>
    </div>`;
  }
  function renderTextInput() {
    return `<input type="text" class="exam-text-input" data-role="text" autocomplete="off" spellcheck="false" placeholder="Впиши ответ">`;
  }
  function renderMatchInput(q) {
    return `<div class="exam-match">${q.left.map((l) => `
      <div class="exam-match-row">
        <span class="exam-match-left">${examEsc(l)}</span>
        <span class="exam-match-arrow">→</span>
        <select class="exam-match-select" data-role="match">
          <option value="">—</option>
          ${q.right.map((r, j) => `<option value="${j}">${examEsc(r)}</option>`).join('')}
        </select>
      </div>`).join('')}</div>`;
  }

  function renderQuestion(q) {
    let body = '';
    if (q.type === 'single' || q.type === 'listen') body = renderChoiceInput(q.id, q.options, 'radio');
    else if (q.type === 'multi') body = renderChoiceInput(q.id, q.options, 'checkbox');
    else if (q.type === 'truefalse') body = renderTrueFalseInput(q.id);
    else if (q.type === 'text') body = renderTextInput();
    else if (q.type === 'match') body = renderMatchInput(q);
    return `
      <div class="exam-q" data-qid="${examEsc(q.id)}">
        <div class="exam-q-cat">${examEsc(q.cat)}${q.type === 'multi' ? ' <em>· выбери все верные варианты</em>' : ''}</div>
        <div class="exam-q-text">${examGapify(q.q)}</div>
        ${body}
        <div class="exam-reveal-slot"></div>
      </div>`;
  }

  // Шапка части: римский номер + итальянское название + русский подзаголовок со счётчиком
  function renderPartHead(roman, titleIt, sub) {
    return `<div class="exam-part-head">
      <span class="exam-part-num">${roman}</span>
      <div class="exam-part-titles">
        <span class="exam-part-title">${examEsc(titleIt)}</span>
        <span class="exam-part-sub">${examEsc(sub)}</span>
      </div>
    </div>`;
  }

  function renderLessicoBlock(questions) {
    const items = questions.filter(q => q.block === 'lessico');
    if (!items.length) return '';
    return `<div class="exam-block">${renderPartHead('I', 'Lessico', `Лексика · ${items.length} вопросов`)}${items.map(renderQuestion).join('')}</div>`;
  }
  function renderGrammaticaBlock(questions) {
    const items = questions.filter(q => q.block === 'grammatica');
    if (!items.length) return '';
    return `<div class="exam-block">${renderPartHead('II', 'Grammatica', `Грамматика · ${items.length} вопросов`)}${items.map(renderQuestion).join('')}</div>`;
  }
  function renderLetturaBlock(lettura) {
    if (!lettura.length) return '';
    const count = lettura.reduce((a, l) => a + l.questions.length, 0);
    return `<div class="exam-block">${renderPartHead('III', 'Lettura', `Чтение · ${count} вопросов`)}
      ${lettura.map(l => `
        <div class="exam-reading">
          <div class="exam-reading-text" data-lang="it">${examEsc(l.textIt)}</div>
        </div>
        ${l.questions.map(renderQuestion).join('')}
      `).join('')}
    </div>`;
  }
  function renderAscoltoBlock(items) {
    if (!items.length) return '';
    return `<div class="exam-block">${renderPartHead('IV', 'Ascolto', `Аудирование · ${items.length} фраз`)}
      ${items.map(q => `
        <div class="exam-q" data-qid="${examEsc(q.id)}">
          <div class="exam-q-cat">${examEsc(q.cat)}</div>
          <button type="button" class="exam-listen-btn" data-role="listen" data-say="${examEsc(q.say)}">${LISTEN_ICON}<span>Слушать фразу</span></button>
          ${renderChoiceInput(q.id, q.options, 'radio')}
          <div class="exam-reveal-slot"></div>
        </div>
      `).join('')}
    </div>`;
  }
  function renderProduzioneBlock(items) {
    if (!items.length) return '';
    return `<div class="exam-block">${renderPartHead('V', 'Produzione scritta', 'Письмо · в балл не идёт, уходит в ИИ-разбор')}
      ${items.map(p => `
        <div class="exam-q exam-q-open" data-qid="${examEsc(p.id)}">
          <div class="exam-q-text">${examGapify(p.prompt)}</div>
          <textarea class="exam-open-textarea" data-role="open" placeholder="Напиши здесь минимум ${p.minSentences || 5} предложений…"></textarea>
        </div>
      `).join('')}
    </div>`;
  }

  function renderExamShell(bank, totalGraded) {
    const prev = window.storageGet ? window.storageGet(EXAM_STORAGE_KEY) : null;
    const prevHtml = (prev && prev.last)
      ? `<div class="exam-intro-prev">
          <span class="exam-prev-pill">Последняя попытка <b>${prev.last.pct}%</b></span>
          ${prev.best ? `<span class="exam-prev-pill">Лучшая <b>${prev.best.pct}%</b></span>` : ''}
        </div>`
      : '';
    return `
      <div class="exam-intro" data-exam-intro>
        <div class="exam-intro-laurel">${LAUREL_ICON}</div>
        <p class="exam-intro-eyebrow">Esame finale scritto · Livello A2</p>
        <p class="exam-intro-title">Итог всего курса</p>
        <p class="exam-intro-text">Пять частей: лексика, грамматика, чтение, аудирование и письмо. Таймера нет — отвечай в своём темпе, кнопка «Проверить» доступна в любой момент. Пропущенные вопросы просто идут в зачёт как неверные.</p>
        <div class="exam-intro-stats">
          <div class="exam-stat"><b>${totalGraded}</b><span>вопросов</span></div>
          <div class="exam-stat"><b>5</b><span>частей</span></div>
          <div class="exam-stat"><b>${bank.produzione.length}</b><span>открытых заданий</span></div>
          <div class="exam-stat"><b>∞</b><span>без таймера</span></div>
        </div>
        ${prevHtml}
        <button type="button" class="exam-start-btn" data-role="exam-start">${prev && prev.last ? 'Пройти заново' : 'Начать экзамен'}</button>
      </div>
      <div class="exam-body" data-exam-body hidden>
        ${renderLessicoBlock(bank.questions)}
        ${renderGrammaticaBlock(bank.questions)}
        ${renderLetturaBlock(bank.lettura)}
        ${renderAscoltoBlock(bank.ascolto)}
        ${renderProduzioneBlock(bank.produzione)}
        <div class="exam-submit-warn" data-exam-warn hidden>
          <span data-warn-text></span>
          <button type="button" class="exam-warn-jump" data-role="jump-blank">К первому пропущенному ↑</button>
        </div>
        <div class="exam-submit-bar">
          <div class="exam-submit-info">
            <span class="exam-submit-progress" data-exam-progress>Отвечено 0 из ${totalGraded}</span>
            <span class="exam-submit-track"><span class="exam-submit-fill" data-exam-fill></span></span>
          </div>
          <button type="button" class="exam-submit-btn" data-role="exam-submit">Проверить</button>
        </div>
      </div>
      <div class="exam-results" data-exam-results hidden></div>
    `;
  }

  // ══════════════════════════ ВЗАИМОДЕЙСТВИЕ ══════════════════════════

  function isAnswered(qEl, q) {
    switch (q.type) {
      case 'single': case 'listen': return !!qEl.querySelector('input[data-role="opt"]:checked');
      case 'multi': return !!qEl.querySelector('input[data-role="opt"]:checked');
      case 'truefalse': return !!qEl.querySelector('input[data-role="tf"]:checked');
      case 'text': { const i = qEl.querySelector('input[data-role="text"]'); return !!(i && i.value.trim()); }
      case 'match': { const s = [...qEl.querySelectorAll('select[data-role="match"]')]; return s.length > 0 && s.every(x => x.value !== ''); }
      default: return false;
    }
  }

  function wireExamShell(state) {
    const { holder, bank, gradedList } = state;
    const introEl = holder.querySelector('[data-exam-intro]');
    const bodyEl = holder.querySelector('[data-exam-body]');
    const resultsEl = holder.querySelector('[data-exam-results]');
    const progressEl = bodyEl.querySelector('[data-exam-progress]');
    const fillEl = bodyEl.querySelector('[data-exam-fill]');
    const warnEl = bodyEl.querySelector('[data-exam-warn]');
    const warnText = warnEl.querySelector('[data-warn-text]');

    // Предохранитель отправки: первый клик «Проверить» при пропусках только предупреждает,
    // повторный — реально завершает. Любое новое действие в тесте снимает «взвод».
    state.submitArmed = false;
    const disarmSubmit = () => { state.submitArmed = false; warnEl.hidden = true; };
    const blankList = () => gradedList.filter(q => {
      const qEl = bodyEl.querySelector(`[data-qid="${q.id}"]`);
      return !(qEl && isAnswered(qEl, q));
    });

    const updateProgress = () => {
      let n = 0;
      gradedList.forEach(q => {
        const qEl = bodyEl.querySelector(`[data-qid="${q.id}"]`);
        if (qEl && isAnswered(qEl, q)) n++;
      });
      progressEl.textContent = `Отвечено ${n} из ${gradedList.length}`;
      if (fillEl) fillEl.style.width = (gradedList.length ? Math.round((n / gradedList.length) * 100) : 0) + '%';
    };
    const debouncedProgress = debounce(updateProgress, 250);

    introEl.querySelector('[data-role="exam-start"]').addEventListener('click', () => {
      introEl.hidden = true;
      bodyEl.hidden = false;
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
      state.startedAt = Date.now(); // старт таймера — для аналитики скорости
      holder.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateProgress();
    });

    bodyEl.addEventListener('change', () => { updateProgress(); disarmSubmit(); });
    bodyEl.addEventListener('input', () => { debouncedProgress(); disarmSubmit(); });

    bodyEl.addEventListener('click', (e) => {
      const listenBtn = e.target.closest('[data-role="listen"]');
      if (listenBtn) {
        const text = listenBtn.getAttribute('data-say');
        listenBtn.classList.add('is-playing');
        const done = () => listenBtn.classList.remove('is-playing');
        if (window.speakIt) window.speakIt(text).then(done).catch(done);
        else done();
        return;
      }
      const jumpBtn = e.target.closest('[data-role="jump-blank"]');
      if (jumpBtn) {
        const blanks = blankList();
        if (blanks.length) {
          const qEl = bodyEl.querySelector(`[data-qid="${blanks[0].id}"]`);
          if (qEl) flashQuestion(qEl);
        }
        return;
      }
      const submitBtn = e.target.closest('[data-role="exam-submit"]');
      if (submitBtn) {
        const blanks = blankList().length;
        if (blanks && !state.submitArmed) {
          state.submitArmed = true;
          warnText.textContent = `Без ответа ${blanks} ${ruPlural(blanks, 'вопрос', 'вопроса', 'вопросов')} — ${blanks === 1 ? 'он пойдёт' : 'они пойдут'} в зачёт как неверные. Заполни пропуски или нажми «Проверить» ещё раз, чтобы завершить.`;
          warnEl.hidden = false;
          return;
        }
        disarmSubmit();
        gradeExam(state);
      }
    });

    updateProgress();
  }

  // ══════════════════════════ ПРОВЕРКА И БАЛЛЫ ══════════════════════════

  // Возвращает детальную оценку: { status: 'correct'|'near'|'wrong', kind, userText }.
  // 'near' — «почти» (одна опечатка / один неверный пункт в multi/match): в балл НЕ идёт,
  // но показывается отдельно как «ты был в одном шаге».
  function gradeQuestionDetailed(qEl, q) {
    switch (q.type) {
      case 'single': case 'listen': {
        const checked = qEl.querySelector('input[data-role="opt"]:checked');
        const ok = checked ? +checked.value === q.correct : false;
        return { status: ok ? 'correct' : 'wrong', kind: ok ? 'exact' : 'wrong', userText: checked ? q.options[+checked.value] : '' };
      }
      case 'multi': {
        const checked = [...qEl.querySelectorAll('input[data-role="opt"]:checked')].map(i => +i.value).sort((a, b) => a - b);
        const want = [...q.correct].sort((a, b) => a - b);
        const exact = checked.length === want.length && checked.every((v, i) => v === want[i]);
        const setW = new Set(want), setC = new Set(checked);
        const missing = want.filter(v => !setC.has(v)).length;
        const extra = checked.filter(v => !setW.has(v)).length;
        const status = exact ? 'correct' : (missing + extra === 1 ? 'near' : 'wrong');
        return { status, kind: status, userText: checked.map(i => q.options[i]).join(', ') };
      }
      case 'truefalse': {
        const checked = qEl.querySelector('input[data-role="tf"]:checked');
        const ok = checked ? (checked.value === 'true') === q.correct : false;
        return { status: ok ? 'correct' : 'wrong', kind: ok ? 'exact' : 'wrong', userText: checked ? (checked.value === 'true' ? 'Vero' : 'Falso') : '' };
      }
      case 'text': {
        const input = qEl.querySelector('input[data-role="text"]');
        const val = input ? input.value : '';
        const r = gradeTextAnswer(val, q.correct);
        return { status: r.status, kind: r.kind, userText: val.trim() };
      }
      case 'match': {
        const sels = [...qEl.querySelectorAll('select[data-role="match"]')];
        const userAns = sels.map(s => s.value === '' ? null : +s.value);
        const wrongCount = q.correct.reduce((acc, c, i) => acc + (userAns[i] === c ? 0 : 1), 0);
        const status = wrongCount === 0 ? 'correct' : (wrongCount === 1 ? 'near' : 'wrong');
        return { status, kind: status, userText: q.left.map((l, i) => `${l} → ${userAns[i] == null ? '—' : q.right[userAns[i]]}`).join('; ') };
      }
      default: return { status: 'wrong', kind: 'wrong', userText: '' };
    }
  }

  function correctAnswerText(q) {
    switch (q.type) {
      case 'single': case 'listen': return q.options[q.correct];
      case 'multi': return q.correct.map(i => q.options[i]).join(', ');
      case 'truefalse': return q.correct ? 'Vero' : 'Falso';
      case 'text': return Array.isArray(q.correct) ? q.correct[0] : q.correct;
      case 'match': return q.left.map((l, i) => `${l} → ${q.right[q.correct[i]]}`).join('; ');
    }
    return '';
  }

  function renderCorrection(q, d) {
    const near = d && d.status === 'near';
    const nearNote = near
      ? `<p class="exam-correction-near">Почти! Ты в одном шаге — ${q.type === 'text' ? 'опечатка в написании.' : 'ошибка ровно в одном пункте.'}</p>`
      : '';
    const yourLine = (d && d.userText)
      ? `<p class="exam-correction-your">Твой ответ: <b>${examEsc(d.userText)}</b></p>`
      : `<p class="exam-correction-your exam-correction-blank">Ответ не выбран</p>`;
    return `<div class="exam-correction${near ? ' is-near' : ''}">
      ${nearNote}
      ${yourLine}
      <p class="exam-correction-answer">Правильно: <b>${examEsc(correctAnswerText(q))}</b></p>
      ${q.explain ? `<p class="exam-correction-rule">${examEsc(q.explain)}</p>` : ''}
    </div>`;
  }

  function saveExamAttempt(a) {
    const rec = {
      pct: a.pct, byCategory: a.byCategory, bySection: a.bySection,
      recognition: a.recognition, production: a.production,
      near: a.nearCount, durationMs: a.durationMs, t: Date.now(),
    };
    const cur = (window.storageGet && window.storageGet(EXAM_STORAGE_KEY)) || {};
    const best = (!cur.best || a.pct > cur.best.pct) ? rec : cur.best;
    const next = { last: rec, best };
    if (window.storageSet) window.storageSet(EXAM_STORAGE_KEY, next);
    if (window.cloudPush) window.cloudPush(EXAM_STORAGE_KEY);
    return next;
  }

  function gradeExam(state) {
    const { holder, bank, gradedList } = state;
    const bodyEl = holder.querySelector('[data-exam-body]');
    const resultsEl = holder.querySelector('[data-exam-results]');

    bodyEl.querySelectorAll('.exam-q').forEach(el => {
      el.classList.remove('is-correct', 'is-wrong', 'is-near', 'is-accent');
      const slot = el.querySelector('.exam-reveal-slot');
      if (slot) slot.innerHTML = '';
    });

    const catTotals = {}, sectionTotals = {}, typeTotals = {}, catSecMap = {};
    const skillTotals = { recognition: { correct: 0, total: 0 }, production: { correct: 0, total: 0 } };
    let totalCorrect = 0, nearCount = 0, blankCount = 0;
    const nearMisses = [], wrongText = [];

    gradedList.forEach(q => {
      const qEl = bodyEl.querySelector(`[data-qid="${q.id}"]`);
      if (!qEl) return;
      const d = gradeQuestionDetailed(qEl, q);
      const isCorrect = d.status === 'correct';
      const bump = (obj, key) => { obj[key] = obj[key] || { correct: 0, total: 0 }; obj[key].total++; if (isCorrect) obj[key].correct++; };
      bump(catTotals, q.cat);
      bump(sectionTotals, q.section || 'Прочее');
      bump(typeTotals, q.type);
      if (!catSecMap[q.cat]) catSecMap[q.cat] = q.section || 'Прочее';
      const meta = TYPE_META[q.type] || TYPE_META.single;
      skillTotals[meta.skill].total++;
      if (isCorrect) skillTotals[meta.skill].correct++;

      if (isCorrect) {
        totalCorrect++;
        qEl.classList.add('is-correct');
        if (d.kind === 'accent') { // засчитано, но напомним про акцент
          qEl.classList.add('is-accent');
          const slot = qEl.querySelector('.exam-reveal-slot');
          if (slot) slot.innerHTML = `<div class="exam-correction is-accent"><p class="exam-correction-near">Засчитано! Только не теряй акцент: <b>${examEsc(correctAnswerText(q))}</b>.</p></div>`;
        }
      } else {
        if (d.status === 'near') { nearCount++; qEl.classList.add('is-near'); }
        else qEl.classList.add('is-wrong');
        if (!d.userText) blankCount++;
        const slot = qEl.querySelector('.exam-reveal-slot');
        if (slot) slot.innerHTML = renderCorrection(q, d);
        if (d.status === 'near') nearMisses.push({ cat: q.cat, your: d.userText, correct: correctAnswerText(q) });
        if (q.type === 'text' && d.userText) wrongText.push({ cat: q.cat, your: d.userText, correct: correctAnswerText(q) });
      }
    });

    const totalGraded = gradedList.length;
    const pct = totalGraded ? Math.round((totalCorrect / totalGraded) * 100) : 0;
    const mapPct = obj => Object.entries(obj).map(([k, v]) => ({ cat: k, correct: v.correct, total: v.total, pct: v.total ? Math.round(v.correct / v.total * 100) : 0 }));
    const byCategory = mapPct(catTotals).map(c => ({ ...c, sec: catSecMap[c.cat] || 'Прочее' })).sort((x, y) => x.pct - y.pct);
    const bySection = SECTION_ORDER.filter(s => sectionTotals[s]).map(s => ({
      cat: s, correct: sectionTotals[s].correct, total: sectionTotals[s].total,
      pct: Math.round(sectionTotals[s].correct / sectionTotals[s].total * 100),
    }));
    const byType = mapPct(typeTotals).map(t => ({ ...t, label: (TYPE_META[t.cat] || {}).label || t.cat })).sort((a, b) => b.total - a.total);
    const recognition = skillTotals.recognition.total ? Math.round(skillTotals.recognition.correct / skillTotals.recognition.total * 100) : 0;
    const production = skillTotals.production.total ? Math.round(skillTotals.production.correct / skillTotals.production.total * 100) : 0;

    const essays = bank.produzione.map(p => {
      const ta = bodyEl.querySelector(`[data-qid="${p.id}"] textarea`);
      const text = ta ? ta.value.trim() : '';
      return { prompt: p.prompt, text, words: text ? text.split(/\s+/).filter(Boolean).length : 0, minSentences: p.minSentences || 5 };
    });

    const durationMs = state.startedAt ? Date.now() - state.startedAt : 0;
    // предыдущая попытка ДО перезаписи — для дельт
    const prevRec = (window.storageGet && window.storageGet(EXAM_STORAGE_KEY)) || {};
    const prevLast = prevRec.last || null;

    const analytics = {
      pct, totalCorrect, totalGraded, nearCount, blankCount,
      answered: totalGraded - blankCount,
      bySection, byCategory, byType, recognition, production, skillTotals,
      durationMs, nearMisses, wrongText, essays,
    };

    saveExamAttempt(analytics);

    resultsEl.hidden = false;
    resultsEl.innerHTML = renderResults(analytics, prevLast);
    wireResults(state, resultsEl, analytics, prevLast);
    setupErrorNav(state);
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Подтверждённый A2 — праздник: общий конфетти-салют приложения (если доступен)
    if (cefrVerdict(analytics).cls === 'pass' && typeof window.launchConfetti === 'function') {
      setTimeout(() => { try { window.launchConfetti(); } catch (e) {} }, 600);
    }
  }

  // Плавающий «штурман по ошибкам»: после проверки циклично ведёт по вопросам
  // с ошибками (включая «почти») — не нужно выискивать красные карточки скроллом.
  function setupErrorNav(state) {
    const holder = state.holder;
    const prev = holder.querySelector('.exam-errnav');
    if (prev) prev.remove();
    const errs = [...holder.querySelectorAll('.exam-q.is-wrong, .exam-q.is-near')];
    if (!errs.length) return;
    const nav = document.createElement('button');
    nav.type = 'button';
    nav.className = 'exam-errnav';
    nav.title = 'Перейти к следующей ошибке';
    let idx = 0;
    const setLabel = () => { nav.innerHTML = `К ошибке <b>${idx + 1} / ${errs.length}</b> ↧`; };
    setLabel();
    nav.addEventListener('click', () => {
      flashQuestion(errs[idx]);
      idx = (idx + 1) % errs.length;
      setLabel();
    });
    holder.appendChild(nav);
  }

  // ══════════════════════════ РЕЗУЛЬТАТЫ И ИИ-ФИДБЕК ══════════════════════════

  // Уровень результата → класс-тон для мини-карточек и чипов (по проценту)
  function toneFor(pct) {
    if (pct >= 85) return 'hi';
    if (pct >= 60) return 'mid';
    return 'lo';
  }

  // Вердикт по уровню A2: учитывает и общий процент, и самый слабый раздел
  // (нельзя «закрыть» A2 с проваленным разделом даже при высоком среднем).
  function cefrVerdict(a) {
    const weakest = a.bySection.length ? Math.min(...a.bySection.map(s => s.pct)) : 0;
    if (a.pct >= 75 && weakest >= 60) return { cls: 'pass', icon: '✓', title: 'Уровень A2 подтверждён', text: 'Курс можно закрывать: результат ровный по всем разделам.' };
    if (a.pct >= 60 && weakest >= 45) return { cls: 'near', icon: '≈', title: 'A2 почти взят', text: 'База прочная — подтяни слабые разделы, и можно закрывать курс.' };
    return { cls: 'redo', icon: '↺', title: 'A2 пока не закрыт', text: 'Стоит вернуться к слабым темам и пройти тест повторно перед завершением курса.' };
  }

  // Дельта против прошлой попытки → чип «+8%» / «−3%» / «= ровно»
  function deltaChip(cur, prev, big) {
    if (prev == null || !Number.isFinite(prev)) return '';
    const d = cur - prev;
    const cls = d > 0 ? 'up' : (d < 0 ? 'down' : 'flat');
    const sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
    const val = Math.abs(d);
    return `<span class="exam-delta exam-delta-${cls}${big ? ' exam-delta-big' : ''}">${sign}${val}${big ? '%' : ''}</span>`;
  }

  function renderResults(a, prevLast) {
    const badge = badgeFor(a.pct);
    const verdict = cefrVerdict(a);
    const prevPct = prevLast ? prevLast.pct : null;
    const prevSecMap = {};
    if (prevLast && Array.isArray(prevLast.bySection)) prevLast.bySection.forEach(s => { prevSecMap[s.cat] = s.pct; });

    // ── Карточки 4 разделов с дельтами ──
    const sectionCards = a.bySection.map(s => `
      <div class="exam-sec-card exam-tone-${toneFor(s.pct)}">
        <span class="exam-sec-name">${examEsc(s.cat)}</span>
        <span class="exam-sec-pct">${s.pct}<i>%</i>${deltaChip(s.pct, prevSecMap[s.cat])}</span>
        <span class="exam-sec-bar"><span style="width:${s.pct}%"></span></span>
        <span class="exam-sec-frac">${s.correct}/${s.total}</span>
      </div>`).join('');

    // ── Панель навыков: узнавание vs активная продукция + метрики ──
    const skillGap = a.recognition - a.production;
    let skillInsight = 'Узнавание и активная продукция сбалансированы — хороший знак зрелого A2.';
    if (a.skillTotals.production.total && skillGap >= 15) skillInsight = 'Формы узнаёшь заметно лучше, чем воспроизводишь сама — тренируй активный вызов из памяти (перевод с русского, а не выбор варианта).';
    else if (skillGap <= -15) skillInsight = 'Активно пишешь формы даже увереннее, чем выбираешь из вариантов — сильный признак, продолжай в том же духе.';
    const avgPerQ = a.answered ? Math.round(a.durationMs / a.answered / 1000) : 0;
    const profile = `
      <div class="exam-profile">
        <div class="exam-profile-skills">
          <div class="exam-skill exam-tone-${toneFor(a.recognition)}">
            <div class="exam-skill-top"><span>Узнавание</span><b>${a.recognition}%</b></div>
            <span class="exam-skill-bar"><span style="width:${a.recognition}%"></span></span>
            <span class="exam-skill-hint">выбор варианта, В/Н, аудио, сопоставление</span>
          </div>
          <div class="exam-skill exam-tone-${toneFor(a.production)}">
            <div class="exam-skill-top"><span>Активная продукция</span><b>${a.production}%</b></div>
            <span class="exam-skill-bar"><span style="width:${a.production}%"></span></span>
            <span class="exam-skill-hint">сама вписываешь форму по-итальянски</span>
          </div>
        </div>
        <p class="exam-profile-insight">${examEsc(skillInsight)}</p>
        <div class="exam-metrics">
          <div class="exam-metric"><b>${a.durationMs ? fmtDuration(a.durationMs) : '—'}</b><span>время</span></div>
          <div class="exam-metric"><b>${avgPerQ ? avgPerQ + ' с' : '—'}</b><span>на вопрос</span></div>
          <div class="exam-metric exam-metric-near"><b>${a.nearCount}</b><span>почти верных</span></div>
          <div class="exam-metric"><b>${a.answered}/${a.totalGraded}</b><span>отвечено</span></div>
        </div>
      </div>`;

    // ── «Почти верно» — отдельная тёплая карточка (эти ответы были в шаге от правильного) ──
    const nearBlock = a.nearCount ? `
      <div class="exam-near-note">
        <span class="exam-near-badge">≈ ${a.nearCount}</span>
        <span>${a.nearCount === 1 ? 'один ответ был' : (a.nearCount < 5 ? 'ответа были' : 'ответов были')} в одном шаге от верного (опечатка или один пункт) — они не пошли в балл, но это почти попадание.</span>
      </div>` : '';

    // ── Слабые темы чипами ──
    const weak = a.byCategory.filter(c => c.pct < 100).slice(0, 8);
    const weakBlock = weak.length ? `
      <div class="exam-weak">
        <span class="exam-weak-label">Стоит повторить</span>
        <div class="exam-weak-chips">
          ${weak.map(c => `<span class="exam-chip exam-tone-${toneFor(c.pct)}">${examEsc(c.cat)} <b>${c.pct}%</b></span>`).join('')}
        </div>
      </div>` : `
      <div class="exam-weak exam-weak-clean">
        <span class="exam-weak-label">Слабых тем нет — результат ровный по всем разделам 👏</span>
      </div>`;

    // ── Свёрнутая аналитика: по формату вопроса + полная разбивка по темам ──
    const typeRows = a.byType.map(t => `
      <div class="exam-cat-row exam-tone-${toneFor(t.pct)}">
        <span class="exam-cat-name">${examEsc(t.label)}</span>
        <span class="exam-cat-bar"><span class="exam-cat-fill" style="width:${t.pct}%"></span></span>
        <span class="exam-cat-pct">${t.pct}% · ${t.correct}/${t.total}</span>
      </div>`).join('');
    // Полная разбивка — сгруппирована по 4 разделам курса; темы на 100% свёрнуты
    // в компактные чипы, полосами показаны только темы с ошибками (стены из
    // одинаковых зелёных полос на 100% больше нет).
    const perfectTotal = a.byCategory.filter(c => c.pct === 100).length;
    const catGroups = SECTION_ORDER.map(sec => {
      const cats = a.byCategory.filter(c => c.sec === sec);
      if (!cats.length) return '';
      const perfect = cats.filter(c => c.pct === 100).sort((x, y) => x.cat.localeCompare(y.cat));
      const rest = cats.filter(c => c.pct < 100); // byCategory уже отсортирован по возрастанию
      const avg = Math.round(cats.reduce((s, c) => s + c.pct, 0) / cats.length);
      const rows = rest.map(c => `
        <div class="exam-cat-row exam-tone-${toneFor(c.pct)}">
          <span class="exam-cat-name">${examEsc(c.cat)}</span>
          <span class="exam-cat-bar"><span class="exam-cat-fill" style="width:${c.pct}%"></span></span>
          <span class="exam-cat-pct">${c.pct}%</span>
        </div>`).join('');
      const perfectHtml = perfect.length ? `
        <div class="exam-catgroup-perfect">
          <span class="exam-catgroup-perfect-label">Освоено на 100% · ${perfect.length}</span>
          <div class="exam-catgroup-chips">${perfect.map(c => `<span class="exam-perfect-chip">${examEsc(c.cat)}</span>`).join('')}</div>
        </div>` : '';
      return `
        <div class="exam-catgroup exam-tone-${toneFor(avg)}">
          <div class="exam-catgroup-head">
            <span class="exam-catgroup-name">${examEsc(sec)}</span>
            <span class="exam-catgroup-meta"><b>${avg}%</b> · тем: ${cats.length}</span>
          </div>
          ${rest.length ? `<div class="exam-cat-list">${rows}</div>` : '<p class="exam-catgroup-clean">Все темы раздела без единой ошибки</p>'}
          ${perfectHtml}
        </div>`;
    }).join('');
    const details = `
      <details class="exam-cat-details">
        <summary>Аналитика по формату вопросов (${a.byType.length})</summary>
        <div class="exam-cat-list">${typeRows}</div>
      </details>
      <details class="exam-cat-details">
        <summary>Полная разбивка по всем темам (${a.byCategory.length}${perfectTotal ? ` · идеально ${perfectTotal}` : ''})</summary>
        <div class="exam-catgroups">${catGroups}</div>
      </details>`;

    return `
      <div class="exam-score-head exam-badge-${badge.cls}">
        <div class="exam-score-ring" data-ring-pct="${a.pct}">
          <div class="exam-score-num">${a.pct}<i>%</i></div>
        </div>
        <div class="exam-score-info">
          <div class="exam-score-badge">${examEsc(badge.label)}${deltaChip(a.pct, prevPct, true)}</div>
          <div class="exam-score-sub">${a.totalCorrect} из ${a.totalGraded} верно${prevPct != null ? ` · прошлый раз ${prevPct}%` : ''}</div>
          <p class="exam-score-note">${examEsc(badge.note)}</p>
        </div>
      </div>
      <div class="exam-verdict exam-verdict-${verdict.cls}">
        <span class="exam-verdict-icon">${verdict.icon}</span>
        <div><b>${examEsc(verdict.title)}</b><span>${examEsc(verdict.text)}</span></div>
      </div>
      <div class="exam-sec-grid">${sectionCards}</div>
      ${profile}
      ${nearBlock}
      ${weakBlock}
      <div class="exam-ai-feedback" data-exam-ai>
        <div class="exam-ai-loading"><span class="exam-spinner"></span>ИИ анализирует твой результат…</div>
      </div>
      ${details}
      <button type="button" class="exam-restart-btn" data-role="exam-restart">Пройти заново</button>
    `;
  }

  function renderAiFeedbackBox(text, isAi) {
    const paras = String(text || '').split(/\n+/).filter(Boolean)
      .map(p => `<p class="exam-ai-text">${examEsc(p)}</p>`).join('');
    const tag = isAi
      ? '<span class="exam-ai-tag">ИИ-разбор</span>'
      : '<span class="exam-ai-tag exam-ai-tag-off">офлайн</span>';
    return `<div class="exam-ai-head">${tag}Персональный вывод</div>${paras}`;
  }

  // Офлайн-вывод: связный разбор из собранной аналитики (не выдаёт себя за ИИ).
  function buildOfflineExamFeedback(a) {
    const verdict = cefrVerdict(a);
    const strongSec = a.bySection.filter(s => s.pct >= 85).map(s => s.cat.toLowerCase());
    const weakSec = [...a.bySection].sort((x, y) => x.pct - y.pct).filter(s => s.pct < 75).slice(0, 2);
    const weakTopics = a.byCategory.filter(c => c.pct < 60).slice(0, 3).map(c => c.cat);
    const lines = [];

    // 1) вердикт по уровню
    lines.push(`${verdict.title} — итог ${a.pct}%. ${verdict.text}`);

    // 2) сильное + приоритеты
    let l2 = '';
    if (strongSec.length) l2 += `Крепче всего держится: ${strongSec.join(', ')}. `;
    if (weakSec.length) {
      l2 += `Приоритет для повторения — ${weakSec.map(s => `${s.cat.toLowerCase()} (${s.pct}%)`).join(' и ')}.`;
      if (weakTopics.length) l2 += ` Точечно просели темы: ${weakTopics.join(', ')} — вернись к соответствующим урокам.`;
    } else l2 += 'Проваленных разделов нет — картина ровная, добери отдельные темы из списка ниже.';
    lines.push(l2.trim());

    // 3) профиль навыка + скорость + «почти»
    let l3 = '';
    const gap = a.recognition - a.production;
    if (a.skillTotals.production.total && gap >= 15) l3 += `Формы узнаёшь (${a.recognition}%) заметно лучше, чем пишешь сама (${a.production}%) — тренируй активный вызов из памяти, а не выбор варианта. `;
    else if (gap <= -15) l3 += `Активно пишешь формы (${a.production}%) даже увереннее, чем выбираешь из вариантов (${a.recognition}%) — сильный признак. `;
    else l3 += `Узнавание (${a.recognition}%) и активная продукция (${a.production}%) сбалансированы. `;
    if (a.nearCount) l3 += `${a.nearCount} ${a.nearCount === 1 ? 'ответ был' : 'ответов было'} в шаге от верного (опечатки/один пункт) — почти попадания. `;
    if (a.durationMs) l3 += `Прошла тест за ${fmtDuration(a.durationMs)}.`;
    lines.push(l3.trim());

    // 4) эссе
    const filled = a.essays.filter(e => e.text.length > 0).length;
    if (a.essays.length) {
      const shortOnes = a.essays.filter(e => e.text && e.words < 25).length;
      lines.push(filled < a.essays.length
        ? `Открытых письменных заданий заполнено ${filled} из ${a.essays.length} — допиши остальные: в балл они не идут, но это лучшая тренировка речи перед финалом.`
        : (shortOnes ? `Все ${a.essays.length} письменных задания написаны, но некоторые коротковаты — стоит развернуть мысль подробнее.` : `Все ${a.essays.length} письменных задания написаны развёрнуто — отличная финальная практика речи.`));
    }
    return lines.join('\n');
  }

  async function loadExamFeedback(box, a, prevLast) {
    const verdict = cefrVerdict(a);
    const sections = a.bySection.map(s => ({ name: s.cat, pct: s.pct, correct: s.correct, total: s.total }));
    const weak = a.byCategory.filter(c => c.pct < 100).slice(0, 8).map(c => `${c.cat} (${c.pct}%)`);
    const strong = a.byCategory.filter(c => c.pct >= 90).map(c => c.cat);
    const byType = a.byType.map(t => ({ format: t.label, pct: t.pct, correct: t.correct, total: t.total }));
    const wrongSamples = a.wrongText.slice(0, 8).map(w => `${w.cat}: «${w.your}» → «${w.correct}»`);
    const nearSamples = a.nearMisses.slice(0, 6).map(w => `${w.cat}: «${w.your}» ≈ «${w.correct}»`);
    const essays = a.essays.map(e => ({ prompt: e.prompt, text: e.text, words: e.words }));
    const payload = {
      overallPct: a.pct,
      verdict: { level: verdict.cls, title: verdict.title },
      sections,
      weakCategories: weak,
      strongCategories: strong,
      byType,
      recognitionPct: a.recognition,
      productionPct: a.production,
      nearMisses: nearSamples,
      wrongTextSamples: wrongSamples,
      durationLabel: a.durationMs ? fmtDuration(a.durationMs) : null,
      deltaVsPrev: prevLast ? a.pct - prevLast.pct : null,
      essays,
    };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(AI_FEEDBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify(payload),
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error('server ' + r.status);
      const d = await r.json();
      if (!d.feedback) throw new Error('empty feedback');
      box.innerHTML = renderAiFeedbackBox(d.feedback, true);
    } catch (e) {
      box.innerHTML = renderAiFeedbackBox(buildOfflineExamFeedback(a), false);
    }
  }

  function wireResults(state, resultsEl, analytics, prevLast) {
    resultsEl.querySelector('[data-role="exam-restart"]').addEventListener('click', () => {
      buildFinalExam(state.holder, state.bank);
    });
    // Кольцо счёта: --p анимируется CSS-transition (см. @property --p в styles.css).
    // Не rAF: в фоновой вкладке rAF заморожен и цель никогда не выставится.
    const ring = resultsEl.querySelector('.exam-score-ring');
    if (ring) {
      void ring.offsetWidth; // фиксация стартового кадра с --p:0
      setTimeout(() => ring.style.setProperty('--p', ring.getAttribute('data-ring-pct') || '0'), 60);
    }
    // Полосы разделов/навыков заполняются сразу inline-шириной из разметки, БЕЗ
    // отложенной JS-анимации: transition по width замораживается в фоновых вкладках
    // (как и rAF у кольца), и полосы навсегда застревали на нуле.
    const box = resultsEl.querySelector('[data-exam-ai]');
    loadExamFeedback(box, analytics, prevLast);
  }

  window.initFinalExam = initFinalExam;
})();
